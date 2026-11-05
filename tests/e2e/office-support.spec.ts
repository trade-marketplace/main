import { expect, test } from "@playwright/test";
import { OFFICE_SUPPORT_STATES } from "../../src/app/dev/components/office-support/preview-data";
import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const app = process.env.E2E_DEV_BASE_URL;
test("office support previews stay guarded in a normal production build", async ({ page }) => {
  test.skip(Boolean(app), "preview run");
  expect((await page.goto("/dev/components/office-support"))?.status()).toBe(404);
});
test.describe("office support states", () => {
  test.skip(!app, "Set E2E_DEV_BASE_URL to explicitly enable guarded previews");
  test.use({ reducedMotion: "reduce" });
  for (const viewport of VIEWPORTS) test(`${viewport.width}px: every inbox and reply state fits and passes axe`, async ({ page }) => {
    test.setTimeout(240_000); await page.setViewportSize(viewport);
    for (const state of OFFICE_SUPPORT_STATES) {
      await page.goto(new URL(`/dev/components/office-support?state=${state}`, app!).href);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), state).toBe(0);
      await expectNoA11yViolations(page);
      if (state === "empty") await expect(page.getByRole("heading", { name: "No open threads." })).toBeVisible();
      if (state === "closed") await expect(page.getByText("This thread is closed.", { exact: true })).toBeVisible();
      if (state === "reply-error") await expect(page.getByText("Your message wasn’t sent. Try again.")).toBeVisible();
      if (state === "history") await expect(page.getByText("Photo unavailable", { exact: true })).toBeVisible();
    }
  });
});
