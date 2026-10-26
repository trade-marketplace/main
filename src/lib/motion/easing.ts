// Easing for the motion that runs in JavaScript (M09 price count-up, M17 number ticker), so it moves on exactly
// the same curve as the CSS tokens --trade-ease-out / --trade-ease-in-out. Safe on server and browser.

export type Easing = (t: number) => number;

/**
 * A CSS cubic-bezier(x1, y1, x2, y2) as a function of progress 0..1, solved the way browsers do
 * (Newton's method, falling back to bisection).
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Easing {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;

  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  const solveT = (x: number) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const error = sampleX(t) - x;
      if (Math.abs(error) < 1e-6) return t;
      const slope = slopeX(t);
      if (Math.abs(slope) < 1e-6) break;
      t -= error / slope;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    while (lo < hi) {
      const value = sampleX(t);
      if (Math.abs(value - x) < 1e-6) return t;
      if (x > value) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
      if (hi - lo < 1e-7) break;
    }
    return t;
  };

  return (progress: number) => {
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;
    return sampleY(solveT(progress));
  };
}

/** --trade-ease-out: cubic-bezier(.2, .8, .2, 1) */
export const easeOut = cubicBezier(0.2, 0.8, 0.2, 1);
/** --trade-ease-in-out: cubic-bezier(.65, 0, .35, 1) */
export const easeInOut = cubicBezier(0.65, 0, 0.35, 1);

/**
 * The value of a count-up `elapsed` ms after it started: `from` before the delay, `to` once it's done, eased in
 * between. Used by useCountUp(); a pure function so it can be tested without a browser.
 */
export function countUpValue(
  { from = 0, to, elapsed, duration, delay = 0, ease = easeOut }: {
    from?: number;
    to: number;
    elapsed: number;
    duration: number;
    delay?: number;
    ease?: Easing;
  },
): number {
  if (duration <= 0) return to;
  const progress = Math.min(1, Math.max(0, (elapsed - delay) / duration));
  if (progress >= 1) return to;
  return from + (to - from) * ease(progress);
}
