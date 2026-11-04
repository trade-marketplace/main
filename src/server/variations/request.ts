import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { createAudit } from "@/server/audit/audit";
import { createNotify } from "@/server/notifications/notify";
import { command, inProgress, isUuid, lockJob, refuse, requireActor, type VariationActor } from "./common";

export type RequestVariationInput = { jobId: string; requestKey: string; description: string; hours: number; photoPaths: string[] };

/** The assigned worker is the lead; crew membership cannot grant this command. */
export async function requestVariation(db: PrismaClient, actor: VariationActor, raw: RequestVariationInput) {
  if (!raw || !isUuid(raw.jobId) || !isUuid(raw.requestKey) || typeof raw.description !== "string" || raw.description.trim().length < 10 || raw.description.length > 2000
    || typeof raw.hours !== "number" || !Number.isFinite(raw.hours) || raw.hours <= 0 || raw.hours > 100
    || Math.abs(raw.hours * 60 - Math.round(raw.hours * 60)) > 1e-7
    || !Array.isArray(raw.photoPaths) || raw.photoPaths.length < 1 || raw.photoPaths.length > 6 || raw.photoPaths.some(p => typeof p !== "string") || new Set(raw.photoPaths).size !== raw.photoPaths.length) {
    return { ok: false, error: "invalid" } as const;
  }
  const requestKey = raw.requestKey.toLowerCase();
  return command(db, async tx => {
    await requireActor(tx, actor, "TRADIE");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`variation-request:${requestKey}`}, 0))`;
    const job = await lockJob(tx, raw.jobId);
    if (job.workerId !== actor.userId) return refuse("not-found");
    const previous = await tx.variation.findUnique({ where: { requestKey }, include: { photos: { orderBy: { position: "asc" } } } });
    if (previous) {
      if (previous.jobId !== job.id || previous.requestedById !== actor.userId) return refuse("not-found");
      if (previous.description !== raw.description.trim() || previous.requestedMinutes !== Math.round(raw.hours * 60)
        || JSON.stringify(previous.photos.map(p => p.path)) !== JSON.stringify(raw.photoPaths)) return refuse("changed");
      return { ok: true, variationId: previous.id } as const;
    }
    inProgress(job.status);
    const photos = await tx.variationPhoto.findMany({ where: { path: { in: raw.photoPaths }, jobId: job.id, uploadedById: actor.userId, requestKey, ready: true, deleting: false, variationId: null } });
    if (photos.length !== raw.photoPaths.length) return refuse("photos-pending");
    const variation = await tx.variation.create({ data: { jobId: job.id, requestKey, description: raw.description.trim(), requestedMinutes: Math.round(raw.hours * 60), requestedById: actor.userId } });
    for (const [position, path] of raw.photoPaths.entries()) await tx.variationPhoto.update({ where: { path }, data: { variationId: variation.id, position } });
    await createAudit(tx)(actor, "variation.requested", { type: "variations", id: variation.id }, null, { status: "REQUESTED", requestedMinutes: variation.requestedMinutes, photoCount: photos.length });
    const office = await tx.profile.findMany({ where: { role: "ADMIN" }, select: { id: true } });
    await createNotify(tx)("variation.requested", office.map(p => p.id), { eventId: `variation.requested:${variation.id}`, payload: { jobId: job.id, jobNumber: job.jobNumber, variationId: variation.id } });
    return { ok: true, variationId: variation.id } as const;
  });
}
