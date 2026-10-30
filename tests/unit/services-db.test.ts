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
  });
});
