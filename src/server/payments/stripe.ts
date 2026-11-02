import "server-only";

import Stripe from "stripe";

import { inTestMode, resolveStripeConfig, type StripeConfig } from "@/lib/payments/config";

// The one place the app reads Stripe's keys and makes a Stripe client (#151). Everything that talks to Stripe goes
// through getStripe(), so the live-key lock in src/lib/payments/config.ts cannot be walked around:
//   - STRIPE_SECRET_KEY                    server only
//   - NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY   browser (only handed over once this module says "ready")
//   - STRIPE_WEBHOOK_SECRET                server only, for /api/stripe/webhook
//   - PAYMENTS_LIVE=1                      the lock. Set only when both founders agree in writing.
// Missing keys never crash anything: payments are "not configured" and the pay screen says so.

export type Env = Readonly<Record<string, string | undefined>>;

export function getStripeConfig(env: Env = process.env): StripeConfig {
  return resolveStripeConfig(env);
}

/** True unless live payments are really on. The test-mode banner reads this. */
export function paymentsInTestMode(env: Env = process.env): boolean {
  return inTestMode(getStripeConfig(env));
}

export class PaymentsNotConfiguredError extends Error {
  constructor(readonly config: Exclude<StripeConfig, { status: "ready" }>) {
    super(
      config.status === "blocked"
        ? config.detail
        : `Payments aren't set up: missing ${config.missing.join(", ")}. See .env.example.`,
    );
    this.name = "PaymentsNotConfiguredError";
  }
}

let cached: { key: string; client: Stripe } | undefined;

/** The Stripe client, or a PaymentsNotConfiguredError when the keys are missing or locked. Makes no request itself. */
export function getStripe(env: Env = process.env): Stripe {
  const config = getStripeConfig(env);
  if (config.status !== "ready") throw new PaymentsNotConfiguredError(config);
  if (cached?.key !== config.secretKey) {
    cached = { key: config.secretKey, client: new Stripe(config.secretKey, { maxNetworkRetries: 2, appInfo: { name: "Trade Marketplace" } }) };
  }
  return cached.client;
}
