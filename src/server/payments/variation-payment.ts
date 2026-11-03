import "server-only";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import type { Payment, PrismaClient } from "@/generated/prisma/client";
import { paymentFailure, payPath, type StartPaymentResult, type PreparePaymentResult } from "@/lib/payments/results";
import { SYSTEM_ACTOR, createAudit } from "@/server/audit/audit";
import { createNotify } from "@/server/notifications/notify";
import { command, inProgress, lockJob, lockVariation, refuse, requireActor, type Tx, type VariationActor } from "@/server/variations/common";
import type { PaymentIntentsApi, StartPaymentInput } from "./payments";

/** Call under the job lock before changing/declining a quote. Never invalidate a checkout until Stripe confirms
 * cancellation. Processing/succeeded/ambiguous outcomes keep the quote intact for verified settlement. */
export async function retireVariationPayments(tx: Tx, intents: PaymentIntentsApi | null, actor: VariationActor, variationId: string) {
  const waiting = await tx.payment.findMany({ where: { variationId, status: { in: ["PENDING", "FAILED"] } } });
  for (const payment of waiting) {
    if (payment.providerPaymentId) {
      if (!intents) return refuse("payment-pending");
      const current = await intents.retrieve(payment.providerPaymentId);
      if (current.status !== "canceled") {
        if (current.status === "succeeded" || current.status === "processing") return refuse("payment-pending");
        if ((await intents.cancel(current.id)).status !== "canceled") return refuse("payment-pending");
      }
    }
    if (payment.status === "PENDING") {
      await tx.payment.update({ where: { id: payment.id }, data: { status: "FAILED", failureReason: "The extra-work quote changed before it was paid." } });
      await createAudit(tx)(actor, "payment.failed", { type: "payments", id: payment.id }, { status: "PENDING" }, { status: "FAILED" });
    }
  }
}

export async function startVariationPayment(db: PrismaClient, intents: PaymentIntentsApi | null, customerId: string, input: StartPaymentInput): Promise<StartPaymentResult> {
  const result = await command(db, async tx => {
    const actor = { userId: customerId };
    await requireActor(tx, actor, "CUSTOMER");
    const { job, variation } = await lockVariation(tx, input.variationId as string);
    if (job.customerId !== customerId || job.id !== input.jobId) return refuse("not-found");
    inProgress(job.status);
    if (variation.status !== "PRICED" || variation.revision !== input.variationRevision || !variation.priceCents) return refuse("changed");
    const existing = await tx.payment.findFirst({ where: { variationId: variation.id, status: { not: "FAILED" } } });
    if (existing) {
      if (existing.status !== "PENDING" || existing.amountCents !== variation.priceCents || existing.variationRevision !== variation.revision) return refuse("changed");
      return { ok: true, paymentId: existing.id, href: payPath(existing.id) } as const;
    }
    // An earlier failed card can still be confirmed on its old intent; cancel it before offering another.
    await retireVariationPayments(tx, intents, actor, variation.id);
    const payment = await tx.payment.create({ data: { jobId: job.id, variationId: variation.id, variationRevision: variation.revision, kind: "VARIATION", amountCents: variation.priceCents, idempotencyKey: `payment-${randomUUID()}` } });
    await createAudit(tx)(actor, "payment.created", { type: "payments", id: payment.id }, null, { kind: "VARIATION", status: "PENDING", amountCents: payment.amountCents });
    await createAudit(tx)(actor, "variation.payment_started", { type: "variations", id: variation.id }, null, { revision: variation.revision, paymentId: payment.id });
    return { ok: true, paymentId: payment.id, href: payPath(payment.id) } as const;
  });
  return result.ok ? result : paymentFailure(result.error === "not-found" || result.error === "forbidden" ? "not-found" : "not-payable");
}

