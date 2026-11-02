"use client";
// The job admin view with a pretend server, so every dialog and state can be opened and checked.
// A real action is never called from here.
import { JobAdmin, type DialogName } from "@/components/office/JobAdmin";
import { JobAdminSkeleton } from "@/components/office/JobAdminSkeleton";
import type { JobActionResult, OfficeJobView } from "@/lib/office-job";

type Props = {
  job: OfficeJobView | null;
  loading: boolean;
  dialog: DialogName | null;
  menuOpen: boolean;
  /** The pretend server answers with this instead of saving. */
  failure: string | null;
};

const NOTHING_SAVED = "Nothing was saved: this is a preview.";

export function OfficeJobDemo({ job, loading, dialog, menuOpen, failure }: Props) {
  if (loading) return <JobAdminSkeleton />;
  const submit = async (): Promise<JobActionResult> => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return failure ? { ok: false, error: "unavailable", message: failure } : { ok: true };
  };
  return (
    <>
      <JobAdmin
        job={job}
        submit={submit}
        initialDialog={dialog}
        initialMenuOpen={menuOpen}
        initialError={failure}
        // Nothing changes on the page in a preview, so there is nothing to reload.
        onChanged={() => undefined}
      />
      <p style={{ fontSize: "0.875rem" }}>{NOTHING_SAVED}</p>
    </>
  );
}
