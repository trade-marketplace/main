import { randomUUID } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import type { Role, Trade } from "@/generated/prisma/client";
import { loadService, saveServiceWaitlist } from "@/server/services";

import { testDatabaseUrl, useTestSchema } from "../support/test-db";

describe.skipIf(!testDatabaseUrl)("public service reviews in PostgreSQL", () => {
  const schema = useTestSchema(import.meta.filename);
  let customerId: string, workerId: string;
  let visible: { id: string; rating: number; comment: string };

  async function person(role: Role) {
    const id = randomUUID();
    await schema.db.$executeRawUnsafe("INSERT INTO auth.users (id) VALUES ($1::uuid)", id);
    await schema.db.profile.create({ data: { id, role, firstName: "Aroha", lastName: "PrivateSurname", email: `${id}@example.test` } });
    return id;
  }

  async function review(category: Trade, comment: string | null, createdAt: Date, hidden = false) {
    const job = await schema.db.job.create({ data: {
      customerId, workerId, category, title: "Service review fixture", description: "Completed local test work",
      addressLine1: "1 Example Street", suburb: "Windsor", city: "Invercargill", status: "COMPLETED", priceCents: 12000,
    } });
    return schema.db.review.create({ data: {
      jobId: job.id, reviewerId: customerId, workerId, rating: 5, comment, createdAt,
      ...(hidden ? { hiddenAt: createdAt, hiddenReason: "Hidden test review" } : {}),
    } });
  }

  beforeAll(async () => {
    customerId = await person("CUSTOMER");
    workerId = await person("TRADIE");
    const row = await review("ELECTRICAL", "The lights work well.", new Date("2026-11-01T10:00:00Z"));
    visible = { id: row.id, rating: row.rating, comment: row.comment! };
    // Newer excluded rows ensure moderation/comment filters run before the limit.
    await review("ELECTRICAL", "Hidden words", new Date("2026-11-02T10:00:00Z"), true);
    await review("ELECTRICAL", null, new Date("2026-11-03T10:00:00Z"));
  });

  it("loads a visible commented review for electrical, and not plumbing", async () => {
    const electrical = await loadService("electrical", schema.db);
    expect(electrical.reviews).toContainEqual({ ...visible, name: "Aroha" });
    expect(electrical.reviewsUnavailable).not.toBe(true);
    expect((await loadService("plumbing", schema.db)).reviews).toEqual([]);
  });

  it("excludes hidden reviews and reviews without a comment", async () => {
    expect((await loadService("electrical", schema.db)).reviews).toEqual([{ ...visible, name: "Aroha" }]);
  });

  it("returns only the reviewer's first name and no personal ids or contact details", async () => {
    const data = await loadService("electrical", schema.db);
    expect(data.reviews).toEqual([{ ...visible, name: "Aroha" }]);
    const publicData = JSON.stringify(data.reviews);
    for (const privateValue of ["PrivateSurname", "@example.test", customerId, workerId, "reviewerId", "workerId", "email"])
      expect(publicData).not.toContain(privateValue);
  });

  it("keeps the newest three reviews in a deterministic order", async () => {
    const rows = [];
    for (let day = 1; day <= 4; day++) rows.push(await review("GAS", `Review ${day}`, new Date(`2026-11-0${day}T10:00:00Z`)));
    expect((await loadService("gas", schema.db)).reviews.map(row => row.id)).toEqual(rows.slice(1).reverse().map(row => row.id));
  });
});

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
