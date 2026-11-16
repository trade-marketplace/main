import "server-only";

import type Stripe from "stripe";

import type { Payment, Prisma, PrismaClient } from "@/generated/prisma/client";
import { ACTION_MESSAGES, type JobActionInput, type JobActionResult, money } from "@/lib/office-job";
import { createAudit, type AuditActor } from "@/server/audit/audit";
import { createNotify } from "@/server/notifications/notify";

// Refunds (#157): the office gives back all or part of a payment, in Stripe (test mode until both founders agree),
// with a required note on the timeline. Three steps, so no database lock is held while Stripe is asked:
//
//  1. In a transaction, under the job's row lock: check what's left on the payment and write a durable
//     `payment.refund_requested` audit entry. Its id is the Stripe idempotency key for this refund.
//  2. Ask Stripe for the refund, with that key. A retry of the same request (same dialog, same `requestId`) finds
//     the same entry and sends the same key, so Stripe answers with the refund it already made: never a second one.
//     Only when Stripe definitely said no is the entry closed (`payment.refund_failed`), so the next try gets a new key.
//  3. In a second transaction: move the payment's `refundedCents` up to the new total, only if the row is as read.
//
// Before a new request gets a new key, any earlier request for the payment that never got an answer (another
// dialog, or one whose key has expired) is looked up in Stripe by its id in the refund's metadata: recorded if Stripe
// made it (and the office is asked to check before refunding more), closed if it didn't. So a lost answer can never
// turn into a second refund under a new key.
//
// Stripe's `charge.refunded` webhook (./webhook-events.ts) records a refund made in the Stripe dashboard, or one whose
// answer was lost after step 2, through the same `recordRefundTotal`. Both only ever move the row up to a running
// total, so whichever lands first records it and the other changes nothing. The customer is told, and the office is
// told when the tradie's payout already went to payroll, in the transaction that moved the row: exactly once.

/** The part of Stripe's Refunds API used here, so tests can hand in a fake (no network in tests). */
export type RefundsApi = {
  create(params: Stripe.RefundCreateParams, options: Stripe.RequestOptions): Promise<Stripe.Refund>;
  list(params: Stripe.RefundListParams): Promise<Stripe.ApiList<Stripe.Refund>>;
};

type Db = Pick<PrismaClient, "$transaction">;
type Tx = Prisma.TransactionClient;
type Office = { userId: string };
type RefundInput = Extract<JobActionInput, { action: "refund" }>;

const REFUNDABLE: readonly string[] = ["PAID", "PARTIALLY_REFUNDED"];
/** Stripe keeps an idempotency key for 24 hours. Past that, a retry is treated as a new refund and checked again. */
const KEY_LIFETIME_MS = 23 * 60 * 60 * 1000;
/** An unanswered request younger than this may still be on its way to Stripe: wait rather than look it up. */
const IN_FLIGHT_MS = 2 * 60 * 1000;

export const REFUND_MESSAGES = {
  notConfigured: "Refunds are made in Stripe, and Stripe isn’t set up here. Nothing was changed.",
  notStripe: "This payment didn’t go through Stripe, so it can’t be refunded here.",
  nothingLeft: "That payment has nothing left to refund.",
  refused: "Stripe didn’t make that refund. Nothing was changed. Check the payment in Stripe, then try again.",
  unconfirmed: "We couldn’t confirm the refund with Stripe. Try again. It won’t be refunded twice.",
  differentRetry: "Your last try at this refund may have gone through. Reload the page and check before changing the amount.",
  inFlight: "An earlier refund for this payment is still going through. Try again in a minute.",
  earlierMade: "An earlier refund for this payment went through, and it’s now recorded. Reload the page and check before refunding more.",
} as const;

const fail = (error: Exclude<JobActionResult, { ok: true }>["error"], message: string, field?: string): JobActionResult => ({
  ok: false,
  error,
  message,
  ...(field ? { field } : {}),
});

