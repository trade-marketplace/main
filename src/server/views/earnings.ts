import "server-only";

import type { PayoutStatus } from "@/generated/prisma/client";
import { workerHasPrivateAccess, type JobAccess, type JobViewer } from "./access";

type PayoutSource = {
  id: string; workerId: string; minutes: number; rateCents: number; grossCents: number; holidayPayCents: number;
  status: PayoutStatus; createdAt: Date; paidAt: Date | null; exportedAt?: Date | null;
  job: { jobNumber: number; title: string };
};

/** Own payroll history remains visible after reassignment, without reopening the job's address or contacts. */
export function workerPayoutView(viewer: JobViewer, payout: PayoutSource) {
  if (viewer.role !== "TRADIE" || !viewer.userId || payout.workerId !== viewer.userId) return null;
  return { id: payout.id, minutes: payout.minutes, rateCents: payout.rateCents, grossCents: payout.grossCents,
    holidayPayCents: payout.holidayPayCents, status: payout.status, createdAt: payout.createdAt.toISOString(),
    exportedAt: payout.exportedAt?.toISOString() ?? null, paidAt: payout.paidAt?.toISOString() ?? null,
    job: { jobNumber: payout.job.jobNumber, title: payout.job.title } };
}

/** Private payout calculation stays with the pricing module; only its worker total crosses this boundary. */
export function workerWaitingJobView(viewer: JobViewer, job: Pick<JobAccess, "workerId" | "status"> & { id: string; jobNumber: number; title: string }, totalCents: number) {
  if (!workerHasPrivateAccess(viewer, job) || !["ASSIGNED", "SUBMITTED"].includes(job.status)) return null;
  return { id: job.id, jobNumber: job.jobNumber, title: job.title, totalCents, submitted: job.status === "SUBMITTED" };
}
