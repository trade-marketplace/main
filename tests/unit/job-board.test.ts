import { describe, expect, it } from "vitest";
import { afterBoardCursor, BoardUpdateRequests, boardCardTag, boardHref, boardReturn, boardWeek, compareBoardJobs, decodeBoardCursor, DEFAULT_BOARD_QUERY, encodeBoardCursor, matchesBoardKind, parseBoardQuery, parseSavedJobs, savedJobsKey, type BoardUpdates, type SortableBoardJob } from "@/lib/job-board";

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
    expect(matchesBoardKind({ status: "QUOTE_BOUNTY" }, "estimate")).toBe(true);
    expect(matchesBoardKind({ status: "QUOTE_BOUNTY" }, "bounty")).toBe(true);
    expect(matchesBoardKind({ status: "REVIEW" }, "bounty")).toBe(false);
    expect(matchesBoardKind({ status: "BOOKABLE" }, "ready")).toBe(true);
  });
  it("shows frozen earnings once a previously estimated job becomes claimable", () => {
    expect(boardCardTag({ status: "REVIEW", earnCents: null, alreadyEstimated: true })).toEqual({ kind: "estimated" });
    expect(boardCardTag({ status: "BOOKABLE", earnCents: 10800, alreadyEstimated: true })).toEqual({ kind: "earn", text: "Earn $108" });
    expect(boardCardTag({ status: "BOOKABLE", earnCents: null, alreadyEstimated: true })).toEqual({ kind: "earn", text: "Pay pending" });
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
  it("isolates browser Saved records by account and fails honestly for damaged storage", () => {
    expect(savedJobsKey("first")).not.toBe(savedJobsKey("second"));
    expect(parseSavedJobs(JSON.stringify([first, first, second]))).toEqual([first, second]);
    expect(parseSavedJobs(null)).toEqual([]);
    expect(() => parseSavedJobs("broken")).toThrow();
    expect(() => parseSavedJobs('["not-a-job-id"]')).toThrow();
  });
});
