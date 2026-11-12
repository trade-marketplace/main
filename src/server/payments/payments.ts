import "server-only";

import { randomUUID } from "node:crypto";

import type Stripe from "stripe";

import type { PaymentKind, Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  type PaymentErrorCode,
  type PaymentFailure,
  type PreparePaymentResult,
  type StartPaymentResult,
  paymentFailure,
  payPath,
} from "@/lib/payments/results";
import { createAudit } from "@/server/audit/audit";
import { databaseSchema } from "@/server/database-client";
import { customerJobListView, JOB_SUMMARY_SELECT } from "@/server/views/jobs";
import { startVariationPayment, prepareVariationPayment } from "./variation-payment";

// Taking a payment (#151): the customer's payment row, and the Stripe PaymentIntent behind it.
//
//  1. `startPayment`   makes (or reuses) the PENDING Payment row for the job's frozen price. No Stripe call.
//  2. `preparePayment` makes (or reuses) the PaymentIntent for that row and hands back its client secret. The
//                      row's idempotency key goes to Stripe, so a retry can never create a second PaymentIntent.
//  3. The browser confirms the card with Stripe's Payment Element. The money is only recorded as received when
//     Stripe's webhook says so (./webhook-events.ts), never because the browser said it worked.
//
// The amount always comes from the database (`jobs.price_cents`, set when the office priced it and frozen once
// paid, or `variations.price_cents`), never from the browser. Currency is NZD.

/** The part of Stripe's PaymentIntents API used here, so tests can hand in a fake (no network in tests). */
export type PaymentIntentsApi = {
  create(params: Stripe.PaymentIntentCreateParams, options: Stripe.RequestOptions): Promise<Stripe.PaymentIntent>;
  retrieve(id: string): Promise<Stripe.PaymentIntent>;
  cancel(id: string): Promise<Stripe.PaymentIntent>;
};

export const PAYMENT_CURRENCY = "nzd";

/** Job statuses a customer can pay the job's price in. */
const PAYABLE_JOB_STATUSES = ["PRICED"] as const;

export type StartPaymentInput = { jobId: string; variationId?: string | null; variationRevision?: number };

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

/**
 * Makes the payment row the checkout opens (`/pay/[paymentId]`). Only the job's own customer; only while the job
 * is at the right stage. If there is already a payment waiting, that one is reused, so double-clicking "Accept & pay"
 * never makes two. If the price changed since, the old one is retired and a fresh one made.
 */
export async function startPayment(
  db: PrismaClient,
  intents: PaymentIntentsApi | null,
  customerId: string,
  input: StartPaymentInput,
): Promise<StartPaymentResult> {
  if (input.variationId) return startVariationPayment(db, intents, customerId, input);
  const job = await db.job.findFirst({
    where: { id: input.jobId, customerId },
    select: { id: true, status: true, priceCents: true },
  });
  if (!job) return paymentFailure("not-found");

  const kind = "JOB" as const;
  if (!(PAYABLE_JOB_STATUSES as readonly string[]).includes(job.status)) return paymentFailure("not-payable");
  if (!job.priceCents || job.priceCents <= 0) return paymentFailure("not-payable");
  const amountCents = job.priceCents;
  const liveWhere = { jobId: job.id, kind, status: { not: "FAILED" as const } };

  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = await db.payment.findFirst({ where: liveWhere, orderBy: { createdAt: "desc" } });
    if (existing) {
      if (existing.status !== "PENDING") return paymentFailure("already-paid");
      if (existing.amountCents === amountCents) return { ok: true, paymentId: existing.id, href: payPath(existing.id) };
      // The price moved since the payment was made: retire it (and its PaymentIntent) and start again.
      await retirePayment(db, intents, existing.id, existing.providerPaymentId, "The price changed before it was paid.");
    }
    try {
      const created = await db.$transaction(async (tx) => {
        const payment = await tx.payment.create({
          data: {
            jobId: job.id,
            kind,
            variationId: null,
            amountCents,
            idempotencyKey: `payment-${randomUUID()}`,
          },
        });
        await createAudit(tx)(
          { userId: customerId },
          "payment.created",
          { type: "payments", id: payment.id },
          null,
          { status: payment.status, amountCents: payment.amountCents, kind: payment.kind },
        );
        return payment;
      });
      return { ok: true, paymentId: created.id, href: payPath(created.id) };
    } catch (error) {
      // Two clicks at once: the other one won. Go round again and reuse theirs.
      if (isUniqueViolation(error) && attempt === 0) continue;
      throw error;
    }
  }
  return paymentFailure("unavailable");
}

