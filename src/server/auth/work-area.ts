import "server-only";

import type { Coverage } from "@/lib/geo/coverage";
import { getAddressSearchProvider, searchAddresses, type AddressSearchProvider } from "@/server/geo/address-search";
import { loadCoverage } from "@/server/geo/coverage-settings";

export type SignupAreaSuggestion = { id: string; label: string; point: { lat: number; lng: number } };
export type SignupAreaResult = { mode: "search"; suggestions: SignupAreaSuggestion[] } | { mode: "manual"; reason: "not-configured" | "unavailable" };

/** Public signup lookup. Without a token, typing a suburb by hand always remains available. */
export async function searchSignupAreas(query: string, deps?: { provider: AddressSearchProvider | null; coverage: Coverage }): Promise<SignupAreaResult> {
  if (typeof query !== "string" || query.trim().length < 3) return { mode: "search", suggestions: [] };
  const provider = deps ? deps.provider : getAddressSearchProvider(process.env, ["locality", "neighborhood", "place"]);
  // No provider means no reason to read settings or call any external service.
  if (!provider) return { mode: "manual", reason: "not-configured" };
  const coverage = deps?.coverage ?? await loadCoverage();
  const result = await searchAddresses(query.trim().slice(0, 120), { provider, coverage });
  if (result.mode === "manual") return result;
  const labels = new Set<string>();
  return { mode: "search", suggestions: result.suggestions.flatMap((place) => {
    const label = place.suburb === place.city ? place.city : `${place.suburb}, ${place.city}`;
    if (labels.has(label)) return [];
    labels.add(label);
    return [{ id: place.id, label, point: place.point }];
  }) };
}
