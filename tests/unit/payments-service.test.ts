import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { type PaymentIntentsApi, loadCheckout, preparePayment, startPayment } from "@/server/payments/payments";

const startVariationPayment = vi.hoisted(() => vi.fn(async () => ({ ok: true, paymentId: "variation-payment", href: "/pay/variation-payment" })));
vi.mock("@/server/payments/variation-payment", () => ({ startVariationPayment, prepareVariationPayment: vi.fn() }));

vi.mock("@/server/audit/audit", () => ({ SYSTEM_ACTOR: { system: true }, createAudit: () => vi.fn() }));

// Taking a payment (#151): who may pay, what is charged, and that retries never make a second PaymentIntent.

const ME = "cust-1";
type Pay = Record<string, unknown> & { id: string; status: string };

function setup(opts: { job?: Record<string, unknown> | null; variation?: Record<string, unknown> | null; payments?: Pay[] } = {}) {
  const payments: Pay[] = opts.payments ?? [];
  const job = opts.job === undefined ? { id: "job-1", status: "PRICED", priceCents: 37200 } : opts.job;
  const payment = {
    findFirst: vi.fn(async (args: { where: Record<string, unknown> }) => {
      if (args.where.id) return payments.find((p) => p.id === args.where.id && (args.where.job as { customerId: string }).customerId === ME) ?? null;
      return payments.find((p) => p.status !== "FAILED") ?? null;
    }),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `pay-${payments.length + 1}`, status: "PENDING", ...data } as Pay;
      payments.push(row);
      return row;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: { id?: string; providerPaymentId?: null }; data: Record<string, unknown> }) => {
      const row = payments.find((p) => p.id === where.id);
      if (row) Object.assign(row, data);
      return { count: row ? 1 : 0 };
    }),
  };
  const db = {
    job: { findFirst: vi.fn(async ({ where }: { where: { customerId: string } }) => (where.customerId === ME ? job : null)) },
    variation: { findFirst: vi.fn(async () => (opts.variation === undefined ? null : opts.variation)) },
    payment,
    $transaction: async (fn: (tx: unknown) => unknown) => fn({ payment }),
  } as unknown as PrismaClient;
  return { db, payments, payment };
}

function fakeIntents(): PaymentIntentsApi & { create: ReturnType<typeof vi.fn>; retrieve: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> } {
  return {
    create: vi.fn(async (...args: [Stripe.PaymentIntentCreateParams, Stripe.RequestOptions]) => (args && { id: "pi_1", client_secret: "pi_1_secret_x", livemode: false, status: "requires_payment_method" }) as Stripe.PaymentIntent),
    retrieve: vi.fn(async () => ({ id: "pi_1", client_secret: "pi_1_secret_x", status: "requires_payment_method" }) as Stripe.PaymentIntent),
    cancel: vi.fn(async () => ({}) as Stripe.PaymentIntent),
  };
}

describe("startPayment", () => {
  it("makes a pending payment for the job's frozen price", async () => {
    const { db, payments } = setup();
    const result = await startPayment(db, null, ME, { jobId: "job-1" });
    expect(result).toMatchObject({ ok: true, href: "/pay/pay-1" });
    expect(payments[0]).toMatchObject({ kind: "JOB", amountCents: 37200, jobId: "job-1" });
    expect(String(payments[0]?.idempotencyKey)).toMatch(/^payment-/);
  });

  it("reuses the waiting payment on a second click", async () => {
    const { db, payments } = setup();
    await startPayment(db, null, ME, { jobId: "job-1" });
    const again = await startPayment(db, null, ME, { jobId: "job-1" });
    expect(again).toMatchObject({ ok: true, paymentId: "pay-1" });
    expect(payments).toHaveLength(1);
  });

  it("refuses someone else's job as not found", async () => {
    const { db } = setup();
    expect(await startPayment(db, null, "someone-else", { jobId: "job-1" })).toMatchObject({ ok: false, error: "not-found" });
  });

  it.each(["REVIEW", "QUOTE_BOUNTY", "BOOKABLE", "ASSIGNED", "COMPLETED", "CANCELLED"])("refuses a job that is %s", async (status) => {
    const { db } = setup({ job: { id: "job-1", status, priceCents: 37200 } });
    expect(await startPayment(db, null, ME, { jobId: "job-1" })).toMatchObject({ ok: false, error: "not-payable" });
  });

  it("refuses a job with no price", async () => {
    const { db } = setup({ job: { id: "job-1", status: "PRICED", priceCents: null } });
    expect(await startPayment(db, null, ME, { jobId: "job-1" })).toMatchObject({ ok: false, error: "not-payable" });
  });

  it("says already paid when the job is paid", async () => {
    const { db } = setup({ payments: [{ id: "pay-1", status: "PAID", amountCents: 37200 }] });
    expect(await startPayment(db, null, ME, { jobId: "job-1" })).toMatchObject({ ok: false, error: "already-paid" });
  });

  it("retires a waiting payment whose price moved, cancels its PaymentIntent and makes a new one", async () => {
    const intents = fakeIntents();
    const { db, payments } = setup({ payments: [{ id: "pay-1", status: "PENDING", amountCents: 30000, providerPaymentId: "pi_old" }] });
    // The fake's findFirst skips FAILED rows, as the real query does.
    const result = await startPayment(db, intents, ME, { jobId: "job-1" });
    expect(intents.cancel).toHaveBeenCalledWith("pi_old");
    expect(payments[0]).toMatchObject({ status: "FAILED" });
    expect(result).toMatchObject({ ok: true, paymentId: "pay-2" });
    expect(payments[1]).toMatchObject({ amountCents: 37200 });
  });

  it("delegates extra-work payments with the displayed revision to its serialized path", async () => {
    const { db } = setup();
    const input = { jobId: "job-1", variationId: "var-1", variationRevision: 2 };
    expect(await startPayment(db, null, ME, input)).toMatchObject({ ok: true, paymentId: "variation-payment" });
    expect(startVariationPayment).toHaveBeenCalledWith(db, null, ME, input);
  });

});