/** Marks a waiting payment FAILED (so a new one may be made) and cancels its PaymentIntent, best effort. */
async function retirePayment(
  db: PrismaClient,
  intents: PaymentIntentsApi | null,
  paymentId: string,
  providerPaymentId: string | null,
  reason: string,
): Promise<void> {
  await db.payment.updateMany({ where: { id: paymentId, status: "PENDING" }, data: { status: "FAILED", failureReason: reason } });
  if (providerPaymentId && intents) {
    try {
      await intents.cancel(providerPaymentId);
    } catch (error) {
      // Already succeeded, cancelled or gone: nothing to undo. A succeeded one is picked up by the webhook.
      console.error("Payments: couldn't cancel the old PaymentIntent.", error);
    }
  }
}

/**
 * The job's row lock, shared with declining a price and every status change. A waiting payment is retired under
 * it, and a PaymentIntent is only made under it, so neither can slip past the other (#516).
 */
async function lockJobRow(db: PrismaClient, tx: Prisma.TransactionClient, jobId: string): Promise<void> {
  const relation = `"${databaseSchema(db).replaceAll('"', '""')}".jobs`;
  await tx.$queryRawUnsafe(`SELECT id FROM ${relation} WHERE id = $1::uuid FOR UPDATE`, jobId);
}

/** "retired": nothing can be charged any more. "paying": Stripe has, or is taking, the money. "unverified": we couldn't ask Stripe. */
export type RetireJobPaymentsResult = "retired" | "paying" | "unverified";

/**
 * Call under the job's row lock, before a priced job stops being payable (the customer says no to the price).
 * Every checkout that could still take the job's price is cancelled at Stripe first, and only then marked FAILED
 * here, so the customer can never be charged after being told that saying no is free (#516). A failed card's
 * PaymentIntent can still be confirmed, so those are cancelled too. If Stripe already has the money, or is taking
 * it, nothing is cancelled and the caller must leave the job as it is: the webhook will record the payment.
 */
