import { expect, test } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

test("security settings require login and preserve the destination", async ({ page }) => {
  await page.goto("/profile/security");
  await expect(page).toHaveURL(/\/login\?next=%2Fprofile%2Fsecurity$/);
});

const devUrl = process.env.E2E_DEV_BASE_URL;
const url = (query = "") => new URL(`/dev/components/security${query}`, devUrl).href;

test.describe("security settings isolated UI", () => {
  test.skip(!devUrl, "Set E2E_DEV_BASE_URL for the guarded dev preview.");
  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: all states fit and have no accessibility violations`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize(viewport);
      for (const state of ["", "wrong", "success", "unavailable", "loading", "limited", "invalid-link", "pending-email", "partial", "expired", "offline", "pending", "access-errors"]) {
        await page.goto(url(`?state=${state}`));
        await expect(page.getByRole("heading", { name: "Security", exact: true })).toBeVisible();
        await expect(page.locator("main .tm-anim-rise")).toHaveCSS("opacity", "1");
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), state).toBe(0);
        await expectNoA11yViolations(page);
      }
      await page.goto(url("?mode=trade"));
      await expect(page.locator("main .tm-anim-rise")).toHaveCSS("opacity", "1");
      await expectNoA11yViolations(page);
      await expect(page.locator("[data-mode=trade]").first()).toBeVisible();
    });
  }

  test("keyboard submission handles wrong password, clears secrets and focuses the error", async ({ page }) => {
    await page.goto(url());
    const form = page.getByRole("form", { name: "Change password" });
    await form.getByLabel("Current password", { exact: true }).fill("wrong password");
    await form.getByLabel("New password", { exact: true }).fill("a new secure password");
    await form.getByLabel("Confirm new password", { exact: true }).fill("a new secure password");
    await form.getByLabel("Confirm new password", { exact: true }).press("Enter");
    await expect(form.getByRole("alert")).toContainText("That’s not your current password");
    await expect(form.getByLabel("Current password", { exact: true })).toHaveValue("");
    await expect(form.getByLabel("New password", { exact: true })).toHaveValue("");
    await expect(form.getByLabel("Current password", { exact: true })).toBeFocused();
    await expect(form.locator("[data-variant=box]").first()).toHaveCSS("outline-style", "solid");
    await expectNoA11yViolations(page);
  });

  test("checks matching passwords on blur and succeeds after a correction", async ({ page }) => {
    await page.goto(url());
    const form = page.getByRole("form", { name: "Change password" });
    await form.getByLabel("Current password", { exact: true }).fill("demo-current-password");
    await form.getByLabel("New password", { exact: true }).fill("a new secure password");
    await form.getByLabel("Confirm new password", { exact: true }).fill("mismatch");
    await form.getByLabel("Confirm new password", { exact: true }).press("Tab");
    await expect(form.getByText("Passwords don’t match.")).toBeVisible();
    await form.getByLabel("Confirm new password", { exact: true }).fill("a new secure password");
    await form.getByRole("button", { name: "Change password", exact: true }).click();
    await expect(form.getByRole("status").filter({ hasText: "Password changed" })).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("email confirmation keeps the current address and tells the person what comes next", async ({ page }) => {
    await page.goto(url());
    const form = page.getByRole("form", { name: "Change email" });
    await form.getByLabel("Current password", { exact: true }).fill("demo-current-password");
    await form.getByLabel("New email").fill("new@example.test");
    await form.getByRole("button", { name: "Change email", exact: true }).click();
    await expect(form.getByRole("status").filter({ hasText: "Check new@example.test" })).toBeVisible();
    await expect(page.getByText("Current email: sarah@example.test")).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("other-device logout has a success state and keeps this page open", async ({ page }) => {
    await page.goto(url());
    const form = page.getByRole("form", { name: "Log out other devices" });
    await form.getByLabel("Current password", { exact: true }).fill("demo-current-password");
    await form.getByRole("button", { name: "Log out other devices" }).click();
    await expect(form.getByRole("status").filter({ hasText: "You’re still logged in here" })).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("pending submission prevents duplicate edits and announces progress", async ({ page }) => {
    await page.goto(url("?state=saving"));
    const form = page.getByRole("form", { name: "Log out other devices" });
    await form.getByLabel("Current password", { exact: true }).fill("demo-current-password");
    await form.getByRole("button", { name: "Log out other devices" }).click();
    await expect(form.getByRole("status").filter({ hasText: "Logging out" })).toContainText("Logging out other devices…");
    await expect(form.getByLabel("Current password", { exact: true })).toBeDisabled();
    await expectNoA11yViolations(page);
    await expect(form.getByRole("status").filter({ hasText: "You’re still logged in" })).toBeVisible();
  });

  test("offline disables writes, keeps typed values, and recovers online", async ({ page, context }) => {
    await page.goto(url());
    const email = page.getByLabel("New email");
    await email.fill("new@example.test");
    await context.setOffline(true);
    await expect(page.getByText("You’re offline. Reconnect before saving.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Change email", exact: true })).toHaveAttribute("aria-disabled", "true");
    await expectNoA11yViolations(page);
    await context.setOffline(false);
    await expect(page.getByText("You’re offline. Reconnect before saving.")).toHaveCount(0);
    await expect(email).toHaveValue("new@example.test");
  });

  test("show/hide controls work and pointer clicks leave no focus ring", async ({ page }) => {
    await page.goto(url());
    const form = page.getByRole("form", { name: "Change password" });
    const password = form.getByLabel("Current password", { exact: true });
    await password.click();
    await expect(form.locator("[data-variant=box]").first()).toHaveCSS("outline-style", "none");
    await form.getByRole("button", { name: "Show current password" }).click();
    await expect(password).toHaveAttribute("type", "text");
    await form.getByRole("button", { name: "Hide current password" }).click();
    await expect(password).toHaveAttribute("type", "password");
  });
});