describe("preparePayment", () => {
  const pending = (extra: Record<string, unknown> = {}): Pay => ({
    id: "pay-1", status: "PENDING", kind: "JOB", amountCents: 37200, idempotencyKey: "payment-abc", providerPaymentId: null,
    job: { id: "job-1", jobNumber: 1005, status: "PRICED" }, ...extra,
  });
  beforeEach(() => vi.clearAllMocks());

  it("creates the PaymentIntent in NZD with dynamic payment methods, the stored amount and the row's idempotency key", async () => {
    const intents = fakeIntents();
    const { db, payments } = setup({ payments: [pending()] });
    const result = await preparePayment(db, intents, ME, "pay-1");
    expect(result).toEqual({ ok: true, paid: false, clientSecret: "pi_1_secret_x" });
    const [params, options] = intents.create.mock.calls[0] as [Stripe.PaymentIntentCreateParams, Stripe.RequestOptions];
    expect(params).toMatchObject({ amount: 37200, currency: "nzd", automatic_payment_methods: { enabled: true }, metadata: { paymentId: "pay-1", jobId: "job-1", kind: "JOB" } });
    expect(params).not.toHaveProperty("payment_method_types");
    expect(options).toEqual({ idempotencyKey: "payment-abc" });
    expect(payments[0]).toMatchObject({ providerPaymentId: "pi_1", livemode: false });
  });

  it("reuses the saved PaymentIntent instead of making another", async () => {
    const intents = fakeIntents();
    const { db } = setup({ payments: [pending({ providerPaymentId: "pi_1" })] });
    expect(await preparePayment(db, intents, ME, "pay-1")).toMatchObject({ ok: true, clientSecret: "pi_1_secret_x" });
    expect(intents.create).not.toHaveBeenCalled();
  });

  it("says paid when Stripe already has the money", async () => {
    const intents = fakeIntents();
    intents.retrieve.mockResolvedValueOnce({ id: "pi_1", status: "succeeded" } as Stripe.PaymentIntent);
    const { db } = setup({ payments: [pending({ providerPaymentId: "pi_1" })] });
    expect(await preparePayment(db, intents, ME, "pay-1")).toEqual({ ok: true, paid: true });
  });

  it("marks a cancelled PaymentIntent's payment failed", async () => {
    const intents = fakeIntents();
    intents.retrieve.mockResolvedValueOnce({ id: "pi_1", status: "canceled" } as Stripe.PaymentIntent);
    const { db, payments } = setup({ payments: [pending({ providerPaymentId: "pi_1" })] });
    expect(await preparePayment(db, intents, ME, "pay-1")).toMatchObject({ ok: false, error: "not-payable" });
    expect(payments[0]).toMatchObject({ status: "FAILED" });
  });

  it("is not found for anyone but the job's customer", async () => {
    const { db } = setup({ payments: [pending()] });
    expect(await preparePayment(db, fakeIntents(), "other", "pay-1")).toMatchObject({ ok: false, error: "not-found" });
  });

  it("refuses when the job is no longer waiting for payment", async () => {
    const intents = fakeIntents();
    const { db } = setup({ payments: [pending({ job: { id: "job-1", jobNumber: 1, status: "CANCELLED" } })] });
    expect(await preparePayment(db, intents, ME, "pay-1")).toMatchObject({ ok: false, error: "not-payable" });
    expect(intents.create).not.toHaveBeenCalled();
  });

  it("answers paid for a paid payment and not-payable for a failed one, without calling Stripe", async () => {
    const intents = fakeIntents();
    expect(await preparePayment(setup({ payments: [pending({ status: "PAID" })] }).db, intents, ME, "pay-1")).toEqual({ ok: true, paid: true });
    expect(await preparePayment(setup({ payments: [pending({ status: "FAILED" })] }).db, intents, ME, "pay-1")).toMatchObject({ error: "not-payable" });
    expect(intents.create).not.toHaveBeenCalled();
    expect(intents.retrieve).not.toHaveBeenCalled();
  });
});

describe("loadCheckout", () => {
  it("shows the total and GST only", async () => {
    const db = {
      payment: {
        findFirst: vi.fn(async () => ({
          id: "pay-1", kind: "JOB", status: "PENDING", amountCents: 37200,
          job: { id: "job-1", title: "Sub wiring", jobNumber: 1005, suburb: "Windsor", pricing: { gstCents: 4852 } },
          variation: null,
        })),
      },
    } as unknown as PrismaClient;
    const view = await loadCheckout(db, ME, "pay-1");
    expect(view).toMatchObject({ amountCents: 37200, gstCents: 4852, title: "Sub wiring" });
    expect(Object.keys(view ?? {})).not.toContain("marginCents");
  });
});
