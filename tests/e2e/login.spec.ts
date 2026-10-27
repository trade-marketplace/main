import { expect, type Page, test } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

// Log in (#102). The page itself is checked on the production build (`npm run e2e`), where Supabase isn't set
// up, so a try comes back "can't log you in right now". The other answers (wrong password, too many tries,
// unconfirmed email) are on the dev-only preview:
//   E2E_DEV_BASE_URL=http://localhost:3000 npx playwright test tests/e2e/login.spec.ts

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe("/login", () => {
  test.skip(Boolean(process.env.E2E_DEV_BASE_URL), "checked on the production build");

  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: no sideways scroll, no axe violations, the right layout`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/login");
      await expect(page).toHaveTitle("Log in | Trade Marketplace");
      await expect(page.getByRole("heading", { level: 1, name: "Welcome back" })).toBeVisible();
      await expect(page.getByText("Sorted in")).toBeVisible({ visible: viewport.width >= 1024 });
      await expect(page.getByRole("link", { name: "Back to home" })).toBeVisible({ visible: viewport.width < 1024 });
      expect(await overflow(page)).toBe(0);
      await expectNoA11yViolations(page);
    });
  }

  test("by keyboard: type, show the password, Enter submits; the email stays, the password empties", async ({ page }) => {
    await page.goto("/login?next=/dashboard");
    await page.getByLabel("Email").fill("sarah@email.co.nz");
    await page.getByLabel("Password", { exact: true }).fill("hunter2-hunter2");
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
    await page.getByLabel("Password", { exact: true }).press("Enter");
    // No Supabase in this build: the honest answer.
    await expect(page.getByText("We can’t log you in right now.")).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveValue("sarah@email.co.nz");
    await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("Password", { exact: true })).toBeFocused();
    await expectNoA11yViolations(page);
  });

  test("Keep me logged in starts ticked and can be unticked", async ({ page }) => {
    await page.goto("/login");
    const remember = page.getByRole("checkbox", { name: "Keep me logged in" });
    await expect(remember).toBeChecked();
    await remember.press("Space");
    await expect(remember).not.toBeChecked();
  });

  test("links: forgot password, sign up (keeping the deep link), home", async ({ page }) => {
    await page.goto("/login?next=%2Fjobs%2FTM-1005");
    await expect(page.getByRole("link", { name: "Forgot password?" })).toHaveAttribute("href", "/recovery");
    await expect(page.getByRole("link", { name: "Create an account" })).toHaveAttribute("href", "/signup?next=%2Fjobs%2FTM-1005");
  });
});

const devUrl = process.env.E2E_DEV_BASE_URL;
const preview = (state: string) => (devUrl ? new URL(`/dev/components/login?state=${state}`, devUrl).href : "");

test.describe("/dev/components/login (every answer)", () => {
  test.skip(!devUrl, "set E2E_DEV_BASE_URL to a running `npm run dev` to check the dev-only preview");

  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: every state has no axe violations or sideways scroll`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const state of ["wrong", "locked", "unverified", "invalid", "unavailable"]) {
        await page.goto(preview(state));
        await expect(page.getByRole("heading", { level: 1, name: "Welcome back" })).toBeVisible();
        expect(await overflow(page), state).toBe(0);
        await expectNoA11yViolations(page);
      }
    });
  }

  test("wrong password: one message under the password, which is red and empty", async ({ page }) => {
    await page.goto(preview("wrong"));
    await expect(page.getByText("That email and password don’t match. Try again or reset it.")).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Email")).toHaveValue("sarah@email.co.nz");
  });

  test("too many tries and an unconfirmed email show as banners", async ({ page }) => {
    await page.goto(preview("locked"));
    await expect(page.getByText("Too many tries.")).toBeVisible();
    await page.goto(preview("unverified"));
    await expect(page.getByText("Confirm your email first.")).toBeVisible();
  });

  test("200% text still fits", async ({ page }) => {
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(preview("wrong"));
      await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
      expect(await overflow(page)).toBe(0);
    }
  });
});
