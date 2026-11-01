import { describe, expect, it } from "vitest";

import { saveWaitlist } from "@/server/waitlist";

import { testDatabaseUrl, useTestSchema } from "../support/test-db";

describe.skipIf(!testDatabaseUrl)("waitlist persistence in an isolated schema", () => {
  const schema = useTestSchema(import.meta.filename);
  it("stores email and suburb, deduplicates repeated and simultaneous requests, and retains the first entry", async () => {
    const submit = (email: string, suburb: string) => saveWaitlist({ email, suburb }, () => schema.db);
    expect(await submit(" First@Example.test ", " Wellington ")).toEqual({ status: "joined" });
    const first = await schema.db.waitlistEntry.findFirstOrThrow();
    expect(first).toMatchObject({ email: "first@example.test", suburb: "Wellington", suburbKey: "wellington" });
    expect(await submit("first@example.test", "WELLINGTON")).toEqual({ status: "already-on-list" });
    expect(await schema.db.waitlistEntry.findUnique({ where: { id: first.id } })).toEqual(first);
    const race = await Promise.all([submit("race@example.test", "Lower Hutt"), submit("RACE@example.test", "lower   hutt")]);
    expect(race.map((result) => result.status).sort()).toEqual(["already-on-list", "joined"]);
    expect(await schema.db.waitlistEntry.count()).toBe(2);
    expect(await submit("first@example.test", "Dunedin")).toEqual({ status: "joined" });
  });
  it("has RLS enabled and no policies granting client access to private waitlist records", async () => {
    const rows = await schema.db.$queryRawUnsafe<{ relrowsecurity: boolean; policies: bigint }[]>(
      `SELECT c.relrowsecurity, (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
       FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid WHERE n.nspname = $1 AND c.relname = 'waitlist_entries'`, schema.name);
    expect(rows).toEqual([{ relrowsecurity: true, policies: 0n }]);
    await schema.db.$executeRawUnsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'waitlist_client') THEN CREATE ROLE waitlist_client NOLOGIN; END IF; END $$`);
    await schema.db.$executeRawUnsafe(`GRANT USAGE ON SCHEMA "${schema.name}" TO waitlist_client`);
    await schema.db.$executeRawUnsafe(`GRANT SELECT, INSERT ON "${schema.name}".waitlist_entries TO waitlist_client`);
    expect(await schema.db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE waitlist_client");
      return tx.$queryRawUnsafe(`SELECT * FROM "${schema.name}".waitlist_entries`);
    })).toEqual([]);
    await expect(schema.db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE waitlist_client");
      await tx.$executeRawUnsafe(`INSERT INTO "${schema.name}".waitlist_entries (email, suburb, suburb_key) VALUES ('blocked@example.test', 'Dunedin', 'dunedin')`);
    })).rejects.toThrow(/row-level security/);
  });
});
