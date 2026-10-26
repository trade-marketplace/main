import { describe, expect, it, vi } from "vitest";

import { INVERCARGILL_COVERAGE } from "@/lib/geo/coverage";
import { AddressSearchUnavailableError } from "@/server/geo/address-provider";
import { createMapboxAddressSearch } from "@/server/geo/mapbox";

// The Mapbox provider (#97) against a fake fetch. Never calls Mapbox.

const options = { near: INVERCARGILL_COVERAGE.centre, limit: 5 };

/** A Geocoding v6 address feature, trimmed to what we read. */
function feature(overrides: Record<string, unknown> = {}) {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [168.3477, -46.4118] },
    properties: {
      mapbox_id: "dXJuOm1ieGFkcjox",
      feature_type: "address",
      name: "12 Dee Street",
      full_address: "12 Dee Street, Invercargill Central, Invercargill 9810, New Zealand",
      place_formatted: "Invercargill Central, Invercargill 9810, New Zealand",
      coordinates: { latitude: -46.4118, longitude: 168.3477 },
      context: {
        postcode: { name: "9810" },
        locality: { name: "Invercargill Central" },
        place: { name: "Invercargill" },
        region: { name: "Southland" },
        country: { name: "New Zealand", country_code: "nz" },
      },
      ...overrides,
    },
  };
}

function fakeFetch(respond: () => Response | Promise<Response>) {
  return vi.fn<typeof globalThis.fetch>(async () => respond());
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("Mapbox address search", () => {
  it("asks for NZ addresses only, nearest the coverage area first, as you type", async () => {
    const fetch = fakeFetch(() => json({ type: "FeatureCollection", features: [] }));
    await createMapboxAddressSearch({ accessToken: "pk.test", fetch }).suggest("12 Dee", options);

    const url = new URL(String(fetch.mock.calls[0]![0]));
    expect(url.origin + url.pathname).toBe("https://api.mapbox.com/search/geocode/v6/forward");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "12 Dee",
      access_token: "pk.test",
      country: "nz",
      proximity: "168.3538,-46.4132",
      types: "address",
      autocomplete: "true",
      language: "en",
      limit: "5",
    });
  });

  it("passes the abort signal on, so a timeout cancels the request", async () => {
    const fetch = fakeFetch(() => json({ features: [] }));
    const controller = new AbortController();
    await createMapboxAddressSearch({ accessToken: "pk.test", fetch }).suggest("12 Dee", {
      ...options,
      signal: controller.signal,
    });
    expect(fetch.mock.calls[0]![1]).toMatchObject({ signal: controller.signal });
  });

  it("turns each result into an address: street, suburb, city, postcode and point", async () => {
    const fetch = fakeFetch(() => json({ features: [feature()] }));
    await expect(createMapboxAddressSearch({ accessToken: "pk.test", fetch }).suggest("12 Dee", options)).resolves.toEqual([
      {
        id: "dXJuOm1ieGFkcjox",
        label: "12 Dee Street, Invercargill Central, Invercargill 9810, New Zealand",
        line1: "12 Dee Street",
        suburb: "Invercargill Central",
        city: "Invercargill",
        postcode: "9810",
        point: { lat: -46.4118, lng: 168.3477 },
      },
    ]);
  });

  it("uses the neighbourhood, then the city, when there's no suburb", async () => {
    const neighbourhood = feature({
      context: { neighborhood: { name: "Waikiwi" }, place: { name: "Invercargill" } },
      full_address: null,
    });
    const cityOnly = feature({ context: { place: { name: "Invercargill" } } });
    const fetch = fakeFetch(() => json({ features: [neighbourhood, cityOnly] }));
    const results = await createMapboxAddressSearch({ accessToken: "pk.test", fetch }).suggest("12 Dee", options);
    expect(results.map((r) => [r.suburb, r.postcode])).toEqual([
      ["Waikiwi", null],
      ["Invercargill", null],
    ]);
    expect(results[0]!.label).toBe("12 Dee Street, Invercargill Central, Invercargill 9810, New Zealand");
  });

  it("skips a result that's missing what we need, and keeps the rest", async () => {
    const noCity = feature({ context: { locality: { name: "Somewhere" } } });
    const noCoordinates = feature({ coordinates: undefined });
    const fetch = fakeFetch(() => json({ features: [noCity, noCoordinates, feature()] }));
    const results = await createMapboxAddressSearch({ accessToken: "pk.test", fetch }).suggest("12 Dee", options);
    expect(results).toHaveLength(1);
  });

  it("returns nothing when Mapbox finds nothing (the page offers typing it + a pin)", async () => {
    const fetch = fakeFetch(() => json({ type: "FeatureCollection", features: [] }));
    await expect(createMapboxAddressSearch({ accessToken: "pk.test", fetch }).suggest("Nowhere Rd", options)).resolves.toEqual([]);
  });

  it.each([401, 403, 429, 500, 503])("is unavailable when Mapbox answers %i", async (status) => {
    const fetch = fakeFetch(() => json({ message: "nope" }, status));
    await expect(createMapboxAddressSearch({ accessToken: "pk.test", fetch }).suggest("12 Dee", options)).rejects.toThrow(
      new AddressSearchUnavailableError(`Mapbox answered ${status}`),
    );
  });

  it("is unavailable when Mapbox can't be reached, without leaking the token", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw new TypeError("fetch failed");
    });
    const error = await createMapboxAddressSearch({ accessToken: "pk.secret", fetch })
      .suggest("12 Dee", options)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AddressSearchUnavailableError);
    expect(String((error as Error).message)).not.toContain("pk.secret");
  });

  it("is unavailable when the request is aborted (timed out)", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw new DOMException("The operation was aborted.", "AbortError");
    });
    await expect(createMapboxAddressSearch({ accessToken: "pk.test", fetch }).suggest("12 Dee", options)).rejects.toThrow(
      AddressSearchUnavailableError,
    );
  });

  it("is unavailable when the answer isn't JSON or isn't a list of places", async () => {
    const notJson = fakeFetch(() => new Response("<html>gateway</html>", { status: 200 }));
    await expect(createMapboxAddressSearch({ accessToken: "pk.test", fetch: notJson }).suggest("12 Dee", options)).rejects.toThrow(
      /isn't JSON/,
    );
    const wrongShape = fakeFetch(() => json({ hello: "world" }));
    await expect(
      createMapboxAddressSearch({ accessToken: "pk.test", fetch: wrongShape }).suggest("12 Dee", options),
    ).rejects.toThrow(/wasn't a list of places/);
  });
});
