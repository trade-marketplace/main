import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { declineCustomerPrice } from "@/server/jobs/customer-price";
import { priceJob } from "@/server/pricing/price-job";
import { transitionJob } from "@/server/jobs/status-machine";
import { loadCustomerJobPage } from "@/server/jobs/customer-page";
import { preparePayment, startPayment, type PaymentIntentsApi } from "@/server/payments/payments";
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
  // #516: saying no is free, so no checkout the customer left open may still take the money afterwards.
  function fakeStripe(status = "requires_payment_method", createDelayMs = 0) {
    const state = { id: `pi_test_${randomUUID()}`, status, created: 0, cancelled: 0 };
    const intent = () => ({ id: state.id, client_secret: `${state.id}_secret`, livemode: false, status: state.status }) as unknown as Stripe.PaymentIntent;
    const api: PaymentIntentsApi = {
      create: async () => { if (createDelayMs) await new Promise(resolve => setTimeout(resolve, createDelayMs)); state.created++; return intent(); },
      retrieve: async () => intent(),
      // Like Stripe: a confirmed PaymentIntent can't be cancelled, and a cancelled one can never be paid.
      cancel: async () => { if (state.status === "succeeded" || state.status === "processing") throw new Error("This PaymentIntent can't be cancelled."); state.cancelled++; state.status = "canceled"; return intent(); },
    };
    return { api, state };
  }
  async function openCheckout(stripe: ReturnType<typeof fakeStripe>) {
    const data = await fixture();
    const started = await startPayment(schema.db, stripe.api, data.customer.userId, { jobId: data.job.id });
    if (!started.ok) throw new Error("The payment didn't start.");
    expect(await preparePayment(schema.db, stripe.api, data.customer.userId, started.paymentId)).toMatchObject({ ok: true, paid: false });
    // Starting and preparing a payment never moves the job, so the page's revision is still good.
    expect((await schema.db.job.findUniqueOrThrow({ where: { id: data.job.id } })).updatedAt).toEqual(data.job.updatedAt);
    return { ...data, paymentId: started.paymentId };
  }
  it("cancels an open checkout at Stripe before closing the job, and it can't be opened again", async () => {
    const stripe = fakeStripe(), { customer, job, paymentId } = await openCheckout(stripe);
    expect(await declineCustomerPrice(schema.db, customer, job.id, job.updatedAt.toISOString(), null, stripe.api)).toEqual({ status: "declined" });
    expect(stripe.state).toMatchObject({ created: 1, cancelled: 1, status: "canceled" });
    expect(await schema.db.job.findUnique({ where: { id: job.id } })).toMatchObject({ status: "CANCELLED" });
    expect(await schema.db.payment.findUnique({ where: { id: paymentId } })).toMatchObject({ status: "FAILED", failureReason: "The price was declined before it was paid." });
    expect((await schema.db.auditLog.findMany({ where: { recordId: paymentId }, select: { action: true } })).map(row => row.action)).toContain("payment.failed");
    expect(await preparePayment(schema.db, stripe.api, customer.userId, paymentId)).toMatchObject({ ok: false, error: "not-payable" });
    expect(stripe.state.created).toBe(1);
  });
  it.each(["processing", "succeeded"])("leaves the job as it is when the payment is already %s", async status => {
    const stripe = fakeStripe(), { customer, job, paymentId } = await openCheckout(stripe);
    stripe.state.status = status;
    expect(await declineCustomerPrice(schema.db, customer, job.id, job.updatedAt.toISOString(), "Too expensive", stripe.api)).toEqual({ status: "paying" });
    expect(stripe.state.cancelled).toBe(0);
    expect(await schema.db.job.findUnique({ where: { id: job.id } })).toMatchObject({ status: "PRICED", updatedAt: job.updatedAt });
    expect(await schema.db.payment.findUnique({ where: { id: paymentId } })).toMatchObject({ status: "PENDING" });
    expect(await schema.db.auditLog.count({ where: { recordId: job.id } })).toBe(0);
    expect(await schema.db.notification.count({ where: { userId: customer.userId, type: "job.cancelled" } })).toBe(0);
  });
  it("leaves the job as it is when the card is confirmed while we are cancelling", async () => {
    const stripe = fakeStripe(), { customer, job, paymentId } = await openCheckout(stripe);
    const cancel = stripe.api.cancel;
    stripe.api.cancel = async id => { stripe.state.status = "processing"; return cancel(id); };
    expect(await declineCustomerPrice(schema.db, customer, job.id, job.updatedAt.toISOString(), null, stripe.api)).toEqual({ status: "paying" });
    expect(await schema.db.job.findUnique({ where: { id: job.id } })).toMatchObject({ status: "PRICED" });
    expect(await schema.db.payment.findUnique({ where: { id: paymentId } })).toMatchObject({ status: "PENDING" });
  });
  it("doesn't guess when Stripe can't be asked about an open checkout", async () => {
    const stripe = fakeStripe(), { customer, job, paymentId } = await openCheckout(stripe);
    expect(await declineCustomerPrice(schema.db, customer, job.id, job.updatedAt.toISOString(), null, null)).toEqual({ status: "unavailable" });
    expect(await schema.db.job.findUnique({ where: { id: job.id } })).toMatchObject({ status: "PRICED" });
    expect(await schema.db.payment.findUnique({ where: { id: paymentId } })).toMatchObject({ status: "PENDING" });
  });
  it("retires a checkout that never reached Stripe, and it can't reach Stripe afterwards", async () => {
    const stripe = fakeStripe(), { customer, job } = await fixture();
    const started = await startPayment(schema.db, null, customer.userId, { jobId: job.id });
    if (!started.ok) throw new Error("The payment didn't start.");
    expect(await declineCustomerPrice(schema.db, customer, job.id, job.updatedAt.toISOString(), null, null)).toEqual({ status: "declined" });
    expect(await schema.db.payment.findUnique({ where: { id: started.paymentId } })).toMatchObject({ status: "FAILED", providerPaymentId: null });
    expect(await preparePayment(schema.db, stripe.api, customer.userId, started.paymentId)).toMatchObject({ ok: false, error: "not-payable" });
    expect(stripe.state.created).toBe(0);
  });
  it("waits for a card form that is opening, then cancels the checkout it made", async () => {
    const stripe = fakeStripe("requires_payment_method", 300), { customer, job } = await fixture();
    const started = await startPayment(schema.db, stripe.api, customer.userId, { jobId: job.id });
    if (!started.ok) throw new Error("The payment didn't start.");
    const preparing = preparePayment(schema.db, stripe.api, customer.userId, started.paymentId);
    await new Promise(resolve => setTimeout(resolve, 100)); // the card form is now waiting on Stripe, holding the job's lock
    const declined = await declineCustomerPrice(schema.db, customer, job.id, job.updatedAt.toISOString(), null, stripe.api);
    expect(await preparing).toMatchObject({ ok: true, paid: false });
    expect(declined).toEqual({ status: "declined" });
    expect(stripe.state).toMatchObject({ created: 1, cancelled: 1, status: "canceled" });
    expect(await schema.db.job.findUnique({ where: { id: job.id } })).toMatchObject({ status: "CANCELLED" });
    expect(await schema.db.payment.findUnique({ where: { id: started.paymentId } })).toMatchObject({ status: "FAILED", providerPaymentId: stripe.state.id });
  });
  it("cancels a failed card's checkout too, because it could still be paid", async () => {
    const stripe = fakeStripe(), { customer, job, paymentId } = await openCheckout(stripe);
    await schema.db.payment.update({ where: { id: paymentId }, data: { status: "FAILED", failureReason: "Your card was declined." } });
    expect(await declineCustomerPrice(schema.db, customer, job.id, job.updatedAt.toISOString(), null, stripe.api)).toEqual({ status: "declined" });
    expect(stripe.state).toMatchObject({ cancelled: 1, status: "canceled" });
    expect(await schema.db.payment.findUnique({ where: { id: paymentId } })).toMatchObject({ status: "FAILED", failureReason: "Your card was declined." });
  });
  it("returns no previous price because publishing cannot re-price a PRICED job", async () => {
    const { customer, job } = await fixture();
    expect(await loadCustomerJobPage(schema.db, customer, job.id)).toMatchObject({ state: "ready", previousPriceCents: null, job: { previousPriceCents: null } });
  });
});
