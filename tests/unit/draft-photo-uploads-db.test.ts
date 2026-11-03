import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { PrismaPg } from "@prisma/adapter-pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient, type Role } from "@/generated/prisma/client";
import type { Viewer } from "@/server/auth/viewer";
import type { InspectableFileStore } from "@/server/files/storage";
import { PHOTO_BUCKET } from "@/server/files/storage";
import { loadDraft, saveDraft } from "@/server/jobs/drafts";
import { postJob } from "@/server/jobs/post-job";
import { beginDraftPhoto, cancelDraftPhoto, DRAFT_PHOTO_CLEANUP_MS, DRAFT_PHOTO_RAW_GRACE_MS, DRAFT_PHOTO_TOKEN_MS, finalizeDraftPhoto, MAX_PENDING_DRAFT_PHOTOS, validatePhotoPaths, type PhotoStaging } from "@/server/jobs/photo-upload";
import { draftPhotoCleanup, draftPhotoRawCleanup } from "@/server/jobs/photo-cleanup";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

describe.skipIf(!testDatabaseUrl)("private draft photo lifecycle (Postgres)", () => {
  const schema = useTestSchema(import.meta.filename); const now = new Date("2026-11-03T01:00:00Z");
  beforeEach(async () => { await schema.db.draftPhotoStage.deleteMany(); await schema.db.draftPhotoCleanup.deleteMany(); });
  async function person(role: Role = "CUSTOMER"): Promise<Viewer> {
    const userId = randomUUID(); await schema.db.$executeRaw`INSERT INTO auth.users(id) VALUES (${userId}::uuid)`;
    await schema.db.profile.create({ data: { id: userId, role, email: `${userId}@example.test`, firstName: "Photo", emailVerifiedAt: now } });
    return { userId, role, email: `${userId}@example.test`, firstName: "Photo", emailVerified: true };
  }
  async function setup() { const viewer = await person(); const key = randomUUID(); await saveDraft(schema.db, viewer, { postKey: key, category: "OTHER", description: "Move the garden bench" }); return { viewer, key }; }
  const allowed = async () => ({ allowed: true } as const);
  function stores() {
    const raw = new Map<string, Uint8Array>(); const processed = new Map<string, Uint8Array>();
    const staging: PhotoStaging = { sign: vi.fn(async path => `https://private.test/upload/${path}`), read: vi.fn(async path => { const bytes = raw.get(path); if (!bytes) throw new Error("Missing raw photo"); return bytes; }), remove: vi.fn(async path => { raw.delete(path); }) };
    const files: InspectableFileStore = { put: vi.fn(async (bucket, path, bytes) => { processed.set(`${bucket}:${path}`, bytes); }), exists: vi.fn(async (bucket, path) => processed.has(`${bucket}:${path}`)), signedUrl: vi.fn(async (_bucket, path) => `https://private.test/view/${path}`), remove: vi.fn(async (bucket, paths) => { paths.forEach((path: string) => processed.delete(`${bucket}:${path}`)); }) };
    return { raw, processed, staging, files };
  }
  const jpeg = () => sharp({ create: { width: 2200, height: 1100, channels: 3, background: "red" } }).jpeg().withExif({ IFD0: { Artist: "Private camera metadata" } }).toBuffer();
  async function upload(viewer: Viewer, key: string, storage: ReturnType<typeof stores>, bytes: Uint8Array = new Uint8Array()) {
    if (!bytes.length) bytes = await jpeg();
    const grant = await beginDraftPhoto(schema.db, storage.staging, viewer, key, bytes.length, now, allowed);
    if (grant.status !== "ready") throw new Error("Expected grant"); storage.raw.set(grant.path, bytes);
    const result = await finalizeDraftPhoto(schema.db, storage.staging, storage.files, viewer, key, grant.path, now);
    return { ...result, grant };
  }
  const saveOrder = (viewer: Viewer, key: string, paths: string[], files: InspectableFileStore) => saveDraft(schema.db, viewer, { photoPaths: paths }, {
    expectedPostKey: key, validatePhotos: (tx, postKey, list) => validatePhotoPaths(tx, viewer, postKey, list, () => files),
  });

  it("enables RLS and denies all browser-role grants on both new tables", async () => {
    for (const table of ["draft_photo_stages", "draft_photo_cleanup"]) {
      expect(await schema.db.$queryRawUnsafe(`SELECT relrowsecurity FROM pg_class WHERE oid = '"${schema.name}".${table}'::regclass`)).toEqual([{ relrowsecurity: true }]);
      const grants = await schema.db.$queryRawUnsafe<{ allowed: boolean }[]>(`SELECT has_table_privilege(oid, '"${schema.name}".${table}', 'SELECT,INSERT,UPDATE,DELETE') AS allowed FROM pg_roles WHERE rolname IN ('anon','authenticated')`);
      expect(grants.every(row => !row.allowed)).toBe(true);
    }
  });
  it("bounds concurrent grants and rejects wrong owners, roles, drafts, oversized files and consumed stages", async () => {
    const { viewer, key } = await setup(); const storage = stores(); const bytes = await jpeg();
    const grants = await Promise.all(Array.from({ length: MAX_PENDING_DRAFT_PHOTOS + 2 }, () => beginDraftPhoto(schema.db, storage.staging, viewer, key, bytes.length, now, allowed)));
    expect(grants.filter(grant => grant.status === "ready")).toHaveLength(MAX_PENDING_DRAFT_PHOTOS);
    await expect(beginDraftPhoto(schema.db, storage.staging, viewer, randomUUID(), 1, now, allowed)).rejects.toMatchObject({ code: "not-allowed" });
    await expect(beginDraftPhoto(schema.db, storage.staging, await person("TRADIE"), key, 1, now, allowed)).rejects.toMatchObject({ code: "not-allowed" });
    await expect(beginDraftPhoto(schema.db, storage.staging, viewer, key, 10 * 1024 * 1024 + 1, now, allowed)).rejects.toMatchObject({ code: "too-large" });
    const grant = grants.find(result => result.status === "ready")!; if (grant.status !== "ready") return;
    storage.raw.set(grant.path, bytes);
    await expect(finalizeDraftPhoto(schema.db, storage.staging, storage.files, await person(), key, grant.path, now)).rejects.toMatchObject({ code: "not-allowed" });
    await finalizeDraftPhoto(schema.db, storage.staging, storage.files, viewer, key, grant.path, now);
    await expect(finalizeDraftPhoto(schema.db, storage.staging, storage.files, viewer, key, grant.path, now)).rejects.toMatchObject({ code: "not-allowed" });
  });
  it("validates actual bytes/length and writes a unique metadata-free WebP through116", async () => {
    const { viewer, key } = await setup(); const storage = stores(); const bytes = await jpeg();
    const first = await upload(viewer, key, storage, bytes); const second = await upload(viewer, key, storage, bytes);
    expect(first.path).not.toBe(second.path); expect(first.path).toMatch(new RegExp(`^drafts/${viewer.userId}/${key}/[a-f0-9]{32}\\.webp$`));
    const output = storage.processed.get(`${PHOTO_BUCKET}:${first.path}`)!; const metadata = await sharp(output).metadata();
    expect(metadata).toMatchObject({ format: "webp", width: 1600, height: 800 }); expect(metadata.exif).toBeUndefined();
    expect(storage.raw.size).toBe(0); expect(await schema.db.draftPhotoStage.count()).toBe(2);
    const bad = await beginDraftPhoto(schema.db, storage.staging, viewer, key, 1, now, allowed); if (bad.status !== "ready") throw new Error("Expected grant"); storage.raw.set(bad.path, bytes);
    await expect(finalizeDraftPhoto(schema.db, storage.staging, storage.files, viewer, key, bad.path, now)).rejects.toMatchObject({ code: "unreadable" });
    const wrong = new TextEncoder().encode("%PDF-1.7 wrong kind"); await expect(upload(viewer, key, storage, wrong)).rejects.toMatchObject({ code: "wrong-type" });
    expect(await saveOrder(viewer, key, [first.path, second.path], storage.files)).toEqual({ status: "saved" });
    expect((await loadDraft(schema.db, viewer))?.photoPaths).toEqual([first.path, second.path]);
    expect(await saveOrder(viewer, randomUUID(), [], storage.files)).toEqual({ status: "forbidden" });
  });
  it("keeps raw tracking through signed-token expiry and removes late recreated uploads with retry", async () => {
    const { viewer, key } = await setup(); const storage = stores(); const photo = await upload(viewer, key, storage);
    storage.raw.set(photo.grant.path, new Uint8Array([1, 2, 3]));
    const rule = draftPhotoRawCleanup(() => storage.staging);
    expect((await rule.run({ db: schema.db, now: new Date(now.getTime() + DRAFT_PHOTO_TOKEN_MS), limit: 10 })).done).toBe(0);
    vi.mocked(storage.staging.remove).mockRejectedValueOnce(new Error("Temporary deletion failure"));
    const afterExpiry = new Date(now.getTime() + DRAFT_PHOTO_TOKEN_MS + DRAFT_PHOTO_RAW_GRACE_MS + 1);
    expect((await rule.run({ db: schema.db, now: afterExpiry, limit: 10 })).failed).toBe(1);
    expect(await schema.db.draftPhotoStage.findUnique({ where: { path: photo.grant.path } })).not.toBeNull();
    expect((await rule.run({ db: schema.db, now: afterExpiry, limit: 10 })).done).toBe(1); expect(storage.raw.size).toBe(0);
  });
  it("can cancel an abandoned grant without discarding its raw cleanup record", async () => {
    const { viewer, key } = await setup(); const storage = stores(); const grant = await beginDraftPhoto(schema.db, storage.staging, viewer, key, 1, now, allowed); if (grant.status !== "ready") throw new Error("Expected grant");
    await cancelDraftPhoto(schema.db, await person(), grant.path); expect((await schema.db.draftPhotoStage.findUniqueOrThrow({ where: { path: grant.path } })).finalizedAt).toBeNull();
    await cancelDraftPhoto(schema.db, viewer, grant.path); expect((await schema.db.draftPhotoStage.findUniqueOrThrow({ where: { path: grant.path } })).finalizedAt).not.toBeNull();
    await expect(finalizeDraftPhoto(schema.db, storage.staging, storage.files, viewer, key, grant.path, now)).rejects.toMatchObject({ code: "not-allowed" });
  });
  it("commits the cleanup intent before put even with a max1 primary pool, and collects an ambiguous failed put", async () => {
    const { viewer, key } = await setup(); const storage = stores(); const primary = new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl!, max: 1 }, { schema: schema.name }) });
    try {
      const bytes = await jpeg(); const grant = await beginDraftPhoto(primary, storage.staging, viewer, key, bytes.length, now, allowed); if (grant.status !== "ready") throw new Error("Expected grant"); storage.raw.set(grant.path, bytes);
      vi.mocked(storage.files.put).mockImplementationOnce(async (bucket, path, value) => {
        expect(await schema.db.draftPhotoCleanup.findUnique({ where: { path } })).toMatchObject({ userId: viewer.userId });
        storage.processed.set(`${bucket}:${path}`, value); throw new Error("Response lost after put");
      });
      await expect(finalizeDraftPhoto(primary, storage.staging, storage.files, viewer, key, grant.path, now)).rejects.toThrow("Response lost");
      const result = await draftPhotoCleanup(() => storage.files).run({ db: schema.db, now: new Date(now.getTime() + DRAFT_PHOTO_CLEANUP_MS + 1), limit: 10 });
      expect(result.done).toBe(1); expect(storage.processed.size).toBe(0);
    } finally { await primary.$disconnect(); }
  });
  it("preserves ordered draft/job references, then collects removed photos and survives account cascades", async () => {
    const { viewer, key } = await setup(); const storage = stores(); const photo = await upload(viewer, key, storage);
    await saveOrder(viewer, key, [photo.path], storage.files);
    const future = new Date(now.getTime() + DRAFT_PHOTO_CLEANUP_MS + 1); const rule = draftPhotoCleanup(() => storage.files);
    expect((await rule.run({ db: schema.db, now: future, limit: 10 })).skipped).toBe(1); expect(storage.processed.size).toBe(1);
    const input = { description: "Move the garden bench", category: "OTHER", photoPaths: [photo.path], addressLine1: "1 Example St", suburb: "Gladstone", city: "Invercargill", locationSource: "SEARCH", point: { lat: -46.4132, lng: 168.3538 }, anyTime: true };
    const posted = await postJob(schema.db, viewer, input, key, { now: () => now, photoExists: async path => storage.files.exists(PHOTO_BUCKET, path), rateLimit: allowed, notifyWorkers: async () => {} });
    expect(posted.status).toBe("posted");
    expect((await rule.run({ db: schema.db, now: new Date(future.getTime() + DRAFT_PHOTO_CLEANUP_MS), limit: 10 })).skipped).toBe(1);
    if (posted.status === "posted") await schema.db.job.delete({ where: { id: posted.jobId } });
    await schema.db.$executeRaw`DELETE FROM auth.users WHERE id=${viewer.userId}::uuid`;
    expect(await schema.db.draftPhotoCleanup.findUnique({ where: { path: photo.path } })).not.toBeNull();
    expect((await rule.run({ db: schema.db, now: new Date(future.getTime() + 2 * DRAFT_PHOTO_CLEANUP_MS), limit: 10 })).done).toBe(1);
  });
  it("persists deletion tombstones across failures and rejects late saves or posts referencing them", async () => {
    const { viewer, key } = await setup(); const storage = stores(); const photo = await upload(viewer, key, storage); const future = new Date(now.getTime() + DRAFT_PHOTO_CLEANUP_MS + 1);
    vi.mocked(storage.files.remove).mockRejectedValueOnce(new Error("Ambiguous remove"));
    const rule = draftPhotoCleanup(() => storage.files); expect((await rule.run({ db: schema.db, now: future, limit: 10 })).failed).toBe(1);
    expect(await schema.db.draftPhotoCleanup.findUnique({ where: { path: photo.path } })).toMatchObject({ deleting: true });
    expect(await saveOrder(viewer, key, [photo.path], storage.files)).toMatchObject({ status: "invalid", fields: { photoPaths: "Add some photos" } });
    expect(await postJob(schema.db, viewer, { description: "Move the garden bench", category: "OTHER", photoPaths: [photo.path], addressLine1: "1 Example St", suburb: "Gladstone", city: "Invercargill", locationSource: "SEARCH", point: { lat: -46.4132, lng: 168.3538 }, anyTime: true }, key, { now: () => now, photoExists: async () => true, rateLimit: allowed, notifyWorkers: async () => {} })).toEqual({ status: "photos-pending" });
    expect((await rule.run({ db: schema.db, now: future, limit: 10 })).done).toBe(1);
  });
  it("serializes a concurrent late attachment with reference-check/delete", async () => {
    const { viewer, key } = await setup(); const storage = stores(); const photo = await upload(viewer, key, storage);
    let release!: () => void; let entered!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); const started = new Promise<void>(resolve => { entered = resolve; });
    vi.mocked(storage.files.remove).mockImplementationOnce(async (bucket, paths) => { entered(); await gate; paths.forEach(path => storage.processed.delete(`${bucket}:${path}`)); });
    const cleanup = draftPhotoCleanup(() => storage.files).run({ db: schema.db, now: new Date(now.getTime() + DRAFT_PHOTO_CLEANUP_MS + 1), limit: 10 });
    await started; let resolved = false;
    const attaching = saveOrder(viewer, key, [photo.path], storage.files).then(result => { resolved = true; return result; });
    await new Promise(resolve => setTimeout(resolve, 20)); expect(resolved).toBe(false); release();
    expect((await cleanup).done).toBe(1); expect(await attaching).toMatchObject({ status: "invalid" });
    expect((await loadDraft(schema.db, viewer))?.photoPaths ?? []).toEqual([]);
  });
});
