import "server-only";

import { MAX_DB_INT, PricingInputError, mulDivRound, percentOf } from "@/server/pricing/calculate";

// What a worker is owed for a finished job (#164). Pure: no database, no clock. Uses the pricing engine's own
// rounding helpers (exact integer maths, half up), so a payout always agrees with the earnings the worker was
// shown when the job was priced.
//
//   minutes     = billed minutes on the job (after the minimum) + approved extra work (no second minimum)
//   gross       = minutes × the job's FROZEN hourly rate ÷ 60, rounded           (before PAYE)
//   holiday pay = gross × the job's FROZEN holiday pay %, rounded                (8% for casual employees)
//   total       = gross + holiday pay
//
// Never touches the customer's price, the margin or on-costs: the worker only ever sees what they earn.

export type PayoutInput = {
  /** Billed minutes from the job's frozen pricing (the trade's minimum already applied). */
  jobMinutes: number;
  /** Minutes of each APPROVED extra-work request, as priced by the office. Declined or unpriced ones don't count. */
  approvedExtraMinutes: readonly number[];
  /** Frozen on the job when it was priced. */
  workerRateCents: number;
  holidayPayBps: number;
};

export type PayoutAmounts = {
  minutes: number;
  rateCents: number;
  grossCents: number;
  holidayPayCents: number;
  /** gross + holiday pay: what the worker earns, before PAYE. */
  totalCents: number;
};

export function calculatePayout(input: PayoutInput): PayoutAmounts {
  const minutes = input.jobMinutes + input.approvedExtraMinutes.reduce((sum, m) => sum + m, 0);
  const problems: string[] = [];
  const whole = (name: string, value: number, min: number, max = MAX_DB_INT) => {
    if (!Number.isInteger(value) || value < min || value > max)
      problems.push(`${name} must be a whole number from ${min} to ${max}`);
  };
  whole("jobMinutes", input.jobMinutes, 1);
  for (const extra of input.approvedExtraMinutes) whole("extra minutes", extra, 1);
  whole("minutes", minutes, 1);
  whole("workerRateCents", input.workerRateCents, 1);
  whole("holidayPayBps", input.holidayPayBps, 0, 10_000);
  if (problems.length) throw new PricingInputError(`Can't calculate this payout: ${problems.join("; ")}`);

  const grossCents = mulDivRound(minutes, input.workerRateCents, 60);
  const holidayPayCents = percentOf(grossCents, input.holidayPayBps);
  const totalCents = grossCents + holidayPayCents;
  for (const [name, value] of Object.entries({
    grossCents,
    holidayPayCents,
    totalCents,
  })) {
    if (value > MAX_DB_INT) throw new PricingInputError(`${name} is too big to store (${value} cents)`);
  }
  return {
    minutes,
    rateCents: input.workerRateCents,
    grossCents,
    holidayPayCents,
    totalCents,
  };
}
