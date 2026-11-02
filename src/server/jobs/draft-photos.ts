import "server-only";

import { createHash } from "node:crypto";
import { POST_KEY_SCHEMA } from "@/lib/job-draft";
import type { Viewer } from "@/server/auth/viewer";
import { checkUpload, PHOTO_MAX_EDGE, toWebp } from "@/server/files/images";
import { MESSAGES, UploadError } from "@/server/files/errors";
import { PHOTO_BUCKET, SIGNED_URL_SECONDS, type FileStore } from "@/server/files/storage";
import { consumeForUser, type RateLimitDecision } from "@/server/rate-limit";

export function ownsDraftPhoto(userId: string, postKey: string, path: string): boolean {
  const key = POST_KEY_SCHEMA.safeParse(postKey);
  if (!key.success) return false;
  const prefix = `drafts/${userId}/${key.data}/`;
  return path.startsWith(prefix) && /^[0-9a-f]{32}\.webp$/.test(path.slice(prefix.length));
}

/** Browser-local photos are uploaded after sign-in, before posting. No unprocessed or anonymous bytes in Storage. */
export async function uploadDraftPhoto(store: FileStore, viewer: Viewer, postKey: string, input: Uint8Array, rateLimit = (id: string): Promise<RateLimitDecision> => consumeForUser("upload", id)) {
  if (viewer.role !== "CUSTOMER" || !POST_KEY_SCHEMA.safeParse(postKey).success) {
    throw new UploadError("not-allowed", MESSAGES.notAllowed);
  }
  postKey = postKey.toLowerCase();
  const rate = await rateLimit(viewer.userId);
  if (!rate.allowed) return { status: "rate-limited", retryAfter: rate.retryAfter } as const;
  const kind = checkUpload(input, ["jpeg", "png", "heic"], MESSAGES.photoType);
  const photo = await toWebp(input, kind, PHOTO_MAX_EDGE);
  const hash = createHash("sha256").update(input).digest("hex").slice(0, 32);
  const path = `drafts/${viewer.userId}/${postKey}/${hash}.webp`;
  await store.put(PHOTO_BUCKET, path, photo.bytes, photo.contentType);
  return { path };
}

/** Restored draft previews have the same ownership check as posting. Posted photos use jobPhotoUrls. */
export async function draftPhotoUrl(store: FileStore, viewer: Viewer, postKey: string, path: string) {
  if (viewer.role !== "CUSTOMER" || !ownsDraftPhoto(viewer.userId, postKey, path)) {
    throw new UploadError("not-found", MESSAGES.notFound);
  }
  return { url: await store.signedUrl(PHOTO_BUCKET, path, SIGNED_URL_SECONDS), expiresInSeconds: SIGNED_URL_SECONDS };
}
