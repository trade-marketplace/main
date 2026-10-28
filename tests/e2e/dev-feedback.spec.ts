import { expect, type Page, test } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

// /dev/components/feedback (#79) is a development-only page. `npm run e2e` runs the production build, where it must
// be a 404. To check the page itself, start `npm run dev` and point these tests at it:
//   E2E_DEV_BASE_URL=http://localhost:3000 npx playwright test tests/e2e/dev-feedback.spec.ts

test("/dev/components/feedback is not in production builds", async ({ page }) => {
  test.skip(Boolean(process.env.E2E_DEV_BASE_URL), "checking the dev server instead");
  const response = await page.goto("/dev/components/feedback");
  expect(response?.status()).toBe(404);
});

const devUrl = process.env.E2E_DEV_BASE_URL;
const url = (query = "") => (devUrl ? new URL(`/dev/components/feedback${query}`, devUrl).href : "");

/** Sideways scroll on the page, and any heading, line, button or link whose text spills out of its box. */
async function overflows(page: Page) {
  return page.evaluate(() => {
    const spilled = [...document.querySelectorAll<HTMLElement>("main h4, main p, main button, main a, main b")]
      .filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).display !== "inline")
      .map((el) => el.textContent?.slice(0, 40));
    return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, spilled };
  });
}

// CSS module class names are hashed in the dev build ("feedback-module__x__region"), so match on the name part.
const REGION = '#loading [class*="__region"]';

/** The polite status region right after `selector` (LoadingRegion puts it next to the busy area). */
const statusAfter = (page: Page, selector: string) => page.locator(`${selector} + [role=status]`);

/** A preview row by its name, e.g. "Try it" in #errors. */
const row = (page: Page, section: string, name: string) =>
  page.locator(`#${section}`).getByRole("heading", { level: 3, name, exact: true }).locator("../..");

