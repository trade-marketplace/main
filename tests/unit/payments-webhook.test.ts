import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { JobTransitionError } from "@/server/jobs/status-machine";
import { handleStripeEvent } from "@/server/payments/webhook-events";
import { type WebhookDeps, handleWebhookPost } from "@/server/payments/webhook";

const audit = vi.hoisted(() => vi.fn());
const applyTransition = vi.hoisted(() => vi.fn());
const settleVariationPayment = vi.hoisted(() => vi.fn(async () => "paid" as const));
vi.mock("@/server/payments/variation-payment", () => ({ settleVariationPayment }));
vi.mock("@/server/audit/audit", () => ({ SYSTEM_ACTOR: { system: true }, createAudit: () => audit }));
vi.mock("@/server/jobs/status-machine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/jobs/status-machine")>()),
  applyTransition,
}));
vi.mock("@/server/notifications/notify", () => ({ createNotify: () => vi.fn() }));
vi.mock("@/server/db", () => ({ getDb: () => ({}) }));

// Stripe's webhook (#151): signature, routing of events, and that replays change nothing. No network, no keys.

type Row = { id: string; jobId: string; kind: "JOB" | "VARIATION"; status: string; amountCents: number; refundedCents: number; providerPaymentId: string | null };

function fakeDb(initial: Partial<Row> = {}) {
  const row: Row = { id: "pay-1", jobId: "job-1", kind: "JOB", status: "PENDING", amountCents: 37200, refundedCents: 0, providerPaymentId: "pi_1", ...initial };
  const matches = (where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => {
      const actual = (row as Record<string, unknown>)[key];
      return typeof value === "object" && value !== null && "in" in value ? (value as { in: unknown[] }).in.includes(actual) : actual === value;
    });
  const payment = {
    findUnique: vi.fn(async ({ where }: { where: { providerPaymentId: string } }) => (where.providerPaymentId === row.providerPaymentId ? { ...row } : null)),
    findFirst: vi.fn(async () => null),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
      if (!matches(where)) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    }),
  };
  const db = { payment, $transaction: async (fn: (tx: unknown) => unknown) => fn({ payment }) } as unknown as PrismaClient;
  return { db, row, payment };
}

const intent = (extra: Record<string, unknown> = {}) =>
  ({ id: "pi_1", amount: 37200, amount_received: 37200, currency: "nzd", metadata: {}, last_payment_error: null, ...extra }) as unknown as Stripe.PaymentIntent;
const event = (type: string, object: unknown, extra: Record<string, unknown> = {}) =>
  ({ id: "evt_1", type, livemode: false, data: { object }, ...extra }) as unknown as Stripe.Event;

beforeEach(() => {
  audit.mockReset();
  applyTransition.mockReset();
});

describe("payment_intent.succeeded", () => {
  it("marks the payment paid, audits it, and moves the job to booked", async () => {
    const { db, row } = fakeDb();
    expect(await handleStripeEvent(db, event("payment_intent.succeeded", intent()))).toBe("paid");
    expect(row.status).toBe("PAID");
    expect(audit).toHaveBeenCalledWith({ system: true }, "payment.paid", { type: "payments", id: "pay-1" }, expect.anything(), expect.anything());
    expect(applyTransition).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ jobId: "job-1", transition: "mark-paid", actor: { role: "SYSTEM", source: "stripe-webhook" } }));
  });

  it("does nothing the second time (replay)", async () => {
    const { db } = fakeDb();
    await handleStripeEvent(db, event("payment_intent.succeeded", intent()));
    audit.mockClear();
    applyTransition.mockClear();
    expect(await handleStripeEvent(db, event("payment_intent.succeeded", intent()))).toBe("duplicate");
    expect(audit).not.toHaveBeenCalled();
    expect(applyTransition).not.toHaveBeenCalled();
  });

  it("a payment that failed earlier and was then paid on the same intent becomes paid", async () => {
    const { db, row } = fakeDb({ status: "FAILED" });
    expect(await handleStripeEvent(db, event("payment_intent.succeeded", intent()))).toBe("paid");
    expect(row.status).toBe("PAID");
  });

  it("never records a different amount as paid", async () => {
    const { db, row } = fakeDb();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await handleStripeEvent(db, event("payment_intent.succeeded", intent({ amount: 100, amount_received: 100 })))).toBe("ignored");
    expect(row.status).toBe("PENDING");
    expect(applyTransition).not.toHaveBeenCalled();
  });

  it("ignores an intent that is not ours", async () => {
    const { db } = fakeDb();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await handleStripeEvent(db, event("payment_intent.succeeded", intent({ id: "pi_other" })))).toBe("ignored");
  });

  it("keeps the payment as paid when the job can no longer move (e.g. cancelled meanwhile)", async () => {
    const { db, row } = fakeDb();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    applyTransition.mockRejectedValueOnce(new JobTransitionError("illegal-transition", "job-1", "mark-paid", "no"));
    expect(await handleStripeEvent(db, event("payment_intent.succeeded", intent()))).toBe("paid");
    expect(row.status).toBe("PAID");
  });

  it("hands extra-work settlement to its guarded transaction without moving the job", async () => {
    const { db } = fakeDb({ kind: "VARIATION" });
    expect(await handleStripeEvent(db, event("payment_intent.succeeded", intent()))).toBe("paid");
    expect(settleVariationPayment).toHaveBeenCalledWith(db, expect.objectContaining({ kind: "VARIATION" }), expect.anything(), expect.anything());
    expect(applyTransition).not.toHaveBeenCalled();
  });

  it("rethrows unexpected errors so Stripe retries", async () => {
    const { db } = fakeDb();
    applyTransition.mockRejectedValueOnce(new Error("database down"));
    await expect(handleStripeEvent(db, event("payment_intent.succeeded", intent()))).rejects.toThrow("database down");
  });
});

