import { expect, type Page, test } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

// /dev/components/map (#82) is a development-only page. `npm run e2e` runs the production build, where it must be
// a 404. To check the page itself, start `npm run dev` and point these tests at it:
//   E2E_DEV_BASE_URL=http://localhost:3000 npx playwright test tests/e2e/dev-components-map.spec.ts
// (use "localhost", not 127.0.0.1: `next dev` blocks its scripts on other hosts).

test("/dev/components/map is not in production builds", async ({ page }) => {
  test.skip(Boolean(process.env.E2E_DEV_BASE_URL), "checking the dev server instead");
  const response = await page.goto("/dev/components/map");
  expect(response?.status()).toBe(404);
});

const devUrl = process.env.E2E_DEV_BASE_URL;
const url = (query = "") => (devUrl ? new URL(`/dev/components/map${query}`, devUrl).href : "");

async function sidewaysScroll(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** The map + list layout's map, where the real pins are (the tiles above are single examples). */
const layoutMap = (page: Page) => page.getByRole("region", { name: /^Map of / });

test.describe("/dev/components/map on the dev server", () => {
  test.skip(!devUrl, "set E2E_DEV_BASE_URL to a running `npm run dev`");

  for (const viewport of VIEWPORTS) {
    for (const state of ["", "?state=loading", "?state=empty", "?state=error"]) {
      test(`has no accessibility violations or sideways scroll at ${viewport.width}px ${state || "(jobs)"}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(url(state));
        await expect(page.getByRole("heading", { level: 1, name: "Map pins" })).toBeVisible();
        await page.waitForTimeout(400); // pins finish dropping in (M21)
        expect(await sidewaysScroll(page)).toBe(0);
        await expectNoA11yViolations(page);
      });
    }
  }

  test("still works at 200% zoom (a 1440px screen zoomed in is a 720px page)", async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 450 });
    await page.goto(url());
    await page.waitForTimeout(400);
    expect(await sidewaysScroll(page)).toBe(0);
    await expect(layoutMap(page).getByRole("button", { name: /^Bounty: Hot water cylinder, Gladstone, \d+ h left$/ })).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("every pin can be reached with the keyboard and is named", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url());
    const pin = layoutMap(page).getByRole("button", { name: /^Bounty: Hot water cylinder, Gladstone, 3 h left$/ });
    await expect(pin).toBeVisible();
    // Tab until the pin has focus.
    for (let i = 0; i < 80 && !(await pin.evaluate((el) => el === document.activeElement)); i++) {
      await page.keyboard.press("Tab");
    }
    await expect(pin).toBeFocused();
    await expect(pin).toHaveClass(/is-hot/);
  });

  test("hovering a row grows its pin, and hovering a pin highlights its row (M21)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url());
    await page.waitForTimeout(400);
    const list = page.getByRole("list", { name: /jobs in view/ });
    const row = list.getByRole("button", { name: /^Ready to claim: Sub wiring/ });
    const pin = layoutMap(page).getByRole("button", { name: /^Ready to claim: Sub wiring/ });
    await expect(pin).not.toHaveClass(/is-hot/);
    await row.hover();
    await expect(pin).toHaveClass(/is-hot/);
    await page.mouse.move(0, 0);
    await expect(pin).not.toHaveClass(/is-hot/);
    await pin.hover();
    await expect(row).toHaveAttribute("data-hot", "true");
  });

  test("picking a pin opens its card; Esc closes it and gives focus back", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url());
    await page.waitForTimeout(400);
    const pin = layoutMap(page).getByRole("button", { name: /^Ready to claim: Control panel/ });
    await pin.focus();
    await page.keyboard.press("Enter");
    const card = page.getByRole("article", { name: "Control panel" });
    await expect(card).toBeVisible();
    await expect(card).toContainText("You earn");
    await expect(card).toContainText("$410.00");
    await expectNoA11yViolations(page);
    await page.keyboard.press("Escape");
    await expect(card).toHaveCount(0);
    await expect(pin).toBeFocused();
  });

  test("the countdown is never a live region", async ({ page }) => {
    await page.goto(url());
    await expect(page.locator("main [aria-live], main [role=timer]")).toHaveCount(0);
  });

  test("pins for jobs the tradie hasn't claimed are approximate", async ({ page }) => {
    await page.goto(url());
    const pins = layoutMap(page).locator("[data-precision]");
    expect(await pins.count()).toBeGreaterThan(0);
    for (const precision of await pins.evaluateAll((els) => els.map((el) => el.getAttribute("data-precision")))) {
      expect(precision).toBe("approximate");
    }
  });

  test("close pins merge into a cluster at phone width, and pressing it zooms in", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url());
    // The bounty's card starts open over the bottom of the map: close it first.
    await page.getByRole("button", { name: "Close Hot water cylinder" }).click();
    const cluster = layoutMap(page).getByRole("button", { name: /jobs here.*Zoom in to see them$/ }).first();
    await expect(cluster).toBeVisible();
    await cluster.click();
    const showAll = page.getByRole("button", { name: "Show all jobs" });
    await expect(showAll).toBeFocused();
    await expectNoA11yViolations(page);
    await showAll.click();
    await expect(showAll).toHaveCount(0);
  });

  test("reduced motion stops the bounty shimmer and makes the hover growth instant", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(url());
    const pin = layoutMap(page).getByRole("button", { name: /^Bounty: Hot water cylinder/ });
    await expect(pin).toHaveClass(/tm-glint/);
    const motion = await pin.evaluate((el) => ({
      glint: getComputedStyle(el, "::before").animationName,
      transition: getComputedStyle(el).transitionDuration,
      drop: getComputedStyle(el).animationName,
    }));
    expect(motion.glint).toBe("none");
    expect(motion.drop).toBe("none");
    expect(motion.transition).toBe("0s");
  });

  test("long titles and suburbs are cut in the list with the whole text in a tooltip", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(url());
    const row = page.getByRole("list", { name: /jobs in view/ }).getByRole("button", { name: /^Needs an estimate: Replace all the guttering/ });
    await expect(row).toHaveAttribute("title", /Replace all the guttering.*Invercargill Central Business District/);
    const box = await row.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(320);
  });
});
