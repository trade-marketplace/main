import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import { calculatePayout } from "./calculate";

// Queues a worker's payout when a job is completed (#164). Called by the status machine inside the same
// transaction as the move to COMPLETED, so the job and its payout appear together or not at all.
//
// - One payout per worker per job (unique index), so signing off twice, or an override back to COMPLETED, never
//   pays twice and never rewrites a payout that has already gone to payroll.
// - Amounts come from the job's frozen `job_pricing` (rate, holiday pay %, billed minutes) plus APPROVED extra
//   work, so a later change to settings never changes what was agreed.
// - Status is QUEUED. Payroll export (a later issue) picks up QUEUED payouts.

/** The three things payroll needs before it can pay someone. */
export type PayrollDetailsCheck = {
  complete: boolean;
  missing: ("ird" | "bank" | "taxCode")[];
};

export type QueuePayoutResult =
  | {
      queued: true;
      payoutId: string;
      totalCents: number;
      payrollDetails: PayrollDetailsCheck;
    }
  // A payout for this worker and job is already there; left exactly as it was.
  | { queued: false; reason: "already-queued"; payoutId: string }
  // Nothing to pay: no worker on the job, or it was never priced through the pricing engine.
  | { queued: false; reason: "no-worker" | "not-priced" };

export function checkPayrollDetails(
  details: {
    irdNumberEncrypted: string | null;
    bankAccountEncrypted: string | null;
    taxCode: string | null;
  } | null,
): PayrollDetailsCheck {
  const missing: PayrollDetailsCheck["missing"] = [];
  if (!details?.irdNumberEncrypted) missing.push("ird");
  if (!details?.bankAccountEncrypted) missing.push("bank");
  if (!details?.taxCode?.trim()) missing.push("taxCode");
  return { complete: missing.length === 0, missing };
}

export async function queuePayoutForJob(tx: Prisma.TransactionClient, jobId: string): Promise<QueuePayoutResult> {
  const job = await tx.job.findUnique({
    where: { id: jobId },
    select: { workerId: true },
  });
  if (!job?.workerId) return { queued: false, reason: "no-worker" };
  const workerId = job.workerId;

  const existing = await tx.payout.findUnique({
    where: { jobId_workerId: { jobId, workerId } },
    select: { id: true },
  });
  if (existing) return { queued: false, reason: "already-queued", payoutId: existing.id };

  const pricing = await tx.jobPricing.findUnique({
    where: { jobId },
    select: { workerRateCents: true, holidayPayBps: true, minutes: true },
  });
  if (!pricing) return { queued: false, reason: "not-priced" };

  const extras = await tx.variation.findMany({
    where: { jobId, status: "APPROVED", minutes: { not: null } },
    select: { minutes: true },
  });
  const amounts = calculatePayout({
    jobMinutes: pricing.minutes,
    approvedExtraMinutes: extras.map((v) => v.minutes as number),
    workerRateCents: pricing.workerRateCents,
    holidayPayBps: pricing.holidayPayBps,
  });

  const payout = await tx.payout.create({
    data: {
      jobId,
      workerId,
      minutes: amounts.minutes,
      rateCents: amounts.rateCents,
      grossCents: amounts.grossCents,
      holidayPayCents: amounts.holidayPayCents,
      status: "QUEUED",
    },
    select: { id: true },
  });

  // NEEDS FOUNDER DECISION: "Bank/tax details required" (issue #164) doesn't say what happens when a worker
  // hasn't added them by the time the job completes. Safest default: still queue the payout (the worker is owed
  // the money and the customer's sign-off must not be blocked), and report what's missing so the payroll export
  // can hold the payout until they're added.
  const details = await tx.payrollDetails.findUnique({
    where: { userId: workerId },
    select: {
      irdNumberEncrypted: true,
      bankAccountEncrypted: true,
      taxCode: true,
    },
  });
  return {
    queued: true,
    payoutId: payout.id,
    totalCents: amounts.totalCents,
    payrollDetails: checkPayrollDetails(details),
  };
}
