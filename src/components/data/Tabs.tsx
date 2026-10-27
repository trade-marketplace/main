"use client";
// Tabs and segmented controls (#80): components.css .tm-tabs and .tm-seg, with M16 (the underline, or the white
// thumb, slides and resizes to the new tab: 200ms ease-in-out, instant under reduced motion). Both are WAI-ARIA
// tabs with automatic activation: Left/Right move and switch, Home/End jump, Tab goes into the panel.
//
//   <Tabs label="Queues" value={tab} onChange={setTab}
//     items={[{ value: "price", label: "To price", count: 4 }, { value: "extra", label: "Extra work", count: 2 }]}>
//     <QueueTable queue={tab} />                    the panel: whatever belongs to the chosen tab
//   </Tabs>
//
//   <SegmentedControl label="Show" value={view} onChange={setView}
//     items={[{ value: "active", label: "Active", count: 3 }, { value: "done", label: "Done", count: 8 }]} />
//
// Tabs: office queues, the tradie checks, a job's sections. Segmented: two or three views of the same list
// (Active / Done, Grid / Map). Keep the chosen tab in the URL (?tab=) when Back should come back to it.
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useId,
  useLayoutEffect,
  useRef,
} from "react";

import { Icon } from "@/components/Icon";
import { tabKey } from "@/lib/data-table";
import { useTabIndicator } from "@/lib/motion/hooks";

import styles from "./data.module.css";

export type TabItem<Value extends string = string> = {
  value: Value;
  label: string;
  /** Shown after the label in brackets, "To price (4)", as the mockups do. */
  count?: number;
  /** Segmented only: a Material Symbols name above the label (Grid / Map). */
  icon?: string;
};

type Common<Value extends string> = {
  /** What the tabs choose between, for screen readers: "Queues", "Show". */
  label: string;
  items: readonly TabItem<Value>[];
  value: Value;
  onChange: (value: Value) => void;
  /**
   * The panel for the chosen tab. Leave it out when the tabs drive something elsewhere on the page (a list
   * below); then give `controls` the id of that element.
   */
  children?: ReactNode;
  controls?: string;
  className?: string;
};

export type TabsProps<Value extends string> = Common<Value>;
export type SegmentedControlProps<Value extends string> = Common<Value> & {
  /** "full" (default) fills the width, like the phone mockups; "auto" is as wide as its labels (Grid / Map). */
  width?: "full" | "auto";
};

/** Room left beside a tab scrolled into view, so it's clear there's more beyond it. */
const SCROLL_MARGIN = 24;

const tabText = (item: TabItem) => (item.count === undefined ? item.label : `${item.label} (${item.count})`);

function useTabs<Value extends string>({ items, value, onChange, children, controls }: Common<Value>) {
  const id = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const tabId = (v: string) => `${id}-tab-${v}`;
  // aria-controls must name an element that exists: the panel this renders, or the one given in `controls`.
  const panelId = controls ?? (children === undefined ? undefined : `${id}-panel`);
  const index = Math.max(0, items.findIndex((item) => item.value === value));

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = tabKey(event.key, index, items.length);
    if (next === null) return;
    event.preventDefault();
    onChange(items[next].value);
    document.getElementById(tabId(items[next].value))?.focus();
  };

  const tabProps = (item: TabItem<Value>) => {
    const selected = item.value === value;
    return {
      id: tabId(item.value),
      type: "button" as const,
      role: "tab" as const,
      "aria-selected": selected,
      "aria-controls": panelId,
      tabIndex: selected ? 0 : -1,
      onClick: () => onChange(item.value),
    };
  };

  const panel =
    children === undefined ? null : (
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={tabId(items[index]?.value ?? "")} tabIndex={0} className={styles.tabPanel} data-spaced>
        {children}
      </div>
    );

  return { listRef, index, onKeyDown, tabProps, panel };
}

/** Underlined tabs: the active one is darker with a 3px bar in the action colour that slides between tabs. */
export function Tabs<Value extends string>(props: TabsProps<Value>) {
  const { label, items, value, className } = props;
  const { listRef, onKeyDown, tabProps, panel } = useTabs(props);
  useTabIndicator(listRef, value);

  // A tab scrolled out of sight (many tabs on a phone) comes into view when chosen. Only the bar scrolls, never
  // the page (scrollIntoView would jump the page to the tabs).
  useLayoutEffect(() => {
    const list = listRef.current;
    const active = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !active) return;
    const left = active.offsetLeft;
    const right = left + active.offsetWidth;
    if (left < list.scrollLeft) list.scrollLeft = Math.max(0, left - SCROLL_MARGIN);
    else if (right > list.scrollLeft + list.clientWidth) list.scrollLeft = right - list.clientWidth + SCROLL_MARGIN;
  }, [listRef, value]);

  return (
    <div className={[styles.tabs, className].filter(Boolean).join(" ")}>
      <div ref={listRef} role="tablist" aria-label={label} className={styles.tabList} onKeyDown={onKeyDown}>
        {items.map((item) => (
          <button key={item.value} {...tabProps(item)} className={styles.tab}>
            {tabText(item)}
          </button>
        ))}
        <span className={`tm-tab-indicator ${styles.tabIndicator}`} data-tab-indicator aria-hidden="true" />
      </div>
      {panel}
    </div>
  );
}

/** Two or three views of the same thing, in a grey track; the chosen one sits on a white thumb that slides. */
export function SegmentedControl<Value extends string>(props: SegmentedControlProps<Value>) {
  const { label, items, width = "full", className } = props;
  const { listRef, index, onKeyDown, tabProps, panel } = useTabs(props);
  const style = { "--seg-count": items.length, "--seg-index": index } as CSSProperties;

  return (
    <div className={[styles.tabs, className].filter(Boolean).join(" ")}>
      <div
        ref={listRef}
        role="tablist"
        aria-label={label}
        className={styles.seg}
        data-width={width}
        style={style}
        onKeyDown={onKeyDown}
      >
        <span className={styles.segThumb} aria-hidden="true" />
        {items.map((item) => (
          <button key={item.value} {...tabProps(item)} className={styles.segItem} data-icon={item.icon ? true : undefined}>
            {item.icon && <Icon name={item.icon} size="sm" decorative />}
            {tabText(item)}
          </button>
        ))}
      </div>
      {panel}
    </div>
  );
}
