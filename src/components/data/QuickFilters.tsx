"use client";
// Quick filters (#80): the one-tap chips across the top of a list (screens.html tr-all: Ready to claim · Needs
// estimate · Saved; WEBAPP_SPEC D03: chips with live counts, the Bounty chip gold). One is on at a time; tapping
// it again doesn't turn it off (there's always a view). On a phone they scroll sideways inside their row.
//
//   <QuickFilters label="Show" value={show} onChange={setShow}
//     items={[{ value: "ready", label: "Ready to claim", count: 12 }, { value: "bounty", label: "Bounties", tone: "gold" }]} />
import styles from "./data.module.css";

export type QuickFilterItem<Value extends string = string> = {
  value: Value;
  label: string;
  /** A live count after the label. */
  count?: number;
  /** "gold" for quote bounties (gold means easy money; nothing else is gold). */
  tone?: "gold";
};

export type QuickFiltersProps<Value extends string> = {
  /** What the chips choose, for screen readers: "Show". */
  label: string;
  items: readonly QuickFilterItem<Value>[];
  value: Value;
  onChange: (value: Value) => void;
  /** From 600px up, wrap onto more lines instead of scrolling sideways. */
  wrap?: boolean;
  className?: string;
};

const numberFormat = new Intl.NumberFormat("en-NZ");

export function QuickFilters<Value extends string>({ label, items, value, onChange, wrap = false, className }: QuickFiltersProps<Value>) {
  return (
    <ul aria-label={label} className={[styles.quick, className].filter(Boolean).join(" ")} data-wrap={wrap || undefined}>
      {items.map((item) => (
        <li key={item.value}>
          <button
            type="button"
            className={`${styles.chipButton} ${styles.quickChip}`}
            aria-pressed={item.value === value}
            data-tone={item.tone}
            onClick={() => onChange(item.value)}
          >
            <span className={styles.chip} data-plain>
              <span className={styles.chipLabel}>{item.label}</span>
              {item.count !== undefined && <span className={styles.quickCount}>{numberFormat.format(item.count)}</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
