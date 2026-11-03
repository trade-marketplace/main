// /admin/jobs/[id], the office's job admin view (#171, F05): everything about one job, its timeline, and the
// office's override actions. The office layout already checks the role; this page checks again because it reads
// the job's money, messages and audit log.
import type { Metadata } from "next";
import { notFound, unstable_rethrow } from "next/navigation";

import { JobAdminClient } from "@/components/office/JobAdminClient";
import { OFFICE_JOB_PATH, type OfficeJobView } from "@/lib/office-job";
import { requireRole } from "@/server/auth/guard";
import { DatabaseNotConfiguredError, getDb } from "@/server/db";
import { getOfficeJob } from "@/server/office/job";

export const metadata: Metadata = { title: "Job" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function JobAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireRole(["ADMIN"], { next: `${OFFICE_JOB_PATH}/${encodeURIComponent(id)}` });
  // An address that isn't a job id is a 404, not a database error.
  if (!UUID.test(id)) notFound();
  let job: OfficeJobView | null = null;
  try {
    job = await getOfficeJob(getDb(), viewer, id);
  } catch (error) {
    unstable_rethrow(error);
    // Shown as "Can't load this job" with Try again; the details stay in the server log.
    if (!(error instanceof DatabaseNotConfiguredError)) console.error("Job admin: couldn't read the job.", error);
    return <JobAdminClient job={null} />;
  }
  if (!job) notFound();
  return <JobAdminClient job={job} />;
}
