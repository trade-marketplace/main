import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { checkCoverage, type Coverage, INVERCARGILL_COVERAGE, WAITLIST_PATH } from "@/lib/geo/coverage";
import { EARTH_RADIUS_KM, haversineKm } from "@/lib/geo/distance";
import { CoverageSettingsError, loadCoverage, settingsCoverageSource } from "@/server/geo/coverage-settings";

// The coverage area (#97): a centre and a radius, read from the settings row (Schema 3, #91, wired in by #300).
// The same against a real Postgres: geo-coverage-db.test.ts.

const KM_PER_DEGREE_LAT = (EARTH_RADIUS_KM * Math.PI) / 180;
const { centre, radiusKm } = INVERCARGILL_COVERAGE;
/** A point `km` due north of the centre. */
const north = (km: number) => ({ lat: centre.lat + km / KM_PER_DEGREE_LAT, lng: centre.lng });

describe("checkCoverage", () => {
  it("falls back to 60 km around central Invercargill, the same as the settings defaults", () => {
    expect(INVERCARGILL_COVERAGE).toEqual({ name: "Invercargill", centre: { lat: -46.4132, lng: 168.3538 }, radiusKm: 60 });
  });

  it("is the settings row's defaults in prisma/schema.prisma, so the fallback and the database never drift", () => {
    const prisma = readFileSync("prisma/schema.prisma", "utf8");
    const settings = prisma.match(/^model Settings \{([\s\S]*?)^\}/m)?.[1] ?? "";
    const defaultOf = (field: string) => Number(settings.match(new RegExp(`^\\s*${field}\\s.*@default\\(([^)]+)\\)`, "m"))?.[1]);
    expect({
      centre: { lat: defaultOf("coverageCentreLat"), lng: defaultOf("coverageCentreLng") },
      radiusKm: defaultOf("coverageRadiusKm"),
    }).toEqual({ centre: INVERCARGILL_COVERAGE.centre, radiusKm: INVERCARGILL_COVERAGE.radiusKm });
  });

  it("is inside at the centre", () => {
    expect(checkCoverage(INVERCARGILL_COVERAGE, centre)).toEqual({ status: "inside", distanceKm: 0 });
  });

  it("is inside just within the edge (10 m in)", () => {
    expect(checkCoverage(INVERCARGILL_COVERAGE, north(radiusKm - 0.01)).status).toBe("inside");
  });

  it("is outside just past the edge (10 m out), and points to the waitlist page", () => {
    const result = checkCoverage(INVERCARGILL_COVERAGE, north(radiusKm + 0.01));
    expect(result).toMatchObject({ status: "outside", waitlistPath: WAITLIST_PATH });
    expect(WAITLIST_PATH).toBe("/coming-soon");
  });

  it("counts exactly on the edge as inside", () => {
    const point = north(radiusKm);
    const coverage: Coverage = { ...INVERCARGILL_COVERAGE, radiusKm: haversineKm(centre, point) };
    expect(checkCoverage(coverage, point).status).toBe("inside");
  });

  it("says how far from the centre the point is", () => {
    const result = checkCoverage(INVERCARGILL_COVERAGE, north(90));
    expect(result.status === "outside" && result.distanceKm).toBeCloseTo(90, 6);
  });

  it("takes in Gladstone, Bluff (≈21 km) and Gore (≈57 km), and leaves out Dunedin (≈176 km)", () => {
    expect(checkCoverage(INVERCARGILL_COVERAGE, { lat: -46.392, lng: 168.355 }).status).toBe("inside");
    expect(checkCoverage(INVERCARGILL_COVERAGE, { lat: -46.6, lng: 168.3333 }).status).toBe("inside");
    expect(checkCoverage(INVERCARGILL_COVERAGE, { lat: -46.0983, lng: 168.9446 }).status).toBe("inside");
    expect(checkCoverage(INVERCARGILL_COVERAGE, { lat: -45.8788, lng: 170.5028 }).status).toBe("outside");
  });

  it("can't check without a point: the office checks later", () => {
    expect(checkCoverage(INVERCARGILL_COVERAGE, null)).toEqual({ status: "check-later" });
  });

  it("works for any area the office sets, not just Invercargill", () => {
    const dunedin: Coverage = { name: "Dunedin", centre: { lat: -45.8788, lng: 170.5028 }, radiusKm: 12 };
    expect(checkCoverage(dunedin, centre).status).toBe("outside");
    expect(checkCoverage(dunedin, { lat: -45.87, lng: 170.5 }).status).toBe("inside");
  });
});

describe("loadCoverage", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is Invercargill when the database is off (no DATABASE_URL), without connecting", async () => {
    vi.stubEnv("DATABASE_URL", "");
    await expect(loadCoverage()).resolves.toEqual(INVERCARGILL_COVERAGE);
    await expect(loadCoverage(settingsCoverageSource())).resolves.toEqual(INVERCARGILL_COVERAGE);
  });

  it("is Invercargill when there is no settings row", async () => {
    await expect(loadCoverage(async () => null)).resolves.toEqual(INVERCARGILL_COVERAGE);
  });

  it("uses the settings row when there is one", async () => {
    await expect(loadCoverage(async () => ({ name: "Southland", lat: -46.2, lng: 168.4, radiusKm: 40 }))).resolves.toEqual({
      name: "Southland",
      centre: { lat: -46.2, lng: 168.4 },
      radiusKm: 40,
    });
  });

  it("keeps the default name when the row has none", async () => {
    const coverage = await loadCoverage(async () => ({ name: null, lat: -46.2, lng: 168.4, radiusKm: 40 }));
    expect(coverage.name).toBe("Invercargill");
  });

  it("refuses a row that's set up wrong instead of quietly using Invercargill", async () => {
    await expect(loadCoverage(async () => ({ lat: -46.2, lng: 168.4, radiusKm: 0 }))).rejects.toThrow(CoverageSettingsError);
    await expect(loadCoverage(async () => ({ lat: -46.2, lng: 168.4, radiusKm: 15000 }))).rejects.toThrow(/radiusKm/);
    await expect(loadCoverage(async () => ({ lat: -146.2, lng: 168.4, radiusKm: 15 }))).rejects.toThrow(/lat/);
  });
});
