import { describe, expect, it } from "vitest";
import { canResumeSavedPhotos, ownsDraftPhoto } from "@/lib/jobs/draft-photo-path";
import type { PhotoSnapshot } from "@/lib/jobs/draft-photo-manager";

const owner = "11111111-1111-4111-8111-111111111113";
const key = "9b58063b-12c2-4b46-9c45-38353f41173e";
const path = `drafts/${owner}/${key}/${"a".repeat(32)}.webp`;
const empty: PhotoSnapshot = { photos: [], problems: [], restoring: false, saving: false, storageError: false };
const done: PhotoSnapshot = { ...empty, photos: [{ id: "one", name: "photo.webp", path, src: "signed-preview", status: "done", progress: 1, prepared: true, generation: 1 }] };

describe("owned saved photo-step recovery", () => {
  it("allows the valid zero-photo path and the exact acknowledged owned order", () => {
    expect(canResumeSavedPhotos(owner, key, [], empty)).toBe(true);
    expect(canResumeSavedPhotos(owner, key, [path], done)).toBe(true);
    expect(canResumeSavedPhotos(owner, key, [path], { ...done, photos: [{ ...done.photos[0], file: new File(["cached"], "cached.webp") }] })).toBe(true);
  });
  it("rejects unknown, duplicate, oversized, foreign or malformed canonical paths", () => {
    expect(ownsDraftPhoto(owner, key, path)).toBe(true);
    for (const paths of [undefined, [path, path], Array(7).fill(path), [path.replace(owner, "another-owner")], [path.replace(".webp", ".jpg")]]) expect(canResumeSavedPhotos(owner, key, paths, done)).toBe(false);
    expect(canResumeSavedPhotos(null, key, [path], done)).toBe(false);
    expect(canResumeSavedPhotos(owner, "another-key", [path], done)).toBe(false);
  });
  it("does not let a marker bypass restoration, pending bytes, retry, conflict or an unsettled save", () => {
    for (const flags of [{ restoring: true }, { saving: true }, { storageError: true }]) expect(canResumeSavedPhotos(owner, key, [path], { ...done, ...flags })).toBe(false);
    for (const patch of [{ status: "uploading" as const }, { status: "failed" as const }, { pendingAttach: true }, { needsRetry: true }]) expect(canResumeSavedPhotos(owner, key, [path], { ...done, photos: [{ ...done.photos[0], ...patch }] })).toBe(false);
    expect(canResumeSavedPhotos(owner, key, [], { ...empty, photos: [{ ...done.photos[0], path: undefined, file: new File(["raw"], "raw.jpg") }] })).toBe(false);
    expect(canResumeSavedPhotos(owner, key, [path], { ...done, photos: [...done.photos, { ...done.photos[0], id: "pending", path: undefined }] })).toBe(false);
  });
});
