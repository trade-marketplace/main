"use client";
// Numbers on cards (#76).
// - <KpiCard>: web.css .w-kpi, the white card with a label, a big number and a note: office queues (F01: red top
//   edge and note when something is overdue; a click opens that queue), Earnings and the tradie scorecard.
// - <StatCard>: the Forest money card at the top of Earnings on a phone (screens.html tr-earnings), with the bolt.
// - <StatStrip>: three small figures in a row, "4.9 rating · 32 jobs · 2024 joined" (profiles).
// Numbers count up from 0 the first time they're on screen (M17, <CountUp>); screen readers only hear the final
// value, and reduced motion shows it straight away. All figures come from the server.
//
//   <KpiCard label="To price" value={4} note="oldest 26h" alert href="/admin?tab=price" />
//   <KpiCard label="Paid in October" value={345280} format={formatNzd} note="14 jobs · holiday pay included" />
//   <StatCard label="Paid in October" value={345280} format={formatNzd} note="14 jobs · holiday pay included" />
//   <StatStrip items={[{ label: "rating", value: "4.9" }, { label: "jobs", value: "32" }, { label: "joined", value: "2024" }]} />
import Link from "next/link";

import { BoltMark } from "@/components/BoltMark";
import { CountUp } from "@/components/motion/CountUp";

import styles from "./cards.module.css";

type Figure = {
  /** "To price", "Paid in October". */
  label: string;
  /** A number counts up (M17) and is shown with `format`; text ("94%", "—") is shown as it is. */
  value: number | string;
  /** How to show a number, e.g. formatNzd for cents. Default: a whole number with commas. */
  format?: (value: number) => string;
  /** The small line under it: "oldest 26h", "14 jobs · holiday pay included". */
  note?: string;
  className?: string;
};

function Value({ value, format }: Pick<Figure, "value" | "format">) {
  return typeof value === "number" ? <CountUp value={value} format={format} startOnView /> : <>{value}</>;
}

export type KpiCardProps = Figure & {
  /** Something here is overdue: the red top edge and a red note (WEBAPP_SPEC F01). Say why in `note`. */
  alert?: boolean;
  /** A click anywhere on the card opens this (the office queue tab it counts). */
  href?: string;
};

export function KpiCard({ label, value, format, note, alert = false, href, className }: KpiCardProps) {
  return (
    <div className={[styles.kpi, href && "tm-lift", className].filter(Boolean).join(" ")} data-alert={alert || undefined}>
      {href ? (
        <Link href={href} className={`${styles.kpiLabel} ${styles.stretched}`}>
          {label}
        </Link>
      ) : (
        <span className={styles.kpiLabel}>{label}</span>
      )}
      <span className={styles.kpiValue}>
        <Value value={value} format={format} />
      </span>
      {note && <span className={styles.kpiNote}>{note}</span>}
    </div>
  );
}

export function StatCard({ label, value, format, note, className }: Figure) {
  return (
    <div className={[styles.stat, className].filter(Boolean).join(" ")}>
      <BoltMark className={styles.statBolt} />
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>
        <Value value={value} format={format} />
      </span>
      {note && <span className={styles.statNote}>{note}</span>}
    </div>
  );
}

export type StatStripProps = {
  /** Two to four figures. The value is shown big, the label small under it. */
  items: readonly { label: string; value: string }[];
  className?: string;
};

export function StatStrip({ items, className }: StatStripProps) {
  return (
    <dl className={[styles.stats, className].filter(Boolean).join(" ")}>
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
