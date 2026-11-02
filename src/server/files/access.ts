import type { Role } from "@/lib/mode";

// Who may see a job's files (#96). Mirrors the Storage policies in the 20261102096000 migration; change both
// together. Customers see their own jobs; the worker who claimed it; the office; and workers while the job is
// still open for estimates or claiming (they price it blind from the photos).

export type FileViewer = { userId: string; role: Role };
export type JobAccess = { customerId: string; workerId: string | null; status: string };

/** Job statuses where any worker may look at the photos: estimating, bounty and open for claiming. */
export const WORKER_VISIBLE_STATUSES = ["REVIEW", "QUOTE_BOUNTY", "BOOKABLE"] as const;

export function canViewJobFiles(viewer: FileViewer, job: JobAccess): boolean {
  if (viewer.role === "ADMIN") return true;
  if (viewer.role === "CUSTOMER") return job.customerId === viewer.userId;
  if (viewer.role === "TRADIE") {
    return job.workerId === viewer.userId || (WORKER_VISIBLE_STATUSES as readonly string[]).includes(job.status);
  }
  return false;
}
