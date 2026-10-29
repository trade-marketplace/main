import { isCategory, type Category } from "./cards";
import { checkCoverage, type Coverage } from "./geo/coverage";
import type { Point } from "./geo/distance";

export type LandingLocation = { label: string; point: Point | null };
export type LandingReview = { id: string; name: string; rating: number; comment: string; meta?: string };
export type LandingData = { coverage: Coverage; location: LandingLocation; reviews: LandingReview[]; exampleReviews?: boolean; illustrationCents: number };
export type LandingDraft = { description: string; category?: Category; location: LandingLocation };
export const LANDING_DRAFT_KEY = "tm-post-job-start";
export const GEO_ASKED_KEY = "tm-home-location-asked";
// A brief homepage query, bounded so even fully percent-encoded Unicode survives the 2048-char auth return path.
export const LANDING_QUERY_MAX = 120;
export const LANDING_LOCATION_MAX = 80;

/** A hand-off, not a posting action. The wizard must validate all values and email ownership itself. */
export function jobStartPath(draft: LandingDraft, coverage: Coverage): string {
  const outside = checkCoverage(coverage, draft.location.point).status === "outside";
  const query = new URLSearchParams();
  const description = draft.description.trim().slice(0, LANDING_QUERY_MAX);
  if (description) query.set("description", description);
  if (isCategory(draft.category)) query.set("type", draft.category);
  if (draft.location.label.trim()) query.set("location", draft.location.label.trim().slice(0, LANDING_LOCATION_MAX));
  if (draft.location.point) {
    query.set("lat", String(draft.location.point.lat));
    query.set("lng", String(draft.location.point.lng));
  }
  return `${outside ? "/coming-soon" : "/jobs/new"}${query.size ? `?${query}` : ""}`;
}

/** Vercel geolocation is an editable hint, never authorization. */
export function ipLocation(headers: Pick<Headers, "get">, coverage: Coverage): LandingLocation {
  const rawCity = headers.get("x-vercel-ip-city") ?? "";
  let label = "";
  try { label = decodeURIComponent(rawCity).replace(/[\u0000-\u001f]/g, "").trim().slice(0, 120); } catch { /* malformed hint */ }
  const lat = Number(headers.get("x-vercel-ip-latitude"));
  const lng = Number(headers.get("x-vercel-ip-longitude"));
  const hasPoint = Boolean(headers.get("x-vercel-ip-latitude") && headers.get("x-vercel-ip-longitude")) && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  return label && hasPoint ? { label, point: { lat, lng } } : { label: coverage.name, point: null };
}
