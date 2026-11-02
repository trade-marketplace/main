// Stripe keys: what each one is and whether the set may be used (#151). Pure, so the lock is easy to test and the
// same rules run wherever they're needed. Server code reads the environment through src/server/payments/stripe.ts.
//
// THE LIVE-KEY LOCK: payments stay in test mode until both founders agree in writing (DECISIONS.md 7). Any key that
// is a live key (sk_live_, rk_live_, pk_live_) is refused unless PAYMENTS_LIVE is exactly "1". Missing keys are not
// an error: payments are simply "not configured" and the pay screen says so.

export const STRIPE_ENV = {
  secretKey: "STRIPE_SECRET_KEY",
  publishableKey: "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
  webhookSecret: "STRIPE_WEBHOOK_SECRET",
  live: "PAYMENTS_LIVE",
} as const;

export type StripeMode = "test" | "live";

export type StripeBlockReason =
  /** A live key is set but PAYMENTS_LIVE isn't "1". */
  | "live-keys-locked"
  /** One test key and one live key. */
  | "mixed-modes"
  /** A key that isn't shaped like a Stripe key for its job (e.g. a publishable key in the secret slot). */
  | "invalid-key";

export type StripeConfig =
  | {
      status: "ready";
      mode: StripeMode;
      secretKey: string;
      publishableKey: string;
      /** Only the webhook route needs this; taking a payment works without it. */
      webhookSecret: string | null;
    }
  | { status: "not-configured"; missing: readonly string[] }
  | { status: "blocked"; reason: StripeBlockReason; detail: string };

type Env = Readonly<Record<string, string | undefined>>;

const SECRET_KEY = /^(?:sk|rk)_(test|live)_[A-Za-z0-9]{8,}$/;
const PUBLISHABLE_KEY = /^pk_(test|live)_[A-Za-z0-9]{8,}$/;

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** "live" / "test" for a well-formed key, null for anything else. */
function modeOf(key: string, pattern: RegExp): StripeMode | null {
  const match = pattern.exec(key);
  return match ? (match[1] as StripeMode) : null;
}

/** Only the exact value "1" switches live payments on. "true", "yes" and "0" don't (surrounding spaces are trimmed). */
export function livePaymentsAllowed(env: Env): boolean {
  return clean(env[STRIPE_ENV.live]) === "1";
}

/**
 * Decides what the app may do with Stripe from the environment. A live key is refused (blocked) even when other
 * keys are missing or malformed, so a stray live key can never sit around half-configured. Error details name the
 * variable, never its value.
 */
export function resolveStripeConfig(env: Env): StripeConfig {
  const secretKey = clean(env[STRIPE_ENV.secretKey]);
  const publishableKey = clean(env[STRIPE_ENV.publishableKey]);
  const webhookSecret = clean(env[STRIPE_ENV.webhookSecret]);

  const looksLive = [secretKey, publishableKey].some((key) => key !== null && /_live_/i.test(key));
  if (looksLive && !livePaymentsAllowed(env)) {
    return {
      status: "blocked",
      reason: "live-keys-locked",
      detail: `A live Stripe key is set, but ${STRIPE_ENV.live} isn't 1. Live payments stay off until both founders agree in writing.`,
    };
  }

  const secretMode = secretKey ? modeOf(secretKey, SECRET_KEY) : null;
  const publishableMode = publishableKey ? modeOf(publishableKey, PUBLISHABLE_KEY) : null;
  if (secretKey && !secretMode) {
    return { status: "blocked", reason: "invalid-key", detail: `${STRIPE_ENV.secretKey} must be a Stripe secret key (sk_test_… or rk_test_…).` };
  }
  if (publishableKey && !publishableMode) {
    return { status: "blocked", reason: "invalid-key", detail: `${STRIPE_ENV.publishableKey} must be a Stripe publishable key (pk_test_…).` };
  }
  if (secretMode && publishableMode && secretMode !== publishableMode) {
    return { status: "blocked", reason: "mixed-modes", detail: "The secret key and the publishable key are from different Stripe modes." };
  }

  const missing: string[] = [];
  if (!secretKey) missing.push(STRIPE_ENV.secretKey);
  if (!publishableKey) missing.push(STRIPE_ENV.publishableKey);
  if (!secretKey || !publishableKey || !secretMode) return { status: "not-configured", missing };

  return { status: "ready", mode: secretMode, secretKey, publishableKey, webhookSecret };
}

/**
 * The test-mode banner shows unless live payments are actually on. Not configured counts as test mode: until
 * both founders switch real payments on, no real money moves.
 */
export function inTestMode(config: StripeConfig): boolean {
  return !(config.status === "ready" && config.mode === "live");
}
