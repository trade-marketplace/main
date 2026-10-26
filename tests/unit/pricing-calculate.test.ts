import { describe, expect, it } from "vitest";

import {
  MAX_DB_INT,
  perHour,
  priceWork,
  PricingInputError,
  type PricingRates,
  type RateSettings,
  ratesForTrade,
} from "@/server/pricing/calculate";

// The pricing maths (#94). Expected numbers are worked out by hand from the order of operations in
// src/server/pricing/calculate.ts, not copied from its output.

/** The launch settings (Schema 3 defaults, DECISIONS.md #62). */
const launch: RateSettings = {
  sharedRateCents: 7000,
  otherRateCents: 3800,
  sharedMinMinutes: 120,
  otherMinMinutes: 60,
  holidayPayBps: 800,
  onCostBps: 1250,
  marginBps: 2000,
  gstBps: 1500,
};
const licensed = ratesForTrade("ELECTRICAL", launch);
const other = ratesForTrade("OTHER", launch);

/** The prototype's test rates ($60/hr, 2 h minimum), as basis points. */
const prototype: PricingRates = {
  workerRateCents: 6000,
  minMinutes: 120,
  holidayPayBps: 800,
  onCostBps: 1250,
  marginBps: 2000,
  gstBps: 1500,
};

describe("same results as the prototype's pricing.test.ts", () => {
  it("prices a two-hour job with $100 materials and keeps gross pay apart from the customer price", () => {
    const quote = priceWork({ minutes: 120, materialsCents: 10000 }, prototype);
    expect(quote).toMatchObject({
      workerGrossCents: 12000,
      holidayPayCents: 960,
      workerEarnsCents: 12960, // before PAYE, not take-home pay
      labourCostCents: 13500,
      marginCents: 4700,
      exGstCents: 28200,
      gstCents: 4230,
      customerPriceCents: 32430,
    });
  });

  it("applies the minimum without charging it twice", () => {
    expect(priceWork({ minutes: 30, materialsCents: 0 }, prototype)).toEqual(
      priceWork({ minutes: 120, materialsCents: 0 }, prototype),
    );
    expect(priceWork({ minutes: 120, materialsCents: 0 }, prototype).minutes).toBe(120);
    expect(priceWork({ minutes: 180, materialsCents: 0 }, prototype).minutes).toBe(180);
  });

  it("doesn't raise half an hour of extra work to the minimum", () => {
    const extra = priceWork({ minutes: 30, materialsCents: 2500 }, prototype, { applyMinimum: false });
    expect(extra.minutes).toBe(30);
    expect(extra.workerEarnsCents).toBe(3240);
    expect(extra.customerPriceCents).toBe(8108); // $70.50 + $10.575 GST rounded up
  });

  it("keeps the worker's pay the same when materials or the margin change", () => {
    const initial = priceWork({ minutes: 120, materialsCents: 0 }, prototype);
    const larger = priceWork({ minutes: 120, materialsCents: 50000 }, { ...prototype, marginBps: 3000 });
    expect(larger.workerGrossCents).toBe(initial.workerGrossCents);
    expect(larger.workerEarnsCents).toBe(initial.workerEarnsCents);
    expect(larger.customerPriceCents).toBeGreaterThan(initial.customerPriceCents);
  });

  it("doesn't add holiday pay on top of the on-costs", () => {
    const quote = priceWork({ minutes: 120, materialsCents: 0 }, prototype);
    expect(quote.onCostCents).toBe(1500);
    expect(quote.labourCostCents).toBe(13500);
    expect(quote.customerPriceCents).toBe(18630);
  });

  it("adds up across job sizes: customer price and worker pay reconcile with their parts", () => {
    for (const minutes of [30, 120, 135, 480, 2400]) {
      for (const materialsCents of [0, 1, 9999, 250000]) {
        const p = priceWork({ minutes, materialsCents }, prototype);
        expect(p.customerPriceCents).toBe(p.exGstCents + p.gstCents);
        expect(p.exGstCents).toBe(p.labourCostCents + p.materialsCents + p.marginCents);
        expect(p.labourCostCents).toBe(p.workerGrossCents + p.onCostCents);
        expect(p.workerEarnsCents).toBe(p.workerGrossCents + p.holidayPayCents);
      }
    }
  });

  it("shows the per-hour figures without the minimum", () => {
    expect(perHour(prototype)).toEqual({ workerEarnsCents: 6480, customerPriceCents: 9315, marginCents: 1350 });
  });
});

