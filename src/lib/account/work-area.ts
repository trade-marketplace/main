import { parseWorkerSignup, type SignupTrade } from "@/lib/auth/worker-signup";
import { isInNewZealand, type Point } from "@/lib/geo/distance";

export const WORK_AREA_SELECTION_ERROR = "Choose a suburb from the search results.";

export type WorkAreaInput = { baseSuburb: string; radiusKm: string | number; point: Point | null };
export type WorkAreaErrors = Partial<Record<"baseSuburb" | "radiusKm", string>>;
export type WorkAreaSnapshot = WorkAreaInput & { available: boolean; paused: boolean; trades: SignupTrade[] };
export type WorkAreaResult = { ok: true; snapshot: WorkAreaSnapshot } | { ok: false; error: "invalid"; fields: WorkAreaErrors } | { ok: false; error: "forbidden" | "unavailable" | "session-expired" };
export type WorkAreaSave = (input: WorkAreaInput) => Promise<WorkAreaResult>;
export type AvailabilitySave = (available: boolean) => Promise<WorkAreaResult>;
export const WORK_AREA_STATES = ["ready", "changed", "saving", "saved", "field-error", "search-unavailable", "map-unavailable", "unavailable-off", "paused", "from-jobs", "error", "offline", "loading", "load-error"] as const;
export type WorkAreaState = typeof WORK_AREA_STATES[number];

/** Apply the sign-up schema without requiring this read-only page to resubmit trades or licences. */
export function parseWorkArea(input: WorkAreaInput) {
  const result = parseWorkerSignup({ ...input, trades: ["OTHER"], licences: {} });
  if (!result.ok) {
    const fields = { ...result.errors } as WorkAreaErrors;
    if (fields.baseSuburb === "Choose the suburb again, or type it by hand.") fields.baseSuburb = WORK_AREA_SELECTION_ERROR;
    return { ok: false as const, fields };
  }
  if (!result.details.point || !isInNewZealand(result.details.point)) return { ok: false as const, fields: { baseSuburb: WORK_AREA_SELECTION_ERROR } };
  return { ok: true as const, data: { baseSuburb: result.details.baseSuburb, radiusKm: result.details.radiusKm, point: result.details.point } };
}

export function workAreaChanged(saved: WorkAreaInput, current: WorkAreaInput): boolean {
  return saved.baseSuburb !== current.baseSuburb || Number(saved.radiusKm) !== Number(current.radiusKm)
    || saved.point?.lat !== current.point?.lat || saved.point?.lng !== current.point?.lng;
}
