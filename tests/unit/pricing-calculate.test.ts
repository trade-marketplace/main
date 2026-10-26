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
// src/server/pricing/calculate.ts (on-costs on gross + holiday pay: Matt, 26 Oct, PR #307), not copied from its output.

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

// The prototype's pricing.test.ts cases, same inputs. Where its on-costs were on the gross alone (holiday pay inside
// them), the customer side now follows the decided order; worker pay is unchanged. Old totals in the comments.
describe("the prototype's pricing.test.ts cases", () => {
  it("prices a two-hour job with $100 materials and keeps gross pay apart from the customer price", () => {
    // $120 gross; holiday $9.60; on-costs 12.5% of $129.60 = $16.20; labour $145.80; + $100 = $245.80;
    // margin $49.16; ex GST $294.96; GST $44.244 → $44.24. (Prototype: $324.30.)
    const quote = priceWork({ minutes: 120, materialsCents: 10000 }, prototype);
    expect(quote).toMatchObject({
      workerGrossCents: 12000,
      holidayPayCents: 960,
      workerEarnsCents: 12960, // before PAYE, not take-home pay; same as the prototype
      onCostCents: 1620,
      labourCostCents: 14580,
      marginCents: 4916,
      exGstCents: 29496,
      gstCents: 4424,
      customerPriceCents: 33920,
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
    // $30 + $2.40 + $4.05 = $36.45; + $25 = $61.45; margin $12.29; ex GST $73.74; GST $11.061 → $11.06.
    expect(extra.customerPriceCents).toBe(8480); // prototype: $81.08
  });

  it("keeps the worker's pay the same when materials or the margin change", () => {
    const initial = priceWork({ minutes: 120, materialsCents: 0 }, prototype);
    const larger = priceWork({ minutes: 120, materialsCents: 50000 }, { ...prototype, marginBps: 3000 });
    expect(larger.workerGrossCents).toBe(initial.workerGrossCents);
    expect(larger.workerEarnsCents).toBe(initial.workerEarnsCents);
    expect(larger.customerPriceCents).toBeGreaterThan(initial.customerPriceCents);
  });

  it("charges on-costs on gross + holiday pay, and counts holiday pay once", () => {
    // $120 + $9.60 holiday; on-costs 12.5% of $129.60 = $16.20; labour $145.80; margin $29.16; ex GST $174.96;
    // GST $26.244 → $26.24. (Prototype: on-costs $15 on the gross alone, $186.30.)
    const quote = priceWork({ minutes: 120, materialsCents: 0 }, prototype);
    expect(quote.onCostCents).toBe(1620);
    expect(quote.labourCostCents).toBe(14580);
    expect(quote.customerPriceCents).toBe(20120);
  });

  it("adds up across job sizes: customer price and worker pay reconcile with their parts", () => {
    for (const minutes of [30, 120, 135, 480, 2400]) {
      for (const materialsCents of [0, 1, 9999, 250000]) {
        const p = priceWork({ minutes, materialsCents }, prototype);
        expect(p.customerPriceCents).toBe(p.exGstCents + p.gstCents);
        expect(p.exGstCents).toBe(p.labourCostCents + p.materialsCents + p.marginCents);
        expect(p.labourCostCents).toBe(p.workerGrossCents + p.holidayPayCents + p.onCostCents);
        expect(p.workerEarnsCents).toBe(p.workerGrossCents + p.holidayPayCents);
      }
    }
  });

  it("shows the per-hour figures without the minimum", () => {
    // $60 + $4.80 + $8.10 = $72.90; margin $14.58; ex GST $87.48; GST $13.122 → $13.12. (Prototype: $93.15, $13.50.)
    expect(perHour(prototype)).toEqual({ workerEarnsCents: 6480, customerPriceCents: 10060, marginCents: 1458 });
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
    // 2 h × $70 = $140; holiday $11.20; on-costs 12.5% of $151.20 = $18.90; labour $170.10; margin $34.02;
    // ex GST $204.12; GST $30.618 → $30.62.
    expect(priceWork({ minutes: 60, materialsCents: 0 }, licensed)).toEqual({
      minutes: 120,
      materialsCents: 0,
      workerGrossCents: 14000,
      holidayPayCents: 1120,
      onCostCents: 1890,
      labourCostCents: 17010,
      marginCents: 3402,
      exGstCents: 20412,
      gstCents: 3062,
      customerPriceCents: 23474,
      workerEarnsCents: 15120,
    });
  });

  it("prices an Other job at the 1-hour minimum", () => {
    // 1 h × $38; holiday $3.04; on-costs 12.5% of $41.04 = $5.13; labour $46.17; margin $9.234 → $9.23;
    // ex GST $55.40; GST $8.31.
    expect(priceWork({ minutes: 20, materialsCents: 0 }, other)).toMatchObject({
      minutes: 60,
      workerGrossCents: 3800,
      holidayPayCents: 304,
      onCostCents: 513,
      labourCostCents: 4617,
      marginCents: 923,
      exGstCents: 5540,
      gstCents: 831,
      customerPriceCents: 6371,
      workerEarnsCents: 4104,
    });
  });

  it("matches DECISIONS.md #62: about $117/hr licensed and ~$64/hr Other, incl GST", () => {
    // Licensed: $70 + $5.60 holiday = $75.60; on-costs $9.45; labour $85.05; margin $17.01; ex GST $102.06;
    // GST $15.309 → $15.31; $117.37. Other: $63.71 (above). Decided order: Matt, 26 Oct, PR #307.
    expect(perHour(licensed)).toEqual({ workerEarnsCents: 7560, customerPriceCents: 11737, marginCents: 1701 });
    expect(perHour(other)).toEqual({ workerEarnsCents: 4104, customerPriceCents: 6371, marginCents: 923 });
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
    // 3 h × $70 = $210; holiday $16.80; on-costs 12.5% of $226.80 = $28.35; labour $255.15; 20% = $51.03.
    expect(quote.labourCostCents).toBe(25515);
    expect(quote.marginCents).toBe(5103);
    expect(quote.exGstCents).toBe(quote.labourCostCents + quote.marginCents);
  });

  it("materials are added: they carry the margin and GST, at cost, and don't change the worker's pay", () => {
    const without = priceWork({ minutes: 180, materialsCents: 0 }, licensed);
    const withMaterials = priceWork({ minutes: 180, materialsCents: 12345 }, licensed);
    // Margin on $255.15 + $123.45 = $378.60 → $75.72.
    expect(withMaterials.marginCents).toBe(7572);
    expect(withMaterials.workerEarnsCents).toBe(without.workerEarnsCents);
  });

  it("the margin, on-costs or GST are zero: those parts are zero and holiday pay is still charged", () => {
    const quote = priceWork(
      { minutes: 120, materialsCents: 5000 },
      { ...licensed, marginBps: 0, onCostBps: 0, gstBps: 0 },
    );
    // $140 gross + $11.20 holiday + $50 materials.
    expect(quote).toMatchObject({ onCostCents: 0, marginCents: 0, gstCents: 0, customerPriceCents: 20120 });
  });

  it("holiday pay is more than the on-costs: the customer still pays for all of it", () => {
    const quote = priceWork({ minutes: 60, materialsCents: 0 }, { ...licensed, minMinutes: 0, holidayPayBps: 2000, onCostBps: 100 });
    // $70 + $14 holiday; on-costs 1% of $84 = $0.84; labour $84.84.
    expect(quote).toMatchObject({ holidayPayCents: 1400, onCostCents: 84, labourCostCents: 8484, workerEarnsCents: 8400 });
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
      onCostCents: 378_000,
      labourCostCents: 3_402_000,
      marginCents: 1_180_400,
      exGstCents: 7_082_400,
      gstCents: 1_062_360,
      customerPriceCents: 8_144_760,
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
    // 67 min × $60.01 = 6701.12 → 6701. Holiday 8% = 536.08 → 536. On-costs 12.5% of 7237 = 904.625 → 905.
    // Labour 8142 + materials 1234 = 9376; margin 20% = 1875.2 → 1875. Ex GST 11251; GST 15% = 1687.65 → 1688.
    const quote = priceWork({ minutes: 67, materialsCents: 1234 }, { ...prototype, workerRateCents: 6001, minMinutes: 0 });
    expect(quote).toMatchObject({
      workerGrossCents: 6701,
      holidayPayCents: 536,
      onCostCents: 905,
      labourCostCents: 8142,
      marginCents: 1875,
      exGstCents: 11251,
      gstCents: 1688,
      customerPriceCents: 12939,
      workerEarnsCents: 7237,
    });
  });

  it("rounds GST of exactly half a cent up", () => {
    // Nothing but GST: ex GST $70 + $0.10 materials = 7010 cents; 15% = 1051.5 → 1052.
    const gstOnly = { ...licensed, minMinutes: 0, holidayPayBps: 0, onCostBps: 0, marginBps: 0 };
    expect(priceWork({ minutes: 60, materialsCents: 10 }, gstOnly)).toMatchObject({ gstCents: 1052, customerPriceCents: 8062 });
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
