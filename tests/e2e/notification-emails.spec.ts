import { expect, test } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const dev = process.env.E2E_DEV_BASE_URL;
const url = (template: string) => new URL(`/dev/components/emails?template=${template}`, dev).href;
test("email previews keep their production guard", async ({ page }) => {
  test.skip(Boolean(dev), "Guard is checked without the local preview opt-in.");
  expect((await page.goto("/dev/components/emails"))?.status()).toBe(404);
});

test.describe("G05 notification email previews", () => {
  test.skip(!dev, "Requires a guarded local preview server.");
  for (const viewport of VIEWPORTS) test(`${viewport.width}px: all three templates fit and pass axe`, async ({ page }) => {
    await page.setViewportSize(viewport);
    for (const [template, heading, button] of [["price-ready", "Your price is ready", "See your price"], ["please-check", "Jack’s finished.", "Check & rate"], ["licence-checked", "You’re good to go.", "Find work"]]) {
      await page.goto(url(template));
      const frame = page.frameLocator("iframe");
      await expect(frame.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible();
      await expect(frame.getByRole("link", { name: button, exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
      expect(await frame.locator("html").evaluate(element => element.scrollWidth - element.clientWidth)).toBe(0);
      await expectNoA11yViolations(page);
    }
  });
  test("template navigation and Back preserve the selected message", async ({ page }) => {
    await page.goto(url("price-ready"));
    await page.getByRole("link", { name: "Please check", exact: true }).click();
    await expect(page).toHaveURL(/template=please-check$/);
    await expect(page.frameLocator("iframe").getByRole("heading", { name: "Jack’s finished.", exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.frameLocator("iframe").getByRole("link", { name: "See your price", exact: true })).toBeVisible();
  });
  for (const width of [390, 1440]) test(`${width}px: dark-mode email templates pass axe`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: "dark" });
    for (const template of ["price-ready", "please-check", "licence-checked"]) {
      await page.goto(url(template));
      await expect(page.frameLocator("iframe").getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoA11yViolations(page);
    }
  });
});
