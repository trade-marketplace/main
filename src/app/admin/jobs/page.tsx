// /admin/jobs, the office's "All jobs" (#170, F04): every job, filterable, searchable, 25 a page, Export CSV.
// The office layout already checks the role; this page checks again because it reads every job.
import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";

import { AllJobs } from "@/components/office/AllJobs";
import { OFFICE_JOBS_PATH, officeJobsSearch, parseOfficeJobsQuery } from "@/lib/office-jobs";
import { requireRole } from "@/server/auth/guard";
import { DatabaseNotConfiguredError } from "@/server/db";
import { listOfficeJobs, type OfficeJobsPage } from "@/server/office/jobs";

export const metadata: Metadata = { title: "All jobs" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AllJobsPage({ searchParams }: { searchParams: SearchParams }) {
  const query = parseOfficeJobsQuery(await searchParams);
  const viewer = await requireRole(["ADMIN"], { next: `${OFFICE_JOBS_PATH}${officeJobsSearch(query)}` });
  let data: OfficeJobsPage | null = null;
  try {
    data = await listOfficeJobs(viewer, query);
  } catch (error) {
    unstable_rethrow(error);
    // Shown as "Can't load jobs" with Try again; the details stay in the server log.
    if (!(error instanceof DatabaseNotConfiguredError)) console.error("All jobs: couldn't read the jobs.", error);
  }
  return <AllJobs query={query} data={data} />;
}
