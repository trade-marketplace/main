// The coverage area: where we take jobs (#97). A centre and a radius; Invercargill at launch (DECISIONS.md 12).
// Pure: the office sets the area in settings (F14, Schema 3 #91) and src/server/geo/coverage-settings.ts loads it.

import { haversineKm, type Point } from "./distance";

export type Coverage = {
  /** Shown to people, e.g. on the waitlist page (A07): "We're in Invercargill". */
  name: string;
  centre: Point;
  radiusKm: number;
};

/**
 * Until settings exist: 20 km around central Invercargill (Matt, 26 Oct). The same centre and radius as the
 * settings row's defaults (Schema 3, #91). The one place the fallback is defined: use this, never the numbers.
 */
export const INVERCARGILL_COVERAGE: Coverage = {
  name: "Invercargill",
  centre: { lat: -46.4132, lng: 168.3538 },
  radiusKm: 20,
};

/** The waitlist page (A07, `/coming-soon`): where someone goes when their address is outside coverage. */
export const WAITLIST_PATH = "/coming-soon";

export type CoverageResult =
  | { status: "inside"; distanceKm: number }
  | { status: "outside"; distanceKm: number; waitlistPath: string }
  // No point to check (address search was down and nothing was found): the office checks it later.
  | { status: "check-later" };

/**
 * Is this point in the area? On the edge counts as inside. `distanceKm` is from the centre, unrounded, for
 * the office; people never see it.
 */
export function checkCoverage(coverage: Coverage, point: Point | null): CoverageResult {
  if (!point) return { status: "check-later" };
  const distanceKm = haversineKm(coverage.centre, point);
  return distanceKm <= coverage.radiusKm
    ? { status: "inside", distanceKm }
    : { status: "outside", distanceKm, waitlistPath: WAITLIST_PATH };
}
