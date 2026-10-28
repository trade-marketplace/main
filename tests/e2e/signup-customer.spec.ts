import { expect, type Page, test } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const previewBase = process.env.E2E_DEV_BASE_URL;
const preview = (state: string) => new URL(`/dev/components/signup-customer?state=${state}`, previewBase).href;

test.describe("customer sign-up details", () => {
  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: fields, responsive layout and accessibility`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/signup/customer");
      await expect(page).toHaveTitle("Create account | Trade Marketplace");
      await expect(page.getByLabel("Full name", { exact: false })).toBeVisible();
      await expect(page.getByLabel("Mobile", { exact: false })).toBeVisible();
      await expect(page.getByRole("radio", { name: /I need a job done/ })).toBeVisible({ visible: viewport.width >= 1024 });
      await expect(page.getByRole("button", { name: "Create account", exact: true })).toHaveAttribute("aria-disabled", "true");
      expect(await overflow(page)).toBe(0);
      await expectNoA11yViolations(page);
    });
  }

  test("keyboard consent, password strength and failed submission keep the details and wizard draft", async ({ page }) => {
    await page.goto("/signup/customer?next=%2Fjobs%2Fnew%3Fstep%3Dreview");
    await page.evaluate(() => sessionStorage.setItem("wizard-draft", JSON.stringify({ description: "Fix my tap", photos: ["local-photo"] })));
    await page.getByLabel("Full name", { exact: false }).fill("Sarah Thompson");
    await page.getByLabel("Email", { exact: false }).fill("sarah@example.test");
    await page.getByLabel("Mobile", { exact: false }).fill("021 555 0192");
    await page.getByLabel("Password", { exact: true }).fill("korimako-gumboot-41");
    await expect(page.getByRole("meter", { name: "Password strength" })).toHaveAttribute("aria-valuenow", "3");
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(page.locator('input[name="password"]')).toHaveAttribute("type", "text");
    const terms = page.getByRole("checkbox", { name: /I agree/ });
    await terms.focus();
    await terms.press("Space");
    await expect(terms).toBeChecked();
    await page.getByRole("button", { name: "Create account", exact: true }).press("Enter");
    await expect(page.getByText("Sign-up unavailable. Try again.")).toBeVisible();
    await expect(page.getByLabel("Full name", { exact: false })).toHaveValue("Sarah Thompson");
    await expect(page.getByLabel("Mobile", { exact: false })).toHaveValue("021 555 0192");
    await expect(page.getByLabel("Email", { exact: false })).toHaveValue("sarah@example.test");
    await expect(page.locator('input[name="password"]')).toHaveValue("");
    await expect(page.locator('input[name="password"]')).toBeFocused();
    await expect(terms).toBeChecked();
    expect(await page.evaluate(() => sessionStorage.getItem("wizard-draft"))).toContain("Fix my tap");
    await expect(page.locator('input[name="next"]')).toHaveValue("/jobs/new?step=review");
    await expectNoA11yViolations(page);
  });

  test("offline keeps the fields, disables creation and re-enables on reconnect", async ({ page, context }) => {
    await page.goto("/signup/customer");
    await page.getByLabel("Full name", { exact: false }).fill("Aroha");
    await page.getByRole("checkbox", { name: /I agree/ }).check();
    await context.setOffline(true);
    await expect(page.getByText("Offline.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create account", exact: true })).toHaveAttribute("aria-disabled", "true");
    await context.setOffline(false);
    await expect(page.getByText("Offline.")).toBeHidden();
    await expect(page.getByLabel("Full name", { exact: false })).toHaveValue("Aroha");
    await expect(page.getByRole("button", { name: "Create account", exact: true })).not.toHaveAttribute("aria-disabled");
  });
});

test.describe("customer sign-up preview states", () => {
  test.skip(!previewBase, "set E2E_DEV_BASE_URL to the preview-enabled app");
  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: every state fits and passes axe`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize(viewport);
      for (const state of ["email-taken", "weak-password", "invalid", "unavailable", "try-later", "loading", "offline", "success", "draft"]) {
        await page.goto(preview(state));
        expect(await overflow(page), state).toBe(0);
        await expectNoA11yViolations(page);
      }
    });
  }

  test("email taken keeps name/mobile and offers both recovery routes", async ({ page }) => {
    await page.goto(preview("email-taken"));
    await expect(page.getByLabel("Full name", { exact: false })).toHaveValue("Sarah Thompson");
    await expect(page.getByLabel("Mobile", { exact: false })).toHaveValue("021 555 0192");
    await expect(page.getByRole("link", { name: "Log in instead" })).toHaveAttribute("href", "/login");
    await expect(page.getByRole("link", { name: "Reset password" })).toHaveAttribute("href", "/recovery");
    await expect(page.getByLabel("Email", { exact: false })).toHaveAttribute("aria-invalid", "true");
  });

  test("200% text still fits phone and desktop", async ({ page }) => {
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(preview("email-taken"));
      await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
      expect(await overflow(page)).toBe(0);
    }
  });
});
