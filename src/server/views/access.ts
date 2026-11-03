import "server-only";

import type { Role } from "@/lib/mode";

/** Always obtained from the server's verified viewer, never from request JSON. */
export type JobViewer = { readonly userId: string; readonly role: Role };
export type JobAccess = { readonly customerId: string; readonly workerId: string | null; readonly status: string };

export const WORKER_VISIBLE_STATUSES = ["REVIEW", "QUOTE_BOUNTY", "BOOKABLE"] as const;
export const CLAIMED_JOB_STATUSES = ["ASSIGNED", "SUBMITTED", "COMPLETED", "CANCEL_REVIEW"] as const;

export function isClaimedJob(job: Pick<JobAccess, "workerId" | "status">): boolean {
  return job.workerId !== null && (CLAIMED_JOB_STATUSES as readonly string[]).includes(job.status);
}

export function workerHasPrivateAccess(viewer: JobViewer | null, job: Pick<JobAccess, "workerId" | "status">): boolean {
  return Boolean(viewer?.userId && viewer.role === "TRADIE" && job.workerId === viewer.userId && isClaimedJob(job));
}

/** A cancelled former assignment may still be referenced, but never retains address/contact access. */
export function canReadJob(viewer: JobViewer | null, job: JobAccess): boolean {
  if (!viewer?.userId) return false;
  if (viewer.role === "ADMIN") return true;
  if (viewer.role === "CUSTOMER") return job.customerId === viewer.userId;
  return viewer.role === "TRADIE" && (job.workerId === viewer.userId || (WORKER_VISIBLE_STATUSES as readonly string[]).includes(job.status));
}
