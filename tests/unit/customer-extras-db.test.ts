import Stripe from "stripe";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Role, PrismaClient } from "@/generated/prisma/client";
import type { Viewer } from "@/server/auth/viewer";
import { loadCustomerExtras } from "@/server/jobs/customer-extras";
import { priceJob } from "@/server/pricing/price-job";
import { requestVariation } from "@/server/variations/request";
import { priceVariation } from "@/server/variations/price";
import { preparePayment, type PaymentIntentsApi } from "@/server/payments/payments";
import { handleStripeEvent } from "@/server/payments/webhook-events";
import { handleWebhookPost } from "@/server/payments/webhook";
import { approveVariationAction, declineVariationAction } from "@/server/variations/actions";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

const context = vi.hoisted(() => ({ db: null as PrismaClient | null, viewer: null as Viewer | null, intents: null as PaymentIntentsApi | null }));
vi.mock("@/server/payments/stripe", async importOriginal => ({ ...await importOriginal<typeof import("@/server/payments/stripe")>(), getStripe: () => ({ paymentIntents: context.intents }) }));
vi.mock("@/server/db", () => ({ getDb: () => context.db }));
vi.mock("@/server/auth/viewer", () => ({ getViewer: async () => context.viewer }));

describe.skipIf(!testDatabaseUrl)("customer extra work ownership and existing decline action", () => {
  const schema = useTestSchema(import.meta.filename);
  async function person(role: Role) {
    const id = randomUUID(); await schema.db.$executeRaw`INSERT INTO auth.users (id) VALUES (${id}::uuid)`;
    await schema.db.profile.create({ data: { id, role, email: `${id}@example.test`, firstName: "Test" } });
    return { userId: id, role };
  }
  async function fixture() {
    const customer = await person("CUSTOMER"), worker = await person("TRADIE"), office = await person("ADMIN");
    const job = await schema.db.job.create({ data: { customerId: customer.userId, title: "Extra work", description: "Replace a switch", category: "ELECTRICAL", addressLine1: "1 Example St", suburb: "Windsor", city: "Invercargill" } });
    await priceJob(schema.db, { jobId: job.id, minutes: 120, materialsCents: 0 });
    await schema.db.job.update({ where: { id: job.id }, data: { status: "ASSIGNED", workerId: worker.userId } });
    const key = randomUUID(), path = `variations/${job.id}/${worker.userId}/${randomUUID().replaceAll("-", "")}.webp`;
    await schema.db.variationPhoto.create({ data: { path, jobId: job.id, uploadedById: worker.userId, requestKey: key, ready: true } });
    const request = await requestVariation(schema.db, worker, { jobId: job.id, requestKey: key, description: "Replace a second cracked switch", hours: 0.5, photoPaths: [path] });
    if (!request.ok) throw new Error(request.error);
    await priceVariation(schema.db, office, request.variationId, 0);
    return { customer, worker, office, job, id: request.variationId };
  }
  async function decided(f: Awaited<ReturnType<typeof fixture>>, count = 6) {
    const ids: string[] = [];
    for (let index = 0; index < count; index++) {
      const row = await schema.db.variation.create({ data: { jobId: f.job.id, requestedById: f.worker.userId,
        description: `Previously declined request ${index}`, requestedMinutes: 30, createdAt: new Date(Date.UTC(2026, 10, 12, index)) } });
      expect(await priceVariation(schema.db, f.office, row.id, 0)).toMatchObject({ ok: true });
      context.db = schema.db; context.intents = null;
      context.viewer = { ...f.customer, email: "owner@example.test", firstName: "Owner", emailVerified: true };
      expect(await declineVariationAction(row.id, 1)).toMatchObject({ ok: true });
      ids.unshift(row.id);
    }
    return ids;
  }
  function provider() {
    const rows = new Map<string, Stripe.PaymentIntent>(), keys = new Map<string, string>();
    const api: PaymentIntentsApi = {
      create: vi.fn(async (params, options) => {
        let id = keys.get(options.idempotencyKey!);
        if (!id) {
          id = `pi_${randomUUID()}`; keys.set(options.idempotencyKey!, id);
          rows.set(id, { id, amount: params.amount, amount_received: params.amount, currency: params.currency,
            metadata: params.metadata, status: "requires_payment_method", client_secret: `${id}_secret`, livemode: false } as Stripe.PaymentIntent);
        }
        return rows.get(id)!;
      }),
      retrieve: vi.fn(async id => rows.get(id)!),
      cancel: vi.fn(async id => { const row = rows.get(id)!; row.status = "canceled"; return row; }),
    };
    return { api, rows };
  }
  it("retains an older priced request behind six decided ones and approves it only after verified payment", async () => {
    const f = await fixture();
    await schema.db.variation.update({ where: { id: f.id }, data: { createdAt: new Date("2026-11-01T00:00:00Z") } });
    const recent = await decided(f);
    const extras = await loadCustomerExtras(schema.db, f.customer, f.job.id);
    expect(extras.map(row => row.id)).toEqual([...recent.slice(0, 4), f.id]);
    for (const row of extras) expect(Object.keys(row).sort()).toEqual(["id", "revision", "status", "description", "priceCents", "photoCount", "pricedAt", "decidedAt"].sort());
    const old = extras.find(row => row.id === f.id)!;
    const { api, rows } = provider(); context.db = schema.db; context.intents = api;
    context.viewer = { ...await person("CUSTOMER"), email: "other@example.test", firstName: "Other", emailVerified: true };
    expect(await approveVariationAction(old.id, old.revision)).toMatchObject({ ok: false });
    expect(await loadCustomerExtras(schema.db, context.viewer, f.job.id)).toEqual([]);
    context.viewer = { ...f.customer, email: "owner@example.test", firstName: "Owner", emailVerified: true };
    expect(await approveVariationAction(old.id, old.revision - 1)).toMatchObject({ ok: false });
    const result = await approveVariationAction(old.id, old.revision);
    if (!result.ok || !("paymentId" in result)) throw new Error("Existing approval action did not start checkout");
    expect(result.href).toBe(`/pay/${result.paymentId}`);
    expect(await schema.db.variation.findUnique({ where: { id: old.id } })).toMatchObject({ status: "PRICED" });
    expect(await preparePayment(schema.db, api, f.customer.userId, result.paymentId)).toMatchObject({ ok: true, paid: false });
    const payment = await schema.db.payment.findUniqueOrThrow({ where: { id: result.paymentId } });
    expect(payment).toMatchObject({ variationId: old.id, amountCents: old.priceCents, status: "PENDING" });
    const event = { id: `evt_${randomUUID()}`, type: "payment_intent.succeeded", livemode: false,
      data: { object: { ...rows.get(payment.providerPaymentId!)!, status: "succeeded" } } } as Stripe.Event;
    const secret = "whsec_disposable_customer_extras", stripe = new Stripe("sk_test_fixture"), payload = JSON.stringify(event);
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    const deps = { secret: () => secret, verify: (body: string, sig: string, key: string) => stripe.webhooks.constructEvent(body, sig, key), handle: (evt: Stripe.Event) => handleStripeEvent(schema.db, evt) };
    const request = (sig: string) => new Request("http://localhost/api/stripe/webhook", { method: "POST", body: payload, headers: { "stripe-signature": sig } });
    expect((await handleWebhookPost(request("invalid"), deps)).status).toBe(400);
    expect(await schema.db.variation.findUnique({ where: { id: old.id } })).toMatchObject({ status: "PRICED" });
    expect((await handleWebhookPost(request(signature), deps)).status).toBe(200);
    expect(await handleStripeEvent(schema.db, event)).toBe("duplicate");
    expect(await schema.db.variation.findUnique({ where: { id: old.id } })).toMatchObject({ status: "APPROVED", decidedAt: expect.any(Date) });
    expect(await schema.db.payment.findUnique({ where: { id: payment.id } })).toMatchObject({ status: "PAID" });
    context.intents = null;
  });
  it("returns the newest five decided rows when none are waiting", async () => {
    const f = await fixture();
    await schema.db.variation.update({ where: { id: f.id }, data: { status: "DECLINED", createdAt: new Date("2026-11-01T00:00:00Z") } });
    const ids = await decided(f);
    expect((await loadCustomerExtras(schema.db, f.customer, f.job.id)).map(row => row.id)).toEqual(ids.slice(0, 5));
    expect(await loadCustomerExtras(schema.db, await person("CUSTOMER"), f.job.id)).toEqual([]);
  });
  it("returns every waiting request even when legacy rows exceed five", async () => {
    const f = await fixture();
    await decided(f);
    const ids = [f.id];
    // Historical rows represent the backlog this reader must retain, regardless of new-request limits.
    for (let index = 0; index < 5; index++) {
      const row = await schema.db.variation.create({ data: { jobId: f.job.id, requestedById: f.worker.userId,
        description: `Historical unpriced request ${index}`, requestedMinutes: 30 } });
      ids.push(row.id);
    }
    const extras = await loadCustomerExtras(schema.db, f.customer, f.job.id);
    expect(extras).toHaveLength(6);
    expect(extras.map(row => row.id).sort()).toEqual(ids.sort());
    expect(extras.every(row => ["REQUESTED", "PRICED"].includes(row.status))).toBe(true);
  });
  it("gives only the owning current customer the bounded safe payload", async () => {
    const { customer, worker, office, job, id } = await fixture();
    const rows = await loadCustomerExtras(schema.db, customer, job.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id, revision: 1, status: "PRICED", photoCount: 1 });
    expect(Object.keys(rows[0]).sort()).toEqual(["id", "revision", "status", "description", "priceCents", "photoCount", "pricedAt", "decidedAt"].sort());
    for (const viewer of [null, worker, office, await person("CUSTOMER")]) expect(await loadCustomerExtras(schema.db, viewer, job.id)).toEqual([]);
    await schema.db.profile.update({ where: { id: customer.userId }, data: { role: "TRADIE" } });
    expect(await loadCustomerExtras(schema.db, customer, job.id)).toEqual([]);
  });
  it("declines through the real protected action, once, and tells the assigned tradie", async () => {
    const { customer, worker, job, id } = await fixture();
    context.db = schema.db;
    context.viewer = null;
    expect(await declineVariationAction(id, 1)).toMatchObject({ error: "session-expired" });
    context.viewer = { ...customer, email: "customer@example.test", firstName: "Test", emailVerified: true };
    expect(await declineVariationAction(id, 0)).toMatchObject({ error: "changed" });
    expect(await declineVariationAction(id, 1)).toMatchObject({ ok: true });
    expect(await declineVariationAction(id, 1)).toMatchObject({ ok: true });
    expect(await schema.db.variation.findUnique({ where: { id } })).toMatchObject({ status: "DECLINED" });
    expect(await schema.db.job.findUnique({ where: { id: job.id } })).toMatchObject({ status: "ASSIGNED" });
    expect(await schema.db.notification.count({ where: { userId: worker.userId, type: "variation.declined", payload: { path: ["variationId"], equals: id } } })).toBe(1);
    expect(await schema.db.auditLog.count({ where: { action: "variation.declined", recordId: id } })).toBe(1);
  });
});
