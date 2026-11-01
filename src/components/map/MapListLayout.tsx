"use client";
// The map + list layout (#82): D03 on wide screens (list left, map right) and D18 on phones (map, then the list).
// Hovering or focusing a row grows its pin, and the reverse (M21). Picking a pin or a row opens its card over the
// map; Esc or the close control shuts it and puts focus back. Pins that would overlap merge into a cluster;
// pressing one zooms in to fit its jobs. With mapbox config the canvas and camera are real; the kit preview
// can still use the offline illustrated surface.
//
// Every job's point must come from jobPinFor() (#97): unclaimed jobs only ever have their approximate pin here.
import { type KeyboardEvent, type RefObject, useEffect, useMemo, useRef, useState } from "react";

import { Icon } from "@/components/Icon";
import {
  type Bounds,
  boundsAround,
  estimatePinWidth,
  groupOverlappingPins,
  isExpired,
  jobCaption,
  keepInside,
  jobOffer,
  type MapJob,
  metresAsWidthPct,
  pinName,
  pinText,
  projectPoint,
} from "@/lib/map/pins";
import type { Point } from "@/lib/geo/distance";

import { MapCard } from "./MapCard";
import { ApproxArea, ClusterPin, MapPin, pinLook, type Position, useBountyRemaining } from "./MapPin";
import { MapLegend, MapSurface, YouAreHere } from "./MapSurface";
import { MapboxSurface, type MapboxServices, type MapboxViewport } from "./MapboxSurface";
import type { MapboxConfig } from "@/lib/map/mapbox";
import styles from "./map.module.css";

const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");

export type MapListState = "ready" | "loading" | "empty" | "error";

export type MapListLayoutProps = {
  /** Omit for the offline kit illustration. Pass server-loaded config for the real provider. */
  mapbox?: MapboxConfig;
  /** Offline test/preview adapter; production uses the pinned Mapbox loader and browser location. */
  mapboxServices?: MapboxServices;
  jobs: readonly MapJob[];
  /** What the map shows at first. Default: fits every job. */
  bounds?: Bounds;
  /** Render time (epoch ms), for bounty countdowns. */
  serverNow: number;
  state?: MapListState;
  /** The list's heading, e.g. "24 jobs in view". Default: counts the jobs. */
  heading?: string;
  headingLevel?: 2 | 3;
  /** Open this job's card at first (e.g. the job in the URL). */
  initialSelectedId?: string | null;
  /** The viewer's position, as the blue dot. */
  you?: Point | null;
  /**
   * The approximate pin's furthest distance from the address (APPROX_MAX_METRES, #97), to draw the area an
   * unclaimed job's pin stands for when it's hovered or selected. Leave it out to draw no area.
   */
  approxRadiusMetres?: number;
  /** For a unique id per layout on the page. */
  idPrefix?: string;
};

