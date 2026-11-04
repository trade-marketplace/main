import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import type { PaymentCompletion } from "@/lib/payments/results";
import { paymentSucceededAtStripe, type PaymentIntentsApi } from "./payments";

/** A Stripe success confirms the money, while only verified webhook settlement can approve extra work. */
export async function loadPaymentCompletion(
  db: Pick<PrismaClient, "payment">,
  customerId: string,
  paymentId: string,
  intents?: () => PaymentIntentsApi,
): Promise<PaymentCompletion | { jobId: string; outcome: "unpaid" } | null> {
  const payment = await db.payment.findFirst({
    where: { id: paymentId, job: { customerId } },
    select: { status: true, kind: true, jobId: true, providerPaymentId: true, amountCents: true, variationRevision: true,
      variation: { select: { status: true, revision: true, priceCents: true } } },
  });
  if (!payment) return null;
  let paid = payment.status !== "PENDING" && payment.status !== "FAILED";
  if (!paid && payment.status === "PENDING" && intents) {
    try { paid = await paymentSucceededAtStripe(intents(), payment.providerPaymentId); }
    catch { /* An unconfirmed payment returns to checkout; no success is invented. */ }
  }
  if (!paid) return { jobId: payment.jobId, outcome: "unpaid" };
  if (payment.kind !== "VARIATION") return { jobId: payment.jobId, outcome: "booked" };
  if (payment.status === "PENDING") return { jobId: payment.jobId, outcome: "variation-checking" };
  const approved = payment.status === "PAID" && payment.variation?.status === "APPROVED"
    && payment.variation.revision === payment.variationRevision && payment.variation.priceCents === payment.amountCents;
  return { jobId: payment.jobId, outcome: approved ? "variation-approved" : "variation-review" };
}
