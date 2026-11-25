import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { createNotify } from "@/server/notifications/notify";

import { calculatePayout } from "./calculate";
import { checkPayrollDetails } from "./queue-payout";

// A part payout (#172, DECISIONS.md "Cancellations, disputes and part payouts"): when the office cancels a paid job
// that the tradie had already started, it can pay them for the time it agrees on. It is an ordinary payout row,
// QUEUED for the next payroll export like any other, worked out by the same calculation as a finished job's payout
// (calculatePayout): the agreed minutes × the job's FROZEN hourly rate, plus its frozen holiday pay %. Never more
// than the job's priced time plus approved extra work; no minimum. One payout per tradie per job (unique index), so
// it can't be paid twice, and the job's normal payout can't follow it. Materials aren't part of it.

export type PartPayoutLimit =
  | { ok: true; workerId: string; maxMinutes: number; rateCents: number; holidayPayBps: number }
  | { ok: false; reason: "no-worker" | "not-priced" | "already-queued" };

/** Whether this job's tradie can be given a part payout, and the longest one. Reads only. */
export async function partPayoutLimit(tx: Prisma.TransactionClient, jobId: string): Promise<PartPayoutLimit> {
  const job = await tx.job.findUnique({ where: { id: jobId }, select: { workerId: true } });
  if (!job?.workerId) return { ok: false, reason: "no-worker" };
  const existing = await tx.payout.count({ where: { jobId, workerId: job.workerId } });
  if (existing > 0) return { ok: false, reason: "already-queued" };
  const pricing = await tx.jobPricing.findUnique({ where: { jobId }, select: { workerRateCents: true, holidayPayBps: true, minutes: true } });
  if (!pricing) return { ok: false, reason: "not-priced" };
  const extras = await tx.variation.findMany({ where: { jobId, status: "APPROVED", minutes: { not: null } }, select: { minutes: true } });
  const maxMinutes = pricing.minutes + extras.reduce((sum, extra) => sum + (extra.minutes ?? 0), 0);
  return { ok: true, workerId: job.workerId, maxMinutes, rateCents: pricing.workerRateCents, holidayPayBps: pricing.holidayPayBps };
}

export type PartPayoutResult =
  | { queued: true; payoutId: string; workerId: string; minutes: number; grossCents: number; holidayPayCents: number; totalCents: number }
  | { queued: false; reason: "no-worker" | "not-priced" | "already-queued" | "too-long" };

/** Queues the part payout inside the caller's transaction (the one that cancels the job). */
export async function queuePartPayout(tx: Prisma.TransactionClient, jobId: string, minutes: number): Promise<PartPayoutResult> {
  const limit = await partPayoutLimit(tx, jobId);
  if (!limit.ok) return { queued: false, reason: limit.reason };
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > limit.maxMinutes) return { queued: false, reason: "too-long" };

  const amounts = calculatePayout({ jobMinutes: minutes, approvedExtraMinutes: [], workerRateCents: limit.rateCents, holidayPayBps: limit.holidayPayBps });
  const payout = await tx.payout.create({
    data: {
      jobId,
      workerId: limit.workerId,
      minutes: amounts.minutes,
      rateCents: amounts.rateCents,
      grossCents: amounts.grossCents,
      holidayPayCents: amounts.holidayPayCents,
      status: "QUEUED",
    },
    select: { id: true },
  });

  // As for a finished job (queue-payout.ts, D15): the payout stays QUEUED while bank and tax details are missing.
  const details = await tx.payrollDetails.findUnique({
    where: { userId: limit.workerId },
    select: { irdNumberEncrypted: true, bankAccountEncrypted: true, taxCode: true, kiwiSaverRatePct: true },
  });
  const payrollDetails = checkPayrollDetails(details);
  if (!payrollDetails.complete) {
    await createNotify(tx)("payout.details_missing", [limit.workerId], {
      eventId: `payout.details_missing:${payout.id}`,
      payload: { payoutId: payout.id, ...(payrollDetails.missing.includes("review") ? { needsPayrollReview: true } : {}) },
    });
  }
  return { queued: true, payoutId: payout.id, workerId: limit.workerId, ...amounts };
}