export async function retireJobPayments(
  tx: Prisma.TransactionClient,
  intents: PaymentIntentsApi | null,
  actor: { userId: string },
  jobId: string,
  reason: string,
): Promise<RetireJobPaymentsResult> {
  const waiting = await tx.payment.findMany({
    where: { jobId, kind: "JOB", status: { in: ["PENDING", "FAILED"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true, status: true, providerPaymentId: true },
  });
  for (const payment of waiting) {
    if (payment.providerPaymentId) {
      if (!intents) return "unverified";
      let current: Stripe.PaymentIntent;
      try {
        current = await intents.retrieve(payment.providerPaymentId);
      } catch (error) {
        console.error("Payments: couldn't check a PaymentIntent before retiring its payment.", error);
        return "unverified";
      }
      if (current.status === "succeeded" || current.status === "processing") return "paying";
      if (current.status !== "canceled") {
        try {
          if ((await intents.cancel(current.id)).status !== "canceled") return "paying";
        } catch (error) {
          // Stripe refuses to cancel one that was confirmed in the meantime: the money is on its way.
          console.error("Payments: couldn't cancel a PaymentIntent before retiring its payment.", error);
          return "paying";
        }
      }
    }
    if (payment.status === "PENDING") {
      await tx.payment.update({ where: { id: payment.id }, data: { status: "FAILED", failureReason: reason } });
      await createAudit(tx)(actor, "payment.failed", { type: "payments", id: payment.id }, { status: "PENDING" }, { status: "FAILED" });
    }
  }
  return "retired";
}

/**
 * Gets the card form ready for one payment: the PaymentIntent's client secret. Only the job's customer.
 * Reuses the PaymentIntent already saved on the row; makes one (with the row's idempotency key) if there isn't.
 * Runs under the job's row lock, and re-reads the payment and the job there: once the customer has said no to the
 * price (which retires the payment under the same lock), no PaymentIntent can be made for it (#516).
 */
export async function preparePayment(
  db: PrismaClient,
  intents: PaymentIntentsApi,
  customerId: string,
  paymentId: string,
): Promise<PreparePaymentResult> {
  const found = await db.payment.findFirst({
    where: { id: paymentId, job: { customerId } },
    select: { kind: true, jobId: true },
  });
  if (!found) return paymentFailure("not-found");
  if (found.kind === "VARIATION") return prepareVariationPayment(db, intents, customerId, paymentId);

  return db.$transaction(async (tx): Promise<PreparePaymentResult> => {
    await lockJobRow(db, tx, found.jobId);
    const payment = await tx.payment.findFirst({
      where: { id: paymentId, job: { customerId } },
      include: { job: { select: { id: true, jobNumber: true, status: true } } },
    });
    if (!payment) return paymentFailure("not-found");
    if (payment.status === "PAID" || payment.status === "REFUNDED" || payment.status === "PARTIALLY_REFUNDED") {
      return { ok: true, paid: true };
    }
    if (payment.status === "FAILED") return paymentFailure("not-payable");
    if (payment.kind === "JOB" && payment.job.status !== "PRICED") return paymentFailure("not-payable");

    if (payment.providerPaymentId) {
      const existing = await intents.retrieve(payment.providerPaymentId);
      if (existing.status === "succeeded") return { ok: true, paid: true };
      if (existing.status === "canceled") {
        await tx.payment.updateMany({ where: { id: payment.id, status: "PENDING" }, data: { status: "FAILED", failureReason: "Cancelled." } });
        return paymentFailure("not-payable");
      }
      if (existing.client_secret) return { ok: true, paid: false, clientSecret: existing.client_secret };
    }

    const intent = await intents.create(
      {
        amount: payment.amountCents,
        currency: PAYMENT_CURRENCY,
        // Cards, Apple Pay and Google Pay, as switched on in the Stripe dashboard.
        automatic_payment_methods: { enabled: true },
        description: `Trade Marketplace TM-${payment.job.jobNumber}`,
        // Ids only: no names, addresses or job details go to Stripe.
        metadata: { paymentId: payment.id, jobId: payment.job.id, kind: payment.kind },
      },
      { idempotencyKey: payment.idempotencyKey },
    );
    if (!intent.client_secret) return paymentFailure("unavailable");

    await tx.payment.updateMany({
      where: { id: payment.id, providerPaymentId: null },
      data: { providerPaymentId: intent.id, livemode: intent.livemode },
    });
    return { ok: true, paid: false, clientSecret: intent.client_secret };
  }, { timeout: 30_000 });
}

export type CheckoutView = {
  paymentId: string;
  jobId: string;
  kind: PaymentKind;
  status: "PENDING" | "PAID" | "FAILED" | "REFUNDED" | "PARTIALLY_REFUNDED";
  amountCents: number;
  /** The GST inside `amountCents`, from the job's frozen pricing; null if the job was never priced through it. */
  gstCents: number | null;
  title: string;
  jobNumber: number;
  suburb: string;
  variationDescription: string | null;
};

export async function loadCheckout(db: PrismaClient, customerId: string, paymentId: string): Promise<CheckoutView | null> {
  const payment = await db.payment.findFirst({
    where: { id: paymentId, job: { customerId } },
    include: {
      job: { select: { ...JOB_SUMMARY_SELECT, pricing: { select: { gstCents: true } } } },
      variation: { select: { gstCents: true, description: true } },
    },
  });
  if (!payment) return null;
  const job = customerJobListView({ userId: customerId, role: "CUSTOMER" }, payment.job);
  if (!job) return null;
  const gstCents = payment.kind === "VARIATION" ? (payment.variation?.gstCents ?? null) : job.gstCents;
  return {
    paymentId: payment.id,
    jobId: job.id,
    kind: payment.kind,
    status: payment.status,
    amountCents: payment.amountCents,
    gstCents,
    title: job.title,
    jobNumber: job.jobNumber,
    suburb: job.suburb,
    variationDescription: payment.kind === "VARIATION" ? payment.variation?.description ?? null : null,
  };
}

/** Whether Stripe already has the money (the webhook may not have landed yet), for the "done" page. */
export async function paymentSucceededAtStripe(intents: PaymentIntentsApi, providerPaymentId: string | null): Promise<boolean> {
  if (!providerPaymentId) return false;
  return (await intents.retrieve(providerPaymentId)).status === "succeeded";
}

export type { PaymentErrorCode, PaymentFailure };
