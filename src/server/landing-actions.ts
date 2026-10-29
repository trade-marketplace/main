"use server";

import { getAddressSearchProvider, searchAddresses } from "@/server/geo/address-search";
import { loadCoverage } from "@/server/geo/coverage-settings";

/** Place selection can enter a saved job draft, so request permanent Mapbox results. */
export async function searchLandingPlacesAction(query: string) {
  try {
    return await searchAddresses(typeof query === "string" ? query.slice(0, 120) : "", {
      coverage: await loadCoverage(), provider: getAddressSearchProvider(process.env, ["place", "locality"], true),
    });
  } catch { return { mode: "manual" as const, reason: "unavailable" as const }; }
}
