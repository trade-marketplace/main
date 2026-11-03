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
  const hours = (minutes: number) => (minutes / 60).toFixed(1);
  const dollars = (cents: number) => new Intl.NumberFormat("en-NZ", { maximumFractionDigits: 2 }).format(cents / 100);
  return { jobId: job.id, number: jobNumberLabel(job.jobNumber), title: job.title, trade: TRADE_LABELS[job.category], status: job.status,
    customer: shortName(job.customer) ?? "—", tradie: shortName(job.worker), suburb: job.suburb,
    estimates: `${current.length}${current.some(row => row.needsSiteVisit) ? " · site visit asked" : ""}`,
    estimateCount: current.length,
    spread: ranged.length ? `${hours(Math.min(...ranged.map(row => row.minutes)))}–${hours(Math.max(...ranged.map(row => row.minutes)))} h · $${dollars(Math.min(...ranged.map(row => row.materialsCents)))}–${dollars(Math.max(...ranged.map(row => row.materialsCents)))}` : "—" };
}
