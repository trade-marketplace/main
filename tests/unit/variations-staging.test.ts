import { randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import type { FileStore } from "@/server/files/storage";
import { MAX_UPLOAD_BYTES } from "@/server/files/images";
import { beginVariationStage, finishVariationStage, VARIATION_STAGE_MS, VARIATION_STAGE_GRACE_MS, type VariationStaging } from "@/server/variations/staging";
import { variationStageCleanup } from "@/server/scheduler/variation-stage-cleanup";
import { requestVariation } from "@/server/variations/request";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

describe.skipIf(!testDatabaseUrl)("10 MB private variation staging transport", () => {
  const schema = useTestSchema(import.meta.filename);
  const now = new Date("2026-11-03T03:00:00Z");
  const limit = vi.fn(async () => ({ allowed: true } as const));
  async function person(role: "TRADIE" | "CUSTOMER") {
    const id = randomUUID(); await schema.db.$executeRaw`INSERT INTO auth.users (id) VALUES (${id}::uuid)`;
    await schema.db.profile.create({ data: { id, email: `${id}@example.nz`, role, firstName: "Test" } }); return { userId: id };
  }
  async function fixture() {
    const worker = await person("TRADIE"), customer = await person("CUSTOMER");
    const job = await schema.db.job.create({ data: { customerId: customer.userId, workerId: worker.userId, title: "Example work", description: "Example work in progress", category: "OTHER", addressLine1: "1 Example St", suburb: "Gladstone", city: "Invercargill", status: "ASSIGNED", priceCents: 10000 } });
    const staging: VariationStaging = { sign: vi.fn(async path => `https://storage.example/upload/${path}`), read: vi.fn(async () => new Uint8Array()), remove: vi.fn(async () => {}) };
    const store: FileStore = { put: vi.fn(async () => {}), signedUrl: vi.fn(async () => "https://files.example/signed"), remove: vi.fn(async () => {}) };
    return { worker, customer, job, requestKey: randomUUID(), staging, store };
  }
  async function begin(f: Awaited<ReturnType<typeof fixture>>, size = 2 * 1024 * 1024) {
    const result = await beginVariationStage(schema.db, f.staging, f.worker, f.job.id, f.requestKey, size, now, limit);
    if (!result.ok || !("stageId" in result)) throw new Error("No stage"); return result;
  }

  it("moves >1 MB bytes outside the action payload, processes real bytes, and replays one completed path", async () => {
    const f = await fixture();
    const bytes = await sharp(randomBytes(1024 * 1024 * 3), { raw: { width: 1024, height: 1024, channels: 3 } }).png().withMetadata().toBuffer();
    expect(bytes.byteLength).toBeGreaterThan(1024 * 1024);
    vi.mocked(f.staging.read).mockResolvedValue(bytes);
    const grant = await begin(f, bytes.byteLength);
    const result = await finishVariationStage(schema.db, f.staging, f.store, f.worker, grant.stageId, now);
    expect(result.ok).toBe(true); if (!result.ok || !("path" in result)) return;
    expect(await finishVariationStage(schema.db, f.staging, f.store, f.worker, grant.stageId, now)).toEqual(result);
    expect(f.staging.read).toHaveBeenCalledTimes(1); expect(f.store.put).toHaveBeenCalledTimes(1);
    const saved = vi.mocked(f.store.put).mock.calls[0]; expect(saved[0]).toBe("photos"); expect(saved[1]).toMatch(/\.webp$/);
    const metadata = await sharp(saved[2]).metadata(); expect(metadata.format).toBe("webp"); expect(metadata.exif).toBeUndefined();
    expect(await requestVariation(schema.db, f.worker, { jobId: f.job.id, requestKey: f.requestKey, description: "Extra photographed work", hours: 0.5, photoPaths: [result.path] })).toMatchObject({ ok: true });
    expect(await schema.db.variationUploadStage.findUnique({ where: { id: grant.stageId } })).toMatchObject({ photoPath: result.path, finalizedAt: now });
    // The token could re-upload after finalize's early delete; retain its record and delete again after expiry.
    expect((await variationStageCleanup(() => f.staging).run({ db: schema.db, now: new Date(now.getTime() + VARIATION_STAGE_MS + VARIATION_STAGE_GRACE_MS), limit: 10 } as Parameters<ReturnType<typeof variationStageCleanup>["run"]>[0])).done).toBe(1);
    expect(f.staging.remove).toHaveBeenCalledTimes(2);
    expect(await schema.db.variationPhoto.findUnique({ where: { path: result.path } })).toMatchObject({ variationId: expect.any(String) });
  });

  it("rejects invalid sizes/foreign workers/closed jobs before signing and honors rate limits", async () => {
    const f = await fixture();
    for (const size of [0, -1, 0.5, MAX_UPLOAD_BYTES + 1, Infinity]) expect(await beginVariationStage(schema.db, f.staging, f.worker, f.job.id, f.requestKey, size, now, limit)).toMatchObject({ error: "invalid" });
    expect(await beginVariationStage(schema.db, f.staging, await person("TRADIE"), f.job.id, f.requestKey, 100, now, limit)).toMatchObject({ error: "not-found" });
    expect(await beginVariationStage(schema.db, f.staging, f.customer, f.job.id, f.requestKey, 100, now, limit)).toMatchObject({ error: "forbidden" });
    expect(await beginVariationStage(schema.db, f.staging, f.worker, f.job.id, f.requestKey, 100, now, async () => ({ allowed: false, retryAfter: 60 }))).toMatchObject({ error: "photos-pending" });
    expect(f.staging.sign).not.toHaveBeenCalled();
    await schema.db.job.update({ where: { id: f.job.id }, data: { status: "CANCELLED" } });
    expect(await beginVariationStage(schema.db, f.staging, f.worker, f.job.id, f.requestKey, 100, now, limit)).toMatchObject({ error: "not-in-progress" });
  });

  it("caps concurrent unfinalized grants at ten and tracks a lost signing response", async () => {
    const f = await fixture();
    const results = await Promise.all(Array.from({ length: 11 }, () => beginVariationStage(schema.db, f.staging, f.worker, f.job.id, f.requestKey, 100, now, limit)));
    expect(results.filter(r => r.ok)).toHaveLength(10); expect(results.filter(r => !r.ok)).toHaveLength(1);
    const other = await fixture(); vi.mocked(other.staging.sign).mockRejectedValueOnce(new Error("lost sign response"));
    await expect(begin(other)).rejects.toThrow("lost sign response");
    expect(await schema.db.variationUploadStage.count({ where: { userId: other.worker.userId } })).toBe(1);
  });

  it("binds finalize to owner/current job/request and validates the raw image before attachment", async () => {
    const f = await fixture(); const grant = await begin(f);
    expect(await finishVariationStage(schema.db, f.staging, f.store, await person("TRADIE"), grant.stageId, now)).toMatchObject({ error: "not-found" });
    expect(f.staging.read).not.toHaveBeenCalled();
    vi.mocked(f.staging.read).mockResolvedValue(Buffer.from("not a jpg"));
    await expect(finishVariationStage(schema.db, f.staging, f.store, f.worker, grant.stageId, now)).rejects.toThrow();
    expect(f.store.put).not.toHaveBeenCalled();
    expect(await finishVariationStage(schema.db, f.staging, f.store, f.worker, grant.stageId, now)).toMatchObject({ error: "photos-pending" });
    const otherGrant = await begin(f); const replacement = await person("TRADIE");
    await schema.db.job.update({ where: { id: f.job.id }, data: { workerId: replacement.userId } });
    expect(await finishVariationStage(schema.db, f.staging, f.store, f.worker, otherGrant.stageId, now)).toMatchObject({ error: "not-found" });
    expect(await finishVariationStage(schema.db, f.staging, f.store, replacement, otherGrant.stageId, now)).toMatchObject({ error: "not-found" });
  });

  it("rejects over-limit actual bytes, expires grants, and retries token-lifetime cleanup", async () => {
    const f = await fixture(); const grant = await begin(f, 100);
    vi.mocked(f.staging.read).mockResolvedValue(new Uint8Array(MAX_UPLOAD_BYTES + 1));
    await expect(finishVariationStage(schema.db, f.staging, f.store, f.worker, grant.stageId, now)).rejects.toThrow();
    expect(f.store.put).not.toHaveBeenCalled();
    const expired = new Date(now.getTime() + VARIATION_STAGE_MS + 1);
    await schema.db.variationUploadStage.updateMany({ where: { id: { not: grant.stageId } }, data: { expiresAt: new Date(expired.getTime() + VARIATION_STAGE_GRACE_MS + 60_000) } });
    expect(await finishVariationStage(schema.db, f.staging, f.store, f.worker, grant.stageId, expired)).toMatchObject({ error: "not-found" });
    const context = { db: schema.db, now: expired, limit: 10 } as Parameters<ReturnType<typeof variationStageCleanup>["run"]>[0];
    expect((await variationStageCleanup(() => f.staging).run(context)).due).toBe(0);
    context.now = new Date(expired.getTime() + VARIATION_STAGE_GRACE_MS);
    vi.mocked(f.staging.remove).mockRejectedValueOnce(new Error("delete unavailable")); const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try { expect((await variationStageCleanup(() => f.staging).run(context)).failed).toBe(1); }
    finally { log.mockRestore(); }
    expect(await schema.db.variationUploadStage.count({ where: { id: grant.stageId } })).toBe(1);
    expect((await variationStageCleanup(() => f.staging).run(context)).done).toBe(1);
    expect(await schema.db.variationUploadStage.count({ where: { id: grant.stageId } })).toBe(0);
    const security = await schema.db.$queryRaw<{ relrowsecurity: boolean; policies: bigint }[]>`SELECT c.relrowsecurity, (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = ${schema.name} AND c.relname = 'variation_upload_stages'`;
    expect(security).toEqual([{ relrowsecurity: true, policies: 0n }]);
  });
});
