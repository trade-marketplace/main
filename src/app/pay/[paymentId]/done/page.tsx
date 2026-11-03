// The owned payment result: job bookings retain C11; extra work requires actual verified approval before a go-ahead.
// Stripe success before settlement shows a bounded check, while paid/unapproved money remains for office review.
import type { Metadata } from "next";
import { notFound, redirect, unstable_rethrow } from "next/navigation";

import { PaymentDone } from "@/components/payments/PaymentDone";
import { privateMetadata } from "@/lib/metadata";
import { payPath } from "@/lib/payments/results";
import { requireRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { loadPaymentCompletion } from "@/server/payments/completion";
import { getStripe } from "@/server/payments/stripe";

export const metadata: Metadata = { ...privateMetadata, title: "Paid" };

export default async function PayDonePage({ params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;
  const viewer = await requireRole(["CUSTOMER"], { next: payPath(paymentId) });

  let completion: Awaited<ReturnType<typeof loadPaymentCompletion>> = null;
  try {
    completion = await loadPaymentCompletion(getDb(), viewer.userId, paymentId, () => getStripe().paymentIntents);
  } catch (error) {
    unstable_rethrow(error);
    console.error("Payment done: couldn't read the payment.", error);
  }
  if (!completion) notFound();
  if (completion.outcome === "unpaid") redirect(payPath(paymentId));
  return <PaymentDone completion={completion} />;
}
