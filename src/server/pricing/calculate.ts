import "server-only";

import type { Trade } from "@/generated/prisma/client";

// The pricing maths (#94), ported from the prototype's src/lib/pricing.ts. Pure: no database, no clock. The
// office prices a job with priceJob() (./price-job.ts), which feeds this the rates in settings and freezes the
// result onto the job.
//
// Server-only: the breakdown holds the margin, the rates and what the worker earns. Customers only ever get
// `customerPriceCents` (as jobs.price_cents); workers only ever get `workerEarnsCents` (AGENTS.md §5).
//
// The price is built UP from the worker's rate, so the worker's pay is fixed first and TM's cut comes out of the
// margin only. Order of operations, each money step rounded to whole cents before the next one uses it:
//
//   1. billed minutes  = max(minutes, the trade's minimum)          (2 h licensed, 1 h Other at launch)
//   2. worker gross    = billed minutes × hourly rate ÷ 60           rounded
//   3. holiday pay     = worker gross × holiday pay %               rounded   (8%)
//   4. on-costs        = worker gross × on-cost %                   rounded   (12.5%: holiday pay, KiwiSaver, ACC)
//   5. labour cost     = worker gross + on-costs
//   6. margin          = (labour cost + materials at cost) × margin %  rounded (20%; on labour only when no materials)
//   7. ex GST          = labour cost + materials + margin
//   8. GST             = ex GST × GST %                             rounded   (15%)
//   9. customer price  = ex GST + GST
//  10. worker earns    = worker gross + holiday pay                 (before PAYE)
//
// Holiday pay is part of the on-costs, not added on top of them: the customer pays for it through the 12.5%,
// and the worker receives it (step 10). Rounding is half up (x.5 cents goes up), done in exact integer
// arithmetic, so no float ever touches money. Every amount fits a Postgres integer, or pricing throws.

/** The rates a job is priced with: a copy of settings, frozen onto the job when it's priced. */
export type PricingRates = {
  /** Worker's hourly rate for the trade, in cents. */
  workerRateCents: number;
  /** Minimum billed time for the trade, in minutes. */
  minMinutes: number;
  /** Percentages in basis points: 20% = 2000. */
  holidayPayBps: number;
  onCostBps: number;
  marginBps: number;
  gstBps: number;
};

/** The rates in settings, for every trade (DECISIONS.md 9: one shared rate + an Other rate at launch). */
export type RateSettings = {
  sharedRateCents: number;
  otherRateCents: number;
  sharedMinMinutes: number;
  otherMinMinutes: number;
  holidayPayBps: number;
  onCostBps: number;
  marginBps: number;
  gstBps: number;
};

export type PriceBreakdown = {
  /** Billed time, after the minimum. */
  minutes: number;
  materialsCents: number;
  workerGrossCents: number;
  holidayPayCents: number;
  onCostCents: number;
  /** Worker gross + on-costs. */
  labourCostCents: number;
  /** TM's cut. */
  marginCents: number;
  exGstCents: number;
  gstCents: number;
  /** What the customer pays, incl GST: `jobs.price_cents`. */
  customerPriceCents: number;
  /** What the worker earns: gross + holiday pay, before PAYE. */
  workerEarnsCents: number;
};

export class PricingInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PricingInputError";
  }
}

/** Largest value a Postgres `integer` column holds ($21,474,836.47). */
export const MAX_DB_INT = 2_147_483_647;

/** Licensed trades share one rate and minimum; OTHER (any labour) has its own. */
export function ratesForTrade(trade: Trade, settings: RateSettings): PricingRates {
  const other = trade === "OTHER";
  return {
    workerRateCents: other ? settings.otherRateCents : settings.sharedRateCents,
    minMinutes: other ? settings.otherMinMinutes : settings.sharedMinMinutes,
    holidayPayBps: settings.holidayPayBps,
    onCostBps: settings.onCostBps,
    marginBps: settings.marginBps,
    gstBps: settings.gstBps,
  };
}

/**
 * Prices work: `minutes` of labour plus `materialsCents` of materials at cost, ex GST. The minimum applies to
 * both the customer price and the worker's pay. `applyMinimum: false` is for extra work on a job that already
 * paid its minimum.
 */
export function priceWork(
  input: { minutes: number; materialsCents: number },
  rates: PricingRates,
  { applyMinimum = true }: { applyMinimum?: boolean } = {},
): PriceBreakdown {
  checkInputs(input, rates);

  const minutes = applyMinimum ? Math.max(input.minutes, rates.minMinutes) : input.minutes;
  const { materialsCents } = input;
  const workerGrossCents = mulDivRound(minutes, rates.workerRateCents, 60);
  const holidayPayCents = percentOf(workerGrossCents, rates.holidayPayBps);
  const onCostCents = percentOf(workerGrossCents, rates.onCostBps);
  const labourCostCents = workerGrossCents + onCostCents;
  const marginCents = percentOf(labourCostCents + materialsCents, rates.marginBps);
  const exGstCents = labourCostCents + materialsCents + marginCents;
  const gstCents = percentOf(exGstCents, rates.gstBps);

  const breakdown: PriceBreakdown = {
    minutes,
    materialsCents,
    workerGrossCents,
    holidayPayCents,
    onCostCents,
    labourCostCents,
    marginCents,
    exGstCents,
    gstCents,
    customerPriceCents: exGstCents + gstCents,
    workerEarnsCents: workerGrossCents + holidayPayCents,
  };
  for (const [name, value] of Object.entries(breakdown)) {
    if (value > MAX_DB_INT) throw new PricingInputError(`${name} is too big to store (${value} cents)`);
  }
  return breakdown;
}

/** One hour at these rates, ignoring the minimum: the "per hour" figures for the pitch and the Settings screen. */
export function perHour(rates: PricingRates): { workerEarnsCents: number; customerPriceCents: number; marginCents: number } {
  const hour = priceWork({ minutes: 60, materialsCents: 0 }, rates, { applyMinimum: false });
  return {
    workerEarnsCents: hour.workerEarnsCents,
    customerPriceCents: hour.customerPriceCents,
    marginCents: hour.marginCents,
  };
}

/** Basis points of a whole-cent amount, rounded half up. */
function percentOf(cents: number, bps: number): number {
  return mulDivRound(cents, bps, 10_000);
}

/** a × b ÷ d rounded half up, exactly (BigInt, so a big job can't lose precision). All inputs are non-negative. */
function mulDivRound(a: number, b: number, d: number): number {
  const product = BigInt(a) * BigInt(b);
  const divisor = BigInt(d);
  return Number((product * 2n + divisor) / (divisor * 2n));
}

function checkInputs(input: { minutes: number; materialsCents: number }, rates: PricingRates) {
  const problems: string[] = [];
  const whole = (name: string, value: number, min: number, max = MAX_DB_INT) => {
    if (!Number.isInteger(value) || value < min || value > max) problems.push(`${name} must be a whole number from ${min} to ${max}`);
  };
  whole("minutes", input.minutes, 1);
  whole("materialsCents", input.materialsCents, 0);
  whole("workerRateCents", rates.workerRateCents, 1);
  whole("minMinutes", rates.minMinutes, 0);
  whole("holidayPayBps", rates.holidayPayBps, 0, 10_000);
  whole("onCostBps", rates.onCostBps, 0, 10_000);
  whole("marginBps", rates.marginBps, 0, 10_000);
  whole("gstBps", rates.gstBps, 0, 10_000);
  if (problems.length) throw new PricingInputError(`Can't price this: ${problems.join("; ")}`);
}
