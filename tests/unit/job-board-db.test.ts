import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobStatus, Role, Trade } from "@/generated/prisma/client";
import { DEFAULT_BOARD_QUERY, parseBoardQuery, type BoardPage, type BoardResult } from "@/lib/job-board";
import { loadJobBoard, newBoardJobs, type BoardDependencies } from "@/server/jobs/board";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

const NOW = new Date(Date.now() + 60_000), CENTRE = { lat: -46.4132, lng: 168.3538 };
const boardOf = (result: BoardResult): BoardPage => { expect(result.ok).toBe(true); if (!result.ok) throw Error(result.error); return result.board; };
describe.skipIf(!testDatabaseUrl)("eligible job board real PostgreSQL reader", () => {
  const schema = useTestSchema(import.meta.filename);
  beforeEach(async () => { await schema.db.job.deleteMany(); await schema.db.settings.updateMany({ data: { enabledTrades: ["ELECTRICAL", "PLUMBING", "GAS", "CONSTRUCTION", "OTHER"] } }); });
  async function person(role: Role = "CUSTOMER") {
    const id = randomUUID(); await schema.db.$executeRaw`INSERT INTO auth.users(id) VALUES(${id}::uuid)`;
    return schema.db.profile.create({ data: { id, role, email: `${id}@example.test`, firstName: "Example", phone: "+64211111111", emailVerifiedAt: new Date("2026-01-01") } });
  }
  async function worker() {
    const profile = await person("TRADIE"), office = await person("ADMIN");
    await schema.db.workerProfile.create({ data: { userId: profile.id, identityCheckedAt: new Date("2026-01-01"), identityCheckedById: office.id,
      baseSuburb: "Invercargill", areaLat: CENTRE.lat, areaLng: CENTRE.lng, areaRadiusKm: 50, available: false } });
    return { userId: profile.id, role: "TRADIE" as const };
  }
  async function job(options: { status?: JobStatus; category?: Trade; owner?: string; id?: string; shift?: number; asap?: boolean; anyTime?: boolean; at?: Date; noPin?: boolean } = {}) {
    const shift = options.shift ?? 0;
    return schema.db.job.create({ data: { id: options.id, customerId: options.owner ?? (await person()).id, category: options.category ?? "OTHER", status: options.status ?? "BOOKABLE",
      title: "Hang a door", description: "Call +64211111111 or secret@example.test", addressLine1: "1 Private Street", accessNotes: "Secret key code", suburb: "Windsor", city: "Invercargill",
      priceCents: 99_999, lat: CENTRE.lat + shift, lng: CENTRE.lng, approxLat: options.noPin ? null : CENTRE.lat + shift + .0015, approxLng: options.noPin ? null : CENTRE.lng,
      asap: options.asap ?? false, anyTime: options.anyTime ?? true, createdAt: options.at ?? new Date("2026-11-02T00:00:00Z"), updatedAt: options.at ?? new Date("2026-11-02T00:00:00Z") } });
  }
  async function price(jobId: string, amount: number) {
    await schema.db.jobPricing.create({ data: { jobId, workerRateCents: 6000, minMinutes: 60, holidayPayBps: 800, onCostBps: 2000, marginBps: 2000, gstBps: 1500, minutes: 60, materialsCents: 0,
      workerGrossCents: amount, holidayPayCents: 800, onCostCents: 1000, marginCents: 2000, gstCents: 1500 } });
  }
  const deps = () => ({ now: () => NOW, signPhoto: vi.fn<NonNullable<BoardDependencies["signPhoto"]>>(async () => "https://storage.example.test/signed-public-photo") });

  it("uses Other with ID/email and no phone/trade selection, exposes worker pay only, and sorts that frozen pay", async () => {
    const actor = await worker(), cheap = await job({ status: "REVIEW" }), high = await job({ status: "REVIEW" }), review = await job({ status: "REVIEW" }), bounty = await job({ status: "QUOTE_BOUNTY" });
    await price(cheap.id, 10_000); await price(high.id, 20_000); await price(review.id, 90_000); await price(bounty.id, 80_000);
    await schema.db.job.updateMany({ where: { id: { in: [cheap.id, high.id] } }, data: { status: "BOOKABLE" } });
    const board = boardOf(await loadJobBoard(schema.db, actor, { ...DEFAULT_BOARD_QUERY, sort: "earn" }, {}, deps()));
    expect(board.cards.slice(0, 2).map(card => card.id)).toEqual([high.id, cheap.id]);
    expect(board.cards.find(card => card.id === high.id)?.earnCents).toBe(20_800);
    expect(board.cards.filter(card => [review.id, bounty.id].includes(card.id)).map(card => card.earnCents)).toEqual([null, null]);
    expect(board.counts).toMatchObject({ all: 4, ready: 2, estimate: 2, bounty: 1 });
    const allEntry = boardOf(await loadJobBoard(schema.db, actor, { ...DEFAULT_BOARD_QUERY, sort: "earn", entry: "all" }, {}, deps()));
    expect(allEntry.cards.map(card => card.id)).toEqual(board.cards.map(card => card.id));
    expect(allEntry.counts).toEqual(board.counts); expect(allEntry.scope).toBe(board.scope);
    expect(JSON.stringify(board)).not.toMatch(/Private Street|Secret key|priceCents|margin|gstCents|workerGross|holidayPay|identityChecked|phoneVerified|secret@example|11111111/);
    expect(board.cards[0].point).toEqual({ lat: CENTRE.lat + .0015, lng: CENTRE.lng });
    expect(await schema.db.profile.findUnique({ where: { id: actor.userId } })).toMatchObject({ phoneVerifiedAt: null });
  });

  it("filters eligibility before counts, radius, categories and pages, including no own jobs or unchecked licences", async () => {
    const actor = await worker(), valid = await job(), own = await job({ owner: actor.userId });
    await job({ category: "ELECTRICAL" }); await job({ noPin: true }); await job({ shift: .6 });
    await job({ status: "PRICED" });
    const board = boardOf(await loadJobBoard(schema.db, actor, DEFAULT_BOARD_QUERY, {}, deps()));
    expect(board.cards.map(card => card.id)).toEqual([valid.id]); expect(board.total).toBe(1);
    expect(board.meta.trades.find(trade => trade.trade === "ELECTRICAL")).toMatchObject({ allowed: false, reason: "not verified" });
    expect(board.cards.some(card => card.id === own.id)).toBe(false);
    const narrow = boardOf(await loadJobBoard(schema.db, actor, { ...DEFAULT_BOARD_QUERY, trades: ["ELECTRICAL"] }, {}, deps()));
    expect(narrow.total).toBe(0);
    await schema.db.workerProfile.update({ where: { userId: actor.userId }, data: { pausedAt: NOW } });
    expect(boardOf(await loadJobBoard(schema.db, actor, DEFAULT_BOARD_QUERY, {}, deps()))).toMatchObject({ total: 0, meta: { blocked: "worker-paused" } });
  });

  it("passes an ineligible first database batch instead of returning a false empty state", async () => {
    const actor = await worker(), owner = await person();
    const base = await job({ owner: owner.id });
    const { id: _id, jobNumber: _number, ...data } = base; void _id; void _number;
    await schema.db.job.delete({ where: { id: base.id } });
    await schema.db.job.createMany({ data: Array.from({ length: 105 }, (_, i) => ({ ...data, id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, approxLat: data.lat! + .00001 })) });
    const valid = await job({ id: "ffffffff-ffff-4fff-8fff-ffffffffffff", owner: owner.id });
    const board = boardOf(await loadJobBoard(schema.db, actor, DEFAULT_BOARD_QUERY, {}, deps()));
    expect(board.total).toBe(1); expect(board.cards[0].id).toBe(valid.id);
  });

  it("paginates stable ties without duplicates even if the anchor disappears; current proof changes invalidate continuation", async () => {
    const actor = await worker(), owner = await person();
    for (let i = 0; i < 15; i++) await job({ owner: owner.id, id: `13800000-0000-4000-8000-${String(i).padStart(12, "0")}` });
    const first = boardOf(await loadJobBoard(schema.db, actor, DEFAULT_BOARD_QUERY, {}, deps()));
    expect(first.cards).toHaveLength(12); expect(first.nextCursor).not.toBeNull();
    await schema.db.job.delete({ where: { id: first.cards.at(-1)!.id } });
    const next = boardOf(await loadJobBoard(schema.db, actor, DEFAULT_BOARD_QUERY, { cursor: first.nextCursor }, deps()));
    expect(next.cards).toHaveLength(3); expect(next.cards.some(card => first.cards.some(previous => previous.id === card.id))).toBe(false);
    await schema.db.workerProfile.update({ where: { userId: actor.userId }, data: { areaRadiusKm: 10 } });
    expect(await loadJobBoard(schema.db, actor, DEFAULT_BOARD_QUERY, { cursor: first.nextCursor }, deps())).toEqual({ ok: false, error: "changed" });
  });

  it("signs photos only on final eligible cards, never candidates or update polling, and survives unavailable storage", async () => {
    const actor = await worker(), owner = await person(), signer = deps();
    for (let i = 0; i < 14; i++) {
      const row = await job({ owner: owner.id });
      await schema.db.jobPhoto.create({ data: { jobId: row.id, path: `private/${row.id}.jpg`, position: 0 } });
    }
    const bad = await job({ category: "ELECTRICAL" }); await schema.db.jobPhoto.create({ data: { jobId: bad.id, path: "not-authorized.jpg", position: 0 } });
    const board = boardOf(await loadJobBoard(schema.db, actor, DEFAULT_BOARD_QUERY, {}, signer));
    expect(signer.signPhoto).toHaveBeenCalledTimes(12);
    expect(signer.signPhoto.mock.calls.every(call => board.cards.some(card => card.id === call[1]))).toBe(true);
    signer.signPhoto.mockClear();
    expect(await newBoardJobs(schema.db, actor, DEFAULT_BOARD_QUERY, { since: "2026-11-01T00:00:00Z", knownIds: [], savedIds: [] }, signer)).toEqual({ ok: true, count: 14 });
    expect(signer.signPhoto).not.toHaveBeenCalled();
    const failed = boardOf(await loadJobBoard(schema.db, actor, DEFAULT_BOARD_QUERY, {}, { now: () => NOW, signPhoto: async () => { throw Error("outage"); } }));
    expect(failed.cards.every(card => card.photoUrl === null)).toBe(true);
  });

  it("applies Saved, already-estimated, kind and schedule filters; updates have no repeat of known jobs", async () => {
    const actor = await worker(), a = await job({ status: "REVIEW", asap: true }), b = await job({ status: "QUOTE_BOUNTY" }), c = await job();
    await schema.db.estimate.create({ data: { jobId: a.id, workerId: actor.userId, minutes: 60 } });
    const selected = boardOf(await loadJobBoard(schema.db, actor, { ...DEFAULT_BOARD_QUERY, saved: true, estimated: true, when: ["asap"], kind: "estimate" }, { savedIds: [a.id, b.id] }, deps()));
    expect(selected.cards.map(card => card.id)).toEqual([a.id]); expect(selected.cards[0].alreadyEstimated).toBe(true);
    const none = boardOf(await loadJobBoard(schema.db, actor, { ...DEFAULT_BOARD_QUERY, when: [] }, {}, deps())); expect(none.total).toBe(0);
    expect(await newBoardJobs(schema.db, actor, DEFAULT_BOARD_QUERY, { since: "2026-11-01T00:00:00Z", knownIds: [a.id, b.id], savedIds: [] }, deps())).toEqual({ ok: true, count: 1 });
    expect(boardOf(await loadJobBoard(schema.db, actor, { ...DEFAULT_BOARD_QUERY, saved: true }, { savedIds: [c.id] }, deps())).cards[0].id).toBe(c.id);
  });

  it("labels the matching current-week window after Auckland Monday starts, retaining same-day morning availability", async () => {
    const actor = await worker(), current = await job({ anyTime: false }), expired = await job({ anyTime: false }), today = await job({ anyTime: false });
    await schema.db.jobTimeWindow.createMany({ data: [
      { jobId: current.id, date: new Date("2026-11-08"), timeOfDay: "MORNING" },
      { jobId: current.id, date: new Date("2026-11-14"), timeOfDay: "AFTERNOON" },
      { jobId: expired.id, date: new Date("2026-11-08"), timeOfDay: "EVENING" },
      { jobId: today.id, date: new Date("2026-11-09"), timeOfDay: "MORNING" },
    ] });
    const monday = { ...deps(), now: () => new Date("2026-11-09T07:00:00Z") }; // Auckland Monday20:00, date-only expiry.
    const filtered = boardOf(await loadJobBoard(schema.db, actor, { ...DEFAULT_BOARD_QUERY, when: ["week"] }, {}, monday));
    expect(filtered.total).toBe(2); expect(filtered.cards.map(card => card.id)).not.toContain(expired.id);
    expect(filtered.cards.find(card => card.id === current.id)?.whenLabel).toMatch(/Sat.*14 Nov.*Afternoon/);
    expect(filtered.cards.find(card => card.id === today.id)?.whenLabel).toMatch(/Mon.*9 Nov.*Morning/);
    const all = boardOf(await loadJobBoard(schema.db, actor, DEFAULT_BOARD_QUERY, {}, monday));
    expect(all.cards.find(card => card.id === current.id)?.whenLabel).toMatch(/Sat.*14 Nov.*Afternoon/);
    expect(all.cards.find(card => card.id === expired.id)?.whenLabel).toBe("Time to be arranged");
  });

  it("does not manufacture an empty board for unknown filter values while preserving explicit none and valid mixed choices", async () => {
    const actor = await worker(), valid = await job();
    for (const search of ["trade=electrcial&when=this-week", "trade=&when=", "trade=unknown,other&when=old,flexible"]) {
      const board = boardOf(await loadJobBoard(schema.db, actor, parseBoardQuery(new URLSearchParams(search)), {}, deps()));
      expect(board.total).toBe(1); expect(board.cards[0].id).toBe(valid.id);
    }
    for (const search of ["trade=none", "when=none"]) {
      expect(boardOf(await loadJobBoard(schema.db, actor, parseBoardQuery(new URLSearchParams(search)), {}, deps())).total).toBe(0);
    }
  });

  it("fails closed for current role/email/identity/area proof and malformed continuation", async () => {
    const actor = await worker(); await job();
    expect(await loadJobBoard(schema.db, { ...actor, role: "CUSTOMER" }, DEFAULT_BOARD_QUERY, {}, deps())).toEqual({ ok: false, error: "forbidden" });
    expect(await loadJobBoard(schema.db, actor, DEFAULT_BOARD_QUERY, { cursor: "bad" }, deps())).toEqual({ ok: false, error: "changed" });
    await schema.db.profile.update({ where: { id: actor.userId }, data: { emailVerifiedAt: null } });
    expect(boardOf(await loadJobBoard(schema.db, actor, DEFAULT_BOARD_QUERY, {}, deps())).meta.blocked).toBe("email-required");
    await schema.db.profile.update({ where: { id: actor.userId }, data: { emailVerifiedAt: NOW } });
    await schema.db.workerProfile.update({ where: { userId: actor.userId }, data: { identityCheckedAt: null, identityCheckedById: null } });
    expect(boardOf(await loadJobBoard(schema.db, actor, DEFAULT_BOARD_QUERY, {}, deps())).meta.blocked).toBe("identity-required");
  });
});
