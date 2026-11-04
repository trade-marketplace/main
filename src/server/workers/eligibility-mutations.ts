import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { awardQuotePoints, pointBalance } from "@/server/points/ledger";
import { canEstimate, eligibilityFailure, JOB_ELIGIBILITY_SELECT, WORKER_ELIGIBILITY_SELECT, type EligibilityFailure } from "./eligibility";

export class WorkerEligibilityError extends Error {
  constructor(readonly failure: EligibilityFailure) { super(failure); this.name = "WorkerEligibilityError"; }
}

/** Lock the job and current proofs in the real schema; the GUC is a lock target, never an auth assertion. */
export async function lockEligibilityRows(tx: Prisma.TransactionClient, workerId: string, jobId: string): Promise<boolean> {
  await tx.$executeRaw`SELECT set_config('app.eligibility_worker_id', ${workerId}, true)`;
  const locked = await tx.job.updateMany({ where: { id: jobId }, data: { updatedAt: new Date() } });
  await tx.$executeRaw`SELECT set_config('app.eligibility_worker_id', '', true)`;
  return locked.count === 1;
}

type EstimateInput = Pick<Prisma.EstimateUncheckedCreateInput, "minutes" | "materialsCents" | "note" | "needsSiteVisit">;

/** Internal estimate command for the future drawer: authenticated actor only, explicit fields, fresh policy. */
export async function saveEligibleEstimate(db: PrismaClient, actor: { userId: string }, jobId: string, input: EstimateInput, now?: Date): Promise<{ id: string; pointsAwarded: number; points: number }> {
  return db.$transaction(async tx => {
    if (!await lockEligibilityRows(tx, actor.userId, jobId)) throw new WorkerEligibilityError("not-open");
    // An interactive transaction uses one PostgreSQL connection; read sequentially while its locks are held.
    const worker = await tx.profile.findUnique({ where: { id: actor.userId }, select: WORKER_ELIGIBILITY_SELECT });
    const job = await tx.job.findUnique({ where: { id: jobId }, select: JOB_ELIGIBILITY_SELECT });
    const settings = await tx.settings.findUnique({ where: { id: 1 }, select: { enabledTrades: true } });
    if (!job) throw new WorkerEligibilityError("not-open");
    const context = { now: now ?? new Date(), ...(settings ? { enabledTrades: settings.enabledTrades } : {}) };
    if (!canEstimate(worker, job, context)) throw new WorkerEligibilityError(eligibilityFailure(worker, job, "estimate", context)!);
    const data = { minutes: input.minutes, materialsCents: input.materialsCents ?? 0, note: input.note ?? null, needsSiteVisit: input.needsSiteVisit ?? false };
    const saved = await tx.estimate.upsert({ where: { jobId_workerId: { jobId, workerId: actor.userId } },
      create: { jobId, workerId: actor.userId, ...data }, update: data, select: { id: true } });
    // Points are earned in the same transaction as the quote, so a refused quote never earns one.
    const pointsAwarded = await awardQuotePoints(tx, actor.userId, jobId);
    return { ...saved, pointsAwarded, points: await pointBalance(tx, actor.userId) };
  });
}
