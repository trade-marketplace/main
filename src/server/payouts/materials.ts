import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import {
  MATERIALS_DECISION_ACTIONS,
  decisionFromAudit,
  exportedMaterialsFromAudit,
  materialsRepayment,
  type MaterialsDecisionRecord,
  type MaterialsRepayment,
} from "@/lib/materials-repayment";

// What each payout repays for materials (#512). One reader for the payroll export, the Payouts page, the job admin and
// the tradie's Earnings, so they always agree.
//
// - Only the job's lead (`jobs.worker_id`, the tradie who reported the spend) is repaid. Other crew payouts on the same
//   job repay nothing, so a crew job's materials are repaid once.
// - A payout still QUEUED reads the job's materials and the office's newest decision (src/lib/materials-repayment.ts).
// - A payout already EXPORTED or PAID reads the figure its export froze in the `payout.exported` audit entry, so a batch
//   and its CSV never change after they went to payroll. Exports from before #512 carried no materials: 0.

export type PayoutMaterials = {
  /** Cents repaid with this payout (0 when nothing, or while held). */
  cents: number;
  /** Over budget and not checked yet: the payout stays out of payroll. */
  held: boolean;
};

const NOTHING: PayoutMaterials = { cents: 0, held: false };

type PayoutRef = { id: string; jobId?: string; workerId: string; status: "QUEUED" | "EXPORTED" | "PAID" };

export type MaterialsReader = {
  job: Pick<PrismaClient["job"], "findMany">;
  auditLog: Pick<PrismaClient["auditLog"], "findMany">;
};

/** The office's newest decision on each job's materials, by job id. */
export async function latestDecisions(db: Pick<MaterialsReader, "auditLog">, jobIds: readonly string[]): Promise<Map<string, MaterialsDecisionRecord>> {
  const decisions = new Map<string, MaterialsDecisionRecord>();
  if (!jobIds.length) return decisions;
  const rows = await db.auditLog.findMany({
    where: { recordType: "job_materials", recordId: { in: [...new Set(jobIds)] }, action: { in: [...MATERIALS_DECISION_ACTIONS] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { recordId: true, after: true },
  });
  for (const row of rows ?? []) {
    if (decisions.has(row.recordId)) continue;
    const decision = decisionFromAudit(row.after);
    if (decision) decisions.set(row.recordId, decision);
  }
  return decisions;
}

/** The materials each exported or paid payout's export froze, by payout id. */
export async function exportedMaterials(db: Pick<MaterialsReader, "auditLog">, payoutIds: readonly string[]): Promise<Map<string, number>> {
  const frozen = new Map<string, number>();
  if (!payoutIds.length) return frozen;
  const rows = await db.auditLog.findMany({
    where: { recordType: "payouts", recordId: { in: [...new Set(payoutIds)] }, action: "payout.exported" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { recordId: true, after: true },
  });
  // A payout is exported once (the database refuses any move back), so there is one entry; the first one counts.
  for (const row of rows ?? []) if (!frozen.has(row.recordId)) frozen.set(row.recordId, exportedMaterialsFromAudit(row.after));
  return frozen;
}

/** What a job repays its lead right now, given the office's decision. */
export function repaymentOf(job: { category: Parameters<typeof materialsRepayment>[0]["category"]; materials?: { budgetCents: number; spentCents: number | null } | null }, decision: MaterialsDecisionRecord | null | undefined): MaterialsRepayment {
  return materialsRepayment({ category: job.category, materials: job.materials ?? null }, decision ?? null);
}

/** Materials for each payout, by payout id. Payouts without a job id (or not the lead's) repay nothing. */
export async function materialsForPayouts(db: MaterialsReader, payouts: readonly PayoutRef[]): Promise<Map<string, PayoutMaterials>> {
  const result = new Map<string, PayoutMaterials>();
  const sent = payouts.filter((payout) => payout.status !== "QUEUED");
  const queued = payouts.filter((payout) => payout.status === "QUEUED" && payout.jobId);
  const [frozen, jobs] = await Promise.all([
    exportedMaterials(db, sent.map((payout) => payout.id)),
    queued.length
      ? db.job.findMany({
          where: { id: { in: [...new Set(queued.map((payout) => payout.jobId as string))] } },
          select: { id: true, workerId: true, category: true, materials: { select: { budgetCents: true, spentCents: true } } },
        })
      : Promise.resolve([]),
  ]);
  const byId = new Map((jobs ?? []).map((job) => [job.id, job]));
  const decisions = await latestDecisions(db, [...byId.values()].filter((job) => job.materials && (job.materials.spentCents ?? 0) > job.materials.budgetCents).map((job) => job.id));

  for (const payout of payouts) {
    if (payout.status !== "QUEUED") {
      result.set(payout.id, { cents: frozen.get(payout.id) ?? 0, held: false });
      continue;
    }
    const job = payout.jobId ? byId.get(payout.jobId) : undefined;
    // The lead reported the materials; crew members' payouts repay none.
    if (!job || !job.category || job.workerId !== payout.workerId) {
      result.set(payout.id, NOTHING);
      continue;
    }
    const repayment = repaymentOf(job, decisions.get(job.id));
    result.set(payout.id, { cents: repayment.repaidCents, held: repayment.state === "to-check" });
  }
  return result;
}
