import "server-only";

import type { JobStatus, Prisma, PrismaClient } from "@/generated/prisma/client";

import { type PriceBreakdown, priceWork, ratesForTrade } from "./calculate";

// Prices a job (#94): reads the rates in settings, builds the price and freezes it onto the job in one
// transaction, so "priced jobs keep their rates" (DECISIONS.md #62) holds. `job_pricing` gets a copy of every
// rate used plus the breakdown; `jobs.price_cents` gets what the customer pays. A later change to settings never
// moves either. The office may re-price while the job is REVIEW, QUOTE_BOUNTY or PRICED, which takes the
// settings as they are then; once paid, the database refuses any change (job_price_is_frozen,
// job_pricing_is_frozen). Sending the price to the customer (status → PRICED) is the office's Price a job
// screen (F02, #168), not this.

/** Statuses a job can be (re)priced in. The database triggers enforce the same list. */
export const PRICEABLE_STATUSES: readonly JobStatus[] = ["REVIEW", "QUOTE_BOUNTY", "PRICED"];

export type PriceJobInput = {
  jobId: string;
  /** Time the office priced, in minutes. The trade's minimum is applied on top. */
  minutes: number;
  /** Materials at cost, ex GST. */
  materialsCents: number;
  /** The office's note on how it was priced. */
  note?: string | null;
  /** The office person pricing it. */
  pricedById?: string | null;
};

export type PriceJobResult =
  | { ok: true; breakdown: PriceBreakdown }
  | { ok: false; error: "job-not-found" }
  // Paid (or further along): its price is final.
  | { ok: false; error: "job-not-priceable"; status: JobStatus };

type Db = Pick<PrismaClient, "$transaction">;

export async function priceJob(db: Db, input: PriceJobInput): Promise<PriceJobResult> {
  return db.$transaction(async (tx) => {
    const job = await tx.job.findUnique({ where: { id: input.jobId }, select: { status: true, category: true } });
    if (!job) return { ok: false, error: "job-not-found" } as const;
    if (!PRICEABLE_STATUSES.includes(job.status)) {
      return { ok: false, error: "job-not-priceable", status: job.status } as const;
    }

    const settings = await tx.settings.findUniqueOrThrow({ where: { id: 1 } });
    const rates = ratesForTrade(job.category, settings);
    const breakdown = priceWork({ minutes: input.minutes, materialsCents: input.materialsCents }, rates);

    // Writing the price first takes the job's row lock, and only matches while the job is still what was priced
    // (same trade, still priceable), so a payment or edit landing in between can't slip past.
    const updated = await tx.job.updateMany({
      where: { id: input.jobId, category: job.category, status: { in: [...PRICEABLE_STATUSES] } },
      data: { priceCents: breakdown.customerPriceCents },
    });
    if (updated.count !== 1) throw new JobChangedWhilePricingError(input.jobId);

    const pricing = {
      ...rates,
      minutes: breakdown.minutes,
      materialsCents: breakdown.materialsCents,
      workerGrossCents: breakdown.workerGrossCents,
      holidayPayCents: breakdown.holidayPayCents,
      onCostCents: breakdown.onCostCents,
      marginCents: breakdown.marginCents,
      gstCents: breakdown.gstCents,
      note: input.note?.trim() || null,
      pricedById: input.pricedById ?? null,
      pricedAt: new Date(),
    } satisfies Omit<Prisma.JobPricingUncheckedCreateInput, "jobId">;
    await tx.jobPricing.upsert({
      where: { jobId: input.jobId },
      create: { jobId: input.jobId, ...pricing },
      update: pricing,
    });

    return { ok: true, breakdown } as const;
  });
}

/** The job changed (trade, or paid) between reading it and writing its price. Pricing again sorts it out. */
export class JobChangedWhilePricingError extends Error {
  constructor(jobId: string) {
    super(`Job ${jobId} changed while it was being priced. Price it again.`);
    this.name = "JobChangedWhilePricingError";
  }
}
