import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DEFAULT_BOARD_QUERY } from "@/lib/job-board";
import { loadJobBoard } from "@/server/jobs/board";
import { loadWorkArea, saveWorkArea, setAvailable } from "@/server/workers/area";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

const input = { baseSuburb: "Windsor", radiusKm: 10, point: { lat: -46.39, lng: 168.36 } };
describe.skipIf(!testDatabaseUrl)("work area commands (Postgres)", () => {
  const schema = useTestSchema(import.meta.filename);
  async function person(role: "TRADIE" | "CUSTOMER" | "ADMIN" = "TRADIE") {
    const id = randomUUID(); await schema.db.$executeRaw`INSERT INTO auth.users(id) VALUES (${id}::uuid)`;
    await schema.db.profile.create({ data: { id, role, email: `${id}@example.test`, firstName: "Test", emailVerifiedAt: new Date() } });
    if (role === "TRADIE") await schema.db.workerProfile.create({ data: { userId: id, baseSuburb: "Invercargill", areaLat: -46.4132, areaLng: 168.3538, areaRadiusKm: 25, available: true } });
    return { userId: id, role };
  }
  it("saves all four area columns with one audit and uses the new area on the next board load", async () => {
    const viewer = await person(), office = await person("ADMIN");
    await schema.db.workerProfile.update({ where: { userId: viewer.userId }, data: { identityCheckedAt: new Date(), identityCheckedById: office.userId } });
    const owner = await person("CUSTOMER");
    const job = await schema.db.job.create({ data: { customerId: owner.userId, category: "OTHER", status: "BOOKABLE", title: "Hang a door", description: "Hang a door", addressLine1: "1 Example Street", suburb: "Invercargill", city: "Invercargill", lat: -46.56, lng: 168.3538, approxLat: -46.5585, approxLng: 168.3538, priceCents: 20_000, anyTime: true } });
    const before = await loadJobBoard(schema.db, viewer, DEFAULT_BOARD_QUERY);
    expect(before).toMatchObject({ ok: true, board: { cards: [{ id: job.id }], meta: { areaName: "Invercargill", maxDistanceKm: 25 } } });
    expect(await saveWorkArea(schema.db, viewer, input)).toMatchObject({ ok: true, snapshot: input });
    expect(await schema.db.workerProfile.findUnique({ where: { userId: viewer.userId } })).toMatchObject({ baseSuburb: "Windsor", areaLat: -46.39, areaLng: 168.36, areaRadiusKm: 10 });
    const audits = await schema.db.auditLog.findMany({ where: { actorId: viewer.userId } });
    expect(audits).toHaveLength(1); expect(audits[0]).toMatchObject({ action: "worker.area_updated", before: { baseSuburb: "Invercargill", radiusKm: 25 }, after: { baseSuburb: "Windsor", radiusKm: 10 } });
    expect(JSON.stringify(audits)).not.toMatch(/areaLat|areaLng|168\.36|-46\.39/);
    expect(await loadJobBoard(schema.db, viewer, DEFAULT_BOARD_QUERY)).toMatchObject({ ok: true, board: { cards: [], total: 0, meta: { areaName: "Windsor", maxDistanceKm: 10 } } });
  });
  it("refuses radius 30 and an unselected suburb without writes", async () => {
    const viewer = await person();
    expect(await saveWorkArea(schema.db, viewer, { ...input, radiusKm: 30 })).toMatchObject({ ok: false, error: "invalid" });
    expect(await saveWorkArea(schema.db, viewer, { ...input, point: null })).toMatchObject({ ok: false, error: "invalid" });
    expect(await schema.db.auditLog.count({ where: { actorId: viewer.userId } })).toBe(0);
  });
  it("refuses a customer, stale role, missing worker and paused tradie for both writes", async () => {
    const customer = await person("CUSTOMER"), paused = await person(), stale = await person("CUSTOMER"), missing = await person();
    await schema.db.workerProfile.update({ where: { userId: paused.userId }, data: { pausedAt: new Date() } });
    await schema.db.workerProfile.delete({ where: { userId: missing.userId } });
    for (const viewer of [customer, paused, { ...stale, role: "TRADIE" as const }, missing]) {
      expect(await saveWorkArea(schema.db, viewer, input)).toEqual({ ok: false, error: "forbidden" });
      expect(await setAvailable(schema.db, viewer, false)).toEqual({ ok: false, error: "forbidden" });
      expect(await schema.db.auditLog.count({ where: { actorId: viewer.userId } })).toBe(0);
    }
    expect(await loadWorkArea(schema.db, paused)).toMatchObject({ paused: true });
    expect(await loadWorkArea(schema.db, customer)).toBeNull();
  });
  it("writes one audit for each availability off/on update and leaves the area intact", async () => {
    const viewer = await person();
    expect(await setAvailable(schema.db, viewer, false)).toMatchObject({ ok: true, snapshot: { available: false } });
    expect(await setAvailable(schema.db, viewer, true)).toMatchObject({ ok: true, snapshot: { available: true } });
    const rows = await schema.db.auditLog.findMany({ where: { actorId: viewer.userId }, orderBy: { createdAt: "asc" } });
    expect(rows).toHaveLength(2); expect(rows.map(row => row.action)).toEqual(["worker.availability_changed", "worker.availability_changed"]);
    expect(rows[0]).toMatchObject({ before: { available: true }, after: { available: false } });
    expect(rows[1]).toMatchObject({ before: { available: false }, after: { available: true } });
    expect(await loadWorkArea(schema.db, viewer)).toMatchObject({ baseSuburb: "Invercargill", radiusKm: 25 });
  });
  it("returns only checked, current trades and Other without exposing licence details", async () => {
    const viewer = await person(), office = await person("ADMIN");
    await schema.db.workerTrade.createMany({ data: ["OTHER", "ELECTRICAL", "PLUMBING", "GAS"].map(trade => ({ userId: viewer.userId, trade: trade as "OTHER" | "ELECTRICAL" | "PLUMBING" | "GAS" })) });
    for (const trade of ["ELECTRICAL", "PLUMBING", "GAS"] as const) await schema.db.licence.create({ data: { userId: viewer.userId, trade, number: "Private licence number", status: trade === "PLUMBING" ? "PENDING" : "VERIFIED", expiresOn: new Date(trade === "GAS" ? "2000-01-01" : "2030-01-01"), checkedAt: trade === "PLUMBING" ? null : new Date(), checkedById: trade === "PLUMBING" ? null : office.userId } });
    const snapshot = await loadWorkArea(schema.db, viewer);
    expect(snapshot?.trades.sort()).toEqual(["ELECTRICAL", "OTHER"]);
    expect(JSON.stringify(snapshot)).not.toContain("Private licence number");
  });
  it("refuses enabling availability without a saved point, permits turning it off, then enables after an area save", async () => {
    const viewer = await person();
    await schema.db.workerProfile.update({ where: { userId: viewer.userId }, data: { areaLat: null, areaLng: null } });
    expect(await setAvailable(schema.db, viewer, true)).toMatchObject({ ok: false, error: "invalid", fields: { baseSuburb: expect.any(String) } });
    expect(await schema.db.auditLog.count({ where: { actorId: viewer.userId } })).toBe(0);
    expect(await setAvailable(schema.db, viewer, false)).toMatchObject({ ok: true, snapshot: { available: false } });
    expect(await setAvailable(schema.db, viewer, true)).toMatchObject({ ok: false, error: "invalid" });
    expect(await schema.db.auditLog.count({ where: { actorId: viewer.userId } })).toBe(1);
    await saveWorkArea(schema.db, viewer, input);
    expect(await setAvailable(schema.db, viewer, true)).toMatchObject({ ok: true, snapshot: { available: true } });
  });
});
