import "server-only";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db";
import { getUploadService } from "@/server/files/service";
import { JOB_DETAIL_SELECT, workerJobView, type JobViewer } from "@/server/views";
import { ratesForTrade } from "@/server/pricing/calculate";
import type { EarnRates } from "@/lib/quote-earnings";
import { eligibleJobsFor, eligibilityFailure, WORKER_ELIGIBILITY_SELECT, type EligibilityFailure } from "@/server/workers/eligibility";
import { WorkerJobBoundary, WorkerJobLoadError } from "./WorkerJobBoundary";

const RATE_SELECT = { sharedRateCents: true, otherRateCents: true, sharedMinMinutes: true, otherMinMinutes: true, holidayPayBps: true, onCostBps: true, marginBps: true, gstBps: true } as const;

/** The tradie branch keeps its role projection and failure states separate from the customer job page. */
export async function WorkerEstimatePage({ viewer, id, back }: { viewer: JobViewer; id: string; back: string }) {
  let db, job;
  try { db = getDb(); job = await db.job.findUnique({ where: { id }, select: JOB_DETAIL_SELECT }); }
  catch { return <WorkerJobLoadError back={back} />; }
  if (!job) notFound();
  const safe = workerJobView(viewer, job); if (!safe) notFound();
  let failure: EligibilityFailure | null = null, earn: EarnRates | null = null;
  try {
    const [worker, settings] = await Promise.all([
      safe.assignedToYou ? null : db.profile.findUnique({ where: { id: viewer.userId }, select: WORKER_ELIGIBILITY_SELECT }),
      db.settings.findUnique({ where: { id: 1 }, select: { enabledTrades: true, ...RATE_SELECT } }),
    ]);
    const context = { enabledTrades: settings?.enabledTrades };
    if (!safe.assignedToYou && !eligibleJobsFor(worker, [job], context).length) failure = eligibilityFailure(worker, job, "discover", context);
    // Only the worker's own pay rates leave the server, so the quote can show what they'd earn as they tap.
    if (settings) { const rates = ratesForTrade(job.category, settings); earn = { workerRateCents: rates.workerRateCents, holidayPayBps: rates.holidayPayBps, minMinutes: rates.minMinutes }; }
  } catch { return <WorkerJobLoadError back={back} />; }
  let photos: { src: string; alt: string }[] = [], photosFailed = false;
  if (safe.photos.length) {
    try { photos = (await getUploadService().jobPhotoUrls(viewer, id)).map((photo, index) => ({ src: photo.url, alt: `${safe.title} · photo ${index + 1}` })); }
    catch { photosFailed = true; }
  }
  return <WorkerJobBoundary key={`${viewer.userId}:${id}`} job={safe} details={safe} back={back} failure={failure} photos={photos} photosFailed={photosFailed} earn={earn} />;
}
