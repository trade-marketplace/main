import { expect, test } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const preview = process.env.PREFERENCES_PREVIEW_URL;
const url = (state = "", mode = "customer") => `${preview}/dev/components/notification-preferences?state=${state}&mode=${mode}`;
const emailName = "Email: Your price is ready";

test("notification preferences require login and keep the return path", async ({ page }) => {
  await page.goto("/profile/notifications");
  await expect(page).toHaveURL(/\/login\?next=%2Fprofile%2Fnotifications$/);
});

test.describe("notification preference UI", () => {
  test.skip(!preview, "Set PREFERENCES_PREVIEW_URL to an isolated local preview.");
  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: all states fit and pass axe`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.setViewportSize(viewport);
      for (const state of ["", "empty", "loading", "error", "offline", "saving", "saved", "save-error", "expired"]) {
        await page.goto(url(state));
        await expect(page.getByRole("heading", { name: "Notifications", exact: true })).toBeVisible();
        await expect(page.locator("main .tm-anim-rise")).toHaveCSS("opacity", "1");
        if (state === "saved") await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
        if (state === "save-error") await expect(page.getByText("Couldn’t save.", { exact: true }).first()).toBeVisible();
        if (state === "expired") await expect(page.getByText("Log in to save.", { exact: true }).first()).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), state).toBe(0);
        await expectNoA11yViolations(page);
      }
      await page.goto(url("", "trade"));
      await expect(page.getByRole("checkbox", { name: "Email: Payout paid", exact: true })).toBeVisible();
      await expect(page.locator("main .tm-anim-rise")).toHaveCSS("opacity", "1");
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      await expectNoA11yViolations(page);
    });
  }

  test("keyboard changes save immediately, Undo restores the prior value, and mandatory reasons are accessible", async ({ page }) => {
    await page.goto(url());
    const checkbox = page.getByRole("checkbox", { name: emailName, exact: true });
    await expect(checkbox).toBeChecked();
    await checkbox.focus(); await page.keyboard.press("Space");
    await expect(checkbox).not.toBeChecked();
    await expect(checkbox.locator("+ span")).toHaveCSS("outline-style", "solid");
    const undo = page.getByRole("button", { name: "Undo", exact: true });
    await expect(undo).toBeVisible(); await undo.press("Enter");
    await expect(checkbox).toBeChecked();
    const mandatory = page.getByRole("checkbox", { name: "Email: Extra work needs your OK", exact: true });
    await expect(mandatory).toBeDisabled(); await expect(mandatory).toBeChecked();
    await expect(mandatory).toHaveAccessibleDescription("Always on: you need to decide.");
    await expect(page.getByRole("checkbox", { name: "Email: Receipts", exact: true })).toHaveAccessibleDescription("Receipts require email.");
    await expect(page.getByText(/SMS|Saved automatically|Pick how|So you can/)).toHaveCount(0);
    await expectNoA11yViolations(page);
  });

  test("failed changes roll back, Retry saves them, and the page stays usable", async ({ page, context }) => {
    await page.goto(url("failure"));
    const checkbox = page.getByRole("checkbox", { name: emailName, exact: true });
    await checkbox.click();
    await expect(page.getByText("Couldn’t save.", { exact: true }).first()).toBeVisible();
    await expect(checkbox).toBeChecked();
    await context.setOffline(true);
    await expect(page.getByRole("button", { name: "Try again", exact: true })).toHaveCount(0);
    await context.setOffline(false);
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(checkbox).not.toBeChecked();
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
    await expect(page.getByText("Couldn’t save.", { exact: true })).toHaveCount(0);
    await expectNoA11yViolations(page);
  });

  test("rapid changes keep the last intention when earlier writes finish", async ({ page }) => {
    await page.goto(url("rapid"));
    const checkbox = page.getByRole("checkbox", { name: emailName, exact: true });
    await checkbox.uncheck(); await checkbox.check(); await checkbox.uncheck(); await checkbox.check();
    await expect(checkbox).toBeChecked();
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(checkbox).toBeChecked();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(checkbox).not.toBeChecked();
  });

  test("offline prevents changes and reconnect restores controls", async ({ page, context }) => {
    await page.goto(url());
    const checkbox = page.getByRole("checkbox", { name: emailName, exact: true });
    await context.setOffline(true);
    await expect(page.getByText("Offline.", { exact: true }).first()).toBeVisible(); await expect(checkbox).toBeDisabled();
    await expect(checkbox).toHaveAccessibleDescription("Reconnect before changing notifications.");
    await expectNoA11yViolations(page);
    await context.setOffline(false); await expect(checkbox).toBeEnabled(); await checkbox.uncheck();
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
  });

  test("an odd number of rapid toggles still offers Undo for the confirmed value", async ({ page }) => {
    await page.goto(url("rapid"));
    const checkbox = page.getByRole("checkbox", { name: emailName, exact: true });
    await checkbox.uncheck(); await checkbox.check(); await checkbox.uncheck();
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(checkbox).not.toBeChecked();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(checkbox).toBeChecked();
  });

  test("a load error retries into the matrix", async ({ page }) => {
    await page.goto(url("error"));
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: emailName, exact: true })).toBeVisible();
    await expectNoA11yViolations(page);
  });
});
