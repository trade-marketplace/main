import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { declineCustomerPrice } from "@/server/jobs/customer-price";
import { priceJob } from "@/server/pricing/price-job";
import { transitionJob } from "@/server/jobs/status-machine";
import { loadCustomerJobPage } from "@/server/jobs/customer-page";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

describe.skipIf(!testDatabaseUrl)("customer price commands", () => {
  const schema = useTestSchema(import.meta.filename), effects = { audit: async () => {}, notify: async () => {} };
  async function person(role: "CUSTOMER" | "ADMIN" = "CUSTOMER") {
    const id = randomUUID(), email = `${id}@example.test`;
    await schema.db.$executeRaw`INSERT INTO auth.users(id,email) VALUES(${id}::uuid,${email})`;
    await schema.db.profile.create({ data: { id, email, role, firstName: "Customer" } });
    return { userId: id, role };
  }
  async function fixture() {
    const customer = await person(), office = await person("ADMIN");
    const job = await schema.db.job.create({ data: { customerId: customer.userId, category: "OTHER", title: "Move the couch", description: "Move the couch upstairs.", addressLine1: "1 Example Street", suburb: "Windsor", city: "Invercargill" } });
    expect((await priceJob(schema.db, { jobId: job.id, minutes: 60, materialsCents: 0 })).ok).toBe(true);
    await transitionJob(schema.db, effects, { jobId: job.id, transition: "send-price", actor: office });
    return { customer, job: await schema.db.job.findUniqueOrThrow({ where: { id: job.id } }) };
  }
  it.each([null, "Too expensive"])("closes for free, records optional reason %s, audit and customer notification once", async reason => {
    const { customer, job } = await fixture();
    expect(await declineCustomerPrice(schema.db, customer, job.id, job.updatedAt.toISOString(), reason)).toEqual({ status: "declined" });
    expect(await schema.db.job.findUnique({ where: { id: job.id } })).toMatchObject({ status: "CANCELLED" });
    expect(await schema.db.auditLog.findMany({ where: { recordId: job.id } })).toMatchObject([{ action: "job.cancelled", reason: reason ?? "No thanks", after: { decline: { reason } } }]);
    expect(await schema.db.notification.count({ where: { userId: customer.userId, type: "job.cancelled" } })).toBe(1);
    expect(await schema.db.payment.count({ where: { jobId: job.id } })).toBe(0);
  });
  it.each([null, "Changed my mind"])("lets the machine request review for held quick-look funds with optional reason %s", async reason => {
    const { customer, job } = await fixture();
    const payment = await schema.db.payment.create({ data: { jobId: job.id, kind: "QUICK_LOOK", amountCents: 3000, status: "PAID", paidAt: new Date(), idempotencyKey: randomUUID() } });
    expect(await declineCustomerPrice(schema.db, customer, job.id, job.updatedAt.toISOString(), reason)).toEqual({ status: "declined" });
    expect(await schema.db.job.findUnique({ where: { id: job.id } })).toMatchObject({ status: "CANCEL_REVIEW" });
    expect(await schema.db.payment.findUnique({ where: { id: payment.id } })).toEqual(payment);
    expect(await schema.db.auditLog.findMany({ where: { recordId: job.id } })).toMatchObject([{ action: "job.cancel_requested", after: { decline: { reason } } }]);
  });
  it("refuses foreign ownership, current role changes and invalid reasons without side effects", async () => {
    const { customer, job } = await fixture(), other = await person();
    expect(await declineCustomerPrice(schema.db, other, job.id, job.updatedAt.toISOString(), null)).toEqual({ status: "forbidden" });
    expect(await declineCustomerPrice(schema.db, customer, job.id, job.updatedAt.toISOString(), "arbitrary text")).toEqual({ status: "invalid" });
    await schema.db.profile.update({ where: { id: customer.userId }, data: { role: "TRADIE" } });
    expect(await declineCustomerPrice(schema.db, customer, job.id, job.updatedAt.toISOString(), null)).toEqual({ status: "forbidden" });
    expect(await schema.db.job.findUnique({ where: { id: job.id } })).toMatchObject({ status: "PRICED", updatedAt: job.updatedAt });
    expect(await schema.db.auditLog.count({ where: { recordId: job.id } })).toBe(0);
  });
  it("returns changed for stale revision or an already-paid job without cancelling or auditing", async () => {
    const { customer, job } = await fixture();
    expect(await declineCustomerPrice(schema.db, customer, job.id, "old", null)).toEqual({ status: "changed" });
    await schema.db.payment.create({ data: { jobId: job.id, kind: "JOB", amountCents: job.priceCents!, status: "PAID", paidAt: new Date(), idempotencyKey: randomUUID() } });
    await transitionJob(schema.db, effects, { jobId: job.id, transition: "mark-paid", actor: { role: "SYSTEM", source: "test" } });
    const paid = await schema.db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(await declineCustomerPrice(schema.db, customer, job.id, job.updatedAt.toISOString(), null)).toEqual({ status: "changed" });
    expect(await schema.db.job.findUnique({ where: { id: job.id } })).toEqual(paid);
    expect(await schema.db.auditLog.count({ where: { recordId: job.id } })).toBe(0);
  });
  it("serializes two declines so only one transition, audit and notification commit", async () => {
    const { customer, job } = await fixture();
    const results = await Promise.all(["Too expensive", null].map(reason => declineCustomerPrice(schema.db, customer, job.id, job.updatedAt.toISOString(), reason)));
    expect(results.map(result => result.status).sort()).toEqual(["changed", "declined"]);
    expect(await schema.db.auditLog.count({ where: { recordId: job.id } })).toBe(1);
    expect(await schema.db.notification.count({ where: { userId: customer.userId, type: "job.cancelled" } })).toBe(1);
  });
  it("returns no previous price because publishing cannot re-price a PRICED job", async () => {
    const { customer, job } = await fixture();
    expect(await loadCustomerJobPage(schema.db, customer, job.id)).toMatchObject({ state: "ready", previousPriceCents: null, job: { previousPriceCents: null } });
  });
});
