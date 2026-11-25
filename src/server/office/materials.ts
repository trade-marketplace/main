// The office's check of an over-budget materials spend (#512, DECISIONS.md "Materials repayment"): the job admin's
// Materials card, and its two decisions, "Approve spend" (repay the whole spend) and "Change amount" (repay a set
// amount up to the spend). Until one is made, the lead's payout is held out of the payroll export
// (src/server/payouts/materials.ts). Electrical jobs buy on the Telfer account: nothing to repay or check.
//
// A decision is an audit entry on `job_materials` (no schema change): `after` carries `repaidCents`, the `spentCents`
// it was made for, and the budget; the office's note is its reason. It is written inside the payroll lock, so it can't
// cross an export, and refused once the lead's payout has gone to payroll (the export froze the figure). The tradie is
// told in-app (payout.materials_checked).
import "server-only";

import type { Prisma, PrismaClient, Trade } from "@/generated/prisma/client";
import { MATERIALS_DECISION_ACTIONS, decisionFromAudit, type MaterialsDecisionAction } from "@/lib/materials-repayment";
import { MATERIALS_MESSAGES, parseMaterialsDecision, type MaterialsDecisionResult, type OfficeMaterialsView } from "@/lib/office/materials";
import { whenLabel } from "@/lib/office-job";
import { createAudit } from "@/server/audit/audit";
import { createSupabaseFileStore, DOCUMENT_BUCKET, SIGNED_URL_SECONDS } from "@/server/files/storage";
import { lockJobWindows } from "@/server/jobs/window-lock";
import { createNotify } from "@/server/notifications/notify";
import { PAYROLL_LOCK } from "@/server/office/payouts";
import { exportedMaterials, repaymentOf } from "@/server/payouts/materials";
import type { JobViewer } from "@/server/views";

export type MaterialsSource = {
  id: string;
  category: Trade;
  workerId: string | null;
  materials: { budgetCents: number; spentCents: number | null; receiptPath: string | null } | null;
  /** Set while the tradie's finish-up is sent (cleared when the office sends it back): only then is the spend reported. */
  evidence: { submittedAt: Date | null } | null;
  payouts: { id: string; workerId: string; status: "QUEUED" | "EXPORTED" | "PAID" }[];
};

export type MaterialsDatabase = {
  auditLog: Pick<PrismaClient["auditLog"], "findMany">;
  profile: Pick<PrismaClient["profile"], "findMany">;
};

export const signReceipt = (path: string) => createSupabaseFileStore().signedUrl(DOCUMENT_BUCKET, path, SIGNED_URL_SECONDS);

