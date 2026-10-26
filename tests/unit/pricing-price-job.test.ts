import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { Prisma, PrismaClient, Role } from "@/generated/prisma/client";
import { JobChangedWhilePricingError, priceJob } from "@/server/pricing/price-job";

import { testDatabaseUrl, useTestSchema } from "../support/test-db";

// Pricing a job freezes the rates in settings onto it (#94, DECISIONS.md #62: "priced jobs keep their rates").

describe("priceJob when the job changes underneath it", () => {
  it("throws rather than write a price for a job that was paid (or changed trade) mid-way", async () => {
    // The job reads as REVIEW, then a payment lands before the price is written: the guarded update matches nothing.
    const tx = {
      job: {
        findUnique: async () => ({ status: "REVIEW", category: "ELECTRICAL" }),
        updateMany: async () => ({ count: 0 }),
      },
      settings: {
        findUniqueOrThrow: async () => ({
          sharedRateCents: 7000,
          otherRateCents: 3800,
          sharedMinMinutes: 120,
          otherMinMinutes: 60,
          holidayPayBps: 800,
          onCostBps: 1250,
          marginBps: 2000,
          gstBps: 1500,
        }),
      },
      jobPricing: { upsert: async () => expect.unreachable("must not write the snapshot") },
    };
    const db = { $transaction: async (work: (t: typeof tx) => unknown) => work(tx) } as unknown as PrismaClient;
    await expect(priceJob(db, { jobId: randomUUID(), minutes: 120, materialsCents: 0 })).rejects.toThrow(
      JobChangedWhilePricingError,
    );
  });
});

