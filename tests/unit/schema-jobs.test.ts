import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { Prisma, Role, Trade } from "@/generated/prisma/client";

import { testDatabaseUrl, useTestSchema } from "../support/test-db";

// Schema 2 (#87): jobs, photos, time windows, estimates, pricing snapshots and status history.

describe.skipIf(!testDatabaseUrl)("Schema 2: jobs", () => {
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

  async function createJob(customerId: string, data: Partial<Prisma.JobUncheckedCreateInput> = {}) {
    return schema.db.job.create({
      data: {
        customerId,
        category: "ELECTRICAL" as Trade,
        title: "Replace a light switch",
        description: "Hallway switch is cracked and sparks sometimes.",
        addressLine1: "1 Example St",
        suburb: "Gladstone",
        city: "Invercargill",
        lat: -46.4,
        lng: 168.35,
        ...data,
      },
    });
  }

  /** Launch rates (DECISIONS.md, #62): $70/hr, 2 h minimum, 20% margin, 15% GST. */
  const launchRates = {
    workerRateCents: 7000,
    minMinutes: 120,
    holidayPayBps: 800,
    onCostBps: 1250,
    marginBps: 2000,
    gstBps: 1500,
  };

  /**
   * Prices a job the way the office will: copy the rates, store the result, move it to PRICED. Figures follow
   * src/server/pricing/calculate.ts: 2 h × $70 = $140, holiday $11.20, on-costs 12.5% of $151.20 = $18.90,
   * + $15 materials = $185.10, margin $37.02, ex GST $202.12, GST $30.318 → $30.32, customer $232.44.
   */
  async function priceJob(jobId: string, officeId: string) {
    await schema.db.$transaction([
      schema.db.jobPricing.create({
        data: {
          jobId,
          ...launchRates,
          minutes: 120,
          materialsCents: 1500,
          workerGrossCents: 14000,
          holidayPayCents: 1120,
          onCostCents: 1890,
          marginCents: 3702,
          gstCents: 3032,
          pricedById: officeId,
        },
      }),
      schema.db.job.update({ where: { id: jobId }, data: { status: "PRICED", priceCents: 23244 } }),
    ]);
  }

  describe("the migration", () => {
    it("creates every table, with row-level security on all of them", async () => {
      const tables = await schema.db.$queryRawUnsafe<{ relname: string; relrowsecurity: boolean }[]>(
        `SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = $1 AND c.relkind = 'r' ORDER BY c.relname`,
        schema.name,
      );
      expect(tables.map((table) => table.relname)).toEqual(
        expect.arrayContaining(["estimates", "job_photos", "job_pricing", "job_status_history", "job_time_windows", "jobs"]),
      );
      expect(tables.filter((table) => !table.relrowsecurity)).toEqual([]);
    });

    it("stores every money amount as whole cents", async () => {
      const columns = await schema.db.$queryRawUnsafe<{ table_name: string; column_name: string; data_type: string }[]>(
        `SELECT table_name, column_name, data_type FROM information_schema.columns
         WHERE table_schema = $1 AND column_name LIKE '%cents'`,
        schema.name,
      );
      expect(columns.length).toBeGreaterThanOrEqual(9);
      expect(columns.filter((column) => column.data_type !== "integer")).toEqual([]);
    });
  });

  describe("jobs", () => {
    it("numbers jobs from TM-1001, one each", async () => {
      const customer = await createPerson();
      const first = await createJob(customer.id);
      const second = await createJob(customer.id);
      expect(first.jobNumber).toBeGreaterThanOrEqual(1001);
      expect(second.jobNumber).toBeGreaterThan(first.jobNumber);
    });

    it("starts in REVIEW with no worker, price or booking", async () => {
      const job = await createJob((await createPerson()).id);
      expect(job).toMatchObject({
        status: "REVIEW",
        workerId: null,
        priceCents: null,
        bookedDate: null,
        asap: false,
        anyTime: false,
        editedAt: null,
      });
    });

    it("takes QUOTE_BOUNTY as a status and reuses the trades as categories", async () => {
      const job = await createJob((await createPerson()).id, { category: "OTHER" });
      await schema.db.job.update({ where: { id: job.id }, data: { status: "QUOTE_BOUNTY" } });
      expect(await schema.db.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
        status: "QUOTE_BOUNTY",
        category: "OTHER",
      });
    });

    it("needs a price from PRICED on, and a worker from ASSIGNED on", async () => {
      const job = await createJob((await createPerson()).id);
      await expect(schema.db.job.update({ where: { id: job.id }, data: { status: "PRICED" } })).rejects.toThrow(
        /jobs_priced_has_price/,
      );
      await schema.db.job.update({ where: { id: job.id }, data: { status: "BOOKABLE", priceCents: 20000 } });
      await expect(schema.db.job.update({ where: { id: job.id }, data: { status: "ASSIGNED" } })).rejects.toThrow(
        /jobs_claimed_has_worker/,
      );
    });

    it("won't let a customer take their own job", async () => {
      const customer = await createPerson();
      const job = await createJob(customer.id);
      await expect(schema.db.job.update({ where: { id: job.id }, data: { workerId: customer.id } })).rejects.toThrow(
        /jobs_worker_not_customer/,
      );
    });

    it("rejects a negative price", async () => {
      const job = await createJob((await createPerson()).id);
      await expect(schema.db.job.update({ where: { id: job.id }, data: { priceCents: -1 } })).rejects.toThrow(
        /jobs_price_not_negative/,
      );
    });

    it("keeps a customer's jobs when someone tries to delete their account", async () => {
      // Jobs hold money history: deleting the account needs the job dealt with first (account deletion, later).
      const customer = await createPerson();
      await createJob(customer.id);
      await expect(schema.db.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = $1::uuid`, customer.id)).rejects.toThrow(
        /jobs_customer_id_fkey/,
      );
    });

    it("deletes its photos, windows, estimates, pricing and history with it", async () => {
      const office = await createPerson("ADMIN");
      const worker = await createWorker();
      const job = await createJob((await createPerson()).id);
      await schema.db.jobPhoto.create({ data: { jobId: job.id, path: "jobs/a.jpg" } });
      await schema.db.jobTimeWindow.create({ data: { jobId: job.id, date: new Date("2026-11-02"), timeOfDay: "MORNING" } });
      await schema.db.estimate.create({ data: { jobId: job.id, workerId: worker.id, minutes: 90 } });
      await priceJob(job.id, office.id);
      await schema.db.job.update({ where: { id: job.id }, data: { status: "CANCELLED" } });
      await schema.db.job.delete({ where: { id: job.id } });
      expect(
        await Promise.all([
          schema.db.jobPhoto.count({ where: { jobId: job.id } }),
          schema.db.jobTimeWindow.count({ where: { jobId: job.id } }),
          schema.db.estimate.count({ where: { jobId: job.id } }),
          schema.db.jobPricing.count({ where: { jobId: job.id } }),
          schema.db.jobStatusHistory.count({ where: { jobId: job.id } }),
        ]),
      ).toEqual([0, 0, 0, 0, 0]);
    });
  });

  describe("photos and time windows", () => {
    it("keeps photos in gallery order", async () => {
      const job = await createJob((await createPerson()).id);
      await schema.db.jobPhoto.createMany({
        data: [
          { jobId: job.id, path: "jobs/2.jpg", position: 1 },
          { jobId: job.id, path: "jobs/1.jpg", position: 0 },
        ],
      });
      const photos = await schema.db.jobPhoto.findMany({ where: { jobId: job.id }, orderBy: { position: "asc" } });
      expect(photos.map((photo) => photo.path)).toEqual(["jobs/1.jpg", "jobs/2.jpg"]);
    });

    it("stores windows as a date and part of the day, once each", async () => {
      const job = await createJob((await createPerson()).id);
      const date = new Date("2026-11-03");
      await schema.db.jobTimeWindow.createMany({
        data: [
          { jobId: job.id, date, timeOfDay: "MORNING" },
          { jobId: job.id, date, timeOfDay: "EVENING" },
        ],
      });
      await expect(schema.db.jobTimeWindow.create({ data: { jobId: job.id, date, timeOfDay: "MORNING" } })).rejects.toThrow(
        /Unique constraint failed/,
      );
      expect(await schema.db.jobTimeWindow.count({ where: { jobId: job.id } })).toBe(2);
    });

    it("books one of the customer's windows and nothing else", async () => {
      const job = await createJob((await createPerson()).id);
      const date = new Date("2026-11-04");
      await schema.db.jobTimeWindow.create({ data: { jobId: job.id, date, timeOfDay: "AFTERNOON" } });
      await expect(
        schema.db.job.update({ where: { id: job.id }, data: { bookedDate: date, bookedTime: "MORNING" } }),
      ).rejects.toThrow(/wasn't offered that window/);
      await schema.db.job.update({ where: { id: job.id }, data: { bookedDate: date, bookedTime: "AFTERNOON" } });
      expect(await schema.db.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ bookedTime: "AFTERNOON" });
    });

    it("books any window when the customer said any time", async () => {
      const job = await createJob((await createPerson()).id, { anyTime: true });
      await schema.db.job.update({ where: { id: job.id }, data: { bookedDate: new Date("2026-11-05"), bookedTime: "EVENING" } });
    });

    it("won't book half a window", async () => {
      const job = await createJob((await createPerson()).id, { anyTime: true });
      await expect(schema.db.job.update({ where: { id: job.id }, data: { bookedDate: new Date("2026-11-05") } })).rejects.toThrow(
        /jobs_booked_window_whole/,
      );
    });
  });

  describe("pricing (acceptance: money in cents, rates copied onto the job)", () => {
    it("keeps the rates it was priced with on the job itself", async () => {
      const office = await createPerson("ADMIN");
      const job = await createJob((await createPerson()).id);
      await priceJob(job.id, office.id);
      expect(await schema.db.job.findUniqueOrThrow({ where: { id: job.id }, include: { pricing: true } })).toMatchObject({
        status: "PRICED",
        priceCents: 23244,
        pricing: { ...launchRates, workerGrossCents: 14000, pricedById: office.id },
      });
    });

    it("can be re-priced until the customer pays, then never changes", async () => {
      const office = await createPerson("ADMIN");
      const job = await createJob((await createPerson()).id);
      await priceJob(job.id, office.id);
      await schema.db.jobPricing.update({ where: { jobId: job.id }, data: { minutes: 150 } });
      await schema.db.job.update({ where: { id: job.id }, data: { priceCents: 26000 } });

      await schema.db.job.update({ where: { id: job.id }, data: { status: "BOOKABLE" } });
      // Settings change later (new rate): the paid job's copy can't be touched, so its price and payout stay.
      await expect(schema.db.jobPricing.update({ where: { jobId: job.id }, data: { workerRateCents: 8000 } })).rejects.toThrow(
        /its pricing can't change/,
      );
      await expect(schema.db.jobPricing.delete({ where: { jobId: job.id } })).rejects.toThrow(/its pricing can't change/);
      await expect(schema.db.job.update({ where: { id: job.id }, data: { priceCents: 1 } })).rejects.toThrow(
        /its price can't change/,
      );
      expect(await schema.db.job.findUniqueOrThrow({ where: { id: job.id }, include: { pricing: true } })).toMatchObject({
        priceCents: 26000,
        pricing: { workerRateCents: 7000, minutes: 150 },
      });
    });

    it("can't be added to a job that's already paid", async () => {
      const job = await createJob((await createPerson()).id, { status: "BOOKABLE", priceCents: 20000 });
      await expect(
        schema.db.jobPricing.create({
          data: {
            jobId: job.id,
            ...launchRates,
            minutes: 120,
            materialsCents: 0,
            workerGrossCents: 1,
            holidayPayCents: 0,
            onCostCents: 0,
            marginCents: 0,
            gstCents: 0,
          },
        }),
      ).rejects.toThrow(/its pricing can't change/);
    });

    it("rejects billed time under the minimum and percentages over 100%", async () => {
      const job = await createJob((await createPerson()).id);
      const base = {
        jobId: job.id,
        ...launchRates,
        minutes: 120,
        materialsCents: 0,
        workerGrossCents: 14000,
        holidayPayCents: 0,
        onCostCents: 0,
        marginCents: 0,
        gstCents: 0,
      };
      await expect(schema.db.jobPricing.create({ data: { ...base, minutes: 60 } })).rejects.toThrow(/job_pricing_minutes/);
      await expect(schema.db.jobPricing.create({ data: { ...base, marginBps: 12000 } })).rejects.toThrow(
        /job_pricing_percentages/,
      );
    });
  });

  describe("status history (acceptance: a row on every status change)", () => {
    it("writes a row when the job is posted and on every change after, in order", async () => {
      const office = await createPerson("ADMIN");
      const worker = await createWorker();
      const job = await createJob((await createPerson()).id);
      await priceJob(job.id, office.id);
      await schema.db.job.update({ where: { id: job.id }, data: { status: "BOOKABLE" } });
      await schema.db.job.update({ where: { id: job.id }, data: { status: "ASSIGNED", workerId: worker.id } });

      const history = await schema.db.jobStatusHistory.findMany({ where: { jobId: job.id }, orderBy: { createdAt: "asc" } });
      expect(history.map(({ fromStatus, toStatus }) => [fromStatus, toStatus])).toEqual([
        [null, "REVIEW"],
        ["REVIEW", "PRICED"],
        ["PRICED", "BOOKABLE"],
        ["BOOKABLE", "ASSIGNED"],
      ]);
    });

    it("doesn't write a row when something other than the status changes", async () => {
      const job = await createJob((await createPerson()).id);
      await schema.db.job.update({ where: { id: job.id }, data: { asap: true } });
      await schema.db.job.update({ where: { id: job.id }, data: { status: "REVIEW" } });
      expect(await schema.db.jobStatusHistory.count({ where: { jobId: job.id } })).toBe(1);
    });

    it("writes the row even when the status is changed outside Prisma", async () => {
      const job = await createJob((await createPerson()).id);
      await schema.db.$executeRawUnsafe(`UPDATE "${schema.name}".jobs SET status = 'QUOTE_BOUNTY' WHERE id = $1::uuid`, job.id);
      expect(await schema.db.jobStatusHistory.findFirst({ where: { jobId: job.id, toStatus: "QUOTE_BOUNTY" } })).toMatchObject({
        fromStatus: "REVIEW",
        changedById: null,
      });
    });

    it("records who made the change when the server says so, and keeps several changes in one go in order", async () => {
      const office = await createPerson("ADMIN");
      const job = await createJob((await createPerson()).id);
      await schema.db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SELECT set_config('app.actor_id', $1, true)`, office.id);
        await tx.job.update({ where: { id: job.id }, data: { status: "QUOTE_BOUNTY" } });
        await tx.job.update({ where: { id: job.id }, data: { status: "CANCELLED" } });
      });
      const history = await schema.db.jobStatusHistory.findMany({ where: { jobId: job.id }, orderBy: { createdAt: "asc" } });
      expect(history.map(({ toStatus, changedById }) => [toStatus, changedById])).toEqual([
        ["REVIEW", null],
        ["QUOTE_BOUNTY", office.id],
        ["CANCELLED", office.id],
      ]);
    });
  });

  describe("estimates", () => {
    it("What if the same worker estimates twice? Unique (job, worker): the second save updates", async () => {
      const worker = await createWorker();
      const job = await createJob((await createPerson()).id);
      const save = (minutes: number, materialsCents: number) =>
        schema.db.estimate.upsert({
          where: { jobId_workerId: { jobId: job.id, workerId: worker.id } },
          create: { jobId: job.id, workerId: worker.id, minutes, materialsCents },
          update: { minutes, materialsCents },
        });
      const first = await save(210, 8500);
      const second = await save(180, 6000);
      expect(second.id).toBe(first.id);
      expect(await schema.db.estimate.findMany({ where: { jobId: job.id } })).toMatchObject([{ minutes: 180, materialsCents: 6000 }]);
      await expect(schema.db.estimate.create({ data: { jobId: job.id, workerId: worker.id, minutes: 60 } })).rejects.toThrow(
        /Unique constraint failed/,
      );
    });

    it("takes estimates from several workers on one job", async () => {
      const job = await createJob((await createPerson()).id);
      for (const minutes of [120, 150, 240]) {
        await schema.db.estimate.create({ data: { jobId: job.id, workerId: (await createWorker()).id, minutes } });
      }
      expect(await schema.db.estimate.count({ where: { jobId: job.id } })).toBe(3);
    });

    it("rejects zero time and negative materials", async () => {
      const worker = await createWorker();
      const job = await createJob((await createPerson()).id);
      await expect(schema.db.estimate.create({ data: { jobId: job.id, workerId: worker.id, minutes: 0 } })).rejects.toThrow(
        /estimates_minutes_positive/,
      );
      await expect(
        schema.db.estimate.create({ data: { jobId: job.id, workerId: worker.id, minutes: 60, materialsCents: -5 } }),
      ).rejects.toThrow(/estimates_materials_not_negative/);
    });
  });

  describe("What if a job is edited after estimates exist?", () => {
    it("sets editedAt and flags the estimates made before the edit", async () => {
      const [early, late] = [await createWorker(), await createWorker()];
      const job = await createJob((await createPerson()).id);
      await schema.db.estimate.create({ data: { jobId: job.id, workerId: early.id, minutes: 60 } });

      await schema.db.job.update({ where: { id: job.id }, data: { description: "Two switches, not one." } });
      await schema.db.estimate.create({ data: { jobId: job.id, workerId: late.id, minutes: 120 } });

      const edited = await schema.db.job.findUniqueOrThrow({ where: { id: job.id } });
      expect(edited.editedAt).toBeInstanceOf(Date);
      const estimates = await schema.db.estimate.findMany({ where: { jobId: job.id } });
      expect(Object.fromEntries(estimates.map((e) => [e.workerId, e.madeBeforeEdit]))).toEqual({
        [early.id]: true,
        [late.id]: false,
      });
    });

    it("clears the flag when the worker saves the estimate again, even unchanged", async () => {
      const worker = await createWorker();
      const job = await createJob((await createPerson()).id);
      const estimate = await schema.db.estimate.create({ data: { jobId: job.id, workerId: worker.id, minutes: 60 } });
      await schema.db.job.update({ where: { id: job.id }, data: { suburb: "Waikiwi" } });
      const flagged = await schema.db.estimate.findUniqueOrThrow({ where: { id: estimate.id } });
      expect(flagged.madeBeforeEdit).toBe(true);
      // Flagging isn't the worker saving: updatedAt stays when they last saved.
      expect(flagged.updatedAt).toEqual(estimate.updatedAt);

      await schema.db.estimate.update({ where: { id: estimate.id }, data: { minutes: 60 } });
      const resaved = await schema.db.estimate.findUniqueOrThrow({ where: { id: estimate.id } });
      expect(resaved.madeBeforeEdit).toBe(false);
      expect(resaved.updatedAt.getTime()).toBeGreaterThan(estimate.updatedAt.getTime());
    });

    it("counts adding or removing a photo as an edit, but not the photos posted with the job", async () => {
      const worker = await createWorker();
      const customer = await createPerson();
      const job = await schema.db.job.create({
        data: {
          customerId: customer.id,
          category: "PLUMBING",
          title: "Leaking tap",
          description: "Kitchen mixer drips.",
          addressLine1: "2 Example St",
          suburb: "Avenal",
          city: "Invercargill",
          photos: { create: [{ path: "jobs/tap.jpg" }] },
        },
      });
      expect(job.editedAt).toBeNull();
      expect((await schema.db.job.findUniqueOrThrow({ where: { id: job.id } })).editedAt).toBeNull();

      await schema.db.estimate.create({ data: { jobId: job.id, workerId: worker.id, minutes: 60 } });
      await schema.db.jobPhoto.create({ data: { jobId: job.id, path: "jobs/tap-2.jpg" } });
      expect((await schema.db.job.findUniqueOrThrow({ where: { id: job.id } })).editedAt).toBeInstanceOf(Date);
      expect((await schema.db.estimate.findFirstOrThrow({ where: { jobId: job.id } })).madeBeforeEdit).toBe(true);
    });

    it("doesn't count booking, ASAP or a status change as an edit", async () => {
      const worker = await createWorker();
      const job = await createJob((await createPerson()).id, { anyTime: true });
      await schema.db.estimate.create({ data: { jobId: job.id, workerId: worker.id, minutes: 60 } });
      await schema.db.job.update({
        where: { id: job.id },
        data: { asap: true, status: "QUOTE_BOUNTY", bookedDate: new Date("2026-11-06"), bookedTime: "MORNING" },
      });
      expect((await schema.db.job.findUniqueOrThrow({ where: { id: job.id } })).editedAt).toBeNull();
      expect((await schema.db.estimate.findFirstOrThrow({ where: { jobId: job.id } })).madeBeforeEdit).toBe(false);
    });
  });

  describe("row-level security (Supabase Data API)", () => {
    // Same as Schema 1: plays Supabase's `authenticated` role. `null` is a visitor who isn't signed in.
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

    /** A priced job with a photo, a window and an estimate, belonging to a new customer. */
    async function pricedJob() {
      const office = await createPerson("ADMIN");
      const customer = await createPerson();
      const worker = await createWorker();
      const job = await createJob(customer.id);
      await schema.db.jobPhoto.create({ data: { jobId: job.id, path: `jobs/${job.id}.jpg` } });
      await schema.db.jobTimeWindow.create({ data: { jobId: job.id, date: new Date("2026-11-09"), timeOfDay: "MORNING" } });
      await schema.db.estimate.create({ data: { jobId: job.id, workerId: worker.id, minutes: 120 } });
      await priceJob(job.id, office.id);
      return { customer, worker, office, job };
    }

    it("lets a customer read their own job, photos, windows, history and price, and nobody else's", async () => {
      const mine = await pricedJob();
      const theirs = await pricedJob();
      const seen = await asSignedIn(mine.customer.id, async (sql) => ({
        jobs: await sql(`SELECT id, price_cents FROM {schema}.jobs`),
        photos: await sql(`SELECT job_id FROM {schema}.job_photos`),
        windows: await sql(`SELECT job_id FROM {schema}.job_time_windows`),
        history: await sql(`SELECT DISTINCT job_id FROM {schema}.job_status_history`),
      }));
      expect(seen).toEqual({
        jobs: [{ id: mine.job.id, price_cents: 23244 }],
        photos: [{ job_id: mine.job.id }],
        windows: [{ job_id: mine.job.id }],
        history: [{ job_id: mine.job.id }],
      });
      expect(JSON.stringify(seen)).not.toContain(theirs.job.id);
    });

    it("never shows a customer the estimates or how their price was built", async () => {
      const { customer } = await pricedJob();
      const seen = await asSignedIn(customer.id, async (sql) => ({
        estimates: await sql(`SELECT * FROM {schema}.estimates`),
        pricing: await sql(`SELECT * FROM {schema}.job_pricing`),
      }));
      expect(seen).toEqual({ estimates: [], pricing: [] });
    });

    it("lets a worker read their own estimates only, and keeps the customer's price from them", async () => {
      const { worker, job } = await pricedJob();
      const other = await createWorker();
      await schema.db.estimate.create({ data: { jobId: job.id, workerId: other.id, minutes: 600 } });
      const seen = await asSignedIn(worker.id, async (sql) => ({
        estimates: await sql(`SELECT worker_id, minutes FROM {schema}.estimates`),
        jobs: await sql(`SELECT price_cents FROM {schema}.jobs`),
        pricing: await sql(`SELECT * FROM {schema}.job_pricing`),
      }));
      expect(seen).toEqual({ estimates: [{ worker_id: worker.id, minutes: 120 }], jobs: [], pricing: [] });
    });

    it("never shows pricing to anyone, office included, through the Data API", async () => {
      const { office } = await pricedJob();
      expect(await asSignedIn(office.id, (sql) => sql(`SELECT * FROM {schema}.job_pricing`))).toEqual([]);
    });

    it("shows nothing to someone who isn't signed in", async () => {
      await pricedJob();
      const seen = await asSignedIn(null, async (sql) => ({
        jobs: await sql(`SELECT id FROM {schema}.jobs`),
        photos: await sql(`SELECT id FROM {schema}.job_photos`),
        estimates: await sql(`SELECT id FROM {schema}.estimates`),
        history: await sql(`SELECT id FROM {schema}.job_status_history`),
      }));
      expect(seen).toEqual({ jobs: [], photos: [], estimates: [], history: [] });
    });

    it("doesn't let a customer change their job or a worker write an estimate through the Data API", async () => {
      const { customer, worker, job } = await pricedJob();
      expect(
        await asSignedIn(customer.id, (sql) => sql(`UPDATE {schema}.jobs SET price_cents = 1 WHERE id = '${job.id}' RETURNING id`)),
      ).toEqual([]);
      await expect(
        asSignedIn(worker.id, (sql) =>
          sql(`INSERT INTO {schema}.estimates (job_id, worker_id, minutes) VALUES ('${job.id}', '${worker.id}', 30)`),
        ),
      ).rejects.toThrow(/row-level security/);
      expect((await schema.db.job.findUniqueOrThrow({ where: { id: job.id } })).priceCents).toBe(23244);
    });
  });
});
