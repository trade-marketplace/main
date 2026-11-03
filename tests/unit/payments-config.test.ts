import { describe, expect, it } from "vitest";

import { inTestMode, livePaymentsAllowed, resolveStripeConfig } from "@/lib/payments/config";

// The live-key lock (#151 acceptance criterion): live keys cannot be used unless PAYMENTS_LIVE=1.

const SK_TEST = "sk_test_51Abcdefghijklmnop";
const PK_TEST = "pk_test_51Abcdefghijklmnop";
const SK_LIVE = "sk_live_51Abcdefghijklmnop";
const PK_LIVE = "pk_live_51Abcdefghijklmnop";
const RK_LIVE = "rk_live_51Abcdefghijklmnop";

const env = (values: Record<string, string>) => values;

describe("resolveStripeConfig", () => {
  it("is ready with a matching pair of test keys, and says it is test mode", () => {
    const config = resolveStripeConfig(env({ STRIPE_SECRET_KEY: SK_TEST, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: PK_TEST, STRIPE_WEBHOOK_SECRET: "whsec_abc" }));
    expect(config).toMatchObject({ status: "ready", mode: "test", webhookSecret: "whsec_abc" });
    expect(inTestMode(config)).toBe(true);
  });

  it("accepts a restricted test key and works without a webhook secret", () => {
    const config = resolveStripeConfig(env({ STRIPE_SECRET_KEY: "rk_test_51Abcdefghijklmnop", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: PK_TEST }));
    expect(config).toMatchObject({ status: "ready", mode: "test", webhookSecret: null });
  });

  it.each([
    ["secret", { STRIPE_SECRET_KEY: SK_LIVE, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: PK_LIVE }],
    ["restricted", { STRIPE_SECRET_KEY: RK_LIVE, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: PK_LIVE }],
    ["live secret with test publishable", { STRIPE_SECRET_KEY: SK_LIVE, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: PK_TEST }],
    ["live publishable with test secret", { STRIPE_SECRET_KEY: SK_TEST, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: PK_LIVE }],
    ["live secret alone (the rest missing)", { STRIPE_SECRET_KEY: SK_LIVE }],
    ["live publishable alone", { NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: PK_LIVE }],
  ])("refuses a live key (%s) without PAYMENTS_LIVE", (_name, values) => {
    expect(resolveStripeConfig(env(values))).toMatchObject({ status: "blocked", reason: "live-keys-locked" });
  });

  it.each(["", "0", "true", "yes", "on", "11", "one"])("PAYMENTS_LIVE=%j does not unlock live keys", (value) => {
    const config = resolveStripeConfig(env({ STRIPE_SECRET_KEY: SK_LIVE, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: PK_LIVE, PAYMENTS_LIVE: value }));
    expect(config).toMatchObject({ status: "blocked", reason: "live-keys-locked" });
    expect(livePaymentsAllowed({ PAYMENTS_LIVE: value })).toBe(false);
  });

  it("only PAYMENTS_LIVE=1 allows live keys, and then the test-mode banner goes", () => {
    const config = resolveStripeConfig(env({ STRIPE_SECRET_KEY: SK_LIVE, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: PK_LIVE, PAYMENTS_LIVE: "1" }));
    expect(config).toMatchObject({ status: "ready", mode: "live" });
    expect(inTestMode(config)).toBe(false);
  });

  it("PAYMENTS_LIVE=1 does not allow mixing a live key with a test key", () => {
    const config = resolveStripeConfig(env({ STRIPE_SECRET_KEY: SK_LIVE, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: PK_TEST, PAYMENTS_LIVE: "1" }));
    expect(config).toMatchObject({ status: "blocked", reason: "mixed-modes" });
  });

  it("PAYMENTS_LIVE=1 with test keys stays in test mode", () => {
    const config = resolveStripeConfig(env({ STRIPE_SECRET_KEY: SK_TEST, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: PK_TEST, PAYMENTS_LIVE: "1" }));
    expect(inTestMode(config)).toBe(true);
  });

  it("treats missing keys as not configured, naming what is missing (no crash)", () => {
    expect(resolveStripeConfig({})).toEqual({ status: "not-configured", missing: ["STRIPE_SECRET_KEY", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"] });
    expect(resolveStripeConfig(env({ STRIPE_SECRET_KEY: SK_TEST }))).toEqual({ status: "not-configured", missing: ["NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"] });
    expect(resolveStripeConfig(env({ STRIPE_SECRET_KEY: "  ", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "" }))).toMatchObject({ status: "not-configured" });
    expect(inTestMode(resolveStripeConfig({}))).toBe(true);
  });

  it("refuses keys in the wrong slot or malformed, without echoing them", () => {
    const wrongSlot = resolveStripeConfig(env({ STRIPE_SECRET_KEY: PK_TEST, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: PK_TEST }));
    expect(wrongSlot).toMatchObject({ status: "blocked", reason: "invalid-key" });
    const garbage = resolveStripeConfig(env({ STRIPE_SECRET_KEY: SK_TEST, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "nonsense" }));
    expect(garbage).toMatchObject({ status: "blocked", reason: "invalid-key" });
    for (const config of [wrongSlot, garbage]) expect(JSON.stringify(config)).not.toMatch(/pk_test_51|nonsense|sk_test_51/);
  });

  it("refuses a test secret with a live publishable mixed in even when unlocked", () => {
    const config = resolveStripeConfig(env({ STRIPE_SECRET_KEY: SK_TEST, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: PK_LIVE, PAYMENTS_LIVE: "1" }));
    expect(config).toMatchObject({ status: "blocked", reason: "mixed-modes" });
  });

  it("never puts a key into the block message", () => {
    const config = resolveStripeConfig(env({ STRIPE_SECRET_KEY: SK_LIVE }));
    expect(JSON.stringify(config)).not.toContain(SK_LIVE);
  });
});
