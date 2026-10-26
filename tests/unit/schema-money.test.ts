import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { Prisma, Role } from "@/generated/prisma/client";

import { testDatabaseUrl, useTestSchema } from "../support/test-db";

// Schema 3 (#91): payments, extra work (variations), payouts, materials and settings.

describe.skipIf(!testDatabaseUrl)("Schema 3: money", () => {
  const schema = useTestSchema(import.meta.filename);

  const email = () => `${randomUUID()}@example.nz`;

  /** Makes a Supabase Auth user (the stand-in table on plain Postgres) and its profile. */
  async function createPerson(role: Role = "CUSTOMER") {
    const id = randomUUID();
    await schema.db.$executeRawUnsafe(`INSERT INTO auth.users (id) VALUES ($1::uuid)`, id);
    return schema.db.profile.create({ data: { id, email: email(), role, firstName: "Test" } });
  }

  async function createWorker() {
    const worker = await createPerson("TRADIE");
    await schema.db.workerProfile.create({ data: { userId: worker.id } });
    return worker;
  }

  /** A paid job claimed by a worker: the state extra work, materials and payouts happen in. */
  async function assignedJob() {
    const customer = await createPerson();
    const worker = await createWorker();
    const job = await schema.db.job.create({
      data: {
        customerId: customer.id,
        category: "ELECTRICAL",
        title: "Replace a light switch",
        description: "Hallway switch is cracked.",
        addressLine1: "1 Example St",
        suburb: "Gladstone",
        city: "Invercargill",
        status: "ASSIGNED",
        priceCents: 23805,
        workerId: worker.id,
      },
    });
    return { customer, worker, job };
  }

  function payment(jobId: string, data: Partial<Prisma.PaymentUncheckedCreateInput> = {}) {
    return schema.db.payment.create({
      data: { jobId, kind: "JOB", amountCents: 23805, idempotencyKey: randomUUID(), ...data },
    });
  }

  const paid = { status: "PAID", paidAt: new Date() } as const;

  function variation(jobId: string, requestedById: string, data: Partial<Prisma.VariationUncheckedCreateInput> = {}) {
    return schema.db.variation.create({
      data: { jobId, requestedById, description: "Second switch is cracked too.", requestedMinutes: 30, ...data },
    });
  }

  /** What the office fills in to price extra work (30 min at the launch rate, no materials). */
  const variationPrice = {
    status: "PRICED",
    minutes: 30,
    materialsCents: 0,
    workerGrossCents: 3500,
    holidayPayCents: 280,
    onCostCents: 473,
    marginCents: 851,
    gstCents: 766,
    priceCents: 5870,
  } as const;

  function payout(jobId: string, workerId: string, data: Partial<Prisma.PayoutUncheckedCreateInput> = {}) {
    return schema.db.payout.create({
      data: { jobId, workerId, minutes: 120, rateCents: 7000, grossCents: 14000, holidayPayCents: 1120, ...data },
    });
  }

  describe("the migration", () => {
    it("creates every table, with row-level security on all of them", async () => {
      const tables = await schema.db.$queryRawUnsafe<{ relname: string; relrowsecurity: boolean }[]>(
        `SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = $1 AND c.relkind = 'r' ORDER BY c.relname`,
        schema.name,
      );
      expect(tables.map((table) => table.relname)).toEqual(
        expect.arrayContaining(["job_materials", "payments", "payouts", "settings", "variations"]),
      );
      expect(tables.filter((table) => !table.relrowsecurity)).toEqual([]);
    });

    it("stores money as whole cents and percentages as whole basis points", async () => {
      const columns = await schema.db.$queryRawUnsafe<{ table_name: string; column_name: string; data_type: string }[]>(
        `SELECT table_name, column_name, data_type FROM information_schema.columns
         WHERE table_schema = $1 AND (column_name LIKE '%cents' OR column_name LIKE '%bps')
           AND table_name IN ('payments', 'variations', 'payouts', 'job_materials', 'settings')`,
        schema.name,
      );
      expect(columns.length).toBeGreaterThanOrEqual(22);
      expect(columns.filter((column) => column.data_type !== "integer")).toEqual([]);
    });
  });

  describe("acceptance: a job can have several payments and several payouts", () => {
    it("takes the quick look, the job and each piece of extra work as separate payments", async () => {
      const { worker, job } = await assignedJob();
      const [first, second] = [await variation(job.id, worker.id), await variation(job.id, worker.id)];
      await payment(job.id, { kind: "QUICK_LOOK", amountCents: 3000, ...paid });
      await payment(job.id, { kind: "JOB", ...paid });
      await payment(job.id, { kind: "VARIATION", variationId: first.id, amountCents: 5870 });
      await payment(job.id, { kind: "VARIATION", variationId: second.id, amountCents: 2935 });

      const payments = await schema.db.payment.findMany({ where: { jobId: job.id }, orderBy: { amountCents: "asc" } });
      expect(payments.map((p) => [p.kind, p.amountCents])).toEqual([
        ["VARIATION", 2935],
        ["QUICK_LOOK", 3000],
        ["VARIATION", 5870],
        ["JOB", 23805],
      ]);
    });

    it("starts a payment PENDING, in test mode, with Stripe as the provider and nothing refunded", async () => {
      const { job } = await assignedJob();
      expect(await payment(job.id)).toMatchObject({
        status: "PENDING",
        provider: "stripe",
        livemode: false,
        refundedCents: 0,
        paidAt: null,
      });
    });

    it("pays each worker on a job separately (crews later), once each", async () => {
      const { worker, job } = await assignedJob();
      const crew = await createWorker();
      await payout(job.id, worker.id);
      await payout(job.id, crew.id, { minutes: 60, grossCents: 7000, holidayPayCents: 560 });
      expect(await schema.db.payout.count({ where: { jobId: job.id } })).toBe(2);
      await expect(payout(job.id, worker.id)).rejects.toThrow(/Unique constraint failed/);
    });
  });

  describe("acceptance: settings has one row with the launch rates", () => {
    it("has exactly one row, made by the migration with the defaults from #62", async () => {
      const rows = await schema.db.settings.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: 1,
        sharedRateCents: 7000,
        otherRateCents: 3800,
        sharedMinMinutes: 120,
        otherMinMinutes: 60,
        holidayPayBps: 800,
        onCostBps: 1250,
        marginBps: 2000,
        gstBps: 1500,
        autoReleaseHours: 48,
        quickLookPriceCents: 3000,
        bountyExpiryHours: 24,
        updatedById: null,
      });
    });

    it("gives the customer prices DECISIONS.md quotes: about $117/hr licensed and $64/hr Other incl GST", async () => {
      const s = await schema.db.settings.findUniqueOrThrow({ where: { id: 1 } });
      const customerHourly = (rate: number) =>
        [s.holidayPayBps, s.onCostBps, s.marginBps, s.gstBps].reduce((cents, bps) => cents * (1 + bps / 10000), rate);
      expect(Math.round(customerHourly(s.sharedRateCents) / 100)).toBe(117);
      expect(Math.round(customerHourly(s.otherRateCents) / 100)).toBe(64);
    });

    it("covers 60 km around Invercargill by default (Matt, 26 Oct), as a centre and a radius", async () => {
      const s = await schema.db.settings.findUniqueOrThrow({ where: { id: 1 } });
      expect(s.coverageCentreLat).toBeCloseTo(-46.41, 1);
      expect(s.coverageCentreLng).toBeCloseTo(168.35, 1);
      expect(s.coverageRadiusKm).toBe(60);
    });

    it("won't take a second row", async () => {
      await expect(schema.db.settings.create({ data: { id: 2 } })).rejects.toThrow(/settings_one_row/);
      await expect(schema.db.settings.create({ data: { id: 1 } })).rejects.toThrow(/Unique constraint failed/);
    });

    it("can't be deleted or emptied", async () => {
      await expect(schema.db.settings.delete({ where: { id: 1 } })).rejects.toThrow(/exactly one row/);
      await expect(schema.db.$executeRawUnsafe(`TRUNCATE "${schema.name}".settings`)).rejects.toThrow(/exactly one row/);
      expect(await schema.db.settings.count()).toBe(1);
    });

    it("is edited in place by the office, and rejects nonsense", async () => {
      const office = await createPerson("ADMIN");
      const before = await schema.db.settings.findUniqueOrThrow({ where: { id: 1 } });
      const after = await schema.db.settings.update({
        where: { id: 1 },
        data: { otherRateCents: 4000, updatedById: office.id },
      });
      expect(after).toMatchObject({ otherRateCents: 4000, updatedById: office.id });
      expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());

      await expect(schema.db.settings.update({ where: { id: 1 }, data: { sharedRateCents: 0 } })).rejects.toThrow(
        /settings_rates_positive/,
      );
      await expect(schema.db.settings.update({ where: { id: 1 }, data: { marginBps: 10001 } })).rejects.toThrow(
        /settings_percentages/,
      );
      for (const coverageRadiusKm of [0, 201]) {
        await expect(schema.db.settings.update({ where: { id: 1 }, data: { coverageRadiusKm } })).rejects.toThrow(
          /settings_coverage/,
        );
      }
      for (const coverageRadiusKm of [1, 200, 60]) {
        expect(await schema.db.settings.update({ where: { id: 1 }, data: { coverageRadiusKm } })).toMatchObject({
          coverageRadiusKm,
        });
      }
      await expect(schema.db.settings.update({ where: { id: 1 }, data: { coverageCentreLat: 91 } })).rejects.toThrow(
        /settings_coverage/,
      );
      await schema.db.settings.update({ where: { id: 1 }, data: { otherRateCents: 3800, updatedById: null } });
    });
  });

  describe("What if a payment is refunded in part?", () => {
    it("tracks refunded cents separately, then the full refund", async () => {
      const { job } = await assignedJob();
      const p = await payment(job.id, paid);
      const partly = await schema.db.payment.update({
        where: { id: p.id },
        data: { status: "PARTIALLY_REFUNDED", refundedCents: 5000, refundedAt: new Date() },
      });
      expect(partly).toMatchObject({ amountCents: 23805, refundedCents: 5000, status: "PARTIALLY_REFUNDED" });

      const fully = await schema.db.payment.update({
        where: { id: p.id },
        data: { status: "REFUNDED", refundedCents: 23805, refundedAt: new Date() },
      });
      expect(fully).toMatchObject({ amountCents: 23805, refundedCents: 23805, status: "REFUNDED" });
    });

    it("never refunds more than was paid", async () => {
      const { job } = await assignedJob();
      const p = await payment(job.id, paid);
      await expect(
        schema.db.payment.update({
          where: { id: p.id },
          data: { status: "REFUNDED", refundedCents: 23806, refundedAt: new Date() },
        }),
      ).rejects.toThrow(/payments_refund_at_most_amount/);
    });

    it("keeps the status and the refunded cents in agreement", async () => {
      const { job } = await assignedJob();
      const p = await payment(job.id, paid);
      const refundedAt = new Date();
      for (const data of [
        { status: "PARTIALLY_REFUNDED", refundedCents: 0, refundedAt },
        { status: "PARTIALLY_REFUNDED", refundedCents: 23805, refundedAt },
        { status: "REFUNDED", refundedCents: 100, refundedAt },
        { status: "PAID", refundedCents: 100, refundedAt },
      ] as const) {
        await expect(schema.db.payment.update({ where: { id: p.id }, data })).rejects.toThrow(
          /payments_refund_matches_status/,
        );
      }
      await expect(
        schema.db.payment.update({ where: { id: p.id }, data: { status: "PARTIALLY_REFUNDED", refundedCents: 100 } }),
      ).rejects.toThrow(/payments_refund_has_refunded_at/);
    });

    it("never takes a refund back", async () => {
      const { job } = await assignedJob();
      const p = await payment(job.id, { status: "PARTIALLY_REFUNDED", paidAt: new Date(), refundedCents: 5000, refundedAt: new Date() });
      await expect(schema.db.payment.update({ where: { id: p.id }, data: { refundedCents: 4000 } })).rejects.toThrow(
        /a refund can't be taken back/,
      );
    });
  });

  describe("payments", () => {
    it("never takes the same idempotency key or provider id twice", async () => {
      const { job } = await assignedJob();
      const p = await payment(job.id, { providerPaymentId: "pi_test_1", providerCheckoutId: "cs_test_1", status: "FAILED" });
      await expect(payment(job.id, { idempotencyKey: p.idempotencyKey })).rejects.toThrow(/Unique constraint failed/);
      await expect(payment(job.id, { providerPaymentId: "pi_test_1" })).rejects.toThrow(/Unique constraint failed/);
      await expect(payment(job.id, { providerCheckoutId: "cs_test_1" })).rejects.toThrow(/Unique constraint failed/);
      await expect(payment(job.id, { idempotencyKey: " " })).rejects.toThrow(/payments_idempotency_key_present/);
    });

    it("has one live payment per thing paid for, so nobody is charged twice; a failed one can be retried", async () => {
      const { worker, job } = await assignedJob();
      const extra = await variation(job.id, worker.id);
      await payment(job.id, { status: "FAILED", failureReason: "card_declined" });
      await payment(job.id, paid);
      await expect(payment(job.id)).rejects.toThrow(/Unique constraint failed/);

      await payment(job.id, { kind: "QUICK_LOOK", amountCents: 3000 });
      await expect(payment(job.id, { kind: "QUICK_LOOK", amountCents: 3000 })).rejects.toThrow(/Unique constraint failed/);

      await payment(job.id, { kind: "VARIATION", variationId: extra.id, amountCents: 5870 });
      await expect(payment(job.id, { kind: "VARIATION", variationId: extra.id, amountCents: 5870 })).rejects.toThrow(
        /Unique constraint failed/,
      );
    });

    it("names the extra work for a VARIATION payment, and only then, on the same job", async () => {
      const { worker, job } = await assignedJob();
      const other = await assignedJob();
      const extra = await variation(job.id, worker.id);
      await expect(payment(job.id, { kind: "VARIATION" })).rejects.toThrow(/payments_variation_matches_kind/);
      await expect(payment(job.id, { kind: "JOB", variationId: extra.id })).rejects.toThrow(/payments_variation_matches_kind/);
      await expect(payment(other.job.id, { kind: "VARIATION", variationId: extra.id })).rejects.toThrow(
        /that extra work is on another job/,
      );
    });

    it("needs a time once paid, and a positive amount", async () => {
      const { job } = await assignedJob();
      await expect(payment(job.id, { status: "PAID" })).rejects.toThrow(/payments_paid_has_paid_at/);
      await expect(payment(job.id, { amountCents: 0 })).rejects.toThrow(/payments_amount_positive/);
    });

    it("can't change what was paid, or go back to unpaid, once paid", async () => {
      const { job } = await assignedJob();
      const p = await payment(job.id, paid);
      await expect(schema.db.payment.update({ where: { id: p.id }, data: { amountCents: 100 } })).rejects.toThrow(
        /what it was for and its amount can't change/,
      );
      await expect(schema.db.payment.update({ where: { id: p.id }, data: { status: "PENDING" } })).rejects.toThrow(
        /it can't go back to PENDING/,
      );
      await expect(schema.db.payment.update({ where: { id: p.id }, data: { status: "FAILED" } })).rejects.toThrow(
        /it can't go back to FAILED/,
      );
    });

    it("lets a pending payment's amount change before it's paid", async () => {
      const { job } = await assignedJob();
      const p = await payment(job.id);
      expect(await schema.db.payment.update({ where: { id: p.id }, data: { amountCents: 20000 } })).toMatchObject({
        amountCents: 20000,
      });
    });

    it("keeps a job with payments or payouts from being deleted", async () => {
      const { job } = await assignedJob();
      await payment(job.id, paid);
      await expect(schema.db.job.delete({ where: { id: job.id } })).rejects.toThrow(/payments_job_id_fkey/);

      const second = await assignedJob();
      await payout(second.job.id, second.worker.id);
      await expect(schema.db.job.delete({ where: { id: second.job.id } })).rejects.toThrow(/payouts_job_id_fkey/);
    });
  });

  describe("extra work (variations)", () => {
    it("goes REQUESTED → PRICED → APPROVED, stamped by the database", async () => {
      const office = await createPerson("ADMIN");
      const { worker, job } = await assignedJob();
      const asked = await variation(job.id, worker.id, { requestedMaterialsCents: 1200 });
      expect(asked).toMatchObject({ status: "REQUESTED", priceCents: null, pricedAt: null, decidedAt: null });

      const priced = await schema.db.variation.update({
        where: { id: asked.id },
        data: { ...variationPrice, pricedById: office.id },
      });
      expect(priced).toMatchObject({ status: "PRICED", priceCents: 5870, pricedById: office.id, decidedAt: null });
      expect(priced.pricedAt).toBeInstanceOf(Date);

      const approved = await schema.db.variation.update({ where: { id: asked.id }, data: { status: "APPROVED" } });
      expect(approved.decidedAt).toBeInstanceOf(Date);
      expect(approved.pricedAt).toEqual(priced.pricedAt);
    });

    it("can be declined once priced, and that's final", async () => {
      const { worker, job } = await assignedJob();
      const asked = await variation(job.id, worker.id);
      await schema.db.variation.update({ where: { id: asked.id }, data: variationPrice });
      await schema.db.variation.update({ where: { id: asked.id }, data: { status: "DECLINED" } });
      await expect(schema.db.variation.update({ where: { id: asked.id }, data: { status: "APPROVED" } })).rejects.toThrow(
        /can't go from DECLINED to APPROVED/,
      );
      await expect(schema.db.variation.update({ where: { id: asked.id }, data: { priceCents: 1 } })).rejects.toThrow(
        /extra work is DECLINED: its price can't change/,
      );
    });

    it("starts REQUESTED and can't skip pricing or go backwards", async () => {
      const { worker, job } = await assignedJob();
      await expect(variation(job.id, worker.id, { ...variationPrice })).rejects.toThrow(/extra work starts as REQUESTED/);
      const asked = await variation(job.id, worker.id);
      await expect(schema.db.variation.update({ where: { id: asked.id }, data: { status: "APPROVED" } })).rejects.toThrow(
        /can't go from REQUESTED to APPROVED/,
      );
      await schema.db.variation.update({ where: { id: asked.id }, data: variationPrice });
      await expect(schema.db.variation.update({ where: { id: asked.id }, data: { status: "REQUESTED" } })).rejects.toThrow(
        /can't go from PRICED to REQUESTED/,
      );
    });

    it("needs every figure to be priced, and none before", async () => {
      const { worker, job } = await assignedJob();
      const asked = await variation(job.id, worker.id);
      await expect(
        schema.db.variation.update({ where: { id: asked.id }, data: { status: "PRICED", priceCents: 5870 } }),
      ).rejects.toThrow(/variations_priced_has_figures/);
      await expect(schema.db.variation.update({ where: { id: asked.id }, data: { priceCents: 5870 } })).rejects.toThrow(
        /variations_priced_has_figures/,
      );
    });

    it("lets the office re-price while PRICED, but freezes the worker's ask and the approved price", async () => {
      const { worker, job } = await assignedJob();
      const asked = await variation(job.id, worker.id);
      await schema.db.variation.update({ where: { id: asked.id }, data: { requestedMinutes: 45 } });
      const priced = await schema.db.variation.update({ where: { id: asked.id }, data: variationPrice });
      await expect(
        schema.db.variation.update({ where: { id: asked.id }, data: { requestedMinutes: 60 } }),
      ).rejects.toThrow(/the ask can't change/);

      const repriced = await schema.db.variation.update({ where: { id: asked.id }, data: { priceCents: 6000 } });
      expect(repriced.pricedAt!.getTime()).toBeGreaterThan(priced.pricedAt!.getTime());

      await expect(
        schema.db.variation.update({ where: { id: asked.id }, data: { status: "APPROVED", priceCents: 1 } }),
      ).rejects.toThrow(/extra work is APPROVED: its price can't change/);
    });

    it("rejects an empty description or no time", async () => {
      const { worker, job } = await assignedJob();
      await expect(variation(job.id, worker.id, { description: " " })).rejects.toThrow(/variations_description_present/);
      await expect(variation(job.id, worker.id, { requestedMinutes: 0 })).rejects.toThrow(
        /variations_requested_minutes_positive/,
      );
    });

    it("can't be deleted while a payment points at it", async () => {
      const { worker, job } = await assignedJob();
      const extra = await variation(job.id, worker.id);
      await payment(job.id, { kind: "VARIATION", variationId: extra.id, amountCents: 5870 });
      await expect(schema.db.variation.delete({ where: { id: extra.id } })).rejects.toThrow(/payments_variation_id_fkey/);
    });
  });

  describe("payouts", () => {
    it("queues, exports and is marked paid, in that order only", async () => {
      const { worker, job } = await assignedJob();
      const p = await payout(job.id, worker.id);
      expect(p).toMatchObject({ status: "QUEUED", exportedAt: null, paidAt: null });

      await expect(schema.db.payout.update({ where: { id: p.id }, data: { status: "EXPORTED" } })).rejects.toThrow(
        /payouts_exported_has_exported_at/,
      );
      await schema.db.payout.update({ where: { id: p.id }, data: { status: "EXPORTED", exportedAt: new Date() } });
      await expect(schema.db.payout.update({ where: { id: p.id }, data: { status: "PAID" } })).rejects.toThrow(
        /payouts_paid_has_paid_at/,
      );
      await schema.db.payout.update({ where: { id: p.id }, data: { status: "PAID", paidAt: new Date() } });
      await expect(
        schema.db.payout.update({ where: { id: p.id }, data: { status: "EXPORTED", paidAt: null } }),
      ).rejects.toThrow(/can't go back from PAID to EXPORTED/);
    });

    it("can't change its amounts once exported", async () => {
      const { worker, job } = await assignedJob();
      const p = await payout(job.id, worker.id);
      await schema.db.payout.update({ where: { id: p.id }, data: { minutes: 150, grossCents: 17500, holidayPayCents: 1400 } });
      await schema.db.payout.update({ where: { id: p.id }, data: { status: "EXPORTED", exportedAt: new Date() } });
      await expect(schema.db.payout.update({ where: { id: p.id }, data: { grossCents: 1 } })).rejects.toThrow(
        /payout is EXPORTED: its amounts can't change/,
      );
    });

    it("rejects no time, no rate or negative pay", async () => {
      const { worker, job } = await assignedJob();
      await expect(payout(job.id, worker.id, { minutes: 0 })).rejects.toThrow(/payouts_minutes_positive/);
      await expect(payout(job.id, worker.id, { rateCents: 0 })).rejects.toThrow(/payouts_rate_positive/);
      await expect(payout(job.id, worker.id, { holidayPayCents: -1 })).rejects.toThrow(/payouts_amounts_not_negative/);
    });
  });

  describe("materials", () => {
    it("keeps a budget and the actual spend, which may go over", async () => {
      const { job } = await assignedJob();
      await schema.db.jobMaterials.create({ data: { jobId: job.id, budgetCents: 5000 } });
      const spent = await schema.db.jobMaterials.update({
        where: { jobId: job.id },
        data: { spentCents: 6200, spentAt: new Date(), receiptPath: `materials/${job.id}.jpg` },
      });
      expect(spent).toMatchObject({ budgetCents: 5000, spentCents: 6200 });
    });

    it("rejects negative amounts and a spend without a time", async () => {
      const { job } = await assignedJob();
      await expect(schema.db.jobMaterials.create({ data: { jobId: job.id, budgetCents: -1 } })).rejects.toThrow(
        /job_materials_budget_not_negative/,
      );
      await expect(
        schema.db.jobMaterials.create({ data: { jobId: job.id, budgetCents: 0, spentCents: 100 } }),
      ).rejects.toThrow(/job_materials_spent_has_spent_at/);
    });
  });

  describe("row-level security (Supabase Data API)", () => {
    // Same as Schemas 1 and 2: plays Supabase's `authenticated` role. `null` is a visitor who isn't signed in.
    async function asSignedIn<T>(userId: string | null, work: (sql: (query: string) => Promise<unknown[]>) => Promise<T>) {
      await schema.db.$executeRawUnsafe(`
        DO $$ BEGIN CREATE ROLE tm_rls_tester NOLOGIN;
        EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $$`);
      await schema.db.$executeRawUnsafe(`GRANT USAGE ON SCHEMA "${schema.name}", auth TO tm_rls_tester`);
      await schema.db.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA "${schema.name}" TO tm_rls_tester`);
      return schema.db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE tm_rls_tester`);
        await tx.$executeRawUnsafe(`SELECT set_config('request.jwt.claims', $1, true)`, JSON.stringify(userId ? { sub: userId } : { role: "anon" }));
        return work((query) => tx.$queryRawUnsafe(query.replaceAll("{schema}", `"${schema.name}"`)));
      });
    }

    /** A job with a payment, priced extra work, materials and a payout. */
    async function jobWithMoney() {
      const { customer, worker, job } = await assignedJob();
      const extra = await variation(job.id, worker.id);
      await schema.db.variation.update({ where: { id: extra.id }, data: variationPrice });
      const pay = await payment(job.id, paid);
      await schema.db.jobMaterials.create({ data: { jobId: job.id, budgetCents: 5000 } });
      const owed = await payout(job.id, worker.id);
      return { customer, worker, job, payment: pay, payout: owed };
    }

    const everything = (sql: (query: string) => Promise<unknown[]>) =>
      Promise.all([
        sql(`SELECT id FROM {schema}.payments`),
        sql(`SELECT id FROM {schema}.variations`),
        sql(`SELECT job_id FROM {schema}.job_materials`),
        sql(`SELECT id FROM {schema}.payouts`),
        sql(`SELECT id FROM {schema}.settings`),
      ]).then(([payments, variations, materials, payouts, settings]) => ({ payments, variations, materials, payouts, settings }));

    it("lets a customer read their own payments only, and never worker pay, extra-work costs, materials or settings", async () => {
      const mine = await jobWithMoney();
      const theirs = await jobWithMoney();
      const seen = await asSignedIn(mine.customer.id, everything);
      expect(seen).toEqual({ payments: [{ id: mine.payment.id }], variations: [], materials: [], payouts: [], settings: [] });
      expect(JSON.stringify(seen)).not.toContain(theirs.payment.id);
    });

    it("lets a worker read their own payouts only, and never the customer's payments or price", async () => {
      const mine = await jobWithMoney();
      const theirs = await jobWithMoney();
      const seen = await asSignedIn(mine.worker.id, everything);
      expect(seen).toEqual({ payments: [], variations: [], materials: [], payouts: [{ id: mine.payout.id }], settings: [] });
      expect(JSON.stringify(seen)).not.toContain(theirs.payout.id);
    });

    it("shows the office nothing through the Data API: it works through the server", async () => {
      await jobWithMoney();
      const office = await createPerson("ADMIN");
      expect(await asSignedIn(office.id, everything)).toEqual({
        payments: [],
        variations: [],
        materials: [],
        payouts: [],
        settings: [],
      });
    });

    it("shows nothing to someone who isn't signed in", async () => {
      await jobWithMoney();
      expect(await asSignedIn(null, everything)).toEqual({
        payments: [],
        variations: [],
        materials: [],
        payouts: [],
        settings: [],
      });
    });

    it("doesn't let anyone write money through the Data API", async () => {
      const { customer, worker, job, payment: pay, payout: owed } = await jobWithMoney();
      expect(
        await asSignedIn(customer.id, (sql) =>
          sql(`UPDATE {schema}.payments SET refunded_cents = 1 WHERE id = '${pay.id}' RETURNING id`),
        ),
      ).toEqual([]);
      expect(
        await asSignedIn(worker.id, (sql) => sql(`UPDATE {schema}.payouts SET gross_cents = 1 WHERE id = '${owed.id}' RETURNING id`)),
      ).toEqual([]);
      expect(
        await asSignedIn(worker.id, (sql) => sql(`UPDATE {schema}.settings SET shared_rate_cents = 1 RETURNING id`)),
      ).toEqual([]);
      await expect(
        asSignedIn(worker.id, (sql) =>
          sql(`INSERT INTO {schema}.payouts (job_id, worker_id, minutes, rate_cents, gross_cents, holiday_pay_cents)
               VALUES ('${job.id}', '${worker.id}', 600, 7000, 70000, 5600)`),
        ),
      ).rejects.toThrow(/row-level security/);
      expect(await schema.db.payment.findUniqueOrThrow({ where: { id: pay.id } })).toMatchObject({ refundedCents: 0 });
      expect(await schema.db.payout.findUniqueOrThrow({ where: { id: owed.id } })).toMatchObject({ grossCents: 14000 });
      expect(await schema.db.settings.findUniqueOrThrow({ where: { id: 1 } })).toMatchObject({ sharedRateCents: 7000 });
    });
  });
});
