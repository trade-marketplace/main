// Motion timings (ms) from the Motion table in docs/design/WEBAPP_SPEC.md, for the parts of M01–M27 that run in
// JavaScript (count-ups, timers, exits). The CSS side reads the same numbers from src/styles/motion.css;
// tests/unit/motion-css.test.ts fails if the two drift apart. Safe on server and browser.

export const MOTION_MS = {
  /** --trade-dur-fast: press, hover */
  fast: 120,
  /** --trade-dur-base: state changes */
  base: 200,
  /** --trade-dur-slow: sheets, drawers, page content */
  slow: 320,

  m01Stagger: 40,
  m01StaggerMax: 6,
  m02Fade: 180,
  m03Lift: 160,
  m03Zoom: 400,
  m06Factor: 0.3,
  m06MaxPx: 60,
  m07Reveal: 500,
  m07Step: 70,
  m08Suggest: 160,
  m08Debounce: 150,
  m09Wipe: 300,
  m09Count: 700,
  m09Step: 60,
  m10Pop: 400,
  m10Total: 600,
  m11Line: 400,
  /** Dialog out */
  m13Out: 150,
  m14Life: 4000,
  m15Delay: 300,
  m15Loop: 1200,
  m15Swap: 150,
  m17Count: 600,
  m19Bubble: 160,
  m20Badge: 240,
  m21Step: 30,
  m23Save: 160,
  m27Loop: 4000,
  /** Under this much time left, a bounty countdown ring pulses (M27). */
  m27UrgentMs: 2 * 60 * 60 * 1000,
} as const;

/** Exit durations for overlays that animate out (M12 drawer, M13 dialog, M14 toast). */
export const EXIT_MS = {
  drawer: MOTION_MS.base,
  dialog: MOTION_MS.m13Out,
  toast: MOTION_MS.base,
} as const;
