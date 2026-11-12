import { expect, test } from "@playwright/test";
import { expectNoA11yViolations } from "./support/a11y";
const preview = process.env.POSTED_PREVIEW_E2E_URL || "http://127.0.0.1:3101";
test("a caller controls selection while row callbacks and Escape preserve focus", async ({ page }) => {
  test.setTimeout(120_000);
  for (const width of [320,390,768,1024,1440]) {
    await page.setViewportSize({ width, height: 1000 }); await page.goto(preview + "/dev/components/map?hooks=controlled");
    const first = page.getByRole("button", { name: "Select first job", exact: true }); await first.press("Enter");
    await expect(page.locator("article[data-card-kind]")).toHaveCount(1); await expect(page.locator("article[data-card-kind] a")).toHaveAttribute("href", "/jobs/TM-1005");
    await page.keyboard.press("Escape"); await expect(page.locator("article[data-card-kind]")).toHaveCount(0); await expect(first).toBeFocused();
    const layout = page.getByRole("heading", { name: "Controlled map", exact: true }).locator("..");
    const pin = layout.getByRole("list", { name: /jobs in view/ }).getByRole("button").first(); await pin.press("Enter"); await expect(page.getByRole("status", { name: "Selection events" })).not.toHaveText("None");
    await page.keyboard.press("Escape"); await expect(pin).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await expectNoA11yViolations(page);
  }
});
test("a caller closes the legend and receives bounds after a cluster zoom", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto(preview + "/dev/components/map?hooks=controlled");
  await expect(page.getByRole("list", { name: "What the pins mean", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Hide legend", exact: true }).press("Enter"); await expect(page.getByRole("list", { name: "What the pins mean", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Show legend", exact: true }).press("Enter"); await page.getByRole("button", { name: "Close map legend", exact: true }).press("Enter");
  await expect(page.getByRole("button", { name: "Show legend", exact: true })).toBeFocused();
  const view = page.getByRole("status", { name: "View bounds" }), before = await view.textContent(); await page.locator('button[data-pin-kind="cluster"]').first().press("Enter");
  await expect(view).not.toHaveText(before!); await expectNoA11yViolations(page);
});
