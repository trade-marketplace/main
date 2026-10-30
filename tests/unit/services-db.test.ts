import { describe, expect, it } from "vitest";

import { saveServiceWaitlist } from "@/server/services";

import { testDatabaseUrl, useTestSchema } from "../support/test-db";

describe.skipIf(!testDatabaseUrl)("service waitlist persistence", () => {
  const schema = useTestSchema(import.meta.filename);
  it("persists and deduplicates each trade independently, including simultaneous requests", async () => {
    const submit = (trade: string, suburb = "Invercargill") => saveServiceWaitlist({ email: "person@example.test", suburb, trade }, () => schema.db);
    expect(await submit("other")).toEqual({ status: "joined" });
    expect(await submit("gas")).toEqual({ status: "joined" });
    expect(await submit("other", "INVERCARGILL")).toEqual({ status: "already-on-list" });
    expect((await Promise.all([submit("electrical"), submit("electrical")])).map((r) => r.status).sort()).toEqual(["already-on-list", "joined"]);
    expect(await schema.db.serviceWaitlistEntry.count()).toBe(3);
    expect(await schema.db.waitlistEntry.count()).toBe(0);
  });
  it("has RLS and zero public policies for private subscriber data", async () => {
    expect(await schema.db.$queryRawUnsafe(`SELECT c.relrowsecurity, (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid WHERE n.nspname = $1 AND c.relname = 'service_waitlist_entries'`, schema.name)).toEqual([{ relrowsecurity: true, policies: 0n }]);
    await schema.db.$executeRawUnsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_waitlist_client') THEN CREATE ROLE service_waitlist_client NOLOGIN; END IF; END $$`);
    await schema.db.$executeRawUnsafe(`GRANT USAGE ON SCHEMA "${schema.name}" TO service_waitlist_client`);
    await schema.db.$executeRawUnsafe(`GRANT SELECT, INSERT ON "${schema.name}".service_waitlist_entries TO service_waitlist_client`);
    expect(await schema.db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE service_waitlist_client");
      return tx.$queryRawUnsafe(`SELECT * FROM "${schema.name}".service_waitlist_entries`);
    })).toEqual([]);
    await expect(schema.db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE service_waitlist_client");
      await tx.$executeRawUnsafe(`INSERT INTO "${schema.name}".service_waitlist_entries (email, suburb, suburb_key, trade) VALUES ('blocked@example.test', 'Invercargill', 'invercargill', 'OTHER')`);
    })).rejects.toThrow(/row-level security/);
  });
});
