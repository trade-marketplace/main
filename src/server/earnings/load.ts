// Reads one tradie's earnings (#165, D12): their payouts, the jobs on their way to one, and whether payroll has
// what it needs to pay them. Only that tradie's rows: every query is scoped to `workerId`, and nothing here reads
// the customer's price, the margin or on-costs (the worker sees what they earn, never what the customer pays).
// What a job will pay once it is signed off comes from the payout maths itself (calculatePayout, #164). Materials
// repaid with each payout (#512) come from the same reader as the office's payroll export, so the totals agree.
import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { addDays, type EarningsView, buildEarnings, nzDay, type PayoutRecord, type WaitingJob } from "@/lib/earnings";
import { jobNumberLabel } from "@/lib/office-jobs";
import { calculatePayout } from "@/server/payouts/calculate";
import { materialsForPayouts } from "@/server/payouts/materials";
import { checkPayrollDetails, type PayrollDetailsCheck } from "@/server/payouts/queue-payout";
import { workerPayoutView, workerWaitingJobView } from "@/server/views/earnings";

/** Just the parts of Prisma this read uses, so tests pass a fake and nothing connects to a database. */
export type EarningsDatabase = { payout: Pick<PrismaClient["payout"], "findMany" | "count">; job: Pick<PrismaClient["job"], "findMany">; payrollDetails: Pick<PrismaClient["payrollDetails"], "findUnique">; auditLog: Pick<PrismaClient["auditLog"], "findMany"> };

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
        jobId: true,
        workerId: true,
        minutes: true,
        rateCents: true,
        grossCents: true,
        holidayPayCents: true,
        status: true,
        createdAt: true,
        exportedAt: true,
        paidAt: true,
        job: { select: { jobNumber: true, title: true } },
      },
    }),
    db.job.findMany({
      where: { workerId, status: { in: ["ASSIGNED", "SUBMITTED"] }, pricing: { isNot: null }, payouts: { none: { workerId } } },
      orderBy: [{ jobNumber: "asc" }],
      select: {
        id: true,
        workerId: true,
        jobNumber: true,
        title: true,
        status: true,
        pricing: { select: { minutes: true, workerRateCents: true, holidayPayBps: true } },
        variations: { where: { status: "APPROVED", minutes: { not: null } }, select: { minutes: true } },
      },
    }),
    db.payrollDetails.findUnique({
      where: { userId: workerId },
      select: { irdNumberEncrypted: true, bankAccountEncrypted: true, taxCode: true, kiwiSaverRatePct: true },
    }),
  ]);

  const viewer = { userId: workerId, role: "TRADIE" } as const;
  const own = payouts.filter((payout) => payout.workerId === workerId);
  const materials = await materialsForPayouts(db, own.map((payout) => ({ id: payout.id, jobId: payout.jobId, workerId: payout.workerId, status: payout.status })));
  const records: PayoutRecord[] = own.flatMap(payout => {
    const visible = workerPayoutView(viewer, payout);
    const repaid = materials.get(payout.id);
    return visible ? [{ id: visible.id, jobNumber: jobNumberLabel(visible.job.jobNumber), title: visible.job.title,
      minutes: visible.minutes, rateCents: visible.rateCents, grossCents: visible.grossCents,
      holidayPayCents: visible.holidayPayCents, materialsCents: repaid?.cents ?? 0, materialsHeld: repaid?.held ?? false,
      status: visible.status, createdAt: visible.createdAt, exportedAt: visible.exportedAt, paidAt: visible.paidAt }] : [];
  });

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
      const visible = workerWaitingJobView(viewer, job, amounts.totalCents);
      if (visible) waiting.push({ ...visible, jobNumber: jobNumberLabel(visible.jobNumber) });
    } catch (error) {
      // One job with figures the maths refuses must not hide the rest of the page.
      console.error(`Earnings: couldn't work out what ${jobNumberLabel(job.jobNumber)} will pay.`, error);
    }
  }

  // The page lists a limited stretch of history. Someone paid long ago, with nothing since, isn't new: only a tradie
  // who has never had a payout sees "No earnings yet".
  const hadEarnings = records.length === 0 && waiting.length === 0 ? (await db.payout.count({ where: { workerId } })) > 0 : false;

  return { view: buildEarnings({ payouts: records, waiting, now, hadEarnings }), payrollDetails: checkPayrollDetails(details) };
}