describe("licensed vs Other", () => {
  it("uses the shared rate and 2-hour minimum for every licensed trade", () => {
    for (const trade of ["ELECTRICAL", "PLUMBING", "GAS", "CONSTRUCTION"] as const) {
      expect(ratesForTrade(trade, launch)).toEqual({
        workerRateCents: 7000,
        minMinutes: 120,
        holidayPayBps: 800,
        onCostBps: 1250,
        marginBps: 2000,
        gstBps: 1500,
      });
    }
  });

  it("uses the Other rate and 1-hour minimum for Other", () => {
    expect(other).toMatchObject({ workerRateCents: 3800, minMinutes: 60 });
  });

  it("prices a licensed job at the 2-hour minimum", () => {
    // 2 h × $70 = $140; holiday $11.20; on-costs $17.50; labour $157.50; margin $31.50; ex GST $189; GST $28.35.
    expect(priceWork({ minutes: 60, materialsCents: 0 }, licensed)).toEqual({
      minutes: 120,
      materialsCents: 0,
      workerGrossCents: 14000,
      holidayPayCents: 1120,
      onCostCents: 1750,
      labourCostCents: 15750,
      marginCents: 3150,
      exGstCents: 18900,
      gstCents: 2835,
      customerPriceCents: 21735,
      workerEarnsCents: 15120,
    });
  });

  it("prices an Other job at the 1-hour minimum", () => {
    // 1 h × $38; holiday $3.04; on-costs $4.75; labour $42.75; margin $8.55; ex GST $51.30; GST $7.695 → $7.70.
    expect(priceWork({ minutes: 20, materialsCents: 0 }, other)).toMatchObject({
      minutes: 60,
      workerGrossCents: 3800,
      holidayPayCents: 304,
      onCostCents: 475,
      marginCents: 855,
      exGstCents: 5130,
      gstCents: 770,
      customerPriceCents: 5900,
      workerEarnsCents: 4104,
    });
  });

  it("gives these per-hour launch figures, which are under DECISIONS.md's ~$117 and ~$64 (flagged on #94)", () => {
    // Characterisation, not the target: DECISIONS.md #62 says the customer pays "about $117/hr incl GST
    // licensed, ~$64/hr Other". This order of operations gives $108.68 and $59.00. Which is right is William's
    // call; when it's settled, change this expectation on purpose.
    expect(perHour(licensed)).toEqual({ workerEarnsCents: 7560, customerPriceCents: 10868, marginCents: 1575 });
    expect(perHour(other)).toEqual({ workerEarnsCents: 4104, customerPriceCents: 5900, marginCents: 855 });
  });
});

