import "server-only";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { PrismaClient } from "@/generated/prisma/client";
import { MESSAGES, UploadError } from "@/server/files/errors";
import { MAX_UPLOAD_BYTES } from "@/server/files/images";
import type { FileStore } from "@/server/files/storage";
import { consumeForUser, type RateLimitDecision } from "@/server/rate-limit";
import { command, inProgress, isUuid, lockJob, refuse, requireActor, type VariationActor } from "./common";
import { uploadVariationPhoto } from "./photos";

export const VARIATION_STAGING_BUCKET = "variation-uploads";
export const VARIATION_STAGE_MS = 2 * 60 * 60 * 1000;
export const VARIATION_STAGE_GRACE_MS = 5 * 60 * 1000;
export type VariationStaging = { sign(path: string): Promise<string>; read(path: string): Promise<Uint8Array>; remove(path: string): Promise<void> };
export function getVariationStaging(env: Record<string, string | undefined> = process.env): VariationStaging {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim(), key = env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) throw new UploadError("storage-failed", MESSAGES.storageFailed);
  const bucket = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }).storage.from(VARIATION_STAGING_BUCKET);
  const failed = () => new UploadError("storage-failed", MESSAGES.storageFailed);
  return {
    async sign(path) { const { data, error } = await bucket.createSignedUploadUrl(path, { upsert: false }); if (error || !data) throw failed(); return data.signedUrl; },
    async read(path) { const { data, error } = await bucket.download(path); if (error || !data) throw failed(); if (data.size > MAX_UPLOAD_BYTES) throw new UploadError("too-large", MESSAGES.tooLarge); return new Uint8Array(await data.arrayBuffer()); },
    async remove(path) { const { error } = await bucket.remove([path]); if (error) throw failed(); },
  };
}

/** Only a small JSON payload crosses Next/Vercel. The signed, non-overwriting token grants one private raw path. */
export async function beginVariationStage(db: PrismaClient, staging: VariationStaging, actor: VariationActor, jobId: string, requestKey: string, size: number, now = new Date(), limit = (id: string): Promise<RateLimitDecision> => consumeForUser("upload", id)) {
  if (!isUuid(jobId) || !isUuid(requestKey) || !Number.isInteger(size) || size < 1 || size > MAX_UPLOAD_BYTES) return { ok: false, error: "invalid" } as const;
  const record = await command(db, async tx => {
    await requireActor(tx, actor, "TRADIE");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`variation-stage:${actor.userId}`}, 0))`;
    const job = await lockJob(tx, jobId);
    if (job.workerId !== actor.userId) return refuse("not-found");
    inProgress(job.status);
    const pending = await tx.variationUploadStage.count({ where: { userId: actor.userId, finalizedAt: null, expiresAt: { gt: now } } });
    if (pending >= 10) return refuse("photos-pending");
    const rate = await limit(actor.userId);
    if (!rate.allowed) return refuse("photos-pending");
    const stage = await tx.variationUploadStage.create({ data: { path: `${actor.userId}/${randomUUID()}`, userId: actor.userId, jobId, requestKey: requestKey.toLowerCase(), expiresAt: new Date(now.getTime() + VARIATION_STAGE_MS) } });
    return { ok: true, stage } as const;
  });
  if (!record.ok) return record;
  // The durable record precedes signing: a lost token response stays tracked through its complete lifetime.
  return { ok: true, stageId: record.stage.id, url: await staging.sign(record.stage.path), expiresAt: record.stage.expiresAt.toISOString() } as const;
}

/** Consume an owner/job/request-bound grant once. Replays return the completed processed path, never raw data. */
export async function finishVariationStage(db: PrismaClient, staging: VariationStaging, store: FileStore, actor: VariationActor, stageId: string, now = new Date()) {
  if (!isUuid(stageId)) return { ok: false, error: "invalid" } as const;
  const claimed = await command(db, async tx => {
    await requireActor(tx, actor, "TRADIE");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`variation-stage-id:${stageId}`}, 0))`;
    const stage = await tx.variationUploadStage.findUnique({ where: { id: stageId } });
    if (!stage || stage.userId !== actor.userId || stage.expiresAt <= now) return refuse("not-found");
    const job = await lockJob(tx, stage.jobId);
    if (job.workerId !== actor.userId) return refuse("not-found");
    inProgress(job.status);
    if (stage.photoPath) return { ok: true, stage, complete: true } as const;
    if (stage.finalizedAt) return refuse("photos-pending");
    await tx.variationUploadStage.update({ where: { id: stageId }, data: { finalizedAt: now } });
    return { ok: true, stage, complete: false } as const;
  });
  if (!claimed.ok) return claimed;
  if (claimed.complete) return { ok: true, path: claimed.stage.photoPath! } as const;
  try {
    const result = await uploadVariationPhoto(db, store, actor, claimed.stage.jobId, claimed.stage.requestKey, await staging.read(claimed.stage.path));
    if (result.ok) await db.variationUploadStage.update({ where: { id: stageId }, data: { photoPath: result.path } });
    return result;
  } finally {
    // Retain the grant row after early removal: its signed token can still upload again until expiry. The
    // scheduler removes the raw object again after the token has expired, and retries deletion failures.
    try { await staging.remove(claimed.stage.path); } catch { console.error("Variation staging cleanup unavailable."); }
  }
}
