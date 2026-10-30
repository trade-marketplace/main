import { expect, test } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const devUrl = process.env.E2E_DEV_BASE_URL;

test.describe("Account menu typeahead (#373)", () => {
  test.skip(!devUrl, "set E2E_DEV_BASE_URL to the isolated app-shell preview");

  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: visible labels, arrows, dismissal and focus`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(new URL("/dev/components/app-shell", devUrl!).href);
      const trigger = page.getByRole("button", { name: "Account: Sarah Thompson", exact: true });
      await trigger.focus();
      await page.keyboard.press("Enter");
      const menu = page.getByRole("menu");
      const item = (name: string) => menu.getByRole("menuitem", { name, exact: true });
      await expect(item("Account")).toBeFocused();
      // The real decorative icon is credit_card, which must not become the typeahead prefix.
      await expect(item("Payments").locator('[aria-hidden="true"]')).toHaveText("credit_card");
      await page.keyboard.press("P");
      await expect(item("Payments")).toBeFocused();
      await page.keyboard.press("a");
      await expect(item("Payments")).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(item("Notification settings")).toBeFocused();
      await page.keyboard.press("End");
      await expect(item("Log out")).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(item("Account")).toBeFocused();
      await page.keyboard.press("ArrowUp");
      await expect(item("Log out")).toBeFocused();
      await page.keyboard.press("Home");
      await expect(item("Account")).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      await expectNoA11yViolations(page);
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
      await expect(trigger).toBeFocused();
      await page.keyboard.press("ArrowUp");
      await expect(item("Log out")).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(menu).toBeHidden();
      await trigger.click();
      await expect(menu).toBeVisible();
      await page.getByRole("button", { name: "Read everything", exact: true }).click();
      await expect(menu).toBeHidden();
    });
  }

  test("ignores nested decorative content and cycles repeated letters", async ({ page }) => {
    await page.goto(new URL("/dev/components/app-shell", devUrl!).href);
    await page.getByRole("button", { name: "Account: Sarah Thompson", exact: true }).click();
    const menu = page.getByRole("menu");
    const payments = menu.getByRole("menuitem", { name: "Payments", exact: true });
    await payments.evaluate((element) => {
      const decoration = document.createElement("span");
      decoration.setAttribute("aria-hidden", "true");
      decoration.textContent = "wallet";
      element.lastElementChild!.prepend(decoration);
    });
    const help = menu.getByRole("menuitem", { name: "Help", exact: true });
    await help.evaluate((element) => element.setAttribute("aria-label", "Payment help"));
    await page.keyboard.press("p");
    await expect(payments).toBeFocused();
    await page.keyboard.press("p");
    await expect(menu.getByRole("menuitem", { name: "Payment help", exact: true })).toBeFocused();
    await page.keyboard.press("P");
    await expect(payments).toBeFocused();
    await page.keyboard.press("Control+h");
    await expect(payments).toBeFocused();
  });

  test("uses an explicit accessible label and gives labelledby precedence", async ({ page }) => {
    await page.goto(new URL("/dev/components/app-shell", devUrl!).href);
    await page.getByRole("button", { name: "Account: Sarah Thompson", exact: true }).click();
    const menu = page.getByRole("menu");
    await menu.getByRole("menuitem", { name: "Payments", exact: true }).evaluate((element) => {
      element.setAttribute("aria-label", "Billing");
    });
    await menu.getByRole("menuitem", { name: "Help", exact: true }).evaluate((element) => {
      element.lastElementChild!.id = "menu-help-label";
      element.setAttribute("aria-label", "Billing help");
      element.setAttribute("aria-labelledby", "missing-label menu-help-label");
    });
    await page.keyboard.press("b");
    await expect(menu.getByRole("menuitem", { name: "Billing", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    // Navigate anew so the existing typeahead timeout does not affect this separate label match.
    await page.goto(new URL("/dev/components/app-shell", devUrl!).href);
    await page.getByRole("button", { name: "Account: Sarah Thompson", exact: true }).click();
    await menu.getByRole("menuitem", { name: "Help", exact: true }).evaluate((element) => {
      element.lastElementChild!.id = "menu-help-label";
      element.setAttribute("aria-label", "Billing help");
      element.setAttribute("aria-labelledby", "missing-label menu-help-label");
    });
    await page.keyboard.press("h");
    await expect(menu.getByRole("menuitem", { name: "Help", exact: true })).toBeFocused();
  });
});
