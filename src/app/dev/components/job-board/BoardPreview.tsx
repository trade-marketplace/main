"use client";

import { useMemo } from "react";
import { JobBoard } from "@/components/jobs/JobBoard";
import { BOARD_PAGE_SIZE, compareBoardJobs, matchesBoardKind, type BoardPage, type BoardSource } from "@/lib/job-board";

export function BoardPreview({ board, state }: { board: BoardPage; state: string }) {
  const saved = useMemo(() => board.cards.slice(0, 3).map(card => card.id), [board]);
  const source = useMemo<BoardSource>(() => ({
    async load(query, request = {}) {
      if (state === "error") return { ok: false, error: "unavailable" };
      const rows = board.cards.filter(card => matchesBoardKind(card, query.kind) && (query.trades === null || query.trades.includes(card.category)) && card.distanceKm <= (query.distance ?? 25)
        && (!query.saved || request.savedIds?.includes(card.id)) && (!query.estimated || card.alreadyEstimated)
        && (query.when === null || query.when.includes(card.asap ? "asap" : "flexible"))).sort((a, b) => compareBoardJobs(a, b, query.sort));
      const offset = Number(request.cursor ?? 0), cards = rows.slice(offset, offset + BOARD_PAGE_SIZE);
      return { ok: true, board: { ...board, cards, total: rows.length, meta: { ...board.meta, distanceKm: Math.min(query.distance ?? 25, board.meta.maxDistanceKm) }, nextCursor: offset + BOARD_PAGE_SIZE < rows.length ? String(offset + BOARD_PAGE_SIZE) : null } };
    },
    async updates() { return { ok: true, count: state === "new-jobs" ? 3 : 0 }; },
  }), [board, state]);
  return <JobBoard key={state} ownerId={board.meta.ownerId} initial={state === "error" ? { ok: false, error: "unavailable" } : { ok: true, board: { ...board, cards: board.cards.slice(0, BOARD_PAGE_SIZE), nextCursor: board.cards.length > BOARD_PAGE_SIZE ? "12" : null } }} previewState={state} initialSaved={saved} source={source} />;
}
