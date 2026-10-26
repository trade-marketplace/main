import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ADDRESSES, examplePricing, JOBS, moneyIds, PEOPLE, testPaymentRefs } from "../../prisma/seed/data.mjs";
import { plainAuthUsers, seedDemoData, supabaseAuthUsers } from "../../prisma/seed/run.mjs";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

const ALL_STATUSES = [
  "REVIEW",
  "QUOTE_BOUNTY",
  "PRICED",
  "BOOKABLE",
  "ASSIGNED",
  "SUBMITTED",
  "COMPLETED",
  "CANCEL_REVIEW",
  "CANCELLED",
];
const ALL_TRADES = ["ELECTRICAL", "PLUMBING", "GAS", "CONSTRUCTION", "OTHER"];

const TABLES = [
  "profiles",
  "worker_profiles",
  "worker_trades",
  "licences",
  "addresses",
  "jobs",
  "job_photos",
  "job_time_windows",
  "estimates",
  "job_pricing",
  "job_status_history",
  "payments",
  "variations",
  "payouts",
  "job_materials",
  "settings",
];

// Statuses a job only reaches once the customer has paid.
const PAID_STATUSES = ["BOOKABLE", "ASSIGNED", "SUBMITTED", "COMPLETED", "CANCEL_REVIEW"];

describe("demo data", () => {
  it("has a job in every status and every trade", () => {
    const statuses = new Set(JOBS.map((job) => job.steps.at(-1)?.[0] ?? "REVIEW"));
    expect([...statuses].sort()).toEqual([...ALL_STATUSES].sort());
    expect([...new Set(JOBS.map((job) => job.category))].sort()).toEqual([...ALL_TRADES].sort());
  });

  it("uses clearly fake @demo.test people in Invercargill", () => {
    for (const person of Object.values(PEOPLE)) {
      expect(person.email).toMatch(/^[a-z]+@demo\.test$/);
      expect(person.lastName).toMatch(/^Demo-/);
    }
    for (const address of Object.values(ADDRESSES)) expect(address.city).toBe("Invercargill");
  });

  it("keeps every demo photo small and in the repo, for uploads (#96) to send later", () => {
    for (const photo of JOBS.flatMap((job) => job.photos)) {
      const file = path.resolve("prisma/seed/photos", photo.file);
      expect(existsSync(file), photo.file).toBe(true);
      expect(readFileSync(file).byteLength).toBeLessThan(50_000);
    }
  });

  it("builds example prices that add up and respect the minimum time", () => {
    const priced = examplePricing({ minutes: 30, materialsCents: 1000 }, "ELECTRICAL");
    expect(priced.minutes).toBe(120);
    expect(priced.workerGrossCents).toBe(14000);
    expect(priced.priceCents).toBe(
      priced.workerGrossCents +
        priced.holidayPayCents +
        priced.onCostCents +
        priced.materialsCents +
        priced.marginCents +
        priced.gstCents,
    );
    expect(examplePricing({ minutes: 30, materialsCents: 0 }, "OTHER").minutes).toBe(60);
  });

  it("gives every money row its own fixed id and clearly fake test-mode payment references", () => {
    const ids = JOBS.flatMap((job) => {
      const money = moneyIds(job.id);
      return [money.payment, money.payout, money.variation(0), money.variation(1)];
    });
    expect(new Set([...ids, ...JOBS.map((job) => job.id)]).size).toBe(ids.length + JOBS.length);
    for (const job of JOBS) {
      const refs = testPaymentRefs(job.id);
      expect(refs.checkoutId).toMatch(/^cs_test_DEMO_/);
      expect(refs.paymentId).toMatch(/^pi_test_DEMO_/);
      expect(refs.idempotencyKey).toMatch(/^demo-/);
    }
  });

  it("has an assigned job with extra work waiting to be priced", () => {
    const assigned = JOBS.filter((job) => job.steps.at(-1)?.[0] === "ASSIGNED" && job.extraWork?.length);
    expect(assigned).toHaveLength(1);
    expect(assigned[0].extraWork?.[0]).toMatchObject({ by: assigned[0].worker, minutes: 90 });
  });
});

