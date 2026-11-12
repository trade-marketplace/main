import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, expectTypeOf, it } from "vitest";
import { BoardMap, BoardMapSkeleton } from "@/components/jobs/BoardMap";
import { previewMapBoard } from "@/app/dev/components/board-map/preview-data";
import { boardMapPreviewReturn, cardToMapJob, cardsInsideBounds, countsInView, legendIsClosed, mapLegendKey, pointInBounds, rememberClosedLegend, type BoardMapCard } from "@/lib/board-map";
import { boardHref, DEFAULT_BOARD_QUERY, parseBoardQuery, type BoardCard } from "@/lib/job-board";

const NOW = Date.parse("2026-11-11T05:00:00Z"), board = previewMapBoard("ready", NOW);
const card = (changes: Partial<BoardCard> = {}): BoardCard => ({ ...board.cards[0], ...changes });
const query = { ...DEFAULT_BOARD_QUERY, view: "map" as const };
const render = (cards: BoardCard[], extra: Partial<Parameters<typeof BoardMap>[0]> = {}) => renderToStaticMarkup(<BoardMap cards={cards} query={query} ownerId="worker" serverNow={NOW} onKindChange={() => {}} {...extra} />);

describe("board map safe facts and browser-only filtering", () => {
  it("maps ready pay, photo quotes and configured bounties to the existing pin kinds", () => {
    expect(cardToMapJob(card({ status: "BOOKABLE", earnCents: 25920 }))).toMatchObject({ kind: "claim", earnCents: 25920, precision: "approximate" });
    const quote = cardToMapJob(card({ status: "REVIEW", earnCents: 999999 }));
    expect(quote).toMatchObject({ kind: "estimate" }); expect(quote).not.toHaveProperty("earnCents");
    expect(cardToMapJob(card({ status: "QUOTE_BOUNTY", earnCents: 999999, bounty: { amountCents: 4500, endsAt: NOW + 7_200_000, durationMs: 129_600_000 } })))
      .toMatchObject({ kind: "bounty", bountyCents: 4500, endsAt: NOW + 7_200_000, durationMs: 129_600_000 });
  });
  it("copies only approximate display facts, never customer prices, notes or raw coordinates", () => {
    type Forbidden = Extract<keyof BoardMapCard, "lat" | "lng" | "address" | "addressLine1" | "accessNotes" | "priceCents" | "customerId">;
    expectTypeOf<Forbidden>().toEqualTypeOf<never>();
    const input = { ...card(), priceCents: 987654, addressLine1: "Private street", accessNotes: "Private code", point: { ...card().point!, exactLat: 42, exactLng: 21 } };
    const pin = cardToMapJob(input)!;
    expect(pin.point).toEqual(card().point); expect(Object.keys(pin.point).sort()).toEqual(["lat", "lng"]);
    expect(JSON.stringify(pin)).not.toMatch(/987654|Private street|Private code|priceCents|accessNotes|exactLat|exactLng|customerId/);
    expect(cardToMapJob(card({ precision: "exact" }))).toBeNull(); expect(cardToMapJob(card({ point: null }))).toBeNull();
  });
  it("keeps missing legacy pay/deadlines honest instead of inventing zero earnings or an expiry", () => {
    expect(cardToMapJob(card({ earnCents: null }))).toBeNull();
    for (const bounty of [undefined, { amountCents: 3000, endsAt: NaN, durationMs: 24 }, { amountCents: 3000, endsAt: NOW, durationMs: 0 }]) expect(cardToMapJob(card({ status: "QUOTE_BOUNTY", bounty }))).toBeNull();
    const html = render([card({ earnCents: null }), card({ id: "legacy-bounty", status: "QUOTE_BOUNTY", earnCents: null, bounty: undefined })], { previewState: "ready" });
    expect(html).toContain("Pay pending"); expect(html).toContain("Quote bounty"); expect(html).not.toContain("Expired"); expect(html).not.toContain("$0");
    expect(html.match(/<a\b/g)).toHaveLength(2);
  });
  it("filters inclusive bounds, rejects missing/exact points, and handles wrapped longitude", () => {
    const bounds = { north: -46, south: -47, west: 168, east: 169 };
    expect(pointInBounds({ lat: -46, lng: 169 }, bounds)).toBe(true); expect(pointInBounds({ lat: -47, lng: 168 }, bounds)).toBe(true);
    expect(pointInBounds({ lat: -45.9, lng: 168.5 }, bounds)).toBe(false); expect(pointInBounds({ lat: -46.5, lng: 167.9 }, bounds)).toBe(false);
    expect(pointInBounds({ lat: NaN, lng: 168 }, bounds)).toBe(false);
    expect(pointInBounds({ lat: 0, lng: -175 }, { north: 10, south: -10, west: 170, east: -170 })).toBe(true);
    expect(pointInBounds({ lat: 0, lng: 0 }, { north: 10, south: -10, west: 170, east: -170 })).toBe(false);
    expect(pointInBounds({ lat: 0, lng: -175 }, { north: 10, south: -10, west: 170, east: 190 })).toBe(true);
    const inside = card({ point: { lat: -46.5, lng: 168.5 } }), outside = card({ id: "outside", point: { lat: -45, lng: 168.5 } });
    expect(cardsInsideBounds([inside, outside, card({ point: null }), card({ precision: "exact" })], bounds)).toEqual([inside]);
    expect(cardsInsideBounds([inside, outside], null)).toHaveLength(2);
  });
  it("counts only the discovery kinds in the current cards", () => {
    expect(countsInView([card(), card({ status: "REVIEW" }), card({ status: "QUOTE_BOUNTY" }), card({ status: "ASSIGNED" })])).toEqual({ all: 3, ready: 1, estimate: 1, bounty: 1 });
    expect(countsInView([])).toEqual({ all: 0, ready: 0, estimate: 0, bounty: 0 });
  });
  it("remembers legend dismissal per user and survives storage access/read/write failure", () => {
    const values = new Map<string, string>(), storage = () => ({ getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } });
    expect(mapLegendKey("me")).toBe("tm:map-legend:me"); expect(legendIsClosed("me", storage)).toBe(false);
    rememberClosedLegend("me", storage); expect(legendIsClosed("me", storage)).toBe(true); expect(legendIsClosed("other", storage)).toBe(false);
    const denied = () => { throw Error("Storage blocked"); };
    expect(legendIsClosed("me", denied)).toBe(false); expect(() => rememberClosedLegend("me", denied)).not.toThrow();
    expect(() => rememberClosedLegend("me", () => ({ getItem: () => null, setItem: () => { throw Error("Quota"); } }))).not.toThrow();
  });
  it("uses real job links with the same bounded map filters and safe guarded-demo Back", () => {
    const filtered = parseBoardQuery(new URLSearchParams("view=all&layout=map&kind=ready&trade=other&distance=10&sort=earn&saved=1"));
    const html = render([card()], { query: filtered, config: board.meta.map, previewState: undefined });
    const href = html.match(/href="([^"]+)"/)?.[1]?.replaceAll("&amp;", "&");
    expect(new URL(href!, "https://map.test").searchParams.get("from")).toBe(boardHref(filtered));
    expect(boardMapPreviewReturn("/dev/components/board-map?state=ready&view=map&kind=bounty&distance=10&evil=1")).toBe("/dev/components/board-map?state=ready&kind=bounty&distance=10&view=map");
    expect(boardMapPreviewReturn("/dev/components/board-map?state=ready&layout=grid&kind=estimate")).toBe("/dev/components/board-map?state=ready&kind=estimate&layout=grid");
    expect(boardMapPreviewReturn("/dev/components/board-map?state=chips-estimate&view=map&kind=all")).toBe("/dev/components/board-map?state=chips-estimate&view=map&kind=all");
    for (const value of ["https://evil.test/dev/components/board-map", "//evil.test/dev/components/board-map", "/dev/components/foreign", "/dev/components/board-map/foreign", "/dev/components/board-map\\foreign"]) expect(boardMapPreviewReturn(value)).toBe("/dev/components/board-map?state=ready&view=map");
  });
  it("uses existing kit pins/cards and a full-width linked list without a usable provider", () => {
    expect(render([card()], { previewState: "ready", config: board.meta.map })).toContain("Pin examples. See each job for its offer and time left.");
    const html = render([card()], { previewState: "pin-open", config: board.meta.map });
    expect(html).toContain('data-pin-kind="claim"'); expect(html).toContain('data-precision="approximate"'); expect(html).toContain('data-card-kind="claim"'); expect(html).toContain("Earn");
    const unavailable = render([card()]); expect(unavailable).toContain("Map isn’t available right now."); expect(unavailable).toContain("/jobs/"); expect(unavailable).not.toContain('aria-label="Map of jobs in view"');
    expect(render([card()], { config: { ...board.meta.map!, accessToken: "pk.fixture", workArea: undefined as never } })).toContain("Map isn’t available right now.");
    expect(renderToStaticMarkup(<BoardMapSkeleton />)).toContain('aria-hidden="true"');
  });
});
