import "server-only";

import { z } from "zod";

import {
  type AddressSearchOptions,
  type AddressSearchProvider,
  AddressSearchUnavailableError,
  type AddressSuggestion,
} from "./address-provider";

// Mapbox address search (DECISIONS.md 8), through the Geocoding API v6 forward search in autocomplete mode:
// https://docs.mapbox.com/api/search/geocoding/. Called from our server, so the token never reaches a browser.
// Tests pass a fake `fetch`; nothing here runs against Mapbox in CI.

const ENDPOINT = "https://api.mapbox.com/search/geocode/v6/forward";

const named = z.object({ name: z.string() }).nullish();

const feature = z.object({
  properties: z.object({
    mapbox_id: z.string(),
    feature_type: z.string().optional(),
    name: z.string(),
    full_address: z.string().nullish(),
    place_formatted: z.string().nullish(),
    coordinates: z.object({ latitude: z.number(), longitude: z.number() }),
    context: z
      .object({
        postcode: named,
        // Mapbox's "locality" is NZ's suburb; some suburbs come back as a neighbourhood instead.
        locality: named,
        neighborhood: named,
        place: named,
      })
      .partial()
      .nullish(),
  }),
});

const response = z.object({ features: z.array(z.unknown()) });

export function createMapboxAddressSearch(config: {
  accessToken: string;
  fetch?: typeof fetch;
  featureTypes?: readonly ("address" | "locality" | "neighborhood" | "place")[];
}): AddressSearchProvider {
  const fetchImpl = config.fetch ?? fetch;

  return {
    async suggest(query: string, options: AddressSearchOptions): Promise<AddressSuggestion[]> {
      const url = new URL(ENDPOINT);
      url.search = new URLSearchParams({
        q: query,
        access_token: config.accessToken,
        // Limited to NZ, nearest to the coverage area first.
        country: "nz",
        proximity: `${options.near.lng},${options.near.lat}`,
        types: config.featureTypes?.join(",") || "address",
        autocomplete: "true",
        language: "en",
        limit: String(options.limit),
      }).toString();

      let res: Response;
      try {
        res = await fetchImpl(url, { signal: options.signal, headers: { accept: "application/json" } });
      } catch (error) {
        throw new AddressSearchUnavailableError("Mapbox couldn't be reached", { cause: error });
      }
      if (!res.ok) {
        // 401/403: the token is wrong or lacks the scope; 429: over the rate limit; 5xx: Mapbox is down.
        throw new AddressSearchUnavailableError(`Mapbox answered ${res.status}`);
      }

      let body: unknown;
      try {
        body = await res.json();
      } catch (error) {
        throw new AddressSearchUnavailableError("Mapbox sent something that isn't JSON", { cause: error });
      }
      const parsed = response.safeParse(body);
      if (!parsed.success) throw new AddressSearchUnavailableError("Mapbox's answer wasn't a list of places");

      // One odd result shouldn't hide the rest: skip anything without the parts we need.
      return parsed.data.features.flatMap((raw) => {
        const result = feature.safeParse(raw);
        return result.success ? toSuggestion(result.data) : [];
      });
    },
  };
}

function toSuggestion({ properties: p }: z.infer<typeof feature>): AddressSuggestion[] {
  const city = p.context?.place?.name ?? (p.feature_type === "place" ? p.name : undefined);
  const suburb = p.feature_type === "locality" || p.feature_type === "neighborhood" ? p.name : p.context?.locality?.name ?? p.context?.neighborhood?.name ?? city;
  if (!city || !suburb) return [];
  return [
    {
      id: p.mapbox_id,
      label: p.full_address ?? [p.name, p.place_formatted].filter(Boolean).join(", "),
      line1: p.name,
      suburb,
      city,
      postcode: p.context?.postcode?.name ?? null,
      point: { lat: p.coordinates.latitude, lng: p.coordinates.longitude },
    },
  ];
}
