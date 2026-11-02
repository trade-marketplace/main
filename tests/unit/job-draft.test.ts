import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { DRAFT_STORAGE_KEY, jobDraftSchema, postJobSchema } from "@/lib/job-draft";
import type { Viewer } from "@/server/auth/viewer";
import type { FileStore } from "@/server/files/storage";
import { draftPhotoUrl, ownsDraftPhoto, uploadDraftPhoto } from "@/server/jobs/draft-photos";

const viewer: Viewer = { userId: randomUUID(), role: "CUSTOMER", email: "test@example.nz", firstName: "Test", emailVerified: true };
const allowed = async () => ({ allowed: true } as const);
function store() {
  return { put: vi.fn(async () => {}), signedUrl: vi.fn(async () => "https://storage.example/signed"), remove: vi.fn(async () => {}) } satisfies FileStore;
}

describe("the shared job draft schema", () => {
  it("exports a stable browser key and validates only entered fields on draft saves", () => {
    expect(DRAFT_STORAGE_KEY).toBe("trade.job-draft.v1");
    expect(jobDraftSchema.parse({})).toEqual({});
    expect(jobDraftSchema.safeParse({ description: "Move a sofa upstairs" }).success).toBe(true);
    expect(jobDraftSchema.safeParse({ description: "short" }).success).toBe(false);
    expect(jobDraftSchema.safeParse({ customerId: randomUUID() }).success).toBe(false);
  });
  it("requires complete details and allows zero through six unique photos at post time", () => {
    const data = { description: "Move a sofa upstairs", category: "OTHER", photoPaths: ["a"], addressLine1: "1 Example St", suburb: "Gladstone", city: "Invercargill", locationSource: "TYPED", anyTime: true };
    expect(postJobSchema.safeParse(data).success).toBe(true);
    expect(postJobSchema.safeParse({ ...data, photoPaths: [] }).success).toBe(true);
    expect(postJobSchema.safeParse({ ...data, photoPaths: ["a", "a"] }).success).toBe(false);
    expect(postJobSchema.safeParse({ ...data, photoPaths: Array.from({ length: 7 }, (_, i) => String(i)) }).success).toBe(false);
    expect(postJobSchema.safeParse({ ...data, locationSource: "PIN" }).success).toBe(false);
    expect(postJobSchema.safeParse({ ...data, description: "x".repeat(1001) }).success).toBe(false);
    expect(postJobSchema.safeParse({ ...data, anyTime: false, asap: true }).success).toBe(false);
  });
});

describe("photos waiting for posting", () => {
  it("reuses image processing and content hashes, strips metadata, and signs owner-only draft previews", async () => {
    const files = store(); const key = randomUUID();
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).png().withMetadata().toBuffer();
    const first = await uploadDraftPhoto(files, viewer, key, bytes, allowed);
    expect(await uploadDraftPhoto(files, viewer, key, bytes, allowed)).toEqual(first);
    if (!first.path) throw new Error("Expected a photo");
    expect(ownsDraftPhoto(viewer.userId, key, first.path)).toBe(true);
    const [bucket, path, output, contentType] = files.put.mock.calls[0] as unknown as [string, string, Uint8Array, string];
    expect(bucket).toBe("photos"); expect(path).toBe(first.path); expect(contentType).toBe("image/webp");
    expect((await sharp(output).metadata()).exif).toBeUndefined();
    expect(await draftPhotoUrl(files, viewer, key.toUpperCase(), path)).toEqual({ url: "https://storage.example/signed", expiresInSeconds: 300 });
    expect(ownsDraftPhoto(viewer.userId, "../../other-user", path)).toBe(false);
    await expect(draftPhotoUrl(files, { ...viewer, userId: randomUUID() }, key, path)).rejects.toMatchObject({ code: "not-found" });
    expect(ownsDraftPhoto(viewer.userId, key, `${path}/../other.webp`)).toBe(false);
  });
  it("refuses noncustomers, unsafe bytes and exhausted upload limits without writing files", async () => {
    const files = store(); const key = randomUUID();
    await expect(uploadDraftPhoto(files, { ...viewer, role: "TRADIE" }, key, new Uint8Array(), allowed)).rejects.toMatchObject({ code: "not-allowed" });
    await expect(uploadDraftPhoto(files, viewer, key, new Uint8Array([1, 2, 3]), allowed)).rejects.toMatchObject({ code: "wrong-type" });
    expect(await uploadDraftPhoto(files, viewer, key, new Uint8Array(), async () => ({ allowed: false, retryAfter: 30 }))).toEqual({ status: "rate-limited", retryAfter: 30 });
    expect(files.put).not.toHaveBeenCalled();
  });
});
