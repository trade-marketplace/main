import { expect, test, type Page } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const previewBase = process.env.E2E_DEV_BASE_URL;
const preview = (state: string) => new URL(`/dev/components/recovery?state=${state}`, previewBase).href;
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const password = "korimako-gumboot-41";

test.use({ reducedMotion: "reduce" });

test.describe("password recovery public journey", () => {
  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: Forgot password and Back preserve the original destination`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/login?next=%2Fjobs%2Fnew%3Fstep%3Dreview");
      await page.getByRole("link", { name: "Forgot password?" }).press("Enter");
      await expect(page).toHaveURL(/\/recovery\?next=%2Fjobs%2Fnew%3Fstep%3Dreview/);
      await expect(page.getByRole("heading", { name: "Forgot your password?" })).toBeVisible();
      await page.keyboard.press("Tab");
      const email = page.getByRole("textbox", { name: "Email" });
      await expect(email).toBeFocused();
      await expect(email.locator("..")).toHaveCSS("outline-style", "solid");
      await email.fill("sarah@example.test");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Enter");
      await expect(page.getByRole("main").getByRole("alert")).toContainText("Couldn’t send the link. Try again.");
      await expect(email).toHaveValue("sarah@example.test");
      expect(await overflow(page)).toBe(0);
      await expectNoA11yViolations(page);
      await page.getByRole("link", { name: "Back to log in" }).click();
      await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
      await expect(page.locator('input[name="next"]')).toHaveValue("/jobs/new?step=review");
      await page.getByRole("link", { name: "Sign up" }).click();
      await expect(page.getByRole("heading", { name: "Create account", exact: true })).toBeVisible();
      await expect(page).toHaveURL(/\/signup\?next=%2Fjobs%2Fnew%3Fstep%3Dreview/);
    });
  }

  test("query flags and invalid callbacks cannot open a password form or grant a login", async ({ page, context }) => {
    await page.goto("/recovery?state=reset&next=https://evil.example");
    await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0);
    await expect(page.getByText("That link isn’t valid.", { exact: true })).toBeVisible();
    await page.goto("/recovery/confirm?type=email&token_hash=not-proof&next=https://evil.example");
    await expect(page).toHaveURL(/\/recovery\?state=(invalid|unavailable)/);
    expect((await context.cookies()).some((cookie) => cookie.name.startsWith("sb-") || cookie.name === "tm-recovery-auth")).toBe(false);
    await page.getByRole("link", { name: "Back to log in" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("offline preserves the entered email and reconnect enables a request", async ({ page, context }) => {
    await page.goto("/recovery");
    await page.getByRole("textbox", { name: "Email" }).fill("sarah@example.test");
    await context.setOffline(true);
    await expect(page.getByRole("button", { name: "Send reset link" })).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByText("Offline.", { exact: true })).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByRole("button", { name: "Send reset link" })).not.toHaveAttribute("aria-disabled");
    await expect(page.getByRole("textbox", { name: "Email" })).toHaveValue("sarah@example.test");
  });
});

test.describe("recovery states and form interactions", () => {
  test.skip(!previewBase, "set E2E_DEV_BASE_URL to the preview-enabled app");
  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: all states fit and pass axe`, async ({ page }) => {
      test.setTimeout(150_000);
      await page.setViewportSize(viewport);
      for (const state of ["request", "sent", "cooldown", "reset", "mismatch", "complete", "expired", "invalid", "unavailable", "finish", "loading", "reset-loading", "offline", "reset-offline", "send-error", "save-error"]) {
        await page.goto(preview(state));
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        expect(await overflow(page), state).toBe(0);
        await expectNoA11yViolations(page);
      }
    });
  }

  test("request, sent, cooldown and Change it work without revealing an account", async ({ page }) => {
    await page.clock.install();
    await page.goto(preview("request"));
    await page.getByRole("textbox", { name: "Email" }).fill(" SARAH@example.test ");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeFocused();
    await expect(page.getByText(/If an account uses/)).toContainText("sarah@example.test");
    await expect(page.getByRole("status").filter({ hasText: "Check your email for a reset link." })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Resend in 1:00" })).toHaveAttribute("aria-disabled", "true");
    await page.clock.fastForward(61_000);
    await page.getByRole("button", { name: "Resend link" }).click();
    await expect(page.getByRole("button", { name: "Resend in 1:00" })).toHaveAttribute("aria-disabled", "true");
    await page.getByRole("button", { name: "Change it" }).click();
    await expect(page.getByRole("textbox", { name: "Email" })).toHaveValue("sarah@example.test");
    await expect(page.getByRole("button", { name: "Send reset link" })).not.toHaveAttribute("aria-disabled");
  });

  test("expired and invalid links have a one-click resend fix", async ({ page }) => {
    for (const state of ["expired", "invalid"]) {
      await page.goto(preview(state));
      await page.getByRole("button", { name: "Send a new link" }).press("Enter");
      await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeFocused();
      await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Resend in 1:00" })).toHaveAttribute("aria-disabled", "true");
    }
  });

  test("passwords match on blur, show/hide stays keyboard accessible, then save and login retain next", async ({ page }) => {
    await page.goto(preview("reset"));
    const newPassword = page.getByLabel("New password", { exact: true });
    const confirmation = page.getByLabel("Type it again", { exact: true });
    await page.keyboard.press("Tab");
    await expect(newPassword).toBeFocused();
    await newPassword.fill(password);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Show new password" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(newPassword).toHaveAttribute("type", "text");
    await page.keyboard.press("Enter");
    await expect(newPassword).toHaveAttribute("type", "password");
    await confirmation.fill("different-password-42");
    await confirmation.press("Tab");
    await expect(page.getByText("These don’t match.")).toBeVisible();
    await expect(confirmation).toHaveAttribute("aria-invalid", "true");
    await confirmation.fill(password);
    await confirmation.press("Tab");
    await expect(confirmation).toHaveAccessibleDescription("Passwords match.");
    await page.getByRole("button", { name: "Save new password" }).press("Enter");
    await expect(page.getByRole("heading", { name: "Password changed" })).toBeFocused();
    await expect(newPassword).toHaveCount(0);
    await expectNoA11yViolations(page);
    await page.getByRole("link", { name: "Log in", exact: true }).press("Enter");
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await expect(page.locator('input[name="next"]')).toHaveValue("/jobs/new?step=review");
    await page.getByRole("link", { name: "Forgot password?" }).click();
    await expect(page.getByRole("heading", { name: "Forgot your password?" })).toBeVisible();
    await expect(page).toHaveURL(/\/recovery\?next=%2Fjobs%2Fnew%3Fstep%3Dreview/);
  });

  test("invalid email and weak passwords put focus on the field that needs fixing", async ({ page }) => {
    await page.goto(preview("request"));
    await page.getByRole("textbox", { name: "Email" }).fill("not-email");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("textbox", { name: "Email" })).toBeFocused();
    await expect(page.getByText("Enter a valid email.")).toBeVisible();
    await page.goto(preview("reset"));
    await page.getByLabel("New password", { exact: true }).fill("short");
    await page.getByLabel("Type it again", { exact: true }).fill("short");
    await page.getByRole("button", { name: "Save new password" }).click();
    await expect(page.getByLabel("New password", { exact: true })).toBeFocused();
    await expect(page.getByLabel("New password", { exact: true })).toHaveAccessibleDescription("Use 10+ characters.");
    await expectNoA11yViolations(page);
  });

  test("delivery and save errors preserve inputs; revocation retry never asks for a password again", async ({ page }) => {
    await page.goto(preview("send-error"));
    await page.getByRole("textbox", { name: "Email" }).fill("sarah@example.test");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Couldn’t send the link. Try again.");
    await expect(page.getByRole("textbox", { name: "Email" })).toHaveValue("sarah@example.test");
    await page.goto(preview("save-error"));
    await page.getByLabel("New password", { exact: true }).fill(password);
    await page.getByLabel("Type it again", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Save new password" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Couldn’t save your password. Try again.");
    await expect(page.getByLabel("New password", { exact: true })).toHaveValue(password);
    await page.goto(preview("finish"));
    await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Finish reset" }).click();
    await expect(page.getByRole("heading", { name: "Password changed" })).toBeVisible();
  });

  test("the screenshot gallery includes each transient state without overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(preview("feedback"));
    await expect(page.getByRole("heading", { name: "Recovery feedback states", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: /^Recovery preview:/ })).toHaveCount(6);
    expect(await overflow(page)).toBe(0);
    await expectNoA11yViolations(page);
  });
});
