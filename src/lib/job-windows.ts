import type { JobSchedule } from "./job-draft";
import type { JobStatus } from "@/generated/prisma/enums";

export function canEditJobWindows(job: { status: JobStatus; workerId: string | null }): boolean {
  return job.status === "BOOKABLE" || job.status === "ASSIGNED";
}

export type JobWindowsSnapshot = { id: string; jobNumber: number; title: string; editable: boolean; revision: string; schedule: JobSchedule };
export type SaveJobWindowsResult = { status: "saved" | "changed"; snapshot: JobWindowsSnapshot }
  | { status: "invalid"; fields: Record<string, string> } | { status: "forbidden" | "unavailable" };
