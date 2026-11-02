"use client";
// The job admin view wired to the real server action. (The preview wires pretend ones: JobAdmin takes `submit`.)
import { jobAction } from "@/server/office/job-actions";

import { JobAdmin, type JobAdminProps } from "./JobAdmin";

export function JobAdminClient({ job }: Pick<JobAdminProps, "job">) {
  return <JobAdmin job={job} submit={jobAction} />;
}
