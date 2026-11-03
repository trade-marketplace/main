import { notFound } from "next/navigation";
import { z } from "zod";
import { WorkerJobBoundary } from "@/components/jobs/WorkerJobBoundary";
import { boardReturn } from "@/lib/job-board";
import { privateMetadata } from "@/lib/metadata";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { JOB_DETAIL_SELECT, workerJobView } from "@/server/views";
import { eligibleJobsFor, WORKER_ELIGIBILITY_SELECT } from "@/server/workers/eligibility";

export const metadata = { ...privateMetadata, title: "Job" };
export default async function JobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string }> }) {
  const { id } = await params, back = boardReturn((await searchParams).from);
  const viewer = await requireUser({ next: `/jobs/${id}?from=${encodeURIComponent(back)}` });
  // Keep role dispatch local: customer Posted (#121) and customer /windows (#119) can coexist here.
  if (viewer.role !== "TRADIE" || !z.uuid().safeParse(id).success) notFound();
  const db = getDb(), job = await db.job.findUnique({ where: { id }, select: JOB_DETAIL_SELECT });
  if (!job) notFound();
  const safe = workerJobView(viewer, job);
  if (!safe) notFound();
  if (!safe.assignedToYou) {
    const worker = await db.profile.findUnique({ where: { id: viewer.userId }, select: WORKER_ELIGIBILITY_SELECT });
    const settings = await db.settings.findUnique({ where: { id: 1 }, select: { enabledTrades: true } });
    if (!worker || !eligibleJobsFor(worker, [job], { enabledTrades: settings?.enabledTrades }).length) notFound();
  }
  return <WorkerJobBoundary job={safe} back={back} />;
}
