import { describe, expect, it, vi } from "vitest";

import { INVERCARGILL_COVERAGE } from "@/lib/geo/coverage";
import {
  type AddressSearchProvider,
  AddressSearchUnavailableError,
  type AddressSuggestion,
  getAddressSearchProvider,
  searchAddresses,
} from "@/server/geo/address-search";

// Address search (#97) with a fake provider: no network.

const deeSt: AddressSuggestion = {
  id: "address.1",
  label: "12 Dee Street, Invercargill 9810",
  line1: "12 Dee Street",
  suburb: "Invercargill Central",
  city: "Invercargill",
  postcode: "9810",
  point: { lat: -46.4118, lng: 168.3477 },
};
const princesSt: AddressSuggestion = {
  ...deeSt,
  id: "address.2",
  label: "1 Princes Street, Dunedin Central, Dunedin 9016",
  line1: "1 Princes Street",
  suburb: "Dunedin Central",
  city: "Dunedin",
  postcode: "9016",
  point: { lat: -45.8788, lng: 170.5028 },
};

function fakeProvider(suggest: AddressSearchProvider["suggest"]): AddressSearchProvider {
  return { suggest: vi.fn(suggest) };
}

const quiet = { onError: () => {} };

describe("searchAddresses", () => {
  it("returns the provider's suggestions, each marked inside or outside the coverage area", async () => {
    const provider = fakeProvider(async () => [deeSt, princesSt]);
    const result = await searchAddresses("12 Dee", { provider, coverage: INVERCARGILL_COVERAGE });
    expect(result.mode).toBe("search");
    if (result.mode !== "search") return;
    expect(result.suggestions.map((s) => [s.line1, s.coverage.status])).toEqual([
      ["12 Dee Street", "inside"],
      ["1 Princes Street", "outside"],
    ]);
  });

  it("biases the search to the coverage centre", async () => {
    const provider = fakeProvider(async () => []);
    await searchAddresses("12 Dee", { provider, coverage: INVERCARGILL_COVERAGE, limit: 7 });
    expect(provider.suggest).toHaveBeenCalledWith(
      "12 Dee",
      expect.objectContaining({ near: INVERCARGILL_COVERAGE.centre, limit: 7 }),
    );
  });

  it("doesn't ask the provider until there are 3 characters, and tidies spaces", async () => {
    const provider = fakeProvider(async () => [deeSt]);
    await expect(searchAddresses("  1 ", { provider, coverage: INVERCARGILL_COVERAGE })).resolves.toEqual({
      mode: "search",
      suggestions: [],
    });
    expect(provider.suggest).not.toHaveBeenCalled();
    await searchAddresses("  12   Dee  ", { provider, coverage: INVERCARGILL_COVERAGE });
    expect(provider.suggest).toHaveBeenCalledWith("12 Dee", expect.anything());
  });

  it("caps a very long query", async () => {
    const provider = fakeProvider(async () => []);
    await searchAddresses("x".repeat(1000), { provider, coverage: INVERCARGILL_COVERAGE });
    expect(vi.mocked(provider.suggest).mock.calls[0]![0]).toHaveLength(200);
  });

  it("falls back to typing the address when there's no Mapbox token", async () => {
    await expect(searchAddresses("12 Dee", { provider: null, coverage: INVERCARGILL_COVERAGE })).resolves.toEqual({
      mode: "manual",
      reason: "not-configured",
    });
  });

  it("falls back to typing the address when Mapbox is down", async () => {
    const onError = vi.fn();
    const provider = fakeProvider(async () => {
      throw new AddressSearchUnavailableError("Mapbox answered 503");
    });
    await expect(searchAddresses("12 Dee", { provider, coverage: INVERCARGILL_COVERAGE, onError })).resolves.toEqual({
      mode: "manual",
      reason: "unavailable",
    });
    expect(onError).toHaveBeenCalledWith(expect.any(AddressSearchUnavailableError));
  });

  it("falls back on any other failure too, rather than breaking the page", async () => {
    const provider = fakeProvider(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(searchAddresses("12 Dee", { provider, coverage: INVERCARGILL_COVERAGE, ...quiet })).resolves.toEqual({
      mode: "manual",
      reason: "unavailable",
    });
  });

  it("gives up after the timeout and aborts the request", async () => {
    let signal: AbortSignal | undefined;
    const provider = fakeProvider((_query, options) => {
      signal = options.signal;
      return new Promise(() => {}); // never answers
    });
    const onError = vi.fn();
    const started = Date.now();
    await expect(
      searchAddresses("12 Dee", { provider, coverage: INVERCARGILL_COVERAGE, timeoutMs: 30, onError }),
    ).resolves.toEqual({ mode: "manual", reason: "unavailable" });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(signal?.aborted).toBe(true);
    expect(String(onError.mock.calls[0]![0])).toMatch(/no answer within 30 ms/);
  });

  it("logs the failure without the address someone typed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const provider = fakeProvider(async () => {
      throw new AddressSearchUnavailableError("Mapbox answered 500");
    });
    await searchAddresses("12 Secret Lane", { provider, coverage: INVERCARGILL_COVERAGE });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).not.toContain("Secret");
    warn.mockRestore();
  });
});

describe("getAddressSearchProvider", () => {
  it("is off without MAPBOX_ACCESS_TOKEN, so the app still runs", () => {
    expect(getAddressSearchProvider({})).toBeNull();
    expect(getAddressSearchProvider({ MAPBOX_ACCESS_TOKEN: "" })).toBeNull();
  });

  it("is Mapbox when the token is set", () => {
    expect(getAddressSearchProvider({ MAPBOX_ACCESS_TOKEN: "pk.test" })).toEqual({ suggest: expect.any(Function) });
  });
});
