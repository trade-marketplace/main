import { notFound } from "next/navigation";
import { z } from "zod";
import { WorkerJobBoundary } from "@/components/jobs/WorkerJobBoundary";
import { CustomerJobPage } from "@/components/jobs/CustomerJobPage";
import { CustomerJobLoadError } from "@/components/jobs/CustomerJob";
import { boardJobHref, boardReturn } from "@/lib/job-board";
import { customerJobReturn } from "@/lib/customer-job";
import { privateMetadata } from "@/lib/metadata";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { loadCustomerJobPage } from "@/server/jobs/customer-page";
import { JOB_DETAIL_SELECT, workerJobView } from "@/server/views";
import { eligibleJobsFor, WORKER_ELIGIBILITY_SELECT } from "@/server/workers/eligibility";

export const metadata = { ...privateMetadata, title: "Job" };
export default async function JobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: unknown; view?: unknown; posted?: unknown }> }) {
  const { id } = await params, search = await searchParams, back = boardReturn(search.from, search.view);
  const customerBack = customerJobReturn(search.from);
  const next = search.from === "/" || customerBack.startsWith("/dashboard") ? `/jobs/${id}?from=${encodeURIComponent(customerBack)}` : boardJobHref(id, back);
  const viewer = await requireUser({ next: search.posted === "1" ? `/jobs/${id}?posted=1` : next });
  // Keep role dispatch local: customer Posted (#121) and customer /windows (#119) can coexist here.
  if (!z.uuid().safeParse(id).success) notFound();
  if (viewer.role === "CUSTOMER") {
    // Resolve ownership before any Suspense fallback starts streaming, preserving a real HTTP 404.
    let result;
    try { result = await loadCustomerJobPage(getDb(), viewer, id); }
    catch { return <CustomerJobLoadError />; }
    if (result.state === "not-found") notFound();
    if (result.state === "error") return <CustomerJobLoadError />;
    return <CustomerJobPage job={result.job} viewer={viewer} posted={search.posted === "1"} back={customerBack} canEditWindows={result.canEditWindows} />;
  }
  const db = getDb(), job = await db.job.findUnique({ where: { id }, select: JOB_DETAIL_SELECT });
  if (!job) notFound();
  if (viewer.role !== "TRADIE") notFound();
  const safe = workerJobView(viewer, job);
  if (!safe) notFound();
  if (!safe.assignedToYou) {
    const worker = await db.profile.findUnique({ where: { id: viewer.userId }, select: WORKER_ELIGIBILITY_SELECT });
    const settings = await db.settings.findUnique({ where: { id: 1 }, select: { enabledTrades: true } });
    if (!worker || !eligibleJobsFor(worker, [job], { enabledTrades: settings?.enabledTrades }).length) notFound();
  }
  return <WorkerJobBoundary job={safe} back={back} />;
}
