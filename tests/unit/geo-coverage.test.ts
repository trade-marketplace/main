import { describe, expect, it } from "vitest";

import { checkCoverage, type Coverage, INVERCARGILL_COVERAGE, WAITLIST_PATH } from "@/lib/geo/coverage";
import { EARTH_RADIUS_KM, haversineKm } from "@/lib/geo/distance";
import { CoverageSettingsError, loadCoverage } from "@/server/geo/coverage-settings";

// The coverage area (#97): a centre and a radius, Invercargill until settings (Schema 3, #91) are wired in.

const KM_PER_DEGREE_LAT = (EARTH_RADIUS_KM * Math.PI) / 180;
const { centre, radiusKm } = INVERCARGILL_COVERAGE;
/** A point `km` due north of the centre. */
const north = (km: number) => ({ lat: centre.lat + km / KM_PER_DEGREE_LAT, lng: centre.lng });

describe("checkCoverage", () => {
  it("falls back to 20 km around central Invercargill, the same as the settings defaults", () => {
    expect(INVERCARGILL_COVERAGE).toEqual({ name: "Invercargill", centre: { lat: -46.4132, lng: 168.3538 }, radiusKm: 20 });
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
    const result = checkCoverage(INVERCARGILL_COVERAGE, north(30));
    expect(result.status === "outside" && result.distanceKm).toBeCloseTo(30, 6);
  });

  it("puts Bluff (≈20.8 km) just outside the launch area and Gladstone inside", () => {
    expect(checkCoverage(INVERCARGILL_COVERAGE, { lat: -46.6, lng: 168.3333 }).status).toBe("outside");
    expect(checkCoverage(INVERCARGILL_COVERAGE, { lat: -46.392, lng: 168.355 }).status).toBe("inside");
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
  it("is Invercargill when there are no settings yet", async () => {
    await expect(loadCoverage()).resolves.toEqual(INVERCARGILL_COVERAGE);
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
