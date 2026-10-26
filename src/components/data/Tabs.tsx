"use client";

import { type ReactNode, useId, useRef } from "react";

import { useTabIndicator } from "@/lib/motion/hooks";

import styles from "./data.module.css";

export type TabItem = { value: string; label: string; content: ReactNode; disabled?: boolean };
export type TabsProps = {
  label: string;
  items: readonly TabItem[];
  value: string;
  onChange: (value: string) => void;
  variant?: "tabs" | "segmented";
};

/** Automatic activation: arrows wrap and skip disabled tabs; Home/End go to the first/last available tab. */
export function Tabs({ label, items, value, onChange, variant = "tabs" }: TabsProps) {
  const id = useId();
  const list = useRef<HTMLDivElement>(null);
  const active = items.find((item) => item.value === value && !item.disabled) ?? items.find((item) => !item.disabled);
  useTabIndicator(list, active?.value);
  return <div className={styles.tabs}>
    <div ref={list} role="tablist" aria-label={label} className={styles.tabList} data-variant={variant}>
      <span aria-hidden="true" data-tab-indicator className={`tm-tab-indicator ${styles.indicator}`} />
      {items.map((item, index) => <button key={item.value} type="button" role="tab" id={`${id}-tab-${index}`}
        aria-selected={item === active} aria-controls={`${id}-panel-${index}`} disabled={item.disabled}
        tabIndex={item === active ? 0 : -1} onClick={() => onChange(item.value)}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const enabled = items.filter((tab) => !tab.disabled);
          const current = enabled.indexOf(item);
          const next = event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1
            : (current + (event.key === "ArrowRight" ? 1 : -1) + enabled.length) % enabled.length;
          const target = enabled[next];
          if (!target) return;
          onChange(target.value);
          document.getElementById(`${id}-tab-${items.indexOf(target)}`)?.focus();
        }}>{item.label}</button>)}
    </div>
    {items.map((item, index) => <div key={item.value} id={`${id}-panel-${index}`} role="tabpanel"
      aria-labelledby={`${id}-tab-${index}`} hidden={item !== active} tabIndex={0} className={styles.tabPanel}>
      {item.content}
    </div>)}
  </div>;
}

export function SegmentedControl(props: Omit<TabsProps, "variant">) {
  return <Tabs {...props} variant="segmented" />;
}
