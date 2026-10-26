import { describe, expect, it, vi } from "vitest";

import {
  motionDuration,
  prefersReducedMotion,
  REDUCED_MOTION_QUERY,
  subscribeReducedMotion,
} from "@/lib/motion/reduced-motion";

/** A fake window.matchMedia whose answer can be flipped. */
function fakeHost(initial: boolean) {
  let matches = initial;
  const listeners = new Set<() => void>();
  const queries: string[] = [];
  const host = {
    matchMedia: (query: string) => {
      queries.push(query);
      return {
        get matches() {
          return matches;
        },
        addEventListener: (_: string, fn: () => void) => listeners.add(fn),
        removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
      } as unknown as MediaQueryList;
    },
    set(value: boolean) {
      matches = value;
      listeners.forEach((fn) => fn());
    },
    listeners,
    queries,
  };
  return host;
}

describe("prefers-reduced-motion in JavaScript", () => {
  it("asks the browser the standard question", () => {
    const host = fakeHost(true);
    expect(prefersReducedMotion(host)).toBe(true);
    expect(host.queries).toEqual([REDUCED_MOTION_QUERY]);
    expect(REDUCED_MOTION_QUERY).toBe("(prefers-reduced-motion: reduce)");
  });

  it("is off when the visitor hasn't asked", () => {
    expect(prefersReducedMotion(fakeHost(false))).toBe(false);
  });

  it("is off on the server and where matchMedia is missing or throws (the CSS still honours it)", () => {
    expect(prefersReducedMotion(undefined)).toBe(false);
    expect(prefersReducedMotion({})).toBe(false);
    expect(
      prefersReducedMotion({
        matchMedia: () => {
          throw new Error("no");
        },
      }),
    ).toBe(false);
  });

  it("tells subscribers when the setting changes while the page is open, and stops after unsubscribing", () => {
    const host = fakeHost(false);
    const onChange = vi.fn();
    const unsubscribe = subscribeReducedMotion(onChange, host);
    host.set(true);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(prefersReducedMotion(host)).toBe(true);
    unsubscribe();
    host.set(false);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(host.listeners.size).toBe(0);
  });

  it("subscribing without matchMedia is harmless", () => {
    expect(() => subscribeReducedMotion(() => {}, undefined)()).not.toThrow();
  });

  it("makes every JavaScript duration instant under reduced motion", () => {
    expect(motionDuration(200, true)).toBe(0);
    expect(motionDuration(4000, true)).toBe(0);
    expect(motionDuration(200, false)).toBe(200);
  });
});
