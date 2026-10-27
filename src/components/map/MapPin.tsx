"use client";
// Map pins (#82): one pin per job, and a cluster for pins that would overlap. Each is a real button with a
// full name ("Bounty: Hot water cylinder, Gladstone, 3 h left"), so keyboard and screen-reader users can reach
// every job. Motion is the shared M21/M27 classes from src/styles/motion.css: .tm-pin (hover grow),
// .tm-anim-pin (drop in), .tm-glint (bounty shimmer). Reduced motion is handled there.
//
// Positions are percentages (or px) of the map surface: projectPoint() on the kit illustration, Mapbox.project()
// over the real canvas. The same accessible button is used on both. The point must come from jobPinFor()
// (#97): the approximate pin unless this viewer claimed the job.
import type { CSSProperties } from "react";

import { Icon } from "@/components/Icon";
import { bountyRemainingMs, clusterName, clusterText, isExpired, type MapJob, pinName, pinText } from "@/lib/map/pins";
import { staggerStyle } from "@/lib/motion/helpers";
import { useCountdown } from "@/lib/motion/hooks";

import styles from "./map.module.css";

const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");

export type Position = { x: number; y: number; unit?: "%" | "px" };

// Two decimals: plenty on screen, and the server HTML and the browser agree on the exact string (hydration).
const at = ({ x, y, unit = "%" }: Position): CSSProperties => ({
  left: `${x.toFixed(2)}${unit}`,
  top: `${y.toFixed(2)}${unit}`,
});

/**
 * Milliseconds left on a bounty, ticking every second (M27). `serverNow` is the time the page was rendered
 * at: the server HTML and the first browser render both use it, so they match; then the clock takes over.
 * Null for any other kind of job.
 */
export function useBountyRemaining(job: MapJob, serverNow: number): number | null {
  const endsAt = job.kind === "bounty" ? job.endsAt : 0;
  const live = useCountdown(endsAt);
  if (job.kind !== "bounty") return null;
  return live ?? bountyRemainingMs(endsAt, serverNow);
}

const ICONS: Partial<Record<MapJob["kind"], { name: string; fill?: boolean }>> = {
  estimate: { name: "photo_camera" },
  visit: { name: "directions_walk" },
  bounty: { name: "paid", fill: true },
};

/** The pin's look for this job: kind, or "expired" for a bounty whose time has run out. */
export function pinLook(job: MapJob, remainingMs: number | null): string {
  if (job.kind === "bounty" && remainingMs !== null && isExpired(remainingMs)) return styles.expired;
  return styles[job.kind];
}

type MapPinProps = {
  job: MapJob;
  position: Position;
  /** Render time (epoch ms), for the bounty countdown. */
  serverNow: number;
  /** Grown with the signature ring (M21): its list row is hovered/focused, or it's selected. */
  hot?: boolean;
  /** Its card is open. */
  selected?: boolean;
  /** Drop in (M21), staggered by `index`. */
  drop?: boolean;
  index?: number;
  onHotChange?: (id: string | null) => void;
  onSelect?: (id: string) => void;
};

export function MapPin({
  job,
  position,
  serverNow,
  hot = false,
  selected = false,
  drop = false,
  index = 0,
  onHotChange,
  onSelect,
}: MapPinProps) {
  const remaining = useBountyRemaining(job, serverNow);
  const expired = job.kind === "bounty" && remaining !== null && isExpired(remaining);
  const icon = ICONS[job.kind];
  const glint = job.kind === "bounty" && !expired;
  // Bounties glint in turn rather than all at once.
  const glintDelay = glint ? ({ "--tm-glint-delay": `${(index % 5) * 0.7}s` } as CSSProperties) : undefined;

  return (
    <button
      type="button"
      className={cx(
        "tm-pin",
        styles.pin,
        pinLook(job, remaining),
        drop && "tm-anim-pin",
        glint && "tm-glint",
        (hot || selected) && "is-hot",
      )}
      style={{ ...at(position), ...staggerStyle(index), ...glintDelay }}
      aria-label={pinName(job, remaining)}
      aria-expanded={onSelect ? selected : undefined}
      data-pin-kind={job.kind}
      data-precision={job.precision}
      onMouseEnter={() => onHotChange?.(job.id)}
      onMouseLeave={() => onHotChange?.(null)}
      onFocus={() => onHotChange?.(job.id)}
      onBlur={() => onHotChange?.(null)}
      onClick={() => onSelect?.(job.id)}
    >
      {icon && <Icon name={icon.name} fill={icon.fill} decorative className={styles.pinIcon} />}
      {/* The visible text ticks every minute; the button's name (above) is what's read, and it isn't live. */}
      <span aria-hidden="true">{pinText(job, remaining)}</span>
    </button>
  );
}

type ClusterPinProps = {
  count: number;
  bounties?: number;
  position: Position;
  /** True when it stands where a pin would hang (its point is the pin's tip, not its middle). */
  atPin?: boolean;
  onZoom?: () => void;
};

/** Several jobs too close to show apart. Pressing it zooms in (on the placeholder: to fit those jobs). */
export function ClusterPin({ count, bounties = 0, position, atPin = false, onZoom }: ClusterPinProps) {
  return (
    <button
      type="button"
      className={cx(styles.cluster, atPin && styles.clusterAtPin)}
      style={at(position)}
      aria-label={clusterName(count, bounties)}
      data-pin-kind="cluster"
      onClick={onZoom}
    >
      <span aria-hidden="true">{clusterText(count)}</span>
      {bounties > 0 && <span className={styles.clusterGold} aria-hidden="true" />}
    </button>
  );
}

/** A picture of a pin (legend, swatches): not a button, hidden from screen readers (the text beside it says it). */
export function PinSample({ kind, text }: { kind: MapJob["kind"] | "expired"; text: string }) {
  const icon = kind === "expired" ? ICONS.bounty : ICONS[kind];
  return (
    <span className={cx(styles.pin, styles[kind])} aria-hidden="true">
      {icon && <Icon name={icon.name} fill={icon.fill} decorative className={styles.pinIcon} />}
      {text}
    </span>
  );
}

/** The area an approximate pin stands for, drawn around its point on the hovered/selected pin. */
export function ApproxArea({ position, widthPct }: { position: Position; widthPct: number }) {
  return (
    <span
      className={styles.area}
      style={{ ...at(position), "--area": `${widthPct.toFixed(2)}%` } as CSSProperties}
      aria-hidden="true"
      data-testid="approx-area"
    />
  );
}
