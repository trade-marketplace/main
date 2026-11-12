import "server-only";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import type { WorkerExtra } from "@/lib/worker-extras";
import type { JobViewer } from "@/server/views";

export async function loadWorkerExtras(db: Pick<PrismaClient, "profile" | "job" | "variation">, viewer: JobViewer, jobId: string): Promise<WorkerExtra[]> {
  if (viewer.role !== "TRADIE" || !z.uuid().safeParse(jobId).success || !z.uuid().safeParse(viewer.userId).success) return [];
  const person = await db.profile.findUnique({ where: { id: viewer.userId }, select: { role: true } });
  if (person?.role !== "TRADIE") return [];
  // Ownership is part of the query, so reassignment cannot expose the former worker's extras.
  const rows = await db.variation.findMany({ where: { jobId, job: { workerId: viewer.userId } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 5,
    select: { id: true, status: true, description: true, requestedMinutes: true, minutes: true, workerGrossCents: true, holidayPayCents: true, createdAt: true, _count: { select: { photos: true } } } });
  return rows.map(row => ({ id: row.id, status: row.status, description: row.description, requestedMinutes: row.requestedMinutes, minutes: row.minutes,
    workerEarnsCents: row.workerGrossCents === null || row.holidayPayCents === null ? null : row.workerGrossCents + row.holidayPayCents,
    photoCount: row._count.photos, createdAt: row.createdAt.toISOString() }));
}
