// Cancellations and disputes (#172, F06), against a real Postgres with the real migrations and a fake Stripe Refunds
// API (no network, no keys), as in refunds-db.test.ts: the open-case list, the case view, each decision, the part
// payout ("What if the worker already did part of the work?"), money-first ordering (a refused refund changes
// nothing; a retry never refunds or pays twice), and resolving a problem report so the sign-off timer carries on.
// Skipped without TEST_DATABASE_URL (docs/TESTING.md); CI provides one.
import { randomUUID } from "node:crypto";

import type Stripe from "stripe";
import { describe, expect, it } from "vitest";

import type { Role } from "@/generated/prisma/client";
import { DISPUTE_MESSAGES } from "@/lib/office-disputes";
import { applyTransition } from "@/server/jobs/status-machine";
import { inboxItem } from "@/server/notifications/inbox";
import { decideDispute, refundRequestId } from "@/server/office/dispute-decisions";
import { loadDisputeCase, loadDisputeList } from "@/server/office/disputes";
import { getOfficeJob, type OfficeJobDatabase } from "@/server/office/job";
import { REFUND_MESSAGES, type RefundsApi } from "@/server/payments/refunds";
import { priceJob } from "@/server/pricing/price-job";
import { autoSignOff } from "@/server/scheduler/rules";

import { testDatabaseUrl, useTestSchema } from "../support/test-db";

/** Stripe, as far as refunds go (see refunds-db.test.ts): one charge per PaymentIntent, idempotent keys, 400 for too much. */
function fakeStripe(onCreate?: () => Promise<void>) {
  const charges = new Map<string, { amount: number; refunded: number }>();
  const answers = new Map<string, Stripe.Refund>();
  const calls: { params: Stripe.RefundCreateParams; key: string }[] = [];
  let refuseNext = false;
  let made = 0;
  const chargeObject = (intent: string) => ({ id: `ch_${intent}`, object: "charge", payment_intent: intent, amount_refunded: charges.get(intent)!.refunded }) as unknown as Stripe.Charge;
  const api: RefundsApi = {
    async create(params, options) {
      const key = String(options.idempotencyKey);
      calls.push({ params, key });
      if (refuseNext) {
        refuseNext = false;
        throw Object.assign(new Error("Refused."), { type: "StripeInvalidRequestError", statusCode: 400, code: "charge_disputed" });
      }
      const replay = answers.get(key);
      if (replay) return replay;
      const intent = String(params.payment_intent);
      const charge = charges.get(intent)!;
      const amount = Number(params.amount);
      if (amount > charge.amount - charge.refunded) throw Object.assign(new Error("Too much."), { type: "StripeInvalidRequestError", statusCode: 400, code: "amount_too_large" });
      charge.refunded += amount;
      const refund = { id: `re_${++made}`, object: "refund", amount, status: "succeeded", payment_intent: intent, charge: chargeObject(intent), metadata: params.metadata } as unknown as Stripe.Refund;
      answers.set(key, refund);
      await onCreate?.();
      return refund;
    },
    async list(params) {
      const intent = String(params.payment_intent);
      const data = [...answers.values()].filter((refund) => refund.payment_intent === intent);
      return { object: "list", data, has_more: false, url: "/v1/refunds" } as unknown as Stripe.ApiList<Stripe.Refund>;
    },
  };
  return { api, calls, open: (intent: string, amount: number) => charges.set(intent, { amount, refunded: 0 }), refunded: (intent: string) => charges.get(intent)!.refunded, refuseNext: () => (refuseNext = true) };
}

