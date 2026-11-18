// The demo data prices jobs with its own copy of the maths (prisma/seed runs as plain Node and can't import the
// engine). #306: it must give exactly what the pricing engine gives with the settings defaults.
import { describe, expect, it } from "vitest";
import { EXAMPLE_RATES, examplePricing, JOBS } from "../../prisma/seed/data.mjs";
import { priceWork, ratesForTrade, type RateSettings } from "@/server/pricing/calculate";

// The settings row's defaults (prisma/migrations/*_schema_3_money).
const DEFAULTS: RateSettings = { sharedRateCents: 7000, otherRateCents: 3800, sharedMinMinutes: 120, otherMinMinutes: 60, holidayPayBps: 800, onCostBps: 1250, marginBps: 2000, gstBps: 1500 };

describe("seed pricing (#306)", () => {
  it("uses the settings defaults", () => {
    expect(EXAMPLE_RATES).toMatchObject({ licensed: { workerRateCents: DEFAULTS.sharedRateCents, minMinutes: DEFAULTS.sharedMinMinutes }, other: { workerRateCents: DEFAULTS.otherRateCents, minMinutes: DEFAULTS.otherMinMinutes },
      holidayPayBps: DEFAULTS.holidayPayBps, onCostBps: DEFAULTS.onCostBps, marginBps: DEFAULTS.marginBps, gstBps: DEFAULTS.gstBps });
  });
  const cases: [number, number, "ELECTRICAL" | "OTHER"][] = [[60, 0, "ELECTRICAL"], [60, 0, "OTHER"], [150, 4250, "ELECTRICAL"], [45, 1999, "OTHER"], [480, 12345, "ELECTRICAL"], [7, 1, "OTHER"]];
  it.each(cases)("matches priceWork for %i minutes, %i cents of materials, %s", (minutes, materialsCents, trade) => {
    const engine = priceWork({ minutes, materialsCents }, ratesForTrade(trade, DEFAULTS));
    expect(examplePricing({ minutes, materialsCents }, trade)).toMatchObject({
      minutes: engine.minutes, workerGrossCents: engine.workerGrossCents, holidayPayCents: engine.holidayPayCents, onCostCents: engine.onCostCents,
      marginCents: engine.marginCents, gstCents: engine.gstCents, priceCents: engine.customerPriceCents,
    });
  });
  it("matches priceWork for every priced demo job", () => {
    for (const job of JOBS.filter(row => row.pricing)) {
      const engine = priceWork(job.pricing!, ratesForTrade(job.category, DEFAULTS));
      expect(examplePricing(job.pricing!, job.category).priceCents, job.title).toBe(engine.customerPriceCents);
    }
  });
  it("one licensed hour is $117.37 and one Other hour $63.71, as DECISIONS.md says", () => {
    expect(priceWork({ minutes: 60, materialsCents: 0 }, ratesForTrade("ELECTRICAL", DEFAULTS), { applyMinimum: false }).customerPriceCents).toBe(11737);
    expect(examplePricing({ minutes: 60, materialsCents: 0 }, "OTHER").priceCents).toBe(6371);
  });
});
