import "server-only";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { jobDraftSchema, POST_KEY_SCHEMA } from "@/lib/job-draft";
import type { Viewer } from "@/server/auth/viewer";
import { MESSAGES, UploadError } from "@/server/files/errors";
import { MAX_UPLOAD_BYTES } from "@/server/files/images";
import { PHOTO_BUCKET, type InspectableFileStore } from "@/server/files/storage";
import { consumeForUser } from "@/server/rate-limit";
import { ownsDraftPhoto, uploadDraftPhoto } from "./draft-photos";

export const DRAFT_PHOTO_STAGE_BUCKET = "draft-photo-uploads";
export const DRAFT_PHOTO_TOKEN_MS = 2 * 60 * 60 * 1000;
export const DRAFT_PHOTO_RAW_GRACE_MS = 5 * 60 * 1000;
export const DRAFT_PHOTO_CLEANUP_MS = 24 * 60 * 60 * 1000;
export const MAX_PENDING_DRAFT_PHOTOS = 12;
export type PhotoStaging = { sign(path: string): Promise<string>; read(path: string): Promise<Uint8Array>; remove(path: string): Promise<void> };
const denied = () => new UploadError("not-allowed", MESSAGES.notAllowed);
export const lockPhotoDraft = (tx: Prisma.TransactionClient, userId: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`draft:${userId}`}, 0))`;

export function getPhotoStaging(env: Record<string, string | undefined> = process.env): PhotoStaging {
  const url = env.NEXT_PUBLIC_SUPABASE_URL; const key = env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new UploadError("storage-failed", MESSAGES.storageFailed);
  const bucket = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }).storage.from(DRAFT_PHOTO_STAGE_BUCKET);
  const failed = () => new UploadError("storage-failed", MESSAGES.storageFailed);
  return {
    async sign(path) { const { data, error } = await bucket.createSignedUploadUrl(path, { upsert: false }); if (error || !data) throw failed(); return data.signedUrl; },
    async read(path) {
      const { data, error } = await bucket.download(path); if (error || !data) throw failed();
      if (data.size > MAX_UPLOAD_BYTES) throw new UploadError("too-large", MESSAGES.tooLarge);
      return new Uint8Array(await data.arrayBuffer());
    },
    async remove(path) { const { error } = await bucket.remove([path]); if (error) throw failed(); },
  };
}

async function currentDraft(tx: Prisma.TransactionClient, viewer: Viewer, postKey: string) {
  if (viewer.role !== "CUSTOMER") throw denied();
  const profile = await tx.profile.findUnique({ where: { id: viewer.userId }, select: { role: true } });
  const row = await tx.jobDraft.findUnique({ where: { profileId: viewer.userId } });
  const draft = jobDraftSchema.safeParse(row?.data);
  if (profile?.role !== "CUSTOMER" || !draft.success || draft.data.postKey !== postKey) throw denied();
  return draft.data;
}

export async function beginDraftPhoto(db: PrismaClient, staging: PhotoStaging, viewer: Viewer, postKey: string, size: number, now = new Date(), rate = consumeForUser) {
  postKey = POST_KEY_SCHEMA.parse(postKey);
  if (!Number.isInteger(size) || size < 1 || size > MAX_UPLOAD_BYTES) throw new UploadError(size < 1 ? "empty" : "too-large", size < 1 ? MESSAGES.empty : MESSAGES.tooLarge);
  if (viewer.role !== "CUSTOMER") throw denied();
  const allowed = await rate("upload", viewer.userId);
  if (!allowed.allowed) return { status: "rate-limited", retryAfter: allowed.retryAfter } as const;
  const stage = await db.$transaction(async tx => {
    await lockPhotoDraft(tx, viewer.userId);
    const draft = await currentDraft(tx, viewer, postKey);
    if ((draft.photoPaths?.length ?? 0) >= 6) return null;
    const pending = await tx.draftPhotoStage.count({ where: { userId: viewer.userId, finalizedAt: null, expiresAt: { gt: now } } });
    if (pending >= MAX_PENDING_DRAFT_PHOTOS) return null;
    const id = randomUUID();
    return tx.draftPhotoStage.create({ data: {
      path: `${viewer.userId}/${postKey}/${id}`, userId: viewer.userId, postKey, size,
      finalPath: `drafts/${viewer.userId}/${postKey}/${randomUUID().replaceAll("-", "")}.webp`, expiresAt: new Date(now.getTime() + DRAFT_PHOTO_TOKEN_MS),
    } });
  });
  if (!stage) return { status: "limit" } as const;
  // Signing can succeed remotely even when its response is lost. Its durable row remains until token expiry.
  return { status: "ready", path: stage.path, url: await staging.sign(stage.path), expiresAt: stage.expiresAt.getTime() } as const;
}

/** Claim + cleanup intent commit before any final Storage put. Random final paths are never reused. */
export async function finalizeDraftPhoto(db: PrismaClient, staging: PhotoStaging, files: InspectableFileStore, viewer: Viewer, postKey: string, path: string, now = new Date()) {
  postKey = POST_KEY_SCHEMA.parse(postKey);
  const stage = await db.$transaction(async tx => {
    await lockPhotoDraft(tx, viewer.userId); await currentDraft(tx, viewer, postKey);
    const found = await tx.draftPhotoStage.findUnique({ where: { path } });
    if (!found || found.userId !== viewer.userId || found.postKey !== postKey || found.claimedAt || found.finalizedAt || found.expiresAt <= now) throw denied();
    await tx.draftPhotoStage.update({ where: { path }, data: { claimedAt: now } });
    await tx.draftPhotoCleanup.create({ data: { path: found.finalPath, userId: viewer.userId, postKey, checkAfter: new Date(now.getTime() + DRAFT_PHOTO_CLEANUP_MS) } });
    return found;
  });
  try {
    const bytes = await staging.read(path);
    if (bytes.length !== stage.size) throw new UploadError("unreadable", MESSAGES.unreadable);
    const scopedFiles: InspectableFileStore = {
      ...files,
      async put(bucket, proposedPath, data, contentType) {
        if (bucket !== PHOTO_BUCKET || !ownsDraftPhoto(viewer.userId, postKey, proposedPath)) throw denied();
        await db.$transaction(async tx => {
          await lockPhotoDraft(tx, viewer.userId); await currentDraft(tx, viewer, postKey);
          await files.put(PHOTO_BUCKET, stage.finalPath, data, contentType);
        }, { timeout: 30_000 });
      },
    };
    // Grant consumed the upload limiter once. #116/#96 still check the actual bytes and strip all metadata.
    await uploadDraftPhoto(scopedFiles, viewer, postKey, bytes, async () => ({ allowed: true }));
    return { path: stage.finalPath };
  } finally {
    await db.draftPhotoStage.updateMany({ where: { path, userId: viewer.userId }, data: { finalizedAt: new Date() } });
    try { await staging.remove(path); } catch { /* The tracked expiry sweep retries, including late signed writes. */ }
  }
}

export async function cancelDraftPhoto(db: PrismaClient, viewer: Viewer, path: string) {
  await db.draftPhotoStage.updateMany({ where: { path, userId: viewer.userId, claimedAt: null }, data: { finalizedAt: new Date() } });
}

/** Runs inside saveDraft's owner lock. Deleted/retired paths cannot be reattached by a delayed browser save. */
export async function validatePhotoPaths(tx: Prisma.TransactionClient, viewer: Viewer, postKey: string | undefined, paths: string[], files: () => InspectableFileStore) {
  if (!paths.length) return true;
  if (!postKey || paths.some(path => !ownsDraftPhoto(viewer.userId, postKey, path))) return false;
  const tracked = await tx.draftPhotoCleanup.findMany({ where: { path: { in: paths }, userId: viewer.userId, postKey, deleting: false }, select: { path: true } });
  return tracked.length === paths.length && (await Promise.all(paths.map(path => files().exists(PHOTO_BUCKET, path)))).every(Boolean);
}
