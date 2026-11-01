import { expect, test } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const dev = process.env.E2E_DEV_BASE_URL;
const url = (query = "") => new URL(`/dev/components/notifications-page${query ? `?${query}` : ""}`, dev).href;
test("notifications list fixtures are guarded in production", async ({ page }) => {
  test.skip(Boolean(dev), "using local fixtures");
  expect((await page.goto("/dev/components/notifications-page"))?.status()).toBe(404);
});

test.describe("full notifications page", () => {
  test.skip(!dev, "set E2E_DEV_BASE_URL for guarded local fixtures");
  test.use({ reducedMotion: "reduce" });
  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: both modes and every review state fit and pass axe`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize(viewport);
      for (const mode of ["customer", "trade"]) for (const state of ["default", "read", "empty", "loading", "error", "offline", "many", "long"]) {
        await page.goto(url(`mode=${mode}&state=${state}`));
        await expect(page.getByRole("heading", { name: "Notifications", exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `${mode}/${state}`).toBe(0);
        await expectNoA11yViolations(page);
      }
    });
  }
  test("All/Unread uses URL state, keyboard arrows and Back restore the filter", async ({ page }) => {
    await page.goto(url());
    await expect(page.getByRole("tabpanel").getByRole("listitem")).toHaveCount(4);
    await page.getByRole("tab", { name: "All", exact: true }).press("ArrowRight");
    await expect(page).toHaveURL(/filter=unread/);
    await expect(page.getByRole("tab", { name: "Unread", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tab", { name: "Unread", exact: true })).toBeFocused();
    await expect(page.getByRole("tab", { name: "Unread", exact: true })).toHaveCSS("outline-style", "solid");
    await expect(page.getByRole("tabpanel").getByRole("listitem")).toHaveCount(2);
    await page.goBack();
    await expect(page.getByRole("tab", { name: "All", exact: true })).toHaveAttribute("aria-selected", "true");
  });
  test("Next and Previous reach all 31 notifications and keep the selected filter", async ({ page }) => {
    await page.goto(url("state=many"));
    await expect(page.getByRole("tabpanel").getByRole("listitem")).toHaveCount(25);
    await page.getByRole("link", { name: "Next page" }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByRole("tabpanel").getByRole("listitem")).toHaveCount(6);
    await page.getByRole("link", { name: "Previous page" }).press("Enter");
    await expect(page.getByRole("tabpanel").getByRole("listitem")).toHaveCount(25);
  });
  test("Mark all read waits for confirmation and refreshes the bell", async ({ page }) => {
    await page.goto(url("filter=unread"));
    await page.getByRole("button", { name: "Mark all read", exact: true }).click();
    await expect(page.getByRole("button", { name: "Mark all read", exact: true })).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByRole("heading", { name: "No unread notifications" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Notifications", exact: true })).toBeVisible();
  });
  test("empty and read filters have a minimal empty state; retry recovers loading errors", async ({ page }) => {
    await page.goto(url("state=empty"));
    await expect(page.getByRole("heading", { name: "No notifications", exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Unread", exact: true }).click();
    await expect(page.getByRole("heading", { name: "No unread notifications" })).toBeVisible();
    await page.goto(url("state=error"));
    await page.getByRole("button", { name: "Try again" }).press("Enter");
    await expect(page.getByRole("tabpanel").getByRole("listitem")).toHaveCount(4);
  });
  test("a failed read stays here; retry and selecting the row follows its protected destination", async ({ page }) => {
    await page.goto(url("state=read-error"));
    await page.getByRole("button", { name: /Your price is ready/ }).click();
    await expect(page.getByRole("heading", { name: "Notifications unavailable" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/dev/components/notifications-page");
    await page.getByRole("button", { name: "Try again" }).click();
    await page.getByRole("button", { name: /Your price is ready/ }).press("Enter");
    await expect(page).toHaveURL(/\/login\?next=%2Fjobs%2FTM-1005/);
  });
  test("session loss opens the shared dialog; offline blocks read writes", async ({ page }) => {
    await page.goto(url("state=expired"));
    await page.getByRole("button", { name: "Mark all read", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.goto(url("state=offline"));
    await expect(page.getByRole("button", { name: "Mark all read", exact: true })).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByText("You're offline.", { exact: true })).toBeVisible();
  });
});