/** Same checkout/Stripe idempotency path, now serialized with quote changes and customer decisions. */
export async function prepareVariationPayment(db: PrismaClient, intents: PaymentIntentsApi, customerId: string, paymentId: string): Promise<PreparePaymentResult> {
  const result = await command(db, async tx => {
    await requireActor(tx, { userId: customerId }, "CUSTOMER");
    const initial = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!initial) return refuse("not-found");
    const job = await lockJob(tx, initial.jobId);
    if (job.customerId !== customerId) return refuse("not-found");
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (["PAID", "REFUNDED", "PARTIALLY_REFUNDED"].includes(payment.status)) return { ok: true, paid: true } as const;
    inProgress(job.status);
    const variation = await tx.variation.findUnique({ where: { id: payment.variationId! } });
    if (payment.status !== "PENDING" || variation?.status !== "PRICED" || payment.variationRevision !== variation.revision || payment.amountCents !== variation.priceCents) return refuse("changed");
    let intent = payment.providerPaymentId ? await intents.retrieve(payment.providerPaymentId) : null;
    if (intent?.status === "succeeded") return { ok: true, paid: true } as const;
    if (intent?.status === "canceled") {
      // A previous quote-change transaction may have cancelled Stripe then rolled back its database writes.
      // Commit this recovery rather than throwing a refusal (which would restore the stale PENDING row).
      await tx.payment.update({ where: { id: payment.id }, data: { status: "FAILED", failureReason: "Cancelled." } });
      await createAudit(tx)({ userId: customerId }, "payment.failed", { type: "payments", id: payment.id }, { status: "PENDING" }, { status: "FAILED" });
      return { ok: false, error: "changed" } as const;
    }
    if (!intent) intent = await intents.create({ amount: payment.amountCents, currency: "nzd", automatic_payment_methods: { enabled: true }, description: `Trade Marketplace TM-${job.jobNumber} extra work`, metadata: { paymentId: payment.id, jobId: job.id, kind: "VARIATION" } }, { idempotencyKey: payment.idempotencyKey });
    if (!intent.client_secret) return refuse("unavailable");
    await tx.payment.update({ where: { id: payment.id }, data: { providerPaymentId: intent.id, livemode: intent.livemode } });
    return { ok: true, paid: false, clientSecret: intent.client_secret } as const;
  });
  return result.ok ? result : paymentFailure(result.error === "not-found" || result.error === "forbidden" ? "not-found" : result.error === "unavailable" ? "unavailable" : "not-payable");
}

/** Called only after signature, amount and currency verification in the existing webhook. Approval, money,
 * audit and the worker's go-ahead notification commit once, together. */
export async function settleVariationPayment(db: PrismaClient, found: Payment, event: Stripe.Event, intent: Stripe.PaymentIntent) {
  return db.$transaction(async tx => {
    const job = await lockJob(tx, found.jobId);
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: found.id } });
    if (payment.status !== "PENDING" && payment.status !== "FAILED") return "duplicate" as const;
    const variation = payment.variationId ? await tx.variation.findUnique({ where: { id: payment.variationId } }) : null;
    await tx.payment.update({ where: { id: payment.id }, data: { status: "PAID", paidAt: new Date(), failureReason: null, providerPaymentId: intent.id, livemode: event.livemode } });
    await createAudit(tx)(SYSTEM_ACTOR, "payment.paid", { type: "payments", id: payment.id }, { status: payment.status }, { status: "PAID", amountCents: payment.amountCents });
    if (job.status === "ASSIGNED" && variation?.status === "PRICED" && variation.revision === payment.variationRevision && variation.priceCents === payment.amountCents) {
      await tx.variation.update({ where: { id: variation.id }, data: { status: "APPROVED" } });
      await createAudit(tx)(SYSTEM_ACTOR, "variation.approved", { type: "variations", id: variation.id }, { status: "PRICED" }, { status: "APPROVED", paymentId: payment.id });
      if (job.workerId) await createNotify(tx)("variation.approved", [job.workerId], { eventId: `variation.approved:${variation.id}`, payload: { jobId: job.id, jobNumber: job.jobNumber, variationId: variation.id } });
    } else {
      // Real money must stay in the ledger even when the job closed while Stripe was processing it. No go-ahead.
      const office = await tx.profile.findMany({ where: { role: "ADMIN" }, select: { id: true } });
      await createNotify(tx)("payment.review_required", office.map(p => p.id), { eventId: `payment.review_required:${payment.id}`, payload: { jobId: job.id, jobNumber: job.jobNumber, paymentId: payment.id } });
    }
    return "paid" as const;
  }, { timeout: 30_000 });
}
