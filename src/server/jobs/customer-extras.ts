import "server-only";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import type { CustomerExtra } from "@/lib/customer-extras";
import type { JobViewer } from "@/server/views";

/** Read only. Neither an ORM row nor any worker/pricing inputs enter the customer response. */
export async function loadCustomerExtras(db: Pick<PrismaClient, "variation">, viewer: JobViewer | null, jobId: string): Promise<CustomerExtra[]> {
  if (viewer?.role !== "CUSTOMER" || !z.uuid().safeParse(viewer.userId).success || !z.uuid().safeParse(jobId).success) return [];
  const extras = await db.variation.findMany({
    where: { jobId, job: { customerId: viewer.userId, customer: { role: "CUSTOMER" }, status: "ASSIGNED" } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 5,
    select: { id: true, revision: true, status: true, description: true, priceCents: true, pricedAt: true, decidedAt: true,
      _count: { select: { photos: { where: { ready: true } } } } },
  });
  return extras.map(extra => ({ id: extra.id, revision: extra.revision, status: extra.status, description: extra.description,
    priceCents: extra.priceCents, photoCount: extra._count.photos, pricedAt: extra.pricedAt?.toISOString() ?? null, decidedAt: extra.decidedAt?.toISOString() ?? null }));
}
