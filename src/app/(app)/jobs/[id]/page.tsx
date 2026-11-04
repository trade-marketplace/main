import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { WorkerJobBoundary } from "@/components/jobs/WorkerJobBoundary";
import { WorkerClaimLoading, WorkerClaimLoadError } from "@/components/jobs/WorkerClaim";
import { WorkerClaimPage } from "@/components/jobs/WorkerClaimPage";
import { PostedJob, CustomerJobSummary } from "@/components/jobs/PostedJob";
import { boardJobHref, boardReturn } from "@/lib/job-board";
import { privateMetadata } from "@/lib/metadata";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { JOB_DETAIL_SELECT, workerJobView, customerJobView, canReadJob } from "@/server/views";
import { firebaseWebConfig } from "@/server/notifications/push-config";
import { eligibleJobsFor, WORKER_ELIGIBILITY_SELECT } from "@/server/workers/eligibility";

export const metadata = { ...privateMetadata, title: "Job" };
export default async function JobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: unknown; view?: unknown; posted?: unknown }> }) {
  const { id } = await params, search = await searchParams, back = boardReturn(search.from, search.view);
  const viewer = await requireUser({ next: search.posted === "1" ? `/jobs/${id}?posted=1` : boardJobHref(id, back) });
  // Keep role dispatch local: customer Posted (#121) and customer /windows (#119) can coexist here.
  if (!z.uuid().safeParse(id).success) notFound();
  if (viewer.role === "TRADIE") {
    let access;
    try { access = await getDb().job.findUnique({ where: { id }, select: { customerId: true, workerId: true, status: true } }); }
    catch { return <WorkerClaimLoadError back={back} />; }
    if (!access || !canReadJob(viewer, access)) notFound();
    if (access.status === "BOOKABLE") return <Suspense fallback={<WorkerClaimLoading />}><WorkerClaimPage viewer={viewer} id={id} back={back} /></Suspense>;
  }
  const db = getDb(), job = await db.job.findUnique({ where: { id }, select: JOB_DETAIL_SELECT });
  if (!job) notFound();
  if (viewer.role === "CUSTOMER") {
    const safe = customerJobView(viewer, job); if (!safe) notFound();
    return search.posted === "1" ? <PostedJob job={safe} ownerId={viewer.userId} push={viewer.emailVerified ? firebaseWebConfig() : null} /> : <CustomerJobSummary job={safe} />;
  }
  if (viewer.role !== "TRADIE") notFound();
  const safe = workerJobView(viewer, job);
  if (!safe) notFound();
  // Keep the claimed result on reload/back, while preserving the existing summary for legacy rows without pricing.
  if (job.status === "ASSIGNED" && safe.assignedToYou && job.pricing) return <Suspense fallback={<WorkerClaimLoading />}><WorkerClaimPage viewer={viewer} id={id} back={back} /></Suspense>;
  if (!safe.assignedToYou) {
    const worker = await db.profile.findUnique({ where: { id: viewer.userId }, select: WORKER_ELIGIBILITY_SELECT });
    const settings = await db.settings.findUnique({ where: { id: 1 }, select: { enabledTrades: true } });
    if (!worker || !eligibleJobsFor(worker, [job], { enabledTrades: settings?.enabledTrades }).length) notFound();
  }
  return <WorkerJobBoundary job={safe} back={back} />;
}
