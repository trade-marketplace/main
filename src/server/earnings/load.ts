// Reads one tradie's earnings (#165, D12): their payouts, the jobs on their way to one, and whether payroll has
// what it needs to pay them. Only that tradie's rows: every query is scoped to `workerId`, and nothing here reads
// the customer's price, the margin or on-costs (the worker sees what they earn, never what the customer pays).
// What a job will pay once it is signed off comes from the payout maths itself (calculatePayout, #164).
import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { addDays, type EarningsView, buildEarnings, nzDay, type PayoutRecord, type WaitingJob } from "@/lib/earnings";
import { jobNumberLabel } from "@/lib/office-jobs";
import { calculatePayout } from "@/server/payouts/calculate";
import { checkPayrollDetails, type PayrollDetailsCheck } from "@/server/payouts/queue-payout";

/** Just the parts of Prisma this read uses, so tests pass a fake and nothing connects to a database. */
export type EarningsDatabase = Pick<PrismaClient, "payout" | "job" | "payrollDetails">;

export type EarningsData = {
  view: EarningsView;
  payrollDetails: PayrollDetailsCheck;
};

/** How far back paid payouts are listed on the page. The statement reads a whole tax year by itself. */
export const EARNINGS_HISTORY_DAYS = 400;

export async function loadEarnings(db: EarningsDatabase, workerId: string, now: Date = new Date()): Promise<EarningsData> {
  const since = new Date(`${addDays(nzDay(now), -EARNINGS_HISTORY_DAYS)}T00:00:00Z`);
  const [payouts, jobs, details] = await Promise.all([
    db.payout.findMany({
      where: { workerId, OR: [{ status: { not: "PAID" } }, { paidAt: { gte: since } }] },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        minutes: true,
        rateCents: true,
        grossCents: true,
        holidayPayCents: true,
        status: true,
        createdAt: true,
        paidAt: true,
        job: { select: { jobNumber: true, title: true } },
      },
    }),
    db.job.findMany({
      where: { workerId, status: { in: ["ASSIGNED", "SUBMITTED"] }, pricing: { isNot: null }, payouts: { none: { workerId } } },
      orderBy: [{ jobNumber: "asc" }],
      select: {
        id: true,
        jobNumber: true,
        title: true,
        status: true,
        pricing: { select: { minutes: true, workerRateCents: true, holidayPayBps: true } },
        variations: { where: { status: "APPROVED", minutes: { not: null } }, select: { minutes: true } },
      },
    }),
    db.payrollDetails.findUnique({
      where: { userId: workerId },
      select: { irdNumberEncrypted: true, bankAccountEncrypted: true, taxCode: true },
    }),
  ]);

  const records: PayoutRecord[] = payouts.map((payout) => ({
    id: payout.id,
    jobNumber: jobNumberLabel(payout.job.jobNumber),
    title: payout.job.title,
    minutes: payout.minutes,
    rateCents: payout.rateCents,
    grossCents: payout.grossCents,
    holidayPayCents: payout.holidayPayCents,
    status: payout.status,
    createdAt: payout.createdAt.toISOString(),
    paidAt: payout.paidAt?.toISOString() ?? null,
  }));

  const waiting: WaitingJob[] = [];
  for (const job of jobs) {
    if (!job.pricing) continue;
    try {
      const amounts = calculatePayout({
        jobMinutes: job.pricing.minutes,
        approvedExtraMinutes: job.variations.map((variation) => variation.minutes as number),
        workerRateCents: job.pricing.workerRateCents,
        holidayPayBps: job.pricing.holidayPayBps,
      });
      waiting.push({
        id: job.id,
        jobNumber: jobNumberLabel(job.jobNumber),
        title: job.title,
        totalCents: amounts.totalCents,
        submitted: job.status === "SUBMITTED",
      });
    } catch (error) {
      // One job with figures the maths refuses must not hide the rest of the page.
      console.error(`Earnings: couldn't work out what ${jobNumberLabel(job.jobNumber)} will pay.`, error);
    }
  }

  return { view: buildEarnings({ payouts: records, waiting, now }), payrollDetails: checkPayrollDetails(details) };
}
