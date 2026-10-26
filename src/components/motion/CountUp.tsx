"use client";
// A number that counts up from 0: M09 (the price, 700ms after the 300ms wipe) and M17 (KPIs and money, 600ms,
// the first time they enter view). Screen readers only ever hear the final value, never the moving one.
// Reduced motion: the final value straight away.
import { useRef } from "react";

import { useCountUp, useInViewOnce } from "@/lib/motion/hooks";
import { MOTION_MS } from "@/lib/motion/timings";

import styles from "./CountUp.module.css";

type CountUpProps = {
  value: number;
  /** How to show the number, e.g. formatNzd. Default: a whole number. */
  format?: (value: number) => string;
  /** Play it. False shows the final value. */
  run?: boolean;
  /** M17: wait until it's on screen the first time. */
  startOnView?: boolean;
  /** Change it to count again. */
  runKey?: string | number;
  duration?: number;
  delay?: number;
  className?: string;
};

const whole = (value: number) => Math.round(value).toLocaleString("en-NZ");

export function CountUp({
  value,
  format = whole,
  run = true,
  startOnView = false,
  runKey,
  duration = MOTION_MS.m17Count,
  delay = 0,
  className,
}: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInViewOnce(ref);
  const shown = useCountUp(value, { run: run && (!startOnView || inView), runKey, duration, delay });

  return (
    <span ref={ref} className={className ? `${styles.root} ${className}` : styles.root}>
      <span aria-hidden="true">{format(shown)}</span>
      <span className={styles.hidden}>{format(value)}</span>
    </span>
  );
}

const nzd = new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" });

/** $372.00: money as shown on prices and earnings. */
export function formatNzd(value: number): string {
  return nzd.format(value);
}
