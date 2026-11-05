import type { Trade } from "@/generated/prisma/client";
import type { JobTimeWindowView, WorkerJobView } from "@/server/views/jobs";
import type { EligibilityFailure } from "@/server/workers/eligibility";

/** Only the worker's frozen pay and materials budget cross the claim boundary. */
export type WorkerClaimView = {
  id: string; jobNumber: number; title: string; description: string; category: Trade; suburb: string; city: string;
  customerFirstName: string; assignedToYou: boolean; customerPhone: string | null; address: WorkerJobView["address"];
  asap: boolean; anyTime: boolean; timeWindows: JobTimeWindowView[];
  earn: { cents: number; minutes: number; rateCents: number; holidayPay: boolean };
  budgetCents: number; needs: { coc: boolean; photos: number; notes: boolean } | null;
};
export type WorkerClaimResult = { status: "claimed"; job: WorkerClaimView; contactHref: string }
  | { status: "lost" } | { status: "ineligible"; failure: EligibilityFailure } | { status: "unavailable" }
  | { status: "points"; balance: number; cost: number };
/** The worker's points and what claiming costs (#491). */
export type ClaimPoints = { balance: number; cost: number };

export const CLAIM_FAILURE_COPY: Record<EligibilityFailure, string> = {
  "worker-required": "Log in as a tradie to claim this job.", "email-required": "Confirm your email to claim this job.",
  "identity-required": "Get verified to claim this job.", "worker-paused": "Your account is paused. Contact the office.",
  "own-job": "You can’t claim your own job.", "not-open": "This job is no longer available.",
  "time-windows-expired": "The customer needs to add new time windows.", "trade-unavailable": "This trade is currently unavailable.",
  "trade-mismatch": "This job needs a different trade.", "licence-required": "You need a current, checked licence for this trade.",
  "work-area-required": "Set your work area to claim this job.", "location-unavailable": "This job’s location needs checking.",
  "outside-work-area": "This job is outside your work area.",
};
