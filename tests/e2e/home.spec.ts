import { expect, test } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

// Example end-to-end test against the placeholder home page (the real one is #211).
// Signing in as each role is added with sign-in (#101/#102).

for (const viewport of VIEWPORTS) {
  test.describe(`home page at ${viewport.width}px`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("loads with the product name as the heading", async ({ page }) => {
      const response = await page.goto("/");
      expect(response?.status()).toBe(200);
      await expect(page).toHaveTitle("Trade Marketplace");
      await expect(page.getByRole("heading", { level: 1, name: "Trade Marketplace" })).toBeVisible();
    });

    test("has no sideways scroll", async ({ page }) => {
      await page.goto("/");
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBe(0);
    });

    test("has no accessibility violations", async ({ page }) => {
      await page.goto("/");
      await expectNoA11yViolations(page);
    });
  });
}
