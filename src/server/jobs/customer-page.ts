import "server-only";

import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { canEditJobWindows } from "@/lib/job-windows";
import { getUploadService, type SignedPhoto } from "@/server/files/service";
import { JOB_DETAIL_SELECT, customerJobView, type CustomerJobView, type JobViewer } from "@/server/views";

/** Keep ORM rows and Storage paths on the server; the page receives only #95's customer DTO and signed links. */
export async function loadCustomerJobPage(db: Pick<PrismaClient, "job">, viewer: JobViewer, id: string) {
  let row;
  try { row = await db.job.findUnique({ where: { id }, select: JOB_DETAIL_SELECT }); }
  catch { return { state: "error" as const }; }
  if (!row) return { state: "not-found" as const };
  const job = customerJobView(viewer, row);
  if (!job) return { state: "not-found" as const };
  return { state: "ready" as const, job, canEditWindows: canEditJobWindows(row) };
}

export async function loadCustomerJobPhotos(job: CustomerJobView, viewer: JobViewer,
  signPhotos = (jobId: string) => getUploadService().jobPhotoUrls(viewer, jobId), now = Date.now) {
  const startedAt = now();
  let photos: SignedPhoto[] = [], photosFailed = false;
  if (job.photos.length) {
    try { photos = await signPhotos(job.id); }
    catch { photosFailed = true; }
  }
  // Never forward a newly added/unprojected photo when the job changed during signing.
  const visible = new Set(job.photos.map(photo => photo.id));
  const signed = photos.filter(photo => visible.has(photo.id));
  const ttl = Math.min(...signed.map(photo => photo.expiresInSeconds * 1000));
  const photoLease = signed.length && Number.isFinite(ttl) && ttl > 0
    ? { batchId: randomUUID(), renewAfterMs: Math.max(0, ttl - Math.min(30_000, ttl / 2) - Math.max(0, now() - startedAt)) } : null;
  return { photosFailed, photoLease, initialAgeMs: Math.max(0, startedAt - new Date(job.createdAt).getTime()),
    photos: signed.map((photo, index) => ({ src: photo.url, alt: `${job.title} · ${index + 1}` })) };
}
