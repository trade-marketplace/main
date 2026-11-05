import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { changeWaitingJob } from "@/server/jobs/customer-waiting";
import { waitingJobRevision } from "@/lib/customer-job-waiting";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

describe.skipIf(!testDatabaseUrl)("customer waiting commands", () => {
  const schema = useTestSchema(import.meta.filename);
  const revision = (job: { updatedAt: Date; title: string; description: string; accessNotes: string | null }) => waitingJobRevision(job.updatedAt.toISOString(), { title: job.title, description: job.description, accessNotes: job.accessNotes ?? "" });
  async function person(role: "CUSTOMER" | "TRADIE" | "ADMIN" = "CUSTOMER") {
    const id = randomUUID(), email = `${id}@example.test`;
    await schema.db.$executeRaw`INSERT INTO auth.users(id,email) VALUES(${id}::uuid,${email})`;
    await schema.db.profile.create({ data: { id, email, role, firstName: "Customer" } });
    return { userId: id, role };
  }
  async function fixture() {
    const customer = await person(), worker = await person("TRADIE");
    const job = await schema.db.job.create({ data: { customerId: customer.userId, category: "OTHER", title: "Move a couch", description: "Move the couch upstairs.", addressLine1: "12 Example Street", suburb: "Windsor", city: "Invercargill" } });
    await schema.db.estimate.create({ data: { jobId: job.id, workerId: worker.userId, minutes: 60 } });
    return { customer, worker, job };
  }
  const input = { title: "Move two couches", description: "Move both couches upstairs.", accessNotes: "Use the side door." };
  it("saves details, invalidates prior quotes and notifies their authors once without forwarding private content", async () => {
    const { customer, worker, job } = await fixture();
    expect(await changeWaitingJob(schema.db, customer, job.id, revision(job), "edit", input)).toEqual({ status: "saved" });
    const saved = await schema.db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(saved).toMatchObject(input); expect(saved.editedAt).toBeInstanceOf(Date);
    expect(await schema.db.estimate.findFirst({ where: { jobId: job.id } })).toMatchObject({ madeBeforeEdit: true });
    expect(await schema.db.notification.findMany({ where: { userId: worker.userId, type: "job.details_updated" } })).toMatchObject([{ payload: { jobId: job.id, jobNumber: job.jobNumber } }]);
    expect(await changeWaitingJob(schema.db, customer, job.id, revision(job), "edit", input)).toEqual({ status: "changed" });
    expect(await changeWaitingJob(schema.db, customer, job.id, revision(saved), "edit", input)).toEqual({ status: "saved" });
    expect(await schema.db.auditLog.count({ where: { recordId: job.id, action: "job.details_updated" } })).toBe(1);
    expect(await schema.db.notification.count({ where: { userId: worker.userId, type: "job.details_updated" } })).toBe(1);
  });
  it("refuses foreign ownership, role changes, stale revision and priced jobs without changes", async () => {
    const { customer, worker, job } = await fixture(), other = await person();
    for (const actor of [worker, other]) expect(await changeWaitingJob(schema.db, actor, job.id, revision(job), "edit", input)).toEqual({ status: "forbidden" });
    expect(await changeWaitingJob(schema.db, customer, job.id, "old", "edit", input)).toEqual({ status: "changed" });
    await schema.db.job.update({ where: { id: job.id }, data: { status: "PRICED", priceCents: 10000 } });
    const priced = await schema.db.job.findUniqueOrThrow({ where: { id: job.id } });
    for (const command of ["edit", "cancel"] as const) expect(await changeWaitingJob(schema.db, customer, job.id, revision(priced), command, input)).toEqual({ status: "changed" });
    expect(await schema.db.auditLog.count({ where: { recordId: job.id } })).toBe(0);
    expect(await schema.db.job.findUnique({ where: { id: job.id } })).toMatchObject({ title: job.title, status: "PRICED", editedAt: null });
    await schema.db.profile.update({ where: { id: customer.userId }, data: { role: "TRADIE" } });
    expect(await changeWaitingJob(schema.db, customer, job.id, revision(priced), "edit", input)).toEqual({ status: "forbidden" });
  });
  it("cancels for free through the machine with one history, audit and customer notification", async () => {
    const { customer, job } = await fixture();
    expect(await changeWaitingJob(schema.db, customer, job.id, revision(job), "cancel")).toEqual({ status: "cancelled" });
    expect(await schema.db.job.findUnique({ where: { id: job.id } })).toMatchObject({ status: "CANCELLED" });
    expect(await schema.db.jobStatusHistory.count({ where: { jobId: job.id, toStatus: "CANCELLED" } })).toBe(1);
    expect(await schema.db.auditLog.count({ where: { recordId: job.id, action: "job.cancelled" } })).toBe(1);
    expect(await schema.db.notification.count({ where: { userId: customer.userId, type: "job.cancelled" } })).toBe(1);
    expect(await schema.db.payment.count({ where: { jobId: job.id } })).toBe(0);
  });
  it("never uses the free-cancel dialog to request cancellation when money is already held", async () => {
    const { customer, job } = await fixture();
    await schema.db.payment.create({ data: { jobId: job.id, kind: "QUICK_LOOK", amountCents: 3000, status: "PAID", paidAt: new Date(), idempotencyKey: randomUUID() } });
    expect(await changeWaitingJob(schema.db, customer, job.id, revision(job), "cancel")).toEqual({ status: "changed" });
    expect(await schema.db.job.findUnique({ where: { id: job.id } })).toMatchObject({ status: "REVIEW", updatedAt: job.updatedAt });
    expect(await schema.db.auditLog.count({ where: { recordId: job.id } })).toBe(0);
  });
  it("allows only one of two concurrent saves with the same revision", async () => {
    const { customer, job } = await fixture();
    const results = await Promise.all([input, { ...input, title: "Different title" }].map(value => changeWaitingJob(schema.db, customer, job.id, revision(job), "edit", value)));
    expect(results.map(result => result.status).sort()).toEqual(["changed", "saved"]);
    expect(await schema.db.auditLog.count({ where: { recordId: job.id, action: "job.details_updated" } })).toBe(1);
  });
  it("rechecks a price committed while the edit waits for the job lock", async () => {
    const { customer, job } = await fixture();
    let locked!: () => void, release!: () => void;
    const acquired = new Promise<void>(resolve => { locked = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const pricing = schema.db.$transaction(async tx => {
      await tx.job.update({ where: { id: job.id }, data: { status: "PRICED", priceCents: 10000 } });
      locked(); await gate;
    });
    await acquired;
    const editing = changeWaitingJob(schema.db, customer, job.id, revision(job), "edit", input);
    release(); await pricing;
    expect(await editing).toEqual({ status: "changed" });
    expect(await schema.db.job.findUnique({ where: { id: job.id } })).toMatchObject({ status: "PRICED", title: job.title });
    expect(await schema.db.auditLog.count({ where: { recordId: job.id, action: "job.details_updated" } })).toBe(0);
  });
});
