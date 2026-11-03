"use server";
import { consumeForClient } from "@/server/rate-limit";
import { searchJobAddresses } from "./address-search";
import { jobDraftSchema } from "@/lib/job-draft";
import { loadCoverage } from "@/server/geo/coverage-settings";
import { resolveJobLocation } from "@/server/geo/job-location";

/** Guests and customers use the same bounded search; no account is required to prepare a draft. */
export async function searchJobAddressesAction(query: string) {
  if (!(await consumeForClient("placeSearch")).allowed) return { mode: "manual" as const, reason: "unavailable" as const };
  try { return await searchJobAddresses(query); }
  catch { return { mode: "manual" as const, reason: "unavailable" as const }; }
}

export async function checkJobDraftLocationAction(input: unknown) {
  const parsed = jobDraftSchema.pick({ locationSource: true, suburb: true, point: true }).required({ locationSource: true, suburb: true }).safeParse(input);
  if (!parsed.success || parsed.data.locationSource !== "TYPED" && !parsed.data.point) return { status: "invalid" } as const;
  if (!(await consumeForClient("placeSearch")).allowed) return { status: "unavailable" } as const;
  try {
    const data = parsed.data; const result = resolveJobLocation(data.locationSource === "TYPED" ? { source: "TYPED", suburb: data.suburb } : { source: data.locationSource, suburb: data.suburb, point: data.point! }, await loadCoverage());
    return result.ok ? { status: "inside" } as const : result.error === "outside-coverage" ? { status: "outside", suburb: result.waitlist.suburb } as const : { status: "invalid" } as const;
  } catch { return { status: "unavailable" } as const; }
}
