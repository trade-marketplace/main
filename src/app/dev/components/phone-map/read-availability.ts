"use server";

import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { loadWorkArea } from "@/server/workers/area";

/** Reuse the existing work-area read; the board DTO deliberately contains no availability preference. */
export const readPhoneAvailability = withRole(["TRADIE"], async viewer => {
  try {
    const snapshot = await loadWorkArea(getDb(), viewer);
    return snapshot ? { ok: true as const, available: snapshot.available, paused: snapshot.paused } : { ok: false as const, error: "unavailable" as const };
  } catch { return { ok: false as const, error: "unavailable" as const }; }
});
