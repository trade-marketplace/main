import { expect, test } from "@playwright/test";
import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";
const dev = process.env.E2E_DEV_BASE_URL;
const url = (state = "form") => new URL(`/dev/components/customer-problem?state=${state}`, dev).href;
test("report form requires login", async ({ page }) => {
  await page.goto("/jobs/18200000-0000-4000-8000-000000000001/problem");
  await expect(page).toHaveURL(/\/login\?next=%2Fjobs%2F18200000-0000-4000-8000-000000000001%2Fproblem$/);
});
test("report fixtures are guarded in production", async ({ page }) => {
  test.skip(Boolean(dev), "using guarded local fixtures");
  expect((await page.goto("/dev/components/customer-problem"))?.status()).toBe(404);
});
test.describe("customer report form", () => {
  test.skip(!dev, "set E2E_DEV_BASE_URL for local fixtures");
  test.use({ reducedMotion: "reduce" });
  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: all report states fit and pass axe`, async ({ page }) => {
      test.setTimeout(240000); await page.setViewportSize(viewport);
      for (const state of ["form", "loading", "empty", "error", "offline", "uploading", "saving", "sent", "urgent", "photos", "load-error", "completed-sent"]) {
        await page.goto(url(state));
        await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), state).toBe(false);
        await expectNoA11yViolations(page);
      }
    });
  }
  test("keyboard form validates, flags safety and follows Sent → job → report → Back", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto(url());
    await page.getByRole("button", { name: "Send report", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(page.getByLabel("Topic", { exact: true })).toBeFocused();
    await page.keyboard.type("Loose switch"); await page.keyboard.press("Tab"); await page.keyboard.type("There are exposed wires beside the switch.");
    await page.getByRole("checkbox", { name: "Urgent / safety" }).focus(); await page.keyboard.press("Space");
    await expect(page.getByText("Call 111 if dangerous.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Send report", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Sent.", exact: true })).toBeVisible();
    await expect(page.getByText("Auto-release is paused while your report is open.", { exact: true })).toBeVisible();
    await expect(page.getByText("Your report is flagged as urgent for the office.")).toBeVisible();
    await page.getByRole("link", { name: "Back to job", exact: true }).click(); await expect(page).toHaveURL(/customer-job\?state=submitted$/);
    await page.getByRole("link", { name: "Report a problem", exact: true }).click(); await expect(page).toHaveURL(/customer-problem\?state=form$/);
    await page.getByRole("link", { name: "Back", exact: true }).click(); await expect(page).toHaveURL(/customer-job\?state=submitted$/);
  });
  test("failed send and failed upload retain input; removing failed photo enables retry", async ({ page }) => {
    await page.goto(url("error"));
    await page.getByRole("button", { name: "Send report", exact: true }).click();
    await expect(page.getByLabel("Details", { exact: true })).toHaveValue(/light switch/);
    await expect(page.getByRole("alert").filter({ hasText: "Couldn’t send. Try again." })).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles({ name: "fail.png", mimeType: "image/png", buffer: Buffer.from("fixture") });
    await expect(page.getByText("Photo not uploaded", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send report", exact: true })).toHaveAttribute("aria-disabled", "true");
    await page.getByRole("button", { name: "Remove photo 1", exact: true }).click();
    await expect(page.getByRole("button", { name: "Send report", exact: true })).not.toHaveAttribute("aria-disabled");
  });
  test("offline keeps the draft and blocks sending; completed Sent makes no pause promise", async ({ page, context }) => {
    await page.goto(url()); await page.getByLabel("Topic", { exact: true }).fill("Unsaved report");
    await context.setOffline(true);
    await expect(page.getByRole("button", { name: "Send report", exact: true })).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByLabel("Topic", { exact: true })).toHaveValue("Unsaved report");
    await context.setOffline(false);
    await expect(page.getByRole("button", { name: "Send report", exact: true })).not.toHaveAttribute("aria-disabled");
    await page.goto(url("completed-sent")); await expect(page.getByRole("heading", { name: "Sent.", exact: true })).toBeVisible();
    await expect(page.getByText(/Auto-release is paused/)).toHaveCount(0);
  });
  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px selected office report states fit and pass axe`, async ({ page }) => {
      test.setTimeout(180000); await page.setViewportSize(viewport);
      for (const problem of ["ready", "loading", "error", "offline", "photo-error", "empty", "resolved"]) {
        await page.goto(new URL(`/dev/components/office-job?problem=${problem}`, dev).href);
        await expect(page.getByRole("region", { name: "Problem report", exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), problem).toBe(false);
        await expectNoA11yViolations(page);
      }
    });
  }
});