/** Thrown inside a transaction to roll it back and answer with a plain result. */
class Refusal extends Error {
  constructor(readonly result: JobActionResult) {
    super("refused");
  }
}

/** One refund in flight: the request entry (its id is the idempotency key) and what it asks Stripe for. */
type OpenRequest = {
  key: string;
  paymentId: string;
  jobId: string;
  intentId: string;
  amountCents: number;
  /** `refundedCents` on the payment when the request was made. */
  fromCents: number;
};

/** The office's refund, start to finish. Never throws: it answers with what to tell the office. */
export async function refundPayment(db: Db, office: Office, input: RefundInput, refunds: RefundsApi | null, now = new Date()): Promise<JobActionResult> {
  if (!refunds) return fail("not-allowed", REFUND_MESSAGES.notConfigured);
  let request: OpenRequest;
  try {
    const earlier = await reconcile(db, office, input, refunds, now);
    if (earlier) return earlier;
    request = await db.$transaction((tx) => openRequest(tx, office, input, now), { timeout: 30_000 });
  } catch (error) {
    if (error instanceof Refusal) return error.result;
    console.error("Refunds: couldn't start a refund.", error);
    return fail("unavailable", ACTION_MESSAGES.unavailable);
  }

  let refund: Stripe.Refund;
  try {
    refund = await refunds.create(
      {
        payment_intent: request.intentId,
        amount: request.amountCents,
        // Ids only: no names, notes or job details go to Stripe.
        metadata: { paymentId: request.paymentId, jobId: request.jobId, refundRequestId: request.key },
        // The charge's running refund total comes back with it, for step 3.
        expand: ["charge"],
      },
      { idempotencyKey: `refund-${request.key}` },
    );
  } catch (error) {
    if (!stripeSaidNo(error)) {
      // Lost connection, Stripe's own error, or a request still running: it may have been made. Keep the key.
      console.error("Refunds: Stripe didn't confirm a refund.", { request: request.key }, error);
      return fail("unavailable", REFUND_MESSAGES.unconfirmed);
    }
    return closeRequest(db, office, request, stripeCode(error));
  }
  if (refund.status === "failed" || refund.status === "canceled") return closeRequest(db, office, request, refund.failure_reason ?? refund.status);

  try {
    await db.$transaction((tx) => settle(tx, office, input.note, request, refund), { timeout: 30_000 });
    return { ok: true };
  } catch (error) {
    if (error instanceof Refusal) return error.result;
    // Stripe made the refund; the webhook records it if we can't. A retry sends the same key and records it here.
    console.error("Refunds: Stripe made a refund but recording it failed.", { request: request.key, refund: refund.id }, error);
    return fail("unavailable", REFUND_MESSAGES.unconfirmed);
  }
}

/** Locks the job's row for this transaction (as every office action does) and says who is acting. */
async function lockJob(tx: Tx, office: Office, jobId: string) {
  await tx.$queryRaw`SELECT set_config('app.actor_id', ${office.userId}, true)`;
  const locked = await tx.job.updateMany({ where: { id: jobId }, data: { updatedAt: new Date() } });
  if (locked.count !== 1) throw new Refusal(fail("not-found", ACTION_MESSAGES.notFound));
  return tx.job.findUniqueOrThrow({ where: { id: jobId }, select: { id: true, status: true } });
}

