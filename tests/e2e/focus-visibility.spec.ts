import { expect, test, type Locator } from "@playwright/test";

import { VIEWPORTS } from "./support/viewports";

const dev = process.env.E2E_DEV_BASE_URL;
const control = (input: Locator) => input.locator("xpath=ancestor::*[@data-variant][1]");

test.describe("focus follows the input method", () => {
  test.use({ reducedMotion: "reduce" });
  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: clicking and typing are ring-free; Tab restores the field and button rings`, async ({ page }) => {
      await page.setViewportSize(viewport); await page.goto("/login");
      const email = page.getByRole("textbox", { name: "Email", exact: true });
      const password = page.getByLabel("Password", { exact: true });
      const initialBorder = await control(email).evaluate((el) => getComputedStyle(el).borderBottomColor);
      await email.click(); await expect(control(email)).toHaveCSS("outline-style", "none");
      await expect(control(email)).toHaveCSS("border-bottom-width", "1px");
      await expect(control(email)).toHaveCSS("border-bottom-color", initialBorder);
      await email.pressSequentially("matt@example.test"); await email.press("ArrowLeft");
      await expect(control(email)).toHaveCSS("outline-style", "none");
      await page.keyboard.press("Tab"); await expect(password).toBeFocused();
      await expect(control(password)).toHaveCSS("outline-width", "2px");
      await expect(control(password)).toHaveCSS("outline-style", "solid");
      await password.click(); await expect(control(password)).toHaveCSS("outline-style", "none");
      await expect(control(password)).toHaveCSS("border-bottom-width", "1px");
      await page.keyboard.press("Tab");
      const show = page.getByRole("button", { name: "Show password", exact: true });
      await expect(show).toBeFocused(); await expect(show).toHaveCSS("outline-style", "solid");
      await show.click(); await expect(page.getByRole("button", { name: "Hide password", exact: true })).toHaveCSS("outline-style", "none");
      await page.keyboard.press("Shift+Tab"); await expect(password).toBeFocused();
      await expect(control(password)).toHaveCSS("outline-style", "solid");
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    });

    test(`${viewport.width}px: example-chip focus and pointer-opened location dialog have no ring`, async ({ page }) => {
      await page.setViewportSize(viewport); await page.goto("/");
      await page.locator("header[data-solid]").waitFor();
      const form = page.getByRole("form", { name: "What needs doing?", exact: true });
      const field = form.getByRole("textbox");
      await page.getByRole("button", { name: "Leaking tap", exact: true }).click();
      await expect(field).toBeFocused(); await expect(field).toHaveValue("Leaking tap");
      await expect(control(field)).toHaveCSS("outline-style", "none");
      const location = form.getByRole("button", { name: /Change location/ });
      await location.click();
      const dialog = page.getByRole("dialog", { name: "Location", exact: true });
      const address = dialog.getByRole("combobox");
      await address.click(); await expect(control(address)).toHaveCSS("outline-style", "none");
      await page.keyboard.press("Tab");
      await expect(dialog.getByRole("button", { name: "Use location", exact: true })).toHaveCSS("outline-style", "solid");
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await expect(dialog).not.toBeVisible(); await expect(location).toBeFocused();
      await expect(location).toHaveCSS("outline-style", "none");
      await page.keyboard.press("Shift+Tab"); await expect(field).toBeFocused();
      await expect(control(field)).toHaveCSS("outline-style", "solid");
    });
  }
});

test.describe("touch focus", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  test("tapping fields and example chips keeps them functional and ring-free", async ({ page }) => {
    await page.goto("/"); await page.locator("header[data-solid]").waitFor();
    await page.getByRole("button", { name: "Leaking tap", exact: true }).tap();
    const field = page.getByRole("form", { name: "What needs doing?", exact: true }).getByRole("textbox");
    await expect(field).toHaveValue("Leaking tap"); await expect(control(field)).toHaveCSS("outline-style", "none");
    await field.tap(); await field.pressSequentially(" today"); await expect(control(field)).toHaveCSS("outline-style", "none");
  });
});

test("without JavaScript keyboard focus still has the original M05 ring", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    await page.goto(new URL("/login", baseURL).href);
    await page.getByRole("textbox", { name: "Email", exact: true }).focus();
    await expect(control(page.getByRole("textbox", { name: "Email", exact: true }))).toHaveCSS("outline-style", "solid");
  } finally { await context.close(); }
});

test.describe("outside-area banner", () => {
  test.skip(!dev, "guarded local state fixture");
  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: title and action wrap as whole items and align with the icon`, async ({ page }) => {
      await page.setViewportSize(viewport); await page.goto(new URL("/dev/components/landing?state=outside", dev).href);
      await page.locator("header[data-solid]").waitFor();
      const title = page.getByText("We're in Invercargill.", { exact: true });
      const action = page.getByRole("button", { name: "Change location", exact: true });
      const titleBox = (await title.boundingBox())!; const actionBox = (await action.boundingBox())!;
      expect(actionBox.x).toBeGreaterThanOrEqual(titleBox.x);
      expect(actionBox.height).toBeGreaterThanOrEqual(44);
      expect(await action.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe("nowrap");
      if (viewport.width >= 390) expect(Math.abs((titleBox.y + titleBox.height / 2) - (actionBox.y + actionBox.height / 2))).toBeLessThan(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
      await action.click(); await expect(page.getByRole("dialog", { name: "Location", exact: true })).toBeVisible();
    });
  }
});

test.describe("shared keyboard navigation after a click", () => {
  test.skip(!dev, "guarded local component fixtures");
  for (const width of [390, 1440]) {
    test(`${width}px: menu arrows and typeahead restore focus visibility`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(new URL("/dev/components/app-shell", dev).href);
      const trigger = page.getByRole("button", { name: /^Account:/ });
      await trigger.click();
      const menu = page.getByRole("menu", { name: "Account", exact: true });
      const first = menu.getByRole("menuitem", { name: "Account", exact: true });
      await expect(first).toBeFocused(); await expect(first).toHaveCSS("outline-style", "none");
      await page.keyboard.press("ArrowDown");
      const payments = menu.getByRole("menuitem", { name: "Payments", exact: true });
      await expect(payments).toBeFocused(); await expect(payments).toHaveCSS("outline-style", "solid");
      await trigger.click(); await trigger.click();
      await expect(first).toBeFocused(); await expect(first).toHaveCSS("outline-style", "none");
      await page.keyboard.press("n");
      const notifications = menu.getByRole("menuitem", { name: "Notification settings", exact: true });
      await expect(notifications).toBeFocused(); await expect(notifications).toHaveCSS("outline-style", "solid");
      await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
    });
  }

  test("address suggestion arrows show the ring; typing alone does not", async ({ page }) => {
    await page.goto(new URL("/dev/components/landing?state=signed-out", dev).href);
    await page.locator("header[data-solid]").waitFor();
    await page.getByRole("form", { name: "What needs doing?", exact: true }).getByRole("button", { name: /Change location/ }).click();
    const address = page.getByRole("dialog").getByRole("combobox");
    await address.click(); await address.fill("Well");
    await expect(control(address)).toHaveCSS("outline-style", "none");
    await page.getByRole("option").waitFor(); await address.press("ArrowDown");
    await expect(control(address)).toHaveCSS("outline-style", "solid");
    await expect(page.getByRole("option")).toHaveCSS("outline-style", "solid");
    await address.press("Enter"); await expect(page.getByRole("option")).toHaveCount(0);
  });
});
