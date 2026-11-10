import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/generated/prisma/client";
import { readOfficeVariationPreview, publishOfficeVariation } from "@/server/office/variation-commands";
import { readVariationPricing } from "@/server/office/variation-read";
import { priceVariation } from "@/server/variations/price";
import { variationPhotoUrls } from "@/server/variations/photos";
import { priceJob } from "@/server/pricing/price-job";
import { priceWork } from "@/server/pricing/calculate";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

const fields = { hours: "0.5", materials: "10.00" };
describe.skipIf(!testDatabaseUrl)("extra-work office confirmation with PostgreSQL", () => {
  const schema = useTestSchema(import.meta.filename);
  beforeEach(async () => { await schema.db.settings.update({ where: { id: 1 }, data: { sharedRateCents: 7000, holidayPayBps: 800, onCostBps: 1250, marginBps: 2000, gstBps: 1500 } }); });
  async function person(role: Role) {
    const userId = randomUUID(); await schema.db.$executeRaw`INSERT INTO auth.users(id) VALUES(${userId}::uuid)`;
    await schema.db.profile.create({ data: { id: userId, role, email: `${userId}@example.test`, firstName: role } });
    return { userId, role };
  }
  async function fixture() {
    const office = await person("ADMIN"), customer = await person("CUSTOMER"), worker = await person("TRADIE");
    const job = await schema.db.job.create({ data: { customerId: customer.userId, title: "Sub wiring", description: "Replace a switch", category: "ELECTRICAL", addressLine1: "Private address canary", suburb: "Windsor", city: "Invercargill" } });
    await priceJob(schema.db, { jobId: job.id, minutes: 120, materialsCents: 0 });
    await schema.db.job.update({ where: { id: job.id }, data: { status: "ASSIGNED", workerId: worker.userId } });
    const variation = await schema.db.variation.create({ data: { jobId: job.id, requestedById: worker.userId, description: "Replace second cracked switch", requestedMinutes: 30, requestedMaterialsCents: 1000, requestKey: randomUUID() } });
    return { office, customer, worker, job, variation };
  }
  async function confirmation(f: Awaited<ReturnType<typeof fixture>>) {
    const response = await readOfficeVariationPreview(schema.db, f.office, { variationId: f.variation.id, revision: f.variation.revision, ...fields });
    if (!response.ok) throw new Error(response.error);
    return { variationId: f.variation.id, revision: f.variation.revision, ...fields, token: response.preview.token, requestId: randomUUID() };
  }
  it("previews without writes using frozen rates and no second minimum, atomically publishes once and safely replays", async () => {
    const f = await fixture(), before = await schema.db.job.findUniqueOrThrow({ where: { id: f.job.id } }), frozen = await schema.db.jobPricing.findUniqueOrThrow({ where: { jobId: f.job.id } });
    const input = await confirmation(f);
    expect(await schema.db.job.findUniqueOrThrow({ where: { id: f.job.id } })).toEqual(before);
    expect(await schema.db.variation.findUniqueOrThrow({ where: { id: f.variation.id } })).toEqual(f.variation);
    expect(await schema.db.auditLog.count({ where: { recordId: f.variation.id } })).toBe(0);
    await schema.db.settings.update({ where: { id: 1 }, data: { sharedRateCents: frozen.workerRateCents + 1000 } });
    const expected = priceWork({ minutes: 30, materialsCents: 1000 }, frozen, { applyMinimum: false });
    expect(await publishOfficeVariation(schema.db, f.office, input)).toEqual({ ok: true });
    const saved = await schema.db.variation.findUniqueOrThrow({ where: { id: f.variation.id } });
    expect(saved).toMatchObject({ status: "PRICED", revision: 1, minutes: 30, requestedMinutes: 30, requestedMaterialsCents: 1000, priceCents: expected.customerPriceCents, workerGrossCents: expected.workerGrossCents });
    const sentJob = await schema.db.job.findUniqueOrThrow({ where: { id: f.job.id } });
    expect(await schema.db.jobPricing.findUniqueOrThrow({ where: { jobId: f.job.id } })).toEqual(frozen);
    expect(await publishOfficeVariation(schema.db, f.office, input)).toEqual({ ok: true });
    expect(await schema.db.job.findUniqueOrThrow({ where: { id: f.job.id } })).toEqual(sentJob);
    const audit = await schema.db.auditLog.findMany({ where: { recordId: f.variation.id, action: "variation.priced" } });
    expect(audit).toHaveLength(1); expect(audit[0].after).toMatchObject({ requestId: input.requestId, confirmationDigest: input.token });
    const notices = await schema.db.notification.findMany({ where: { userId: f.customer.userId, type: "variation.priced" } });
    expect(notices).toHaveLength(1); expect(notices[0].payload).toMatchObject({ variationId: f.variation.id, jobId: f.job.id });
    expect(JSON.stringify(notices)).not.toMatch(/workerGross|marginCents|workerRate|requestedMinutes/);
    expect(await schema.db.notification.count({ where: { userId: f.worker.userId } })).toBe(0);
    expect(await publishOfficeVariation(schema.db, f.office, { ...input, hours: "1" })).toMatchObject({ error: "changed" });
  });
  it("serializes simultaneous confirmations and identical retries without duplicate revisions or notifications", async () => {
    const f = await fixture(), input = await confirmation(f);
    const results = await Promise.all([publishOfficeVariation(schema.db, f.office, input), publishOfficeVariation(schema.db, f.office, input)]);
    expect(results).toEqual([{ ok: true }, { ok: true }]);
    expect(await publishOfficeVariation(schema.db, f.office, { ...input, requestId: randomUUID() })).toMatchObject({ error: "changed" });
    expect(await schema.db.variation.findUniqueOrThrow({ where: { id: f.variation.id } })).toMatchObject({ revision: 1 });
    expect(await schema.db.notification.count({ where: { type: "variation.priced", userId: f.customer.userId } })).toBe(1);
    const other = await fixture(), otherInput = await confirmation(other);
    const distinct = await Promise.all([publishOfficeVariation(schema.db, other.office, otherInput), publishOfficeVariation(schema.db, other.office, { ...otherInput, requestId: randomUUID() })]);
    expect(distinct.filter(result => result.ok)).toHaveLength(1);
    expect(distinct.filter(result => !result.ok)).toEqual([expect.objectContaining({ error: "changed" })]);
  });
  it.each(["description", "revision", "worker", "photos"])("rejects a stale %s confirmation and rolls back lock writes", async change => {
    const f = await fixture(), input = await confirmation(f);
    if (change === "description") await schema.db.variation.update({ where: { id: f.variation.id }, data: { description: "Changed request" } });
    if (change === "revision") await priceVariation(schema.db, f.office, f.variation.id, 0);
    if (change === "worker") await schema.db.job.update({ where: { id: f.job.id }, data: { workerId: (await person("TRADIE")).userId } });
    if (change === "photos") await schema.db.variationPhoto.create({ data: { jobId: f.job.id, variationId: f.variation.id, uploadedById: f.worker.userId, requestKey: randomUUID(), ready: true, path: `variations/${f.job.id}/${randomUUID()}.webp` } });
    const before = await schema.db.job.findUniqueOrThrow({ where: { id: f.job.id } }), audits = await schema.db.auditLog.count({ where: { recordId: f.variation.id } });
    expect(await publishOfficeVariation(schema.db, f.office, input)).toMatchObject({ error: "changed" });
    expect(await schema.db.job.findUniqueOrThrow({ where: { id: f.job.id } })).toEqual(before);
    expect(await schema.db.auditLog.count({ where: { recordId: f.variation.id } })).toBe(audits);
  });
  it("rechecks office capability and never signs or returns a private request to a non-office viewer", async () => {
    const f = await fixture(), input = await confirmation(f), sign = vi.fn(async () => []);
    for (const viewer of [f.customer, f.worker]) await expect(readVariationPricing(schema.db, viewer, f.variation.id, sign)).rejects.toThrow();
    expect(sign).not.toHaveBeenCalled();
    await schema.db.profile.update({ where: { id: f.office.userId }, data: { role: "CUSTOMER" } });
    expect(await publishOfficeVariation(schema.db, f.office, input)).toMatchObject({ error: "forbidden" });
    await expect(readVariationPricing(schema.db, f.office, f.variation.id, sign)).rejects.toThrow();
  });
  it("lets current office use canonical private-photo signing without admitting unrelated users", async () => {
    const f = await fixture(), path = `variations/${f.job.id}/${f.worker.userId}/${randomUUID().replaceAll("-", "")}.webp`;
    await schema.db.variationPhoto.create({ data: { path, jobId: f.job.id, variationId: f.variation.id, uploadedById: f.worker.userId, requestKey: f.variation.requestKey!, ready: true } });
    const store = { put: vi.fn(async () => {}), remove: vi.fn(async () => {}), signedUrl: vi.fn(async () => "https://files.example/private-photo?expires=300") };
    expect(await variationPhotoUrls(schema.db, store, f.office, f.variation.id)).toHaveLength(1);
    expect(store.signedUrl).toHaveBeenCalledWith("photos", path, 300);
    store.signedUrl.mockClear();
    expect(await variationPhotoUrls(schema.db, store, await person("CUSTOMER"), f.variation.id)).toEqual([]); expect(store.signedUrl).not.toHaveBeenCalled();
  });
  it("refuses ended jobs and terminal variations, retains stored prices and handles failed private-photo signing", async () => {
    for (const status of ["APPROVED", "DECLINED"] as const) {
      const f = await fixture(), input = await confirmation(f); await publishOfficeVariation(schema.db, f.office, input);
      const stored = await readVariationPricing(schema.db, f.office, f.variation.id);
      if (status === "APPROVED") await schema.db.payment.create({ data: { jobId: f.job.id, variationId: f.variation.id, variationRevision: 1, kind: "VARIATION", status: "PAID", amountCents: 7250, paidAt: new Date(), idempotencyKey: randomUUID() } });
      await schema.db.variation.update({ where: { id: f.variation.id }, data: { status } });
      const data = await readVariationPricing(schema.db, f.office, f.variation.id);
      expect(data).toMatchObject({ canPrice: false, preview: { total: stored?.preview?.total } });
      expect(await publishOfficeVariation(schema.db, f.office, { ...input, requestId: randomUUID() })).toMatchObject({ error: "not-in-progress" });
    }
    const f = await fixture();
    await schema.db.job.update({ where: { id: f.job.id }, data: { status: "CANCELLED" } });
    expect((await readVariationPricing(schema.db, f.office, f.variation.id))?.canPrice).toBe(false);
    await schema.db.variationPhoto.create({ data: { jobId: f.job.id, variationId: f.variation.id, uploadedById: f.worker.userId, requestKey: randomUUID(), ready: true, path: `variations/${f.job.id}/${randomUUID()}.webp` } });
    const data = await readVariationPricing(schema.db, f.office, f.variation.id, async () => { throw new Error("private storage canary"); });
    expect(data).toMatchObject({ photos: [], photosFailed: true }); expect(JSON.stringify(data)).not.toMatch(/storage canary|path|workerRate|Private address/);
  });
  it("matches canonical input limits and rolls back pricing and audit when the notification insert fails", async () => {
    const f = await fixture();
    expect(await readOfficeVariationPreview(schema.db, f.office, { variationId: f.variation.id, revision: 0, hours: "101", materials: "0" })).toMatchObject({ error: "invalid", field: "hours" });
    const input = await confirmation(f), before = await schema.db.job.findUniqueOrThrow({ where: { id: f.job.id } });
    await schema.db.$executeRawUnsafe(`CREATE FUNCTION "${schema.name}".reject_variation_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated outbox outage'; END; $$`);
    await schema.db.$executeRawUnsafe(`CREATE TRIGGER reject_variation_notice BEFORE INSERT ON "${schema.name}".notifications FOR EACH ROW EXECUTE FUNCTION "${schema.name}".reject_variation_notice()`);
    try { await expect(publishOfficeVariation(schema.db, f.office, input)).rejects.toThrow(); }
    finally { await schema.db.$executeRawUnsafe(`DROP TRIGGER reject_variation_notice ON "${schema.name}".notifications`); await schema.db.$executeRawUnsafe(`DROP FUNCTION "${schema.name}".reject_variation_notice()`); }
    expect(await schema.db.job.findUniqueOrThrow({ where: { id: f.job.id } })).toEqual(before);
    expect(await schema.db.variation.findUniqueOrThrow({ where: { id: f.variation.id } })).toEqual(f.variation);
    expect(await schema.db.auditLog.count({ where: { recordId: f.variation.id } })).toBe(0);
  });
  it("preserves an in-flight payment and its published price when the provider is unavailable", async () => {
    const f = await fixture(); await publishOfficeVariation(schema.db, f.office, await confirmation(f));
    const preview = await readOfficeVariationPreview(schema.db, f.office, { variationId: f.variation.id, revision: 1, hours: "1", materials: "20" });
    if (!preview.ok) throw new Error(preview.error);
    const payment = await schema.db.payment.create({ data: { jobId: f.job.id, variationId: f.variation.id, variationRevision: 1, kind: "VARIATION", amountCents: 7250, idempotencyKey: randomUUID(), providerPaymentId: "pi_local_in_flight" } });
    const before = await schema.db.variation.findUniqueOrThrow({ where: { id: f.variation.id } });
    expect(await publishOfficeVariation(schema.db, f.office, { variationId: f.variation.id, revision: 1, hours: "1", materials: "20", token: preview.preview.token, requestId: randomUUID() })).toMatchObject({ error: "payment-pending" });
    expect(await schema.db.variation.findUniqueOrThrow({ where: { id: f.variation.id } })).toEqual(before);
    expect(await schema.db.payment.findUniqueOrThrow({ where: { id: payment.id } })).toEqual(payment);
    expect(await schema.db.auditLog.count({ where: { recordId: f.variation.id, action: "variation.priced" } })).toBe(1);
    expect(await schema.db.notification.count({ where: { type: "variation.priced", userId: f.customer.userId } })).toBe(1);
  });
});
