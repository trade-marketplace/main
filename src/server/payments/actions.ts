"use server";
// The payment server actions (#151). Customers only: withRole answers `session-expired` or `forbidden` for anyone else
// and never redirects, so the pay form keeps its state. The work is in ./payments.ts.
import { type PreparePaymentResult, type StartPaymentResult, paymentFailure } from "@/lib/payments/results";
import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";

import { preparePayment, startPayment } from "./payments";
import { PaymentsNotConfiguredError, getStripe } from "./stripe";

/**
 * "Accept & pay" (C08): makes the payment the checkout opens. `variationId` is for extra work (the screen for that is
 * built with extra work, #158). The price is read from the database, never from the browser.
 */
export const startPaymentAction = withRole(
  ["CUSTOMER"],
  async (viewer, jobId: string, variationId?: string | null, variationRevision?: number): Promise<StartPaymentResult> => {
    if (typeof jobId !== "string" || !jobId) return paymentFailure("not-found");
    try {
      return await startPayment(getDb(), safeIntents(), viewer.userId, { jobId, variationId: variationId || null, variationRevision });
    } catch (error) {
      console.error("Payments: couldn't start a payment.", error);
      return paymentFailure("unavailable");
    }
  },
);

/** The card form asks for its secret when it opens. */
export const preparePaymentAction = withRole(["CUSTOMER"], async (viewer, paymentId: string): Promise<PreparePaymentResult> => {
  if (typeof paymentId !== "string" || !paymentId) return paymentFailure("not-found");
  let stripe;
  try {
    stripe = getStripe();
  } catch (error) {
    if (error instanceof PaymentsNotConfiguredError) return paymentFailure("not-configured");
    throw error;
  }
  try {
    return await preparePayment(getDb(), stripe.paymentIntents, viewer.userId, paymentId);
  } catch (error) {
    console.error("Payments: couldn't get the card form ready.", error);
    return paymentFailure("unavailable");
  }
});

/** Cancelling an old PaymentIntent needs Stripe; without keys there is none to cancel. */
function safeIntents() {
  try {
    return getStripe().paymentIntents;
  } catch {
    return null;
  }
}
