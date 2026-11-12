import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { cancelJob, loadCancelFacts } from "@/server/jobs/customer-cancel";
import { cancelRevision } from "@/lib/customer-cancel";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

describe.skipIf(!testDatabaseUrl)("customer cancellation", () => {
  const schema = useTestSchema(import.meta.filename);
  async function person(role: "CUSTOMER" | "TRADIE" | "ADMIN" = "CUSTOMER") {
    const id = randomUUID(), email = `${id}@example.test`;
    await schema.db.$executeRaw`INSERT INTO auth.users(id,email) VALUES(${id}::uuid,${email})`;
    await schema.db.profile.create({ data: { id, email, role, firstName: role === "TRADIE" ? "Jack" : "Sarah" } });
    return { userId: id, role };
  }
  async function fixture(status: "REVIEW" | "QUOTE_BOUNTY" | "PRICED" | "BOOKABLE" | "ASSIGNED" | "SUBMITTED" = "REVIEW", paid = false) {
    const customer = await person(), worker = await person("TRADIE");
    const job = await schema.db.job.create({ data: { customerId: customer.userId, workerId: ["ASSIGNED", "SUBMITTED"].includes(status) ? worker.userId : null, category: "OTHER", title: "Move a couch", description: "Move the couch upstairs.", addressLine1: "12 Example Street", suburb: "Windsor", city: "Invercargill", status, priceCents: status === "REVIEW" ? null : 10000 } });
    if (paid) await schema.db.payment.create({ data: { jobId: job.id, kind: "JOB", amountCents: 10000, status: "PAID", paidAt: new Date(), idempotencyKey: randomUUID() } });
    return { customer, worker, job, revision: cancelRevision(job.updatedAt.toISOString(), job.status) };
  }
  it.each(["REVIEW", "QUOTE_BOUNTY"] as const)("cancels unpaid %s for free and retries without writes", async status => {
    const { customer, job, revision } = await fixture(status);
    expect(await cancelJob(schema.db, customer, job.id, revision)).toEqual({ status: "cancelled" });
    expect(await cancelJob(schema.db, customer, job.id, revision)).toEqual({ status: "cancelled" });
    expect(await schema.db.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "CANCELLED" });
    expect(await schema.db.auditLog.count({ where: { recordId: job.id, action: "job.cancelled" } })).toBe(1);
    expect(await schema.db.jobStatusHistory.count({ where: { jobId: job.id, toStatus: "CANCELLED" } })).toBe(1);
    expect(await schema.db.notification.count({ where: { userId: customer.userId, type: "job.cancelled" } })).toBe(1);
    expect(await schema.db.payment.count({ where: { jobId: job.id } })).toBe(0);
  });
  it.each(["BOOKABLE", "ASSIGNED", "QUOTE_BOUNTY"] as const)("puts paid %s on hold, records the reason and notifies every office user and tradie once without changing money", async status => {
    const { customer, worker, job, revision } = await fixture(status, true), offices = [await person("ADMIN"), await person("ADMIN")];
    const payments = await schema.db.payment.findMany({ where: { jobId: job.id } });
    for (let retry = 0; retry < 2; retry++) expect(await cancelJob(schema.db, customer, job.id, revision, "The job is no longer needed.")).toEqual({ status: "requested" });
    expect(await schema.db.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "CANCEL_REVIEW" });
    const audit = await schema.db.auditLog.findMany({ where: { recordId: job.id, action: "job.cancel_requested" } });
    expect(audit).toHaveLength(1); expect(audit[0].reason).toBe("The job is no longer needed.");
    for (const recipient of [...offices.map(office => office.userId), ...(status === "ASSIGNED" ? [worker.userId] : [])]) expect(await schema.db.notification.count({ where: { userId: recipient, type: "job.cancel_requested", payload: { path: ["jobId"], equals: job.id } } })).toBe(1);
    expect(await schema.db.notification.count({ where: { userId: customer.userId, type: "job.cancel_requested" } })).toBe(0);
    expect(await schema.db.payment.findMany({ where: { jobId: job.id } })).toEqual(payments);
  });
  it("refuses paid requests without a valid reason, stale pages, foreign ownership and changed roles without writes", async () => {
    const { customer, worker, job, revision } = await fixture("ASSIGNED", true), other = await person();
    for (const reason of [undefined, "  ", "ab", "x".repeat(501)]) expect(await cancelJob(schema.db, customer, job.id, revision, reason)).toMatchObject({ status: "invalid" });
    expect(await cancelJob(schema.db, customer, job.id, "stale", "A good reason")).toEqual({ status: "changed" });
    for (const actor of [other, worker]) expect(await cancelJob(schema.db, actor, job.id, revision, "A good reason")).toEqual({ status: "forbidden" });
    await schema.db.profile.update({ where: { id: customer.userId }, data: { role: "TRADIE" } });
    expect(await cancelJob(schema.db, customer, job.id, revision, "A good reason")).toEqual({ status: "forbidden" });
    expect(await schema.db.auditLog.count({ where: { recordId: job.id } })).toBe(0);
    expect(await schema.db.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "ASSIGNED", updatedAt: job.updatedAt });
  });
  it.each(["PRICED", "SUBMITTED"] as const)("refuses %s even with a valid reason", async status => {
    const { customer, job, revision } = await fixture(status);
    expect(await cancelJob(schema.db, customer, job.id, revision, "A good reason")).toEqual({ status: "changed" });
    expect(await schema.db.auditLog.count({ where: { recordId: job.id } })).toBe(0);
  });
  it("serializes simultaneous requests and writes one audit, history and recipient delivery", async () => {
    const { customer, job, revision } = await fixture("ASSIGNED", true);
    expect(await Promise.all([1, 2].map(() => cancelJob(schema.db, customer, job.id, revision, "No longer needed.")))).toEqual([{ status: "requested" }, { status: "requested" }]);
    expect(await schema.db.auditLog.count({ where: { recordId: job.id } })).toBe(1);
    expect(await schema.db.jobStatusHistory.count({ where: { jobId: job.id, toStatus: "CANCEL_REVIEW" } })).toBe(1);
  });
  it("loads only owned/current-customer facts and warns only for a recent on-my-way entry", async () => {
    const { customer, worker, job } = await fixture("ASSIGNED", true), other = await person();
    expect(await loadCancelFacts(schema.db, customer, job.id)).toEqual({ canCancel: true, paid: true, workerFirstName: "Jack", onTheWay: false });
    const entry = await schema.db.auditLog.create({ data: { actorId: worker.userId, action: "job.on_my_way", recordType: "jobs", recordId: job.id } });
    expect(await loadCancelFacts(schema.db, customer, job.id, new Date(entry.createdAt.getTime() + 1000))).toMatchObject({ onTheWay: true });
    expect(await loadCancelFacts(schema.db, customer, job.id, new Date(entry.createdAt.getTime() + 3 * 60 * 60 * 1000 + 1000))).toMatchObject({ onTheWay: false });
    expect(await loadCancelFacts(schema.db, other, job.id)).toBeNull();
    expect(await loadCancelFacts(schema.db, worker, job.id)).toBeNull();
    await schema.db.profile.update({ where: { id: customer.userId }, data: { role: "TRADIE" } });
    expect(await loadCancelFacts(schema.db, customer, job.id)).toBeNull();
  });
  it("does not attribute a prior tradie's on-my-way event to a replacement or an unclaimed job", async () => {
    const { customer, worker, job } = await fixture("ASSIGNED", true), replacement = await person("TRADIE");
    await schema.db.profile.update({ where: { id: replacement.userId }, data: { firstName: "Alex" } });
    await schema.db.auditLog.create({ data: { actorId: worker.userId, action: "job.on_my_way", recordType: "jobs", recordId: job.id } });
    expect(await loadCancelFacts(schema.db, customer, job.id, new Date(Date.now() + 1000))).toMatchObject({ workerFirstName: "Jack", onTheWay: true });
    await schema.db.job.update({ where: { id: job.id }, data: { workerId: replacement.userId } });
    expect(await loadCancelFacts(schema.db, customer, job.id, new Date(Date.now() + 1000))).toMatchObject({ workerFirstName: "Alex", onTheWay: false });
    await schema.db.auditLog.create({ data: { actorId: replacement.userId, action: "job.on_my_way", recordType: "jobs", recordId: job.id } });
    expect(await loadCancelFacts(schema.db, customer, job.id, new Date(Date.now() + 1000))).toMatchObject({ workerFirstName: "Alex", onTheWay: true });
    await schema.db.job.update({ where: { id: job.id }, data: { status: "BOOKABLE", workerId: null } });
    expect(await loadCancelFacts(schema.db, customer, job.id, new Date(Date.now() + 1000))).toMatchObject({ workerFirstName: null, onTheWay: false });
  });
});
