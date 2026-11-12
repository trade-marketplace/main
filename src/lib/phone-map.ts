import type { BoardCard } from "./job-board";
import type { Bounds } from "./map/pins";

export const PHONE_MAP_STATES = ["peek", "card-selected", "bounty-first", "sheet-up", "chips-bounty", "available-off", "paused", "no-jobs-in-view", "map-unavailable", "saving-available", "error", "offline", "loading"] as const;
export type PhoneMapState = typeof PHONE_MAP_STATES[number];
/** Stable within each group: the board's existing ordering remains canonical after the bounty group. */
export function phoneMapCards<T extends Pick<BoardCard, "status">>(cards: readonly T[]): T[] {
  return [...cards.filter(card => card.status === "QUOTE_BOUNTY"), ...cards.filter(card => card.status !== "QUOTE_BOUNTY")];
}
export function phoneCardIndex(cards: readonly Pick<BoardCard, "id">[], id: string | null): number { return id === null ? -1 : cards.findIndex(card => card.id === id); }
export function phonePinId(cards: readonly Pick<BoardCard, "id">[], index: number): string | null { return Number.isInteger(index) ? cards[index]?.id ?? null : null; }
/** Keep the current zoom while moving the selected approximate point to the centre. */
export function phoneCentredBounds(point: { lat: number; lng: number }, bounds: Bounds): Bounds {
  const halfLat = (bounds.north - bounds.south) / 2, halfLng = (bounds.east - bounds.west) / 2;
  return { north: point.lat + halfLat, south: point.lat - halfLat, east: point.lng + halfLng, west: point.lng - halfLng };
}
/** Reserve room above for chips and below for the peeking sheet without moving any job coordinate. */
export function phoneFrameBounds(bounds: Bounds): Bounds {
  const height=bounds.north-bounds.south;
  return {...bounds,north:bounds.north+height*.25,south:bounds.south-height*.6};
}