/** Step 1. Reuses this request's open entry when there is one; otherwise checks the amount and writes a new one. */
async function openRequest(tx: Tx, office: Office, input: RefundInput, now: Date): Promise<OpenRequest> {
  const job = await lockJob(tx, office, input.jobId);
  const payment = await tx.payment.findFirst({ where: { id: input.paymentId, jobId: job.id } });
  if (!payment) throw new Refusal(fail("invalid", "Pick a payment.", "paymentId"));
  const base = { paymentId: payment.id, jobId: job.id, intentId: payment.providerPaymentId ?? "" };

  const earlier = await openEntry(tx, payment.id, input.requestId, now);
  if (earlier) {
    const same = earlier.mode === input.mode && (input.mode === "full" || earlier.amountCents === input.amountCents);
    if (!same) throw new Refusal(fail("changed", REFUND_MESSAGES.differentRetry));
    return { ...base, key: earlier.id, amountCents: earlier.amountCents, fromCents: earlier.fromCents };
  }

  if (job.status !== input.seenStatus) throw new Refusal(fail("changed", ACTION_MESSAGES.changed));
  if (!REFUNDABLE.includes(payment.status)) throw new Refusal(fail("not-allowed", REFUND_MESSAGES.nothingLeft));
  const left = payment.amountCents - payment.refundedCents;
  const giving = input.mode === "full" ? left : (input.amountCents ?? 0);
  if (giving < 1) throw new Refusal(fail("not-allowed", REFUND_MESSAGES.nothingLeft));
  if (giving > left) throw new Refusal(fail("invalid", `You can refund up to ${money(left)} of this payment.`, "amount"));
  if (!payment.providerPaymentId) throw new Refusal(fail("not-allowed", REFUND_MESSAGES.notStripe));

  const entry = await createAudit(tx)(
    office,
    "payment.refund_requested",
    { type: "payments", id: payment.id },
    null,
    { requestId: input.requestId, mode: input.mode, amountCents: giving, fromCents: payment.refundedCents },
    input.note,
  );
  return { ...base, key: entry.id, amountCents: giving, fromCents: payment.refundedCents };
}

/** The newest request entry for this dialog's `requestId`, unless Stripe said no to it or its key has expired. */
async function openEntry(tx: Tx, paymentId: string, requestId: string, now: Date) {
  const [entry] = await tx.auditLog.findMany({
    where: {
      action: "payment.refund_requested",
      recordType: "payments",
      recordId: paymentId,
      after: { path: ["requestId"], equals: requestId },
      createdAt: { gte: new Date(now.getTime() - KEY_LIFETIME_MS) },
    },
    orderBy: { createdAt: "desc" },
    take: 1,
  });
  if (!entry || (await resolvedRequests(tx, paymentId)).has(entry.id)) return null;
  return requestOf(entry);
}

function requestOf(entry: { id: string; after: Prisma.JsonValue; reason: string | null }) {
  const after = (entry.after ?? {}) as Record<string, unknown>;
  const amountCents = typeof after.amountCents === "number" ? after.amountCents : 0;
  const fromCents = typeof after.fromCents === "number" ? after.fromCents : 0;
  return { id: entry.id, mode: after.mode, requestId: after.requestId, amountCents, fromCents, reason: entry.reason };
}

/** Request entries that have an answer: Stripe said no, it was recorded, or it was confirmed already recorded. */
async function resolvedRequests(tx: Tx, paymentId: string): Promise<Set<string>> {
  const answers = await tx.auditLog.findMany({
    where: {
      recordType: "payments",
      recordId: paymentId,
      action: { in: ["payment.refund_failed", "payment.refund_confirmed", "payment.refunded", "payment.partially_refunded"] },
    },
    select: { after: true },
  });
  const ids = new Set<string>();
  for (const { after } of answers) {
    const data = (after ?? {}) as Record<string, unknown>;
    for (const id of [data.requestEntryId, data.refundRequestId]) if (typeof id === "string") ids.add(id);
  }
  return ids;
}

/**
 * Before a request that would get a new key: every earlier request for this payment that never got an answer
 * (other than the one this dialog will send again with its own key) is looked up in Stripe. Made: it's recorded and
 * the office is asked to check before refunding more. Not made: it's closed. Answers null to carry on.
 */
