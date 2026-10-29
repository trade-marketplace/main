"use client";

import { useMemo } from "react";

import { LandingPage } from "@/components/site/LandingPage";
import type { LandingData } from "@/lib/landing";
import type { AddressSearchResult } from "@/server/geo/address-search";

/** Local-only provider: previews never query Mapbox or a database. */
export function LandingDemo({ data, state }: { data: LandingData; state: string }) {
  const preview = useMemo(() => ({ state, searchPlaces: async (query: string): Promise<AddressSearchResult> => {
    if (state === "location-loading") return new Promise(() => {});
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (state === "location-error" || query.toLowerCase().includes("manual")) return { mode: "manual", reason: "unavailable" };
    const outside = query.toLowerCase().startsWith("well");
    const city = outside ? "Wellington" : "Invercargill";
    const point = outside ? { lat: -41.2866, lng: 174.7756 } : data.coverage.centre;
    return { mode: "search", suggestions: [{ id: city, label: city, line1: city, suburb: "", city, postcode: null, point, coverage: outside ? { status: "outside", distanceKm: 766, waitlistPath: "/coming-soon" } : { status: "inside", distanceKm: 0 } }] };
  } }), [state, data.coverage.centre]);
  return <LandingPage data={data} preview={preview} />;
}
