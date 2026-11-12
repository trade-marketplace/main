import "server-only";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { WORKSPACE_STATUSES, type WorkspaceView } from "@/lib/worker-workspace";
import { payoutTotal } from "@/lib/earnings";
import { calculatePayout } from "@/server/payouts/calculate";
import { workerJobView, type JobViewer } from "@/server/views";
import { WORKER_CLAIM_SELECT } from "./worker-claim-reader";

export async function loadWorkspace(db: Pick<PrismaClient, "job" | "settings" | "jobStatusHistory">, viewer: JobViewer, jobId: string): Promise<WorkspaceView | null> {
  if (viewer.role !== "TRADIE" || !z.uuid().safeParse(jobId).success) return null;
  const source = await db.job.findUnique({ where: { id: jobId }, select: {
    ...WORKER_CLAIM_SELECT, variations: { where: { status: { in: ["REQUESTED", "PRICED", "APPROVED"] } }, select: { status: true, minutes: true } },
    evidence: { select: { submittedAt: true } }, payouts: { where: { workerId: viewer.userId }, select: { status: true, grossCents: true, holidayPayCents: true }, take: 1 },
  } });
  if (!source || source.workerId !== viewer.userId || !(WORKSPACE_STATUSES as readonly string[]).includes(source.status)) return null;
  const safe = workerJobView(viewer, source);
  if (!safe?.assignedToYou || !safe.address || !safe.customer) return null;
  const [settings, claim] = await Promise.all([
    db.settings.findUnique({ where: { id: 1 }, select: { autoReleaseHours: true } }),
    db.jobStatusHistory.findFirst({ where: { jobId, toStatus: "ASSIGNED" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  const autoReleaseHours = settings?.autoReleaseHours ?? 48;
  // Match Earnings: actual stored pay wins; otherwise use its existing calculator with approved extras.
  let earnCents: number | null = null;
  if (source.payouts[0]) earnCents = payoutTotal(source.payouts[0]);
  else if (source.pricing) {
    try {
      earnCents = calculatePayout({ jobMinutes: source.pricing.minutes, workerRateCents: source.pricing.workerRateCents, holidayPayBps: source.pricing.holidayPayBps,
        approvedExtraMinutes: source.variations.flatMap(extra => extra.status === "APPROVED" && extra.minutes !== null ? [extra.minutes] : []) }).totalCents;
    } catch { /* A legacy invalid amount must not hide the contact and job details. */ }
  }
  return {
    id: safe.id, jobNumber: safe.jobNumber, title: safe.title, description: safe.description, category: safe.category, status: safe.status,
    earnCents, customer: { firstName: safe.customer.firstName, lastInitial: safe.customer.lastInitial, phone: safe.customer.phone },
    address: [safe.address.line1, safe.address.line2, safe.suburb, safe.city, safe.address.postcode].filter(Boolean).join(", "),
    accessNotes: safe.address.accessNotes, bookedDate: safe.bookedDate, bookedTime: safe.bookedTime,
    budgetCents: source.materials?.budgetCents ?? source.pricing?.materialsCents ?? null, extraWorkOpen: source.variations.some(extra => extra.status === "REQUESTED" || extra.status === "PRICED"), claimedAt: claim?.createdAt.toISOString() ?? null,
    signOffDeadline: source.evidence?.submittedAt ? new Date(source.evidence.submittedAt.getTime() + autoReleaseHours * 3_600_000).toISOString() : null,
    autoReleaseHours, payout: source.payouts[0]?.status ?? null,
  };
}
