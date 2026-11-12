import { isPoint, type Point } from "@/lib/geo/distance";
import { boardHref, parseBoardQuery, type BoardCard, type BoardCounts } from "@/lib/job-board";
import type { Bounds, MapJob } from "@/lib/map/pins";

/** A board projection, never the database job or a customer/address projection. */
export type BoardMapCard = Pick<BoardCard, "id" | "title" | "suburb" | "tradeLabel" | "distanceKm" | "status" | "point" | "precision" | "earnCents" | "bounty">;
export function hasApproximatePoint(card: Pick<BoardMapCard, "point" | "precision">): card is typeof card & { point: Point } {
  return card.precision === "approximate" && card.point !== null && isPoint(card.point);
}
export function cardToMapJob(card: BoardMapCard): MapJob | null {
  if (!hasApproximatePoint(card)) return null;
  const base = { id: card.id, title: card.title, suburb: card.suburb, trade: card.tradeLabel, distanceKm: card.distanceKm,
    point: { lat: card.point.lat, lng: card.point.lng }, precision: "approximate" as const };
  if (card.status === "REVIEW") return { ...base, kind: "estimate" };
  if (card.status === "BOOKABLE" && card.earnCents !== null && Number.isInteger(card.earnCents) && card.earnCents >= 0) return { ...base, kind: "claim", earnCents: card.earnCents };
  const bounty = card.bounty;
  if (card.status === "QUOTE_BOUNTY" && bounty && Number.isInteger(bounty.amountCents) && bounty.amountCents >= 0 && Number.isFinite(bounty.endsAt) && Number.isFinite(bounty.durationMs) && bounty.durationMs > 0) {
    return { ...base, kind: "bounty", bountyCents: bounty.amountCents, endsAt: bounty.endsAt, durationMs: bounty.durationMs };
  }
  // Legacy missing pay/deadline uses the existing board's honest list label and job link, never a fake zero/ETA.
  return null;
}
export function pointInBounds(point: Point, bounds: Bounds): boolean {
  if (!isPoint(point) || !Object.values(bounds).every(Number.isFinite) || bounds.north < bounds.south || point.lat > bounds.north || point.lat < bounds.south) return false;
  if (bounds.west > bounds.east) return point.lng >= bounds.west || point.lng <= bounds.east;
  return [point.lng, point.lng - 360, point.lng + 360].some(lng => lng >= bounds.west && lng <= bounds.east);
}
export function cardsInsideBounds<T extends BoardMapCard>(cards: readonly T[], bounds: Bounds | null): T[] {
  return cards.filter(card => hasApproximatePoint(card) && (!bounds || pointInBounds(card.point, bounds)));
}
export function countsInView(cards: readonly Pick<BoardMapCard, "status">[]): Pick<BoardCounts, "all" | "ready" | "estimate" | "bounty"> {
  const counts = { all: 0, ready: 0, estimate: 0, bounty: 0 };
  for (const card of cards) {
    const kind = card.status === "BOOKABLE" ? "ready" : card.status === "REVIEW" ? "estimate" : card.status === "QUOTE_BOUNTY" ? "bounty" : null;
    if (kind) { counts.all++; counts[kind]++; }
  }
  return counts;
}
export function scaleBounds(bounds: Bounds, factor: number): Bounds {
  const lat = (bounds.north + bounds.south) / 2, lng = (bounds.east + bounds.west) / 2;
  const height = (bounds.north - bounds.south) * factor / 2, width = (bounds.east - bounds.west) * factor / 2;
  return { north: Math.min(85, lat + height), south: Math.max(-85, lat - height), east: Math.min(180, lng + width), west: Math.max(-180, lng - width) };
}
export function moveBounds(bounds: Bounds, x: number, y: number): Bounds {
  const dx = (bounds.east - bounds.west) * x, dy = (bounds.north - bounds.south) * y;
  return { north: bounds.north + dy, south: bounds.south + dy, east: bounds.east + dx, west: bounds.west + dx };
}
type LegendStorage = () => Pick<Storage, "getItem" | "setItem">;
export const mapLegendKey = (ownerId: string) => `tm:map-legend:${ownerId}`;
export function legendIsClosed(ownerId: string, storage: LegendStorage = () => window.localStorage): boolean {
  try { return storage().getItem(mapLegendKey(ownerId)) === "closed"; } catch { return false; }
}
export function rememberClosedLegend(ownerId: string, storage: LegendStorage = () => window.localStorage): void {
  try { storage().setItem(mapLegendKey(ownerId), "closed"); } catch { /* The local close still works without storage. */ }
}
/** Guarded demo job pages only return to these two demos, keeping their bounded board filters. */
export function boardMapPreviewReturn(value: unknown): string {
  const fallback = "/dev/components/board-map?state=ready&view=map";
  if (typeof value !== "string" || value.length > 4096 || !value.startsWith("/dev/components/")) return fallback;
  try {
    const url = new URL(value, "https://map-preview.invalid");
    if (url.origin !== "https://map-preview.invalid" || !["/dev/components/board-map", "/dev/components/job-board"].includes(url.pathname)) return fallback;
    const state = url.searchParams.get("state"), query = parseBoardQuery(url.searchParams);
    const result = boardHref(query, url.pathname, `state=${state && /^[a-z-]{1,32}$/.test(state) && state !== "detail" ? state : "ready"}`);
    const flags = new URLSearchParams();
    if (url.pathname === "/dev/components/board-map") {
      if (query.view === "grid") flags.set("layout", "grid");
      if (state === "chips-estimate" && url.searchParams.get("kind") === "all") flags.set("kind", "all");
    }
    return `${result}${flags.size ? `&${flags}` : ""}`;
  } catch { return fallback; }
}
export const BOARD_MAP_STATES = ["ready", "pin-open", "bounty-open", "row-hover", "clustered", "chips-estimate", "nothing-in-view", "no-location", "legend-closed", "map-unavailable", "empty", "error", "offline", "loading"] as const;
export type BoardMapState = typeof BOARD_MAP_STATES[number];
