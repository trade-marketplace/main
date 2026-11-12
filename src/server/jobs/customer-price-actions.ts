"use server";
import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { getStripe } from "@/server/payments/stripe";
import { declineCustomerPrice } from "./customer-price";

export const declineCustomerPriceAction = withRole(["CUSTOMER"], (viewer, id: string, revision: string, reason: unknown) => declineCustomerPrice(getDb(), viewer, id, revision, reason, safeIntents()));

/** Cancelling an open checkout needs Stripe. Without keys there is none to cancel, and one that exists is never guessed at. */
function safeIntents() {
  try { return getStripe().paymentIntents; } catch { return null; }
}
