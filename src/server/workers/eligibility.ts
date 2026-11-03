import "server-only";

import type { JobStatus, Prisma, Trade } from "@/generated/prisma/client";
import { haversineKm, isInNewZealand, isPoint, type Point } from "@/lib/geo/distance";
import { APPROX_MAX_METRES, APPROX_MIN_METRES } from "@/server/geo/approximate";
import { hasCurrentTradeLicence, workerBasicProofFailure, WORKER_VERIFICATION_SELECT, type BasicProofFailure } from "./verification";

export const WORKER_ELIGIBILITY_SELECT = {
  id: true, role: true, email: true, emailVerifiedAt: true,
  workerProfile: { select: { ...WORKER_VERIFICATION_SELECT.workerProfile.select, baseSuburb: true, areaLat: true, areaLng: true, areaRadiusKm: true, available: true } },
  workerTrades: WORKER_VERIFICATION_SELECT.workerTrades,
} satisfies Prisma.ProfileSelect;
export type EligibilityWorker = Prisma.ProfileGetPayload<{ select: typeof WORKER_ELIGIBILITY_SELECT }>;

/** Internal facts only. Neither this selector nor its raw location fields is a browser DTO. */
export const JOB_ELIGIBILITY_SELECT = {
  id: true, customerId: true, workerId: true, status: true, category: true,
  lat: true, lng: true, approxLat: true, approxLng: true,
} satisfies Prisma.JobSelect;
export type EligibilityJob = Prisma.JobGetPayload<{ select: typeof JOB_ELIGIBILITY_SELECT }>;
export const DISCOVERY_STATUSES = ["REVIEW", "QUOTE_BOUNTY", "BOOKABLE"] as const satisfies readonly JobStatus[];
export const LAUNCH_TRADES = ["ELECTRICAL", "PLUMBING", "GAS", "CONSTRUCTION", "OTHER"] as const satisfies readonly Trade[];
export type EligibilityIntent = "discover" | "claim" | "estimate";
export type EligibilityFailure = BasicProofFailure | "own-job" | "not-open" | "trade-unavailable" | "trade-mismatch" | "licence-required" | "work-area-required" | "location-unavailable" | "outside-work-area";
export type EligibilityContext = { now?: Date; enabledTrades?: readonly Trade[] };

/** Fixed preclaim pin; no exact fallback or new random point. Bounds match #97's persisted privacy ring. */
export function eligibilityPin(job: EligibilityJob): Point | null {
  const exact = typeof job.lat === "number" && typeof job.lng === "number" ? { lat: job.lat, lng: job.lng } : null;
  const approximate = typeof job.approxLat === "number" && typeof job.approxLng === "number" ? { lat: job.approxLat, lng: job.approxLng } : null;
  if (!exact || !approximate || !isPoint(exact) || !isPoint(approximate) || !isInNewZealand(approximate)) return null;
  const metres = haversineKm(exact, approximate) * 1000;
  return metres >= APPROX_MIN_METRES - 0.000001 && metres <= APPROX_MAX_METRES + 0.000001 ? approximate : null;
}

export function eligibilityFailure(worker: EligibilityWorker | null, job: EligibilityJob, intent: EligibilityIntent = "discover", context: EligibilityContext = {}): EligibilityFailure | null {
  const now = context.now ?? new Date();
  const basic = workerBasicProofFailure(worker, now);
  if (basic || !worker) return basic ?? "worker-required";
  if (job.customerId === worker.id) return "own-job";
  const statuses: readonly JobStatus[] = intent === "claim" ? ["BOOKABLE"] : intent === "estimate" ? ["REVIEW", "QUOTE_BOUNTY"] : DISCOVERY_STATUSES;
  if (job.workerId !== null || !statuses.includes(job.status)) return "not-open";
  if (!(context.enabledTrades ?? LAUNCH_TRADES).includes(job.category)) return "trade-unavailable";
  if (job.category !== "OTHER") {
    if (!worker.workerTrades.some(row => row.trade === job.category)) return "trade-mismatch";
    if (!hasCurrentTradeLicence(worker, job.category, now)) return "licence-required";
  }
  const area = worker.workerProfile!;
  const centre = typeof area.areaLat === "number" && typeof area.areaLng === "number" ? { lat: area.areaLat, lng: area.areaLng } : null;
  if (!area.baseSuburb?.trim() || !centre || !isPoint(centre) || !isInNewZealand(centre) || typeof area.areaRadiusKm !== "number" || !Number.isFinite(area.areaRadiusKm) || area.areaRadiusKm <= 0) return "work-area-required";
  const pin = eligibilityPin(job);
  if (!pin) return "location-unavailable";
  return haversineKm(centre, pin) <= area.areaRadiusKm ? null : "outside-work-area";
}

export const canClaim = (worker: EligibilityWorker | null, job: EligibilityJob, context: EligibilityContext = {}) => eligibilityFailure(worker, job, "claim", context) === null;
export const canEstimate = (worker: EligibilityWorker | null, job: EligibilityJob, context: EligibilityContext = {}) => eligibilityFailure(worker, job, "estimate", context) === null;

/** Server-only IDs, reusable across board/map/pings. The presentation layer must apply its worker read tier. */
export function eligibleJobsFor(worker: EligibilityWorker | null, jobs: readonly EligibilityJob[], context: EligibilityContext = {}): string[] {
  return jobs.filter(job => eligibilityFailure(worker, job, "discover", context) === null).map(job => job.id);
}
