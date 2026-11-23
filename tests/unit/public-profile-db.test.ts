import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadPublicProfile } from "@/server/workers/public-profile";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

describe.skipIf(!testDatabaseUrl)("public tradie profile", () => {
  const schema = useTestSchema(import.meta.filename);
  const now = new Date("2026-11-23T02:00:00Z");
  async function person(role: "CUSTOMER" | "TRADIE" | "ADMIN") {
    const id = randomUUID(), email = `${id}@example.test`;
    await schema.db.$executeRaw`INSERT INTO auth.users(id,email) VALUES(${id}::uuid,${email})`;
    await schema.db.profile.create({ data: {
      id, email, role, firstName: role === "TRADIE" ? "Jack" : "Sarah", lastName: "Wilson",
      createdAt: new Date("2023-12-31T12:30:00Z"),
    } });
    return id;
  }

  it("returns the same absence for every ineligible profile", async () => {
    const worker = await person("TRADIE"), customer = await person("CUSTOMER");
    for (const id of [worker, customer, randomUUID(), "not-a-uuid"]) {
      expect(await loadPublicProfile(schema.db, id, now)).toBeNull();
    }
    await schema.db.workerProfile.create({ data: { userId: worker } });
    expect(await loadPublicProfile(schema.db, worker, now)).toBeNull();
    await schema.db.workerProfile.update({ where: { userId: worker }, data: { verifiedAt: now, pausedAt: now } });
    expect(await loadPublicProfile(schema.db, worker, now)).toBeNull();
  });

  it("publishes only the approved fields, counts all visible ratings and limits reviews to the newest ten", async () => {
    const worker = await person("TRADIE"), customer = await person("CUSTOMER"), office = await person("ADMIN");
    await schema.db.workerProfile.create({ data: { userId: worker, bio: "Electrical work.", verifiedAt: now, baseSuburb: "Private suburb" } });
    for (const trade of ["ELECTRICAL", "PLUMBING", "GAS", "OTHER"] as const) {
      await schema.db.workerTrade.create({ data: { userId: worker, trade } });
      if (trade === "ELECTRICAL" || trade === "PLUMBING") {
        await schema.db.licence.create({ data: { userId: worker, trade, status: "VERIFIED", number: "Private licence",
          checkedAt: now, checkedById: office, expiresOn: new Date(trade === "ELECTRICAL" ? "2026-11-23" : "2026-11-22") } });
      }
    }
    expect(await loadPublicProfile(schema.db, worker, now)).toEqual({
      name: "Jack W.", avatarUrl: null, city: "Invercargill", joined: 2024, trades: ["ELECTRICAL", "OTHER"],
      rating: null, jobs: 0, reviewCount: 0, reviews: [], bio: "Electrical work.",
    });
    for (let day = 1; day <= 12; day++) {
      const job = await schema.db.job.create({ data: { workerId: worker, customerId: customer, category: "OTHER",
        status: "COMPLETED", priceCents: 10000, title: `Job ${day}`, description: "Private detail", suburb: "Private", city: "Private", addressLine1: "Private" } });
      await schema.db.review.create({ data: { workerId: worker, reviewerId: customer, jobId: job.id,
        comment: day === 12 ? "Hidden" : `Comment ${day}`, rating: day === 1 ? 1 : 5, createdAt: new Date(Date.UTC(2026, 10, day)),
        ...(day === 12 ? { hiddenAt: now, hiddenById: office, hiddenReason: "Private moderation" } : {}) } });
    }
    const result = await loadPublicProfile(schema.db, worker, now);
    expect(result).toEqual({
      name: "Jack W.", avatarUrl: null, city: "Invercargill", joined: 2024, trades: ["ELECTRICAL", "OTHER"],
      rating: 4.6, jobs: 12, reviewCount: 11, bio: "Electrical work.",
      reviews: Array.from({ length: 10 }, (_, i) => ({ month: "2026-11", rating: 5, customer: "Sarah", job: `Job ${11-i}`, comment: `Comment ${11-i}` })),
    });
  });
});
