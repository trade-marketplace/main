"use client";

import { useCallback, useId, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Button } from "@/components/Button";
import { QuickFilters } from "@/components/data/QuickFilters";
import { EmptyState } from "@/components/feedback/EmptyState";
import { Skeleton } from "@/components/feedback/Skeleton";
import { Banner } from "@/components/overlays/Banner";
import { MapListLayout } from "@/components/map/MapListLayout";
import type { MapListContext } from "@/components/map/InteractiveMapListLayout";
import { useBountyRemaining } from "@/components/map/MapPin";
import { cardToMapJob, cardsInsideBounds, countsInView, hasApproximatePoint, legendIsClosed, moveBounds, rememberClosedLegend } from "@/lib/board-map";
import { boardCardTag, boardDistanceLabel, boardHref, boardJobHref, type BoardCard, type BoardCounts, type BoardKind, type BoardMapConfig, type BoardQuery } from "@/lib/job-board";
import { workAreaBounds, type MapboxConfig } from "@/lib/map/mapbox";
import { boundsAround, jobCaption, jobOffer, pinName, type Bounds, type MapJob } from "@/lib/map/pins";
import styles from "./board-map.module.css";

type Props = { cards: readonly BoardCard[]; counts?: BoardCounts; query: BoardQuery; ownerId: string; config?: BoardMapConfig; serverNow: number;
  onKindChange: (kind: BoardKind) => void; previewState?: string; previewBasePath?: string; mapLabel?: string };
const KINDS = [{ value: "all", label: "All" }, { value: "ready", label: "Claim" }, { value: "estimate", label: "Estimate" }, { value: "bounty", label: "Bounty" }] as const;
const subscribeLegendStorage = (notify: () => void) => { window.addEventListener("storage", notify); return () => window.removeEventListener("storage", notify); };
const unrememberedLegend = () => false;

/** The board owns its safe facts, URL filters and saved preference; the kit owns the map. */
export function BoardMap({ cards, counts, query, ownerId, config, serverNow, onKindChange, previewState, previewBasePath, mapLabel }: Props) {
  const id = useId(), fake = Boolean(previewState);
  const token = config?.accessToken ?? null, name = config?.workArea?.name, lat = config?.workArea?.centre?.lat, lng = config?.workArea?.centre?.lng, radius = config?.workArea?.radiusKm;
  const provider = useMemo<MapboxConfig | null>(() => name?.trim() && typeof lat === "number" && Number.isFinite(lat) && typeof lng === "number" && Number.isFinite(lng) && typeof radius === "number" && Number.isFinite(radius) && radius > 0
    ? { accessToken: token, workArea: { name, centre: { lat, lng }, radiusKm: radius } } : null, [token, name, lat, lng, radius]);
  const allJobs = useMemo(() => cards.flatMap(card => { const job = cardToMapJob(card); return job ? [job] : []; }), [cards]);
  const fitAll = useMemo(() => boundsAround(cards.flatMap(card => hasApproximatePoint(card) ? [card.point] : [])), [cards]);
  const areaBounds = useMemo(() => provider ? workAreaBounds(provider.workArea) : null, [provider]);
  const initialCamera = useMemo(() => previewState === "nothing-in-view" && fitAll ? moveBounds(fitAll, 3, 3) : previewState === "no-location" ? areaBounds : null, [previewState, fitAll, areaBounds]);
  const [bounds, setBounds] = useState<Bounds | null>(() => fake ? initialCamera ?? fitAll ?? areaBounds : initialCamera ?? areaBounds);
  const [failed, setFailed] = useState(false);
  const unavailable = previewState === "map-unavailable" || failed || !fake && (!provider?.accessToken || !provider.workArea);
  const visibleCards = unavailable ? [...cards] : cardsInsideBounds(cards, bounds);
  const chipCounts = counts ?? countsInView(cards);
  const [selectedId, setSelectedId] = useState<string | null>(() => previewState === "bounty-open" ? allJobs.find(job => job.kind === "bounty")?.id ?? null : previewState === "pin-open" ? allJobs[0]?.id ?? null : null);
  if (selectedId && !visibleCards.some(card => card.id === selectedId && cardToMapJob(card))) setSelectedId(null);
  const rememberedLegend = useSyncExternalStore(subscribeLegendStorage, () => legendIsClosed(ownerId), unrememberedLegend);
  const [legendDismissed, setLegendClosed] = useState(previewState === "legend-closed");
  const reportView = useCallback((next: Bounds) => setBounds(previous => previous && previous.north === next.north && previous.south === next.south && previous.east === next.east && previous.west === next.west ? previous : next), []);
  const previewReturn = previewState ? boardHref(query, previewBasePath ?? "/dev/components/board-map", "state=" + previewState) + (previewState === "chips-estimate" && query.kind === "all" ? "&kind=all" : "") : null;
  const jobHref = (jobId: string) => previewReturn ? "/dev/components/board-map?state=detail&job=" + encodeURIComponent(jobId) + "&back=" + encodeURIComponent(previewReturn) : boardJobHref(jobId, boardHref(query));
  const renderList = (view: MapListContext) => {
    const shown = view.unavailable ? [...cards] : cardsInsideBounds(cards, view.bounds);
    return cards.length === 0 ? <EmptyState title="No jobs match that." icon="search_off" message="Try fewer filters." />
      : shown.length === 0 ? <div className={styles.empty}><h3>No jobs here. Zoom out.</h3><Button variant="secondary" onClick={view.resetView}>Zoom out</Button></div>
      : <ul className={styles.rows} aria-label="Jobs in view">{shown.map(card => <li key={card.id}><MapRow card={card} job={cardToMapJob(card)} listOnly={view.unavailable} serverNow={serverNow}
          hot={view.hotId === card.id || view.selectedId === card.id} selected={view.selectedId === card.id} href={jobHref(card.id)} onHover={view.onHover} onFocus={view.onFocus} onSelect={view.select} /></li>)}</ul>;
  };
  return <section className={styles.board} aria-labelledby={id + "-heading"}>
    <div className={styles.head}><h2 id={id + "-heading"}>{mapLabel && <span className={styles.srOnly}>{mapLabel}: </span>}{visibleCards.length} {visibleCards.length === 1 ? "job" : "jobs"} in view</h2></div>
    <QuickFilters className={styles.chips} label="Map job kind" value={query.kind} onChange={onKindChange} wrap items={KINDS.map(kind => ({ ...kind, count: chipCounts[kind.value], ...(kind.value === "bounty" ? { tone: "gold" as const } : {}) }))} />
    {unavailable && <Banner tone="info" live>Map isn’t available right now.</Banner>}
    <MapListLayout jobs={allJobs} mapbox={provider ?? undefined} bounds={initialCamera ?? undefined} serverNow={serverNow} idPrefix={id}
      selectedId={selectedId} onSelect={setSelectedId} jobHref={job => jobHref(job.id)} onViewChange={reportView}
      locationNote="Showing your work area." approxRadiusMetres={config?.approxRadiusMetres}
      legend={{ open: !(legendDismissed || rememberedLegend), onDismiss: () => { setLegendClosed(true); rememberClosedLegend(ownerId); }, note: "Pin examples. See each job for its offer and time left." }}
      presentation={{ classes: styles, renderList, illustrated: fake, unavailable, fitBounds: fitAll, initialHotId: previewState === "row-hover" ? allJobs[0]?.id : null,
        initialLocation: previewState === "no-location" ? "denied" : "idle", mapLabel, onUnavailable: () => setFailed(true) }} />
  </section>;
}

