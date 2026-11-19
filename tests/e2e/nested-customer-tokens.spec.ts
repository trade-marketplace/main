import { expect, type Locator, test } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const preview = process.env.POSTED_PREVIEW_E2E_URL || "http://127.0.0.1:3101";
const tokens = ["action", "on-action", "signature", "on-signature", "link", "tint", "tint-strong"];

function palette(element: Locator) {
  return element.evaluate((el, names) => {
    const style = getComputedStyle(el);
    return names.map((name) => style.getPropertyValue(`--trade-${name}`).trim());
  }, tokens);
}

function fill(element: Locator) {
  return element.evaluate((el) => {
    const style = getComputedStyle(el);
    return [style.backgroundColor, style.color];
  });
}

for (const label of ["Trade", "Office"]) {
  const mode = label.toLowerCase();
  for (const { width, height } of VIEWPORTS) {
    test(`customer colours inside ${mode} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto(new URL("/dev/tokens", preview).href);
      const column = page.locator('#modes [data-mode="customer"]');
      const primary = column.getByText("Primary", { exact: true });
      const hero = column.getByText("Hero", { exact: true });
      const defaults = await palette(column);
      const primaryColours = await fill(primary);
      const heroColours = await fill(hero);

      const modes = page.getByRole("navigation", { name: "Mode", exact: true });
      const selection = modes.getByRole("link", { name: label, exact: true });
      await selection.click();
      await expect(selection).toHaveAttribute("aria-current", "page");
      const section = page.getByRole("region", { name: "Modes side by side" });
      await expect(page.locator(`[data-mode="${mode}"] #modes`)).toBeVisible();
      const surrounding = await palette(section);
      expect(surrounding).toEqual(await palette(section.locator(`[data-mode="${mode}"]`)));
      expect(surrounding).not.toEqual(defaults);
      expect(await palette(column)).toEqual(defaults);
      expect(await fill(primary)).toEqual(primaryColours);
      expect(await fill(hero)).toEqual(heroColours);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
      await expectNoA11yViolations(page, { include: "#modes" });

      await page.goBack();
      await expect(modes.getByRole("link", { name: "Customer", exact: true })).toHaveAttribute("aria-current", "page");
      expect(await palette(section)).toEqual(defaults);
    });
  }
}