export function MapListLayout({
  jobs,
  mapbox,
  mapboxServices,
  bounds: initialBounds,
  serverNow,
  state = "ready",
  heading,
  headingLevel = 2,
  initialSelectedId = null,
  you = null,
  approxRadiusMetres,
  idPrefix = "map",
}: MapListLayoutProps) {
  const fitAll = useMemo(
    () => initialBounds ?? boundsAround(jobs.map((j) => j.point)) ?? undefined,
    [initialBounds, jobs],
  );
  const [zoomed, setZoomed] = useState<Bounds | null>(null);
  const cameraBounds = zoomed ?? fitAll;
  const providerKey = mapbox ? JSON.stringify([mapbox.accessToken, mapbox.workArea]) : "";
  type ProviderRequest = { key: string; loader: MapboxServices["load"] };
  const [providerView, setProviderView] = useState<(ProviderRequest & { view: MapboxViewport }) | null>(null);
  const [failedProvider, setFailedProvider] = useState<ProviderRequest | null>(null);
  const currentProvider = (request: ProviderRequest | null) => request?.key === providerKey && request.loader === mapboxServices?.load;
  const viewport = providerView && currentProvider(providerView) ? providerView.view : null;
  const mapFailed = currentProvider(failedProvider);
  const listOnly = !!mapbox && (!mapbox.accessToken || mapFailed);
  const bounds = viewport?.bounds ?? cameraBounds;
  const [hotId, setHotId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const mapRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(mapRef, !listOnly);
  const returnFocus = useRef<HTMLElement | null>(null);
  const showAllRef = useRef<HTMLButtonElement>(null);
  // The cluster that was pressed is gone once zoomed in: keep focus on the map, on "Show all jobs".
  useEffect(() => {
    if (zoomed) showAllRef.current?.focus();
  }, [zoomed]);

  const ready = state === "ready";
  const placed = useMemo(() => {
    if (!ready) return [];
    if (listOnly || (mapbox && !viewport)) return jobs.map((job) => ({ job, at: { x: 50, y: 50 } }));
    if (!bounds) return [];
    return jobs.flatMap((job) => {
      const at = mapbox && viewport && size ? viewport.project(job.point) : projectPoint(job.point, bounds);
      return at ? [{ job, at }] : [];
    });
  }, [jobs, bounds, ready, listOnly, mapbox, viewport, size]);

  // Merge pins that would overlap at this size. Before the size is known (server HTML), every pin shows.
  type Shown = (typeof placed)[number] & { pos: Position };
  const groups = useMemo((): { lead: Shown; members: Shown[] }[] => {
    if (!size) return placed.map((p) => ({ lead: { ...p, pos: p.at }, members: [{ ...p, pos: p.at }] }));
    const pins = placed.map(({ job, at }) => ({
      id: job.id,
      x: (at.x / 100) * size.width,
      y: (at.y / 100) * size.height,
      width: estimatePinWidth(pinText(job, null), job.kind !== "claim"),
      bounty: job.kind === "bounty",
    }));
    const byId = new Map(
      placed.map((p, i) => [p.job.id, { ...p, pos: { ...keepInside(pins[i], size.width, size.height), unit: "px" as const } }]),
    );
    return groupOverlappingPins(pins, selectedId).map((g) => ({
      lead: byId.get(g.lead.id)!,
      members: g.members.map((m) => byId.get(m.id)!),
    }));
  }, [placed, size, selectedId]);

  const selected = ready ? (jobs.find((j) => j.id === selectedId) ?? null) : null;
  const cardId = `${idPrefix}-card`;
  const listHeadingId = `${idPrefix}-heading`;
  const areaPct = bounds && approxRadiusMetres ? metresAsWidthPct(approxRadiusMetres * 2, bounds) : 0;
  const visibleCount = placed.length;
  const title = heading ?? (state === "loading" ? "Finding jobs…" : `${visibleCount} ${visibleCount === 1 ? "job" : "jobs"} ${listOnly ? "nearby" : "in view"}`);
  const Heading = `h${headingLevel}` as const;

  const select = (id: string, from: HTMLElement | null) => {
    if (selectedId === id) {
      setSelectedId(null);
      return;
    }
    returnFocus.current = from;
    setSelectedId(id);
  };
  const close = () => {
    setSelectedId(null);
    returnFocus.current?.focus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && selectedId) {
      event.stopPropagation();
      close();
    }
  };

  const hotOrSelected = (id: string) => hotId === id || selectedId === id;
  const ringFor =
    areaPct > 0 &&
    groups.find((g) => g.members.length === 1 && g.lead.job.precision === "approximate" && hotOrSelected(g.lead.job.id))?.lead;

  return (
    <div className={cx(styles.layout, listOnly && styles.listOnly)} onKeyDown={onKeyDown}>
      <div className={styles.grid}>
        <div className={styles.listArea}>
          <div className={styles.listHead}>
            <Heading id={listHeadingId} className={styles.listTitle}>
              {title}
            </Heading>
          </div>
          {listOnly && <p role="status" className={styles.providerNotice}>Map unavailable. Showing jobs in a list.</p>}
          {state === "loading" && <ListSkeleton />}
          {state === "error" && (
            <div className={cx(styles.message, styles.messageError)} role="alert">
              <b>Couldn’t load jobs</b>
              <p>Check your connection, then move the map to try again.</p>
            </div>
          )}
          {state === "empty" && (
            <div className={styles.message}>
              <b>No jobs in view</b>
              <p>Zoom out or move the map to see jobs further away.</p>
            </div>
          )}
          {ready && placed.length > 0 && (
            <ul className={styles.rows} aria-labelledby={listHeadingId}>
              {placed.map(({ job }) => (
                <li key={job.id}>
                  <JobRow
                    job={job}
                    serverNow={serverNow}
                    hot={hotOrSelected(job.id)}
                    selected={selectedId === job.id}
                    controls={selectedId === job.id ? cardId : undefined}
                    onHotChange={setHotId}
                    onSelect={select}
                  />
                </li>
              ))}
            </ul>
          )}
          {ready && placed.length === 0 && (
            <div className={styles.message}>
              <b>No jobs in view</b>
              <p>Zoom out or move the map to see jobs further away.</p>
            </div>
          )}
          {listOnly && selected && (
            <div className={styles.listCard}>
              <MapCard job={selected} serverNow={serverNow} id={cardId} headingLevel={headingLevel === 2 ? 3 : 4} onClose={close} />
            </div>
          )}
          <MapLegend className={styles.legendInList} />
        </div>

        {!listOnly && <div className={styles.mapArea} ref={mapRef}>
          <ProviderSurface config={mapbox} services={mapboxServices} bounds={cameraBounds} label={`Map of ${title}`} onViewChange={(view) => setProviderView({ key: providerKey, loader: mapboxServices?.load, view })} onFailure={() => setFailedProvider({ key: providerKey, loader: mapboxServices?.load })}>
            {you && bounds && <YouDot you={you} bounds={bounds} />}
            {ringFor && <ApproxArea position={ringFor.pos} widthPct={areaPct} />}
            {(!mapbox || (viewport && size)) && groups.map(({ lead, members }, i) =>
              members.length === 1 ? (
                <MapPin
                  key={lead.job.id}
                  job={lead.job}
                  position={lead.pos}
                  serverNow={serverNow}
                  hot={hotOrSelected(lead.job.id)}
                  selected={selectedId === lead.job.id}
                  drop
                  index={i}
                  onHotChange={setHotId}
                  onSelect={(id) => select(id, document.activeElement as HTMLElement | null)}
                />
              ) : (
                <ClusterPin
                  key={`cluster-${lead.job.id}`}
                  count={members.length}
                  bounties={members.filter((m) => m.job.kind === "bounty").length}
                  position={lead.pos}
                  atPin
                  onZoom={() => setZoomed(boundsAround(members.map((m) => m.job.point), 0.35))}
                />
              ),
            )}
            {state === "loading" && <p className={styles.mapMessage}>Finding jobs…</p>}
            {(state === "empty" || (ready && placed.length === 0)) && (
              <p className={styles.mapMessage}>No jobs in view</p>
            )}
          </ProviderSurface>
          {zoomed && (
            <button ref={showAllRef} type="button" className={styles.mapControl} onClick={() => setZoomed(null)}>
              <Icon name="zoom_out_map" decorative size="sm" />
              Show all jobs
            </button>
          )}
          {ready && <MapLegend card className={styles.legendOnMap} />}
          {selected && (
            <div className={styles.cardSlot}>
              <MapCard job={selected} serverNow={serverNow} id={cardId} headingLevel={headingLevel === 2 ? 3 : 4} onClose={close} />
            </div>
          )}
        </div>}
      </div>
    </div>
  );
}

