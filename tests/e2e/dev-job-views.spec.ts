import { expect, test } from "@playwright/test";
import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const app = process.env.E2E_DEV_BASE_URL;
const states = ["customer", "worker-unclaimed", "worker-assigned", "worker-reassigned", "worker-cancelled", "missing-pin", "office", "public", "loading", "error"];
const url = (state: string) => new URL(`/dev/components/job-views?state=${state}`, app!).href;

test("job views preview is guarded in production", async ({ page }) => {
  test.skip(Boolean(app), "development preview run");
  expect((await page.goto("/dev/components/job-views"))?.status()).toBe(404);
});

test.describe("job data view previews", () => {
  test.skip(!app, "set E2E_DEV_BASE_URL for guarded example states");
  test.use({ reducedMotion: "reduce" });

  for (const viewport of VIEWPORTS) test(`${viewport.width}px: every role, revocation and fallback fits and passes axe`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize(viewport);
    for (const state of states) {
      await page.goto(url(state));
      await expect(page.getByRole("heading", { name: state === "worker-reassigned" ? "Wrong address." : "Who sees what", exact: true })).toBeVisible();
      if (state === "worker-reassigned") {
        await expect(page.locator("body")).not.toContainText("Sub wiring");
        await expect(page.locator("body")).not.toContainText("1 Example Street");
        await expect(page.locator("pre")).toHaveCount(0);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), state).toBe(0);
      await expectNoA11yViolations(page);
      if ((state.startsWith("worker") && state !== "worker-reassigned") || state === "missing-pin") {
        if (state === "worker-assigned") await expect(page.getByText("1 Example Street", { exact: true })).toBeVisible();
        else {
          await expect(page.getByText("Hidden until claimed").first()).toBeVisible();
          await expect(page.getByText("1 Example Street", { exact: true })).toHaveCount(0);
        }
      }
    }
  });

  test("actual links and keyboard navigation reach role states, Back restores the previous tier, retry works", async ({ page }) => {
    await page.goto(url("worker-unclaimed"));
    const nav = page.getByRole("navigation", { name: "Preview state" });
    await nav.getByRole("link", { name: "worker assigned", exact: true }).click();
    await expect(page.getByText("1 Example Street", { exact: true })).toBeVisible();
    await page.getByText("View serialized data", { exact: true }).press("Enter");
    await expect(page.locator("pre")).toBeVisible();
    await expect(page.locator("pre")).not.toContainText("priceCents");
    await page.goBack();
    await expect(page.getByText("Hidden until claimed").first()).toBeVisible();
    const customer = nav.getByRole("link", { name: "customer", exact: true });
    await customer.focus(); await customer.press("Enter");
    await expect(page.getByText("$372.00", { exact: true })).toBeVisible();
    await page.getByText("View serialized data", { exact: true }).click();
    await expect(page.locator("pre")).not.toContainText("margin");
    await expect(page.locator("pre")).not.toContainText("estimates");
    await nav.getByRole("link", { name: "error", exact: true }).click();
    await page.getByRole("link", { name: "Try again", exact: true }).click();
    await expect(page.getByText("1 Example Street", { exact: true })).toBeVisible();
  });
});
