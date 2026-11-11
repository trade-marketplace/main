"use client";

import { useMemo, useRef, useState } from "react";
import { JobBoard } from "@/components/jobs/JobBoard";
import { BoardMap, BoardMapSkeleton } from "@/components/jobs/BoardMap";
import { ErrorState } from "@/components/feedback/ErrorState";
import { OfflineBanner } from "@/components/feedback/OfflineBanner";
import { LoadingRegion } from "@/components/feedback/LoadingRegion";
import { countsInView } from "@/lib/board-map";
import { BOARD_PAGE_SIZE, compareBoardJobs, matchesBoardKind, type BoardPage, type BoardQuery, type BoardRequest, type BoardSource } from "@/lib/job-board";
import styles from "./preview.module.css";

function select(board: BoardPage, query: BoardQuery, request: BoardRequest = {}): BoardPage {
  const available = board.cards.filter(card => (query.trades === null || query.trades.includes(card.category)) && card.distanceKm <= (query.distance ?? 25)
    && (!query.saved || request.savedIds?.includes(card.id)) && (!query.estimated || card.alreadyEstimated) && (query.when === null || query.when.includes(card.asap ? "asap" : "flexible")));
  const cards = available.filter(card => matchesBoardKind(card, query.kind)).sort((a, b) => compareBoardJobs(a, b, query.sort));
  const cursor = Number(request.cursor ?? 0), start = Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0, end = start + BOARD_PAGE_SIZE;
  return { ...board, cards: cards.slice(start, end), counts: { ...board.counts, ...countsInView(available) }, total: cards.length, nextCursor: end < cards.length ? String(end) : null };
}
export function BoardMapDemo({ board, state, query }: { board: BoardPage; state: string; query: BoardQuery }) {
  const saved = useMemo(() => board.cards.slice(0, 3).map(card => card.id), [board]);
  const recovered = useRef(false);
  const source = useMemo<BoardSource>(() => {
    return { async load(next, request) { if (state === "error" && !recovered.current) return { ok: false, error: "unavailable" }; return { ok: true, board: select(board, next, request) }; }, async updates() { return { ok: true, count: 0 }; } };
  }, [board, state]);
  // Explicit retry keeps the fixture stable under repeated development effect loads.
  return <div onClickCapture={event => { if (state === "error" && event.target instanceof Element && event.target.closest("button")?.textContent?.includes("Try again")) recovered.current = true; }}>
    <JobBoard key={state} ownerId={board.meta.ownerId} initial={state === "error" ? { ok: false, error: "unavailable" } : { ok: true, board: select(board, query, { savedIds: saved }) }} source={source} previewState={state} previewMap initialSaved={saved} />
  </div>;
}
export function BoardMapGallery({ board, query }: { board: BoardPage; query: BoardQuery }) {
  const [retried, setRetried] = useState(false), [offline, setOffline] = useState(true);
  const show = (empty: boolean, label: string) => <GalleryMap board={board} query={query} empty={empty} label={label} />;
  return <div className={styles.gallery}><h1>Map states</h1>
    <section><h2>Empty</h2>{show(true, "Empty jobs map")}</section>
    <section><h2>Error</h2>{retried ? show(false, "Recovered jobs map") : <ErrorState title="Can’t load your jobs" message="Check your connection and try again." onRetry={() => setRetried(true)} />}</section>
    <section><h2>Offline</h2><OfflineBanner online={!offline} sticky={false} onRetry={() => setOffline(false)} />{show(false, "Offline jobs map")}</section>
    <section><h2>Loading</h2><LoadingRegion loading label="Loading your jobs" skeleton={<BoardMapSkeleton />} /></section>
  </div>;
}
function GalleryMap({ board, query, empty, label }: { board: BoardPage; query: BoardQuery; empty: boolean; label: string }) {
  const [kind, setKind] = useState(query.kind), cards = empty ? [] : board.cards;
  return <BoardMap cards={cards.filter(card => matchesBoardKind(card, kind))} counts={empty ? { ...board.counts, all: 0, ready: 0, estimate: 0, bounty: 0 } : board.counts} query={{ ...query, kind }} ownerId={board.meta.ownerId} config={board.meta.map} serverNow={Date.parse(board.before)} onKindChange={setKind} previewState="ready" mapLabel={label} />;
}
