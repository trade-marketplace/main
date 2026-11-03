import { describe, expect, it } from "vitest";

import { PaymentsNotConfiguredError, getStripe, getStripeConfig, paymentsInTestMode } from "@/server/payments/stripe";

// The only way to get a Stripe client goes through the lock (#151).

describe("getStripe", () => {
  it("throws PaymentsNotConfiguredError with no keys, and the test banner shows", () => {
    expect(() => getStripe({})).toThrow(PaymentsNotConfiguredError);
    expect(paymentsInTestMode({})).toBe(true);
  });

  it("refuses live keys unless PAYMENTS_LIVE=1, without making any request", () => {
    const live = { STRIPE_SECRET_KEY: "sk_live_51Abcdefghijklmnop", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_51Abcdefghijklmnop" };
    expect(() => getStripe(live)).toThrow(/PAYMENTS_LIVE/);
    expect(getStripeConfig(live).status).toBe("blocked");
    expect(getStripe({ ...live, PAYMENTS_LIVE: "1" })).toBeTruthy();
    expect(paymentsInTestMode({ ...live, PAYMENTS_LIVE: "1" })).toBe(false);
  });

  it("makes a client for test keys", () => {
    const env = { STRIPE_SECRET_KEY: "sk_test_51Abcdefghijklmnop", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_51Abcdefghijklmnop" };
    expect(getStripe(env).paymentIntents).toBeDefined();
    expect(paymentsInTestMode(env)).toBe(true);
  });
});
