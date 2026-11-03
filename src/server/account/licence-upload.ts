import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { MESSAGES, UploadError } from "@/server/files/errors";
import { LICENCE_UPLOAD_MAX_BYTES } from "@/lib/account/trades";

// Raw files land in a separate private bucket. They cannot be viewed or attached to a licence until addDocument
// has checked their real bytes, removed image metadata, and written the approved document. This keeps 10 MB files
// out of Vercel's 4.5 MB request bodies. A signed upload permits only one random, owner-bound staging path.
export const LICENCE_STAGING_BUCKET = "licence-uploads";
export type LicenceStaging = {
  sign(path: string): Promise<string>;
  read(path: string): Promise<Uint8Array>;
  remove(path: string): Promise<void>;
};
export const stagePath = (userId: string, now = new Date()) => `${userId}/${now.getTime()}-${randomUUID()}`;
export function ownsStage(path: string, userId: string, now = new Date()): boolean {
  const match = new RegExp(`^${userId}/(\\d{13})-[0-9a-f-]{36}$`).exec(path);
  return Boolean(match && Number(match[1]) <= now.getTime() && Number(match[1]) >= now.getTime() - 2 * 60 * 60 * 1000);
}
export function getLicenceStaging(env: Record<string, string | undefined> = process.env): LicenceStaging {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim(); const key = env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) throw new UploadError("storage-failed", MESSAGES.storageFailed);
  const bucket = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }).storage.from(LICENCE_STAGING_BUCKET);
  const failed = () => new UploadError("storage-failed", MESSAGES.storageFailed);
  return {
    async sign(path) {
      const { data, error } = await bucket.createSignedUploadUrl(path, { upsert: false });
      if (error || !data) throw failed(); return data.signedUrl;
    },
    async read(path) {
      const { data, error } = await bucket.download(path);
      if (error || !data) throw failed();
      if (data.size > LICENCE_UPLOAD_MAX_BYTES) throw new UploadError("too-large", MESSAGES.tooLarge);
      return new Uint8Array(await data.arrayBuffer());
    },
    async remove(path) { const { error } = await bucket.remove([path]); if (error) throw failed(); },
  };
}

export const SIGNED_STAGE_MS = 2 * 60 * 60 * 1000;
export const STAGE_CLEANUP_GRACE_MS = 5 * 60 * 1000;
export const MAX_PENDING_LICENCE_UPLOADS = 10;

/** A per-worker lock bounds concurrent pending grants even when requests arrive together. */
export async function beginLicenceStage(db: PrismaClient, userId: string, staging: LicenceStaging, now = new Date()): Promise<{ path: string; url: string } | null> {
  const record = await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`licence-upload:${userId}`}, 0))`;
    const pending = await tx.licenceUploadStage.count({ where: { userId, finalizedAt: null, expiresAt: { gt: now } } });
    if (pending >= MAX_PENDING_LICENCE_UPLOADS) return null;
    const profile = await tx.profile.findUnique({ where: { id: userId }, select: { role: true } });
    if (profile?.role !== "TRADIE") throw new UploadError("not-allowed", MESSAGES.notAllowed);
    return tx.licenceUploadStage.create({ data: { userId, path: stagePath(userId, now), expiresAt: new Date(now.getTime() + SIGNED_STAGE_MS) } });
  });
  if (!record) return null;
  // Keep the record even if signing fails: a remote response might have been lost after granting the token.
  return { path: record.path, url: await staging.sign(record.path) };
}

/** A staged upload can be consumed only once, by its owner, before expiry. Never trust a browser-supplied path. */
export async function claimLicenceStage(db: PrismaClient, userId: string, path: string, now = new Date()): Promise<boolean> {
  if (!ownsStage(path, userId, now)) return false;
  const claimed = await db.licenceUploadStage.updateMany({ where: { path, userId, finalizedAt: null, expiresAt: { gt: now } }, data: { finalizedAt: now } });
  return claimed.count === 1;
}