describe("payment_intent.payment_failed", () => {
  it("marks a waiting payment failed with Stripe's reason, once", async () => {
    const { db, row } = fakeDb();
    const failed = event("payment_intent.payment_failed", intent({ last_payment_error: { message: "Your card was declined." } }));
    expect(await handleStripeEvent(db, failed)).toBe("failed");
    expect(row).toMatchObject({ status: "FAILED", failureReason: "Your card was declined." });
    expect(await handleStripeEvent(db, failed)).toBe("duplicate");
    expect(audit).toHaveBeenCalledTimes(1);
  });

  it("never un-pays a paid payment", async () => {
    const { db, row } = fakeDb({ status: "PAID" });
    expect(await handleStripeEvent(db, event("payment_intent.payment_failed", intent()))).toBe("duplicate");
    expect(row.status).toBe("PAID");
  });
});

describe("charge.refunded", () => {
  const charge = (amount_refunded: number) => ({ id: "ch_1", payment_intent: "pi_1", amount_refunded });

  it("records a partial refund, then the rest, and a replay changes nothing", async () => {
    const { db, row } = fakeDb({ status: "PAID" });
    expect(await handleStripeEvent(db, event("charge.refunded", charge(10000)))).toBe("refund-recorded");
    expect(row).toMatchObject({ status: "PARTIALLY_REFUNDED", refundedCents: 10000 });
    expect(await handleStripeEvent(db, event("charge.refunded", charge(10000)))).toBe("duplicate");
    expect(await handleStripeEvent(db, event("charge.refunded", charge(37200)))).toBe("refund-recorded");
    expect(row).toMatchObject({ status: "REFUNDED", refundedCents: 37200 });
    expect(audit).toHaveBeenLastCalledWith({ system: true }, "payment.refunded", expect.anything(), expect.anything(), expect.anything(), "Refunded in Stripe.");
  });

  it("does not count a refund the office already recorded twice", async () => {
    const { db, row } = fakeDb({ status: "PARTIALLY_REFUNDED", refundedCents: 10000 });
    expect(await handleStripeEvent(db, event("charge.refunded", charge(10000)))).toBe("duplicate");
    expect(row.refundedCents).toBe(10000);
  });

  it("never records more than was paid", async () => {
    const { db, row } = fakeDb({ status: "PAID" });
    await handleStripeEvent(db, event("charge.refunded", charge(99999)));
    expect(row.refundedCents).toBe(37200);
  });

  it("ignores a refund on an unpaid payment", async () => {
    const { db } = fakeDb();
    expect(await handleStripeEvent(db, event("charge.refunded", charge(100)))).toBe("ignored");
  });
});

describe("other events", () => {
  it("are ignored", async () => {
    const { db, payment } = fakeDb();
    expect(await handleStripeEvent(db, event("customer.created", {}))).toBe("ignored");
    expect(payment.updateMany).not.toHaveBeenCalled();
  });
});

describe("handleWebhookPost", () => {
  const request = (headers: Record<string, string> = { "stripe-signature": "t=1,v1=abc" }) =>
    new Request("http://localhost/api/stripe/webhook", { method: "POST", body: '{"id":"evt_1"}', headers });
  const deps = (over: Partial<WebhookDeps> = {}): WebhookDeps => ({
    secret: () => "whsec_test",
    verify: () => event("customer.created", {}),
    handle: async () => "ignored",
    ...over,
  });

  it("answers 503 when payments aren't set up", async () => {
    expect((await handleWebhookPost(request(), deps({ secret: () => null }))).status).toBe(503);
  });

  it("answers 400 without a signature, and never processes", async () => {
    const handle = vi.fn();
    expect((await handleWebhookPost(request({}), deps({ handle }))).status).toBe(400);
    expect(handle).not.toHaveBeenCalled();
  });

  it("answers 400 for a bad signature, and never processes", async () => {
    const handle = vi.fn();
    const response = await handleWebhookPost(request(), deps({ verify: () => { throw new Error("bad"); }, handle }));
    expect(response.status).toBe(400);
    expect(handle).not.toHaveBeenCalled();
  });

  it("answers 200 for unknown events", async () => {
    const response = await handleWebhookPost(request(), deps());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, outcome: "ignored" });
  });

  it("answers 500 when processing fails so Stripe retries", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await handleWebhookPost(request(), deps({ handle: async () => { throw new Error("db"); } }))).status).toBe(500);
  });

  it("passes the raw body to the verifier, and a real Stripe signature checks out", async () => {
    const secret = "whsec_test_secret";
    const payload = JSON.stringify({ id: "evt_9", object: "event", type: "customer.created", data: { object: {} } });
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    const stripe = new Stripe("sk_test_51Abcdefghijklmnop");
    const handle = vi.fn(async () => "ignored" as const);
    const good = new Request("http://localhost/api/stripe/webhook", { method: "POST", body: payload, headers: { "stripe-signature": header } });
    const response = await handleWebhookPost(good, { secret: () => secret, verify: (body, sig, s) => stripe.webhooks.constructEvent(body, sig, s), handle });
    expect(response.status).toBe(200);
    expect(handle).toHaveBeenCalledTimes(1);
    const tampered = new Request("http://localhost/api/stripe/webhook", { method: "POST", body: payload.replace("evt_9", "evt_8"), headers: { "stripe-signature": header } });
    expect((await handleWebhookPost(tampered, { secret: () => secret, verify: (body, sig, s) => stripe.webhooks.constructEvent(body, sig, s), handle })).status).toBe(400);
  });
});
