import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadCustomerWorkerCard } from "@/server/jobs/customer-worker-card";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

describe.skipIf(!testDatabaseUrl)("owned customer worker-card reads", () => {
  const schema = useTestSchema(import.meta.filename);
  async function person(role: "CUSTOMER" | "TRADIE" | "ADMIN" = "CUSTOMER") {
    const id = randomUUID(), email = `${id}@example.test`;
    await schema.db.$executeRaw`INSERT INTO auth.users(id,email) VALUES(${id}::uuid,${email})`;
    await schema.db.profile.create({ data: { id, email, role, firstName: "Example", lastName: "PrivateLastName" } });
    return { userId: id, role };
  }
  async function fixture() {
    const customer = await person(), worker = await person("TRADIE");
    const job = await schema.db.job.create({ data: { customerId: customer.userId, workerId: worker.userId, category: "OTHER", status: "ASSIGNED", priceCents: 10000, title: "Move the couch", description: "Move the couch upstairs.", addressLine1: "1 Example Street", suburb: "Windsor", city: "Invercargill" } });
    return { customer, worker, job };
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
    const { customer, job } = await fixture(), other = await person(), now = Date.now();
    const put = (type: string, seconds: number, userId = customer.userId, jobId = job.id, lateMinutes: number | null = null) => schema.db.notification.create({ data: { userId, type, payload: { jobId, lateMinutes }, createdAt: new Date(now + seconds * 1000) } });
    await put("job.window_booked", 0); await put("job.reschedule_requested", 1); await put("job.running_late", 2, customer.userId, job.id, 30); await put("job.on_my_way", 3);
    await put("job.reschedule_requested", 4, other.userId); await put("job.reschedule_requested", 5, customer.userId, randomUUID()); await put("job.cancelled", 6);
    const first = await loadCustomerWorkerCard(schema.db, customer, job.id, sign);
    expect(first?.updates.map(item => item.type)).toEqual(["job.on_my_way", "job.running_late", "job.reschedule_requested"]);
    expect(first?.updates[1]).toMatchObject({ label: "Running late", lateMinutes: 30 }); expect(first?.askedForTimes).toBe(false);
    await put("job.reschedule_requested", 7);
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
});
