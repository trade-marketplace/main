// Refunds (#157), against a real Postgres with the real migrations and a fake Stripe Refunds API (no network, no
// keys): the office's refund in Stripe, retries that never refund twice, the webhook recording a dashboard refund
// exactly once, the customer's notification, and the payroll flag when the payout was already sent or paid.
// Skipped without TEST_DATABASE_URL (docs/TESTING.md); CI provides one.
import { randomUUID } from "node:crypto";

import type Stripe from "stripe";
import { describe, expect, it } from "vitest";

import type { JobStatus, PayoutStatus, Role } from "@/generated/prisma/client";
import { getOfficeJob, type OfficeJobDatabase } from "@/server/office/job";
import { performJobAction } from "@/server/office/job-mutations";
import { inboxItem } from "@/server/notifications/inbox";
import { REFUND_MESSAGES, type RefundsApi } from "@/server/payments/refunds";
import { handleStripeEvent } from "@/server/payments/webhook-events";

import { testDatabaseUrl, useTestSchema } from "../support/test-db";

/**
 * Stripe, as far as refunds go: each PaymentIntent has one charge with a running `amount_refunded`; a key that was
 * used before gets the first answer back (idempotency); more than what's left is refused with a 400.
 */
function fakeStripe() {
  const charges = new Map<string, { amount: number; refunded: number }>();
  const answers = new Map<string, Stripe.Refund>();
  const calls: { params: Stripe.RefundCreateParams; key: string }[] = [];
  let next: "refused" | "lost" | "dropped" | null = null;
  const lists: string[] = [];
  let made = 0;
  const chargeOf = (intent: string) => {
    const charge = charges.get(intent);
    if (!charge) throw new Error(`No charge for ${intent}`);
    return charge;
  };
  const chargeObject = (intent: string) => ({ id: `ch_${intent}`, object: "charge", payment_intent: intent, amount_refunded: chargeOf(intent).refunded }) as unknown as Stripe.Charge;

  const api: RefundsApi = {
    async create(params, options) {
      const key = String(options.idempotencyKey);
      calls.push({ params, key });
      const failure = next;
      next = null;
      if (failure === "refused") throw Object.assign(new Error("Refused."), { type: "StripeInvalidRequestError", statusCode: 400, code: "charge_disputed" });
      // The connection dropped before Stripe got the request: nothing was made.
      if (failure === "dropped") throw Object.assign(new Error("Connection dropped."), { type: "StripeConnectionError" });
      const replay = answers.get(key);
      if (replay) return replay;
      const intent = String(params.payment_intent);
      const charge = chargeOf(intent);
      const amount = Number(params.amount);
      if (amount > charge.amount - charge.refunded) throw Object.assign(new Error("Too much."), { type: "StripeInvalidRequestError", statusCode: 400, code: "amount_too_large" });
      charge.refunded += amount;
      const refund = { id: `re_${++made}`, object: "refund", amount, status: "succeeded", payment_intent: intent, charge: chargeObject(intent), metadata: params.metadata } as unknown as Stripe.Refund;
      answers.set(key, refund);
      // Made at Stripe, but the answer never reached us.
      if (failure === "lost") throw Object.assign(new Error("Connection lost."), { type: "StripeConnectionError" });
      return refund;
    },
    async list(params) {
      const intent = String(params.payment_intent);
      lists.push(intent);
      const data = [...answers.values()].filter((refund) => refund.payment_intent === intent).map((refund) => ({ ...refund, charge: chargeObject(intent) }));
      return { object: "list", data, has_more: false, url: "/v1/refunds" } as unknown as Stripe.ApiList<Stripe.Refund>;
    },
  };
  return {
    api,
    calls,
    lists,
    open: (intent: string, amount: number) => charges.set(intent, { amount, refunded: 0 }),
    refunded: (intent: string) => chargeOf(intent).refunded,
    failNext: (failure: "refused" | "lost" | "dropped") => (next = failure),
    /** Someone refunds in the Stripe dashboard: the charge.refunded event Stripe would send. */
    dashboardRefund(intent: string, amount: number) {
      chargeOf(intent).refunded += amount;
      return chargeEvent(intent);
    },
    chargeEvent,
  };
  function chargeEvent(intent: string) {
    return { id: `evt_${randomUUID()}`, type: "charge.refunded", livemode: false, data: { object: chargeObject(intent) } } as unknown as Stripe.Event;
  }
}

