// The one guard every /dev/* page uses (#317). The dev pages (tokens, motion, component sets) are for checking work
// against the design, never for the public: in a production build they're a 404, except when the screenshot workflow
// (.github/workflows/screenshots.yml) starts the app with SCREENSHOT_DEV_PAGES=1 so the bot can shoot them.
// A Vercel deployment (preview or production) always gets the 404, even if someone sets the variable there.
//
// The guard makes the page render per request (`noStore()`): otherwise `next build` would prerender the 404 and the
// variable, which is only set when the app starts, would never be read.
import "server-only";

import { unstable_noStore as noStore } from "next/cache";
import { notFound } from "next/navigation";

/** Set to `1` only in the screenshot workflow's "Start the app" step. Nothing in a PR description or label sets it. */
export const DEV_PAGES_ENV = "SCREENSHOT_DEV_PAGES";

type Env = Readonly<Record<string, string | undefined>>;

/** Whether /dev/* pages may render with this environment. */
export function devPagesAllowed(env: Env = process.env): boolean {
  // Checked first, so a Vercel deployment never shows them, whatever else is set.
  if (env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview")
    return false;
  if (env.NODE_ENV !== "production") return true;
  if (env.VERCEL === "1") return false;
  return env[DEV_PAGES_ENV] === "1";
}

/** Call first thing in every /dev/* page: a 404 unless dev pages are allowed. */
export function guardDevPage(env: Env = process.env): void {
  noStore();
  if (!devPagesAllowed(env)) notFound();
}
