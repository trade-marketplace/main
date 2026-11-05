// /admin/jobs/[id], the office's job admin view (#171, F05): everything about one job, its timeline, and the
// office's override actions. The office layout already checks the role; this page checks again because it reads
// the job's money, messages and audit log.
import type { Metadata } from "next";
import { notFound, unstable_rethrow } from "next/navigation";

import { JobAdminClient } from "@/components/office/JobAdminClient";
import type { OfficeJobView } from "@/lib/office-job";
import { requireRole } from "@/server/auth/guard";
import { DatabaseNotConfiguredError, getDb } from "@/server/db";
import { getOfficeJob } from "@/server/office/job";
import { loadOfficeProblemReport } from "@/server/office/problem-report";
import { officeProblemId, officeProblemJobHref, officeProblemJobReturn, type OfficeProblemReportState } from "@/lib/office-problem";

export const metadata: Metadata = { title: "Job" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function JobAdminPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const query = (await searchParams) ?? {}, price = query.dialog === "price", reportId = officeProblemId(query.problem), problemReturn = officeProblemJobReturn(query);
  const viewer = await requireRole(["ADMIN"], { next: officeProblemJobHref(id, reportId, problemReturn, price) });
  // An address that isn't a job id is a 404, not a database error.
  if (!UUID.test(id)) notFound();
  if (query.problem !== undefined && !reportId) notFound();
  let job: OfficeJobView | null = null;
  try {
    job = await getOfficeJob(getDb(), viewer, id);
  } catch (error) {
    unstable_rethrow(error);
    // Shown as "Can't load this job" with Try again; the details stay in the server log.
    if (!(error instanceof DatabaseNotConfiguredError)) console.error("Job admin: couldn't read the job.", error);
    return <JobAdminClient job={null} problemReturn={problemReturn} />;
  }
  if (!job) notFound();
  let problemReport: OfficeProblemReportState | null = null;
  if (reportId) {
    try {
      const report = await loadOfficeProblemReport(getDb(), viewer, id, reportId);
      if (!report) notFound();
      problemReport = { state: "ready", report };
    } catch (error) { unstable_rethrow(error); console.error("Problem report could not be loaded."); problemReport = { state: "error" }; }
  }
  return <JobAdminClient job={job} problemReport={problemReport} problemReturn={problemReturn} initialDialog={price && ["REVIEW", "QUOTE_BOUNTY"].includes(job.status) ? "price" : null} />;
}