describe("what if…", () => {
  it("hours are below the minimum: the minimum applies to the customer price and the worker's pay", () => {
    const short = priceWork({ minutes: 45, materialsCents: 0 }, licensed);
    const atMinimum = priceWork({ minutes: 120, materialsCents: 0 }, licensed);
    expect(short.minutes).toBe(120);
    expect(short.customerPriceCents).toBe(atMinimum.customerPriceCents);
    expect(short.workerGrossCents).toBe(14000);
    expect(short.workerEarnsCents).toBe(15120);
  });

  it("hours are exactly the minimum, or one minute over it", () => {
    expect(priceWork({ minutes: 120, materialsCents: 0 }, licensed).minutes).toBe(120);
    const over = priceWork({ minutes: 121, materialsCents: 0 }, licensed);
    expect(over.minutes).toBe(121);
    expect(over.workerGrossCents).toBe(14117); // 121 × 7000 / 60 = 14116.67
  });

  it("materials are zero: the margin is on labour only", () => {
    const quote = priceWork({ minutes: 180, materialsCents: 0 }, licensed);
    // 3 h × $70 = $210; on-costs $26.25; labour $236.25; 20% = $47.25.
    expect(quote.labourCostCents).toBe(23625);
    expect(quote.marginCents).toBe(4725);
    expect(quote.exGstCents).toBe(quote.labourCostCents + quote.marginCents);
  });

  it("materials are added: they carry the margin and GST, at cost, and don't change the worker's pay", () => {
    const without = priceWork({ minutes: 180, materialsCents: 0 }, licensed);
    const withMaterials = priceWork({ minutes: 180, materialsCents: 12345 }, licensed);
    // Margin on $236.25 + $123.45 = $359.70 → $71.94.
    expect(withMaterials.marginCents).toBe(7194);
    expect(withMaterials.workerEarnsCents).toBe(without.workerEarnsCents);
  });

  it("the margin, on-costs or GST are zero: those parts are zero and the rest still adds up", () => {
    const quote = priceWork(
      { minutes: 120, materialsCents: 5000 },
      { ...licensed, marginBps: 0, onCostBps: 0, gstBps: 0 },
    );
    expect(quote).toMatchObject({ onCostCents: 0, marginCents: 0, gstCents: 0, customerPriceCents: 19000 });
  });

  it("the minimum is zero: the job is priced at the time given", () => {
    expect(priceWork({ minutes: 1, materialsCents: 0 }, { ...licensed, minMinutes: 0 }).workerGrossCents).toBe(117);
  });

  it("the job is very large: still exact whole cents", () => {
    // 400 h with $25,000 of materials.
    const quote = priceWork({ minutes: 24000, materialsCents: 2_500_000 }, licensed);
    expect(quote).toMatchObject({
      workerGrossCents: 2_800_000,
      holidayPayCents: 224_000,
      onCostCents: 350_000,
      labourCostCents: 3_150_000,
      marginCents: 1_130_000,
      exGstCents: 6_780_000,
      gstCents: 1_017_000,
      customerPriceCents: 7_797_000,
      workerEarnsCents: 3_024_000,
    });
  });

  it("the price wouldn't fit in the database: it refuses rather than overflow", () => {
    expect(() => priceWork({ minutes: 20_000_000, materialsCents: 0 }, licensed)).toThrow(/too big to store/);
    expect(() => priceWork({ minutes: 60, materialsCents: MAX_DB_INT }, licensed)).toThrow(PricingInputError);
  });

  it.each([
    ["fractional minutes", { minutes: 67.5, materialsCents: 0 }],
    ["no time", { minutes: 0, materialsCents: 0 }],
    ["negative time", { minutes: -60, materialsCents: 0 }],
    ["fractional cents of materials", { minutes: 60, materialsCents: 10.5 }],
    ["negative materials", { minutes: 60, materialsCents: -1 }],
    ["not a number", { minutes: Number.NaN, materialsCents: 0 }],
  ])("the input has %s: it refuses", (_, input) => {
    expect(() => priceWork(input, licensed)).toThrow(PricingInputError);
  });

  it.each([
    ["a fractional rate", { workerRateCents: 7000.5 }],
    ["a zero rate", { workerRateCents: 0 }],
    ["a margin over 100%", { marginBps: 10_001 }],
    ["a negative GST", { gstBps: -1 }],
    ["a fractional percentage", { onCostBps: 1250.5 }],
  ])("the rates have %s: it refuses", (_, change) => {
    expect(() => priceWork({ minutes: 60, materialsCents: 0 }, { ...licensed, ...change })).toThrow(PricingInputError);
  });
});

describe("rounding: half up, to whole cents, at each step", () => {
  it("rounds the gross half a cent up and just under half a cent down", () => {
    const at = (workerRateCents: number) =>
      priceWork({ minutes: 1, materialsCents: 0 }, { ...licensed, workerRateCents, minMinutes: 0 }).workerGrossCents;
    expect(at(3030)).toBe(51); // 50.5
    expect(at(3029)).toBe(50); // 50.483…
    expect(at(3031)).toBe(51); // 50.516…
  });

  it("rounds each percentage step on its own, before the next one uses it", () => {
    // 67 min × $60.01 = 6701.12 → 6701. Holiday 8% = 536.08 → 536. On-costs 12.5% = 837.625 → 838.
    // Labour 7539 + materials 1234 = 8773; margin 20% = 1754.6 → 1755. Ex GST 10528; GST 15% = 1579.2 → 1579.
    const quote = priceWork({ minutes: 67, materialsCents: 1234 }, { ...prototype, workerRateCents: 6001, minMinutes: 0 });
    expect(quote).toMatchObject({
      workerGrossCents: 6701,
      holidayPayCents: 536,
      onCostCents: 838,
      labourCostCents: 7539,
      marginCents: 1755,
      exGstCents: 10528,
      gstCents: 1579,
      customerPriceCents: 12107,
      workerEarnsCents: 7237,
    });
  });

  it("rounds GST of exactly half a cent up", () => {
    // Licensed hour: ex GST $94.50, 15% = $14.175 → 1417.5 cents → 1418.
    expect(priceWork({ minutes: 60, materialsCents: 0 }, { ...licensed, minMinutes: 0 }).gstCents).toBe(1418);
  });

  it("never returns anything but whole cents", () => {
    for (const minutes of [1, 7, 59, 61, 133, 999]) {
      for (const materialsCents of [0, 1, 3, 99_999]) {
        const quote = priceWork({ minutes, materialsCents }, { ...licensed, workerRateCents: 7001, minMinutes: 0 });
        for (const value of Object.values(quote)) expect(Number.isInteger(value)).toBe(true);
      }
    }
  });
});
