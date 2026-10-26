import { describe, expect, it } from "vitest";

import { checkCoverage, INVERCARGILL_COVERAGE } from "@/lib/geo/coverage";
import { CoverageSettingsError, loadCoverage, settingsCoverageSource } from "@/server/geo/coverage-settings";

import { testDatabaseUrl, useTestSchema } from "../support/test-db";

// The coverage area read from the real settings row (#300), against a real Postgres.

const GORE = { lat: -46.0983, lng: 168.9446 };

/** Runs `body` in a transaction that is always rolled back, so DDL and edits never leak into the next test. */
class Rollback extends Error {}

describe.skipIf(!testDatabaseUrl)("the coverage area in the settings row", () => {
  const schema = useTestSchema(import.meta.filename);
  const fromSettings = () => loadCoverage(settingsCoverageSource(() => schema.db));

  async function rolledBack(body: (tx: Parameters<Parameters<typeof schema.db.$transaction>[0]>[0]) => Promise<void>) {
    await expect(
      schema.db.$transaction(async (tx) => {
        await body(tx);
        throw new Rollback();
      }),
    ).rejects.toThrow(Rollback);
  }

  it("starts as the fallback: the column defaults and the migrated row are INVERCARGILL_COVERAGE", async () => {
    const defaults = await schema.db.$queryRawUnsafe<{ column_name: string; column_default: string }[]>(
      `SELECT column_name, column_default FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'settings' AND column_name LIKE 'coverage_%'`,
      schema.name,
    );
    // Postgres keeps a negative default as "'-46.4132'::numeric": keep only the number.
    const value = (sql: string) => Number(sql.replace(/::[\w ]+/g, "").replace(/[()']/g, ""));
    expect(Object.fromEntries(defaults.map((c) => [c.column_name, value(c.column_default)]))).toEqual({
      coverage_centre_lat: INVERCARGILL_COVERAGE.centre.lat,
      coverage_centre_lng: INVERCARGILL_COVERAGE.centre.lng,
      coverage_radius_km: INVERCARGILL_COVERAGE.radiusKm,
    });
    await expect(fromSettings()).resolves.toEqual(INVERCARGILL_COVERAGE);
  });

  it("follows the row when the office changes it", async () => {
    await rolledBack(async (tx) => {
      const load = () => loadCoverage(settingsCoverageSource(() => tx));
      expect(checkCoverage(await load(), GORE).status).toBe("inside");

      await tx.settings.update({ where: { id: 1 }, data: { coverageRadiusKm: 30 } });
      expect(checkCoverage(await load(), GORE).status).toBe("outside");

      await tx.settings.update({ where: { id: 1 }, data: { coverageCentreLat: GORE.lat, coverageCentreLng: GORE.lng } });
      const moved = await load();
      expect(moved).toEqual({ name: "Invercargill", centre: GORE, radiusKm: 30 });
      expect(checkCoverage(moved, GORE)).toEqual({ status: "inside", distanceKm: 0 });
      expect(checkCoverage(moved, INVERCARGILL_COVERAGE.centre).status).toBe("outside");
    });
  });

  it("is refused by the database when set up wrong (radius 0, lat out of range)", async () => {
    await expect(schema.db.settings.update({ where: { id: 1 }, data: { coverageRadiusKm: 0 } })).rejects.toThrow(
      /settings_coverage/,
    );
    await expect(schema.db.settings.update({ where: { id: 1 }, data: { coverageCentreLat: -146.4 } })).rejects.toThrow(
      /settings_coverage/,
    );
    await expect(fromSettings()).resolves.toEqual(INVERCARGILL_COVERAGE);
  });

  it("throws CoverageSettingsError for a broken row that got past the database, instead of using Invercargill", async () => {
    await rolledBack(async (tx) => {
      await tx.$executeRawUnsafe(`ALTER TABLE "${schema.name}"."settings" DROP CONSTRAINT "settings_coverage"`);
      const load = () => loadCoverage(settingsCoverageSource(() => tx));

      await tx.settings.update({ where: { id: 1 }, data: { coverageRadiusKm: 0 } });
      await expect(load()).rejects.toThrow(CoverageSettingsError);
      await expect(load()).rejects.toThrow(/radiusKm/);

      await tx.settings.update({ where: { id: 1 }, data: { coverageRadiusKm: 60, coverageCentreLat: -146.4 } });
      await expect(load()).rejects.toThrow(/lat/);
    });
  });

  it("is Invercargill when the row is missing", async () => {
    await rolledBack(async (tx) => {
      await tx.$executeRawUnsafe(`ALTER TABLE "${schema.name}"."settings" DISABLE TRIGGER "settings_no_delete"`);
      await tx.settings.delete({ where: { id: 1 } });
      await expect(loadCoverage(settingsCoverageSource(() => tx))).resolves.toEqual(INVERCARGILL_COVERAGE);
    });
  });
});
