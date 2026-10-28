import { expect, type Page, test } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

// /dev/components/session-expired (#108) is a development-only page. `npm run e2e` runs the production build, where
// it must be a 404. To check the page itself, start `npm run dev` and point these tests at it:
//   E2E_DEV_BASE_URL=http://localhost:3000 npx playwright test tests/e2e/dev-session-expired.spec.ts

test("/dev/components/session-expired is not in production builds", async ({ page }) => {
  test.skip(Boolean(process.env.E2E_DEV_BASE_URL), "checking the dev server instead");
  const response = await page.goto("/dev/components/session-expired");
  expect(response?.status()).toBe(404);
});

const devUrl = process.env.E2E_DEV_BASE_URL;
const url = (query = "") => (devUrl ? new URL(`/dev/components/session-expired${query}`, devUrl).href : "");

const DRAFT = "The kitchen tap drips all night. It's the mixer over the sink.";
const dialog = (page: Page) => page.getByRole("dialog", { name: "You’ve been logged out" });
const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Save the draft: the pretend server has lost the session, so the dialog opens over the page. */
async function saveDraft(page: Page) {
  await page.goto(url());
  await expect(page.getByLabel("Describe the job")).toHaveValue(DRAFT);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(dialog(page)).toBeVisible();
}

test.describe("/dev/components/session-expired", () => {
  test.skip(!devUrl, "set E2E_DEV_BASE_URL to a running `npm run dev` to check the dev-only page");

  for (const viewport of VIEWPORTS) {
    test(`${viewport.name} (${viewport.width}px): no axe violations, no sideways scroll, fits the screen`, async ({ browser }) => {
      test.setTimeout(90_000);
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
      const page = await context.newPage();
      for (const query of ["?open=notice", "?state=wrong", "?state=locked", "?email=off&open=form"]) {
        await page.goto(url(query));
        await expect(dialog(page)).toBeVisible();
        await expect(dialog(page)).toHaveCSS("opacity", "1");
        expect(await sideways(page), query).toBe(0);
        const box = (await dialog(page).boundingBox())!;
        expect(box.x, query).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, query).toBeLessThanOrEqual(viewport.width);
        await expectNoA11yViolations(page);
      }
      await context.close();
    });
  }

  test("the mockup at 1440: icon tile, one-line title, no small print, a full-width button and the ×", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url("?open=notice"));
    const box = dialog(page);
    await expect(box).not.toContainText("security");
    await expect(box).not.toContainText("draft");
    await expect(box.getByRole("button")).toHaveCount(2);
    await expect(box.getByRole("button", { name: "Close" })).toBeVisible();
    const title = box.getByRole("heading", { name: "You’ve been logged out" });
    const lineHeight = await title.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
    expect((await title.boundingBox())!.height).toBeLessThan(lineHeight * 1.5);
    const width = (await box.boundingBox())!.width;
    expect(width).toBeLessThanOrEqual(400);
    const button = (await box.getByRole("button", { name: "Log in" }).boundingBox())!;
    expect(button.width).toBeGreaterThan(width - 2 * 28 - 2);
  });

  test("the × closes it and goes to the home page", async ({ page }) => {
    await saveDraft(page);
    await dialog(page).getByRole("button", { name: "Close" }).click();
    await expect(page).toHaveURL(new URL("/", devUrl).href);
  });

  test("Esc and the scrim don't close it, and Tab stays inside", async ({ page }) => {
    await saveDraft(page);
    await expect(dialog(page).getByRole("heading", { name: "You’ve been logged out" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeVisible();
    await page.mouse.click(5, 300);
    await expect(dialog(page)).toBeVisible();
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest("dialog")))).toBe(true);
    }
  });

  test("logging in again keeps the page and the draft, sends it, and puts focus back", async ({ page }) => {
    await saveDraft(page);
    await dialog(page).getByRole("button", { name: "Log in" }).click();
    // The email is known: only the password is asked for, and focus goes straight to it.
    await expect(dialog(page)).toContainText("sarah@email.co.nz");
    const password = dialog(page).getByLabel(/^Password/);
    await expect(password).toBeFocused();

    await password.fill("wrong");
    await page.keyboard.press("Enter");
    await expect(dialog(page)).toContainText("Incorrect email or password.");
    await expect(password).toHaveAttribute("aria-invalid", "true");
    await expect(password).toBeFocused();
    await expect(password).toHaveValue("");

    await password.fill("correct horse");
    await dialog(page).getByRole("button", { name: "Log in", exact: true }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toHaveText(`Saved: “${DRAFT}”`);
    await expect(page.getByLabel("Describe the job")).toHaveValue(DRAFT);
    await expect(page.getByRole("button", { name: "Save draft" })).toBeFocused();
    await expect(page).toHaveURL(url());
  });

  test("problems that aren't about the password show in a banner that's read out", async ({ page }) => {
    await saveDraft(page);
    await dialog(page).getByRole("button", { name: "Log in" }).click();
    await dialog(page).getByLabel(/^Password/).fill("locked");
    await page.keyboard.press("Enter");
    await expect(dialog(page).getByRole("alert")).toContainText("Try again shortly.");
    await dialog(page).getByLabel(/^Password/).fill("unavailable");
    await page.keyboard.press("Enter");
    await expect(dialog(page).getByRole("alert")).toContainText("Log-in unavailable.");
  });

  test("when the email isn't known it's asked for first", async ({ page }) => {
    await page.goto(url("?email=off&open=notice"));
    await dialog(page).getByRole("button", { name: "Log in" }).click();
    const email = dialog(page).getByRole("textbox", { name: "Email" });
    await expect(email).toBeFocused();
    await expect(dialog(page).getByText("Not you?")).toHaveCount(0);
    await email.fill("sam@example.com");
    await dialog(page).getByLabel(/^Password/).fill("wrong");
    await page.keyboard.press("Enter");
    await expect(dialog(page)).toContainText("Incorrect email or password.");
    await expect(email).toHaveValue("sam@example.com");
  });

  test("Not you? goes to the log-in page", async ({ page }) => {
    await page.goto(url("?open=form"));
    await expect(dialog(page).getByRole("link", { name: "Use another account" })).toHaveAttribute("href", "/login");
  });
});
