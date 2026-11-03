"use server";
import { consumeForClient } from "@/server/rate-limit";
import { searchJobAddresses } from "./address-search";

/** Guests and customers use the same bounded search; no account is required to prepare a draft. */
export async function searchJobAddressesAction(query: string) {
  if (!(await consumeForClient("placeSearch")).allowed) return { mode: "manual" as const, reason: "unavailable" as const };
  try { return await searchJobAddresses(query); }
  catch { return { mode: "manual" as const, reason: "unavailable" as const }; }
}
