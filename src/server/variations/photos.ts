import "server-only";

import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { checkUpload, PHOTO_MAX_EDGE, toWebp } from "@/server/files/images";
import { MESSAGES } from "@/server/files/errors";
import { PHOTO_BUCKET, SIGNED_URL_SECONDS, type FileStore } from "@/server/files/storage";
import { command, inProgress, isUuid, lockJob, refuse, requireActor, type VariationActor } from "./common";

/** Shared #96 validation/metadata removal; only processed private WebP paths can be attached. */
export async function uploadVariationPhoto(db: PrismaClient, store: FileStore, actor: VariationActor, jobId: string, requestKey: string, input: Uint8Array) {
  if (!isUuid(jobId) || !isUuid(requestKey)) return { ok: false, error: "invalid" } as const;
  const checked = await command(db, async tx => {
    await requireActor(tx, actor, "TRADIE");
    const job = await lockJob(tx, jobId);
    if (job.workerId !== actor.userId) return refuse("not-found");
    inProgress(job.status);
    return { ok: true } as const;
  });
  if (!checked.ok) return checked;
  const kind = checkUpload(input, ["jpeg", "png", "heic"], MESSAGES.photoType);
  const photo = await toWebp(input, kind, PHOTO_MAX_EDGE);
  const path = `variations/${jobId}/${actor.userId}/${randomBytes(16).toString("hex")}.webp`;
  // Commits before the external put. A lost put response or later rollback cannot leave an untracked object.
  await db.variationPhoto.create({ data: { path, jobId, uploadedById: actor.userId, requestKey: requestKey.toLowerCase() } });
  return command(db, async tx => {
    await requireActor(tx, actor, "TRADIE");
    const job = await lockJob(tx, jobId);
    if (job.workerId !== actor.userId) return refuse("not-found");
    inProgress(job.status);
    await store.put(PHOTO_BUCKET, path, photo.bytes, photo.contentType);
    if ((await tx.variationPhoto.updateMany({ where: { path, deleting: false }, data: { ready: true } })).count !== 1) return refuse("changed");
    return { ok: true, path } as const;
  });
}

/** Signing is server-only; former workers and unrelated people cannot obtain a fresh link. */
export async function variationPhotoUrls(db: PrismaClient, store: FileStore, actor: VariationActor, variationId: string) {
  if (!isUuid(variationId) || !isUuid(actor.userId)) return [];
  const profile = await db.profile.findUnique({ where: { id: actor.userId }, select: { role: true } });
  if (!profile) return [];
  // Prisma treats OR: [{}] as no matches. Office access is explicit; other roles still need ownership.
  const variation = await db.variation.findFirst({ where: { id: variationId, ...(profile.role === "ADMIN" ? {} : {
    job: profile.role === "CUSTOMER" ? { customerId: actor.userId } : { workerId: actor.userId },
  }) }, select: { photos: { where: { ready: true }, orderBy: { position: "asc" }, take: 6, select: { path: true, position: true } } } });
  if (!variation) return [];
  return Promise.all(variation.photos.map(async p => ({ position: p.position, url: await store.signedUrl(PHOTO_BUCKET, p.path, SIGNED_URL_SECONDS), expiresInSeconds: SIGNED_URL_SECONDS })));
}
