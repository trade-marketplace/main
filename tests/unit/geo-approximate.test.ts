import { describe, expect, it } from "vitest";

import { haversineKm } from "@/lib/geo/distance";
import { APPROX_MAX_METRES, APPROX_MIN_METRES, approximatePin, secureRandom } from "@/server/geo/approximate";

// The approximate pin for unclaimed jobs (#97): 100–300 m away, stable, never the address.

const home = { lat: -46.4132, lng: 168.3538 };

/** A small seeded random number generator (mulberry32), so these tests are repeatable. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const metresBetween = (a: typeof home, b: typeof home) => haversineKm(a, b) * 1000;

describe("approximatePin", () => {
  it("is always 100–300 m from the real point, over 10,000 pins", () => {
    const random = seeded(97);
    for (let i = 0; i < 10_000; i++) {
      const metres = metresBetween(home, approximatePin(home, random));
      expect(metres).toBeGreaterThanOrEqual(APPROX_MIN_METRES - 1e-6);
      expect(metres).toBeLessThanOrEqual(APPROX_MAX_METRES + 1e-6);
    }
  });

  it("reaches both ends of the range", () => {
    expect(metresBetween(home, approximatePin(home, () => 0))).toBeCloseTo(APPROX_MIN_METRES, 4);
    expect(metresBetween(home, approximatePin(home, () => 1 - 2 ** -48))).toBeCloseTo(APPROX_MAX_METRES, 4);
  });

  it("never lands on the address", () => {
    const pin = approximatePin(home, () => 0);
    expect(pin).not.toEqual(home);
  });

  it("goes in every direction, spread evenly", () => {
    const random = seeded(1);
    const quadrants = [0, 0, 0, 0];
    for (let i = 0; i < 4000; i++) {
      const pin = approximatePin(home, random);
      quadrants[(pin.lat > home.lat ? 0 : 1) + (pin.lng > home.lng ? 0 : 2)]++;
    }
    for (const count of quadrants) {
      expect(count).toBeGreaterThan(850);
      expect(count).toBeLessThan(1150);
    }
  });

  it("isn't bunched near the inside of the ring (about half the pins are past 224 m)", () => {
    const random = seeded(2);
    // Half the ring's area lies beyond √((100² + 300²) / 2) ≈ 223.6 m.
    let outer = 0;
    for (let i = 0; i < 4000; i++) if (metresBetween(home, approximatePin(home, random)) > 223.6) outer++;
    expect(outer).toBeGreaterThan(1850);
    expect(outer).toBeLessThan(2150);
  });

  it("is the same pin for the same random numbers (stable once stored)", () => {
    expect(approximatePin(home, seeded(5))).toEqual(approximatePin(home, seeded(5)));
  });

  it("is different for each job by default, so pins can't be worked back to addresses", () => {
    const pins = new Set(Array.from({ length: 50 }, () => JSON.stringify(approximatePin(home))));
    expect(pins.size).toBe(50);
  });

  it("uses a secure random number in [0, 1)", () => {
    for (let i = 0; i < 1000; i++) {
      const value = secureRandom();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
