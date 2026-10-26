import { describe, expect, it } from "vitest";

import { EARTH_RADIUS_KM, formatKm, haversineKm, isInNewZealand, isPoint, roundKm } from "@/lib/geo/distance";

// Distance maths (#97): worker to job, shown in whole km.

const invercargill = { lat: -46.4132, lng: 168.3538 };
const bluff = { lat: -46.6, lng: 168.3333 };
const auckland = { lat: -36.8485, lng: 174.7633 };
const wellington = { lat: -41.2865, lng: 174.7762 };

describe("haversineKm", () => {
  it("is zero from a point to itself", () => {
    expect(haversineKm(invercargill, invercargill)).toBe(0);
  });

  it("measures one degree along the equator as the Earth's radius × π/180", () => {
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo((EARTH_RADIUS_KM * Math.PI) / 180, 9);
  });

  it("is the same both ways", () => {
    expect(haversineKm(invercargill, bluff)).toBe(haversineKm(bluff, invercargill));
  });

  it("gets real New Zealand distances right (Invercargill–Bluff ≈ 21 km, Auckland–Wellington ≈ 494 km)", () => {
    expect(haversineKm(invercargill, bluff)).toBeGreaterThan(20.5);
    expect(haversineKm(invercargill, bluff)).toBeLessThan(21.2);
    expect(haversineKm(auckland, wellington)).toBeGreaterThan(490);
    expect(haversineKm(auckland, wellington)).toBeLessThan(497);
  });

  it("shrinks east–west distances away from the equator (a degree of longitude at Invercargill is ~77 km)", () => {
    const km = haversineKm(invercargill, { lat: invercargill.lat, lng: invercargill.lng + 1 });
    expect(km).toBeGreaterThan(76);
    expect(km).toBeLessThan(78);
  });

  it("stays finite for points on opposite sides of the Earth", () => {
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 180 })).toBeCloseTo(Math.PI * EARTH_RADIUS_KM, 6);
  });
});

describe("roundKm", () => {
  it("rounds to whole km, half up", () => {
    expect(roundKm(2.4)).toBe(2);
    expect(roundKm(2.5)).toBe(3);
    expect(roundKm(12.51)).toBe(13);
  });

  it("rounds anything under half a km to 0", () => {
    expect(roundKm(0)).toBe(0);
    expect(roundKm(0.49)).toBe(0);
  });

  it("refuses something that isn't a distance", () => {
    expect(() => roundKm(-1)).toThrow(RangeError);
    expect(() => roundKm(Number.NaN)).toThrow(RangeError);
    expect(() => roundKm(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("formatKm", () => {
  it("shows whole km", () => {
    expect(formatKm(3.2)).toBe("3 km");
    expect(formatKm(20.83)).toBe("21 km");
  });

  it("never shows 0 km", () => {
    expect(formatKm(0.2)).toBe("<1 km");
    expect(formatKm(0.5)).toBe("1 km");
  });
});

describe("isInNewZealand", () => {
  it("takes in Invercargill, Bluff, Stewart Island, Auckland and Cape Reinga", () => {
    for (const point of [invercargill, bluff, { lat: -46.9, lng: 168.1 }, auckland, { lat: -34.43, lng: 172.68 }]) {
      expect(isInNewZealand(point)).toBe(true);
    }
  });

  it("leaves out Sydney and a point with lat and lng swapped", () => {
    expect(isInNewZealand({ lat: -33.87, lng: 151.21 })).toBe(false);
    expect(isInNewZealand({ lat: 168.3538, lng: -46.4132 })).toBe(false);
  });
});

describe("isPoint", () => {
  it("rejects NaN and out-of-range values", () => {
    expect(isPoint({ lat: Number.NaN, lng: 0 })).toBe(false);
    expect(isPoint({ lat: 91, lng: 0 })).toBe(false);
    expect(isPoint({ lat: 0, lng: -181 })).toBe(false);
    expect(isPoint(invercargill)).toBe(true);
  });
});
