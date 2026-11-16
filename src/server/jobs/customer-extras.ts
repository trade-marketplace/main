import "server-only";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import type { CustomerExtra } from "@/lib/customer-extras";
import type { JobViewer } from "@/server/views";

/** Read only. Neither an ORM row nor any worker/pricing inputs enter the customer response. */
export async function loadCustomerExtras(db: Pick<PrismaClient, "variation">, viewer: JobViewer | null, jobId: string): Promise<CustomerExtra[]> {
  if (viewer?.role !== "CUSTOMER" || !z.uuid().safeParse(viewer.userId).success || !z.uuid().safeParse(jobId).success) return [];
  const where = { jobId, job: { customerId: viewer.userId, customer: { role: "CUSTOMER" as const }, status: "ASSIGNED" as const } };
  const select = { id: true, revision: true, status: true, description: true, priceCents: true, pricedAt: true, decidedAt: true,
    // Used only to merge the two reads; the explicit customer projection below omits it.
    createdAt: true, _count: { select: { photos: { where: { ready: true } } } } } as const;
  const orderBy = [{ createdAt: "desc" as const }, { id: "desc" as const }];
  const waiting = await db.variation.findMany({
    where: { ...where, status: { in: ["REQUESTED", "PRICED"] } }, orderBy, select,
  });
  const decided = await db.variation.findMany({
    where: { ...where, status: { in: ["APPROVED", "DECLINED"] }, id: { notIn: waiting.map(extra => extra.id) } },
    orderBy, take: Math.max(0, 5 - waiting.length), select,
  });
  const extras = [...waiting, ...decided].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
  return extras.map(extra => ({ id: extra.id, revision: extra.revision, status: extra.status, description: extra.description,
    priceCents: extra.priceCents, photoCount: extra._count.photos, pricedAt: extra.pricedAt?.toISOString() ?? null, decidedAt: extra.decidedAt?.toISOString() ?? null }));
}
