import { describe, expect, it } from "vitest";
import { afterBoardCursor, BoardUpdateRequests, boardAlertsRoute, boardAvailabilityWindow, boardCardTag, boardCardWhen, boardDistanceLabel, boardHref, boardJobHref, boardQuerySchema, boardReturn, boardSelectionKey, boardToday, boardWeek, compareBoardJobs, decodeBoardCursor, DEFAULT_BOARD_QUERY, encodeBoardCursor, matchesBoardKind, parseBoardQuery, parseSavedJobs, savedJobsKey, type BoardUpdates, type SortableBoardJob } from "@/lib/job-board";
import { BOTTOM_NAV, currentLink } from "@/components/app/app-links";

const first = "13800000-0000-4000-8000-000000000001", second = "13800000-0000-4000-8000-000000000002";
const row = (id: string, overrides: Partial<SortableBoardJob> = {}): SortableBoardJob => ({ id, status: "BOOKABLE", category: "OTHER", earnCents: 10800, distanceKm: 3, createdAt: "2026-11-03T00:00:00Z", updatedAt: "2026-11-03T00:00:00Z", alreadyEstimated: false, ...overrides });

describe("job board URL and safe client rules", () => {
  it("round-trips every filter/sort and preserves an explicit empty selection", () => {
    const query = parseBoardQuery(new URLSearchParams("kind=bounty&trade=electrical,other&distance=10&when=asap,week&sort=earn&saved=1&estimated=1"));
    expect(query).toMatchObject({ kind: "bounty", trades: ["ELECTRICAL", "OTHER"], distance: 10, when: ["asap", "week"], sort: "earn", saved: true, estimated: true });
    expect(parseBoardQuery(new URL(boardHref(query), "https://board.test").searchParams)).toEqual(query);
    expect(parseBoardQuery(new URLSearchParams("trade=none&when=none"))).toMatchObject({ trades: [], when: [] });
    expect(parseBoardQuery(new URL(boardHref({ ...DEFAULT_BOARD_QUERY, trades: [], when: [] }), "https://board.test").searchParams)).toMatchObject({ trades: [], when: [] });
  });
  it("rejects malformed enum/distance values and never accepts a return path outside the board", () => {
    expect(parseBoardQuery(new URLSearchParams("kind=admin&distance=-5&sort=price&view=raw"))).toEqual(DEFAULT_BOARD_QUERY);
    for (const url of ["//evil.test/jobs", "https://evil.test/jobs", "/jobs/other", "/admin?next=/jobs", "/jobs%2F..%2Fadmin"]) expect(boardReturn(url)).toBe("/jobs");
    for (const value of [["/jobs", "/jobs"], { next: "/jobs" }, 1, true, null, undefined]) expect(boardReturn(value)).toBe("/jobs");
    expect(boardReturn("/jobs?trade=other&distance=25&saved=1")).toBe("/jobs?trade=other&distance=25&saved=1");
  });
  it.each(["trade=electrcial&when=this-week", "trade=bad,worse&when=old,unknown", "trade=&when="])("falls back for unknown-only multi-selects: %s", search => {
    expect(parseBoardQuery(new URLSearchParams(search))).toEqual(DEFAULT_BOARD_QUERY);
  });
  it("keeps known mixed choices and reserves an empty selection for the explicit none sentinel", () => {
    expect(parseBoardQuery(new URLSearchParams("trade=electrcial,other&when=this-week,week"))).toMatchObject({ trades: ["OTHER"], when: ["week"] });
    expect(parseBoardQuery(new URLSearchParams("trade=none,other&when=none,flexible"))).toMatchObject({ trades: ["OTHER"], when: ["flexible"] });
    expect(parseBoardQuery(new URLSearchParams("trade=none&when=none"))).toMatchObject({ trades: [], when: [] });
    expect(parseBoardQuery(new URLSearchParams("trade=other,gas,plumbing,construction,electrical,typo&when=asap,week,flexible,typo"))).toEqual(DEFAULT_BOARD_QUERY);
  });
  it("retains the All jobs navigation entry through filters, cards, canonical Back and Alerts", () => {
    const query = { ...parseBoardQuery(new URLSearchParams("view=all")), kind: "ready" as const, distance: 10, sort: "earn" as const };
    expect(query).toMatchObject({ entry: "all", view: "grid" });
    const back = boardHref(query), url = new URL(back, "https://board.test");
    expect(url.searchParams.get("view")).toBe("all");
    expect(currentLink(BOTTOM_NAV.TRADIE, url.pathname, url.searchParams.get("view"))?.label).toBe("All jobs");
    const card = new URL(boardJobHref(first, back), "https://board.test");
    expect(card.searchParams.get("view")).toBe("all");
    expect(currentLink(BOTTOM_NAV.TRADIE, card.pathname, card.searchParams.get("view"))?.label).toBe("All jobs");
    expect(boardReturn(card.searchParams.get("from"), card.searchParams.get("view"))).toBe(back);
    expect(boardAlertsRoute(back).back).toBe(back);
    expect(new URL(boardAlertsRoute(back).href, "https://board.test").searchParams.get("next")).toBe(back);
    expect(boardHref({ ...DEFAULT_BOARD_QUERY, entry: query.entry, view: query.view })).toBe("/jobs?view=all");
  });
  it("keeps grid/map layout separate from All jobs while retaining legacy layout URLs", () => {
    const allMap = parseBoardQuery(new URLSearchParams("view=all&layout=map&sort=earn"));
    expect(allMap).toMatchObject({ entry: "all", view: "map", sort: "earn" });
    expect(parseBoardQuery(new URL(boardHref(allMap), "https://board.test").searchParams)).toEqual(allMap);
    expect(boardHref({ ...allMap, view: "grid" })).toBe("/jobs?sort=earn&view=all");
    expect(parseBoardQuery(new URLSearchParams("view=map"))).toMatchObject({ entry: "find-work", view: "map" });
    expect(boardHref(parseBoardQuery(new URLSearchParams("view=map")))).toBe("/jobs?view=map");
    expect(parseBoardQuery(new URLSearchParams("view=grid"))).toEqual(DEFAULT_BOARD_QUERY);
    expect(parseBoardQuery(new URLSearchParams("view=wrong&layout=wrong"))).toEqual(DEFAULT_BOARD_QUERY);
    expect(parseBoardQuery(new URLSearchParams("view=all&layout=wrong"))).toMatchObject({ entry: "all", view: "grid" });
  });
  it("invalidates cached selections for filters or Saved changes while ignoring presentation and bookmark ordering", () => {
    const snapshot = boardSelectionKey(DEFAULT_BOARD_QUERY, [first, second]);
    expect(boardSelectionKey({ ...DEFAULT_BOARD_QUERY, entry: "all", view: "map" }, [second, first, first])).toBe(snapshot);
    for (const patch of [{ kind: "ready" as const }, { distance: 10 }, { saved: true }, { when: ["asap" as const] }]) {
      expect(boardSelectionKey({ ...DEFAULT_BOARD_QUERY, ...patch }, [first, second])).not.toBe(snapshot);
    }
    expect(boardSelectionKey(DEFAULT_BOARD_QUERY, [second])).not.toBe(snapshot);
  });
  it("fails closed for malformed return markers and keeps the canonical marker in a detail login destination", () => {
    expect(boardReturn(["/jobs", "/jobs"], ["all", "map"])).toBe("/jobs");
    expect(boardReturn("https://evil.test/jobs", "all")).toBe("/jobs?view=all");
    expect(boardReturn(undefined, "all")).toBe("/jobs?view=all");
    expect(boardReturn("/jobs?view=all&layout=map")).toBe("/jobs?view=all&layout=map");
    const destination = new URL(boardJobHref(first, boardReturn(undefined, "all")), "https://board.test");
    expect(destination.searchParams.get("view")).toBe("all"); expect(destination.searchParams.get("from")).toBe("/jobs?view=all");
    expect(boardQuerySchema.parse({ ...DEFAULT_BOARD_QUERY, entry: undefined }).entry).toBe("find-work");
    expect(boardQuerySchema.safeParse({ ...DEFAULT_BOARD_QUERY, entry: "wrong" }).success).toBe(false);
  });
  it("sorts actual public earnings and stable IDs, with unknown pay after known pay", () => {
    const jobs = [row(second), row(first), row("13800000-0000-4000-8000-000000000003", { earnCents: null, distanceKm: 1 })];
    expect([...jobs].sort((a, b) => compareBoardJobs(a, b, "earn")).map(job => job.id)).toEqual([first, second, jobs[2].id]);
    expect([...jobs].sort((a, b) => compareBoardJobs(a, b, "nearest"))[0].id).toBe(jobs[2].id);
  });
  it("continues after a sort key even if the cursor's anchor job disappeared", () => {
    const cursor = { version: 1 as const, scope: "scope", before: "2026-11-03T00:00:00Z", anchor: { id: first, value: 3 } };
    expect(decodeBoardCursor(encodeBoardCursor(cursor))).toEqual(cursor);
    expect(afterBoardCursor(row(second), cursor, "nearest")).toBe(true);
    expect(afterBoardCursor(row(first), cursor, "nearest")).toBe(false);
    expect(afterBoardCursor(row(second, { distanceKm: 2 }), cursor, "nearest")).toBe(false);
    expect(decodeBoardCursor("bad-token")).toBeNull();
  });
  it("keeps estimate discovery and quote-bounty filtering separate from claimable work", () => {
    expect(matchesBoardKind({ status: "REVIEW" }, "estimate")).toBe(true);
    expect(matchesBoardKind({ status: "QUOTE_BOUNTY" }, "estimate")).toBe(false);
    expect(matchesBoardKind({ status: "QUOTE_BOUNTY" }, "bounty")).toBe(true);
    expect(matchesBoardKind({ status: "REVIEW" }, "bounty")).toBe(false);
    expect(matchesBoardKind({ status: "BOOKABLE" }, "ready")).toBe(true);
  });
  it("shows frozen earnings once a previously estimated job becomes claimable", () => {
    expect(boardCardTag({ status: "REVIEW", earnCents: null, alreadyEstimated: true })).toEqual({ kind: "estimated" });
    expect(boardCardTag({ status: "BOOKABLE", earnCents: 10800, alreadyEstimated: true })).toEqual({ kind: "earn", text: "Earn $108" });
    expect(boardCardTag({ status: "BOOKABLE", earnCents: null, alreadyEstimated: true })).toEqual({ kind: "earn", text: "Pay pending" });
  });
  it("keeps the gold bounty state after a worker estimated the earlier REVIEW job", () => {
    expect(boardCardTag({ status: "REVIEW", earnCents: null, alreadyEstimated: true })).toEqual({ kind: "estimated" });
    expect(boardCardTag({ status: "QUOTE_BOUNTY", earnCents: null, alreadyEstimated: true })).toEqual({ kind: "bounty", text: "Quote bounty" });
    expect(boardCardTag({ status: "QUOTE_BOUNTY", earnCents: null, alreadyEstimated: false })).toEqual({ kind: "bounty", text: "Quote bounty" });
  });
  it("shows the selected schedule instead of masking it with another valid ASAP option", () => {
    const window = { asap: true, whenLabel: "Sat,14 Nov · Afternoon" };
    expect(boardCardWhen(window, null)).toBe("ASAP");
    expect(boardCardWhen(window, ["asap"])).toBe("ASAP");
    expect(boardCardWhen(window, ["asap", "week"])).toBe("ASAP");
    expect(boardCardWhen(window, ["week"])).toBe(window.whenLabel);
    expect(boardCardWhen({ asap: true, whenLabel: "Flexible" }, ["flexible"])).toBe("Flexible");
    expect(boardCardWhen({ asap: false, whenLabel: "Flexible" }, null)).toBe("Flexible");
  });
  it("preserves nearby distance precision while keeping the under-one fallback and whole kilometres from ten", () => {
    for (const [km, label] of [[0, "<1 km"], [.999, "<1 km"], [1, "1.0 km"], [1.05, "1.1 km"], [3.6, "3.6 km"], [9.94, "9.9 km"], [9.95, "10.0 km"], [10, "10 km"], [10.5, "11 km"], [1000, "1000 km"]] as const) {
      expect(boardDistanceLabel(km)).toBe(label);
    }
  });
  it.each(["same-query refresh", "Saved set changed"])("discards a deferred old poll after %s without restoring its old pill", async () => {
    const requests = new BoardUpdateRequests(); let finish!: (value: BoardUpdates) => void;
    const old = requests.run(() => new Promise(resolve => { finish = resolve; }));
    requests.invalidate(); // Used synchronously by load and bookmark changes, before their next render.
    const fresh = await requests.run(async () => ({ ok: true, count: 0 }));
    finish({ ok: true, count: 3 });
    expect(await old).toBeNull(); expect(fresh).toEqual({ ok: true, count: 0 });
    expect(await requests.run(async () => ({ ok: true, count: 1 }))).toEqual({ ok: true, count: 1 });
  });
  it("uses the current New Zealand week across the UTC/day boundary", () => {
    const week = boardWeek(new Date("2026-11-01T11:30:00Z")); // Monday in New Zealand.
    expect(week.start.toISOString().slice(0, 10)).toBe("2026-11-02");
    expect(week.end.toISOString().slice(0, 10)).toBe("2026-11-08");
  });
  it("changes availability at Auckland midnight across a Sunday/Monday week boundary", () => {
    const sunday = { date: "2026-11-01", timeOfDay: "MORNING" as const }, saturday = { date: "2026-11-07", timeOfDay: "AFTERNOON" as const };
    const before = new Date("2026-11-01T10:59:59Z"), monday = new Date("2026-11-01T11:00:00Z");
    expect(boardToday(before)).toBe("2026-11-01"); expect(boardToday(monday)).toBe("2026-11-02");
    expect(boardAvailabilityWindow([saturday, sunday], ["week"], before)).toEqual(sunday);
    expect(boardAvailabilityWindow([sunday, saturday], ["week"], monday)).toEqual(saturday);
    expect(boardAvailabilityWindow([sunday, saturday], null, monday)).toEqual(saturday);
  });
  it("keeps every part of today's availability valid all day and chooses chronological upcoming windows", () => {
    const morning = { date: "2026-11-02", timeOfDay: "MORNING" as const }, evening = { date: "2026-11-02", timeOfDay: "EVENING" as const };
    const lateMonday = new Date("2026-11-02T07:00:00Z"); // 20:00 in Auckland; no hour-based expiry.
    expect(boardAvailabilityWindow([evening, morning], ["week"], lateMonday)).toEqual(morning);
    expect(boardAvailabilityWindow([{ date: "2026-11-01", timeOfDay: "EVENING" }], null, lateMonday)).toBeNull();
  });
  it("isolates browser Saved records by account and fails honestly for damaged storage", () => {
    expect(savedJobsKey("first")).not.toBe(savedJobsKey("second"));
    expect(parseSavedJobs(JSON.stringify([first, first, second]))).toEqual([first, second]);
    expect(parseSavedJobs(null)).toEqual([]);
    expect(() => parseSavedJobs("broken")).toThrow();
    expect(() => parseSavedJobs('["not-a-job-id"]')).toThrow();
  });
});
