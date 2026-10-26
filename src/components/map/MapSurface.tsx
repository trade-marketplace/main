// The placeholder map surface (#82) and the pin legend. Mapbox replaces the surface in a later issue; the pins,
// card and legend drop onto it unchanged. Decorative roads and parks only (web.css .w-map), no network, no token.
import type { ReactNode } from "react";

import { KIND_NAMES } from "@/lib/map/pins";

import { PinSample } from "./MapPin";
import styles from "./map.module.css";

const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");

type MapSurfaceProps = {
  /** Names the map region for screen readers, e.g. "Map of 24 jobs". */
  label: string;
  className?: string;
  children?: ReactNode;
};

export function MapSurface({ label, className, children }: MapSurfaceProps) {
  return (
    <div role="region" aria-label={label} className={cx(styles.surface, className)}>
      <svg className={styles.roads} viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
        <rect className={styles.park} x="420" y="220" width="140" height="110" rx="14" />
        <rect className={styles.park} x="760" y="450" width="180" height="120" rx="14" />
        <path className={cx(styles.road, styles.roadSide)} d="M0,120 C200,100 400,180 700,140 S1100,60 1440,110" />
        <path className={cx(styles.road, styles.roadMain)} d="M0,380 C300,360 500,420 900,380 S1200,330 1440,360" />
        <path className={cx(styles.road, styles.roadSide)} d="M220,0 C240,200 180,400 260,900" />
        <path className={cx(styles.road, styles.roadMain)} d="M620,0 C600,240 680,520 640,900" />
        <path className={cx(styles.road, styles.roadSide)} d="M980,0 C1000,260 940,500 1020,900" />
        <path className={cx(styles.road, styles.roadMain)} d="M0,620 C400,600 800,680 1440,600" />
      </svg>
      <div className={styles.layer}>{children}</div>
    </div>
  );
}

/** "You are here", at a position on the surface. */
export function YouAreHere({ x, y }: { x: number; y: number }) {
  return (
    <span className={styles.you} style={{ left: `${x.toFixed(2)}%`, top: `${y.toFixed(2)}%` }} role="img" aria-label="You are here" />
  );
}

const LEGEND = [
  { kind: "claim", sample: "$", text: "Priced + paid. First in gets it." },
  { kind: "estimate", sample: "Est.", text: "Quote from the photos. Private." },
  { kind: "visit", sample: "Visit", text: "Go and look in person." },
  { kind: "bounty", sample: "$30", text: "Go quote in person. $30 on the spot. 24h." },
] as const;

/** What each pin means (D03: bottom-left of the map on wide screens). */
export function MapLegend({ className, card = false }: { className?: string; card?: boolean }) {
  return (
    <ul className={cx(styles.legend, card && styles.legendCard, className)} aria-label="What the pins mean">
      {LEGEND.map((item) => (
        <li key={item.kind} className={styles.legendItem}>
          <span className={styles.legendSwatch}>
            <PinSample kind={item.kind} text={item.sample} />
          </span>
          <span className={styles.legendText}>
            <b>{item.kind === "bounty" ? "Quote bounty" : KIND_NAMES[item.kind]}</b>
            <span>{item.text}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