describe.skipIf(!testDatabaseUrl)("cancellations and disputes (database, fake Stripe)", () => {
  const schema = useTestSchema(import.meta.filename);
  const NOW = new Date();

  async function person(role: Role = "CUSTOMER", firstName = "Test") {
    const id = randomUUID();
    await schema.db.$executeRawUnsafe(`INSERT INTO auth.users (id) VALUES ($1::uuid)`, id);
    await schema.db.profile.create({ data: { id, email: `${id}@example.nz`, role, firstName, lastName: role === "ADMIN" ? "Office" : role === "TRADIE" ? "Wilson" : "Jones" } });
    return id;
  }

  /**
   * A job priced through the pricing engine, paid in Stripe (the fake holds the charge) and claimed by a tradie, then
   * (by default) asked to be cancelled by its customer, through the status machine as the real cancel does.
   */
  async function paidJob({ cancel = true, extraPayment = 0 }: { cancel?: boolean; extraPayment?: number } = {}) {
    const office = await person("ADMIN", "Matt");
    const customerId = await person("CUSTOMER", "Sarah");
    const workerId = await person("TRADIE", "Jack");
    await schema.db.workerProfile.create({ data: { userId: workerId } });
    const created = await schema.db.job.create({
      data: { customerId, category: "OTHER", title: "Hang a door", description: "Interior door, frame is fine.", addressLine1: "1 Example St", suburb: "Gladstone", city: "Invercargill", anyTime: true },
    });
    const priced = await priceJob(schema.db, { jobId: created.id, minutes: 120, materialsCents: 0, pricedById: office });
    if (!priced.ok) throw new Error("couldn't price");
    await schema.db.job.update({ where: { id: created.id }, data: { status: "ASSIGNED", workerId } });
    const job = await schema.db.job.findUniqueOrThrow({ where: { id: created.id } });
    const stripe = fakeStripe();
    const pay = async (kind: "JOB" | "QUICK_LOOK", amountCents: number) => {
      const intent = `pi_test_${randomUUID()}`;
      stripe.open(intent, amountCents);
      return schema.db.payment.create({ data: { jobId: job.id, kind, amountCents, status: "PAID", paidAt: new Date(), providerPaymentId: intent, idempotencyKey: randomUUID() } });
    };
    const payment = await pay("JOB", job.priceCents!);
    const extra = extraPayment ? await pay("QUICK_LOOK", extraPayment) : null;
    if (cancel) {
      await schema.db.$transaction((tx) =>
        applyTransition(
          tx,
          {
            audit: async (_tx, entry) => {
              await tx.auditLog.create({ data: { actorId: customerId, action: "job.cancel_requested", recordType: "jobs", recordId: job.id, before: entry.before, after: entry.after, reason: entry.reason } });
            },
            notify: async () => {},
          },
          { jobId: job.id, transition: "cancel", actor: { role: "CUSTOMER", userId: customerId }, reason: "Found someone who could come today." },
        ),
      );
    }
    const pricing = await schema.db.jobPricing.findUniqueOrThrow({ where: { jobId: job.id } });
    return { office, customerId, workerId, job, payment, extra, stripe, pricing };
  }

  type Setup = Awaited<ReturnType<typeof paidJob>>;
  const status = async (id: string) => (await schema.db.job.findUniqueOrThrow({ where: { id } })).status;
  const notices = (type: string, jobId: string) => schema.db.notification.findMany({ where: { type, payload: { path: ["jobId"], equals: jobId } }, orderBy: { userId: "asc" } });
  const office = (id: string) => ({ userId: id, role: "ADMIN" as const });
  const signPhoto = async (path: string) => `https://files.example.test/${path}`;

  /** One dialog: one requestId for as long as it's open, sent with every try. */
  function cancellation(setup: Setup, decision: "refund" | "no-refund" | "keep", extra: Record<string, unknown> = {}, refunds: RefundsApi = setup.stripe.api) {
    const requestId = randomUUID();
    const body = { kind: "cancellation", jobId: setup.job.id, decision, note: "Talked to both. Agreed.", requestId, refund: decision === "refund" ? { mode: "full" } : null, partPayoutMinutes: null, ...extra };
    return { requestId, send: () => decideDispute(schema.db, { userId: setup.office }, body, refunds, NOW) };
  }

  it("lists open cancellations and problems oldest first, and only for the office", async () => {
    const older = await paidJob();
    const problem = await paidJob({ cancel: false });
    await schema.db.problemReport.create({ data: { jobId: problem.job.id, reportedById: problem.customerId, topic: "Work not finished", details: "Still loose.", urgent: true } });
    const quiet = await paidJob({ cancel: false });

    const list = await loadDisputeList(schema.db, office(older.office), 1, new Date(Date.now() + 3 * 86_400_000));
    const ids = list!.rows.map((row) => row.jobId);
    expect(ids).toContain(older.job.id);
    expect(ids).toContain(problem.job.id);
    expect(ids).not.toContain(quiet.job.id);
    expect(ids.indexOf(older.job.id)).toBeLessThan(ids.indexOf(problem.job.id));
    expect(list!.rows.find((row) => row.jobId === older.job.id)).toMatchObject({
      kinds: ["cancellation"], kindLabel: "Cancellation", detail: "Found someone who could come today.", customer: "Sarah Jones", tradie: "Jack Wilson",
      paidCents: older.job.priceCents, age: "3d", href: `/admin/disputes/${older.job.id}`,
    });
    expect(list!.rows.find((row) => row.jobId === problem.job.id)).toMatchObject({ kinds: ["problem"], kindLabel: "Urgent problem", detail: "Work not finished" });

    expect(await loadDisputeList(schema.db, { userId: older.customerId, role: "CUSTOMER" }, 1)).toBeNull();
    // A customer who claims to be the office is still refused: the profile decides.
    expect(await loadDisputeList(schema.db, { userId: older.customerId, role: "ADMIN" }, 1)).toBeNull();
  });

  it("reads both sides of a case, the money and the part-payout limit", async () => {
    const setup = await paidJob();
    await schema.db.auditLog.create({ data: { actorId: setup.workerId, action: "job.on_my_way", recordType: "jobs", recordId: setup.job.id } });
    const view = await loadDisputeCase(schema.db, office(setup.office), setup.job.id, NOW, signPhoto);
    expect(view).toMatchObject({
      status: "CANCEL_REVIEW",
      cancellation: { open: true, reason: "Found someone who could come today.", by: "customer", byName: "Sarah Jones", backTo: "ASSIGNED" },
      tradie: { name: "Jack Wilson" },
      money: { paidCents: setup.job.priceCents, refundedCents: 0, payroll: { label: "After sign-off" }, rateCents: setup.pricing.workerRateCents, maxPartMinutes: setup.pricing.minutes },
      hasPayout: false,
    });
    expect(view!.tradieSide.updates.map((update) => update.title)).toEqual(["On my way"]);
    expect(view!.money.payments).toEqual([{ id: setup.payment.id, label: "Job", amountCents: setup.job.priceCents, refundedCents: 0, refundableCents: setup.job.priceCents }]);
    expect(await loadDisputeCase(schema.db, { userId: setup.workerId, role: "TRADIE" }, setup.job.id, NOW, signPhoto)).toBeNull();
  });

  it("Cancel and refund: refunds everything in Stripe first, then cancels, audits, and tells both", async () => {
    const setup = await paidJob({ extraPayment: 3_000 });
    expect(await cancellation(setup, "refund").send()).toEqual({ ok: true, message: "Job cancelled and refunded." });

    expect(setup.stripe.calls).toHaveLength(2);
    expect(await schema.db.payment.findMany({ where: { jobId: setup.job.id }, select: { status: true } })).toEqual([{ status: "REFUNDED" }, { status: "REFUNDED" }]);
    expect(await status(setup.job.id)).toBe("CANCELLED");
    const decision = await schema.db.auditLog.findFirstOrThrow({ where: { recordId: setup.job.id, action: "job.cancel_approved" } });
    expect(decision).toMatchObject({ actorId: setup.office, reason: "Talked to both. Agreed.", after: expect.objectContaining({ status: "CANCELLED", refund: "full" }) });
    const told = await notices("job.cancelled", setup.job.id);
    expect(told.map((row) => row.userId).sort()).toEqual([setup.customerId, setup.workerId].sort());
    expect(inboxItem(told[0])).toMatchObject({ line: "Job cancelled" });
    expect(await notices("payment.refunded", setup.job.id)).toHaveLength(2);
    expect(await schema.db.payout.count({ where: { jobId: setup.job.id } })).toBe(0);

    const view = await loadDisputeCase(schema.db, office(setup.office), setup.job.id, NOW, signPhoto);
    expect(view).toMatchObject({ cancellation: { open: false }, money: { refundedCents: setup.job.priceCents! + 3_000, payroll: { label: "No payout" } } });
    expect(view!.decisions[0]).toMatchObject({ title: "Cancelled and refunded", note: "Talked to both. Agreed.", by: "Matt Office" });
    expect((await loadDisputeList(schema.db, office(setup.office), 1))!.rows.map((row) => row.jobId)).not.toContain(setup.job.id);
  });

  it("What if the worker already did part of the work? Part refund + part payout, queued for payroll", async () => {
    const setup = await paidJob();
    const dialog = cancellation(setup, "refund", { refund: { mode: "partial", paymentId: setup.payment.id, amountCents: 5_000 }, partPayoutMinutes: 30 });
    expect(await dialog.send()).toEqual({ ok: true, message: "Job cancelled and refunded." });

    expect(await schema.db.payment.findUniqueOrThrow({ where: { id: setup.payment.id } })).toMatchObject({ status: "PARTIALLY_REFUNDED", refundedCents: 5_000 });
    expect(await status(setup.job.id)).toBe("CANCELLED");
    const gross = Math.round((30 * setup.pricing.workerRateCents) / 60);
    const holiday = Math.round((gross * setup.pricing.holidayPayBps) / 10_000);
    const payout = await schema.db.payout.findFirstOrThrow({ where: { jobId: setup.job.id } });
    expect(payout).toMatchObject({ workerId: setup.workerId, minutes: 30, rateCents: setup.pricing.workerRateCents, grossCents: gross, holidayPayCents: holiday, status: "QUEUED" });
    expect(await schema.db.auditLog.findFirstOrThrow({ where: { recordId: payout.id, action: "payout.queued" } })).toMatchObject({ reason: "Talked to both. Agreed.", after: expect.objectContaining({ part: true, minutes: 30 }) });
    expect((await notices("payout.queued", setup.job.id)).map((row) => row.userId)).toEqual([setup.workerId]);
    // No bank details yet: the payout waits for them, as a finished job's would.
    expect(await schema.db.notification.count({ where: { type: "payout.details_missing", userId: setup.workerId } })).toBe(1);

    const admin = await getOfficeJob(schema.db as unknown as OfficeJobDatabase, office(setup.office), setup.job.id);
    expect(admin?.money.payroll).toEqual({ label: "Queued", kind: "good" });
    const view = await loadDisputeCase(schema.db, office(setup.office), setup.job.id, NOW, signPhoto);
    expect(view).toMatchObject({ hasPayout: true, money: { payoutMinutes: 30, payoutCents: gross + holiday, maxPartMinutes: 0 } });
    expect(view!.decisions[0].title).toBe("Cancelled with a part refund · tradie paid for part");

    // The same dialog again (its answer was lost): already decided, nothing refunded or paid twice.
    expect(await dialog.send()).toEqual({ ok: true, message: "Job cancelled and refunded." });
    expect(setup.stripe.calls).toHaveLength(1);
    expect(await schema.db.payout.count({ where: { jobId: setup.job.id } })).toBe(1);
  });

  it("refuses a part payout longer than the job, or for a job without a tradie, before any money moves", async () => {
    const setup = await paidJob();
    const tooLong = await cancellation(setup, "refund", { partPayoutMinutes: setup.pricing.minutes + 1 }).send();
    expect(tooLong).toMatchObject({ ok: false, error: "invalid", field: "hours" });
    expect(setup.stripe.calls).toHaveLength(0);
    expect(await status(setup.job.id)).toBe("CANCEL_REVIEW");

    const loose = await paidJob();
    await schema.db.$executeRawUnsafe(`UPDATE "${schema.name}".jobs SET worker_id = NULL WHERE id = $1::uuid`, loose.job.id);
    expect(await cancellation(loose, "no-refund", { partPayoutMinutes: 30 }).send()).toEqual({ ok: false, error: "not-allowed", message: DISPUTE_MESSAGES.noTradie });

    const tooMuch = await cancellation(setup, "refund", { refund: { mode: "partial", paymentId: setup.payment.id, amountCents: setup.job.priceCents! + 1 } }).send();
    expect(tooMuch).toMatchObject({ ok: false, error: "invalid", field: "amount" });
    expect(await cancellation(setup, "refund", { note: " " }).send()).toMatchObject({ ok: false, field: "note", message: "Add a note. It goes on the timeline." });
    expect(setup.stripe.calls).toHaveLength(0);
  });

  it("a refund Stripe refuses changes nothing about the job, and says so", async () => {
    const setup = await paidJob();
    setup.stripe.refuseNext();
    expect(await cancellation(setup, "refund", { partPayoutMinutes: 30 }).send()).toEqual({ ok: false, error: "unavailable", message: REFUND_MESSAGES.refused });
    expect(await status(setup.job.id)).toBe("CANCEL_REVIEW");
    expect(await schema.db.payment.findUniqueOrThrow({ where: { id: setup.payment.id } })).toMatchObject({ status: "PAID", refundedCents: 0 });
    expect(await schema.db.payout.count({ where: { jobId: setup.job.id } })).toBe(0);
    expect(await notices("job.cancelled", setup.job.id)).toHaveLength(0);
    expect(await schema.db.auditLog.count({ where: { recordId: setup.job.id, action: "job.cancel_approved" } })).toBe(0);
  });

  it("when the job moves on during the refund, the refund stays recorded and a retry finishes without refunding twice", async () => {
    let setup: Setup | null = null;
    let moved = false;
    // Someone else acts on the job while Stripe is answering (no lock is held then).
    const stripe = fakeStripe(async () => {
      if (moved || !setup) return;
      moved = true;
      await schema.db.$executeRawUnsafe(`UPDATE "${schema.name}".jobs SET status = 'ASSIGNED' WHERE id = $1::uuid`, setup.job.id);
    });
    setup = await paidJob();
    stripe.open(String(setup.payment.providerPaymentId), setup.payment.amountCents);
    const dialog = cancellation(setup, "refund", {}, stripe.api);
    expect(await dialog.send()).toEqual({ ok: false, error: "changed", message: DISPUTE_MESSAGES.refundedButChanged });
    expect(await status(setup.job.id)).toBe("ASSIGNED");
    expect(await schema.db.payment.findUniqueOrThrow({ where: { id: setup.payment.id } })).toMatchObject({ status: "REFUNDED" });

    // Back for the office to decide; the same dialog tries again: the refund it made is skipped.
    await schema.db.$executeRawUnsafe(`UPDATE "${schema.name}".jobs SET status = 'CANCEL_REVIEW' WHERE id = $1::uuid`, setup.job.id);
    expect(await dialog.send()).toEqual({ ok: true, message: "Job cancelled and refunded." });
    expect(stripe.calls).toHaveLength(1);
    expect(stripe.refunded(String(setup.payment.providerPaymentId))).toBe(setup.payment.amountCents);
    expect(await status(setup.job.id)).toBe("CANCELLED");
    expect(await notices("payment.refunded", setup.job.id)).toHaveLength(1);
    expect(refundRequestId(dialog.requestId, setup.payment.id)).toBe(refundRequestId(dialog.requestId, setup.payment.id));
  });

  it("Cancel, no refund: cancels without asking Stripe", async () => {
    const setup = await paidJob();
    expect(await cancellation(setup, "no-refund").send()).toEqual({ ok: true, message: "Job cancelled." });
    expect(setup.stripe.calls).toHaveLength(0);
    expect(await status(setup.job.id)).toBe("CANCELLED");
    expect(await schema.db.auditLog.findFirstOrThrow({ where: { recordId: setup.job.id, action: "job.cancel_approved" } })).toMatchObject({ after: expect.objectContaining({ refund: "none" }) });
    expect(await notices("job.cancelled", setup.job.id)).toHaveLength(2);
  });

  it("Keep the job going: back to where it was, both told, nothing refunded", async () => {
    const setup = await paidJob();
    expect(await cancellation(setup, "keep").send()).toEqual({ ok: true, message: "Job back on track." });
    expect(await schema.db.job.findUniqueOrThrow({ where: { id: setup.job.id } })).toMatchObject({ status: "ASSIGNED", workerId: setup.workerId });
    expect(await schema.db.auditLog.findFirstOrThrow({ where: { recordId: setup.job.id, action: "job.reinstated" } })).toMatchObject({ reason: "Talked to both. Agreed." });
    const told = await notices("job.reinstated", setup.job.id);
    expect(told.map((row) => row.userId).sort()).toEqual([setup.customerId, setup.workerId].sort());
    expect(setup.stripe.calls).toHaveLength(0);
    // Deciding again from a stale page is refused.
    expect(await cancellation(setup, "no-refund").send()).toEqual({ ok: false, error: "changed", message: DISPUTE_MESSAGES.changed });
  });

  it("only the office decides", async () => {
    const setup = await paidJob();
    const body = { kind: "cancellation", jobId: setup.job.id, decision: "no-refund", note: "Sure.", requestId: randomUUID(), refund: null, partPayoutMinutes: null };
    expect(await decideDispute(schema.db, { userId: setup.customerId }, body, setup.stripe.api, NOW)).toMatchObject({ ok: false, error: "not-allowed" });
    expect(await status(setup.job.id)).toBe("CANCEL_REVIEW");
  });

  it("Resolve a problem with a part refund: the report closes, both are told, and the sign-off timer carries on", async () => {
    const setup = await paidJob({ cancel: false });
    const sent = new Date();
    await schema.db.completionEvidence.create({ data: { jobId: setup.job.id, workerId: setup.workerId, notes: "Door hung.", declaration: "Done.", declaredAt: sent, photos: { create: [{ path: "evidence/door.webp" }] } } });
    await schema.db.jobMaterials.create({ data: { jobId: setup.job.id, budgetCents: 0, spentCents: 0, spentAt: sent } });
    await schema.db.completionEvidence.update({ where: { jobId: setup.job.id }, data: { submittedAt: sent } });
    await schema.db.job.update({ where: { id: setup.job.id }, data: { status: "SUBMITTED" } });
    const report = await schema.db.problemReport.create({
      data: { jobId: setup.job.id, reportedById: setup.customerId, topic: "Work not finished", details: "The door sticks.", photos: { create: [{ path: "problems/door.webp" }] } },
    });
    // The database stamps when the evidence was sent, so run the timer 49 hours later.
    const run = () => autoSignOff.run({ db: schema.db, now: new Date(Date.now() + 49 * 3_600_000), limit: 50 });

    // While the report is open, the timer leaves the job alone.
    await run();
    expect(await status(setup.job.id)).toBe("SUBMITTED");
    const view = await loadDisputeCase(schema.db, office(setup.office), setup.job.id, NOW, signPhoto);
    expect(view!.problems[0]).toMatchObject({ status: "OPEN", reporter: "customer", photos: [{ url: "https://files.example.test/problems/door.webp" }] });
    expect(view!.tradieSide.evidence).toMatchObject({ notes: "Door hung.", photos: [{ url: "https://files.example.test/evidence/door.webp" }] });

    const body = { kind: "problem", jobId: setup.job.id, reportId: report.id, seenStatus: "SUBMITTED", note: "Jack is going back to plane the door.", requestId: randomUUID(), refund: { mode: "partial", paymentId: setup.payment.id, amountCents: 2_000 } };
    expect(await decideDispute(schema.db, { userId: setup.office }, body, setup.stripe.api, NOW)).toEqual({ ok: true, message: "Problem resolved." });
    expect(await schema.db.problemReport.findUniqueOrThrow({ where: { id: report.id } })).toMatchObject({ status: "RESOLVED", resolution: "Jack is going back to plane the door.", resolvedById: setup.office, resolvedAt: expect.any(Date) });
    expect(await schema.db.payment.findUniqueOrThrow({ where: { id: setup.payment.id } })).toMatchObject({ refundedCents: 2_000 });
    expect(await schema.db.auditLog.findFirstOrThrow({ where: { recordId: report.id, action: "problem_report.resolved" } })).toMatchObject({ actorId: setup.office, reason: "Jack is going back to plane the door." });
    const told = await notices("problem_report.resolved", setup.job.id);
    expect(told.map((row) => row.userId).sort()).toEqual([setup.customerId, setup.workerId].sort());
    expect(inboxItem(told[0])).toMatchObject({ line: "Problem resolved", href: `/jobs/${setup.job.id}` });
    // Retrying the same dialog changes nothing more.
    expect(await decideDispute(schema.db, { userId: setup.office }, body, setup.stripe.api, NOW)).toEqual({ ok: true, message: "Problem resolved." });
    expect(setup.stripe.calls).toHaveLength(1);

    await run();
    expect(await status(setup.job.id)).toBe("COMPLETED");
    expect(await schema.db.payout.count({ where: { jobId: setup.job.id, status: "QUEUED" } })).toBe(1);
  });
});
