"use server";

import { getAddressSearchProvider, searchAddresses } from "@/server/geo/address-search";
import { loadCoverage } from "@/server/geo/coverage-settings";
import { consumeForClient } from "@/server/rate-limit";

/** Place selection can enter a saved job draft, so request permanent Mapbox results. */
export async function searchLandingPlacesAction(query: string) {
  // Too many searches: fall back to typing the place by hand, which always works.
  if (!(await consumeForClient("placeSearch")).allowed) return { mode: "manual" as const, reason: "unavailable" as const };
  try {
    return await searchAddresses(typeof query === "string" ? query.slice(0, 120) : "", {
      coverage: await loadCoverage(), provider: getAddressSearchProvider(process.env, ["place", "locality"], true),
    });
  } catch { return { mode: "manual" as const, reason: "unavailable" as const }; }
}
