import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
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
  return { state: "ready" as const, job };
}

export async function loadCustomerJobPhotos(job: CustomerJobView, viewer: JobViewer,
  signPhotos = (jobId: string) => getUploadService().jobPhotoUrls(viewer, jobId)) {
  let photos: SignedPhoto[] = [], photosFailed = false;
  if (job.photos.length) {
    try { photos = await signPhotos(job.id); }
    catch { photosFailed = true; }
  }
  // Never forward a newly added/unprojected photo when the job changed during signing.
  const visible = new Set(job.photos.map(photo => photo.id));
  return { photosFailed,
    photos: photos.filter(photo => visible.has(photo.id)).map((photo, index) => ({ src: photo.url, alt: `${job.title} · ${index + 1}` })) };
}
