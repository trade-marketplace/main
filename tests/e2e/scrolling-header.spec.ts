import { expect, test, type Page } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const dev = process.env.E2E_DEV_BASE_URL;
const header = (page: Page) => page.locator("header.tm-navfill");
async function expectFill(page: Page, solid: boolean) {
  await expect(header(page)).toHaveAttribute("data-solid", String(solid));
  await expect.poll(() => header(page).evaluate((el) => getComputedStyle(el, "::before").opacity)).toBe(solid ? "1" : "0");
  expect((await header(page).boundingBox())!.y).toBe(0);
  await expect(header(page).getByRole("link", { name: "Trade Marketplace home", exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
}

for (const reducedMotion of ["reduce", "no-preference"] as const) {
  test.describe(`scrolling header with motion ${reducedMotion}`, () => {
    test.use({ reducedMotion });
    for (const viewport of VIEWPORTS) {
      test(`${viewport.width}px: first scroll fills the header; it stays visible and resets only at the top`, async ({ page }) => {
        await page.setViewportSize(viewport); await page.goto("/"); await expectFill(page, false);
        await page.evaluate(() => scrollTo(0, 1)); await expectFill(page, true);
        // These positions include the exact collision in Matt's screenshot, both scroll directions and the next section.
        for (const y of [150, 350, 950, 120]) { await page.evaluate((top) => scrollTo(0, top), y); await expectFill(page, true); }
        await page.evaluate(() => scrollTo(0, 0)); await expectFill(page, false);
        await page.mouse.wheel(0, 200); await expectFill(page, true);
        if (viewport.width < 1024) {
          const menu = page.getByRole("button", { name: "Menu", exact: true });
          await menu.click(); await page.evaluate(() => scrollTo(0, 0)); await expectFill(page, true);
          await page.keyboard.press("Escape"); await expect(menu).toBeFocused(); await expectFill(page, false);
        }
        await page.evaluate(() => scrollTo(0, 350)); await expectFill(page, true);
        await page.reload(); await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0); await expectFill(page, true);
        await page.goto("/#category-heading"); await expectFill(page, true);
        const heading = await page.getByRole("heading", { name: "All sorts. Any job.", exact: true }).boundingBox();
        expect(heading!.y).toBeGreaterThanOrEqual((await header(page).boundingBox())!.height);
        await page.setViewportSize({ width: viewport.width < 1024 ? 1440 : 390, height: 900 }); await expectFill(page, true);
        await page.setViewportSize(viewport); await expectFill(page, true);
        await expectNoA11yViolations(page);
      });
    }
  });
}

test("200% text and keyboard scrolling keep the header legible", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 900 }); await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/"); await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await expectFill(page, false);
  await header(page).getByRole("link", { name: "Trade Marketplace home", exact: true }).focus();
  const scrolled = page.evaluate(() => new Promise<void>((resolve) => window.addEventListener("scrollend", () => resolve(), { once: true })));
  await page.keyboard.press("PageDown"); await scrolled; await expectFill(page, true);
  await page.evaluate(() => scrollTo(0, 0)); await expectFill(page, false);
  await expectNoA11yViolations(page);
});

test.describe("hero and plain-page navigation", () => {
  test.skip(!dev, "guarded local shell fixture");
  test.use({ reducedMotion: "reduce" });
  for (const width of [390, 1440]) {
    test(`${width}px: pages without a hero stay solid across route changes`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(new URL("/dev/components/site-shell?hero=off", dev).href); await expectFill(page, true);
      await page.getByRole("link", { name: "With a hero", exact: true }).click();
      await expect(page).toHaveURL(/site-shell$/); await page.evaluate(() => scrollTo(0, 0)); await expectFill(page, false);
      await page.evaluate(() => scrollTo(0, 120)); await expectFill(page, true);
      await page.getByRole("link", { name: "No hero", exact: true }).click();
      await expect(page).toHaveURL(/hero=off/); await page.evaluate(() => scrollTo(0, 0)); await expectFill(page, true);
    });
  }
});
