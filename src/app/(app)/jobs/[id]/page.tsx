import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { WorkerJobLoading, WorkerJobLoadError } from "@/components/jobs/WorkerJobBoundary";
import { WorkerEstimatePage } from "@/components/jobs/WorkerEstimatePage";
import { CustomerJobPage } from "@/components/jobs/CustomerJobPage";
import { CustomerJobLoadError } from "@/components/jobs/CustomerJob";
import { boardJobHref, boardReturn } from "@/lib/job-board";
import { customerJobReturn } from "@/lib/customer-job";
import { privateMetadata } from "@/lib/metadata";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { loadCustomerJobPage } from "@/server/jobs/customer-page";
import { canReadJob } from "@/server/views";

export const metadata = { ...privateMetadata, title: "Job" };
export default async function JobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: unknown; view?: unknown; posted?: unknown }> }) {
  const { id } = await params, search = await searchParams, back = boardReturn(search.from, search.view);
  const customerBack = customerJobReturn(search.from);
  const next = search.from === "/" || customerBack.startsWith("/dashboard") ? `/jobs/${id}?from=${encodeURIComponent(customerBack)}` : boardJobHref(id, back);
  const viewer = await requireUser({ next: search.posted === "1" ? `/jobs/${id}?posted=1` : next });
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
  if (viewer.role === "CUSTOMER") {
    // Resolve ownership before any Suspense fallback starts streaming, preserving a real HTTP 404.
    let result;
    try { result = await loadCustomerJobPage(getDb(), viewer, id); }
    catch { return <CustomerJobLoadError />; }
    if (result.state === "not-found") notFound();
    if (result.state === "error") return <CustomerJobLoadError />;
    return <CustomerJobPage job={result.job} viewer={viewer} posted={search.posted === "1"} back={customerBack} canEditWindows={result.canEditWindows} />;
  }
  notFound();
}