/** The Materials card, or null when there is none (electrical, or no budget and nothing spent). Office only. */
export async function officeMaterialsView(db: MaterialsDatabase, job: MaterialsSource, now: Date, sign: (path: string) => Promise<string> = signReceipt): Promise<OfficeMaterialsView | null> {
  const materials = job.materials;
  if (job.category === "ELECTRICAL" || !materials || (materials.budgetCents <= 0 && !materials.spentCents)) return null;
  const rows = (await db.auditLog.findMany({
    where: {
      OR: [
        { recordType: "jobs", recordId: job.id, action: "job.materials_reported" },
        { recordType: "job_materials", recordId: job.id, action: { in: [...MATERIALS_DECISION_ACTIONS] } },
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 50,
    select: { id: true, action: true, actorId: true, after: true, reason: true, createdAt: true },
  })) ?? [];
  const reported = rows.find((row) => row.action === "job.materials_reported");
  const decisionRow = rows.find((row) => (MATERIALS_DECISION_ACTIONS as readonly string[]).includes(row.action) && decisionFromAudit(row.after));
  const repayment = repaymentOf(job, decisionRow ? decisionFromAudit(decisionRow.after) : null);
  const lead = job.payouts.find((payout) => payout.workerId === job.workerId) ?? null;
  const sent = lead !== null && lead.status !== "QUEUED";
  // A sent payout repays what its export froze, whatever has happened since.
  const repaidCents = sent ? ((await exportedMaterials(db, [lead.id])).get(lead.id) ?? 0) : repayment.repaidCents;
  const decision = repayment.state === "decided" && decisionRow ? decisionRow : null;
  const deciders = decision?.actorId ? await db.profile.findMany({ where: { id: { in: [decision.actorId] } }, select: { id: true, firstName: true } }) : [];

  let receipt: OfficeMaterialsView["receipt"] = null;
  if (materials.receiptPath) {
    try { receipt = { url: await sign(materials.receiptPath) }; } catch { receipt = { url: null }; }
  }
  // A draft spend (saved for later, or sent back to fix) isn't reported yet.
  const spent = job.evidence?.submittedAt ? materials.spentCents : null;
  const over = spent !== null && spent > materials.budgetCents;
  return {
    budgetCents: materials.budgetCents,
    spentCents: spent,
    receipt: spent === null ? null : receipt,
    reason: over ? (reported?.reason ?? null) : null,
    state: spent === null ? "not-reported" : repayment.state === "none" ? "auto" : repayment.state,
    repaidCents,
    decision: decision
      ? {
          kind: decision.action === "materials.amount_changed" ? "changed" : "approved",
          repaidCents: repayment.repaidCents,
          by: deciders?.find((person) => person.id === decision.actorId)?.firstName ?? null,
          at: decision.createdAt.toISOString(),
          when: whenLabel(decision.createdAt, now),
          note: decision.reason,
        }
      : null,
    sent,
    canDecide: over && !sent,
  };
}

class Refusal extends Error {
  constructor(readonly result: MaterialsDecisionResult) {
    super("refused");
  }
}
const refuse = (error: Exclude<MaterialsDecisionResult, { ok: true }>["error"], message: string, field?: "amount" | "note"): never => {
  throw new Refusal({ ok: false, error, message, ...(field ? { field } : {}) });
};

/** "Approve spend" or "Change amount". Office only; never throws for a refusal. */
export async function decideMaterials(db: Pick<PrismaClient, "$transaction">, viewer: JobViewer, raw: unknown): Promise<MaterialsDecisionResult | { ok: false; error: "forbidden" }> {
  if (viewer.role !== "ADMIN" || !viewer.userId) return { ok: false, error: "forbidden" };
  const parsed = parseMaterialsDecision(raw);
  if (!parsed.ok) return { ok: false, error: "invalid", message: parsed.message, ...(parsed.field === "form" ? {} : { field: parsed.field }) };
  const input = parsed.input;
  try {
    return await db.$transaction(async (tx) => {
      // The payroll lock first (as the export takes it), then the job's row (as the tradie's finish-up takes it).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PAYROLL_LOCK[0]}::int, ${PAYROLL_LOCK[1]}::int)`;
      const person = await tx.profile.findUnique({ where: { id: viewer.userId }, select: { role: true } });
      if (person?.role !== "ADMIN") return { ok: false, error: "forbidden" } as const;
      if (!(await lockJobWindows(tx, input.jobId))) refuse("not-found", MATERIALS_MESSAGES.notFound);
      const job = await tx.job.findUnique({
        where: { id: input.jobId },
        select: { id: true, jobNumber: true, title: true, category: true, workerId: true, materials: { select: { budgetCents: true, spentCents: true } },
          evidence: { select: { submittedAt: true } }, payouts: { select: { workerId: true, status: true } } },
      });
      if (!job) return refuse("not-found", MATERIALS_MESSAGES.notFound);
      if (job.category === "ELECTRICAL") refuse("not-allowed", MATERIALS_MESSAGES.electrical);
      const spent = job.evidence?.submittedAt ? (job.materials?.spentCents ?? null) : null, budget = job.materials?.budgetCents ?? 0;
      if (spent === null || spent <= 0) refuse("not-allowed", MATERIALS_MESSAGES.notReported);
      if ((spent as number) <= budget) refuse("not-allowed", MATERIALS_MESSAGES.withinBudget);
      if (spent !== input.seenSpentCents) refuse("changed", MATERIALS_MESSAGES.changed);
      if (job.payouts.some((payout) => payout.workerId === job.workerId && payout.status !== "QUEUED")) refuse("not-allowed", MATERIALS_MESSAGES.sent);
      const repaidCents = input.kind === "approve" ? (spent as number) : input.repaidCents;
      if (repaidCents > (spent as number)) refuse("invalid", "Enter up to the spend.", "amount");

      const action: MaterialsDecisionAction = input.kind === "approve" ? "materials.approved" : "materials.amount_changed";
      // No `before`: the audit keeps only changed fields when both are given, and readers need the whole `after`.
      const entry = await createAudit(tx)(viewer, action, { type: "job_materials", id: job.id }, null,
        { repaidCents, spentCents: spent as number, budgetCents: budget } satisfies Prisma.InputJsonObject, input.note);
      if (job.workerId) {
        await createNotify(tx)("payout.materials_checked", [job.workerId], {
          eventId: `payout.materials_checked:${entry.id}`,
          payload: { jobId: job.id, jobNumber: job.jobNumber, jobTitle: job.title, repaidCents },
        });
      }
      return { ok: true, repaidCents } as const;
    }, { timeout: 30_000 });
  } catch (error) {
    if (error instanceof Refusal) return error.result;
    console.error("Materials check: the decision failed and was rolled back.", error);
    return { ok: false, error: "unavailable", message: MATERIALS_MESSAGES.unavailable };
  }
}
