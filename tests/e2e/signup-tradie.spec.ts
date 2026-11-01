import { expect, type Page, test } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

// Match the screenshot workflow and inspect settled colours instead of a frame in the 200 ms page fade.
test.use({ reducedMotion: "reduce" });

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const devBase = process.env.E2E_DEV_BASE_URL;
const preview = (state: string) => new URL(`/dev/components/signup-tradie?state=${state}`, devBase).href;

async function accountStep(page: Page) {
  await page.goto("/signup/tradie?next=%2Fjobs%3Fview%3Dmap");
  await page.getByLabel("Full name", { exact: false }).fill("Jack Wilson");
  await page.getByLabel("Email", { exact: false }).fill("jack@example.test");
  await page.getByLabel("Mobile", { exact: false }).fill("027 555 0192");
  await page.getByLabel("Password (required)", { exact: true }).fill("korimako-gumboot-41");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Electrical", exact: true })).toBeFocused();
}

test.describe("tradie signup", () => {
  test("normal motion settles to readable colours and keeps inputs available", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/signup/tradie");
    await expect(page.locator('[data-mode="trade"]').first()).toHaveCSS("opacity", "1");
    await page.getByLabel("Full name", { exact: false }).fill("Example Worker");
    await expectNoA11yViolations(page);
  });
  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: both steps fit and have no accessibility violations`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await accountStep(page);
      expect(await overflow(page)).toBe(0);
      await expectNoA11yViolations(page);
      await page.getByRole("button", { name: "Back to your details" }).click();
      await expect(page.getByLabel("Full name", { exact: false })).toHaveValue("Jack Wilson");
      await expect(page.getByLabel("Full name", { exact: false })).toBeFocused();
      expect(await overflow(page)).toBe(0);
      await expectNoA11yViolations(page);
    });
  }

  test("Other needs no licence: manual area works with no token, and an outage keeps all details", async ({ page }) => {
    await accountStep(page);
    const other = page.getByRole("checkbox", { name: "Other / general labour", exact: true });
    await other.press("Space");
    await expect(other).toBeChecked();
    await expect(page.locator('input[name^="licence_"]')).toHaveCount(0);
    await expect(page.getByText("Other / general labour needs no licence.", { exact: false })).toBeVisible();
    await page.getByRole("combobox", { name: "Where do you work?", exact: false }).fill("Invercargill");
    await expect(page.getByText("Suburb search is unavailable. Type your suburb or town by hand.")).toBeVisible();
    await page.getByRole("radio", { name: "50 km", exact: true }).check();
    await page.getByRole("checkbox", { name: /I agree/ }).check();
    await expect(page.getByRole("link", { name: "Worker terms" })).toHaveAttribute("href", "/legal/tradie-terms");
    await page.getByRole("button", { name: "Finish sign-up" }).click();
    await expect(page.getByText("We can’t create your account right now.")).toBeVisible();
    await expect(page.getByLabel("Password (required)", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("Full name", { exact: false })).toHaveValue("Jack Wilson");
    await page.getByLabel("Password (required)", { exact: true }).fill("korimako-gumboot-41");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(other).toBeChecked();
    await expect(page.getByRole("radio", { name: "50 km", exact: true })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: /I agree/ })).toBeChecked();
    await expect(page.getByRole("combobox", { name: "Where do you work?", exact: false })).toHaveValue("Invercargill");
    await expectNoA11yViolations(page);
  });

  test("multiple trades, malformed licence example, and deselecting the last restricted trade", async ({ page }) => {
    await accountStep(page);
    await page.getByRole("checkbox", { name: "Electrical", exact: true }).press("Space");
    await page.getByRole("checkbox", { name: "Gas fitting", exact: true }).check();
    await expect(page.locator('input[name^="licence_"]')).toHaveCount(2);
    await page.getByLabel("EWRB registration number", { exact: false }).fill("wrong-number!");
    await page.getByLabel("Gas fitting licence number", { exact: false }).fill("PGDB 44120");
    await page.getByRole("combobox", { name: "Where do you work?", exact: false }).fill("Invercargill");
    await page.getByRole("checkbox", { name: /I agree/ }).check();
    await page.getByRole("button", { name: "Finish sign-up" }).click();
    await expect(page.getByText("Use a number like E 123456 or EW012345.", { exact: false })).toBeVisible();
    await expect(page.getByLabel("EWRB registration number", { exact: false })).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("EWRB registration number", { exact: false })).toBeFocused();
    await expect(page.getByLabel("Gas fitting licence number", { exact: false })).toHaveValue("PGDB 44120");
    await page.getByRole("checkbox", { name: "Other / general labour", exact: true }).check();
    await page.getByRole("checkbox", { name: "Electrical", exact: true }).uncheck();
    await page.getByRole("checkbox", { name: "Gas fitting", exact: true }).uncheck();
    await expect(page.locator('input[name^="licence_"]')).toHaveCount(0);
  });

  test("offline pauses submission and retains both account and work details", async ({ page, context }) => {
    await accountStep(page);
    await page.getByRole("checkbox", { name: "Other / general labour", exact: true }).check();
    await page.getByRole("checkbox", { name: /I agree/ }).check();
    await context.setOffline(true);
    await expect(page.getByText("You’re offline.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Finish sign-up" })).toHaveAttribute("aria-disabled", "true");
    await context.setOffline(false);
    await expect(page.getByText("You’re offline.")).toBeHidden();
    await expect(page.getByRole("checkbox", { name: "Other / general labour", exact: true })).toBeChecked();
    await expect(page.locator('input[name="next"]')).toHaveValue("/jobs?view=map");
  });
});

test.describe("tradie preview states", () => {
  test.skip(!devBase, "set E2E_DEV_BASE_URL to the preview-enabled app");
  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: every state fits and passes axe`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize(viewport);
      for (const state of ["default", "licence-error", "other", "all-trades", "email-taken", "invalid", "unavailable", "try-later", "loading", "offline", "success"]) {
        await page.goto(preview(state));
        expect(await overflow(page), state).toBe(0);
        await expectNoA11yViolations(page);
      }
    });
  }
  test("suburb suggestions use keyboard selection and clear coordinates after manual edits", async ({ page }) => {
    await page.goto(preview("all-trades"));
    const suburb = page.getByRole("combobox", { name: "Where do you work?", exact: false });
    await suburb.focus();
    await expect(page.getByRole("option", { name: "Windsor, Invercargill" })).toBeVisible();
    await suburb.press("ArrowDown");
    await suburb.press("Enter");
    await expect(suburb).toHaveValue("Windsor, Invercargill");
    await expect(page.locator('input[name="areaLat"]')).toHaveValue("-46.391");
    await suburb.fill("Another suburb");
    await expect(page.locator('input[name="areaLat"]')).toHaveValue("");
  });
  test("200% text still fits phone and desktop", async ({ page }) => {
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(preview("licence-error"));
      await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
      expect(await overflow(page)).toBe(0);
    }
  });
});