describe.skipIf(!testDatabaseUrl)("refunds (database, fake Stripe)", () => {
  const schema = useTestSchema(import.meta.filename);

  async function person(role: Role = "CUSTOMER", firstName = "Test") {
    const id = randomUUID();
    await schema.db.$executeRawUnsafe(`INSERT INTO auth.users (id) VALUES ($1::uuid)`, id);
    await schema.db.profile.create({ data: { id, email: `${id}@example.nz`, role, firstName, lastName: role } });
    return id;
  }

  /** A paid job with a tradie on it, its Stripe payment, and the fake Stripe holding the charge. */
  async function paidJob(status: JobStatus = "ASSIGNED", amountCents = 12_000) {
    const workerId = await person("TRADIE", "Aroha");
    await schema.db.workerProfile.create({ data: { userId: workerId } });
    const job = await schema.db.job.create({
      data: {
        customerId: await person(),
        category: "OTHER",
        title: "Hang a door",
        description: "Interior door, frame is fine.",
        addressLine1: "1 Example St",
        suburb: "Gladstone",
        city: "Invercargill",
        status,
        priceCents: amountCents,
        workerId,
      },
    });
    const intent = `pi_test_${randomUUID()}`;
    const payment = await schema.db.payment.create({
      data: { jobId: job.id, kind: "JOB", amountCents, status: "PAID", paidAt: new Date(), providerPaymentId: intent, idempotencyKey: randomUUID() },
    });
    const stripe = fakeStripe();
    stripe.open(intent, amountCents);
    return { job, payment, intent, stripe, workerId };
  }

  const stored = (id: string) => schema.db.payment.findUniqueOrThrow({ where: { id } });
  const audits = (recordId: string) => schema.db.auditLog.findMany({ where: { recordId }, orderBy: { createdAt: "asc" } });
  /** This job's notifications of one type (the schema is shared by every test in the file). */
  const notices = (type: string, jobId: string) => schema.db.notification.findMany({ where: { type, payload: { path: ["jobId"], equals: jobId } } });
  const read = (id: string) => getOfficeJob(schema.db as unknown as OfficeJobDatabase, { userId: "office", role: "ADMIN" }, id);

  /** The dialog: one requestId for as long as it's open, sent with every try. */
  function dialog(office: string, setup: Awaited<ReturnType<typeof paidJob>>, refunds: RefundsApi | null = setup.stripe.api) {
    const requestId = randomUUID();
    return (mode: "full" | "partial", amountCents: number | null = null, note = "Work not done.", now = new Date()) =>
      performJobAction(
        schema.db,
        { userId: office },
        { action: "refund", jobId: setup.job.id, seenStatus: setup.job.status, paymentId: setup.payment.id, mode, amountCents, note, requestId },
        now,
        null,
        refunds,
      );
  }

  it("refunds in full in Stripe, records it with the note, and tells the customer once", async () => {
    const office = await person("ADMIN", "Matt");
    const setup = await paidJob();
    expect(await dialog(office, setup)("full")).toEqual({ ok: true });

    expect(setup.stripe.calls).toHaveLength(1);
    const [requested, refunded] = await audits(setup.payment.id);
    expect(setup.stripe.calls[0]).toEqual({
      params: expect.objectContaining({ payment_intent: setup.intent, amount: 12_000, metadata: { paymentId: setup.payment.id, jobId: setup.job.id, refundRequestId: requested.id } }),
      key: `refund-${requested.id}`,
    });
    expect(requested).toMatchObject({ action: "payment.refund_requested", actorId: office, reason: "Work not done.", after: expect.objectContaining({ amountCents: 12_000, mode: "full" }) });
    expect(refunded).toMatchObject({ action: "payment.refunded", actorId: office, reason: "Work not done.", after: expect.objectContaining({ refundedCents: 12_000, providerRefundId: "re_1" }) });
    expect(refunded.after).not.toHaveProperty("payrollAdjustment");
    expect(await stored(setup.payment.id)).toMatchObject({ status: "REFUNDED", refundedCents: 12_000, refundedAt: expect.any(Date) });

    const [notice] = await notices("payment.refunded", setup.job.id);
    expect(await notices("payment.refunded", setup.job.id)).toHaveLength(1);
    expect(notice).toMatchObject({ userId: setup.job.customerId, payload: { jobId: setup.job.id, jobNumber: setup.job.jobNumber, amountCents: 12_000 } });
    expect(inboxItem(notice)).toMatchObject({ line: "Refund on its way", href: "/profile/payments" });

    const view = await read(setup.job.id);
    expect(view?.money.refundedCents).toBe(12_000);
    expect(view?.payments).toEqual([]);
    expect(view?.timeline[0]).toMatchObject({ title: "Refunded $120.00", detail: "Work not done." });
    // The status machine and the job are left alone.
    expect(await schema.db.job.findUniqueOrThrow({ where: { id: setup.job.id } })).toMatchObject({ status: "ASSIGNED" });
  });

  it("refunds part, then a second part up to what's left, and refuses more than that without asking Stripe", async () => {
    const office = await person("ADMIN");
    const setup = await paidJob();
    expect(await dialog(office, setup)("partial", 5_000)).toEqual({ ok: true });
    expect(await stored(setup.payment.id)).toMatchObject({ status: "PARTIALLY_REFUNDED", refundedCents: 5_000 });
    expect((await audits(setup.payment.id)).map((entry) => entry.action)).toEqual(["payment.refund_requested", "payment.partially_refunded"]);

    expect(await dialog(office, setup)("partial", 7_001)).toMatchObject({ ok: false, error: "invalid", field: "amount", message: "You can refund up to $70.00 of this payment." });
    expect(setup.stripe.calls).toHaveLength(1);
    expect(await stored(setup.payment.id)).toMatchObject({ refundedCents: 5_000 });

    expect(await dialog(office, setup)("partial", 7_000)).toEqual({ ok: true });
    expect(await stored(setup.payment.id)).toMatchObject({ status: "REFUNDED", refundedCents: 12_000 });
    expect(setup.stripe.refunded(setup.intent)).toBe(12_000);

    expect(await dialog(office, setup)("full")).toMatchObject({ ok: false, error: "not-allowed", message: REFUND_MESSAGES.nothingLeft });
    expect(await dialog(office, setup)("partial", 1)).toMatchObject({ ok: false, error: "not-allowed" });
    expect(setup.stripe.calls).toHaveLength(2);
    expect(await audits(setup.payment.id)).toHaveLength(4);
    expect((await notices("payment.refunded", setup.job.id)).map((row) => (row.payload as { amountCents: number }).amountCents).sort()).toEqual([5_000, 7_000]);
  });

  it("leaves our records as they were when Stripe says no, and a retry with a fresh key works", async () => {
    const office = await person("ADMIN");
    const setup = await paidJob();
    const send = dialog(office, setup);
    setup.stripe.failNext("refused");
    expect(await send("partial", 4_000)).toEqual({ ok: false, error: "unavailable", message: REFUND_MESSAGES.refused });
    expect(await stored(setup.payment.id)).toMatchObject({ status: "PAID", refundedCents: 0, refundedAt: null });
    expect(await notices("payment.refunded", setup.job.id)).toHaveLength(0);
    const [first, failed] = await audits(setup.payment.id);
    expect(failed).toMatchObject({ action: "payment.refund_failed", after: { requestEntryId: first.id, code: "charge_disputed" } });

    expect(await send("partial", 4_000)).toEqual({ ok: true });
    expect(setup.stripe.calls.map((call) => call.key)).toEqual([`refund-${first.id}`, expect.not.stringMatching(first.id)]);
    expect(await stored(setup.payment.id)).toMatchObject({ status: "PARTIALLY_REFUNDED", refundedCents: 4_000 });
    expect(setup.stripe.refunded(setup.intent)).toBe(4_000);
    expect(await notices("payment.refunded", setup.job.id)).toHaveLength(1);
  });

  it("refunds once when the answer was lost: the retry sends the same key, and a later webhook changes nothing", async () => {
    const office = await person("ADMIN");
    const setup = await paidJob();
    const send = dialog(office, setup);
    setup.stripe.failNext("lost");
    expect(await send("partial", 3_000)).toEqual({ ok: false, error: "unavailable", message: REFUND_MESSAGES.unconfirmed });
    expect(await stored(setup.payment.id)).toMatchObject({ status: "PAID", refundedCents: 0 });
    expect(setup.stripe.refunded(setup.intent)).toBe(3_000);

    // Changing the amount on a refund that may have gone through is refused, and Stripe isn't asked.
    expect(await send("partial", 3_500)).toMatchObject({ ok: false, error: "changed", message: REFUND_MESSAGES.differentRetry });
    expect(setup.stripe.calls).toHaveLength(1);

    expect(await send("partial", 3_000)).toEqual({ ok: true });
    const [key, replay] = setup.stripe.calls.map((call) => call.key);
    expect(replay).toBe(key);
    expect(setup.stripe.refunded(setup.intent)).toBe(3_000);
    expect(await stored(setup.payment.id)).toMatchObject({ status: "PARTIALLY_REFUNDED", refundedCents: 3_000 });

    expect(await handleStripeEvent(schema.db, setup.stripe.chargeEvent(setup.intent))).toBe("duplicate");
    expect(await stored(setup.payment.id)).toMatchObject({ refundedCents: 3_000 });
    expect(await notices("payment.refunded", setup.job.id)).toHaveLength(1);
    expect((await audits(setup.payment.id)).map((entry) => entry.action)).toEqual(["payment.refund_requested", "payment.partially_refunded"]);
  });

  describe("an answer lost, then a new dialog (or the same one after Stripe forgot the key)", () => {
    const later = (minutes: number) => new Date(Date.now() + minutes * 60_000);

    it("waits while the earlier request may still be on its way", async () => {
      const office = await person("ADMIN");
      const setup = await paidJob();
      setup.stripe.failNext("lost");
      await dialog(office, setup)("partial", 3_000);
      expect(await dialog(office, setup)("partial", 3_000)).toEqual({ ok: false, error: "unavailable", message: REFUND_MESSAGES.inFlight });
      expect(setup.stripe.calls).toHaveLength(1);
      expect(setup.stripe.refunded(setup.intent)).toBe(3_000);
    });

    it("finds the earlier refund in Stripe, records it once, and makes no second one", async () => {
      const office = await person("ADMIN");
      const setup = await paidJob();
      setup.stripe.failNext("lost");
      await dialog(office, setup)("partial", 3_000, "Damaged frame.");
      expect(await dialog(office, setup)("partial", 3_000, "Trying again.", later(3))).toEqual({ ok: false, error: "changed", message: REFUND_MESSAGES.earlierMade });
      expect(setup.stripe.calls).toHaveLength(1);
      expect(setup.stripe.lists).toEqual([setup.intent]);
      expect(setup.stripe.refunded(setup.intent)).toBe(3_000);
      expect(await stored(setup.payment.id)).toMatchObject({ status: "PARTIALLY_REFUNDED", refundedCents: 3_000 });
      const recorded = (await audits(setup.payment.id)).find((entry) => entry.action === "payment.partially_refunded");
      expect(recorded).toMatchObject({ reason: "Damaged frame.", after: expect.objectContaining({ providerRefundId: "re_1" }) });
      expect(await notices("payment.refunded", setup.job.id)).toHaveLength(1);

      // Now it's answered, a new refund goes ahead as normal.
      expect(await dialog(office, setup)("partial", 1_000, "More.", later(4))).toEqual({ ok: true });
      expect(setup.stripe.refunded(setup.intent)).toBe(4_000);
      expect(await stored(setup.payment.id)).toMatchObject({ refundedCents: 4_000 });
    });

    it("confirms an earlier refund the webhook already recorded, and carries on", async () => {
      const office = await person("ADMIN");
      const setup = await paidJob();
      setup.stripe.failNext("lost");
      await dialog(office, setup)("partial", 3_000);
      expect(await handleStripeEvent(schema.db, setup.stripe.chargeEvent(setup.intent))).toBe("refund-recorded");
      expect(await dialog(office, setup)("partial", 2_000, "More.", later(3))).toEqual({ ok: true });
      expect((await audits(setup.payment.id)).map((entry) => entry.action)).toContain("payment.refund_confirmed");
      expect(setup.stripe.refunded(setup.intent)).toBe(5_000);
      expect(await stored(setup.payment.id)).toMatchObject({ refundedCents: 5_000 });
    });

    it("closes an earlier request Stripe never got, and the new one goes ahead once", async () => {
      const office = await person("ADMIN");
      const setup = await paidJob();
      setup.stripe.failNext("dropped");
      expect(await dialog(office, setup)("full")).toMatchObject({ ok: false, message: REFUND_MESSAGES.unconfirmed });
      expect(await dialog(office, setup)("full", null, "Again.", later(3))).toEqual({ ok: true });
      const actions = (await audits(setup.payment.id)).map((entry) => entry.action);
      expect(actions).toEqual(["payment.refund_requested", "payment.refund_failed", "payment.refund_requested", "payment.refunded"]);
      expect(setup.stripe.refunded(setup.intent)).toBe(12_000);
      expect(await notices("payment.refunded", setup.job.id)).toHaveLength(1);
    });

    it("never sends an expired key again: the same dialog a day later is checked in Stripe first", async () => {
      const office = await person("ADMIN");
      const setup = await paidJob();
      const send = dialog(office, setup);
      setup.stripe.failNext("lost");
      await send("partial", 3_000);
      expect(await send("partial", 3_000, "Work not done.", later(24 * 60))).toEqual({ ok: false, error: "changed", message: REFUND_MESSAGES.earlierMade });
      expect(setup.stripe.calls).toHaveLength(1);
      expect(setup.stripe.refunded(setup.intent)).toBe(3_000);
      expect(await stored(setup.payment.id)).toMatchObject({ refundedCents: 3_000 });
    });
  });

  it("records once when the webhook lands before the retry", async () => {
    const office = await person("ADMIN");
    const setup = await paidJob();
    const send = dialog(office, setup);
    setup.stripe.failNext("lost");
    await send("full");
    expect(await handleStripeEvent(schema.db, setup.stripe.chargeEvent(setup.intent))).toBe("refund-recorded");
    expect(await stored(setup.payment.id)).toMatchObject({ status: "REFUNDED", refundedCents: 12_000 });

    // The office tries again: the same key, nothing more refunded or recorded.
    expect(await send("full")).toEqual({ ok: true });
    expect(new Set(setup.stripe.calls.map((call) => call.key)).size).toBe(1);
    expect(setup.stripe.refunded(setup.intent)).toBe(12_000);
    expect(await notices("payment.refunded", setup.job.id)).toHaveLength(1);
    expect((await audits(setup.payment.id)).filter((entry) => entry.action === "payment.refunded")).toHaveLength(1);
  });

  it("records a refund made in the Stripe dashboard from the webhook alone, once, and a replay changes nothing", async () => {
    const setup = await paidJob();
    const event = setup.stripe.dashboardRefund(setup.intent, 2_500);
    expect(await handleStripeEvent(schema.db, event)).toBe("refund-recorded");
    expect(await stored(setup.payment.id)).toMatchObject({ status: "PARTIALLY_REFUNDED", refundedCents: 2_500 });
    const [entry] = await audits(setup.payment.id);
    expect(entry).toMatchObject({ action: "payment.partially_refunded", actorId: null, reason: "Refunded in Stripe." });
    expect(await notices("payment.refunded", setup.job.id)).toHaveLength(1);

    expect(await handleStripeEvent(schema.db, event)).toBe("duplicate");
    expect(await handleStripeEvent(schema.db, setup.stripe.chargeEvent(setup.intent))).toBe("duplicate");
    expect(await stored(setup.payment.id)).toMatchObject({ refundedCents: 2_500 });
    expect(await audits(setup.payment.id)).toHaveLength(1);
    expect(await notices("payment.refunded", setup.job.id)).toHaveLength(1);
  });

  describe("what if the payout was already made?", () => {
    async function withPayout(status: PayoutStatus | null) {
      const setup = await paidJob("COMPLETED");
      if (status) {
        await schema.db.payout.create({
          data: {
            jobId: setup.job.id,
            workerId: setup.workerId,
            minutes: 120,
            rateCents: 3_800,
            grossCents: 7_600,
            holidayPayCents: 608,
            status,
            exportedAt: status === "QUEUED" ? null : new Date(),
            paidAt: status === "PAID" ? new Date() : null,
          },
        });
      }
      return setup;
    }

    it.each(["EXPORTED", "PAID"] as const)("still refunds, and flags it for payroll to every office user when the payout is %s", async (status) => {
      const office = await person("ADMIN", "Matt");
      const other = await person("ADMIN", "William");
      const setup = await withPayout(status);
      const payout = await schema.db.payout.findFirstOrThrow({ where: { jobId: setup.job.id } });

      expect(await dialog(office, setup)("partial", 2_000)).toEqual({ ok: true });
      expect(await stored(setup.payment.id)).toMatchObject({ refundedCents: 2_000 });
      const recorded = (await audits(setup.payment.id)).find((entry) => entry.action === "payment.partially_refunded");
      expect(recorded?.after).toMatchObject({ payrollAdjustment: [{ payoutId: payout.id, status }] });

      const flags = await notices("payout.adjustment_needed", setup.job.id);
      expect(flags.map((row) => row.userId)).toEqual(expect.arrayContaining([office, other]));
      expect(await schema.db.notification.count({ where: { type: "payout.adjustment_needed", userId: setup.job.customerId } })).toBe(0);
      expect(flags[0].payload).toEqual({ jobId: setup.job.id, jobNumber: setup.job.jobNumber });
      expect(inboxItem(flags[0])).toMatchObject({ line: "Payroll adjustment needed", href: `/admin/jobs/${setup.job.id}` });
      // The payout itself is never changed here: payroll adjusts it.
      expect(await schema.db.payout.findUniqueOrThrow({ where: { id: payout.id } })).toEqual(payout);
    });

    it.each([["QUEUED"], [null]] as const)("doesn't flag payroll when the payout is %s", async (status) => {
      const office = await person("ADMIN");
      const setup = await withPayout(status);
      expect(await dialog(office, setup)("full")).toEqual({ ok: true });
      expect(await notices("payout.adjustment_needed", setup.job.id)).toHaveLength(0);
      const recorded = (await audits(setup.payment.id)).find((entry) => entry.action === "payment.refunded");
      expect(recorded?.after).not.toHaveProperty("payrollAdjustment");
    });

    it("flags payroll for a dashboard refund too", async () => {
      await person("ADMIN");
      const setup = await withPayout("PAID");
      expect(await handleStripeEvent(schema.db, setup.stripe.dashboardRefund(setup.intent, 1_000))).toBe("refund-recorded");
      expect((await notices("payout.adjustment_needed", setup.job.id)).length).toBeGreaterThan(0);
    });
  });

  it("refuses when Stripe isn't set up, and changes nothing", async () => {
    const office = await person("ADMIN");
    const setup = await paidJob();
    expect(await dialog(office, setup, null)("full")).toEqual({ ok: false, error: "not-allowed", message: REFUND_MESSAGES.notConfigured });
    expect(await stored(setup.payment.id)).toMatchObject({ status: "PAID", refundedCents: 0 });
    expect(await audits(setup.payment.id)).toHaveLength(0);
    expect(await notices("payment.refunded", setup.job.id)).toHaveLength(0);
  });

  it("refuses a payment that isn't paid, isn't on this job, or never went through Stripe", async () => {
    const office = await person("ADMIN");
    const setup = await paidJob();
    const other = await paidJob();
    const unpaid = await schema.db.payment.create({ data: { jobId: setup.job.id, kind: "QUICK_LOOK", amountCents: 3_000, idempotencyKey: randomUUID() } });
    // Paid, but with no PaymentIntent on it (made by hand): there's nothing to refund in Stripe.
    const manual = await schema.db.payment.update({ where: { id: other.payment.id }, data: { providerPaymentId: null } });
    const send = (paymentId: string) =>
      performJobAction(
        schema.db,
        { userId: office },
        { action: "refund", jobId: setup.job.id, seenStatus: "ASSIGNED", paymentId, mode: "full", amountCents: null, note: "Refund", requestId: randomUUID() },
        new Date(),
        null,
        setup.stripe.api,
      );
    expect(await send(unpaid.id)).toMatchObject({ ok: false, error: "not-allowed" });
    expect(await send(other.payment.id)).toMatchObject({ ok: false, field: "paymentId" });
    expect(setup.stripe.calls).toHaveLength(0);
    expect(await stored(other.payment.id)).toMatchObject({ status: "PAID", refundedCents: 0 });
    const sendOther = performJobAction(
      schema.db,
      { userId: office },
      { action: "refund", jobId: other.job.id, seenStatus: "ASSIGNED", paymentId: manual.id, mode: "full", amountCents: null, note: "Refund", requestId: randomUUID() },
      new Date(),
      null,
      other.stripe.api,
    );
    expect(await sendOther).toMatchObject({ ok: false, error: "not-allowed", message: REFUND_MESSAGES.notStripe });
    expect(other.stripe.calls).toHaveLength(0);
  });

  it("refuses a stale view of the job", async () => {
    const office = await person("ADMIN");
    const setup = await paidJob();
    const result = await performJobAction(
      schema.db,
      { userId: office },
      { action: "refund", jobId: setup.job.id, seenStatus: "BOOKABLE", paymentId: setup.payment.id, mode: "full", amountCents: null, note: "Refund", requestId: randomUUID() },
      new Date(),
      null,
      setup.stripe.api,
    );
    expect(result).toMatchObject({ ok: false, error: "changed" });
    expect(setup.stripe.calls).toHaveLength(0);
  });
});
