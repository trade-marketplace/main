import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { Prisma, Role } from "@/generated/prisma/client";
import { transitionJob, type StatusMachineDeps } from "@/server/jobs/status-machine";
import { calculatePayout } from "@/server/payouts/calculate";
import { checkPayrollDetails, queuePayoutForJob } from "@/server/payouts/queue-payout";
import { PricingInputError, priceWork } from "@/server/pricing/calculate";
import { priceJob } from "@/server/pricing/price-job";

import { testDatabaseUrl, useTestSchema } from "../support/test-db";

// Payout calculation (#164): hours × frozen rate, 8% holiday pay, QUEUED, once per worker per job.

const LICENSED = { workerRateCents: 7000, holidayPayBps: 800 };
const OTHER = { workerRateCents: 3800, holidayPayBps: 800 };

describe("calculatePayout", () => {
  it("pays the licensed minimum: 2 h × $70 = $140 + 8% = $151.20", () => {
    expect(
      calculatePayout({
        jobMinutes: 120,
        approvedExtraMinutes: [],
        ...LICENSED,
      }),
    ).toEqual({
      minutes: 120,
      rateCents: 7000,
      grossCents: 14_000,
      holidayPayCents: 1120,
      totalCents: 15_120,
    });
  });

  it("pays the Other minimum: 1 h × $38 = $38 + 8% = $41.04", () => {
    const payout = calculatePayout({
      jobMinutes: 60,
      approvedExtraMinutes: [],
      ...OTHER,
    });
    expect(payout).toMatchObject({
      grossCents: 3800,
      holidayPayCents: 304,
      totalCents: 4104,
    });
  });

  it("adds approved extra work with no second minimum", () => {
    const payout = calculatePayout({
      jobMinutes: 120,
      approvedExtraMinutes: [30, 15],
      ...LICENSED,
    });
    expect(payout).toMatchObject({
      minutes: 165,
      grossCents: 19_250,
      holidayPayCents: 1540,
      totalCents: 20_790,
    });
  });

  it("rounds half up in whole cents, never with floats", () => {
    // 1 minute at $38/hr = 63.33…c → 63; 8% of 63 = 5.04 → 5.
    expect(calculatePayout({ jobMinutes: 61, approvedExtraMinutes: [], ...OTHER })).toMatchObject({
      grossCents: 3863,
      holidayPayCents: 309,
    });
    // Exactly x.5 goes up: 1 min at 30c/h is 0.5c → 1c; 8% of 1c = 0.08c → 0.
    expect(
      calculatePayout({
        jobMinutes: 1,
        approvedExtraMinutes: [],
        workerRateCents: 30,
        holidayPayBps: 800,
      }),
    ).toMatchObject({
      grossCents: 1,
      holidayPayCents: 0,
    });
    // 8% of 6.25c-style halves: gross 625 → holiday exactly 50; gross 631 → 50.48 → 50; 632 → 50.56 → 51.
    expect(
      calculatePayout({
        jobMinutes: 60,
        approvedExtraMinutes: [],
        workerRateCents: 632,
        holidayPayBps: 800,
      }).holidayPayCents,
    ).toBe(51);
    expect(
      calculatePayout({
        jobMinutes: 60,
        approvedExtraMinutes: [],
        workerRateCents: 631,
        holidayPayBps: 800,
      }).holidayPayCents,
    ).toBe(50);
  });

  it("agrees with what the pricing engine told the worker they would earn", () => {
    const rates = {
      ...LICENSED,
      minMinutes: 120,
      onCostBps: 1250,
      marginBps: 2000,
      gstBps: 1500,
    };
    for (const minutes of [1, 59, 120, 121, 137, 480, 1439]) {
      const priced = priceWork({ minutes, materialsCents: 5000 }, rates);
      const payout = calculatePayout({
        jobMinutes: priced.minutes,
        approvedExtraMinutes: [],
        ...LICENSED,
      });
      expect(payout.totalCents).toBe(priced.workerEarnsCents);
      expect(payout.grossCents).toBe(priced.workerGrossCents);
      expect(payout.holidayPayCents).toBe(priced.holidayPayCents);
    }
  });

  it("uses the frozen rate it is given, so a later settings change can't move it", () => {
    const frozen = calculatePayout({
      jobMinutes: 120,
      approvedExtraMinutes: [],
      workerRateCents: 6000,
      holidayPayBps: 800,
    });
    expect(frozen.grossCents).toBe(12_000);
  });

  it("handles no holiday pay (0%)", () => {
    expect(
      calculatePayout({
        jobMinutes: 120,
        approvedExtraMinutes: [],
        workerRateCents: 7000,
        holidayPayBps: 0,
      }),
    ).toMatchObject({
      holidayPayCents: 0,
      totalCents: 14_000,
    });
  });

  it("refuses nonsense and amounts a database integer can't hold", () => {
    const bad = (input: Partial<Parameters<typeof calculatePayout>[0]>) =>
      expect(() =>
        calculatePayout({
          jobMinutes: 120,
          approvedExtraMinutes: [],
          ...LICENSED,
          ...input,
        }),
      ).toThrow(PricingInputError);
    bad({ jobMinutes: 0 });
    bad({ jobMinutes: 1.5 });
    bad({ approvedExtraMinutes: [0] });
    bad({ approvedExtraMinutes: [-5] });
    bad({ workerRateCents: 0 });
    bad({ workerRateCents: 70.5 });
    bad({ holidayPayBps: -1 });
    bad({ holidayPayBps: 10_001 });
    bad({ jobMinutes: 2_000_000_000, workerRateCents: 2_000_000_000 });
  });
});

