import { expect, test } from "@playwright/test";
import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const dev = process.env.OFFICE_TRADIES_PREVIEW_E2E_URL ?? process.env.POSTED_PREVIEW_E2E_URL;
test("office tradies is private and its fixture is guarded in production", async ({ page }) => {
  await page.goto("/admin/tradies"); await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Ftradies$/);
  expect((await page.goto("/dev/components/office-tradies"))?.status()).toBe(404);
});
test.describe("office tradie checks", () => {
  test.skip(!dev, "Needs guarded preview app"); test.use({ reducedMotion: "reduce" });
  for (const viewport of VIEWPORTS) test(`${viewport.width}px: every state fits and passes axe`, async ({ page }) => {
    test.setTimeout(240_000); await page.setViewportSize(viewport);
    for (const state of ["default", "verified", "paused", "loading", "empty", "error", "offline", "reject", "pause", "unpause", "save-error"]) {
      await page.goto(`${dev}/dev/components/office-tradies?state=${state}`);
      await expect(page.getByRole("heading", { name: "Tradies", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), state).toBe(false); await expectNoA11yViolations(page);
      if (state === "paused") await expect(page.getByRole("button", { name: "Unpause", exact: true })).toBeVisible();
    }
  });
  test("saved toast fits every viewport and passes axe", async ({ page }) => {
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport); await page.goto(`${dev}/dev/components/office-tradies?state=success`);
      await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false); await expectNoA11yViolations(page);
    }
  });
  test("keyboard review, external register, approval, rejection and Back preserve the table context", async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto(`${dev}/dev/components/office-tradies?selected=none`);
    const review = page.getByRole("link", { name: "Review Jack Wilson, Gas fitting", exact: true }); await review.focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Jack Wilson", exact: true })).toBeVisible();
    await context.route("https://www.pgdb.co.nz/advice_for_consumers/search_the_register/", route => route.fulfill({ contentType: "text/html", body: "<title>Official register fixture</title><h1>Register</h1>" }));
    const popup = page.waitForEvent("popup"); await page.getByRole("link", { name: "Check on the PGDB register", exact: true }).click(); const register = await popup; await register.waitForLoadState(); expect(register.url()).toBe("https://www.pgdb.co.nz/advice_for_consumers/search_the_register/"); expect(await register.evaluate(() => window.opener)).toBeNull(); await register.close();
    await page.getByLabel("Note (saved with the decision)", { exact: true }).fill("Checked the current register"); await page.getByRole("button", { name: "Approve", exact: true }).click();
    const dialog = page.getByRole("alertdialog"); await expect(dialog).toHaveAccessibleName("Approve licence?"); await dialog.getByRole("button", { name: "Approve", exact: true }).click(); await expect(page.getByText("Saved.", { exact: true })).toBeVisible(); await expect(page.getByRole("region", { name: "Audit timeline", exact: true })).toContainText("Checked the current register");
    await page.getByRole("link", { name: "Back", exact: true }).click(); await expect(page).toHaveURL(/selected=none/);
    await page.getByRole("link", { name: "Review Aroha King, Plumbing", exact: true }).click(); await page.getByLabel("Note (saved with the decision)", { exact: true }).fill("Register check could not confirm this card"); await page.getByRole("button", { name: "Reject…", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Reject", exact: true })).toBeDisabled(); await page.getByLabel("Reason shown to the tradie", { exact: true }).fill("Please upload the current card."); await dialog.getByRole("button", { name: "Reject", exact: true }).click(); await expect(page.getByRole("complementary", { name: "Tradie details", exact: true })).toContainText("Please upload the current card.");
  });
});
