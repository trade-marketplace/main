import "server-only";
import { officeJobListView, type JobSummarySource } from "./jobs";
import type { JobViewer } from "./access";
import { shortName } from "@/server/office/jobs";
import { jobNumberLabel, TRADE_LABELS } from "@/lib/office-jobs";

type Estimate = { minutes: number; materialsCents: number; needsSiteVisit: boolean; madeBeforeEdit: boolean };
export type QueueJobSource = JobSummarySource & { estimates?: readonly Estimate[] };

/** Office-only queue/search payload: profile email/phone may match a query but never enter the result. */
export function officeQueueJobView(viewer: JobViewer, source: QueueJobSource) {
  const job = officeJobListView(viewer, source);
  if (!job) return null;
  const current = source.estimates?.filter(row => !row.madeBeforeEdit) ?? [];
  const ranged = current.filter(row => !row.needsSiteVisit);
  return { jobId: job.id, number: jobNumberLabel(job.jobNumber), title: job.title, trade: TRADE_LABELS[job.category], status: job.status,
    customer: shortName(job.customer) ?? "—", tradie: shortName(job.worker), suburb: job.suburb,
    estimates: `${current.length}${current.some(row => row.needsSiteVisit) ? " · site visit asked" : ""}`,
    estimateCount: current.length,
    spread: ranged.length ? spreadLabel(ranged.map(row => row.minutes), ranged.map(row => row.materialsCents)) : "—" };
}

/** "3.0–4.5 h · $60–110" (mockup w-o-queues). Equal ends collapse ("3.0 h · $120"); no materials reads "no materials". */
function spreadLabel(minutes: number[], materialsCents: number[]): string {
  const hours = (value: number) => (value / 60).toFixed(1);
  const dollars = (cents: number) => new Intl.NumberFormat("en-NZ", { maximumFractionDigits: 2 }).format(cents / 100);
  const range = (values: number[], format: (value: number) => string) => {
    const low = Math.min(...values);
    const high = Math.max(...values);
    return low === high ? format(low) : `${format(low)}–${format(high)}`;
  };
  const materials = Math.max(...materialsCents) === 0 ? "no materials" : `$${range(materialsCents, dollars)}`;
  return `${range(minutes, hours)} h · ${materials}`;
}
