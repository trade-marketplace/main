import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { priceWork } from "@/server/pricing/calculate";
import { quoteEarningsCents } from "@/lib/quote-earnings";

const rates = { workerRateCents: 7000, holidayPayBps: 800, onCostBps: 1250, marginBps: 2000, gstBps: 1500, minMinutes: 120 };

describe("live quote earnings", () => {
  it("matches the pricing engine for every half hour, minimum included", () => {
    for (let half = 1; half <= 80; half++) {
      const hours = half / 2;
      expect(quoteEarningsCents(hours, rates)).toBe(priceWork({ minutes: hours * 60, materialsCents: 0 }, rates).workerEarnsCents);
    }
  });
  it("gives nothing for hours that can't be sent", () => {
    for (const hours of [0, -1, 41, Number.NaN]) expect(quoteEarningsCents(hours, rates)).toBeNull();
  });
});