describe("checkPayrollDetails", () => {
  it("is complete only with an IRD number, a bank account and a tax code", () => {
    expect(
      checkPayrollDetails({
        irdNumberEncrypted: "x",
        bankAccountEncrypted: "y",
        taxCode: "M",
      }),
    ).toEqual({
      complete: true,
      missing: [],
    });
    expect(checkPayrollDetails(null)).toEqual({
      complete: false,
      missing: ["ird", "bank", "taxCode"],
    });
    expect(
      checkPayrollDetails({
        irdNumberEncrypted: "x",
        bankAccountEncrypted: null,
        taxCode: "  ",
      }),
    ).toEqual({
      complete: false,
      missing: ["bank", "taxCode"],
    });
  });
});

describe("queuePayoutForJob (mocked transaction)", () => {
  function fakeTx(overrides: {
    job?: { workerId: string | null } | null;
    existing?: { id: string } | null;
    pricing?: {
      workerRateCents: number;
      holidayPayBps: number;
      minutes: number;
    } | null;
    variations?: { minutes: number | null }[];
    details?: {
      irdNumberEncrypted: string | null;
      bankAccountEncrypted: string | null;
      taxCode: string | null;
    } | null;
  }) {
    const created: unknown[] = [];
    const tx = {
      job: {
        findUnique: async () => ("job" in overrides ? overrides.job : { workerId: "w1" }),
      },
      payout: {
        findUnique: async () => overrides.existing ?? null,
        create: async ({ data }: { data: unknown }) => {
          created.push(data);
          return { id: "p1" };
        },
      },
      jobPricing: {
        findUnique: async () => ("pricing" in overrides ? overrides.pricing : { ...LICENSED, minutes: 120 }),
      },
      variation: { findMany: async () => overrides.variations ?? [] },
      payrollDetails: { findUnique: async () => overrides.details ?? null },
    };
    return { tx: tx as unknown as Prisma.TransactionClient, created };
  }

  it("queues a QUEUED payout from the frozen pricing plus approved extra work", async () => {
    const { tx, created } = fakeTx({ variations: [{ minutes: 30 }] });
    const result = await queuePayoutForJob(tx, "j1");
    expect(result).toMatchObject({
      queued: true,
      payoutId: "p1",
      totalCents: 18_900,
    });
    expect(created).toEqual([
      {
        jobId: "j1",
        workerId: "w1",
        minutes: 150,
        rateCents: 7000,
        grossCents: 17_500,
        holidayPayCents: 1400,
        status: "QUEUED",
      },
    ]);
  });

  it("flags missing bank/tax details but still queues (needs founder decision)", async () => {
    const { tx } = fakeTx({});
    const result = await queuePayoutForJob(tx, "j1");
    expect(result).toMatchObject({
      queued: true,
      payrollDetails: { complete: false, missing: ["ird", "bank", "taxCode"] },
    });
    const complete = fakeTx({
      details: {
        irdNumberEncrypted: "a",
        bankAccountEncrypted: "b",
        taxCode: "M",
      },
    });
    expect(await queuePayoutForJob(complete.tx, "j1")).toMatchObject({
      queued: true,
      payrollDetails: { complete: true },
    });
  });

  it("never pays twice and never touches an existing payout", async () => {
    const { tx, created } = fakeTx({ existing: { id: "old" } });
    expect(await queuePayoutForJob(tx, "j1")).toEqual({
      queued: false,
      reason: "already-queued",
      payoutId: "old",
    });
    expect(created).toHaveLength(0);
  });

  it("queues nothing without a worker or without frozen pricing", async () => {
    const noWorker = fakeTx({ job: { workerId: null } });
    expect(await queuePayoutForJob(noWorker.tx, "j1")).toEqual({
      queued: false,
      reason: "no-worker",
    });
    const missingJob = fakeTx({ job: null });
    expect(await queuePayoutForJob(missingJob.tx, "j1")).toEqual({
      queued: false,
      reason: "no-worker",
    });
    const unpriced = fakeTx({ pricing: null });
    expect(await queuePayoutForJob(unpriced.tx, "j1")).toEqual({
      queued: false,
      reason: "not-priced",
    });
    expect([noWorker, missingJob, unpriced].flatMap((t) => t.created)).toHaveLength(0);
  });
});