describe("no hard-coded demo password", () => {
  // Built from parts so this file doesn't match itself.
  const VARIABLE = ["SEED", "DEMO", "PASSWORD"].join("_");
  const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter((file) => file && existsSync(file) && !/\.(webp|jpe?g|png|gif|pdf|ico|woff2?|ttf)$/i.test(file));

  it("leaves SEED_DEMO_PASSWORD empty in .env.example", () => {
    expect(readFileSync(".env.example", "utf8")).toMatch(new RegExp(`^${VARIABLE}=$`, "m"));
  });

  it("never gives SEED_DEMO_PASSWORD a value in a tracked file", () => {
    const withValue = new RegExp(`${VARIABLE}=[^\\s<]`);
    const offenders = tracked.filter((file) => withValue.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("has no password in the seed code, and not the old prototype's either", () => {
    const seedFiles = tracked.filter((file) => file.startsWith("prisma/seed"));
    expect(seedFiles.length).toBeGreaterThan(0);
    for (const file of seedFiles) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/password\s*[:=]\s*["'`][^"'`]+["'`]/i);
      expect(text, file).not.toMatch(/demo-password/i);
    }
  });
});

describe("Supabase Auth users", () => {
  type Call = { method: string; id?: string; attributes?: Record<string, unknown> };

  function fakeAdmin(existing: { id: string; email: string }[] = []) {
    const calls: Call[] = [];
    const users = [...existing];
    return {
      calls,
      admin: {
        async listUsers({ page }: { page: number; perPage: number }) {
          return { data: { users: page === 1 ? [...users] : [] }, error: null };
        },
        async createUser(attributes: Record<string, unknown>) {
          calls.push({ method: "createUser", attributes });
          const user = { id: attributes.id as string, email: attributes.email as string };
          users.push(user);
          return { data: { user }, error: null };
        },
        async updateUserById(id: string, attributes: Record<string, unknown>) {
          calls.push({ method: "updateUserById", id, attributes });
          return { data: { user: { id } }, error: null };
        },
      },
    };
  }

  it("creates each demo user with the password from the environment, email confirmed", async () => {
    const { admin, calls } = fakeAdmin();
    const auth = supabaseAuthUsers(admin, "from-the-env-123");
    expect(await auth.ensureUser(PEOPLE.customer)).toBe(PEOPLE.customer.id);
    expect(calls).toEqual([
      {
        method: "createUser",
        attributes: expect.objectContaining({
          id: PEOPLE.customer.id,
          email: "customer@demo.test",
          password: "from-the-env-123",
          email_confirm: true,
        }),
      },
    ]);
  });

  it("updates an existing demo user instead of making a second one, keeping their id", async () => {
    const { admin, calls } = fakeAdmin([{ id: "11111111-1111-4111-8111-111111111111", email: "Customer@Demo.test" }]);
    const auth = supabaseAuthUsers(admin, "from-the-env-123");
    expect(await auth.ensureUser(PEOPLE.customer)).toBe("11111111-1111-4111-8111-111111111111");
    expect(calls.map((call) => call.method)).toEqual(["updateUserById"]);
    expect(calls[0].attributes).toMatchObject({ password: "from-the-env-123", email_confirm: true });
  });

  it("stops with the Supabase error rather than seeding half the people", async () => {
    const { admin } = fakeAdmin();
    admin.createUser = async () => ({ data: { user: null as never }, error: { message: "Email rate limit" } } as never);
    await expect(supabaseAuthUsers(admin, "from-the-env-123").ensureUser(PEOPLE.office)).rejects.toThrow(
      /office@demo\.test: Email rate limit/,
    );
  });
});

describe.skipIf(!testDatabaseUrl)("npm run db:seed against Postgres", () => {
  const schema = useTestSchema(import.meta.filename);
  let db: pg.Client;

  beforeAll(async () => {
    db = new pg.Client({ connectionString: testDatabaseUrl });
    await db.connect();
    await db.query(`SET search_path TO "${schema.name}"`);
  });

  afterAll(async () => {
    await db?.end();
  });

  async function counts() {
    const result: Record<string, number> = {};
    for (const table of TABLES) {
      const { rows } = await db.query(`SELECT count(*)::int AS n FROM ${table}`);
      result[table] = rows[0].n;
    }
    return result;
  }

  async function snapshot() {
    const { rows } = await db.query(
      `SELECT j.id, j.job_number, j.status, j.category, j.worker_id, j.price_cents, j.booked_date, j.booked_time,
         (SELECT array_agg(path ORDER BY position) FROM job_photos p WHERE p.job_id = j.id) AS photos
       FROM jobs j ORDER BY j.job_number`,
    );
    const money = await db.query(
      `SELECT 'payment' AS row, id, job_id, kind::text || ':' || status::text AS what, amount_cents AS cents,
         refunded_cents AS other_cents, coalesce(provider_payment_id, '') || '|' || coalesce(provider_checkout_id, '')
           || '|' || idempotency_key || '|' || livemode AS detail
       FROM payments
       UNION ALL
       SELECT 'payout', id, job_id, status::text, gross_cents, holiday_pay_cents,
         worker_id || '|' || minutes || '|' || rate_cents FROM payouts
       UNION ALL
       SELECT 'variation', id, job_id, status::text, requested_materials_cents, requested_minutes,
         requested_by_id || '|' || description FROM variations
       UNION ALL
       SELECT 'materials', job_id, job_id, '', budget_cents, spent_cents, coalesce(receipt_path, '') FROM job_materials
       ORDER BY row, id`,
    );
    return { jobs: rows, money: money.rows };
  }

  it("seeds the same rows when run twice, with no duplicates", async () => {
    await seedDemoData({ db, auth: plainAuthUsers(db) });
    const first = await counts();
    const firstJobs = await snapshot();

    await seedDemoData({ db, auth: plainAuthUsers(db) });
    expect(await counts()).toEqual(first);
    expect(await snapshot()).toEqual(firstJobs);

    expect(first).toMatchObject({
      profiles: 4,
      worker_profiles: 2,
      licences: 1,
      addresses: 2,
      jobs: JOBS.length,
      // One per paid job (five) and the pending one on the priced job.
      payments: 6,
      variations: 1,
      payouts: 1,
      job_materials: 3,
      settings: 1,
    });
  });

  it("has a paid test-mode payment for every paid job's price, and a pending one for the priced job", async () => {
    const { rows } = await db.query(
      `SELECT j.status::text AS job_status, j.price_cents, p.kind::text AS kind, p.status::text AS status,
         p.amount_cents, p.refunded_cents, p.livemode, p.provider_payment_id, p.provider_checkout_id, p.paid_at
       FROM jobs j LEFT JOIN payments p ON p.job_id = j.id ORDER BY j.job_number`,
    );
    const paid = rows.filter((row) => PAID_STATUSES.includes(row.job_status));
    expect(paid.map((row) => row.job_status).sort()).toEqual([...PAID_STATUSES].sort());
    for (const row of paid) {
      expect(row, row.job_status).toMatchObject({ kind: "JOB", status: "PAID", refunded_cents: 0, livemode: false });
      expect(row.amount_cents, row.job_status).toBe(row.price_cents);
      expect(row.provider_payment_id).toMatch(/^pi_test_DEMO_/);
      expect(row.provider_checkout_id).toMatch(/^cs_test_DEMO_/);
      expect(row.paid_at).toBeInstanceOf(Date);
    }
    const pending = rows.filter((row) => row.status === "PENDING");
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ job_status: "PRICED", kind: "JOB", provider_payment_id: null, paid_at: null });
    expect(pending[0].amount_cents).toBe(pending[0].price_cents);
    const unpaid = rows.filter((row) => !PAID_STATUSES.includes(row.job_status) && row.job_status !== "PRICED");
    for (const row of unpaid) expect(row.kind, row.job_status).toBeNull();
  });

  it("has the assigned job's extra work asked for by its worker, waiting for the office to price it", async () => {
    const { rows } = await db.query(
      `SELECT j.status::text AS job_status, v.requested_by_id = j.worker_id AS by_worker, v.status::text AS status,
         v.description, v.requested_minutes, v.requested_materials_cents, v.price_cents, v.priced_at
       FROM variations v JOIN jobs j ON j.id = v.job_id`,
    );
    expect(rows).toEqual([
      {
        job_status: "ASSIGNED",
        by_worker: true,
        status: "REQUESTED",
        description: expect.stringMatching(/hob cable is nicked.*12 m/),
        requested_minutes: 90,
        requested_materials_cents: 9500,
        price_cents: null,
        priced_at: null,
      },
    ]);
  });

  it("queues the completed job's payout at exactly the worker pay it was priced with", async () => {
    const { rows } = await db.query(
      `SELECT j.status::text AS job_status, o.worker_id = j.worker_id AS to_worker, o.status::text AS status,
         o.minutes = p.minutes AS minutes, o.rate_cents = p.worker_rate_cents AS rate,
         o.gross_cents = p.worker_gross_cents AS gross, o.holiday_pay_cents = p.holiday_pay_cents AS holiday_pay,
         o.gross_cents, o.holiday_pay_cents
       FROM payouts o JOIN jobs j ON j.id = o.job_id JOIN job_pricing p ON p.job_id = j.id`,
    );
    expect(rows).toEqual([
      {
        job_status: "COMPLETED",
        to_worker: true,
        status: "QUEUED",
        minutes: true,
        rate: true,
        gross: true,
        holiday_pay: true,
        gross_cents: 14000,
        holiday_pay_cents: 1120,
      },
    ]);
  });

  it("gives claimed jobs the materials budget they were priced with, and the spend once submitted", async () => {
    const { rows } = await db.query(
      `SELECT j.status::text AS job_status, m.budget_cents = p.materials_cents AS budget_as_priced,
         m.spent_cents IS NOT NULL AS spent, m.spent_at IS NOT NULL AS spent_at
       FROM job_materials m JOIN jobs j ON j.id = m.job_id JOIN job_pricing p ON p.job_id = j.id
       ORDER BY j.job_number`,
    );
    expect(rows).toEqual([
      { job_status: "ASSIGNED", budget_as_priced: true, spent: false, spent_at: false },
      { job_status: "SUBMITTED", budget_as_priced: true, spent: true, spent_at: true },
      { job_status: "COMPLETED", budget_as_priced: true, spent: true, spent_at: true },
    ]);
  });

  it("leaves the settings row the migration made as it was", async () => {
    const { rows } = await db.query("SELECT id, shared_rate_cents, other_rate_cents, updated_by_id FROM settings");
    expect(rows).toEqual([{ id: 1, shared_rate_cents: 7000, other_rate_cents: 3800, updated_by_id: null }]);
  });

  it("seeds again after the money has moved on: refunded, extra work paid for, payout exported and paid", async () => {
    const before = await counts();
    const beforeRows = await snapshot();
    const assigned = JOBS.find((job) => job.extraWork?.length);
    const completed = JOBS.find((job) => job.steps.at(-1)?.[0] === "COMPLETED");
    const cancelled = JOBS.find((job) => job.steps.at(-1)?.[0] === "CANCEL_REVIEW");
    if (!assigned || !completed || !cancelled) throw new Error("demo jobs missing");
    const variation = moneyIds(assigned.id).variation(0);

    // What the app would do next: the office prices the extra work, the customer approves and pays for it, the
    // cancelled job is refunded and payroll pays the worker. Each of these makes the rows harder to remove.
    await db.query(
      `UPDATE variations SET status = 'PRICED', minutes = 90, materials_cents = 9500, worker_gross_cents = 10500,
         holiday_pay_cents = 840, on_cost_cents = 473, margin_cents = 4263, gst_cents = 3836, price_cents = 29412
       WHERE id = $1`,
      [variation],
    );
    await db.query("UPDATE variations SET status = 'APPROVED' WHERE id = $1", [variation]);
    await db.query(
      `INSERT INTO payments (job_id, kind, variation_id, amount_cents, status, provider_payment_id, idempotency_key,
         paid_at)
       VALUES ($1, 'VARIATION', $2, 29412, 'PAID', 'pi_test_DEMO_extra', 'demo-test-extra', now())`,
      [assigned.id, variation],
    );
    await db.query(
      "UPDATE payments SET status = 'REFUNDED', refunded_cents = amount_cents, refunded_at = now() WHERE id = $1",
      [moneyIds(cancelled.id).payment],
    );
    await db.query("UPDATE payouts SET status = 'EXPORTED', exported_at = now() WHERE id = $1", [
      moneyIds(completed.id).payout,
    ]);
    await db.query("UPDATE payouts SET status = 'PAID', paid_at = now() WHERE id = $1", [moneyIds(completed.id).payout]);

    // The money rows really do stop their jobs (and the extra work) from being deleted on their own.
    await expect(db.query("DELETE FROM jobs WHERE id = $1", [completed.id])).rejects.toThrow(/foreign key/);
    await expect(db.query("DELETE FROM jobs WHERE id = $1", [assigned.id])).rejects.toThrow(/foreign key/);

    await seedDemoData({ db, auth: plainAuthUsers(db) });
    expect(await counts()).toEqual(before);
    expect(await snapshot()).toEqual(beforeRows);
  });

  it("has a job in every status, across all five trades", async () => {
    const { rows } = await db.query("SELECT DISTINCT status::text AS status, category::text AS category FROM jobs");
    expect([...new Set(rows.map((row) => row.status))].sort()).toEqual([...ALL_STATUSES].sort());
    expect([...new Set(rows.map((row) => row.category))].sort()).toEqual([...ALL_TRADES].sort());
  });

  it("makes the four demo people with the right roles and checks", async () => {
    const { rows } = await db.query(
      `SELECT p.email, p.role::text AS role, w.verified_at IS NOT NULL AS verified,
         (SELECT array_agg(trade::text || ':' || status::text) FROM licences l WHERE l.user_id = p.id) AS licences,
         (SELECT array_agg(trade::text) FROM worker_trades t WHERE t.user_id = p.id) AS trades
       FROM profiles p LEFT JOIN worker_profiles w ON w.user_id = p.id ORDER BY p.email`,
    );
    expect(rows).toEqual([
      { email: "customer@demo.test", role: "CUSTOMER", verified: false, licences: null, trades: null },
      { email: "office@demo.test", role: "ADMIN", verified: false, licences: null, trades: null },
      { email: "tradie@demo.test", role: "TRADIE", verified: true, licences: ["ELECTRICAL:VERIFIED"], trades: ["ELECTRICAL"] },
      { email: "worker@demo.test", role: "TRADIE", verified: false, licences: null, trades: ["OTHER"] },
    ]);
  });

  it("gives each job what its status would have", async () => {
    const { rows } = await db.query(
      `SELECT j.status::text AS status, j.price_cents, j.worker_id, j.booked_date,
         (SELECT count(*)::int FROM job_photos p WHERE p.job_id = j.id) AS photos,
         (SELECT count(*)::int FROM job_pricing p WHERE p.job_id = j.id) AS pricing,
         (SELECT count(*)::int FROM job_status_history h WHERE h.job_id = j.id) AS history
       FROM jobs j`,
    );
    for (const job of rows) {
      expect(job.photos, job.status).toBeGreaterThan(0);
      const paidOrPriced = !["REVIEW", "QUOTE_BOUNTY", "CANCELLED"].includes(job.status);
      expect(job.price_cents !== null, job.status).toBe(paidOrPriced);
      expect(job.pricing, job.status).toBe(paidOrPriced ? 1 : 0);
      const claimed = ["ASSIGNED", "SUBMITTED", "COMPLETED"].includes(job.status);
      expect(job.worker_id !== null, job.status).toBe(claimed);
      expect(job.booked_date !== null, job.status).toBe(claimed);
      expect(job.history, job.status).toBeGreaterThan(0);
    }
  });

  it("records who moved each job, through the status-history trigger", async () => {
    const { rows } = await db.query(
      `SELECT h.from_status::text AS "from", h.to_status::text AS "to", p.email
       FROM job_status_history h JOIN jobs j ON j.id = h.job_id LEFT JOIN profiles p ON p.id = h.changed_by_id
       WHERE j.status = 'COMPLETED' ORDER BY h.created_at`,
    );
    expect(rows).toEqual([
      { from: null, to: "REVIEW", email: "customer@demo.test" },
      { from: "REVIEW", to: "PRICED", email: "office@demo.test" },
      { from: "PRICED", to: "BOOKABLE", email: "customer@demo.test" },
      { from: "BOOKABLE", to: "ASSIGNED", email: "tradie@demo.test" },
      { from: "ASSIGNED", to: "SUBMITTED", email: "tradie@demo.test" },
      { from: "SUBMITTED", to: "COMPLETED", email: "customer@demo.test" },
    ]);
  });

  it("doesn't count photos posted with a job as an edit", async () => {
    const { rows } = await db.query("SELECT count(*)::int AS n FROM jobs WHERE edited_at IS NOT NULL");
    expect(rows[0].n).toBe(0);
  });

  it("leaves rows that aren't demo data alone", async () => {
    const otherId = "22222222-2222-4222-8222-222222222222";
    await db.query("INSERT INTO auth.users (id, email) VALUES ($1, 'someone@example.com') ON CONFLICT DO NOTHING", [
      otherId,
    ]);
    await db.query("INSERT INTO profiles (id, email, first_name) VALUES ($1, 'someone@example.com', 'Someone')", [
      otherId,
    ]);
    await db.query(
      `INSERT INTO jobs (customer_id, category, title, description, address_line1, suburb, city)
       VALUES ($1, 'OTHER', 'Not demo', 'Kept', '1 Test St', 'Waikiwi', 'Invercargill')`,
      [otherId],
    );
    const before = await counts();
    await seedDemoData({ db, auth: plainAuthUsers(db) });
    expect(await counts()).toEqual(before);
    const { rows } = await db.query("SELECT count(*)::int AS n FROM jobs WHERE title = 'Not demo'");
    expect(rows[0].n).toBe(1);
  });
});
