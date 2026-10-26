// prefers-reduced-motion for the motion that runs in JavaScript (count-ups, parallax, scrolling, view
// transitions, exits). The CSS side is the @media block at the end of src/styles/motion.css.
// With reduced motion everything becomes an instant change. Safe on server and browser.

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

type MatchMediaHost = { matchMedia?: (query: string) => MediaQueryList };

function mediaQuery(host: MatchMediaHost | undefined): MediaQueryList | null {
  try {
    return host?.matchMedia?.(REDUCED_MOTION_QUERY) ?? null;
  } catch {
    return null;
  }
}

/**
 * Does the visitor ask for reduced motion? False on the server and where matchMedia is missing: the CSS still
 * honours the setting there, and the JavaScript motion only starts in the browser.
 */
export function prefersReducedMotion(host: MatchMediaHost | undefined = globalThis as MatchMediaHost): boolean {
  return mediaQuery(host)?.matches ?? false;
}

/** Calls `onChange` when the setting changes (people can switch it while the page is open). Returns unsubscribe. */
export function subscribeReducedMotion(
  onChange: () => void,
  host: MatchMediaHost | undefined = globalThis as MatchMediaHost,
): () => void {
  const query = mediaQuery(host);
  if (!query) return () => {};
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** The duration to actually use: 0 (instant) under reduced motion. */
export function motionDuration(ms: number, reduced: boolean): number {
  return reduced ? 0 : ms;
}
