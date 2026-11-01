import { expect, type Page, test } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

// The 404 and 500 pages (#109). The 404 is checked on the production build (`npm run e2e`): any missing address.
// The 500 can only be shown on purpose on the dev-only preview, so those checks run against `npm run dev`:
//   E2E_DEV_BASE_URL=http://localhost:3000 npx playwright test tests/e2e/error-pages.spec.ts

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe("404", () => {
  test.skip(Boolean(process.env.E2E_DEV_BASE_URL), "checked on the production build");

  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: a missing page says so, with status 404, no sideways scroll and no axe violations`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const response = await page.goto("/this-page-is-missing");
      expect(response?.status()).toBe(404);
      await expect(page).toHaveTitle("Page not found | Trade Marketplace");
      await expect(page.getByRole("heading", { level: 1, name: "Wrong address." })).toBeVisible();
      await expect(page.locator("footer")).toBeVisible();
      expect(await overflow(page)).toBe(0);
      await expectNoA11yViolations(page);
    });
  }

  test("Go home and Help centre work by keyboard", async ({ page }) => {
    await page.goto("/missing/deeper/page");
    const main = page.locator("main");
    await main.getByRole("link", { name: "Help centre" }).focus();
    await expect(main.getByRole("link", { name: "Help centre" })).toHaveAttribute("href", "/help");
    await main.getByRole("link", { name: "Go home" }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/$/);
  });

  test("the skip link jumps to the message", async ({ page }) => {
    await page.goto("/this-page-is-missing");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("main#main")).toBeFocused();
  });
});

const devUrl = process.env.E2E_DEV_BASE_URL;
const preview = (query: string) => (devUrl ? new URL(`/dev/components/error-pages${query}`, devUrl).href : "");

test.describe("500 (dev preview)", () => {
  test.skip(!devUrl, "set E2E_DEV_BASE_URL to a running `npm run dev` to check the dev-only preview");

  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: no sideways scroll and no axe violations`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const query of ["?page=500", "?page=500&ref=off", "?page=404"]) {
        await page.goto(preview(query));
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        expect(await overflow(page), query).toBe(0);
        await expectNoA11yViolations(page);
      }
    });
  }

  test("says it's our fault, shows the reference, and Try again works by keyboard", async ({ page }) => {
    await page.goto(preview("?page=500"));
    await expect(page.getByRole("heading", { level: 1, name: "Something broke on our end." })).toBeVisible();
    await expect(page.getByText("Error ref 7F3A-91C2 (for support)")).toBeVisible();
    await expect(page.getByRole("link", { name: "Contact us" })).toHaveAttribute("href", "/contact");
    await page.getByRole("button", { name: "Try again" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status").filter({ hasText: "Try again pressed 1 time" })).toBeVisible();
  });

  test("an error from the browser shows no reference", async ({ page }) => {
    await page.goto(preview("?page=500&ref=off"));
    await expect(page.getByRole("heading", { level: 1, name: "Something broke on our end." })).toBeVisible();
    await expect(page.getByText(/Error ref/)).toHaveCount(0);
  });

  test("200% text still fits", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const query of ["?page=500", "?page=404"]) {
      await page.goto(preview(query));
      await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
      expect(await overflow(page), query).toBe(0);
    }
  });
});