type RowProps = { card: BoardCard; job: MapJob | null; listOnly: boolean; serverNow: number; hot: boolean; selected: boolean; href: string; onHover: (id: string | null) => void; onFocus: (id: string | null) => void; onSelect: (id: string) => void };
function MapRow(props: RowProps) {
  const { card, job, href } = props;
  if (job) return <MappedRow {...props} job={job} />;
  const tag = boardCardTag(card);
  return <Link className={styles.row} data-kind={card.status === "QUOTE_BOUNTY" ? "bounty" : undefined} href={href}><span className={styles.rowText}><strong>{card.title}</strong><span>{boardDistanceLabel(card.distanceKm)} · {card.suburb} · {card.tradeLabel}</span></span><span className={styles.offer}>{"text" in tag ? tag.text : "Quote from photos"}</span></Link>;
}
function MappedRow({ card, job, listOnly, serverNow, hot, selected, href, onHover, onFocus, onSelect }: RowProps & { job: MapJob }) {
  const remaining = useBountyRemaining(job, serverNow);
  const content = <><span className={styles.rowText}><strong>{card.title}</strong><span>{jobCaption(job)}</span></span><span className={styles.offer}>{jobOffer(job, remaining)}</span></>;
  return listOnly ? <Link className={styles.row} data-kind={job.kind} href={href}>{content}</Link> : <button className={styles.row} data-hot={hot || undefined} data-kind={job.kind} aria-label={pinName(job, remaining)} aria-expanded={selected}
    onMouseEnter={() => onHover(card.id)} onMouseLeave={() => onHover(null)} onFocus={() => onFocus(card.id)} onBlur={() => onFocus(null)} onClick={() => onSelect(card.id)}>{content}</button>;
}

export function BoardMapSkeleton() {
  return <div className={styles.skeleton} aria-hidden="true"><div>{[1, 2, 3, 4, 5].map(value => <Skeleton key={value} height={82} />)}</div><Skeleton height="100%" /></div>;
}