describe.skipIf(!testDatabaseUrl)("priceJob (database)", () => {
  const schema = useTestSchema(import.meta.filename);

  async function createPerson(role: Role = "CUSTOMER") {
    const id = randomUUID();
    await schema.db.$executeRawUnsafe(`INSERT INTO auth.users (id) VALUES ($1::uuid)`, id);
    return schema.db.profile.create({ data: { id, email: `${id}@example.nz`, role, firstName: "Test" } });
  }

  async function createJob(data: Partial<Prisma.JobUncheckedCreateInput> = {}) {
    return schema.db.job.create({
      data: {
        customerId: (await createPerson()).id,
        category: "ELECTRICAL",
        title: "Replace a light switch",
        description: "Hallway switch is cracked.",
        addressLine1: "1 Example St",
        suburb: "Gladstone",
        city: "Invercargill",
        ...data,
      },
    });
  }

  const stored = (jobId: string) =>
    schema.db.job.findUniqueOrThrow({ where: { id: jobId }, include: { pricing: true } });

  /** The launch rates from the migration, put back after a test changes them. */
  const launchSettings = {
    sharedRateCents: 7000,
    otherRateCents: 3800,
    sharedMinMinutes: 120,
    otherMinMinutes: 60,
    holidayPayBps: 800,
    onCostBps: 1250,
    marginBps: 2000,
    gstBps: 1500,
  };
  async function withSettings(change: Partial<typeof launchSettings>, work: () => Promise<void>) {
    await schema.db.settings.update({ where: { id: 1 }, data: change });
    try {
      await work();
    } finally {
      await schema.db.settings.update({ where: { id: 1 }, data: launchSettings });
    }
  }

  it("prices a licensed job from settings and writes the snapshot and the customer price together", async () => {
    const office = await createPerson("ADMIN");
    const job = await createJob();
    // 2.5 h × $70 = $175; holiday $14; on-costs 12.5% of $189 = $23.625 → $23.63; labour $212.63; + $50 materials
    // = $262.63; margin $52.526 → $52.53; ex GST $315.16; GST $47.274 → $47.27; customer $362.43.
    const result = await priceJob(schema.db, {
      jobId: job.id,
      minutes: 150,
      materialsCents: 5000,
      note: "  median of 3  ",
      pricedById: office.id,
    });
    expect(result).toMatchObject({ ok: true, breakdown: { customerPriceCents: 36243, workerEarnsCents: 18900 } });

    expect(await stored(job.id)).toMatchObject({
      status: "REVIEW",
      priceCents: 36243,
      pricing: {
        workerRateCents: 7000,
        minMinutes: 120,
        holidayPayBps: 800,
        onCostBps: 1250,
        marginBps: 2000,
        gstBps: 1500,
        minutes: 150,
        materialsCents: 5000,
        workerGrossCents: 17500,
        holidayPayCents: 1400,
        onCostCents: 2363,
        marginCents: 5253,
        gstCents: 4727,
        note: "median of 3",
        pricedById: office.id,
      },
    });
  });

  it("prices an Other job with the Other rate and its 1-hour minimum", async () => {
    const job = await createJob({ category: "OTHER", title: "Move a couch" });
    await priceJob(schema.db, { jobId: job.id, minutes: 30, materialsCents: 0 });
    expect(await stored(job.id)).toMatchObject({
      priceCents: 6371,
      pricing: { workerRateCents: 3800, minMinutes: 60, minutes: 60, workerGrossCents: 3800, holidayPayCents: 304 },
    });
  });

  it("stores the minimum, not the shorter time, when hours are below it (price and worker pay)", async () => {
    const job = await createJob();
    await priceJob(schema.db, { jobId: job.id, minutes: 45, materialsCents: 0 });
    expect(await stored(job.id)).toMatchObject({
      priceCents: 23474,
      pricing: { minutes: 120, workerGrossCents: 14000, holidayPayCents: 1120 },
    });
  });

  it("keeps a priced job's rates and price when settings change later", async () => {
    const job = await createJob();
    await priceJob(schema.db, { jobId: job.id, minutes: 120, materialsCents: 0 });
    await schema.db.job.update({ where: { id: job.id }, data: { status: "PRICED" } });
    const before = await stored(job.id);

    await withSettings({ sharedRateCents: 9000, marginBps: 3000, holidayPayBps: 1000, sharedMinMinutes: 180 }, async () => {
      const after = await stored(job.id);
      expect(after.priceCents).toBe(before.priceCents);
      expect(after.pricing).toEqual(before.pricing);
    });
  });

  it("re-pricing before payment takes the settings as they are then", async () => {
    const job = await createJob();
    await priceJob(schema.db, { jobId: job.id, minutes: 120, materialsCents: 0 });
    await schema.db.job.update({ where: { id: job.id }, data: { status: "PRICED" } });

    await withSettings({ sharedRateCents: 8000 }, async () => {
      await priceJob(schema.db, { jobId: job.id, minutes: 120, materialsCents: 0 });
      // 2 h × $80 = $160; holiday $12.80; on-costs $21.60; labour $194.40; margin $38.88; ex GST $233.28;
      // GST $34.992 → $34.99.
      expect(await stored(job.id)).toMatchObject({
        priceCents: 26827,
        pricing: { workerRateCents: 8000, workerGrossCents: 16000 },
      });
    });
  });

  it("refuses to price a paid job and leaves its price and pricing alone", async () => {
    const job = await createJob();
    await priceJob(schema.db, { jobId: job.id, minutes: 120, materialsCents: 0 });
    await schema.db.job.update({ where: { id: job.id }, data: { status: "BOOKABLE" } });
    const before = await stored(job.id);

    await withSettings({ sharedRateCents: 9000 }, async () => {
      expect(await priceJob(schema.db, { jobId: job.id, minutes: 600, materialsCents: 100000 })).toEqual({
        ok: false,
        error: "job-not-priceable",
        status: "BOOKABLE",
      });
    });
    expect(await stored(job.id)).toEqual(before);
  });

  it("can price a job in QUOTE_BOUNTY", async () => {
    const job = await createJob({ status: "QUOTE_BOUNTY" });
    expect(await priceJob(schema.db, { jobId: job.id, minutes: 120, materialsCents: 0 })).toMatchObject({ ok: true });
  });

  it("says when the job doesn't exist", async () => {
    expect(await priceJob(schema.db, { jobId: randomUUID(), minutes: 120, materialsCents: 0 })).toEqual({
      ok: false,
      error: "job-not-found",
    });
  });

  it("writes nothing when the snapshot can't be saved (one transaction)", async () => {
    const job = await createJob();
    // No such profile: the job_pricing insert fails after the price was written, so both roll back.
    await expect(
      priceJob(schema.db, { jobId: job.id, minutes: 120, materialsCents: 0, pricedById: randomUUID() }),
    ).rejects.toThrow();
    expect(await stored(job.id)).toMatchObject({ priceCents: null, pricing: null });
  });

  it("writes nothing for input it can't price", async () => {
    const job = await createJob();
    await expect(priceJob(schema.db, { jobId: job.id, minutes: 90.5, materialsCents: 0 })).rejects.toThrow(
      /whole number/,
    );
    expect(await stored(job.id)).toMatchObject({ priceCents: null, pricing: null });
  });
});
