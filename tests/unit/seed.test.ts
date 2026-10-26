import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ADDRESSES, examplePricing, JOBS, PEOPLE } from "../../prisma/seed/data.mjs";
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
];

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
    return rows;
  }

  it("seeds the same rows when run twice, with no duplicates", async () => {
    await seedDemoData({ db, auth: plainAuthUsers(db) });
    const first = await counts();
    const firstJobs = await snapshot();

    await seedDemoData({ db, auth: plainAuthUsers(db) });
    expect(await counts()).toEqual(first);
    expect(await snapshot()).toEqual(firstJobs);

    expect(first).toMatchObject({ profiles: 4, worker_profiles: 2, licences: 1, addresses: 2, jobs: JOBS.length });
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
