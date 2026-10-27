import { expect, type Page, test } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

// Sign up, step one (#103), on the production build (`npm run e2e`).

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe("/signup", () => {
  test.skip(Boolean(process.env.E2E_DEV_BASE_URL), "checked on the production build");

  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: both choices have no axe violations and no sideways scroll`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const query of ["", "?as=tradie"]) {
        await page.goto(`/signup${query}`);
        await expect(page).toHaveTitle("Create account | Trade Marketplace");
        await expect(page.getByRole("heading", { level: 1, name: "Create account" })).toBeVisible();
        expect(await overflow(page), query).toBe(0);
        await expectNoA11yViolations(page);
      }
    });
  }

  test("by keyboard: arrows change the choice, the page turns orange, Next goes to that side's details", async ({ page }) => {
    await page.goto("/signup?next=%2Fdashboard");
    const customer = page.getByRole("radio", { name: /I need a job done/ });
    const tradie = page.getByRole("radio", { name: /I’m a tradie/ });
    await expect(customer).toBeChecked();
    await expect(page.locator("body [data-mode]").first()).toHaveAttribute("data-mode", "customer");
    await customer.focus();
    await page.keyboard.press("ArrowDown");
    await expect(tradie).toBeChecked();
    await expect(tradie).toBeFocused();
    await expect(page.locator("body [data-mode]").first()).toHaveAttribute("data-mode", "trade");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Next" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/signup\/tradie\?next=%2Fdashboard$/);
  });

  test("clicking anywhere on a card chooses it", async ({ page }) => {
    await page.goto("/signup");
    // The radio covers its whole card, so a click on the words lands on it.
    const card = page.locator("label").filter({ hasText: "Get local work." });
    const box = (await card.boundingBox())!;
    await page.mouse.click(box.x + box.width - 12, box.y + box.height - 12);
    await expect(page.getByRole("radio", { name: /I’m a tradie/ })).toBeChecked();
  });

  test("a phone shows Log in under Next; a computer shows it top right", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/signup");
    await expect(page.locator("form").getByRole("link", { name: "Log in" })).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator("form").getByRole("link", { name: "Log in" })).toBeHidden();
    await expect(page.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
  });

  test("200% text still fits", async ({ page }) => {
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/signup");
      await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
      expect(await overflow(page)).toBe(0);
    }
  });
});
