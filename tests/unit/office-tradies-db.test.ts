import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Role, Trade } from "@/generated/prisma/client";
import { loadTrades } from "@/server/account/trades";
import { lockLicenceDocuments } from "@/server/account/licence-documents";
import { decideTradie, licenceReviewVersion } from "@/server/office/tradie-commands";
import { loadOfficeTradies } from "@/server/office/tradies";
import { isVerified, WORKER_VERIFICATION_SELECT } from "@/server/workers/verification";
import { canClaim, WORKER_ELIGIBILITY_SELECT, type EligibilityJob } from "@/server/workers/eligibility";
import { approximatePin } from "@/server/geo/approximate";
import { tradiesQuery } from "@/lib/office-tradies";
import { inboxItem } from "@/server/notifications/inbox";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

const NOW = new Date("2026-11-05T00:00:00Z");
describe.skipIf(!testDatabaseUrl)("office per-trade decisions (database)", () => {
  const schema = useTestSchema(import.meta.filename);
  async function person(role: Role, name = "Jack") {
    const id = randomUUID(); await schema.db.$executeRaw`INSERT INTO auth.users(id) VALUES(${id}::uuid)`;
    await schema.db.profile.create({ data: { id, role, firstName: name, lastName: "Wilson", email: `${id}@example.test`, emailVerifiedAt: NOW, phone: "+64211234567", phoneVerifiedAt: NOW, phoneVerifiedFor: "+64211234567" } });
    return { userId: id };
  }
  async function fixture(trades: Trade[] = ["ELECTRICAL", "GAS"]) {
    const office = await person("ADMIN", "Matt"), worker = await person("TRADIE");
    await schema.db.workerProfile.create({ data: { userId: worker.userId, identityCheckedAt: NOW, identityCheckedById: office.userId, baseSuburb: "Windsor", areaLat: -46.4132, areaLng: 168.3538, areaRadiusKm: 25 } });
    for (const trade of trades) {
      await schema.db.workerTrade.create({ data: { userId: worker.userId, trade } });
      if (trade !== "OTHER") await schema.db.licence.create({ data: { userId: worker.userId, trade, number: trade === "ELECTRICAL" ? "E 220981" : "PGDB 44120", expiresOn: new Date("2027-03-31"), documentPath: `licences/${worker.userId}/${"a".repeat(32)}.webp` } });
    }
    return { office, worker };
  }
  async function decision(f: Awaited<ReturnType<typeof fixture>>, trade: Exclude<Trade, "OTHER"> = "ELECTRICAL") {
    const row = await schema.db.licence.findUniqueOrThrow({ where: { userId_trade: { userId: f.worker.userId, trade } } });
    return { kind: "approve" as const, userId: f.worker.userId, trade, version: licenceReviewVersion(row), note: "Checked the current official register" };
  }
  it("approves exactly one trade, keeps the other pending, audits the note and notifies the licence owner", async () => {
    const f = await fixture(), input = await decision(f);
    expect(await decideTradie(schema.db, f.office, input, NOW)).toEqual({ ok: true });
    const read = await loadTrades(schema.db, f.worker.userId, NOW);
    expect(read.rows.find(row => row.trade === "ELECTRICAL")?.licence?.status).toBe("VERIFIED"); expect(read.rows.find(row => row.trade === "GAS")?.licence?.status).toBe("PENDING");
    const worker = await schema.db.profile.findUniqueOrThrow({ where: { id: f.worker.userId }, select: WORKER_VERIFICATION_SELECT });
    expect(isVerified(worker, "ELECTRICAL", NOW)).toBe(true); expect(isVerified(worker, "GAS", NOW)).toBe(false); expect(isVerified(worker, undefined, NOW)).toBe(false);
    const audit = await schema.db.auditLog.findFirstOrThrow({ where: { action: "licence.verified", actorId: f.office.userId } }); expect(audit.reason).toBe(input.note);
    const notice = await schema.db.notification.findFirstOrThrow({ where: { userId: f.worker.userId, type: "licence.verified" } }); expect(inboxItem(notice).href).toBe("/profile/trades"); expect(JSON.stringify(notice.payload)).not.toContain(input.note);
    const page = await loadOfficeTradies(schema.db, f.office, tradiesQuery({ tab: "verified", selected: `${f.worker.userId}:ELECTRICAL` }), NOW);
    expect(page.rows.some(row => row.id === `${f.worker.userId}:ELECTRICAL`)).toBe(true); expect(page.selected?.verifiedBadge).toBe(true); expect(page.selected?.timeline[0].note).toBe(input.note);
    expect(JSON.stringify(page)).not.toContain(`licences/${f.worker.userId}/`);
  });
  it("requires both a private decision note and a public rejection reason, shown by the existing worker reader", async () => {
    const f = await fixture(), input = await decision(f), reason = "Please upload the current licence card.";
    expect(await decideTradie(schema.db, f.office, { ...input, kind: "reject", reason: " " }, NOW)).toEqual({ ok: false, error: "invalid" });
    expect(await decideTradie(schema.db, f.office, { ...input, kind: "reject", reason, note: "Checked by phone with regulator" }, NOW)).toEqual({ ok: true });
    const read = await loadTrades(schema.db, f.worker.userId, NOW); expect(read.rows.find(row => row.trade === "ELECTRICAL")?.licence?.rejectionReason).toBe(reason); expect(JSON.stringify(read)).not.toContain("Checked by phone");
    const detail = (await loadOfficeTradies(schema.db, f.office, tradiesQuery({ selected: `${f.worker.userId}:ELECTRICAL` }), NOW)).selected!;
    expect(detail.timeline[0]).toMatchObject({ note: "Checked by phone with regulator", reason });
    await expect(loadOfficeTradies(schema.db, f.worker, tradiesQuery({ selected: detail.id }), NOW)).rejects.toMatchObject({ code: "forbidden" });
  });
  it("rechecks current office membership and rejects forged fields or Other approvals", async () => {
    const f = await fixture(), input = await decision(f);
    expect(await decideTradie(schema.db, f.worker, input, NOW)).toEqual({ ok: false, error: "forbidden" });
    for (const extra of [{ status: "VERIFIED" }, { checkedById: f.office.userId }, { documentPath: "malicious" }, { trade: "OTHER" }]) expect(await decideTradie(schema.db, f.office, { ...input, ...extra }, NOW)).toEqual({ ok: false, error: "invalid" });
    await schema.db.profile.update({ where: { id: f.office.userId }, data: { role: "CUSTOMER" } }); expect(await decideTradie(schema.db, f.office, input, NOW)).toEqual({ ok: false, error: "forbidden" });
    await expect(loadOfficeTradies(schema.db, f.office, tradiesQuery({}), NOW)).rejects.toMatchObject({ code: "forbidden" });
  });
  it("does not approve unknown/expired expiry and gives Other no invented licence requirement", async () => {
    const f = await fixture(["ELECTRICAL", "OTHER"]);
    for (const expiresOn of [null, new Date("2026-11-03")]) {
      await schema.db.licence.update({ where: { userId_trade: { userId: f.worker.userId, trade: "ELECTRICAL" } }, data: { expiresOn } });
      expect(await decideTradie(schema.db, f.office, await decision(f), NOW)).toEqual({ ok: false, error: "expiry" });
    }
    const page = await loadOfficeTradies(schema.db, f.office, tradiesQuery({ tab: "verified", selected: `${f.worker.userId}:OTHER` }), NOW);
    expect(page.rows.some(row => row.id === `${f.worker.userId}:OTHER`)).toBe(true); expect(page.selected).toMatchObject({ status: "No licence needed", licence: null });
  });
  it("serializes duplicate decisions and refuses a replaced submission instead of approving unseen evidence", async () => {
    const f = await fixture(), input = await decision(f);
    const pair = await Promise.all([decideTradie(schema.db, f.office, input, NOW), decideTradie(schema.db, f.office, input, NOW)]);
    expect(pair).toEqual(expect.arrayContaining([{ ok: true }, { ok: false, error: "stale" }]));
    const licence = await schema.db.licence.findUniqueOrThrow({ where: { userId_trade: { userId: f.worker.userId, trade: "ELECTRICAL" } } });
    expect(await schema.db.auditLog.count({ where: { recordId: licence.id, action: "licence.verified" } })).toBe(1);
    const gasInput = await decision(f, "GAS"); let release!: () => void, locked!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { locked = resolve; });
    const replacing = schema.db.$transaction(async tx => { await lockLicenceDocuments(tx, f.worker.userId); await tx.licence.update({ where: { userId_trade: { userId: f.worker.userId, trade: "GAS" } }, data: { documentPath: `licences/${f.worker.userId}/${"b".repeat(32)}.webp` } }); locked(); await gate; });
    await ready; const reviewing = decideTradie(schema.db, f.office, gasInput, NOW); release(); await replacing;
    expect(await reviewing).toEqual({ ok: false, error: "stale" }); expect((await schema.db.licence.findUniqueOrThrow({ where: { userId_trade: { userId: f.worker.userId, trade: "GAS" } } })).status).toBe("PENDING");
  });
  it("pauses across all trades immediately, prevents stale duplicate changes, and records an unpause reason", async () => {
    const f = await fixture(); await decideTradie(schema.db, f.office, await decision(f), NOW);
    const centre = { lat: -46.4132, lng: 168.3538 }, pin = approximatePin(centre, () => 0.5);
    const job: EligibilityJob = { id: randomUUID(), customerId: randomUUID(), workerId: null, status: "BOOKABLE", category: "ELECTRICAL", anyTime: true, timeWindows: [], lat: centre.lat, lng: centre.lng, approxLat: pin.lat, approxLng: pin.lng };
    expect(canClaim(await schema.db.profile.findUniqueOrThrow({ where: { id: f.worker.userId }, select: WORKER_ELIGIBILITY_SELECT }), job, { now: NOW })).toBe(true);
    const request = { kind: "pause", userId: f.worker.userId, expectedPausedAt: null, note: "Reviewing a reported concern" };
    const pair = await Promise.all([decideTradie(schema.db, f.office, request, NOW), decideTradie(schema.db, f.office, request, NOW)]);
    expect(pair).toEqual(expect.arrayContaining([{ ok: true }, { ok: false, error: "stale" }]));
    const worker = await schema.db.profile.findUniqueOrThrow({ where: { id: f.worker.userId }, select: WORKER_VERIFICATION_SELECT }); expect(isVerified(worker, "ELECTRICAL", NOW)).toBe(false);
    expect(canClaim(await schema.db.profile.findUniqueOrThrow({ where: { id: f.worker.userId }, select: WORKER_ELIGIBILITY_SELECT }), job, { now: NOW })).toBe(false);
    const page = await loadOfficeTradies(schema.db, f.office, tradiesQuery({ tab: "paused", q: "Jack Wilson" }), NOW); expect(page.rows.filter(row => row.userId === f.worker.userId)).toHaveLength(2);
    expect(await decideTradie(schema.db, f.office, { kind: "unpause", userId: f.worker.userId, expectedPausedAt: NOW.toISOString(), note: "Concern checked and resolved" }, NOW)).toEqual({ ok: true });
    expect((await schema.db.auditLog.findFirstOrThrow({ where: { recordId: f.worker.userId, action: "worker.unpaused" } })).reason).toBe("Concern checked and resolved");
    expect((await schema.db.workerProfile.findUniqueOrThrow({ where: { userId: f.worker.userId } })).pausedAt).toBeNull();
  });
  it("rolls back a licence decision and its audit when the durable notification cannot save", async () => {
    const f = await fixture(), input = await decision(f);
    await schema.db.$executeRawUnsafe(`CREATE FUNCTION "${schema.name}".refuse_licence_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END $$`);
    await schema.db.$executeRawUnsafe(`CREATE TRIGGER refuse_licence_notice BEFORE INSERT ON "${schema.name}".notifications FOR EACH ROW WHEN (NEW.type='licence.verified') EXECUTE FUNCTION "${schema.name}".refuse_licence_notice()`);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try { expect(await decideTradie(schema.db, f.office, input, NOW)).toEqual({ ok: false, error: "unavailable" }); } finally { log.mockRestore(); await schema.db.$executeRawUnsafe(`DROP TRIGGER refuse_licence_notice ON "${schema.name}".notifications`); }
    expect((await schema.db.licence.findUniqueOrThrow({ where: { userId_trade: { userId: f.worker.userId, trade: "ELECTRICAL" } } })).status).toBe("PENDING");
    expect(await schema.db.auditLog.count({ where: { actorId: f.office.userId, action: "licence.verified" } })).toBe(0);
    expect(await decideTradie(schema.db, f.office, input, NOW)).toEqual({ ok: true });
  });
  it("bounds list pages, keeps expiry order stable, and does not lose missing-licence rows", async () => {
    const office = await person("ADMIN", "Paging office");
    for (let index = 1; index <= 27; index++) {
      const worker = await person("TRADIE", `Paging ${index}`);
      await schema.db.workerProfile.create({ data: { userId: worker.userId, identityCheckedAt: NOW, identityCheckedById: office.userId } });
      await schema.db.workerTrade.create({ data: { userId: worker.userId, trade: "ELECTRICAL" } });
      await schema.db.licence.create({ data: { userId: worker.userId, trade: "ELECTRICAL", number: `E ${220000 + index}`, status: "VERIFIED", checkedAt: NOW, checkedById: office.userId, expiresOn: new Date(`2027-01-${String(index).padStart(2, "0")}`) } });
    }
    const query = { tab: "verified", q: "Paging", sort: "expiry" };
    const first = await loadOfficeTradies(schema.db, office, tradiesQuery(query), NOW), second = await loadOfficeTradies(schema.db, office, tradiesQuery({ ...query, page: "2" }), NOW);
    expect(first.total).toBe(27); expect(first.rows).toHaveLength(20); expect(second.rows).toHaveLength(7); expect(first.rows[0].expiry).toBe("2027-01-01"); expect(second.rows.at(-1)?.expiry).toBe("2027-01-27"); expect(new Set([...first.rows, ...second.rows].map(row => row.id)).size).toBe(27);
    const missing = await person("TRADIE", "Missing licence"); await schema.db.workerTrade.create({ data: { userId: missing.userId, trade: "GAS" } });
    const pending = await loadOfficeTradies(schema.db, office, tradiesQuery({ q: "Missing licence", selected: `${missing.userId}:GAS` }), NOW);
    expect(pending.rows).toHaveLength(1); expect(pending.selected).toMatchObject({ licence: null, status: "Checking", hasWorkerProfile: false });
  });
});
