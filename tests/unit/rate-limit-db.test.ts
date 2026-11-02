import { describe, expect, it } from "vitest";

import { check, consume, prismaRateLimitStore } from "@/server/rate-limit";

import { testDatabaseUrl, useTestSchema } from "../support/test-db";

describe.skipIf(!testDatabaseUrl)("rate limits in a migrated disposable schema (#111)", () => {
  const schema = useTestSchema(import.meta.filename);
  it("counts simultaneous tries exactly, stores no address, and clears finished windows", async () => {
    const store = prismaRateLimitStore(schema.db);
    const deps = { store, now: () => Date.UTC(2026, 10, 2, 10, 0, 0), secret: "s" };
    const results = await Promise.all(Array.from({ length: 12 }, () => consume("areaWaitlist", "ip:203.0.113.9", deps)));
    expect(results.filter((r) => r.allowed)).toHaveLength(10);
    expect((await check("areaWaitlist", "ip:203.0.113.9", deps)).allowed).toBe(false);
    const rows = await schema.db.rateLimitBucket.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ count: 12 });
    expect(JSON.stringify(rows)).not.toContain("203.0.113.9");
    await store.purge(new Date(Date.UTC(2026, 10, 2, 12, 0, 0)));
    expect(await schema.db.rateLimitBucket.count()).toBe(0);
  });
  it("has RLS enabled with no policies, and rejects keys that aren't digests", async () => {
    const rows = await schema.db.$queryRawUnsafe<{ relrowsecurity: boolean; policies: bigint }[]>(`SELECT c.relrowsecurity, (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid WHERE n.nspname = $1 AND c.relname = 'rate_limit_buckets'`, schema.name);
    expect(rows).toEqual([{ relrowsecurity: true, policies: 0n }]);
    await expect(schema.db.rateLimitBucket.create({ data: { key: "203.0.113.9", windowStart: new Date(), expiresAt: new Date() } })).rejects.toThrow();
  });
});
