"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { IconButton } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { boundsAround, estimatePinWidth, groupOverlappingPins, keepInside, metresAsWidthPct, pinText, projectPoint, type Bounds } from "@/lib/map/pins";
import { workAreaBounds } from "@/lib/map/mapbox";
import { moveBounds, scaleBounds, pointInBounds } from "@/lib/board-map";
import { MapCard } from "./MapCard";
import { ApproxArea, ClusterPin, MapPin, type Position } from "./MapPin";
import { MapLegend, MapSurface, YouAreHere } from "./MapSurface";
import { MapboxSurface, type MapboxViewport } from "./MapboxSurface";
import type { MapListLayoutProps } from "./MapListLayout";

export type MapListContext = {
  bounds: Bounds | null; unavailable: boolean; hotId: string | null; selectedId: string | null;
  select: (id: string) => void; onHover: (id: string | null) => void; onFocus: (id: string | null) => void; resetView: () => void;
};
/** Presentation slots preserve caller markup/styles; the kit owns all map primitives and interaction. */
export type MapListPresentation = {
  classes: Record<string, string>; renderList: (context: MapListContext) => ReactNode;
  illustrated?: boolean; unavailable?: boolean; fitBounds?: Bounds | null;
  initialHotId?: string | null; initialLocation?: "idle" | "denied";
  mapLabel?: string; onUnavailable?: () => void;
};
export function InteractiveMapListLayout({ jobs, mapbox, mapboxServices, bounds: initialBounds, serverNow, initialSelectedId = null, selectedId: controlledId,
  onSelect, onViewChange, jobHref, legend, locationNote, approxRadiusMetres, idPrefix = "map", presentation }: MapListLayoutProps & { presentation: MapListPresentation }) {
  const styles = presentation.classes, fake = Boolean(presentation.illustrated);
  const fitAll = useMemo(() => presentation.fitBounds ?? boundsAround(jobs.map(job => job.point)), [presentation.fitBounds, jobs]);
  const areaBounds = useMemo(() => mapbox ? workAreaBounds(mapbox.workArea) : null, [mapbox]);
  const [camera, setCamera] = useState<Bounds | null>(initialBounds ?? null), [viewport, setViewport] = useState<MapboxViewport | null>(null), [failed, setFailed] = useState(false);
  const [location, setLocation] = useState<"idle" | "denied" | "found">(presentation.initialLocation ?? "idle");
  const [ownSelectedId, setOwnSelectedId] = useState<string | null>(initialSelectedId);
  const selectedId = controlledId === undefined ? ownSelectedId : controlledId;
  const setSelectedId = (value: string | null) => { if (controlledId === undefined) setOwnSelectedId(value); onSelect?.(value); };
  const [hoveredId, setHoveredId] = useState<string | null>(presentation.initialHotId ?? null), [focusedId, setFocusedId] = useState<string | null>(null);
  const canvas = useRef<HTMLDivElement>(null), list = useRef<HTMLDivElement>(null), cardSlot = useRef<HTMLDivElement>(null), pinButtons = useRef(new Map<string, HTMLButtonElement>()), zoomOutButton = useRef<HTMLButtonElement>(null);
  const keyboardSelect = useRef(false), drag = useRef<{ x: number; y: number; bounds: Bounds } | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const unavailable = Boolean(presentation.unavailable || failed || !fake && !mapbox?.accessToken);
  const bounds = fake ? camera ?? fitAll ?? areaBounds : viewport?.bounds ?? camera ?? areaBounds;
  const visibleJobs = jobs.filter(job => !bounds || pointInBounds(job.point, bounds));
  const selected = visibleJobs.find(job => job.id === selectedId) ?? null;
  const hotId = hoveredId ?? focusedId ?? selectedId;
  useEffect(() => { if (fake && bounds) onViewChange?.(bounds); }, [fake, bounds, onViewChange]);
  useEffect(() => {
    const element = canvas.current; if (!element || unavailable) return;
    const observer = new ResizeObserver(() => setSize({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element); return () => observer.disconnect();
  }, [unavailable]);
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
  const choose = (id: string) => {
    setSelectedId(id);
    if (keyboardSelect.current) requestAnimationFrame(() => cardSlot.current?.querySelector<HTMLAnchorElement>("a[href]")?.focus());
  };
  const resetView = () => setCamera(fitAll ?? areaBounds);
  const clusterZoom = (members: readonly { id: string }[]) => {
    setCamera(boundsAround(members.map(member => byId.get(member.id)!.job.point), 0.3, 0.0002));
    requestAnimationFrame(focusZoom);
  };
  const youAt = fake && mapbox && bounds ? projectPoint(mapbox.workArea.centre, bounds) : null;
  const pins = <>
    {youAt && <YouAreHere x={youAt.x} y={youAt.y} />}
    {bounds && hotId && byId.has(hotId) && approxRadiusMetres ? <ApproxArea position={atPin(hotId)} widthPct={metresAsWidthPct(approxRadiusMetres * 2, bounds)} /> : null}
    {groups.map(group => group.members.length === 1 ? <div key={group.lead.id} data-map-pin={group.lead.id}
      ref={element => { const button = element?.querySelector("button"); if (button) pinButtons.current.set(group.lead.id, button); else pinButtons.current.delete(group.lead.id); }}
      onFocusCapture={() => setFocusedId(group.lead.id)} onBlurCapture={() => setFocusedId(null)}>
      <MapPin job={byId.get(group.lead.id)!.job} position={atPin(group.lead.id)} serverNow={serverNow} hot={hotId === group.lead.id || selectedId === group.lead.id} selected={selectedId === group.lead.id} onHotChange={setHoveredId} onSelect={choose} />
    </div> : <ClusterPin key={"cluster-" + group.lead.id} count={group.members.length} bounties={group.members.filter(member => byId.get(member.id)?.job.kind === "bounty").length} position={atPin(group.lead.id)} atPin onZoom={() => clusterZoom(group.members)} />)}
  </>;
  return <div className={styles.layout + (unavailable ? " " + styles.listOnly : "")}
    onPointerDownCapture={() => { keyboardSelect.current = false; }} onKeyDownCapture={event => { keyboardSelect.current = event.key === "Enter" || event.key === " "; }}
    onKeyDown={event => { if (event.key === "Escape" && selectedId) { event.preventDefault(); event.stopPropagation(); close(); } }}>
    <div className={styles.list} ref={list}><MapListRows render={presentation.renderList} context={{ bounds, unavailable, hotId, selectedId, select: choose, onHover: setHoveredId, onFocus: setFocusedId, resetView }} /></div>
    {!unavailable && <div className={styles.map}>
      <div className={styles.canvas} ref={canvas} role={fake ? "region" : undefined} tabIndex={fake ? 0 : undefined} aria-label={fake ? (presentation.mapLabel ? presentation.mapLabel + ". " : "") + "Move map with arrow keys" : undefined}
        onKeyDown={event => { if (!fake || event.target !== event.currentTarget || !bounds) return; const shift = { ArrowLeft: [-0.7, 0], ArrowRight: [0.7, 0], ArrowUp: [0, 0.7], ArrowDown: [0, -0.7] }[event.key]; if (shift) { event.preventDefault(); setCamera(moveBounds(bounds, shift[0], shift[1])); } }}
        onPointerDown={event => { if (!fake || event.target instanceof Element && event.target.closest("button,a") || !bounds) return; drag.current = { x: event.clientX, y: event.clientY, bounds }; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerUp={event => { const start = drag.current; drag.current = null; if (start && size) setCamera(moveBounds(start.bounds, (start.x - event.clientX) / size.width, (event.clientY - start.y) / size.height)); }}>
        {fake ? <MapSurface label={presentation.mapLabel ?? "Map of jobs in view"}>{pins}</MapSurface> : mapbox ? <MapboxSurface config={mapbox} services={mapboxServices} bounds={camera ?? undefined} label={presentation.mapLabel ?? "Map of jobs in view"}
          locationNote={locationNote} messageClassName={styles.mapNote} onViewChange={view => { setViewport(view); onViewChange?.(view.bounds); }} onFailure={() => {
            const restore = canvas.current?.contains(document.activeElement); setSelectedId(null); setFailed(true); presentation.onUnavailable?.();
            if (restore) requestAnimationFrame(() => list.current?.querySelector<HTMLElement>("a,button")?.focus());
          }}>{pins}</MapboxSurface> : null}
        {fake && <div className={styles.controls}>
          <button aria-label="Zoom in" onClick={() => bounds && setCamera(scaleBounds(bounds, 0.5))}><Icon name="add" decorative /></button>
          <button ref={zoomOutButton} aria-label="Zoom out" onClick={() => bounds && setCamera(scaleBounds(bounds, 2))}><Icon name="remove" decorative /></button>
          <button aria-label="Use my location" onClick={() => { setLocation(presentation.initialLocation === "denied" ? "denied" : "found"); setCamera(areaBounds ?? fitAll); }}><Icon name="my_location" decorative /></button>
        </div>}
        {fake && location === "denied" && <p className={styles.mapNote} role="status">{locationNote ?? "Showing your work area."}</p>}
        {fake && location === "found" && <span className={styles.srOnly} role="status">Map centred on your location.</span>}
        {selected && <div className={styles.cardSlot} ref={cardSlot}><MapCard job={selected} serverNow={serverNow} id={idPrefix + "-card"} href={jobHref?.(selected)} onClose={close} /></div>}
      </div>
      {(!legend || legend.open) && !selected && <div className={styles.legend}><MapLegend items={legend?.items} />{legend?.note && <p className={styles.legendNote}>{legend.note}</p>}{legend && <span className={styles.legendClose}><IconButton icon="close" label="Close map legend" onClick={() => { legend.onDismiss(); requestAnimationFrame(focusZoom); }} /></span>}</div>}
    </div>}
  </div>;
}

/** Keep the renderer a stable React boundary, so callback props never execute during map rendering. */
function MapListRows({ render, context }: { render: MapListPresentation["renderList"]; context: MapListContext }) {
  return render(context);
}
