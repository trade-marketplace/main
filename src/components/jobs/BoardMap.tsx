"use client";

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { Button, IconButton } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { QuickFilters } from "@/components/data/QuickFilters";
import { EmptyState } from "@/components/feedback/EmptyState";
import { Skeleton } from "@/components/feedback/Skeleton";
import { Banner } from "@/components/overlays/Banner";
import { MapCard } from "@/components/map/MapCard";
import { MapboxSurface, type MapboxViewport } from "@/components/map/MapboxSurface";
import { ApproxArea, ClusterPin, MapPin, useBountyRemaining, type Position } from "@/components/map/MapPin";
import { MapLegend, MapSurface, YouAreHere } from "@/components/map/MapSurface";
import { cardToMapJob, cardsInsideBounds, countsInView, hasApproximatePoint, legendIsClosed, moveBounds, rememberClosedLegend, scaleBounds } from "@/lib/board-map";
import { boardCardTag, boardDistanceLabel, boardHref, boardJobHref, type BoardCard, type BoardCounts, type BoardKind, type BoardMapConfig, type BoardQuery } from "@/lib/job-board";
import { requestCurrentLocation, workAreaBounds, type MapboxConfig } from "@/lib/map/mapbox";
import { boundsAround, estimatePinWidth, groupOverlappingPins, jobCaption, jobOffer, keepInside, metresAsWidthPct, pinName, pinText, projectPoint, type Bounds, type MapJob } from "@/lib/map/pins";
import styles from "./board-map.module.css";

type Props = { cards: readonly BoardCard[]; counts?: BoardCounts; query: BoardQuery; ownerId: string; config?: BoardMapConfig; serverNow: number;
  onKindChange: (kind: BoardKind) => void; previewState?: string; previewBasePath?: string; mapLabel?: string };
const KINDS = [{ value: "all", label: "All" }, { value: "ready", label: "Claim" }, { value: "estimate", label: "Estimate" }, { value: "bounty", label: "Bounty" }] as const;
const subscribeLegendStorage = (notify: () => void) => {
  window.addEventListener("storage", notify);
  return () => window.removeEventListener("storage", notify);
};
const unrememberedLegend = () => false;

