import "server-only";

import { type Coverage, type CoverageResult, checkCoverage } from "@/lib/geo/coverage";
import { parseEnv } from "@/server/env";

import { type AddressSearchProvider, AddressSearchUnavailableError, type AddressSuggestion } from "./address-provider";
import { createMapboxAddressSearch } from "./mapbox";

// Address search (autocomplete) for posting a job (C04) and saved addresses (C21), #97.
//
// The provider is behind an interface so tests use a fake and Mapbox can be swapped later. Address search is
// a convenience, never a gate: with no token, or with the provider down, people type their address instead
// (and drop a pin if they can), and the office checks the location (see job-location.ts).

export { type AddressSearchProvider, type AddressSuggestion, AddressSearchUnavailableError } from "./address-provider";

export type AddressSearchResult =
  // Each suggestion says whether it's in the coverage area, so the page can send outside ones to the waitlist.
  | { mode: "search"; suggestions: (AddressSuggestion & { coverage: CoverageResult })[] }
  // Show the typed-address form (and the pin drop). "unavailable" also means coverage is checked later.
  | { mode: "manual"; reason: "not-configured" | "unavailable" };

/** Fewer characters than this matches half the country; we don't ask. */
export const MIN_QUERY_LENGTH = 3;
const MAX_QUERY_LENGTH = 200;
const DEFAULT_LIMIT = 5;
/** Longer than this and typing by hand is quicker. */
export const DEFAULT_TIMEOUT_MS = 3000;

/** Address search from the environment: Mapbox when MAPBOX_ACCESS_TOKEN is set, else none (typed addresses). */
export function getAddressSearchProvider(
  env: Record<string, string | undefined> = process.env,
): AddressSearchProvider | null {
  const { mapbox } = parseEnv(env);
  return mapbox.enabled ? createMapboxAddressSearch({ accessToken: mapbox.accessToken }) : null;
}

/**
 * Suggestions for what someone has typed so far. Never throws for the provider's sake: when there's no
 * provider, or it fails or takes longer than `timeoutMs`, the answer is "type it by hand".
 */
export async function searchAddresses(
  query: string,
  deps: {
    provider: AddressSearchProvider | null;
    coverage: Coverage;
    timeoutMs?: number;
    limit?: number;
    onError?: (error: unknown) => void;
  },
): Promise<AddressSearchResult> {
  if (!deps.provider) return { mode: "manual", reason: "not-configured" };

  const cleaned = query.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LENGTH);
  if (cleaned.length < MIN_QUERY_LENGTH) return { mode: "search", suggestions: [] };

  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new AddressSearchUnavailableError(`no answer within ${timeoutMs} ms`));
    }, timeoutMs);
  });

  try {
    // The race means a provider that ignores the abort signal still can't hold the page up.
    const suggestions = await Promise.race([
      deps.provider.suggest(cleaned, {
        near: deps.coverage.centre,
        limit: deps.limit ?? DEFAULT_LIMIT,
        signal: controller.signal,
      }),
      timeout,
    ]);
    return {
      mode: "search",
      suggestions: suggestions.map((suggestion) => ({
        ...suggestion,
        coverage: checkCoverage(deps.coverage, suggestion.point),
      })),
    };
  } catch (error) {
    (deps.onError ?? logSearchError)(error);
    return { mode: "manual", reason: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

function logSearchError(error: unknown) {
  // The query isn't logged: it's (part of) someone's address.
  console.warn(error instanceof Error ? error.message : "Address search failed");
}
