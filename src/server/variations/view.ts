import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { isUuid, type VariationActor } from "./common";

/** Field-level privacy is enforced here rather than relying on RLS (which cannot hide columns). */
export async function loadVariation(db: PrismaClient, actor: VariationActor, id: string) {
  if (!isUuid(id) || !isUuid(actor.userId)) return null;
  const profile = await db.profile.findUnique({ where: { id: actor.userId }, select: { role: true } });
  if (!profile) return null;
  const v = await db.variation.findFirst({ where: { id, job: profile.role === "ADMIN" ? {} : profile.role === "CUSTOMER" ? { customerId: actor.userId } : { workerId: actor.userId } }, include: { photos: { orderBy: { position: "asc" }, take: 6, select: { position: true } } } });
  if (!v) return null;
  const common = { id: v.id, jobId: v.jobId, description: v.description, status: v.status, revision: v.revision, photoCount: v.photos.length, pricedAt: v.pricedAt?.toISOString() ?? null, decidedAt: v.decidedAt?.toISOString() ?? null };
  if (profile.role === "CUSTOMER") return { ...common, priceCents: v.priceCents, gstCents: v.gstCents };
  if (profile.role === "TRADIE") return { ...common, requestedMinutes: v.requestedMinutes, minutes: v.minutes, workerEarnsCents: v.workerGrossCents === null || v.holidayPayCents === null ? null : v.workerGrossCents + v.holidayPayCents };
  return { ...common, requestedMinutes: v.requestedMinutes, minutes: v.minutes, materialsCents: v.materialsCents, priceCents: v.priceCents, gstCents: v.gstCents, workerGrossCents: v.workerGrossCents, holidayPayCents: v.holidayPayCents, onCostCents: v.onCostCents, marginCents: v.marginCents };
}