/** Board-specific state around the unchanged map kit. MapListLayout's missing slots are tracked in #534. */
export function BoardMap({ cards, counts, query, ownerId, config, serverNow, onKindChange, previewState, previewBasePath, mapLabel }: Props) {
  const id = useId(), fake = Boolean(previewState);
  const token = config?.accessToken ?? null, name = config?.workArea?.name, lat = config?.workArea?.centre?.lat, lng = config?.workArea?.centre?.lng, radius = config?.workArea?.radiusKm;
  const provider = useMemo<MapboxConfig | null>(() => name?.trim() && typeof lat === "number" && Number.isFinite(lat) && typeof lng === "number" && Number.isFinite(lng) && typeof radius === "number" && Number.isFinite(radius) && radius > 0
    ? { accessToken: token, workArea: { name, centre: { lat, lng }, radiusKm: radius } } : null, [token, name, lat, lng, radius]);
  const allJobs = useMemo(() => cards.flatMap(card => { const job = cardToMapJob(card); return job ? [job] : []; }), [cards]);
  const fitAll = useMemo(() => boundsAround(cards.flatMap(card => hasApproximatePoint(card) ? [card.point] : [])), [cards]);
  const areaBounds = useMemo(() => provider ? workAreaBounds(provider.workArea) : null, [provider]);
  const [camera, setCamera] = useState<Bounds | null>(() => previewState === "nothing-in-view" && fitAll ? moveBounds(fitAll, 3, 3) : previewState === "no-location" ? areaBounds : null);
  const [viewport, setViewport] = useState<MapboxViewport | null>(null), [failed, setFailed] = useState(false);
  const [location, setLocation] = useState<"idle" | "pending" | "denied" | "found">(previewState === "no-location" ? "denied" : "idle");
  const rememberedLegend = useSyncExternalStore(subscribeLegendStorage, () => legendIsClosed(ownerId), unrememberedLegend);
  const [legendDismissed, setLegendClosed] = useState(previewState === "legend-closed");
  const legendClosed = legendDismissed || rememberedLegend;
  const [selectedId, setSelectedId] = useState<string | null>(() => previewState === "bounty-open" ? allJobs.find(job => job.kind === "bounty")?.id ?? null : previewState === "pin-open" ? allJobs[0]?.id ?? null : null);
  const [hoveredId, setHoveredId] = useState<string | null>(previewState === "row-hover" ? allJobs[0]?.id ?? null : null), [focusedId, setFocusedId] = useState<string | null>(null);
  const canvas = useRef<HTMLDivElement>(null), list = useRef<HTMLDivElement>(null), cardSlot = useRef<HTMLDivElement>(null), pinButtons = useRef(new Map<string, HTMLButtonElement>()), zoomOutButton = useRef<HTMLButtonElement>(null);
  const keyboardSelect = useRef(false), drag = useRef<{ x: number; y: number; bounds: Bounds } | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const unavailable = previewState === "map-unavailable" || failed || !fake && (!provider?.accessToken || !provider.workArea);
  const bounds = fake ? camera ?? fitAll ?? areaBounds : viewport?.bounds ?? camera ?? areaBounds;
  const visibleCards = unavailable ? [...cards] : cardsInsideBounds(cards, bounds);
  const chipCounts = counts ?? countsInView(cards);
  const visibleJobs = visibleCards.flatMap(card => { const job = cardToMapJob(card); return job ? [job] : []; });
  const selected = visibleJobs.find(job => job.id === selectedId) ?? null;
  if (selectedId && !selected) setSelectedId(null);
  const hotId = hoveredId ?? focusedId ?? selectedId;

  useEffect(() => {
    const element = canvas.current; if (!element || unavailable) return;
    const observer = new ResizeObserver(() => setSize({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element); return () => observer.disconnect();
  }, [unavailable]);
  const locate = useMemo(() => async () => {
    setLocation("pending");
    try { const point = await requestCurrentLocation(); setLocation("found"); return point; }
    catch (error) { setLocation("denied"); throw error; }
  }, []);
  const services = useMemo(() => ({ locate }), [locate]);

  const placed = visibleJobs.flatMap(job => {
    const at = fake && bounds ? projectPoint(job.point, bounds) : viewport?.project(job.point);
    return at ? [{ job, at }] : [];
  });
  const positioned = placed.map(({ job, at }) => ({ job, at, pixel: { id: job.id, x: at.x / 100 * (size?.width ?? 1), y: at.y / 100 * (size?.height ?? 1), width: estimatePinWidth(pinText(job, null), job.kind !== "claim"), bounty: job.kind === "bounty" } }));
  const byId = new Map(positioned.map(item => [item.job.id, item]));
  const protectedIds = new Set([selectedId, hoveredId, focusedId].filter(Boolean));
  const groups = size ? [
    ...positioned.filter(item => protectedIds.has(item.job.id)).map(item => ({ lead: item.pixel, members: [item.pixel] })),
    ...groupOverlappingPins(positioned.filter(item => !protectedIds.has(item.job.id)).map(item => item.pixel)),
  ] : positioned.map(item => ({ lead: item.pixel, members: [item.pixel] }));
  const atPin = (pinId: string): Position => {
    const item = byId.get(pinId)!;
    return size ? { ...keepInside(item.pixel, size.width, size.height), unit: "px" } : item.at;
  };
  const focusZoom = () => (zoomOutButton.current ?? canvas.current?.querySelector<HTMLButtonElement>('button[aria-label="Zoom out"]'))?.focus();
  const close = () => {
    const previous = selectedId; setSelectedId(null); setFocusedId(previous);
    requestAnimationFrame(() => { const pin = previous ? pinButtons.current.get(previous) : null; if (pin?.isConnected) pin.focus(); else focusZoom(); });
  };
  const choose = (jobId: string) => {
    setSelectedId(jobId);
    if (keyboardSelect.current) requestAnimationFrame(() => cardSlot.current?.querySelector<HTMLAnchorElement>("a[href]")?.focus());
  };
  const previewReturn = previewState ? `${boardHref(query, previewBasePath ?? "/dev/components/board-map", `state=${previewState}`)}${previewState === "chips-estimate" && query.kind === "all" ? "&kind=all" : ""}` : null;
  const jobHref = (jobId: string) => previewReturn
    ? `/dev/components/board-map?state=detail&job=${encodeURIComponent(jobId)}&back=${encodeURIComponent(previewReturn)}`
    : boardJobHref(jobId, boardHref(query));
  const zoomOut = () => { setCamera(fitAll ?? areaBounds); };
  const clusterZoom = (members: readonly { id: string }[]) => {
    setCamera(boundsAround(members.map(member => byId.get(member.id)!.job.point), 0.3, 0.0002));
    requestAnimationFrame(focusZoom);
  };
  const youAt = fake && provider && bounds ? projectPoint(provider.workArea.centre, bounds) : null;
  const mapContent: ReactNode = <>
    {youAt && <YouAreHere x={youAt.x} y={youAt.y} />}
    {bounds && hotId && byId.has(hotId) && config?.approxRadiusMetres ? <ApproxArea position={atPin(hotId)} widthPct={metresAsWidthPct(config.approxRadiusMetres * 2, bounds)} /> : null}
    {groups.map(group => group.members.length === 1 ? <div key={group.lead.id} data-map-pin={group.lead.id}
      ref={element => { const button = element?.querySelector("button"); if (button) pinButtons.current.set(group.lead.id, button); else pinButtons.current.delete(group.lead.id); }}
      onFocusCapture={() => setFocusedId(group.lead.id)} onBlurCapture={() => setFocusedId(null)}>
      <MapPin job={byId.get(group.lead.id)!.job} position={atPin(group.lead.id)} serverNow={serverNow} hot={hotId === group.lead.id || selectedId === group.lead.id} selected={selectedId === group.lead.id} onHotChange={setHoveredId} onSelect={choose} />
    </div> : <ClusterPin key={`cluster-${group.lead.id}`} count={group.members.length} bounties={group.members.filter(member => byId.get(member.id)?.job.kind === "bounty").length} position={atPin(group.lead.id)} atPin onZoom={() => clusterZoom(group.members)} />)}
  </>;

  return <section className={styles.board} aria-labelledby={`${id}-heading`} onPointerDownCapture={() => { keyboardSelect.current = false; }} onKeyDownCapture={event => { keyboardSelect.current = event.key === "Enter" || event.key === " "; }} onKeyDown={event => {
    if (event.key === "Escape" && selectedId) { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    <div className={styles.head}><h2 id={`${id}-heading`}>{mapLabel && <span className={styles.srOnly}>{mapLabel}: </span>}{visibleCards.length} {visibleCards.length === 1 ? "job" : "jobs"} in view</h2></div>
    <QuickFilters className={styles.chips} label="Map job kind" value={query.kind} onChange={onKindChange} wrap items={KINDS.map(kind => ({ ...kind, count: chipCounts[kind.value], ...(kind.value === "bounty" ? { tone: "gold" as const } : {}) }))} />
    {unavailable && <Banner tone="info" live>Map isn’t available right now.</Banner>}
    <div className={`${styles.layout} ${unavailable ? styles.listOnly : ""}`}>
      <div className={styles.list} ref={list}>
        {cards.length === 0 ? <EmptyState title="No jobs match that." icon="search_off" message="Try fewer filters." />
          : visibleCards.length === 0 ? <div className={styles.empty}><h3>No jobs here. Zoom out.</h3><Button variant="secondary" onClick={zoomOut}>Zoom out</Button></div>
            : <ul className={styles.rows} aria-label="Jobs in view">{visibleCards.map(card => <li key={card.id}><MapRow card={card} job={cardToMapJob(card)} listOnly={unavailable} serverNow={serverNow} hot={hotId === card.id || selectedId === card.id} selected={selectedId === card.id} href={jobHref(card.id)} onHover={setHoveredId} onFocus={setFocusedId} onSelect={choose} /></li>)}</ul>}
      </div>
      {!unavailable && <div className={styles.map}>
        <div className={styles.canvas} ref={canvas} role={fake ? "region" : undefined} tabIndex={fake ? 0 : undefined} aria-label={fake ? `${mapLabel ? `${mapLabel}. ` : ""}Move map with arrow keys` : undefined}
          onKeyDown={event => { if (!fake || event.target !== event.currentTarget || !bounds) return; const shift = { ArrowLeft: [-0.7, 0], ArrowRight: [0.7, 0], ArrowUp: [0, 0.7], ArrowDown: [0, -0.7] }[event.key]; if (shift) { event.preventDefault(); setCamera(moveBounds(bounds, shift[0], shift[1])); } }}
          onPointerDown={event => { if (!fake || event.target instanceof Element && event.target.closest("button,a") || !bounds) return; drag.current = { x: event.clientX, y: event.clientY, bounds }; event.currentTarget.setPointerCapture(event.pointerId); }}
          onPointerUp={event => { const start = drag.current; drag.current = null; if (start && size) setCamera(moveBounds(start.bounds, (start.x - event.clientX) / size.width, (event.clientY - start.y) / size.height)); }}>
          {fake ? <MapSurface label={mapLabel ?? "Map of jobs in view"}>{mapContent}</MapSurface> : provider ? <MapboxSurface config={provider} services={services} bounds={camera ?? undefined} label={mapLabel ?? "Map of jobs in view"} onViewChange={setViewport} onFailure={() => {
            const restore = canvas.current?.contains(document.activeElement); setSelectedId(null); setFailed(true);
            if (restore) requestAnimationFrame(() => list.current?.querySelector<HTMLElement>("a,button")?.focus());
          }}>{mapContent}</MapboxSurface> : null}
          {fake && <div className={styles.controls}>
            <button aria-label="Zoom in" onClick={() => bounds && setCamera(scaleBounds(bounds, 0.5))}><Icon name="add" decorative /></button>
            <button ref={zoomOutButton} aria-label="Zoom out" onClick={() => bounds && setCamera(scaleBounds(bounds, 2))}><Icon name="remove" decorative /></button>
            <button aria-label="Use my location" onClick={() => { setLocation(previewState === "no-location" ? "denied" : "found"); setCamera(areaBounds ?? fitAll); }}><Icon name="my_location" decorative /></button>
          </div>}
          {(!fake && !viewport || location === "pending") && <p className={styles.mapNote} role="status">{location === "pending" ? "Finding your location…" : "Loading map…"}</p>}
          {location === "denied" && <p className={styles.mapNote} role="status">Showing your work area.</p>}
          {location === "found" && <span className={styles.srOnly} role="status">Map centred on your location.</span>}
          {selected && <div className={styles.cardSlot} ref={cardSlot}><MapCard job={selected} serverNow={serverNow} id={`${id}-card`} href={jobHref(selected.id)} onClose={close} /></div>}
        </div>
        {!legendClosed && !selected && <div className={styles.legend}><MapLegend /><p className={styles.legendNote}>Pin examples. See each job for its offer and time left.</p><span className={styles.legendClose}><IconButton icon="close" label="Close map legend" onClick={() => { setLegendClosed(true); rememberClosedLegend(ownerId); requestAnimationFrame(focusZoom); }} /></span></div>}
      </div>}
    </div>
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
