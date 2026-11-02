import "server-only";

import type Stripe from "stripe";

import type { Payment, PrismaClient } from "@/generated/prisma/client";
import { SYSTEM_ACTOR, createAudit } from "@/server/audit/audit";
import {
  type StatusMachineDeps,
  JobTransitionError,
  applyTransition,
} from "@/server/jobs/status-machine";
import { createNotify } from "@/server/notifications/notify";

// What Stripe's webhook events do to our records (#151). The route (src/app/api/stripe/webhook/route.ts) checks the
// signature; this decides what an event means. Every handler is safe to run twice: Stripe retries, and sends the
// same event more than once, so a replay changes nothing.
//
//   payment_intent.succeeded       PENDING/FAILED → PAID; the job moves PRICED → BOOKABLE through the status machine
//   payment_intent.payment_failed  PENDING → FAILED with Stripe's reason, for the office
//   charge.refunded                records the refund (up to what was paid); PAID → PARTIALLY_REFUNDED / REFUNDED
//   anything else                  ignored (the route still answers 200 so Stripe stops retrying)

export type EventOutcome =
  | "paid"
  | "failed"
  | "refund-recorded"
  /** Replay, or nothing left to change. */
  | "duplicate"
  /** An event type we don't act on, or a payment that isn't ours. */
  | "ignored";

/** The status machine's after-effects for the payment webhook: one audit row and one in-app notification. */
function paidDeps(tx: Parameters<StatusMachineDeps["audit"]>[0], eventId: string): StatusMachineDeps {
  return {
    audit: async (_tx, entry) => {
      await createAudit(tx)(SYSTEM_ACTOR, "job.paid", { type: "jobs", id: entry.recordId }, entry.before, entry.after, entry.reason);
    },
    notify: async (_tx, change) => {
      await createNotify(tx)("job.paid", [change.customerId], {
        eventId: `stripe:${eventId}:job.paid`,
        payload: { jobId: change.jobId, jobNumber: change.jobNumber },
      });
    },
  };
}

async function findPayment(db: Pick<PrismaClient, "payment">, intentId: string, metadata?: Stripe.Metadata | null) {
  const byIntent = await db.payment.findUnique({ where: { providerPaymentId: intentId } });
  if (byIntent) return byIntent;
  // The PaymentIntent was made but saving its id on our row failed: our own metadata finds the row.
  const id = metadata?.paymentId;
  return id ? db.payment.findFirst({ where: { id, providerPaymentId: null } }) : null;
}

const MAX_REASON = 500;

export async function handleStripeEvent(db: PrismaClient, event: Stripe.Event): Promise<EventOutcome> {
  switch (event.type) {
    case "payment_intent.succeeded":
      return onSucceeded(db, event, event.data.object);
    case "payment_intent.payment_failed":
      return onFailed(db, event.data.object);
    case "charge.refunded":
      return onRefunded(db, event.data.object);
    default:
      return "ignored";
  }
}

async function onSucceeded(db: PrismaClient, event: Stripe.Event, intent: Stripe.PaymentIntent): Promise<EventOutcome> {
  const found = await findPayment(db, intent.id, intent.metadata);
  if (!found) {
    console.error("Stripe webhook: a succeeded PaymentIntent matches no payment.", { intent: intent.id });
    return "ignored";
  }
  if (found.status !== "PENDING" && found.status !== "FAILED") return "duplicate";
  const received = intent.amount_received || intent.amount;
  if (received !== found.amountCents || intent.currency.toLowerCase() !== "nzd") {
    // Never record a different amount as the agreed price. The office sees it in the log and sorts it with Stripe.
    console.error("Stripe webhook: the amount paid doesn't match the payment.", { payment: found.id, intent: intent.id });
    return "ignored";
  }

  return db.$transaction(async (tx) => {
    const now = new Date();
    // Conditional, so two copies of the event at once can't both win.
    const updated = await tx.payment.updateMany({
      where: { id: found.id, status: { in: ["PENDING", "FAILED"] } },
      data: { status: "PAID", paidAt: now, failureReason: null, providerPaymentId: intent.id, livemode: event.livemode },
    });
    if (updated.count !== 1) return "duplicate";
    await createAudit(tx)(
      SYSTEM_ACTOR,
      "payment.paid",
      { type: "payments", id: found.id },
      { status: found.status },
      { status: "PAID", amountCents: found.amountCents },
    );

    if (found.kind === "JOB") {
      try {
        await applyTransition(tx, paidDeps(tx, event.id), { jobId: found.jobId, transition: "mark-paid", actor: { role: "SYSTEM", source: "stripe-webhook" } });
      } catch (error) {
        // The money is real but the job isn't waiting for it any more (e.g. cancelled while the customer was paying).
        // Keep the payment as PAID so the office sees it in the ledger and refunds or reinstates.
        if (!(error instanceof JobTransitionError)) throw error;
        console.error("Stripe webhook: paid, but the job couldn't move to booked.", { payment: found.id, code: error.code });
      }
    }
    return "paid";
  });
}

async function onFailed(db: PrismaClient, intent: Stripe.PaymentIntent): Promise<EventOutcome> {
  const found = await findPayment(db, intent.id, intent.metadata);
  if (!found) return "ignored";
  if (found.status !== "PENDING") return "duplicate";
  const reason = (intent.last_payment_error?.message ?? "The payment was declined.").slice(0, MAX_REASON);
  return db.$transaction(async (tx) => {
    const updated = await tx.payment.updateMany({
      where: { id: found.id, status: "PENDING" },
      data: { status: "FAILED", failureReason: reason, providerPaymentId: intent.id },
    });
    if (updated.count !== 1) return "duplicate";
    await createAudit(tx)(SYSTEM_ACTOR, "payment.failed", { type: "payments", id: found.id }, { status: "PENDING" }, { status: "FAILED", failureReason: reason });
    return "failed";
  });
}

async function onRefunded(db: PrismaClient, charge: Stripe.Charge): Promise<EventOutcome> {
  const intentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!intentId) return "ignored";
  const found = await db.payment.findUnique({ where: { providerPaymentId: intentId } });
  if (!found) return "ignored";
  return recordRefund(db, found, charge.amount_refunded);
}

/**
 * `amount_refunded` is Stripe's running total, so a replayed or out-of-order event can't double count: the payment
 * only ever moves up to that total, never past what was paid. Refunds the office already recorded by hand (#171)
 * are included in the total, not added to it.
 */
async function recordRefund(db: PrismaClient, found: Payment, refundedTotal: number): Promise<EventOutcome> {
  if (found.status !== "PAID" && found.status !== "PARTIALLY_REFUNDED") return "ignored";
  const refundedCents = Math.min(refundedTotal, found.amountCents);
  if (refundedCents <= found.refundedCents) return "duplicate";
  const status = refundedCents === found.amountCents ? "REFUNDED" : "PARTIALLY_REFUNDED";
  return db.$transaction(async (tx) => {
    const updated = await tx.payment.updateMany({
      where: { id: found.id, refundedCents: found.refundedCents, status: found.status },
      data: { refundedCents, status, refundedAt: new Date() },
    });
    if (updated.count !== 1) return "duplicate";
    await createAudit(tx)(
      SYSTEM_ACTOR,
      status === "REFUNDED" ? "payment.refunded" : "payment.partially_refunded",
      { type: "payments", id: found.id },
      { status: found.status, refundedCents: found.refundedCents },
      { status, refundedCents },
      "Refunded in Stripe.",
    );
    return "refund-recorded";
  });
}
