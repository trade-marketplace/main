import { describe, expect, it } from "vitest";

import { INVERCARGILL_COVERAGE } from "@/lib/geo/coverage";
import { EARTH_RADIUS_KM, haversineKm } from "@/lib/geo/distance";
import { addressLocation, distanceToJobKm, jobPinFor, resolveJobLocation } from "@/server/geo/job-location";

// Where a job is (#97): the coverage decision, the office flag, the approximate pin and the worker's distance.

const KM_PER_DEGREE_LAT = (EARTH_RADIUS_KM * Math.PI) / 180;
const centre = INVERCARGILL_COVERAGE.centre;
const north = (km: number) => ({ lat: centre.lat + km / KM_PER_DEGREE_LAT, lng: centre.lng });
const deeSt = { lat: -46.4118, lng: 168.3477 };

describe("resolveJobLocation", () => {
  it("posts a searched address inside the area, with an approximate pin and nothing for the office", () => {
    const result = resolveJobLocation({ source: "SEARCH", suburb: "Invercargill Central", point: deeSt }, INVERCARGILL_COVERAGE);
    expect(result).toMatchObject({
      ok: true,
      location: { lat: deeSt.lat, lng: deeSt.lng, locationSource: "SEARCH", coverage: "INSIDE", locationNeedsCheck: false },
    });
    if (!result.ok) return;
    const { approxLat, approxLng } = result.location;
    const metres = haversineKm(deeSt, { lat: approxLat!, lng: approxLng! }) * 1000;
    expect(metres).toBeGreaterThanOrEqual(100 - 1e-6);
    expect(metres).toBeLessThanOrEqual(300 + 1e-6);
  });

  it("address not found: a typed address with a dropped pin is posted and flagged for the office", () => {
    const pin = { lat: -46.43, lng: 168.33 };
    expect(resolveJobLocation({ source: "PIN", suburb: "Kew", point: pin }, INVERCARGILL_COVERAGE)).toMatchObject({
      ok: true,
      location: { lat: pin.lat, lng: pin.lng, locationSource: "PIN", coverage: "INSIDE", locationNeedsCheck: true },
    });
  });

  it("Mapbox down: the typed address is still posted, coverage marked check later for the office", () => {
    expect(resolveJobLocation({ source: "TYPED", suburb: "Waikiwi" }, INVERCARGILL_COVERAGE)).toEqual({
      ok: true,
      location: {
        lat: null,
        lng: null,
        approxLat: null,
        approxLng: null,
        locationSource: "TYPED",
        coverage: "CHECK_LATER",
        locationNeedsCheck: true,
      },
    });
  });

  it("just outside the area: not posted, sent to the waitlist with their suburb", () => {
    expect(resolveJobLocation({ source: "SEARCH", suburb: " Lorneville ", point: north(15.01) }, INVERCARGILL_COVERAGE)).toEqual({
      ok: false,
      error: "outside-coverage",
      waitlist: { path: "/coming-soon", suburb: "Lorneville", areaName: "Invercargill" },
    });
  });

  it("just inside the area: posted", () => {
    expect(resolveJobLocation({ source: "SEARCH", suburb: "Lorneville", point: north(14.99) }, INVERCARGILL_COVERAGE).ok).toBe(true);
  });

  it("a dropped pin outside the area goes to the waitlist too", () => {
    const bluff = { lat: -46.6, lng: 168.3333 };
    expect(resolveJobLocation({ source: "PIN", suburb: "Bluff", point: bluff }, INVERCARGILL_COVERAGE)).toMatchObject({
      ok: false,
      error: "outside-coverage",
    });
  });

  it("refuses a point outside New Zealand or that isn't a point", () => {
    for (const point of [{ lat: -33.87, lng: 151.21 }, { lat: Number.NaN, lng: 168 }, { lat: 168.35, lng: -46.41 }]) {
      expect(resolveJobLocation({ source: "PIN", suburb: "Kew", point }, INVERCARGILL_COVERAGE)).toEqual({
        ok: false,
        error: "invalid-point",
      });
    }
  });

  it("uses the area from settings, not always Invercargill", () => {
    const dunedin = { name: "Dunedin", centre: { lat: -45.8788, lng: 170.5028 }, radiusKm: 12 };
    expect(resolveJobLocation({ source: "SEARCH", suburb: "Kew", point: deeSt }, dunedin)).toMatchObject({
      ok: false,
      waitlist: { areaName: "Dunedin" },
    });
  });
});

describe("addressLocation", () => {
  it("keeps the point and where it came from for a saved address", () => {
    expect(addressLocation({ source: "SEARCH", suburb: "Kew", point: deeSt })).toEqual({ ...deeSt, locationSource: "SEARCH" });
    expect(addressLocation({ source: "PIN", suburb: "Kew", point: deeSt })).toEqual({ ...deeSt, locationSource: "PIN" });
    expect(addressLocation({ source: "TYPED", suburb: "Kew" })).toEqual({ lat: null, lng: null, locationSource: "TYPED" });
  });
});

describe("distanceToJobKm and jobPinFor", () => {
  const worker = "worker-1";
  const job = { lat: deeSt.lat, lng: deeSt.lng, approxLat: -46.4135, approxLng: 168.35, workerId: null as string | null };
  // About 12.9 km north-east of Dee St.
  const workerAt = { lat: -46.31, lng: 168.43 };

  it("shows other workers the approximate pin, never the address", () => {
    expect(jobPinFor(job, worker)).toEqual({ lat: job.approxLat, lng: job.approxLng });
    expect(jobPinFor({ ...job, workerId: "someone-else" }, worker)).toEqual({ lat: job.approxLat, lng: job.approxLng });
  });

  it("shows the worker who claimed it the real address", () => {
    expect(jobPinFor({ ...job, workerId: worker }, worker)).toEqual(deeSt);
  });

  it("measures to the approximate pin before claiming, in whole km", () => {
    const km = distanceToJobKm(workerAt, job, worker);
    expect(km).toBe(Math.round(haversineKm(workerAt, { lat: job.approxLat, lng: job.approxLng })));
    expect(Number.isInteger(km)).toBe(true);
  });

  it("measures to the real address once claimed", () => {
    expect(distanceToJobKm(workerAt, { ...job, workerId: worker }, worker)).toBe(Math.round(haversineKm(workerAt, deeSt)));
  });

  it("has no distance or pin when the job has no point yet (typed while Mapbox was down)", () => {
    const typed = { lat: null, lng: null, approxLat: null, approxLng: null, workerId: null };
    expect(distanceToJobKm(workerAt, typed, worker)).toBeNull();
    expect(jobPinFor(typed, worker)).toBeNull();
  });

  it("never falls back to the address when a job has no approximate pin", () => {
    expect(jobPinFor({ ...job, approxLat: null, approxLng: null }, worker)).toBeNull();
    expect(distanceToJobKm(workerAt, { ...job, approxLat: null, approxLng: null }, worker)).toBeNull();
  });
});
