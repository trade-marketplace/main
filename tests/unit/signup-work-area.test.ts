import { describe, expect, it, vi } from "vitest";

import { INVERCARGILL_COVERAGE } from "@/lib/geo/coverage";
import { searchSignupAreas } from "@/server/auth/work-area";
import type { AddressSearchProvider, AddressSuggestion } from "@/server/geo/address-search";

const place = (id: string): AddressSuggestion => ({ id, label: "Windsor", line1: "Windsor", suburb: "Windsor", city: "Invercargill", postcode: null, point: { lat: -46.391, lng: 168.367 } });
const deps = (provider: AddressSearchProvider | null) => ({ provider, coverage: INVERCARGILL_COVERAGE });

describe("signup work area", () => {
  it("without a token lets the worker type the suburb by hand", async () => {
    expect(await searchSignupAreas("Windsor", deps(null))).toEqual({ mode: "manual", reason: "not-configured" });
  });
  it("does not search until three characters, and deduplicates suburb suggestions", async () => {
    const provider = { suggest: vi.fn(async () => [place("1"), place("2")]) };
    expect(await searchSignupAreas("Wi", deps(provider))).toEqual({ mode: "search", suggestions: [] });
    expect(provider.suggest).not.toHaveBeenCalled();
    expect(await searchSignupAreas("Win", deps(provider))).toEqual({ mode: "search", suggestions: [{ id: "1", label: "Windsor, Invercargill", point: place("1").point }] });
  });
  it("provider failures fall back to manual entry", async () => {
    vi.spyOn(console, "warn").mockImplementationOnce(() => {});
    expect(await searchSignupAreas("Windsor", deps({ suggest: async () => { throw new Error("offline"); } }))).toMatchObject({ mode: "manual", reason: "unavailable" });
  });
});
