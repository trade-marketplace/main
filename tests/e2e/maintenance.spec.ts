import { expect, test } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";
import { waitForPageSettled } from "./support/page-settled";
import { VIEWPORTS } from "./support/viewports";

const preview = process.env.POSTED_PREVIEW_E2E_URL || "http://127.0.0.1:3101";

for (const viewport of VIEWPORTS) {
  test(`maintenance page and warning fit ${viewport.width}px and pass axe`, async ({ page }) => {
    await page.setViewportSize(viewport);
    for (const state of ["page", "banner"]) {
      const response = await page.goto(`${preview}/dev/components/maintenance?state=${state}`);
      expect(response?.status()).toBe(200);
      if (state === "page") {
        await expect(page.getByRole("heading", { name: "Back at 6am." })).toBeVisible();
        await expect(page.getByText("We’re doing some upgrades tonight", { exact: false })).toContainText("Fri 7 Nov, 11pm–6am");
        await expect(page.locator("main img")).toHaveJSProperty("naturalWidth", 500);
      } else {
        await expect(page.getByRole("complementary", { name: "Scheduled maintenance" })).toHaveText(/Upgrades on Fri 7 Nov, 11pm–6am. Your jobs are safe./);
        await page.keyboard.press("Tab");
        const skip = page.getByRole("link", { name: /skip/i });
        await expect(skip).toBeFocused();
        await expect(skip).toBeInViewport();
        await page.keyboard.press("Enter");
        await expect(page.getByRole("main")).toBeFocused();
      }
      await waitForPageSettled(page, "Trade Marketplace");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expectNoA11yViolations(page);
    }
  });
}
