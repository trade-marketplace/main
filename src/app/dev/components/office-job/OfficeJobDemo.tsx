"use client";
// The job admin view with a pretend server, so every dialog and state can be opened and checked.
// A real action is never called from here.
import { JobAdmin, type DialogName } from "@/components/office/JobAdmin";
import { JobAdminSkeleton } from "@/components/office/JobAdminSkeleton";
import type { JobActionResult, OfficeJobView } from "@/lib/office-job";
import type { OfficeProblemReportState, OfficeProblemReportView } from "@/lib/office-problem";

type Props = {
  job: OfficeJobView | null;
  loading: boolean;
  dialog: DialogName | null;
  menuOpen: boolean;
  /** The pretend server answers with this instead of saving. */
  failure: string | null;
  problem?: string;
};

const NOTHING_SAVED = "Nothing was saved: this is a preview.";

export function OfficeJobDemo({ job, loading, dialog, menuOpen, failure, problem }: Props) {
  if (loading) return <JobAdminSkeleton />;
  const submit = async (): Promise<JobActionResult> => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return failure ? { ok: false, error: "unavailable", message: failure } : { ok: true };
  };
  const sample: OfficeProblemReportView = { id: "18200000-0000-4000-8000-000000000001", topic: "Work not finished", details: "The light switch is still loose. I’ve added a photo of the problem.", urgent: true, status: problem === "resolved" ? "RESOLVED" : "OPEN", createdAt: "2026-11-04T22:00:00Z", when: "5m ago", photos: problem === "empty" ? [] : [{ id: "report-photo", url: problem === "photo-error" ? null : "/images/examples/switch.jpg" }] };
  const report: OfficeProblemReportState | null = problem === "loading" || problem === "error" ? { state: problem } : problem ? { state: problem === "offline" ? "offline" : "ready", report: sample } : null;
  return (
    <>
      <JobAdmin
        job={job}
        submit={submit}
        initialDialog={dialog}
        initialMenuOpen={menuOpen}
        initialError={failure}
        problemReport={report}
        problemReturn={problem ? { label: "Problems", href: "/dev/components/office-queues?state=signoff&urgent=1#queue-problems" } : null}
        // Nothing changes on the page in a preview, so there is nothing to reload.
        onChanged={() => undefined}
      />
      <p style={{ fontSize: "0.875rem" }}>{NOTHING_SAVED}</p>
    </>
  );
}