async function reconcile(db: Db, office: Office, input: RefundInput, refunds: RefundsApi, now: Date): Promise<JobActionResult | null> {
  const found = await db.$transaction(async (tx) => {
    const payment = await tx.payment.findFirst({ where: { id: input.paymentId, jobId: input.jobId }, select: { id: true, providerPaymentId: true } });
    if (!payment?.providerPaymentId) return null;
    const resolved = await resolvedRequests(tx, payment.id);
    const entries = await tx.auditLog.findMany({
      where: { action: "payment.refund_requested", recordType: "payments", recordId: payment.id },
      select: { id: true, after: true, reason: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    const reusable = (await openEntry(tx, payment.id, input.requestId, now))?.id;
    const pending = entries.filter((entry) => !resolved.has(entry.id) && entry.id !== reusable);
    return pending.length ? { intentId: payment.providerPaymentId, paymentId: payment.id, pending } : null;
  });
  if (!found) return null;
  if (found.pending.some((entry) => now.getTime() - entry.createdAt.getTime() < IN_FLIGHT_MS)) return fail("unavailable", REFUND_MESSAGES.inFlight);

  let made: Stripe.Refund[];
  try {
    made = (await refunds.list({ payment_intent: found.intentId, limit: 100, expand: ["data.charge"] })).data;
  } catch (error) {
    console.error("Refunds: couldn't check earlier refunds with Stripe.", { payment: found.paymentId }, error);
    return fail("unavailable", REFUND_MESSAGES.unconfirmed);
  }

  let recorded = false;
  for (const entry of found.pending) {
    const earlier = requestOf(entry);
    const refund = made.find((one) => one.metadata?.refundRequestId === entry.id && one.status !== "failed" && one.status !== "canceled");
    const request: OpenRequest = { key: entry.id, paymentId: found.paymentId, jobId: input.jobId, intentId: found.intentId, amountCents: earlier.amountCents, fromCents: earlier.fromCents };
    await db.$transaction(async (tx) => {
      if (!refund) {
        await lockJob(tx, office, input.jobId);
        await createAudit(tx)(office, "payment.refund_failed", { type: "payments", id: found.paymentId }, null, { requestEntryId: entry.id, code: "not_made" });
        return;
      }
      if (await settle(tx, office, earlier.reason ?? input.note, request, refund)) {
        recorded = true;
      } else {
        await createAudit(tx)(office, "payment.refund_confirmed", { type: "payments", id: found.paymentId }, null, { requestEntryId: entry.id, providerRefundId: refund.id });
      }
    }, { timeout: 30_000 });
  }
  return recorded ? fail("changed", REFUND_MESSAGES.earlierMade) : null;
}

/** Stripe answered and the refund wasn't made: close the request so the next try is checked again with a new key. */
async function closeRequest(db: Db, office: Office, request: OpenRequest, code: string): Promise<JobActionResult> {
  try {
    await db.$transaction((tx) =>
      createAudit(tx)(office, "payment.refund_failed", { type: "payments", id: request.paymentId }, null, { requestEntryId: request.key, code: code.slice(0, 100) }),
    );
  } catch (error) {
    // The entry stays open: the next try sends the same key and gets Stripe's same answer. Nothing was refunded.
    console.error("Refunds: couldn't log a refund Stripe refused.", { request: request.key }, error);
  }
  return fail("unavailable", REFUND_MESSAGES.refused);
}

/** Step 3: records the refund Stripe made, unless the webhook (or an earlier try) already did. True when it recorded it. */
async function settle(tx: Tx, office: Office, reason: string, request: OpenRequest, refund: Stripe.Refund): Promise<boolean> {
  await lockJob(tx, office, request.jobId);
  const charge = typeof refund.charge === "object" && refund.charge !== null ? refund.charge : null;
  // Stripe's running total for the charge. Our own count (what we had, plus this one) covers a total Stripe didn't send.
  const stripeTotal = charge?.amount_refunded ?? 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: request.paymentId } });
    const total = Math.min(payment.amountCents, Math.max(stripeTotal, request.fromCents + request.amountCents));
    if (payment.refundedCents >= total) return false;
    const extra = { providerRefundId: refund.id, refundRequestId: request.key };
    if (await recordRefundTotal(tx, payment, total, office, reason, extra)) return true;
    // The webhook moved the row between our read and our write: read it again.
  }
  throw new Refusal(fail("changed", ACTION_MESSAGES.changed));
}

