"use client";
// The job admin view wired to the real server action. (The preview wires pretend ones: JobAdmin takes `submit`.)
import { jobAction } from "@/server/office/job-actions";

import { JobAdmin, type JobAdminProps } from "./JobAdmin";

export function JobAdminClient({ job, initialDialog, supportReturn }: Pick<JobAdminProps, "job" | "initialDialog" | "supportReturn">) {
  return <JobAdmin key={`${job?.id}:${initialDialog ?? ""}`} job={job} initialDialog={initialDialog} supportReturn={supportReturn} submit={jobAction} />;
}
