// /pay/[paymentId] (C10, #151): the checkout. Customers only (the proxy redirects everyone else; this checks again
// because it reads their payment). The amount comes from the database; the card form is Stripe's Payment Element.
import type { Metadata } from "next";
import { notFound, redirect, unstable_rethrow } from "next/navigation";

import { CheckoutPage } from "@/components/payments/Checkout";
import { PayForm } from "@/components/payments/PayForm";
import { PayFormView } from "@/components/payments/PayFormView";
import { privateMetadata } from "@/lib/metadata";
import { payDonePath, payPath } from "@/lib/payments/results";
import { requireRole } from "@/server/auth/guard";
import { DatabaseNotConfiguredError, getDb } from "@/server/db";
import { type CheckoutView, loadCheckout } from "@/server/payments/payments";
import { getStripeConfig, paymentsInTestMode } from "@/server/payments/stripe";

export const metadata: Metadata = { ...privateMetadata, title: "Pay & book" };

export default async function PayPage({ params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;
  const viewer = await requireRole(["CUSTOMER"], { next: payPath(paymentId) });

  let view: CheckoutView | null = null;
  try {
    view = await loadCheckout(getDb(), viewer.userId, paymentId);
  } catch (error) {
    unstable_rethrow(error);
    if (!(error instanceof DatabaseNotConfiguredError)) console.error("Checkout: couldn't read the payment.", error);
  }
  if (!view) notFound();
  if (view.status !== "PENDING") redirect(view.status === "FAILED" ? `/jobs/${view.jobId}` : payDonePath(paymentId));

  const config = getStripeConfig();
  return (
    <CheckoutPage summary={view} testMode={paymentsInTestMode()}>
      {config.status === "ready" ? (
        <PayForm paymentId={view.paymentId} amountCents={view.amountCents} publishableKey={config.publishableKey} />
      ) : (
        <PayFormView state="not-configured" amountCents={view.amountCents} />
      )}
    </CheckoutPage>
  );
}
