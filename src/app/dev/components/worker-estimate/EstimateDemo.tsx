"use client";
import { WorkerJobBoundary } from "@/components/jobs/WorkerJobBoundary";
import { workerEstimateSchema } from "@/lib/worker-estimate";
import type { WorkerJobView } from "@/server/views/jobs";
export function EstimateDemo({ job, state }: { job: WorkerJobView; state: string }) {
  return <WorkerJobBoundary job={job} details={job} back="/dev/components/job-board?state=ready&kind=estimate" preview={state}
    failure={state === "not-eligible" ? "identity-required" : state === "wrong-trade" ? "trade-mismatch" : null}
    photos={state === "empty" || state === "photo-error" ? [] : ["wires", "switch", "board"].map(name => ({ src: `/images/examples/large/${name}.jpg`, alt: job.title }))} photosFailed={state === "photo-error"}
    earn={{ workerRateCents: 7000, holidayPayBps: 800, minMinutes: 120 }}
    save={async (_id, input) => {
      if (state === "error") return { status: "unavailable" };
      const parsed = workerEstimateSchema.parse(input);
      return { status: "saved", estimate: { minutes: parsed.hours * 60, materialsCents: parsed.materials, note: parsed.note || null, needsSiteVisit: parsed.needsSiteVisit, madeBeforeEdit: false } };
    }} />;
}
