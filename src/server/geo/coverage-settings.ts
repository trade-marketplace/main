import "server-only";

import { z } from "zod";

import type { PrismaClient } from "@/generated/prisma/client";
import { type Coverage, INVERCARGILL_COVERAGE } from "@/lib/geo/coverage";
import { getDb } from "@/server/db";

// Loads the coverage area the office set (F14) from the settings row (Schema 3, #91). With the database off there
// is nothing to read and the area is Invercargill.

/** What the settings row holds, or null when there is no row (or no database). */
export type CoverageSource = () => Promise<{ name?: string | null; lat: number; lng: number; radiusKm: number } | null>;

export class CoverageSettingsError extends Error {
  constructor(problems: string[]) {
    super(`The coverage area in settings is set up wrong: ${problems.join("; ")}. Fix it in office Settings.`);
    this.name = "CoverageSettingsError";
  }
}

const row = z.object({
  name: z.string().trim().min(1).nullish(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  // Over 500 km would be most of the country: almost certainly metres typed as km.
  radiusKm: z.number().positive().max(500),
});

/**
 * The `settings` row's coverage columns. The row has no area name, so the name stays Invercargill's. `db` returns
 * null when the database is off (no `DATABASE_URL`); it connects on first use, like getDb().
 */
export function settingsCoverageSource(
  db: () => Pick<PrismaClient, "settings"> | null = () => (process.env.DATABASE_URL?.trim() ? getDb() : null),
): CoverageSource {
  return async () => {
    const settings = await db()?.settings.findUnique({
      where: { id: 1 },
      select: { coverageCentreLat: true, coverageCentreLng: true, coverageRadiusKm: true },
    });
    if (!settings) return null;
    return { lat: settings.coverageCentreLat, lng: settings.coverageCentreLng, radiusKm: settings.coverageRadiusKm };
  };
}

/**
 * The coverage area: the settings row when there is one, else Invercargill. A row that is set up wrong throws
 * instead of quietly falling back, so the office doesn't believe an area is live when it isn't.
 */
export async function loadCoverage(source: CoverageSource = settingsCoverageSource()): Promise<Coverage> {
  const raw = await source();
  if (!raw) return INVERCARGILL_COVERAGE;
  const parsed = row.safeParse(raw);
  if (!parsed.success) {
    throw new CoverageSettingsError(parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`));
  }
  const { name, lat, lng, radiusKm } = parsed.data;
  return { name: name ?? INVERCARGILL_COVERAGE.name, centre: { lat, lng }, radiusKm };
}
