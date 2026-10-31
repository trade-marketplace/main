"use client";

import { useMemo, useRef } from "react";

import { ServicePage } from "@/components/site/ServicePage";
import type { ServiceData, ServicePreviewState } from "@/lib/services";
import type { WaitlistResult } from "@/lib/waitlist";
import type { AddressSearchResult } from "@/server/geo/address-search";

export function ServiceDemo({ data, state }: { data: ServiceData; state: ServicePreviewState }) {
  const saved = useRef(new Set<string>());
  const preview = useMemo(() => ({ state, searchPlaces: async (query: string): Promise<AddressSearchResult> => {
    if (query.toLowerCase().includes("manual")) return { mode: "manual", reason: "unavailable" };
    const outside = query.toLowerCase().startsWith("well");
    const city = outside ? "Wellington" : data.coverage.name;
    return { mode: "search", suggestions: [{ id: city, label: city, city, line1: city, suburb: "", postcode: null, point: outside ? { lat: -41.2866, lng: 174.7756 } : data.coverage.centre, coverage: outside ? { status: "outside", distanceKm: 766, waitlistPath: "/coming-soon" } : { status: "inside", distanceKm: 0 } }] };
  } }), [data.coverage, state]);
  return <ServicePage data={data} preview={preview} submit={async (form): Promise<WaitlistResult> => {
    if (state === "waitlist-error") return { status: "error" };
    const key = `${form.get("trade")}|${form.get("email")}|${form.get("suburb")}`;
    if (saved.current.has(key)) return { status: "already-on-list" };
    saved.current.add(key); return { status: "joined" };
  }} />;
}
