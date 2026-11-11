import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadCustomerWorkerCard } from "@/server/jobs/customer-worker-card";
import { notificationId } from "@/server/notifications/notify";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

describe.skipIf(!testDatabaseUrl)("owned customer worker-card reads", () => {
  const schema = useTestSchema(import.meta.filename);
  async function person(role: "CUSTOMER" | "TRADIE" | "ADMIN" = "CUSTOMER") {
    const id = randomUUID(), email = `${id}@example.test`;
    await schema.db.$executeRaw`INSERT INTO auth.users(id,email) VALUES(${id}::uuid,${email})`;
    await schema.db.profile.create({ data: { id, email, role, firstName: "Example", lastName: "PrivateLastName" } });
    return { userId: id, role };
  }
  async function fixture(proven = true) {
    const customer = await person(), worker = await person("TRADIE");
    const initial = await schema.db.job.create({ data: { customerId: customer.userId, category: "OTHER", status: "BOOKABLE", priceCents: 10000, title: "Move the couch", description: "Move the couch upstairs.", addressLine1: "1 Example Street", suburb: "Windsor", city: "Invercargill" } });
    const { job, assignedAt } = await schema.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('app.actor_id', ${worker.userId}, true)`;
      const job = await tx.job.update({ where: { id: initial.id }, data: { status: "ASSIGNED", workerId: worker.userId } });
      if (proven) await tx.auditLog.create({ data: { actorId: worker.userId, action: "job.claimed", recordType: "jobs", recordId: job.id, before: { status: "BOOKABLE", workerId: null }, after: { status: "ASSIGNED", workerId: worker.userId } } });
      const history = await tx.jobStatusHistory.findFirstOrThrow({ where: { jobId: job.id, toStatus: "ASSIGNED" }, orderBy: { createdAt: "desc" } });
      return { job, assignedAt: history.createdAt };
    });
    return { customer, worker, job, assignedAt };
  }
  async function recordUpdate(actorId: string, userId: string, jobId: string, type: string, payload: Record<string, string | number | boolean | null> = {}) {
    // Keep these independently committed fixtures outside the excluded boundary millisecond.
    await schema.db.$executeRaw`SELECT pg_sleep(0.002)`;
    return schema.db.$transaction(async tx => {
      const action = type === "job.reschedule_requested" ? "job.times_requested" : type;
      const audit = await tx.auditLog.create({ data: { actorId, action, recordType: "jobs", recordId: jobId, after: { sent: true } } });
      return tx.notification.create({ data: { id: notificationId(`${action}:${audit.id}`, userId), userId, type, payload: { jobId, ...payload } } });
    });
  }
  const sign = async () => null;
  it("refuses another customer, no worker, invalid status and a changed real role", async () => {
    const { customer, worker, job } = await fixture(), other = await person();
    expect(await loadCustomerWorkerCard(schema.db, other, job.id, sign)).toBeNull();
    expect(await loadCustomerWorkerCard(schema.db, worker, job.id, sign)).toBeNull();
    await schema.db.job.update({ where: { id: job.id }, data: { workerId: null, status: "BOOKABLE" } });
    expect(await loadCustomerWorkerCard(schema.db, customer, job.id, sign)).toBeNull();
    await schema.db.job.update({ where: { id: job.id }, data: { workerId: worker.userId, status: "ASSIGNED" } });
    await schema.db.profile.update({ where: { id: customer.userId }, data: { role: "TRADIE" } });
    expect(await loadCustomerWorkerCard(schema.db, customer, job.id, sign)).toBeNull();
  });
  it("reads only this customer's matching job events, newest three, with a newest-only request flag", async () => {
    const { customer, worker, job } = await fixture(), other = await person();
    const put = (type: string, userId = customer.userId, jobId = job.id, lateMinutes: number | null = null) => recordUpdate(worker.userId, userId, jobId, type, { lateMinutes });
    await put("job.window_booked"); await put("job.reschedule_requested"); await put("job.running_late", customer.userId, job.id, 30); await put("job.on_my_way");
    await put("job.reschedule_requested", other.userId); await put("job.reschedule_requested", customer.userId, randomUUID()); await put("job.cancelled");
    const first = await loadCustomerWorkerCard(schema.db, customer, job.id, sign);
    expect(first?.updates.map(item => item.type)).toEqual(["job.on_my_way", "job.running_late", "job.reschedule_requested"]);
    expect(first?.updates[1]).toMatchObject({ label: "Running late", lateMinutes: 30 }); expect(first?.askedForTimes).toBe(false);
    await schema.db.notification.updateMany({ where: { userId: customer.userId }, data: { readAt: new Date() } });
    expect((await loadCustomerWorkerCard(schema.db, customer, job.id, sign))?.updates.map(item => item.id)).toEqual(first?.updates.map(item => item.id));
    await put("job.reschedule_requested");
    expect((await loadCustomerWorkerCard(schema.db, customer, job.id, sign))?.askedForTimes).toBe(true);
  });
  it("counts and averages only this worker's visible reviews, without leaking any raw fields", async () => {
    const { customer, worker, job } = await fixture(), office = await person("ADMIN");
    expect((await loadCustomerWorkerCard(schema.db, customer, job.id, sign))?.rating).toBeNull();
    for (const [rating, hidden] of [[5, false], [4, false], [1, true]] as const) {
      const completed = await schema.db.job.create({ data: { customerId: customer.userId, workerId: worker.userId, category: "OTHER", status: "COMPLETED", priceCents: 10000, title: "Done", description: "Done", addressLine1: "1 Example Street", suburb: "Windsor", city: "Invercargill" } });
      await schema.db.review.create({ data: { jobId: completed.id, reviewerId: customer.userId, workerId: worker.userId, rating, comment: "Not part of this DTO", ...(hidden ? { hiddenAt: new Date(), hiddenById: office.userId, hiddenReason: "Hidden fixture" } : {}) } });
    }
    const result = await loadCustomerWorkerCard(schema.db, customer, job.id, sign);
    expect(result?.rating).toEqual({ average: 4.5, count: 2 });
    expect(JSON.stringify(result)).not.toMatch(/PrivateLastName|Not part|hiddenReason|avatarPath|priceCents|email/);
  });
  it.each(["ASSIGNED", "SUBMITTED", "COMPLETED", "CANCEL_REVIEW"] as const)("allows an owned worker card at %s without relying on Lane B writes", async status => {
    const { customer, job } = await fixture();
    await schema.db.job.update({ where: { id: job.id }, data: { status } });
    expect(await loadCustomerWorkerCard(schema.db, customer, job.id, sign)).not.toBeNull();
  });
  it("does not pair a reassigned worker's card with the previous detail response", async () => {
    const { customer, worker, job } = await fixture(), replacement = await person("TRADIE");
    await schema.db.job.update({ where: { id: job.id }, data: { workerId: replacement.userId } });
    expect(await loadCustomerWorkerCard(schema.db, customer, job.id, sign, undefined, worker.userId)).toBeNull();
    expect(await loadCustomerWorkerCard(schema.db, customer, job.id, sign, undefined, replacement.userId)).not.toBeNull();
  });
  it("does not attribute a pre-claim scheduler notice to the current tradie", async () => {
    const { customer, worker, job, assignedAt } = await fixture();
    const put = (type: string, offset: number, payload = {}) => schema.db.notification.create({ data: { userId: customer.userId, type, payload: { jobId: job.id, ...payload }, createdAt: new Date(assignedAt.getTime() + offset) } });
    await put("job.reschedule_requested", -1000, { refreshWindows: true });
    await put("job.on_my_way", 0); // A timestamp tied with the boundary is not proven newer.
    expect(await loadCustomerWorkerCard(schema.db, customer, job.id, sign)).toMatchObject({ updates: [], askedForTimes: false });
    await recordUpdate(worker.userId, customer.userId, job.id, "job.window_booked"); await recordUpdate(worker.userId, customer.userId, job.id, "job.on_my_way"); await recordUpdate(worker.userId, customer.userId, job.id, "job.running_late", { lateMinutes: 15 }); await recordUpdate(worker.userId, customer.userId, job.id, "job.reschedule_requested");
    const card = await loadCustomerWorkerCard(schema.db, customer, job.id, sign);
    expect(card?.updates.map(update => update.type)).toEqual(["job.reschedule_requested", "job.running_late", "job.on_my_way"]);
    expect(card?.askedForTimes).toBe(true);
  });
  it("cuts off the previous worker's updates at an office reassignment and keeps the new worker's updates", async () => {
    const { customer, worker, job } = await fixture(), replacement = await person("TRADIE"), office = await person("ADMIN");
    await recordUpdate(worker.userId, customer.userId, job.id, "job.reschedule_requested");
    await schema.db.job.update({ where: { id: job.id }, data: { workerId: replacement.userId } });
    await schema.db.auditLog.create({ data: { actorId: office.userId, action: "job.reassigned", recordType: "jobs", recordId: job.id, before: { workerId: worker.userId }, after: { workerId: replacement.userId }, reason: "Fixture reassignment." } });
    expect(await loadCustomerWorkerCard(schema.db, customer, job.id, sign)).toMatchObject({ updates: [], askedForTimes: false });
    await recordUpdate(replacement.userId, customer.userId, job.id, "job.window_booked");
    expect((await loadCustomerWorkerCard(schema.db, customer, job.id, sign))?.updates.map(update => update.type)).toEqual(["job.window_booked"]);
  });
  it("hides unproven historical updates instead of guessing for a legacy assignment", async () => {
    const { customer, worker, job } = await fixture(false);
    await recordUpdate(worker.userId, customer.userId, job.id, "job.reschedule_requested");
    expect(await loadCustomerWorkerCard(schema.db, customer, job.id, sign)).toMatchObject({ updates: [], askedForTimes: false });
  });
  it("keeps the assignment boundary across a status-only office override", async () => {
    const { customer, worker, job } = await fixture(), office = await person("ADMIN");
    await schema.db.auditLog.create({ data: { actorId: office.userId, action: "job.status_overridden", recordType: "jobs", recordId: job.id, before: { status: "ASSIGNED" }, after: { status: "SUBMITTED" }, reason: "Fixture status-only override." } });
    await recordUpdate(worker.userId, customer.userId, job.id, "job.on_my_way");
    expect((await loadCustomerWorkerCard(schema.db, customer, job.id, sign))?.updates.map(update => update.type)).toEqual(["job.on_my_way"]);
  });
  it("hides updates when two assignment proofs have the same timestamp", async () => {
    const { customer, worker, job } = await fixture(), replacement = await person("TRADIE"), office = await person("ADMIN");
    await schema.db.$transaction(async tx => {
      for (const [from, to] of [[worker.userId, replacement.userId], [replacement.userId, worker.userId]]) await tx.auditLog.create({ data: { actorId: office.userId, action: "job.reassigned", recordType: "jobs", recordId: job.id, before: { workerId: from }, after: { workerId: to }, reason: "Fixture tied assignment." } });
    });
    await recordUpdate(worker.userId, customer.userId, job.id, "job.on_my_way");
    expect(await loadCustomerWorkerCard(schema.db, customer, job.id, sign)).toMatchObject({ updates: [], askedForTimes: false });
  });
  it("does not use transaction-start time as proof of the event's worker", async () => {
    const { customer, worker, job } = await fixture(), previous = await person("TRADIE");
    await recordUpdate(previous.userId, customer.userId, job.id, "job.reschedule_requested");
    await schema.db.notification.create({ data: { userId: customer.userId, type: "job.on_my_way", payload: { jobId: job.id } } });
    expect(await loadCustomerWorkerCard(schema.db, customer, job.id, sign)).toMatchObject({ updates: [], askedForTimes: false });
    await recordUpdate(worker.userId, customer.userId, job.id, "job.running_late", { lateMinutes: 30 });
    expect((await loadCustomerWorkerCard(schema.db, customer, job.id, sign))?.updates.map(update => update.type)).toEqual(["job.running_late"]);
  });
  it("hides ambiguous event history when an office assignment returns to a previous worker", async () => {
    const { customer, worker, job } = await fixture(), replacement = await person("TRADIE"), office = await person("ADMIN");
    for (const [from, to] of [[worker.userId, replacement.userId], [replacement.userId, worker.userId]]) {
      await schema.db.job.update({ where: { id: job.id }, data: { workerId: to } });
      await schema.db.auditLog.create({ data: { actorId: office.userId, action: "job.reassigned", recordType: "jobs", recordId: job.id, before: { workerId: from }, after: { workerId: to }, reason: "Fixture returning assignment." } });
    }
    await recordUpdate(worker.userId, customer.userId, job.id, "job.reschedule_requested");
    expect(await loadCustomerWorkerCard(schema.db, customer, job.id, sign)).toMatchObject({ updates: [], askedForTimes: false });
  });
});
