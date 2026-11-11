import "server-only";
import { previewBoard } from "../job-board/preview-data";
import { INVERCARGILL_COVERAGE } from "@/lib/geo/coverage";
import { haversineKm } from "@/lib/geo/distance";
import { countsInView } from "@/lib/board-map";
import { APPROX_MAX_METRES } from "@/server/geo/approximate";

export function previewMapBoard(state: string, now = Date.now()) {
  const board = previewBoard(state === "empty" ? "empty" : "ready"), centre = INVERCARGILL_COVERAGE.centre;
  const cards = board.cards.map((card, index) => {
    const point = state === "clustered" ? { lat: centre.lat + index * 0.00001, lng: centre.lng + index * 0.00001 }
      : { lat: centre.lat + (Math.floor(index / 6) - 1.5) * .012, lng: centre.lng + (index % 6 - 2.5) * .014 };
    return { ...card, point, distanceKm: haversineKm(centre, point), earnCents: card.status === "BOOKABLE" && card.earnCents === null ? 25920 : card.earnCents,
      ...(card.status === "QUOTE_BOUNTY" ? { bounty: { amountCents: 3000, endsAt: now + (index % 2 ? 6 : 17) * 3_600_000, durationMs: 24 * 3_600_000 } } : {}) };
  });
  return { ...board, cards, counts: { ...board.counts, ...countsInView(cards) }, before: new Date(now).toISOString(),
    meta: { ...board.meta, map: { accessToken: null, workArea: { ...INVERCARGILL_COVERAGE, radiusKm: 12 }, approxRadiusMetres: APPROX_MAX_METRES } } };
}
