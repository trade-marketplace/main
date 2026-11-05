"use client";
import { WorkerClaim } from "@/components/jobs/WorkerClaim";
import type { WorkerClaimView } from "@/lib/worker-claim";
import type { EligibilityFailure } from "@/server/workers/eligibility";
export function ClaimDemo({ job, assigned, state, failure }: { job: WorkerClaimView; assigned: WorkerClaimView; state: string; failure: EligibilityFailure | null }) {
  const contactHref = "/dev/components/problem-threads?state=empty&mode=trade";
  return <WorkerClaim job={job} back="/dev/components/job-board?state=ready&kind=ready" preview={state} failure={failure} contactHref={contactHref}
    photos={["empty", "photo-error"].includes(state) ? [] : ["wires", "switch", "board"].map(value => ({ src: `/images/examples/large/${value}.jpg`, alt: job.title }))} photosFailed={state === "photo-error"}
    claim={async () => state === "error" ? { status: "unavailable" } : { status: "claimed", job: assigned, contactHref }} />;
}
