import { errors, type Page } from "@playwright/test";

import { JOBS } from "../../prisma/seed/data.mjs";
import type { Shot } from "./shots";

/** Wait separately for each viewport. Return a note for the PR when we can only capture the fallback. */
export async function waitForCaptureContent(page: Page, shot: Pick<Shot, "url" | "status" | "expectMode">, timeout = 8_000) {
  const wanted = new URL(shot.url, page.url());
  const actual = new URL(page.url());
  const intentional = wanted.pathname === actual.pathname && wanted.search === actual.search
    && wanted.searchParams.get("state") === "loading";
  // Busy buttons and illustrative skeletons in component galleries are not page-load indicators.
  const markers = [
    '[aria-busy="true"]:not(button):not([role="button"]):visible',
    '[role="status"][aria-label^="loading" i]:visible',
    '[role="status"] .tm-skel:visible',
  ];
  if (intentional || !wanted.pathname.startsWith("/dev/")) markers.push(".tm-skel:visible");
  const fallback = page.locator(markers.join(", ")).first();
  const jobId = /^\/jobs\/([^/]+)\/?$/.exec(wanted.pathname)?.[1];
  const job = shot.status === "ASSIGNED" && shot.expectMode === "trade" ? JOBS.find(row => row.id === jobId) : undefined;

  try {
    if (intentional) {
      await fallback.waitFor({ state: "visible", timeout });
    } else {
      let destination = page.locator("body").filter({ hasNot: fallback });
      // The streamed worker route's fallback has its own H1. Require the actual seeded job title in the same paint.
      if (job) destination = destination.filter({ has: page.getByRole("heading", { name: job.title, exact: true }) });
      await destination.waitFor({ state: "visible", timeout });
    }
  } catch (error) {
    if (!(error instanceof errors.TimeoutError)) throw error;
    if (intentional) return "requested loading state did not appear before capture";
    if (await fallback.isVisible()) return "still loading at capture";
    if (job) return "assigned job content did not appear before capture";
    return "content did not settle before capture";
  }
  return null;
}
