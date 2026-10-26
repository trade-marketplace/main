import { describe, expect, it } from "vitest";

import { countUpValue, cubicBezier, easeInOut, easeOut } from "@/lib/motion/easing";
import {
  becameTrue,
  formatCountdown,
  isAtBottom,
  isUrgent,
  morphName,
  parallaxOffset,
  ringFraction,
  staggerStyle,
  wentUp,
} from "@/lib/motion/helpers";

describe("easing (the same curves as the CSS tokens)", () => {
  it("starts at 0 and ends at 1", () => {
    for (const ease of [easeOut, easeInOut]) {
      expect(ease(0)).toBe(0);
      expect(ease(1)).toBe(1);
      expect(ease(-1)).toBe(0);
      expect(ease(2)).toBe(1);
    }
  });

  it("linear cubic-bezier(0,0,1,1) is the identity", () => {
    const linear = cubicBezier(0, 0, 1, 1);
    for (const t of [0.1, 0.25, 0.5, 0.9]) expect(linear(t)).toBeCloseTo(t, 4);
  });

  it("--trade-ease-out rushes then settles; --trade-ease-in-out is symmetric", () => {
    expect(easeOut(0.25)).toBeGreaterThan(0.6);
    expect(easeOut(0.5)).toBeGreaterThan(0.85);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 3);
    expect(easeInOut(0.25) + easeInOut(0.75)).toBeCloseTo(1, 3);
  });

  it("never goes backwards", () => {
    let last = 0;
    for (let t = 0; t <= 1; t += 0.01) {
      const v = easeOut(t);
      expect(v).toBeGreaterThanOrEqual(last - 1e-9);
      last = v;
    }
  });
});

describe("count-up (M09 price, M17 KPIs)", () => {
  it("shows $0 until the wipe finishes, then counts to the price in 700ms and stops exactly on it", () => {
    const at = (elapsed: number) => countUpValue({ to: 372, elapsed, duration: 700, delay: 300 });
    expect(at(0)).toBe(0);
    expect(at(300)).toBe(0);
    expect(at(650)).toBeGreaterThan(300);
    expect(at(650)).toBeLessThan(372);
    expect(at(1000)).toBe(372);
    expect(at(5000)).toBe(372);
  });

  it("is the final value straight away with no duration", () => {
    expect(countUpValue({ to: 37, elapsed: 0, duration: 0 })).toBe(37);
  });

  it("can count from another number", () => {
    expect(countUpValue({ from: 10, to: 20, elapsed: 0, duration: 600 })).toBe(10);
    expect(countUpValue({ from: 10, to: 20, elapsed: 600, duration: 600 })).toBe(20);
  });
});

describe("M06 parallax", () => {
  it("moves the bolt at 0.3x the scroll, at most 60px", () => {
    expect(parallaxOffset(0)).toBe(0);
    expect(parallaxOffset(100)).toBeCloseTo(30);
    expect(parallaxOffset(200)).toBe(60);
    expect(parallaxOffset(5000)).toBe(60);
  });

  it("ignores iOS overscroll (negative scroll) and nonsense", () => {
    expect(parallaxOffset(-80)).toBe(0);
    expect(parallaxOffset(Number.NaN)).toBe(0);
  });
});

describe("M19 auto-scroll only at the bottom", () => {
  it("is at the bottom when scrolled all the way, or within a few pixels", () => {
    expect(isAtBottom({ scrollTop: 300, clientHeight: 200, scrollHeight: 500 })).toBe(true);
    expect(isAtBottom({ scrollTop: 290, clientHeight: 200, scrollHeight: 500 })).toBe(true);
  });

  it("isn't when the person has scrolled up to read", () => {
    expect(isAtBottom({ scrollTop: 100, clientHeight: 200, scrollHeight: 500 })).toBe(false);
  });
});

describe("M20 / M23 only pop the right way", () => {
  it("the badge pops when the count goes up, not down or the same", () => {
    expect(wentUp(2, 3)).toBe(true);
    expect(wentUp(3, 2)).toBe(false);
    expect(wentUp(3, 3)).toBe(false);
  });

  it("the bookmark pops when it becomes saved, not when it's un-saved", () => {
    expect(becameTrue(false, true)).toBe(true);
    expect(becameTrue(true, false)).toBe(false);
  });
});

describe("M27 countdown ring", () => {
  const HOUR = 3_600_000;

  it("shows how much of the 24h is left", () => {
    expect(ringFraction(18 * HOUR, 24 * HOUR)).toBeCloseTo(0.75);
    expect(ringFraction(-5, 24 * HOUR)).toBe(0);
    expect(ringFraction(30 * HOUR, 24 * HOUR)).toBe(1);
    expect(ringFraction(5, 0)).toBe(0);
  });

  it("pulses only under 2 hours, and not once expired", () => {
    expect(isUrgent(2 * HOUR)).toBe(false);
    expect(isUrgent(2 * HOUR - 1)).toBe(true);
    expect(isUrgent(10 * 60_000)).toBe(true);
    expect(isUrgent(0)).toBe(false);
  });

  it("labels the ring like the mockups", () => {
    expect(formatCountdown(17 * HOUR + 42 * 60_000)).toBe("17h");
    expect(formatCountdown(HOUR + 12 * 60_000)).toBe("1h 12m");
    expect(formatCountdown(6 * HOUR)).toBe("6h");
    expect(formatCountdown(42 * 60_000)).toBe("42m");
    expect(formatCountdown(0)).toBe("0m");
    expect(formatCountdown(-1)).toBe("0m");
  });
});

describe("M02 morph names", () => {
  it("makes a valid view-transition-name from any id", () => {
    expect(morphName("job-photo", "abc123")).toBe("job-photo-abc123");
    expect(morphName("job-photo", "a b/c#1")).toBe("job-photo-a-b-c-1");
    expect(morphName("1st", 2)).toBe("m-1st-2");
  });
});

describe("stagger numbering (M07, M09, M21)", () => {
  it("sets --tm-i as a whole, non-negative number", () => {
    expect(staggerStyle(3)).toEqual({ "--tm-i": 3 });
    expect(staggerStyle(-2)).toEqual({ "--tm-i": 0 });
    expect(staggerStyle(1.7)).toEqual({ "--tm-i": 1 });
  });
});
