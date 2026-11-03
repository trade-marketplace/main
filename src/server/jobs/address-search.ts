import "server-only";
import { getAddressSearchProvider, searchAddresses, type AddressSearchProvider } from "@/server/geo/address-search";
import { loadCoverage } from "@/server/geo/coverage-settings";
import type { Coverage } from "@/lib/geo/coverage";
import type { LandingLocation } from "@/lib/landing";

/** Saved draft addresses require permanent results. Search remains a convenience with a manual fallback. */
export async function searchJobAddresses(query: string, deps?: { provider: AddressSearchProvider | null; coverage: Coverage }, hint?: LandingLocation) {
  if (typeof query !== "string" || query.trim().length < 3) return { mode: "search" as const, suggestions: [] };
  const provider = deps ? deps.provider : getAddressSearchProvider(process.env, ["address"], true);
  if (!provider) return { mode: "manual" as const, reason: "not-configured" as const };
  // The landing place only helps rank actual address suggestions; coverage uses each returned point.
  return searchAddresses((hint ? `${query}, ${hint.label}` : query).slice(0, 200), { provider, coverage: deps?.coverage ?? await loadCoverage(), near: hint?.point ?? undefined });
}
