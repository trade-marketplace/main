import type { Metadata } from "next";
import { AppShellView } from "@/components/app/AppShellView";
import { WorkerJobLoading, WorkerJobLoadError } from "@/components/jobs/WorkerJobBoundary";
import { guardDevPage } from "@/server/dev-pages";
import { exampleJob, VIEWERS } from "@/app/dev/components/job-views/preview-data";
import { workerJobView } from "@/server/views/jobs";
import { EstimateDemo } from "./EstimateDemo";
import { EstimateVariants } from "./EstimateVariants";
export const metadata: Metadata = { title: "Job estimate (dev)", robots: { index: false, follow: false } };
const ESTIMATE_STATES = ["ready", "drawer", "estimated", "not-eligible", "wrong-trade", "loading", "empty", "error", "load-error", "offline", "saving", "sent", "priced", "photo-error", "invalid", "edited", "eligibility-gallery", "estimate-gallery"] as const;
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const { state: requested } = await searchParams, state = ESTIMATE_STATES.find(value => value === requested) ?? "ready";
  const source = exampleJob({ status: state === "priced" ? "BOOKABLE" : "REVIEW", workerId: null, worker: null, description: "Lights in the lounge keep flickering and the switch is getting warm. Pretty sure some wires behind it are exposed.", asap: true });
  if (!["estimated", "sent", "priced", "edited", "estimate-gallery"].includes(state)) source.estimates = source.estimates.filter(row => row.workerId !== VIEWERS.worker.userId);
  if (state === "edited") source.estimates[0].madeBeforeEdit = true;
  const job = workerJobView(VIEWERS.worker, source)!;
  return <AppShellView viewer={{ role: "TRADIE", firstName: "Jack", lastName: "Wilson", email: "worker@demo.test", counts: { messages: 0, notifications: 0 } }} testMode preview={{ at: `/jobs/${source.id}`, base: `/dev/components/worker-estimate?state=${state}` }}>
    {state.endsWith("-gallery") ? <EstimateVariants job={job} eligibility={state === "eligibility-gallery"} /> : state === "loading" ? <WorkerJobLoading /> : state === "load-error" ? <WorkerJobLoadError back="/dev/components/job-board?state=ready&kind=estimate" /> : <EstimateDemo key={state} job={job} state={state} />}
  </AppShellView>;
}
