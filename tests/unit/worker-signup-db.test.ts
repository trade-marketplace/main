import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { WorkerSignupDetails } from "@/lib/auth/worker-signup";
import { prismaProfiles } from "@/server/auth/profiles";

import { testDatabaseUrl, useTestSchema } from "../support/test-db";

describe.skipIf(!testDatabaseUrl)("worker signup persistence", () => {
  const schema = useTestSchema(import.meta.filename);
  const store = () => prismaProfiles(() => schema.db);
  async function worker() {
    const id = randomUUID();
    const email = `${id}@example.test`;
    await schema.db.$executeRawUnsafe("INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)", id, email);
    await store().create({ id, email, role: "TRADIE", firstName: "Example", lastName: "Worker", phone: "+64215550192", emailVerifiedAt: null });
    return id;
  }
  const other: WorkerSignupDetails = { trades: ["OTHER"], licences: {}, baseSuburb: "Invercargill", radiusKm: 25, point: null };

  it("Other creates no licence, no badge, no availability and allows a manually typed suburb", async () => {
    const id = await worker();
    await store().ensureWorker!(id, other);
    expect(await schema.db.workerProfile.findUniqueOrThrow({ where: { userId: id } })).toMatchObject({ baseSuburb: "Invercargill", areaRadiusKm: 25, areaLat: null, areaLng: null, available: false, verifiedAt: null, isQuoter: false });
    expect(await schema.db.workerTrade.findMany({ where: { userId: id } })).toHaveLength(1);
    expect(await schema.db.licence.count({ where: { userId: id } })).toBe(0);
  });

  it("multi-trade signup is idempotent, stores coordinates and creates pending restricted licences", async () => {
    const id = await worker();
    const details: WorkerSignupDetails = { ...other, trades: ["ELECTRICAL", "GAS", "OTHER"], licences: { ELECTRICAL: "E 12345", GAS: "44120" }, radiusKm: 50, point: { lat: -46.391, lng: 168.367 } };
    await store().ensureWorker!(id, details);
    await store().ensureWorker!(id, details);
    expect(await schema.db.workerTrade.count({ where: { userId: id } })).toBe(3);
    expect(await schema.db.licence.findMany({ where: { userId: id }, orderBy: { trade: "asc" } })).toEqual([
      expect.objectContaining({ trade: "ELECTRICAL", status: "PENDING", checkedAt: null, checkedById: null }),
      expect.objectContaining({ trade: "GAS", status: "PENDING", checkedAt: null, checkedById: null }),
    ]);
    expect(await schema.db.workerProfile.findUniqueOrThrow({ where: { userId: id } })).toMatchObject({ areaLat: -46.391, areaLng: 168.367, areaRadiusKm: 50, available: false, verifiedAt: null });
    // Edited user metadata on a later login cannot overwrite existing worker settings or licence decisions.
    await store().ensureWorker!(id, { ...other, baseSuburb: "Changed" });
    expect(await schema.db.workerTrade.count({ where: { userId: id } })).toBe(3);
    expect(await schema.db.workerProfile.findUniqueOrThrow({ where: { userId: id } })).toMatchObject({ baseSuburb: "Invercargill", areaRadiusKm: 50 });
  });
});
