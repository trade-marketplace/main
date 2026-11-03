import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import type { Role } from "@/generated/prisma/client";
import { requestVariation } from "@/server/variations/request";
import { priceVariation } from "@/server/variations/price";
import { approveVariation, declineVariation } from "@/server/variations/decide";
import { uploadVariationPhoto, variationPhotoUrls } from "@/server/variations/photos";
import { loadVariation } from "@/server/variations/view";
import { variationPhotoCleanup } from "@/server/scheduler/variation-photo-cleanup";
import { priceJob } from "@/server/pricing/price-job";
import { priceWork } from "@/server/pricing/calculate";
import { queuePayoutForJob } from "@/server/payouts/queue-payout";
import { preparePayment, startPayment, type PaymentIntentsApi } from "@/server/payments/payments";
import { handleStripeEvent } from "@/server/payments/webhook-events";
import { handleWebhookPost } from "@/server/payments/webhook";
import type { FileStore } from "@/server/files/storage";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

describe.skipIf(!testDatabaseUrl)("extra work request → frozen price → verified payment → payout", () => {
  const schema = useTestSchema(import.meta.filename);
  const db = () => schema.db;
  async function person(role: Role) {
    const id = randomUUID(); await db().$executeRaw`INSERT INTO auth.users (id) VALUES (${id}::uuid)`;
    await db().profile.create({ data: { id, role, email: `${id}@example.nz`, firstName: "Test" } });
    return { userId: id };
  }
  async function fixture() {
    const customer = await person("CUSTOMER"), worker = await person("TRADIE"), office = await person("ADMIN");
    const job = await db().job.create({ data: { customerId: customer.userId, title: "Replace a switch", description: "Replace the hallway switch", category: "ELECTRICAL", addressLine1: "1 Example St", suburb: "Gladstone", city: "Invercargill" } });
    await priceJob(db(), { jobId: job.id, minutes: 120, materialsCents: 0 });
    await db().job.update({ where: { id: job.id }, data: { status: "ASSIGNED", workerId: worker.userId } });
    const requestKey = randomUUID();
    const path = `variations/${job.id}/${worker.userId}/${randomUUID().replaceAll("-", "")}.webp`;
    await db().variationPhoto.create({ data: { path, jobId: job.id, uploadedById: worker.userId, requestKey, ready: true } });
    const input = { jobId: job.id, requestKey, description: "Replace the second cracked switch", hours: 0.5, photoPaths: [path] };
    return { customer, worker, office, job, input, path };
  }
  async function requested() {
    const f = await fixture(); const result = await requestVariation(db(), f.worker, f.input);
    if (!result.ok) throw new Error(result.error);
    return { ...f, id: result.variationId };
  }
  async function priced() {
    const f = await requested(); expect(await priceVariation(db(), f.office, f.id, 0)).toMatchObject({ ok: true, revision: 1 }); return f;
  }
  function provider() {
    const rows = new Map<string, Stripe.PaymentIntent>(), keys = new Map<string, string>();
    const api: PaymentIntentsApi = {
      create: vi.fn(async (params, options) => {
        let id = keys.get(options.idempotencyKey!);
        if (!id) { id = `pi_${randomUUID()}`; keys.set(options.idempotencyKey!, id); rows.set(id, { id, amount: params.amount, amount_received: params.amount, currency: params.currency, metadata: params.metadata, status: "requires_payment_method", client_secret: `${id}_secret`, livemode: false } as Stripe.PaymentIntent); }
        return rows.get(id)!;
      }),
      retrieve: vi.fn(async id => rows.get(id)!),
      cancel: vi.fn(async id => { const row = rows.get(id)!; row.status = "canceled"; return row; }),
    };
    return { api, rows };
  }
  async function checkout(f: Awaited<ReturnType<typeof priced>>, api: PaymentIntentsApi) {
    const result = await approveVariation(db(), f.customer, f.id, 1, api);
    if (!result.ok || !("paymentId" in result)) throw new Error(result.error);
    expect(result.href).toBe(`/pay/${result.paymentId}`);
    expect(await preparePayment(db(), api, f.customer.userId, result.paymentId)).toMatchObject({ ok: true, paid: false });
    return db().payment.findUniqueOrThrow({ where: { id: result.paymentId } });
  }
  const success = (intent: Stripe.PaymentIntent) => ({ id: `evt_${randomUUID()}`, type: "payment_intent.succeeded", livemode: false, data: { object: { ...intent, status: "succeeded" } } }) as Stripe.Event;
  const store = (): FileStore & { put: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn>; signedUrl: ReturnType<typeof vi.fn> } => ({ put: vi.fn(async () => {}), remove: vi.fn(async () => {}), signedUrl: vi.fn(async (_bucket, path) => `https://files.example/${path}`) });

  it("requires the assigned worker, photos, valid whole-minute hours, and idempotently retains each ask", async () => {
    const f = await fixture(); const foreign = await person("TRADIE");
    expect(await requestVariation(db(), f.customer, f.input)).toMatchObject({ error: "forbidden" });
    expect(await requestVariation(db(), foreign, f.input)).toMatchObject({ error: "not-found" });
    for (const hours of [0, -1, NaN, Infinity, 101, 0.001]) expect(await requestVariation(db(), f.worker, { ...f.input, hours })).toMatchObject({ error: "invalid" });
    expect(await requestVariation(db(), f.worker, { ...f.input, photoPaths: [] })).toMatchObject({ error: "invalid" });
    expect(await requestVariation(db(), f.worker, { ...f.input, photoPaths: [`jobs/${f.job.id}/wrong.webp`] })).toMatchObject({ error: "photos-pending" });
    const [first, second] = await Promise.all([requestVariation(db(), f.worker, f.input), requestVariation(db(), f.worker, { ...f.input, requestKey: f.input.requestKey.toUpperCase() })]);
    expect(first).toEqual(second); expect(first.ok).toBe(true);
    expect(await requestVariation(db(), f.worker, { ...f.input, description: "A changed request with the same key" })).toMatchObject({ error: "changed" });
    const key = randomUUID(); const path = f.path.replace(/[^/]+$/, `${randomUUID().replaceAll("-", "")}.webp`);
    await db().variationPhoto.create({ data: { path, jobId: f.job.id, uploadedById: f.worker.userId, requestKey: key, ready: true } });
    expect(await requestVariation(db(), f.worker, { ...f.input, requestKey: key, photoPaths: [path] })).toMatchObject({ ok: true });
    expect(await db().variation.count({ where: { jobId: f.job.id } })).toBe(2);
    expect(await db().auditLog.count({ where: { action: "variation.requested", recordId: { in: (await db().variation.findMany({ where: { jobId: f.job.id } })).map(v => v.id) } } })).toBe(2);
  });

  it("uses frozen rates without another minimum and notifies again for each office revision", async () => {
    const f = await requested(); const frozen = await db().jobPricing.findUniqueOrThrow({ where: { jobId: f.job.id } });
    await db().settings.update({ where: { id: 1 }, data: { sharedRateCents: 9999 } });
    expect(await priceVariation(db(), f.worker, f.id, 0)).toMatchObject({ error: "forbidden" });
    expect(await priceVariation(db(), f.office, f.id, 0)).toMatchObject({ ok: true, revision: 1 });
    const first = await db().variation.findUniqueOrThrow({ where: { id: f.id } }); const expected = priceWork({ minutes: 30, materialsCents: 0 }, frozen, { applyMinimum: false });
    expect(first).toMatchObject({ minutes: 30, priceCents: expected.customerPriceCents, workerGrossCents: expected.workerGrossCents, holidayPayCents: expected.holidayPayCents });
    expect(await priceVariation(db(), f.office, f.id, 0, 45)).toMatchObject({ error: "changed" });
    expect(await priceVariation(db(), f.office, f.id, 1, 45)).toMatchObject({ ok: true, revision: 2 });
    const notices = await db().notification.findMany({ where: { userId: f.customer.userId, type: "variation.priced", payload: { path: ["variationId"], equals: f.id } } });
    expect(notices).toHaveLength(2); expect(notices.every(n => !JSON.stringify(n.payload).includes("Cents"))).toBe(true);
    await db().settings.update({ where: { id: 1 }, data: { sharedRateCents: frozen.workerRateCents } });
  });

  it("keeps customer price and worker earnings out of the other party's DTOs and notifications", async () => {
    const f = await priced();
    expect(await loadVariation(db(), f.worker, f.id)).toHaveProperty("workerEarnsCents");
    expect(await loadVariation(db(), f.worker, f.id)).not.toHaveProperty("priceCents");
    expect(await loadVariation(db(), f.customer, f.id)).toHaveProperty("priceCents");
    expect(await loadVariation(db(), f.customer, f.id)).not.toHaveProperty("workerEarnsCents");
    const customerWire = JSON.parse(JSON.stringify(await loadVariation(db(), f.customer, f.id)));
    expect(Object.keys(customerWire).sort()).toEqual(["id", "jobId", "description", "status", "revision", "photoCount", "pricedAt", "decidedAt", "priceCents", "gstCents"].sort());
    expect(await loadVariation(db(), await person("CUSTOMER"), f.id)).toBeNull();
    const files = store(); expect(await variationPhotoUrls(db(), files, await person("TRADIE"), f.id)).toEqual([]); expect(files.signedUrl).not.toHaveBeenCalled();
    expect(await variationPhotoUrls(db(), files, f.customer, f.id)).toHaveLength(1);
    const replacement = await person("TRADIE"); await db().job.update({ where: { id: f.job.id }, data: { workerId: replacement.userId } });
    expect(await loadVariation(db(), f.worker, f.id)).toBeNull(); expect(await variationPhotoUrls(db(), files, f.worker, f.id)).toEqual([]);
    expect(await loadVariation(db(), replacement, f.id)).toHaveProperty("workerEarnsCents");
  });

  it("starts one checkout per revision, stays PRICED without an answer/payment, and settles signed webhooks exactly once", async () => {
    const f = await priced(); const { api, rows } = provider();
    const results = await Promise.all([approveVariation(db(), f.customer, f.id, 1, api), approveVariation(db(), f.customer, f.id, 1, api)]);
    expect(results[0]).toEqual(results[1]); const payment = await checkout(f, api);
    expect(await db().variation.findUnique({ where: { id: f.id } })).toMatchObject({ status: "PRICED", decidedAt: null });
    const intent = rows.get(payment.providerPaymentId!)!; const event = success(intent);
    const secret = "whsec_disposable_variation_test", stripe = new Stripe("sk_test_fixture");
    const payload = JSON.stringify(event); const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    const deps = { secret: () => secret, verify: (body: string, sig: string, key: string) => stripe.webhooks.constructEvent(body, sig, key), handle: (evt: Stripe.Event) => handleStripeEvent(db(), evt) };
    const request = (sig: string) => new Request("http://localhost/api/stripe/webhook", { method: "POST", body: payload, headers: { "stripe-signature": sig } });
    expect((await handleWebhookPost(request("invalid"), deps)).status).toBe(400);
    expect(await db().variation.findUnique({ where: { id: f.id } })).toMatchObject({ status: "PRICED" });
    expect((await handleWebhookPost(request(signature), deps)).status).toBe(200);
    expect(await handleStripeEvent(db(), event)).toBe("duplicate");
    expect(await db().variation.findUnique({ where: { id: f.id } })).toMatchObject({ status: "APPROVED", decidedAt: expect.any(Date) });
    expect(await db().notification.count({ where: { type: "variation.approved", userId: f.worker.userId, payload: { path: ["variationId"], equals: f.id } } })).toBe(1);
    expect(await db().auditLog.count({ where: { action: "variation.approved", recordId: f.id, actorId: null } })).toBe(1);
    expect(await db().job.findUnique({ where: { id: f.job.id } })).toMatchObject({ status: "ASSIGNED" });
    expect(await api.create).toHaveBeenCalledTimes(1);
  });

  it("refuses stale/foreign decisions and cancels the old checkout before repricing or declining", async () => {
    const f = await priced(); const { api } = provider(); const payment = await checkout(f, api);
    const foreign = await person("CUSTOMER");
    const denied = await approveVariation(db(), foreign, f.id, 1, api);
    expect(denied).toMatchObject({ error: "not-found", message: expect.any(String) });
    expect(await approveVariation(db(), foreign, randomUUID(), 1, api)).toEqual(denied);
    expect(await priceVariation(db(), f.office, f.id, 1, 45, api)).toMatchObject({ ok: true, revision: 2 });
    expect(api.cancel).toHaveBeenCalledWith(payment.providerPaymentId);
    expect(await preparePayment(db(), api, f.customer.userId, payment.id)).toMatchObject({ error: "not-payable" });
    expect(await approveVariation(db(), f.customer, f.id, 1, api)).toMatchObject({ error: "not-payable" });
    expect(await declineVariation(db(), f.customer, f.id, 1, api)).toMatchObject({ error: "changed" });
    expect(await declineVariation(db(), f.customer, f.id, 2, api)).toMatchObject({ ok: true });
    expect(await declineVariation(db(), f.customer, f.id, 2, api)).toMatchObject({ ok: true });
    expect(await db().notification.count({ where: { type: "variation.declined", userId: f.worker.userId, payload: { path: ["variationId"], equals: f.id } } })).toBe(1);
  });

  it("keeps the quote intact when Stripe is processing/succeeded or cancellation is ambiguous", async () => {
    const f = await priced(); const { api, rows } = provider(); const payment = await checkout(f, api); const intent = rows.get(payment.providerPaymentId!)!;
    intent.status = "processing";
    expect(await declineVariation(db(), f.customer, f.id, 1, api)).toMatchObject({ error: "payment-pending" });
    expect(await priceVariation(db(), f.office, f.id, 1, 45, api)).toMatchObject({ error: "payment-pending" });
    intent.status = "requires_payment_method"; vi.mocked(api.cancel).mockRejectedValueOnce(new Error("lost cancellation response"));
    await expect(priceVariation(db(), f.office, f.id, 1, 45, api)).rejects.toThrow("lost cancellation response");
    expect(await db().variation.findUnique({ where: { id: f.id } })).toMatchObject({ status: "PRICED", revision: 1 });
    intent.status = "succeeded"; expect(await declineVariation(db(), f.customer, f.id, 1, api)).toMatchObject({ error: "payment-pending" });
    expect(await handleStripeEvent(db(), success(intent))).toBe("paid");
  });

  it.each(["CANCELLED", "COMPLETED"] as const)("refuses pricing/approval once the job is %s and holds late money for office review", async status => {
    const f = await priced(); const { api, rows } = provider(); const payment = await checkout(f, api);
    await db().job.update({ where: { id: f.job.id }, data: { status } });
    expect(await priceVariation(db(), f.office, f.id, 1, 45, api)).toMatchObject({ error: "not-in-progress" });
    expect(await approveVariation(db(), f.customer, f.id, 1, api)).toMatchObject({ error: "not-payable" });
    expect(await preparePayment(db(), api, f.customer.userId, payment.id)).toMatchObject({ error: "not-payable" });
    expect(await handleStripeEvent(db(), success(rows.get(payment.providerPaymentId!)!))).toBe("paid");
    expect(await db().payment.findUnique({ where: { id: payment.id } })).toMatchObject({ status: "PAID" });
    expect(await db().variation.findUnique({ where: { id: f.id } })).toMatchObject({ status: "PRICED" });
    expect(await db().notification.count({ where: { type: "payment.review_required", userId: f.office.userId, payload: { path: ["paymentId"], equals: payment.id } } })).toBe(1);
  });

  it("serializes concurrent approve/decline and request/submit with no double decisions", async () => {
    const f = await priced(); const { api } = provider();
    const [approval, decline] = await Promise.all([approveVariation(db(), f.customer, f.id, 1, api), declineVariation(db(), f.customer, f.id, 1, api)]);
    expect(decline.ok).toBe(true);
    if (approval.ok) expect(await db().payment.findUnique({ where: { id: approval.paymentId } })).toMatchObject({ status: "FAILED" });
    const g = await fixture();
    const outcomes = await Promise.allSettled([requestVariation(db(), g.worker, g.input), db().job.update({ where: { id: g.job.id }, data: { status: "SUBMITTED" } })]);
    const current = await db().job.findUniqueOrThrow({ where: { id: g.job.id } }); const extras = await db().variation.count({ where: { jobId: g.job.id } });
    expect(current.status === "SUBMITTED" ? extras === 0 : extras === 1).toBe(true);
    expect(outcomes.some(o => o.status === "fulfilled")).toBe(true);
  });

  it("only counts paid approved minutes in an idempotent payout", async () => {
    const f = await priced(); const { api, rows } = provider(); const payment = await checkout(f, api);
    await handleStripeEvent(db(), success(rows.get(payment.providerPaymentId!)!));
    // A different unanswered request on the same job must not be paid.
    await db().variation.create({ data: { jobId: f.job.id, requestedById: f.worker.userId, description: "Still waiting for a separate extra task", requestedMinutes: 120 } });
    const queued = await db().$transaction(tx => queuePayoutForJob(tx, f.job.id)); expect(queued.queued).toBe(true);
    const payout = await db().payout.findUniqueOrThrow({ where: { jobId_workerId: { jobId: f.job.id, workerId: f.worker.userId } } });
    const pricing = await db().jobPricing.findUniqueOrThrow({ where: { jobId: f.job.id } });
    expect(payout.minutes).toBe(pricing.minutes + 30);
    expect(payout.grossCents).toBe(Math.round((pricing.minutes + 30) * pricing.workerRateCents / 60));
    expect(await db().$transaction(tx => queuePayoutForJob(tx, f.job.id))).toMatchObject({ queued: false, reason: "already-queued" });
  });

  it("rolls back request/audit/notifications together and checks live roles rather than a stale caller", async () => {
    const f = await fixture();
    await db().$executeRawUnsafe(`CREATE FUNCTION "${schema.name}".reject_variation_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'variation.requested' THEN RAISE EXCEPTION 'test audit outage'; END IF; RETURN NEW; END $$`);
    await db().$executeRawUnsafe(`CREATE TRIGGER reject_variation_audit BEFORE INSERT ON "${schema.name}".audit_log FOR EACH ROW EXECUTE FUNCTION "${schema.name}".reject_variation_audit()`);
    try { await expect(requestVariation(db(), f.worker, f.input)).rejects.toThrow("test audit outage"); }
    finally { await db().$executeRawUnsafe(`DROP TRIGGER reject_variation_audit ON "${schema.name}".audit_log`); }
    expect(await db().variation.count({ where: { requestKey: f.input.requestKey } })).toBe(0);
    expect(await db().variationPhoto.findUnique({ where: { path: f.path } })).toMatchObject({ variationId: null });
    await db().profile.update({ where: { id: f.worker.userId }, data: { role: "CUSTOMER" } });
    expect(await requestVariation(db(), f.worker, f.input)).toMatchObject({ error: "forbidden" });
  });

  it("validates real photo bytes, strips metadata, tracks failed puts and retries bounded orphan cleanup", async () => {
    const f = await fixture(); const files = store();
    const bytes = await sharp({ create: { width: 1800, height: 2, channels: 3, background: "white" } }).jpeg().withMetadata().toBuffer();
    const uploaded = await uploadVariationPhoto(db(), files, f.worker, f.job.id, f.input.requestKey, bytes);
    expect(uploaded.ok).toBe(true); if (!uploaded.ok || !("path" in uploaded)) return;
    const metadata = await sharp(files.put.mock.calls[0][2]).metadata(); expect(metadata.format).toBe("webp"); expect(metadata.width).toBeLessThanOrEqual(1600); expect(metadata.exif).toBeUndefined();
    await expect(uploadVariationPhoto(db(), files, f.worker, f.job.id, f.input.requestKey, Buffer.from("fake.jpg"))).rejects.toThrow();
    files.put.mockRejectedValueOnce(new Error("lost put response"));
    await expect(uploadVariationPhoto(db(), files, f.worker, f.job.id, f.input.requestKey, bytes)).rejects.toThrow("lost put response");
    const pending = await db().variationPhoto.findMany({ where: { jobId: f.job.id, ready: false } }); expect(pending).toHaveLength(1);
    const expired = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await db().variationPhoto.updateMany({ where: { jobId: f.job.id }, data: { createdAt: expired } });
    const attached = await requestVariation(db(), f.worker, { ...f.input, photoPaths: [uploaded.path] }); expect(attached.ok).toBe(true);
    files.remove.mockRejectedValueOnce(new Error("delete unavailable"));
    const context = { db: db(), now: new Date(), limit: 10 } as Parameters<ReturnType<typeof variationPhotoCleanup>["run"]>[0];
    expect((await variationPhotoCleanup(() => files).run(context)).failed).toBe(1);
    expect(await db().variationPhoto.count({ where: { jobId: f.job.id, deleting: true } })).toBe(1);
    expect((await variationPhotoCleanup(() => files).run(context)).done).toBe(1);
    expect(await db().variationPhoto.findUnique({ where: { path: uploaded.path } })).toMatchObject({ variationId: expect.any(String) });
  });

  it("enforces server-only RLS/revokes and refuses direct unpaid approval for new requests", async () => {
    const f = await priced();
    await expect(db().variation.update({ where: { id: f.id }, data: { status: "APPROVED" } })).rejects.toThrow("verified payment");
    const rows = await db().$queryRaw<{ relrowsecurity: boolean; policies: bigint }[]>`SELECT c.relrowsecurity, (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = ${schema.name} AND c.relname IN ('variation_photos', 'variations')`;
    expect(rows).toEqual([{ relrowsecurity: true, policies: 0n }, { relrowsecurity: true, policies: 0n }]);
    const grants = await db().$queryRaw<{ grantee: string }[]>`SELECT grantee FROM information_schema.role_table_grants WHERE table_schema = ${schema.name} AND table_name IN ('variation_photos', 'variations') AND grantee IN ('PUBLIC', 'anon', 'authenticated')`;
    expect(grants).toEqual([]);
  });

  it("rolls back verified settlement and retries without losing the worker's notification", async () => {
    const f = await priced(); const { api, rows } = provider(); const payment = await checkout(f, api);
    const event = success(rows.get(payment.providerPaymentId!)!);
    await db().$executeRawUnsafe(`CREATE FUNCTION "${schema.name}".reject_variation_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.type = 'variation.approved' THEN RAISE EXCEPTION 'test notification outage'; END IF; RETURN NEW; END $$`);
    await db().$executeRawUnsafe(`CREATE TRIGGER reject_variation_notice BEFORE INSERT ON "${schema.name}".notifications FOR EACH ROW EXECUTE FUNCTION "${schema.name}".reject_variation_notice()`);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try { await expect(handleStripeEvent(db(), event)).rejects.toThrow(); }
    finally { await db().$executeRawUnsafe(`DROP TRIGGER reject_variation_notice ON "${schema.name}".notifications`); log.mockRestore(); }
    expect(await db().payment.findUnique({ where: { id: payment.id } })).toMatchObject({ status: "PENDING" });
    expect(await db().variation.findUnique({ where: { id: f.id } })).toMatchObject({ status: "PRICED" });
    expect(await db().auditLog.count({ where: { action: "variation.approved", recordId: f.id } })).toBe(0);
    expect(await handleStripeEvent(db(), event)).toBe("paid");
    expect(await db().notification.count({ where: { type: "variation.approved", userId: f.worker.userId, payload: { path: ["variationId"], equals: f.id } } })).toBe(1);
  });

  it("makes concurrent settlement idempotent and serializes repricing versus preparation", async () => {
    const f = await priced(); const { api, rows } = provider(); const payment = await checkout(f, api); const event = success(rows.get(payment.providerPaymentId!)!);
    expect((await Promise.all([handleStripeEvent(db(), event), handleStripeEvent(db(), event)])).sort()).toEqual(["duplicate", "paid"]);
    const g = await priced(); const second = provider();
    const approval = await approveVariation(db(), g.customer, g.id, 1, second.api); if (!approval.ok || !("paymentId" in approval)) throw new Error("No checkout");
    const [prepared, repriced] = await Promise.all([preparePayment(db(), second.api, g.customer.userId, approval.paymentId), priceVariation(db(), g.office, g.id, 1, 45, second.api)]);
    expect(repriced.ok).toBe(true);
    if (prepared.ok && !prepared.paid) expect(second.api.cancel).toHaveBeenCalled();
    expect(await db().payment.findUnique({ where: { id: approval.paymentId } })).toMatchObject({ status: "FAILED" });
    expect(await db().variation.findUnique({ where: { id: g.id } })).toMatchObject({ status: "PRICED", revision: 2 });
  });

  it("refuses foreign, pending, deleting and mismatched-request photos without linking them", async () => {
    const f = await fixture();
    for (const change of [{ uploadedById: randomUUID() }, { jobId: randomUUID() }, { requestKey: randomUUID() }, { ready: false }, { deleting: true }]) {
      await db().variationPhoto.update({ where: { path: f.path }, data: change });
      expect(await requestVariation(db(), f.worker, f.input)).toMatchObject({ error: "photos-pending" });
      await db().variationPhoto.update({ where: { path: f.path }, data: { uploadedById: f.worker.userId, jobId: f.job.id, requestKey: f.input.requestKey, ready: true, deleting: false } });
    }
    const files = store();
    expect(await uploadVariationPhoto(db(), files, await person("TRADIE"), f.job.id, f.input.requestKey, new Uint8Array())).toMatchObject({ error: "not-found" });
    expect(files.put).not.toHaveBeenCalled();
    expect(await startPayment(db(), null, f.customer.userId, { jobId: f.job.id, variationId: randomUUID(), variationRevision: 1 })).toMatchObject({ error: "not-found" });
  });

  it("recovers a canceled Stripe intent when a later reprice audit rolls back, allowing customer retry", async () => {
    const f = await priced(); const { api, rows } = provider(); const payment = await checkout(f, api);
    await db().$executeRawUnsafe(`CREATE FUNCTION "${schema.name}".reject_reprice_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'variation.priced' THEN RAISE EXCEPTION 'test reprice audit outage'; END IF; RETURN NEW; END $$`);
    await db().$executeRawUnsafe(`CREATE TRIGGER reject_reprice_audit BEFORE INSERT ON "${schema.name}".audit_log FOR EACH ROW EXECUTE FUNCTION "${schema.name}".reject_reprice_audit()`);
    try { await expect(priceVariation(db(), f.office, f.id, 1, 45, api)).rejects.toThrow("test reprice audit outage"); }
    finally { await db().$executeRawUnsafe(`DROP TRIGGER reject_reprice_audit ON "${schema.name}".audit_log`); }
    expect(rows.get(payment.providerPaymentId!)?.status).toBe("canceled");
    expect(await db().variation.findUnique({ where: { id: f.id } })).toMatchObject({ status: "PRICED", revision: 1, minutes: 30 });
    expect(await db().payment.findUnique({ where: { id: payment.id } })).toMatchObject({ status: "PENDING" });
    expect(await preparePayment(db(), api, f.customer.userId, payment.id)).toMatchObject({ error: "not-payable" });
    expect(await db().payment.findUnique({ where: { id: payment.id } })).toMatchObject({ status: "FAILED" });
    const retried = await approveVariation(db(), f.customer, f.id, 1, api); if (!retried.ok || !("paymentId" in retried)) throw new Error("No retry checkout");
    expect(retried.paymentId).not.toBe(payment.id);
    expect(await preparePayment(db(), api, f.customer.userId, retried.paymentId)).toMatchObject({ ok: true, paid: false });
  });

  it("prices office-supplied materials with frozen margin/GST, preserves them on reprice, and never pays them as earnings", async () => {
    const f = await requested(); const rates = await db().jobPricing.findUniqueOrThrow({ where: { jobId: f.job.id } });
    for (const materials of [-1, 1.2, NaN, Infinity, 2_147_483_648]) expect(await priceVariation(db(), f.office, f.id, 0, 30, null, materials)).toMatchObject({ error: "invalid" });
    const expected = priceWork({ minutes: 30, materialsCents: 12345 }, rates, { applyMinimum: false });
    expect(await priceVariation(db(), f.office, f.id, 0, 30, null, 12345)).toMatchObject({ ok: true, revision: 1 });
    expect(await db().variation.findUnique({ where: { id: f.id } })).toMatchObject({ materialsCents: 12345, priceCents: expected.customerPriceCents, gstCents: expected.gstCents, marginCents: expected.marginCents, workerGrossCents: expected.workerGrossCents });
    expect(await priceVariation(db(), f.office, f.id, 1, undefined, null)).toMatchObject({ ok: true, revision: 2 });
    expect(await db().variation.findUnique({ where: { id: f.id } })).toMatchObject({ materialsCents: 12345, priceCents: expected.customerPriceCents });
    expect(await priceVariation(db(), f.office, f.id, 2, 30, null, 0)).toMatchObject({ ok: true, revision: 3 });
    expect(await db().variation.findUnique({ where: { id: f.id } })).toMatchObject({ materialsCents: 0 });
    const audit = await db().auditLog.findFirst({ where: { recordId: f.id, action: "variation.priced" }, orderBy: { createdAt: "asc" } });
    expect(audit?.after).toMatchObject({ materialsCents: 12345 });
    const g = await requested();
    expect(await priceVariation(db(), g.office, g.id, 0, 30, null, 12345)).toMatchObject({ ok: true });
    const { api, rows } = provider(); const payment = await checkout(g, api);
    expect(payment.amountCents).toBe(expected.customerPriceCents);
    expect(await handleStripeEvent(db(), success(rows.get(payment.providerPaymentId!)!))).toBe("paid");
    await db().$transaction(tx => queuePayoutForJob(tx, g.job.id));
    const payout = await db().payout.findUniqueOrThrow({ where: { jobId_workerId: { jobId: g.job.id, workerId: g.worker.userId } } });
    expect(payout.grossCents).toBe(Math.round((rates.minutes + 30) * rates.workerRateCents / 60));
  });
});