/**
 * Moves a payment's `refundedCents` up to `refundedCents` (a running total, never past what was paid), only if the
 * row is still as `payment` says. Then, in the same transaction: the audit entry, the customer's notification and,
 * when the tradie's payout was already sent to payroll or paid, a flag for the office. Payout rows are never changed
 * here: payroll adjusts them. Answers false (and does nothing) when the row had moved.
 */
export async function recordRefundTotal(
  tx: Tx,
  payment: Pick<Payment, "id" | "jobId" | "amountCents" | "refundedCents" | "status">,
  refundedCents: number,
  actor: AuditActor,
  reason: string,
  extra: Record<string, string> = {},
): Promise<boolean> {
  if (refundedCents <= payment.refundedCents || refundedCents > payment.amountCents) return false;
  const status = refundedCents === payment.amountCents ? "REFUNDED" : "PARTIALLY_REFUNDED";
  const updated = await tx.payment.updateMany({
    where: { id: payment.id, refundedCents: payment.refundedCents, status: payment.status },
    data: { refundedCents, status, refundedAt: new Date() },
  });
  if (updated.count !== 1) return false;

  const job = await tx.job.findUniqueOrThrow({ where: { id: payment.jobId }, select: { id: true, jobNumber: true, customerId: true } });
  const paidOut = await tx.payout.findMany({
    where: { jobId: job.id, status: { in: ["EXPORTED", "PAID"] } },
    select: { id: true, status: true },
    orderBy: { createdAt: "asc" },
  });
  const payroll = paidOut.map((payout) => ({ payoutId: payout.id, status: payout.status }));
  await createAudit(tx)(
    actor,
    status === "REFUNDED" ? "payment.refunded" : "payment.partially_refunded",
    { type: "payments", id: payment.id },
    { status: payment.status, refundedCents: payment.refundedCents },
    { status, refundedCents, ...extra, ...(payroll.length ? { payrollAdjustment: payroll } : {}) },
    reason,
  );

  // Keyed by the new total: the office's step 3 and the webhook can't both get here for the same refund, and a
  // replay of either lands on the same notification.
  const eventId = `payment.refunded:${payment.id}:${refundedCents}`;
  const payload = { jobId: job.id, jobNumber: job.jobNumber };
  await createNotify(tx)("payment.refunded", [job.customerId], { eventId, payload: { ...payload, amountCents: refundedCents - payment.refundedCents } });
  if (payroll.length) {
    const office = await tx.profile.findMany({ where: { role: "ADMIN" }, select: { id: true } });
    await createNotify(tx)("payout.adjustment_needed", office.map((person) => person.id), { eventId: `${eventId}:payroll`, payload });
  }
  return true;
}

/**
 * True when Stripe answered and definitely didn't make the refund (a 4xx: bad amount, already refunded, unknown
 * payment, bad key, rate limited). Not for a lost connection, Stripe's own 5xx, a request still running (409) or an
 * idempotency mismatch: those may have refunded, so the same key must be sent again.
 */
function stripeSaidNo(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { statusCode, type } = error as { statusCode?: unknown; type?: unknown };
  return typeof statusCode === "number" && statusCode >= 400 && statusCode < 500 && statusCode !== 409 && type !== "StripeIdempotencyError";
}

function stripeCode(error: unknown): string {
  const { code, statusCode } = error as { code?: unknown; statusCode?: unknown };
  return typeof code === "string" && code ? code : `http_${String(statusCode)}`;
}
