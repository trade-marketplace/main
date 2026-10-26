// Small pure helpers behind the motion hooks, kept here so they can be tested without a browser.
// Safe on server and browser.
import type { CSSProperties } from "react";

import { MOTION_MS } from "./timings";

/** Inline style that numbers an element in a stagger (M07 lines, M09 ticks, M21 pins): sets --tm-i. */
export function staggerStyle(index: number): CSSProperties {
  return { "--tm-i": Math.max(0, Math.floor(index)) } as CSSProperties;
}

/**
 * M06: how far the hero bolt moves for this scroll position. 0.3x the scroll, never more than 60px,
 * never backwards (overscroll on iOS can report a negative scroll).
 */
export function parallaxOffset(
  scrollY: number,
  factor: number = MOTION_MS.m06Factor,
  max: number = MOTION_MS.m06MaxPx,
): number {
  if (!Number.isFinite(scrollY) || scrollY <= 0) return 0;
  return Math.min(max, scrollY * factor);
}

/**
 * M19: is a scrollable thread at (or within `threshold` px of) the bottom? Only then does a new message
 * scroll it down, so someone reading back up isn't yanked away.
 */
export function isAtBottom(
  { scrollTop, clientHeight, scrollHeight }: { scrollTop: number; clientHeight: number; scrollHeight: number },
  threshold = 24,
): boolean {
  return scrollHeight - (scrollTop + clientHeight) <= threshold;
}

/** M20: the badge pops only when the number goes up. */
export function wentUp(previous: number, next: number): boolean {
  return next > previous;
}

/** M23: the bookmark pops only when it becomes saved, not when it's un-saved. */
export function becameTrue(previous: boolean, next: boolean): boolean {
  return next && !previous;
}

/** M27: how full a countdown ring is (1 = all the time left, 0 = expired). */
export function ringFraction(remainingMs: number, totalMs: number): number {
  if (!(totalMs > 0)) return 0;
  return Math.min(1, Math.max(0, remainingMs / totalMs));
}

/** M27: under 2 hours left the ring pulses gently. Expired rings don't pulse. */
export function isUrgent(remainingMs: number, urgentMs: number = MOTION_MS.m27UrgentMs): boolean {
  return remainingMs > 0 && remainingMs < urgentMs;
}

/** M27: the short label inside a countdown ring: "17h", "1h 12m", "42m", "0m". */
export function formatCountdown(remainingMs: number): string {
  const minutes = Math.max(0, Math.ceil(remainingMs / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours >= 10) return `${hours}h`;
  if (hours > 0) return rest ? `${hours}h ${rest}m` : `${hours}h`;
  return `${rest}m`;
}

/**
 * M02: a valid, unique view-transition-name for an element that morphs between pages (e.g. a job's photo on
 * the list and on the job page): `morphName("job-photo", job.id)`. Give both elements the same name.
 */
export function morphName(kind: string, id: string | number): string {
  const safe = `${kind}-${id}`.replace(/[^a-zA-Z0-9_-]/g, "-");
  return /^[a-zA-Z_]/.test(safe) ? safe : `m-${safe}`;
}
