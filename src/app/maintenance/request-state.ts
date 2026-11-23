import "server-only";
import { connection } from "next/server";
import { cache } from "react";
import { configuredMaintenance, maintenancePhase } from "@/lib/maintenance";

/** Use one clock reading for this request, including on pages that could otherwise be prerendered. */
export const requestMaintenance = cache(async () => {
  await connection();
  const window = configuredMaintenance();
  const now = Date.now();
  return { window, now, phase: maintenancePhase(window, now) };
});
