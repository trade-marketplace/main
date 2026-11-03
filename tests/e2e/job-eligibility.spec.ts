import { expect, test } from "@playwright/test";
import { expectNoA11yViolations } from "./support/a11y";

const dev = process.env.E2E_DEV_BASE_URL;
const states = ["ready", "needs-estimate", "own-job", "paused", "email-unconfirmed", "id-unchecked", "licence-pending", "licence-expired", "wrong-trade", "outside-area", "location-unavailable", "work-area-missing"];

test("eligibility examples remain unavailable on deployed/production sites", async ({ page }) => {
  const response = await page.goto("/dev/components/job-eligibility?state=ready");
  expect(response?.status()).toBe(404);
});

test.describe("eligibility preview journeys", () => {
  test.skip(!dev, "Run against an isolated development server for guarded component states.");
  for (const width of [320, 390, 768, 1024, 1440]) test(`every eligibility state at ${width}px is accurate, accessible and contained`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 1000 });
    for (const state of states) {
      await page.goto(`${dev}/dev/components/job-eligibility?state=${state}`);
      await expect(page.getByRole("heading", { name: "Job eligibility", exact: true })).toBeVisible();
      const summary = page.getByRole("region", { name: "Eligible jobs", exact: true });
      const expected = ["ready", "needs-estimate"].includes(state) ? 4 : ["licence-pending", "licence-expired", "wrong-trade"].includes(state) ? 1 : 0;
      await expect(summary.getByRole("link")).toHaveCount(expected);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.locator("main").innerText()).not.toMatch(/worker@example\.test|Private Street|priceCents|approxLat|identityChecked|phoneVerified/);
      await expectNoA11yViolations(page);
    }
  });

  test("keyboard discovery → job result → back, and failed restricted checks still allow Other", async ({ page }) => {
    await page.goto(`${dev}/dev/components/job-eligibility?state=ready`);
    const summary = page.getByRole("region", { name: "Eligible jobs", exact: true });
    await summary.getByRole("link", { name: "Replace a socket", exact: true }).press("Enter");
    await expect(page).toHaveURL(/state=ready#job-socket$/);
    await expect(page.getByRole("region", { name: "Replace a socket", exact: true }).getByText("Ready to claim", { exact: true })).toBeInViewport();
    await page.goBack();
    await expect(page).toHaveURL(/state=ready$/);
    const statesNav = page.getByRole("navigation", { name: "Eligibility state" });
    await statesNav.getByRole("link", { name: "licence pending", exact: true }).press("Enter");
    await expect(summary.getByRole("link")).toHaveCount(1);
    await expect(summary.getByRole("link", { name: "Hang a door", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Replace a socket", exact: true }).getByText("Not eligible", { exact: true })).toHaveCount(3);
    await statesNav.getByRole("link", { name: "paused", exact: true }).press("Enter");
    await expect(summary.getByRole("link")).toHaveCount(0);
    await expect(summary.getByText("Not eligible", { exact: true })).toBeVisible();
    await expectNoA11yViolations(page);
  });
});