test.describe("/dev/components/feedback on the dev server", () => {
  test.skip(!devUrl, "set E2E_DEV_BASE_URL to a running `npm run dev`");

  for (const viewport of VIEWPORTS) {
    test(`has no accessibility violations, sideways scroll or spilled text at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(url());
      await expect(page.getByRole("heading", { level: 1, name: "Loading, empty and error states" })).toBeVisible();
      expect(await overflows(page)).toEqual({ page: 0, spilled: [] });
      await expectNoA11yViolations(page);
    });
  }

  for (const mode of ["trade", "office"] as const) {
    test(`has no accessibility violations in ${mode} mode`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(url(`?mode=${mode}`));
      await expect(page.getByRole("link", { name: mode === "trade" ? "Trade" : "Office" })).toHaveAttribute("aria-current", "page");
      await expectNoA11yViolations(page);
    });
  }

  for (const state of ["empty", "error", "jobs"] as const) {
    test(`the usage example opens in the ${state} state with ?state=${state}, with no violations`, async ({ page }) => {
      await page.goto(url(`?state=${state}`));
      const usage = page.locator("#usage");
      await expect(usage.getByRole("button", { name: state[0].toUpperCase() + state.slice(1) })).toHaveAttribute("aria-pressed", "true");
      const expected = { empty: "Nothing on yet.", error: "Can’t load your jobs", jobs: "Leaking kitchen mixer tap" }[state];
      await expect(usage.locator("section h4, section li").filter({ hasText: expected })).toBeVisible();
      await expectNoA11yViolations(page, { include: "#usage" });
    });
  }

  test("still works at 200% zoom: text wraps, nothing spills, no sideways scroll", async ({ browser }) => {
    // A 1280px window at 200% is a 640px-wide page drawn at twice the size.
    const context = await browser.newContext({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    await page.goto(url());
    await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
    expect(await overflows(page)).toEqual({ page: 0, spilled: [] });
    await context.close();
  });

  test("skeletons are hidden from screen readers, wait 300ms, and shimmer", async ({ page }) => {
    await page.goto(url());
    const skel = page.locator("#skeletons .tm-skel").first();
    await expect(skel).toHaveAttribute("aria-hidden", "true");
    const look = await skel.evaluate((el) => ({
      delay: getComputedStyle(el).animationDelay,
      shimmer: getComputedStyle(el, "::after").animationName,
    }));
    expect(look).toEqual({ delay: "0.3s", shimmer: "tm-shimmer" });
  });

  test("with reduced motion the skeleton is static grey and the spinner stands still", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto(url());
    const skel = page.locator("#skeletons .tm-skel").first();
    expect(await skel.evaluate((el) => getComputedStyle(el, "::after").display)).toBe("none");
    expect(await skel.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
    const ring = page.locator("#progress [aria-hidden=true]").first();
    expect(await ring.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    await context.close();
  });

  test("a slow load shows the skeleton, says “Loading your jobs” once, then the list cross-fades in", async ({ page }) => {
    await page.goto(url());
    const region = page.locator(REGION);
    await page.getByRole("button", { name: "Load slowly (3s)" }).click();
    await expect(region).toHaveAttribute("aria-busy", "true");
    await expect(region.locator(".tm-skel").first()).toBeVisible();
    await expect(statusAfter(page, REGION)).toHaveText("Loading your jobs");
    await expect(region.getByText("Leaking kitchen mixer tap")).toBeVisible({ timeout: 5000 });
    await expect(region).not.toHaveAttribute("aria-busy");
    await expect(region.locator(".tm-anim-swap")).toHaveCount(1);
    await expect(statusAfter(page, REGION)).toHaveText("");
  });

  test("a quick load says nothing", async ({ page }) => {
    await page.goto(url());
    await page.getByRole("button", { name: "Load quickly (0.2s)" }).click();
    await expect(page.getByText("Loaded 1 time")).toBeVisible();
    await page.waitForTimeout(400);
    await expect(statusAfter(page, REGION)).toHaveText("");
  });

  test("Try again works from the keyboard: spinner while it runs, the error is said again, then the list loads", async ({ page }) => {
    await page.goto(url());
    const card = row(page, "errors", "Try it");
    const retry = card.getByRole("button", { name: /^Try again/ });
    await retry.focus();
    expect(await retry.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
    await page.keyboard.press("Enter");
    await expect(retry).toHaveAttribute("aria-busy", "true");
    await page.keyboard.press("Enter"); // can't be pressed twice
    await expect(card.getByText("Tried 1 time.")).toBeVisible({ timeout: 4000 });
    await expect(card.getByRole("status")).toHaveText("Can’t load your jobs");
    await card.getByRole("button", { name: /^Try again/ }).press("Space");
    await expect(card.getByText("Loaded after 2 tries.")).toBeVisible({ timeout: 4000 });
  });

  test("an inline error's Try again saves", async ({ page }) => {
    await page.goto(url());
    const inline = row(page, "errors", "Inline, try it");
    await inline.getByRole("button", { name: "Try again" }).click();
    await expect(inline.getByRole("status").filter({ hasText: "Saved." })).toBeVisible({ timeout: 4000 });
  });

  test("the real offline banner follows the browser: offline, Retry, then back online", async ({ page, context }) => {
    await page.goto(url());
    const banner = page.locator("[data-offline]").first();
    await expect(page.locator("body > * [data-offline]")).toHaveCount(2); // the two static previews
    await context.setOffline(true);
    await expect(page.locator("[data-offline]")).toHaveCount(3);
    await expect(banner).toContainText("Offline.");
    await expect(banner.getByRole("button", { name: "Retry" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Connection" })).toContainText("Offline.");
    expect(await banner.evaluate((el) => getComputedStyle(el.parentElement!).position)).toBe("sticky");
    // Said once, by the real banner only: the static previews were offline from the start, so they stay quiet.
    await expect(page.getByRole("status").filter({ hasText: "Offline." })).toHaveCount(1);
    await expectNoA11yViolations(page);
    // Retrying (by hand, or the automatic one after 2s) fetches again; it never reloads or leaves the page.
    await banner.getByRole("button", { name: "Retry" }).click();
    await page.waitForTimeout(2500);
    expect(new URL(page.url()).pathname).toBe("/dev/components/feedback");
    await expect(page.locator("[data-offline]")).toHaveCount(3);

    await context.setOffline(false);
    await expect(page.locator("[data-offline]")).toHaveCount(2);
    const back = page.locator("b", { hasText: "Back online." });
    await expect(back).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Back online." })).toHaveCount(1);
    await expect(back).toHaveCount(0, { timeout: 6000 }); // gone after 4s

  });

  test("offline, it retries by itself with backoff", async ({ page }) => {
    await page.goto(url());
    const offline = page.locator("#offline");
    await offline.getByRole("button", { name: "Pretend to go offline" }).click();
    await expect(offline.getByText("Retried 0 times")).toBeVisible();
    await expect(offline.getByText("Retried 1 time")).toBeVisible({ timeout: 3500 }); // after 2s
    await offline.getByRole("button", { name: "Retry" }).last().click();
    await expect(offline.getByText("Retried 2 times")).toBeVisible();
    await offline.getByRole("button", { name: "Come back online" }).click();
    await expect(offline.getByText("Retried 3 times")).toBeVisible(); // once more on reconnecting
    await expect(offline.locator("b", { hasText: "Back online." })).toBeVisible();
  });

  test("progress bars have names and values; the upload demo fills to 100%", async ({ page }) => {
    await page.goto(url());
    await expect(page.getByRole("progressbar", { name: "Uploading hallway.jpg" })).toHaveAttribute("aria-valuenow", "40");
    await page.getByRole("button", { name: "Upload a photo" }).click();
    await expect(page.getByRole("progressbar", { name: "Uploaded kitchen.jpg" })).toHaveAttribute("aria-valuenow", "100", { timeout: 5000 });
  });
});
