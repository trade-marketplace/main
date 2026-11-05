import { z } from "zod";
import type { WorkerJobView } from "@/server/views/jobs";
import type { EligibilityFailure } from "@/server/workers/eligibility";

export const workerEstimateSchema = z.object({
  hours: z.string().trim().regex(/^(?:\d+(?:\.\d+)?)$/, "Use half-hour steps from 0.5 to 40.").transform(Number).pipe(z.number().min(0.5).max(40).multipleOf(0.5)),
  materials: z.string().trim().regex(/^\d+(?:\.\d{1,2})?$/, "Enter a materials cost of $0 or more.").transform(value => Math.round(Number(value) * 100)).pipe(z.number().int().min(0).max(2_147_483_647)),
  note: z.string().trim().max(2000), needsSiteVisit: z.boolean(),
}).strict();
export type EstimateFields = { hours: string; materials: string; note: string; needsSiteVisit: boolean };
export type OwnEstimate = NonNullable<WorkerJobView["ownEstimate"]>;
export type EstimateResult = { status: "saved"; estimate: OwnEstimate; pointsAwarded?: number; points?: number } | { status: "invalid"; fields: Partial<Record<keyof EstimateFields, string>> }
  | { status: "ineligible"; failure: EligibilityFailure } | { status: "unavailable" };
export const ESTIMATE_ELIGIBILITY_MESSAGES: Record<EligibilityFailure, string> = {
  "worker-required": "Log in as a tradie to quote this job.", "email-required": "Confirm your email to quote this job.",
  "identity-required": "Get verified to quote this job.", "worker-paused": "Your account is paused. Contact the office.",
  "own-job": "You can’t quote your own job.", "not-open": "This job is no longer open for quotes.",
  "time-windows-expired": "The customer needs to add new time windows.", "trade-unavailable": "This trade is currently unavailable.",
  "trade-mismatch": "This job needs a different trade.", "licence-required": "You need a current, checked licence for this trade.",
  "work-area-required": "Set your work area to quote this job.", "location-unavailable": "This job’s location needs checking.",
  "outside-work-area": "This job is outside your work area.",
};
export function estimateFields(estimate: OwnEstimate | null): EstimateFields {
  return estimate ? { hours: String(estimate.minutes / 60), materials: (estimate.materialsCents / 100).toFixed(2), note: estimate.note ?? "", needsSiteVisit: estimate.needsSiteVisit }
    : { hours: "0.5", materials: "0.00", note: "", needsSiteVisit: false };
}