describe.skipIf(!testDatabaseUrl)("payout on completion (database)", () => {
  const schema = useTestSchema(import.meta.filename);
  const deps: StatusMachineDeps = {
    audit: async () => {},
    notify: async () => {},
  };

  async function person(role: Role) {
    const id = randomUUID();
    await schema.db.$executeRawUnsafe(`INSERT INTO auth.users (id) VALUES ($1::uuid)`, id);
    await schema.db.profile.create({
      data: { id, email: `${id}@example.nz`, role, firstName: "Test" },
    });
    return id;
  }

  /** A priced job waiting for sign-off (SUBMITTED), worked by a new worker. */
  async function submittedJob(minutes: number, data: Partial<Prisma.JobUncheckedCreateInput> = {}) {
    const job = await schema.db.job.create({
      data: {
        customerId: await person("CUSTOMER"),
        category: "OTHER",
        title: "Hang a door",
        description: "Interior door, frame is fine.",
        addressLine1: "1 Example St",
        suburb: "Gladstone",
        city: "Invercargill",
        status: "REVIEW",
        ...data,
      },
    });
    expect(await priceJob(schema.db, { jobId: job.id, minutes, materialsCents: 0 })).toMatchObject({ ok: true });
    const workerId = await person("TRADIE");
    await schema.db.job.update({
      where: { id: job.id },
      data: { status: "SUBMITTED", workerId },
    });
    return { id: job.id, workerId };
  }

  const payoutsFor = (jobId: string) => schema.db.payout.findMany({ where: { jobId } });

  it("queues one QUEUED payout when the customer signs off", async () => {
    const { id, workerId } = await submittedJob(30); // below the 1 h Other minimum
    const job = await schema.db.job.findUniqueOrThrow({ where: { id } });
    await transitionJob(schema.db, deps, {
      jobId: id,
      transition: "sign-off",
      actor: { role: "CUSTOMER", userId: job.customerId },
    });
    const payouts = await payoutsFor(id);
    expect(payouts).toHaveLength(1);
    expect(payouts[0]).toMatchObject({
      workerId,
      status: "QUEUED",
      minutes: 60,
      rateCents: 3800,
      grossCents: 3800,
      holidayPayCents: 304,
    });
  });

  it("uses the rates frozen at pricing, not today's settings, and adds approved extra work only", async () => {
    const { id, workerId } = await submittedJob(120, {
      category: "ELECTRICAL",
    });
    await schema.db.settings.update({
      where: { id: 1 },
      data: { sharedRateCents: 9000, holidayPayBps: 1000 },
    });
    const customerId = (await schema.db.job.findUniqueOrThrow({ where: { id } })).customerId;
    const extra = (status: "APPROVED" | "DECLINED", minutes: number) =>
      schema.db.$executeRawUnsafe(
        `INSERT INTO variations (job_id, requested_by_id, description, requested_minutes, status, minutes, materials_cents,
           worker_gross_cents, holiday_pay_cents, on_cost_cents, margin_cents, gst_cents, price_cents, decided_at, priced_at)
         VALUES ($1::uuid, $2::uuid, 'Extra', $3, $4::variation_status, $3, 0, 0, 0, 0, 0, 0, 0, now(), now())`,
        id,
        workerId,
        minutes,
        status,
      );
    await extra("APPROVED", 30);
    await extra("DECLINED", 90);
    await transitionJob(schema.db, deps, {
      jobId: id,
      transition: "sign-off",
      actor: { role: "CUSTOMER", userId: customerId },
    });
    const [payout] = await payoutsFor(id);
    expect(payout).toMatchObject({
      minutes: 150,
      rateCents: 7000,
      grossCents: 17_500,
      holidayPayCents: 1400,
      status: "QUEUED",
    });
  });

  it("doesn't pay twice when the job is moved back and completed again", async () => {
    const { id } = await submittedJob(60);
    const customerId = (await schema.db.job.findUniqueOrThrow({ where: { id } })).customerId;
    await transitionJob(schema.db, deps, {
      jobId: id,
      transition: "sign-off",
      actor: { role: "CUSTOMER", userId: customerId },
    });
    const office = { role: "ADMIN", userId: await person("ADMIN") } as const;
    await transitionJob(schema.db, deps, {
      jobId: id,
      transition: "override",
      actor: office,
      to: "SUBMITTED",
      reason: "Test",
    });
    await transitionJob(schema.db, deps, {
      jobId: id,
      transition: "override",
      actor: office,
      to: "COMPLETED",
      reason: "Test",
    });
    expect(await payoutsFor(id)).toHaveLength(1);
  });

  it("completing a job that was never priced queues nothing and still completes", async () => {
    const job = await schema.db.job.create({
      data: {
        customerId: await person("CUSTOMER"),
        category: "OTHER",
        title: "Hang a door",
        description: "Interior door, frame is fine.",
        addressLine1: "1 Example St",
        suburb: "Gladstone",
        city: "Invercargill",
        status: "SUBMITTED",
        priceCents: 12_000,
        workerId: await person("TRADIE"),
      },
    });
    await transitionJob(schema.db, deps, {
      jobId: job.id,
      transition: "sign-off",
      actor: { role: "CUSTOMER", userId: job.customerId },
    });
    expect((await schema.db.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("COMPLETED");
    expect(await payoutsFor(job.id)).toHaveLength(0);
  });
});