function ProviderSurface({ config, services, children, ...props }: {
  config?: MapboxConfig;
  services?: MapboxServices;
  children: React.ReactNode;
  bounds?: Bounds;
  label: string;
  onViewChange: (view: MapboxViewport) => void;
  onFailure: () => void;
}) {
  return config ? <MapboxSurface config={config} services={services} {...props}>{children}</MapboxSurface>
    : <MapSurface label={props.label}>{children}</MapSurface>;
}

function YouDot({ you, bounds }: { you: Point; bounds: Bounds }) {
  const at = projectPoint(you, bounds);
  return at ? <YouAreHere x={at.x} y={at.y} /> : null;
}

type JobRowProps = {
  job: MapJob;
  serverNow: number;
  hot: boolean;
  selected: boolean;
  controls?: string;
  onHotChange: (id: string | null) => void;
  onSelect: (id: string, from: HTMLElement | null) => void;
};

/** A list row. Long titles and suburbs are cut with "…" and shown whole in a tooltip (and in the button's name). */
function JobRow({ job, serverNow, hot, selected, controls, onHotChange, onSelect }: JobRowProps) {
  const remaining = useBountyRemaining(job, serverNow);
  const caption = jobCaption(job);
  const offer = jobOffer(job, remaining);
  const expired = job.kind === "bounty" && remaining !== null && isExpired(remaining);
  return (
    <button
      type="button"
      className={styles.row}
      data-hot={hot ? "true" : undefined}
      aria-expanded={selected}
      aria-controls={controls}
      aria-label={pinName(job, remaining)}
      title={`${job.title} · ${caption}`}
      onMouseEnter={() => onHotChange(job.id)}
      onMouseLeave={() => onHotChange(null)}
      onFocus={() => onHotChange(job.id)}
      onBlur={() => onHotChange(null)}
      onClick={(event) => onSelect(job.id, event.currentTarget)}
    >
      <span className={cx(styles.rowMark, expired ? styles.expired : pinLook(job, remaining))} aria-hidden="true" />
      <span className={styles.rowText} aria-hidden="true">
        <span className={cx(styles.rowTitle, styles.truncate)}>{job.title}</span>
        <span className={cx(styles.caption, styles.truncate)}>{caption}</span>
      </span>
      <span className={styles.rowOffer} aria-hidden="true">
        {offer}
      </span>
    </button>
  );
}

function ListSkeleton() {
  return (
    <div aria-busy="true">
      <p role="status" className={styles.srOnly}>
        Loading jobs
      </p>
      <div className={styles.rows} aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className={cx("tm-skel", styles.skelRow)} />
        ))}
      </div>
    </div>
  );
}

/** The element's size in px, kept up to date. Null until measured (on the server and while hydrating). */
function useElementSize(ref: RefObject<HTMLElement | null>, active = true): { width: number; height: number } | null {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!active || !el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      // Read the current box, not a queued entry from an intermediate layout (e.g. full-page captures).
      const width = el.clientWidth, height = el.clientHeight;
      if (width <= 1 || height <= 1) return;
      setSize((old) => (old && old.width === width && old.height === height ? old : { width, height }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, active]);
  return size;
}
