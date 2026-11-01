import { expect, test } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

test.describe("How it works", () => {
  test.use({ reducedMotion: "reduce" });

  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: default state fits and passes axe`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/how-it-works");
      await expect(page).toHaveTitle(/How it works/);
      await expect(page.getByRole("heading", { level: 1, name: "How it works" })).toBeVisible();
      for (const name of ["Post it", "Accept the price", "Sorted"]) await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Any job in Invercargill." })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
      await expectNoA11yViolations(page);
    });
  }

  test("keyboard job start preserves the existing login return destination", async ({ page }) => {
    await page.goto("/how-it-works");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();
    const cta = page.getByRole("main").getByRole("link", { name: "Post a job", exact: true });
    for (let i = 0; i < 4; i++) await page.keyboard.press("Tab");
    await expect(cta).toBeFocused();
    await expect(cta).not.toHaveCSS("outline-style", "none");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/login\?next=%2Fjobs%2Fnew$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.getByRole("link", { name: "Sign up", exact: true }).click();
    await expect(page).toHaveURL(/\/signup\?next=%2Fjobs%2Fnew$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/login\?next=%2Fjobs%2Fnew$/);
  });

  test("phone menu marks the current page and dismisses after keyboard navigation", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/how-it-works");
    const menu = page.getByRole("button", { name: "Menu", exact: true });
    await menu.press("Enter");
    const current = page.getByRole("navigation", { name: "Menu", exact: true }).getByRole("link", { name: "How it works" });
    await expect(current).toHaveAttribute("aria-current", "page");
    await expect(current).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeFocused();
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await expectNoA11yViolations(page);
  });

  test("help questions use the separate Help destination", async ({ page }) => {
    await page.goto("/how-it-works");
    await page.getByRole("link", { name: "Is it really free to post?" }).click();
    await expect(page).toHaveURL(/\/help$/);
    // Help's implementation is a separate issue. Verify its actual current response, then return.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { level: 1, name: "How it works" })).toBeVisible();
  });

  test("step rows use M01 once on entering the viewport and M03 on their kit cards", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/how-it-works");
    const steps = page.getByRole("list", { name: "How it works", exact: true }).locator(":scope > li");
    for (const step of await steps.all()) {
      await step.scrollIntoViewIfNeeded();
      await expect(step).toHaveClass(/tm-anim-rise/);
      await expect(step).toHaveCSS("animation-name", "tm-rise");
      const card = step.locator(".tm-lift");
      await card.hover();
      await expect(card).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, -2)");
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(steps.last()).toHaveClass(/tm-anim-rise/);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(steps.first()).toHaveCSS("animation-name", "none");
  });
});
