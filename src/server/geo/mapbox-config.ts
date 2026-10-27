import "server-only";

import type { MapboxConfig } from "@/lib/map/mapbox";
import { loadCoverage, type CoverageSource } from "./coverage-settings";

/** sk. tokens are server secrets. Never serialize one into client props, even if misconfigured. */
export function publicMapboxToken(raw: string | undefined = process.env.MAPBOX_ACCESS_TOKEN): string | null {
  const value = raw?.trim();
  return value && /^pk\.[A-Za-z0-9._-]+$/.test(value) ? value : null;
}

/** Call from the job board's server component. Settings remain the source of the work area. */
export async function loadMapboxConfig(source?: CoverageSource): Promise<MapboxConfig> {
  return { accessToken: publicMapboxToken(), workArea: await loadCoverage(source) };
}
