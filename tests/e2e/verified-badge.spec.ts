import { expect, test } from "@playwright/test";
import { expectNoA11yViolations } from "./support/a11y";

const dev = process.env.E2E_DEV_BASE_URL;
const states = ["verified", "email-unconfirmed", "phone-unconfirmed", "phone-changed", "id-unchecked", "checking", "rejected", "expired", "unchecked-trade", "paused", "other"];

test("verification examples stay private in production", async ({ page }) => {
  const response = await page.goto("/dev/components/verified-badge?state=verified");
  expect(response?.status()).toBe(404);
});

test.describe("verification presentation", () => {
  test.skip(!dev, "Uses an isolated dev server for guarded component previews.");
  for (const width of [320, 390, 768, 1024, 1440]) test(`every proof state on tiles, profiles and booked panels at ${width}px`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 1000 });
    for (const state of states) {
      await page.goto(`${dev}/dev/components/verified-badge?state=${state}`);
      await expect(page.getByRole("heading", { name: "Verified badge", exact: true })).toBeVisible();
      await expect(page.getByRole("region", { name: "Worker tile", exact: true })).toBeVisible();
      const licence = page.getByText("Licence checked", { exact: true });
      if (state === "verified") await expect(licence).toHaveCount(3);
      else await expect(licence).toHaveCount(0);
      if (state === "other") await expect(page.getByText("Verified", { exact: true })).toHaveCount(3);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(await page.locator("main").innerText()).not.toMatch(/worker@example\.test|\+6421|identityChecked|phoneVerified/);
      await expectNoA11yViolations(page);
    }
  });

  test("keyboard tile → profile → back, then pause and Other states keep the advertised proof accurate", async ({ page }) => {
    await page.goto(`${dev}/dev/components/verified-badge?state=verified`);
    const tile = page.getByRole("region", { name: "Worker tile", exact: true });
    const profileLink = tile.getByRole("link", { name: "Jack W.", exact: true });
    await profileLink.focus();
    await profileLink.press("Enter");
    await expect(page).toHaveURL(/state=verified&view=profile#profile$/);
    await expect(page.getByRole("region", { name: "Profile", exact: true })).toBeInViewport();
    await page.goBack();
    await expect(page).toHaveURL(/state=verified$/);
    await page.getByRole("navigation", { name: "Verification state" }).getByRole("link", { name: "paused", exact: true }).press("Enter");
    await expect(page).toHaveURL(/state=paused$/);
    await expect(page.getByText("Licence checked", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Verified", { exact: true })).toHaveCount(0);
    await page.getByRole("navigation", { name: "Verification state" }).getByRole("link", { name: "other", exact: true }).press("Enter");
    await expect(page.getByText("Verified", { exact: true })).toHaveCount(3);
    await expect(page.getByText("Licence checked", { exact: true })).toHaveCount(0);
    await expectNoA11yViolations(page);
  });
});
