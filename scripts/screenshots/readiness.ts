import { errors, type Page } from "@playwright/test";

import { OFFICE_JOBS_PATH, officeCustomerId } from "@/lib/office-jobs";

import { JOBS } from "../../prisma/seed/data.mjs";
import type { Shot } from "./shots";

/** Wait separately for each viewport. Return a note for the PR when we can only capture the fallback. */
export async function waitForCaptureContent(page: Page, shot: Pick<Shot, "url" | "status" | "expectMode">, timeout = 8_000) {
  const wanted = new URL(shot.url, page.url());
  const actual = new URL(page.url());
  const requestedState = wanted.pathname === actual.pathname && wanted.search === actual.search
    ? wanted.searchParams.get("state") : null;
  const componentPreview = wanted.pathname.startsWith("/dev/components/");
  const stateWords = requestedState?.split("-") ?? [];
  const intentional = requestedState === "loading" || (componentPreview && stateWords.includes("loading"));
  const gallery = componentPreview && stateWords.includes("gallery");
  // Busy buttons and illustrative skeletons in component galleries are not page-load indicators.
  const markers = [
    '[aria-busy="true"]:not(button):not([role="button"]):visible',
    '[role="status"][aria-label^="loading" i]:visible',
    '[role="status"] .tm-skel:visible',
  ];
  if (intentional) markers.push('[aria-busy="true"]:visible', '[role="progressbar"]:visible');
  if (intentional || !wanted.pathname.startsWith("/dev/")) markers.push(".tm-skel:visible");
  const fallback = page.locator(markers.join(", ")).first();
  const jobId = /^\/jobs\/([^/]+)\/?$/.exec(wanted.pathname)?.[1];
  const job = shot.status === "ASSIGNED" && shot.expectMode === "trade" ? JOBS.find(row => row.id === jobId) : undefined;

  const officeSubpage = shot.expectMode === "office" && wanted.pathname === actual.pathname && /^\/admin\/.+/.test(wanted.pathname);
  const officeJobs = officeSubpage && wanted.pathname === OFFICE_JOBS_PATH;
  const customer = officeJobs && officeCustomerId(wanted.searchParams.get("customer") ?? undefined);
  const todayQueue = page.getByRole("main")
    .filter({ has: page.getByRole("heading", { level: 1, name: "Today", exact: true }) })
    .getByRole("group", { name: "Queue totals", exact: true }).first();

  try {
    if (intentional) {
      await fallback.waitFor({ state: "visible", timeout });
    } else if (gallery) {
      // A gallery displays several states together. A heading outside the loading examples proves it rendered.
      const content = page.locator("main").getByRole("heading")
        .and(page.locator(':not([aria-busy="true"] *, [role="status"] *)'));
      await content.first().waitFor({ state: "visible", timeout });
    } else {
      let destination = page.locator("body").filter({ hasNot: fallback });
      // The streamed worker route's fallback has its own H1. Require the actual seeded job title in the same paint.
      if (job) destination = destination.filter({ has: page.getByRole("heading", { name: job.title, exact: true }) });
      // The office loading shell renders the Today queue. Only /admin itself owns that screen.
      if (officeSubpage) destination = destination.filter({ hasNot: todayQueue });
      // The list and its customer filter must both be visible when the shot requests them.
      if (officeJobs) {
        destination = destination.filter({ has: page.getByRole("heading", { level: 1, name: "All jobs", exact: true }) });
        if (customer) destination = destination.filter({ has: page.getByRole("button", { name: /^Remove customer filter:/ }) });
      }
      await destination.waitFor({ state: "visible", timeout });
    }
  } catch (error) {
    if (!(error instanceof errors.TimeoutError)) throw error;
    if (intentional) return "requested loading state did not appear before capture";
    if (gallery) return "component gallery content did not appear before capture";
    if (await fallback.isVisible()) return "still loading at capture";
    if (job) return "assigned job content did not appear before capture";
    if (officeSubpage && await todayQueue.isVisible()) return "inherited Today queue still visible at capture";
    if (officeJobs) {
      return customer ? "All jobs or the requested customer filter did not appear before capture" : "All jobs did not appear before capture";
    }
    return "content did not settle before capture";
  }
  return null;
}
