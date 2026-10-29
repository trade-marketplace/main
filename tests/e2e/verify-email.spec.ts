import { expect, test, type Page } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const previewBase = process.env.E2E_DEV_BASE_URL;
const preview = (state: string) => new URL(`/dev/components/verify-email?state=${state}`, previewBase).href;
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe("verify email public page", () => {
  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: signed-out form, keyboard and accessibility`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/verify?next=%2Fjobs%2Fnew%3Fstep%3Dreview");
      await expect(page.getByRole("heading", { name: "Verify your email" })).toBeVisible();
      const email = page.getByRole("textbox", { name: "Email" });
      await page.keyboard.press("Tab");
      await expect(email).toBeFocused();
      await expect(email.locator("..")).toHaveCSS("outline-style", "solid");
      await email.fill("sarah@example.test");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Enter");
      await expect(page.getByRole("main").getByRole("alert")).toContainText("Couldn’t send the link. Try again.");
      await expect(page).toHaveTitle("Verify email | Trade Marketplace");
      await expect(email).toHaveValue("sarah@example.test");
      expect(await overflow(page)).toBe(0);
      await expectNoA11yViolations(page);
    });
  }

  test("offline preserves the email and reconnecting enables resend", async ({ page, context }) => {
    await page.goto("/verify");
    await page.getByRole("textbox", { name: "Email" }).fill("sarah@example.test");
    await context.setOffline(true);
    await expect(page.getByRole("button", { name: "Send a link" })).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByText("Offline.", { exact: true })).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByRole("button", { name: "Send a link" })).not.toHaveAttribute("aria-disabled");
    await expect(page.getByRole("textbox", { name: "Email" })).toHaveValue("sarah@example.test");
  });

  test("public flags cannot fake verification and Continue preserves the login destination", async ({ page }) => {
    await page.goto("/verify?state=verified&next=%2Fjobs%2Fnew%3Fstep%3Dreview");
    await expect(page.getByRole("heading", { name: "You’re all set" })).toHaveCount(0);
    await page.getByRole("link", { name: "Continue to log in" }).click();
    await expect(page).toHaveURL(/\/login\?next=%2Fjobs%2Fnew%3Fstep%3Dreview/);
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await expect(page.locator('input[name="next"]')).toHaveValue("/jobs/new?step=review");
  });

  test("a completion in another tab moves the holding page to password login after five seconds", async ({ page, context }) => {
    await context.addCookies([{ name: "tm-verification-pending", value: JSON.stringify({ email: "sarah@example.test", retryAt: Date.now() + 60_000 }), domain: "127.0.0.1", path: "/verify", httpOnly: true, sameSite: "Lax" }]);
    await page.clock.install();
    await page.goto("/verify?next=%2Fjobs%2Fnew%3Fstep%3Dreview");
    await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
    const otherTab = await context.newPage();
    await otherTab.goto("/verify");
    await context.addCookies([{ name: "tm-verification-complete", value: "1", domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" }]);
    await otherTab.close();
    await page.clock.fastForward(5_000);
    await expect(page).toHaveURL(/\/login\?next=%2Fjobs%2Fnew%3Fstep%3Dreview/);
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await expect(page.locator('input[name="next"]')).toHaveValue("/jobs/new?step=review");
  });
});

test.describe("verify email preview states", () => {
  test.skip(!previewBase, "set E2E_DEV_BASE_URL to the preview-enabled app");
  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: every state fits and passes axe`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize(viewport);
      for (const state of ["ready", "waiting", "cooldown", "expired", "invalid", "verified", "unavailable", "loading", "offline", "send-error", "signed-in"]) {
        await page.goto(preview(state));
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        expect(await overflow(page), state).toBe(0);
        await expectNoA11yViolations(page);
      }
    });
  }

  test("expired and invalid links can resend, announce success, and start the cooldown", async ({ page }) => {
    await page.clock.install();
    for (const state of ["expired", "invalid"]) {
      await page.goto(preview(state));
      const button = page.getByRole("button", { name: "Resend email" });
      await button.focus();
      await button.press("Enter");
      await expect(page.getByRole("status").filter({ hasText: "Check your email for a link." })).toHaveCount(1);
      await expect(page.getByRole("button", { name: "Resend in 1:00" })).toHaveAttribute("aria-disabled", "true");
      await expect(page.getByText(/That link/)).toHaveCount(0);
      await page.clock.fastForward(61_000);
      await expect(page.getByRole("button", { name: "Resend email" })).not.toHaveAttribute("aria-disabled");
      await expectNoA11yViolations(page);
    }
  });

  test("already verified continues through the real login page with the original destination", async ({ page }) => {
    await page.goto(preview("verified"));
    await expect(page.getByRole("heading", { name: "You’re all set" })).toBeVisible();
    await page.getByRole("link", { name: "Continue", exact: true }).press("Enter");
    await expect(page).toHaveURL(/\/login\?next=%2Fjobs%2Fnew%3Fstep%3Dreview/);
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await expect(page.locator('input[name="next"]')).toHaveValue("/jobs/new?step=review");
  });

  test("wrong email can be corrected without losing it after a failed send", async ({ page }) => {
    await page.goto(preview("send-error"));
    await page.getByRole("button", { name: "Change it" }).click();
    await page.getByRole("textbox", { name: "Email" }).fill("corrected@example.test");
    await page.getByRole("button", { name: "Send a link" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Couldn’t send the link. Try again.");
    await expect(page.getByRole("textbox", { name: "Email" })).toHaveValue("corrected@example.test");
  });

  test("poll errors keep resend available", async ({ page }) => {
    await page.clock.install();
    await page.goto(preview("poll-error"));
    await page.clock.fastForward(5_000);
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Can’t check your email yet. We’ll try again.");
    await expect(page.getByRole("button", { name: "Resend email" })).not.toHaveAttribute("aria-disabled");
  });
});
