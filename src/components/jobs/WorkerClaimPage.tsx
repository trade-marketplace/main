import "server-only";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db";
import { getUploadService } from "@/server/files/service";
import { loadWorkerClaim } from "@/server/jobs/worker-claim-reader";
import { problemContactHref } from "@/server/messages/contact";
import type { JobViewer } from "@/server/views";
import { WorkerClaim, WorkerClaimLoadError } from "./WorkerClaim";
export async function WorkerClaimPage({ viewer, id, back }: { viewer: JobViewer; id: string; back: string }) {
  let current, contactHref;
  try {
    const db = getDb();
    current = await loadWorkerClaim(db, viewer, id);
    if (current?.job.assignedToYou) contactHref = await problemContactHref(db, viewer, id);
  } catch { return <WorkerClaimLoadError back={back} />; }
  if (!current) notFound();
  let photos: { src: string; alt: string }[] = [], photosFailed = false;
  if (current.photoCount) {
    try { photos = (await getUploadService().jobPhotoUrls(viewer, id)).map(photo => ({ src: photo.url, alt: current.job.title })); } catch { photosFailed = true; }
  }
  return <WorkerClaim key={`${viewer.userId}:${id}`} job={current.job} failure={current.failure} back={back} photos={photos} photosFailed={photosFailed} contactHref={contactHref} points={current.points} />;
}
