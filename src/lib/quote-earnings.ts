// What a tradie would earn for the hours in their quote, shown live as they quote (Matt, 4 Nov, #485).
// Steps 1–3 and 10 of src/server/pricing/calculate.ts with the same rounding; a unit test keeps the two equal.
// Only the worker's own pay rates reach the browser: never the margin, on-costs or the customer price.
export type EarnRates = { workerRateCents: number; holidayPayBps: number; minMinutes: number };

const mulDivRound = (a: number, b: number, d: number) => Number((BigInt(a) * BigInt(b) * 2n + BigInt(d)) / (BigInt(d) * 2n));

/** Worker gross + holiday pay for these hours (the trade's minimum applies), or null for hours that aren't valid. */
export function quoteEarningsCents(hours: number, rates: EarnRates): number | null {
  if (!Number.isFinite(hours) || hours <= 0 || hours > 40) return null;
  const minutes = Math.max(Math.round(hours * 60), rates.minMinutes);
  const gross = mulDivRound(minutes, rates.workerRateCents, 60);
  return gross + mulDivRound(gross, rates.holidayPayBps, 10_000);
}
