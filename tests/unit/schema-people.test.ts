import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { Role } from "@/generated/prisma/client";
import { decryptField, encryptField, lastDigits } from "@/server/crypto";

import { testDatabaseUrl, useTestSchema } from "../support/test-db";

// Schema 1 (#86): users, roles, worker profiles, trades, licences, addresses and payroll details.

describe.skipIf(!testDatabaseUrl)("Schema 1: people", () => {
  const schema = useTestSchema(import.meta.filename);

  /** Makes a Supabase Auth user (the stand-in table on plain Postgres) and its profile. */
  async function createPerson(email: string, role: Role = "CUSTOMER") {
    const id = randomUUID();
    await schema.db.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, id, email);
    return schema.db.profile.create({ data: { id, email, role, firstName: "Test" } });
  }

  async function createWorker(email: string, trades: ("ELECTRICAL" | "PLUMBING" | "GAS" | "CONSTRUCTION" | "OTHER")[]) {
    const worker = await createPerson(email, "TRADIE");
    await schema.db.workerProfile.create({ data: { userId: worker.id } });
    await schema.db.workerTrade.createMany({ data: trades.map((trade) => ({ userId: worker.id, trade })) });
    return worker;
  }

  const email = () => `${randomUUID()}@example.nz`;

  describe("the migration", () => {
    it("runs on a fresh database and creates every table", async () => {
      const tables = await schema.db.$queryRawUnsafe<{ table_name: string }[]>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name`,
        schema.name,
      );
      expect(tables.map((row) => row.table_name)).toEqual(
        expect.arrayContaining([
          "_prisma_migrations",
          "addresses",
          "licences",
          "payroll_details",
          "profiles",
          "worker_profiles",
          "worker_trades",
        ]),
      );
    });

    it("has indexes for logging in by email and finding workers by trade and area", async () => {
      const indexes = await schema.db.$queryRawUnsafe<{ indexdef: string }[]>(
        `SELECT indexdef FROM pg_indexes WHERE schemaname = $1`,
        schema.name,
      );
      const definitions = indexes.map((row) => row.indexdef.replaceAll(`"${schema.name}".`, "").replaceAll(`${schema.name}.`, ""));
      expect(definitions).toContainEqual(expect.stringMatching(/UNIQUE INDEX profiles_email_key ON profiles .*\(email\)/));
      expect(definitions).toContainEqual(expect.stringMatching(/INDEX worker_trades_trade_idx ON worker_trades .*\(trade\)/));
      expect(definitions).toContainEqual(
        expect.stringMatching(/INDEX worker_profiles_available_area_lat_area_lng_idx ON worker_profiles .*\(available, area_lat, area_lng\)/),
      );
    });

    it("turns row-level security on for every table, Prisma's own included", async () => {
      const tables = await schema.db.$queryRawUnsafe<{ relname: string; relrowsecurity: boolean }[]>(
        `SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = $1 AND c.relkind = 'r'`,
        schema.name,
      );
      expect(tables.map((table) => table.relname)).toEqual(expect.arrayContaining(["_prisma_migrations", "profiles"]));
      expect(tables.filter((table) => !table.relrowsecurity)).toEqual([]);
    });
  });

  describe("profiles", () => {
    it("stores an email typed with capitals and spaces lowercased", async () => {
      const id = randomUUID();
      await schema.db.$executeRawUnsafe(`INSERT INTO auth.users (id) VALUES ($1::uuid)`, id);
      const person = await schema.db.profile.create({
        data: { id, email: "  Sam.Smith@Example.NZ ", firstName: "Sam" },
      });
      expect((await schema.db.profile.findUniqueOrThrow({ where: { id: person.id } })).email).toBe("sam.smith@example.nz");
    });

    it("lowercases an email changed later too", async () => {
      const person = await createPerson(email());
      await schema.db.profile.update({ where: { id: person.id }, data: { email: "Changed@Example.NZ" } });
      expect((await schema.db.profile.findUniqueOrThrow({ where: { id: person.id } })).email).toBe("changed@example.nz");
    });

    it("treats the same email in different capitals as taken", async () => {
      await createPerson("taken@example.nz");
      await expect(createPerson("TAKEN@Example.nz")).rejects.toThrow(/Unique constraint failed/);
    });

    it("finds a person by email when logging in", async () => {
      const person = await createPerson("login@example.nz");
      expect(await schema.db.profile.findUnique({ where: { email: "login@example.nz" } })).toMatchObject({ id: person.id });
    });

    it("starts everyone as a customer unless a role is given", async () => {
      const id = randomUUID();
      await schema.db.$executeRawUnsafe(`INSERT INTO auth.users (id) VALUES ($1::uuid)`, id);
      expect(await schema.db.profile.create({ data: { id, email: email(), firstName: "Ana" } })).toMatchObject({
        role: "CUSTOMER",
        emailVerifiedAt: null,
      });
    });

    it("needs a Supabase Auth user", async () => {
      // The trigger raises a foreign key error, so callers handle it like any other missing parent row.
      await expect(schema.db.profile.create({ data: { id: randomUUID(), email: email(), firstName: "Ghost" } })).rejects.toThrow(
        /Foreign key constraint/,
      );
    });

    it("is deleted, with everything that belongs to it, when the Supabase Auth user is deleted", async () => {
      const worker = await createWorker(email(), ["ELECTRICAL"]);
      await schema.db.licence.create({ data: { userId: worker.id, trade: "ELECTRICAL", number: "EW 123456" } });
      await schema.db.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = $1::uuid`, worker.id);
      expect(await schema.db.profile.findUnique({ where: { id: worker.id } })).toBeNull();
      expect(await schema.db.workerProfile.findUnique({ where: { userId: worker.id } })).toBeNull();
      expect(await schema.db.licence.count({ where: { userId: worker.id } })).toBe(0);
    });

    it("only accepts a phone number in international format", async () => {
      const person = await createPerson(email());
      await schema.db.profile.update({ where: { id: person.id }, data: { phone: "+64211234567" } });
      await expect(schema.db.profile.update({ where: { id: person.id }, data: { phone: "021 123 4567" } })).rejects.toThrow(
        /profiles_phone_e164/,
      );
    });

    it("updates updated_at even when changed outside Prisma", async () => {
      // Prisma and Docker Postgres can have different clocks (#346). A fixed initial timestamp proves the
      // database trigger advances the value without comparing the application clock with the database clock.
      const id = randomUUID();
      await schema.db.$executeRawUnsafe(`INSERT INTO auth.users (id) VALUES ($1::uuid)`, id);
      const person = await schema.db.profile.create({
        data: { id, email: email(), firstName: "Test", updatedAt: new Date("2000-01-01T00:00:00Z") },
      });
      await schema.db.$executeRawUnsafe(`UPDATE "${schema.name}".profiles SET first_name = 'Changed' WHERE id = $1::uuid`, person.id);
      const after = await schema.db.profile.findUniqueOrThrow({ where: { id: person.id } });
      expect(after.updatedAt.getTime()).toBeGreaterThan(person.updatedAt.getTime());
    });
  });

  describe("workers, trades and licences", () => {
    it("keeps a separate licence status for each trade", async () => {
      const office = await createPerson(email(), "ADMIN");
      const worker = await createWorker(email(), ["ELECTRICAL", "PLUMBING", "OTHER"]);
      await schema.db.licence.create({
        data: {
          userId: worker.id,
          trade: "ELECTRICAL",
          number: "EW 123456",
          type: "Registered electrician",
          status: "VERIFIED",
          checkedById: office.id,
          checkedAt: new Date(),
          expiresOn: new Date("2028-03-31"),
        },
      });
      await schema.db.licence.create({ data: { userId: worker.id, trade: "PLUMBING", number: "PGDB 98765" } });

      const licences = await schema.db.licence.findMany({ where: { userId: worker.id }, orderBy: { trade: "asc" } });
      expect(licences.map(({ trade, status }) => ({ trade, status }))).toEqual([
        { trade: "ELECTRICAL", status: "VERIFIED" },
        { trade: "PLUMBING", status: "PENDING" },
      ]);
    });

    it("has one licence per worker per trade", async () => {
      const worker = await createWorker(email(), ["GAS"]);
      await schema.db.licence.create({ data: { userId: worker.id, trade: "GAS", number: "G 1" } });
      await expect(schema.db.licence.create({ data: { userId: worker.id, trade: "GAS", number: "G 2" } })).rejects.toThrow(
        /Unique constraint failed/,
      );
    });

    it("only takes a licence for a trade the worker does", async () => {
      const worker = await createWorker(email(), ["ELECTRICAL"]);
      await expect(schema.db.licence.create({ data: { userId: worker.id, trade: "GAS", number: "G 1" } })).rejects.toThrow(
        /Foreign key constraint/,
      );
    });

    it("never takes a licence for Other work", async () => {
      const worker = await createWorker(email(), ["OTHER"]);
      await expect(schema.db.licence.create({ data: { userId: worker.id, trade: "OTHER", number: "N/A" } })).rejects.toThrow(
        /licences_not_other/,
      );
    });

    it("needs a reason to reject a licence, and a time for any decision", async () => {
      const worker = await createWorker(email(), ["ELECTRICAL"]);
      const licence = await schema.db.licence.create({ data: { userId: worker.id, trade: "ELECTRICAL", number: "EW 1" } });
      await expect(
        schema.db.licence.update({ where: { id: licence.id }, data: { status: "REJECTED", checkedAt: new Date() } }),
      ).rejects.toThrow(/licences_rejection_has_reason/);
      await expect(schema.db.licence.update({ where: { id: licence.id }, data: { status: "VERIFIED" } })).rejects.toThrow(
        /licences_checked_when_decided/,
      );
      await schema.db.licence.update({
        where: { id: licence.id },
        data: { status: "REJECTED", checkedAt: new Date(), rejectionReason: "Number doesn't match the register" },
      });
    });

    it("removes a trade's licence when the worker stops doing that trade", async () => {
      const worker = await createWorker(email(), ["ELECTRICAL", "PLUMBING"]);
      await schema.db.licence.create({ data: { userId: worker.id, trade: "PLUMBING", number: "P 1" } });
      await schema.db.workerTrade.delete({ where: { userId_trade: { userId: worker.id, trade: "PLUMBING" } } });
      expect(await schema.db.licence.count({ where: { userId: worker.id } })).toBe(0);
    });

    it("finds available workers by trade", async () => {
      const worker = await createWorker(email(), ["CONSTRUCTION"]);
      await schema.db.workerProfile.update({
        where: { userId: worker.id },
        data: { available: true, baseSuburb: "Waikiwi", areaLat: -46.38, areaLng: 168.35, areaRadiusKm: 25 },
      });
      const found = await schema.db.workerTrade.findMany({
        where: { trade: "CONSTRUCTION", user: { workerProfile: { available: true } } },
      });
      expect(found.map((row) => row.userId)).toContain(worker.id);
    });

    it("starts workers unavailable, unverified and not a quoter", async () => {
      const worker = await createWorker(email(), ["OTHER"]);
      expect(await schema.db.workerProfile.findUniqueOrThrow({ where: { userId: worker.id } })).toMatchObject({
        available: false,
        verifiedAt: null,
        isQuoter: false,
      });
    });

    it("rejects a work area with only half a location", async () => {
      const worker = await createWorker(email(), ["OTHER"]);
      await expect(schema.db.workerProfile.update({ where: { userId: worker.id }, data: { areaLat: -46.4 } })).rejects.toThrow(
        /worker_profiles_area_point/,
      );
    });
  });

  describe("addresses", () => {
    it("allows several addresses but only one default", async () => {
      const person = await createPerson(email());
      const base = { userId: person.id, suburb: "Gladstone", city: "Invercargill" };
      await schema.db.address.create({ data: { ...base, line1: "1 Example St", isDefault: true } });
      await schema.db.address.create({ data: { ...base, line1: "2 Example St" } });
      await expect(schema.db.address.create({ data: { ...base, line1: "3 Example St", isDefault: true } })).rejects.toThrow(
        /Unique constraint failed/,
      );
    });
  });

  describe("payroll details", () => {
    const env = { FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64") };

    it("stores the IRD number and bank account encrypted, with only the last digits readable", async () => {
      const worker = await createWorker(email(), ["OTHER"]);
      const ird = "123-456-789";
      const bank = "12-3456-7890123-00";
      await schema.db.payrollDetails.create({
        data: {
          userId: worker.id,
          irdNumberEncrypted: encryptField(ird, `payroll_details.ird_number:${worker.id}`, env),
          irdNumberLast3: lastDigits(ird, 3),
          bankAccountEncrypted: encryptField(bank, `payroll_details.bank_account:${worker.id}`, env),
          bankAccountLast4: lastDigits(bank, 4),
          taxCode: "M",
          kiwiSaverRatePct: 3,
        },
      });

      const [raw] = await schema.db.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT * FROM "${schema.name}".payroll_details WHERE user_id = $1::uuid`,
        worker.id,
      );
      expect(JSON.stringify(raw)).not.toMatch(/123-?456-?789|7890123/);
      expect(raw).toMatchObject({ ird_number_last3: "789", bank_account_last4: "2300" });
      expect(decryptField(raw.bank_account_encrypted as string, `payroll_details.bank_account:${worker.id}`, env)).toBe(bank);
      expect(decryptField(raw.ird_number_encrypted as string, `payroll_details.ird_number:${worker.id}`, env)).toBe(ird);
    });

    it("won't store a bank account without its masked digits, or digits in the clear field that aren't digits", async () => {
      const worker = await createWorker(email(), ["OTHER"]);
      await expect(
        schema.db.payrollDetails.create({ data: { userId: worker.id, bankAccountEncrypted: "v1.a.b.c" } }),
      ).rejects.toThrow(/payroll_details_bank_pair/);
      await expect(
        schema.db.payrollDetails.create({
          data: { userId: worker.id, bankAccountEncrypted: "v1.a.b.c", bankAccountLast4: "12-3" },
        }),
      ).rejects.toThrow(/payroll_details_bank_last4/);
    });
  });

  describe("row-level security (Supabase Data API)", () => {
    // Plays the part of Supabase's `authenticated` role: a role without the owner's bypass, with the same grants.
    // `null` is a visitor who isn't signed in: their token has no user id.
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

    it("lets a signed-in person read their own rows and nobody else's", async () => {
      const me = await createWorker(email(), ["ELECTRICAL"]);
      const someoneElse = await createWorker(email(), ["ELECTRICAL"]);
      await schema.db.licence.createMany({
        data: [
          { userId: me.id, trade: "ELECTRICAL", number: "EW 1" },
          { userId: someoneElse.id, trade: "ELECTRICAL", number: "EW 2" },
        ],
      });

      const seen = await asSignedIn(me.id, async (sql) => ({
        profiles: await sql(`SELECT id FROM {schema}.profiles`),
        workers: await sql(`SELECT user_id FROM {schema}.worker_profiles`),
        trades: await sql(`SELECT user_id FROM {schema}.worker_trades`),
        licences: await sql(`SELECT user_id FROM {schema}.licences`),
      }));
      expect(seen).toEqual({
        profiles: [{ id: me.id }],
        workers: [{ user_id: me.id }],
        trades: [{ user_id: me.id }],
        licences: [{ user_id: me.id }],
      });
    });

    it("never shows payroll details, not even your own", async () => {
      const me = await createWorker(email(), ["OTHER"]);
      await schema.db.payrollDetails.create({ data: { userId: me.id, taxCode: "M" } });
      expect(await asSignedIn(me.id, (sql) => sql(`SELECT * FROM {schema}.payroll_details`))).toEqual([]);
    });

    it("shows nothing to someone who isn't signed in", async () => {
      await createPerson(email());
      expect(await asSignedIn(null, (sql) => sql(`SELECT id FROM {schema}.profiles`))).toEqual([]);
    });

    it("doesn't let anyone change their own role through the Data API", async () => {
      const me = await createPerson(email());
      await asSignedIn(me.id, (sql) => sql(`UPDATE {schema}.profiles SET role = 'ADMIN' WHERE id = '${me.id}' RETURNING id`)).then(
        (rows) => expect(rows).toEqual([]),
      );
      expect((await schema.db.profile.findUniqueOrThrow({ where: { id: me.id } })).role).toBe("CUSTOMER");
    });

    it("doesn't let anyone add rows through the Data API", async () => {
      const me = await createPerson(email());
      await expect(
        asSignedIn(me.id, (sql) =>
          sql(`INSERT INTO {schema}.addresses (user_id, line1, suburb, city) VALUES ('${me.id}', '1 A St', 'Avenal', 'Invercargill')`),
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });
});
