// Materials repayment for non-electrical jobs (#512, DECISIONS.md "Materials for non-electrical jobs" and "Materials
// repayment"). Pure: no database, no clock; safe on server and browser.
//
// The tradie buys the materials, reports the spend and uploads the receipt at finish (#150). Payroll repays them:
//
//   electrical job, no budget, or nothing spent  → nothing to repay, nothing held (Telfer account)
//   spend within the budget                       → the spend, automatically
//   spend over the budget, not checked yet        → held: the lead's payout stays out of payroll
//   spend over the budget, checked by the office  → what the office approved (the spend, or a set amount up to it)
//
// The office's decision is an audit entry on `job_materials` (MATERIALS_DECISION_ACTIONS) whose `after` carries the
// cents to repay and the spend it was made for. A decision only counts while the spend is still the one it checked:
// if the tradie reports a different spend later (the job was sent back), it needs checking again.
import type { Trade } from "@/generated/prisma/enums";

/** Audit actions that record the office's decision. The newest one for the current spend counts. */
export const MATERIALS_DECISION_ACTIONS = ["materials.approved", "materials.amount_changed"] as const;
export type MaterialsDecisionAction = (typeof MATERIALS_DECISION_ACTIONS)[number];

export type MaterialsSource = {
  category: Trade;
  materials: { budgetCents: number; spentCents: number | null } | null | undefined;
};

/** A decision read back from the audit log: what to repay, for which spend. */
export type MaterialsDecisionRecord = { repaidCents: number; spentCents: number };

export type MaterialsRepayment =
  /** Electrical, no budget, or nothing spent or reported. */
  | { state: "none"; repaidCents: 0 }
  /** Within budget: the spend is repaid without anyone checking. */
  | { state: "auto"; repaidCents: number }
  /** Over budget and not checked yet: hold the payout. */
  | { state: "to-check"; repaidCents: 0 }
  /** Over budget and checked by the office. */
  | { state: "decided"; repaidCents: number };

export function materialsRepayment(source: MaterialsSource, decision: MaterialsDecisionRecord | null): MaterialsRepayment {
  const spent = source.materials?.spentCents ?? null;
  const budget = source.materials?.budgetCents ?? 0;
  if (source.category === "ELECTRICAL" || spent === null || spent <= 0) return { state: "none", repaidCents: 0 };
  if (spent <= budget) return { state: "auto", repaidCents: spent };
  if (decision && decision.spentCents === spent && Number.isInteger(decision.repaidCents) && decision.repaidCents >= 0 && decision.repaidCents <= spent) {
    return { state: "decided", repaidCents: decision.repaidCents };
  }
  return { state: "to-check", repaidCents: 0 };
}

/** Reads a decision audit entry's `after`. Anything malformed is no decision (so the payout stays held). */
export function decisionFromAudit(after: unknown): MaterialsDecisionRecord | null {
  if (typeof after !== "object" || after === null || Array.isArray(after)) return null;
  const { repaidCents, spentCents } = after as Record<string, unknown>;
  return typeof repaidCents === "number" && typeof spentCents === "number" ? { repaidCents, spentCents } : null;
}

/** The materials repaid in an export, as its `payout.exported` audit entry froze it. Exports before #512: none. */
export function exportedMaterialsFromAudit(after: unknown): number {
  if (typeof after !== "object" || after === null || Array.isArray(after)) return 0;
  const value = (after as Record<string, unknown>).materialsCents;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}
