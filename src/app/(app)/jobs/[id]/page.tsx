import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { WorkerJobLoading, WorkerJobLoadError } from "@/components/jobs/WorkerJobBoundary";
import { WorkerEstimatePage } from "@/components/jobs/WorkerEstimatePage";
import { PostedJob, CustomerJobSummary } from "@/components/jobs/PostedJob";
import { boardJobHref, boardReturn } from "@/lib/job-board";
import { privateMetadata } from "@/lib/metadata";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { JOB_DETAIL_SELECT, canReadJob, customerJobView } from "@/server/views";
import { firebaseWebConfig } from "@/server/notifications/push-config";

export const metadata = { ...privateMetadata, title: "Job" };
export default async function JobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: unknown; view?: unknown; posted?: unknown }> }) {
  const { id } = await params, search = await searchParams, back = boardReturn(search.from, search.view);
  const viewer = await requireUser({ next: search.posted === "1" ? `/jobs/${id}?posted=1` : boardJobHref(id, back) });
  // Keep role dispatch local: customer Posted (#121) and customer /windows (#119) can coexist here.
  if (!z.uuid().safeParse(id).success) notFound();
  if (viewer.role === "TRADIE") {
    // Resolve the central read boundary before streaming so missing/forbidden jobs retain their 404 status.
    let access;
    try { access = await getDb().job.findUnique({ where: { id }, select: { customerId: true, workerId: true, status: true } }); }
    catch { return <WorkerJobLoadError back={back} />; }
    if (!access || !canReadJob(viewer, access)) notFound();
    return <Suspense fallback={<WorkerJobLoading />}><WorkerEstimatePage viewer={viewer} id={id} back={back} /></Suspense>;
  }
  const db = getDb(), job = await db.job.findUnique({ where: { id }, select: JOB_DETAIL_SELECT });
  if (!job) notFound();
  if (viewer.role === "CUSTOMER") {
    const safe = customerJobView(viewer, job); if (!safe) notFound();
    return search.posted === "1" ? <PostedJob job={safe} ownerId={viewer.userId} push={viewer.emailVerified ? firebaseWebConfig() : null} /> : <CustomerJobSummary job={safe} />;
  }
  notFound();
}
