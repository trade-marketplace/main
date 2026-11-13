import { expect, type Page, type Request } from "@playwright/test";

/** A busy surface is itself an audit state; do not wait for its deliberately held read to finish. */
async function waitForRefreshes(page: Page, seen: Set<Request>): Promise<boolean> {
  if (await page.locator('[aria-busy="true"]:visible').count()) return false;
  const current = new URL(page.url());
  const route = (url: URL) => { url.searchParams.delete("_rsc"); url.searchParams.sort(); return url.origin + url.pathname + url.search; };
  const currentRoute = route(current);
  const pending = (await page.requests()).filter(request => {
    const headers = request.headers();
    // Speculative/partial prefetch streams can deliberately stay open and do not own current metadata.
    const prefetch = headers["next-router-prefetch"] || headers["next-router-segment-prefetch"] ||
      headers["purpose"]?.includes("prefetch") || headers["sec-purpose"]?.includes("prefetch");
    return !seen.has(request) && request.method() === "GET" && headers["rsc"] === "1" && !prefetch &&
      route(new URL(request.url())) === currentRoute && request.timing().responseEnd < 0 && !request.failure();
  });
  await Promise.all(pending.map(async request => {
    seen.add(request);
    // Partial Flight bodies can stay open after their metadata is painted; wait for the response, not EOF.
    await request.response();
  }));
  return pending.length > 0;
}

/** Explicit journeys require their declared title; generic audits require stable, nonempty metadata. */
export async function waitForPageSettled(page: Page, expectedTitle?: string): Promise<void> {
  if (expectedTitle !== undefined && !expectedTitle.trim()) throw new Error("An accessibility audit needs the page's expected nonempty title.");
  const seen = new Set<Request>();
  let refreshed: boolean;
  do {
    await waitForRefreshes(page, seen);
    if (expectedTitle) await expect(page).toHaveTitle(expectedTitle);
    else await expect(page).not.toHaveTitle(/^\s*$/);
    await page.evaluate(async title => {
      const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      let stableFrames = 0;
      let previousTitle = "";
      while (stableFrames < 2) {
        await document.fonts.ready;
        await frame();
        const pending = document.getAnimations().filter(animation =>
          animation.playState !== "finished" && animation.playState !== "idle" &&
          // This lifecycle clock dismisses its toast; waiting for it would remove the state from the audit.
          !(animation instanceof CSSAnimation && animation.animationName === "tm-time-left") &&
          Number.isFinite(animation.effect?.getComputedTiming().endTime ?? Infinity));
        if (pending.length) {
          // Cancellation can replace an entrance animation; inspect the document again afterward.
          await Promise.allSettled(pending.map(animation => animation.finished));
          stableFrames = 0;
        } else {
          const currentTitle = document.title;
          const matches = currentTitle.trim().length > 0 && (!title || currentTitle === title) && document.fonts.status === "loaded";
          stableFrames = matches ? currentTitle === previousTitle ? stableFrames + 1 : 1 : 0;
          previousTitle = currentTitle;
        }
      }
    }, expectedTitle);
    // A refresh may have started while the entrance effects were painting.
    refreshed = await waitForRefreshes(page, seen);
  } while (refreshed);
  if (expectedTitle) await expect(page).toHaveTitle(expectedTitle);
  else await expect(page).not.toHaveTitle(/^\s*$/);
}
