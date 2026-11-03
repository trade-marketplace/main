import { expect, test, type Page } from "@playwright/test";
import { DRAFT_STORAGE_KEY } from "../../src/lib/job-draft";
import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";
test.use({ reducedMotion: "reduce" });
const dev = process.env.E2E_DEV_BASE_URL;
async function start(page: Page) {
  await page.goto("/jobs/new");
  await page.getByRole("textbox", { name: "Describe the job", exact: true }).fill("Lights and wiring in the lounge need checking.");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Add some photos", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Where and when?", exact: true })).toBeFocused();
}
async function address(page: Page) {
  await page.getByRole("combobox", { name: "Address", exact: true }).fill("1 Example Street");
  await expect(page.getByRole("textbox", { name: "Suburb", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Suburb", exact: true }).fill("Gladstone");
  await page.getByRole("textbox", { name: "City", exact: true }).fill("Invercargill");
}
test("guest: real Describe/Photos → address fallback → multiple windows/ASAP → review boundary → Back/refresh/exit", async ({ page }) => {
  test.setTimeout(90_000); await page.setViewportSize({ width: 390, height: 844 }); await start(page);
  await expect(page.getByText("Only shared with the person who takes the job.", { exact: true })).toBeVisible();
  await expect(page.getByText("Pick all the times someone can come.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click(); await expect(page.getByRole("combobox", { name: "Address", exact: true })).toBeFocused();
  await address(page); await page.getByRole("textbox", { name: "Unit / flat (optional)", exact: true }).fill("Shop 2");
  await page.getByRole("textbox", { name: "Anything else? (optional)", exact: true }).fill("Business entrance at the side; call at the desk.");
  const windows = page.locator('input[name="time-windows"]'); await expect(windows).toHaveCount(21);
  await windows.nth(0).press("Space"); await windows.nth(4).press("Space"); await page.getByRole("checkbox", { name: "ASAP: today if possible", exact: true }).check();
  const key = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).data.postKey, DRAFT_STORAGE_KEY);
  await page.getByRole("button", { name: "Next", exact: true }).press("Enter"); await expect(page.getByRole("heading", { name: "All good?", exact: true })).toBeFocused();
  await expect(page.getByRole("button", { name: "Post it", exact: true })).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "Your job" })).toContainText("ASAP");
  await page.getByRole("link", { name: "Back", exact: true }).click(); await expect(windows.nth(0)).toBeChecked(); await expect(windows.nth(4)).toBeChecked(); await page.reload();
  await expect(page.getByRole("textbox", { name: "Unit / flat (optional)", exact: true })).toHaveValue("Shop 2");
  await page.getByRole("button", { name: "Save & exit", exact: true }).click(); await expect(page).toHaveURL("/");
  await page.goto("/jobs/new?step=where"); await expect(windows.nth(4)).toBeChecked();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).data.postKey, DRAFT_STORAGE_KEY)).toBe(key);
  await expectNoA11yViolations(page);
});
test("Any time fills all offered parts; partial postcode is retained and corrected; offline exit preserves the draft", async ({ page }) => {
  await start(page); await address(page);
  await page.getByRole("button", { name: "Any time", exact: true }).press("Enter"); await expect(page.locator('input[name="time-windows"]:checked')).toHaveCount(21);
  await page.getByRole("textbox", { name: "Postcode (optional)", exact: true }).fill("98");
  await page.getByRole("button", { name: "Next", exact: true }).click(); await expect(page.getByRole("textbox", { name: "Postcode (optional)", exact: true })).toBeFocused();
  await page.reload(); await expect(page.getByRole("textbox", { name: "Postcode (optional)", exact: true })).toHaveValue("98");
  await page.getByRole("textbox", { name: "Postcode (optional)", exact: true }).fill("9810");
  await page.context().setOffline(true); await expect(page.getByRole("button", { name: "Next", exact: true })).toHaveAttribute("aria-disabled", "true");
  await page.getByRole("button", { name: "Save & exit", exact: true }).click();
  await page.context().setOffline(false); await page.goto("/jobs/new?step=where");
  await expect(page.locator('input[name="time-windows"]:checked')).toHaveCount(21); await expect(page.getByRole("textbox", { name: "Postcode (optional)", exact: true })).toHaveValue("9810");
});
test("keyboard autocomplete chooses the suggested canonical address; outside selection opens A07 without a private address", async ({ page }) => {
  test.skip(!dev, "guarded preview requires the task-owned dev app");
  await page.goto(`${dev}/dev/components/post-job-where?state=results`);
  const field = page.getByRole("combobox", { name: "Address", exact: true }); await expect(field).toBeFocused(); await field.press("ArrowDown"); await field.press("Enter");
  await expect(field).toHaveValue("12 Dee Street, Invercargill"); await expect(page.getByRole("listbox")).toHaveCount(0);
  await page.goto(`${dev}/dev/components/post-job-where?state=outside`); await field.press("ArrowDown"); await field.press("Enter");
  await expect(page).toHaveURL(/\/coming-soon\?location=Dunedin\+Central$/); expect(page.url()).not.toContain("Princes");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible(); await expectNoA11yViolations(page);
});
test("Auckland midnight rolls offered dates while keeping a stale selection visible and invalid", async ({ page }) => {
  await page.clock.install();
  await start(page); await address(page); await page.locator('input[name="time-windows"]').first().check();
  const oldDate = await page.locator('input[name="time-windows"]').first().inputValue();
  const nextDay = new Date(`${oldDate.split("/")[0]}T12:00:00Z`);
  await page.clock.setSystemTime(nextDay); await page.clock.fastForward(61_000);
  await expect(page.locator(`input[name="time-windows"][value="${oldDate}"]`)).toHaveCount(0);
  await expect(page.getByText("When do you need it?", { exact: true })).toBeVisible();
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).data.timeWindows, DRAFT_STORAGE_KEY); expect(saved[0].date).toBe(oldDate.split("/")[0]);
  await expectNoA11yViolations(page);
});
const states = ["empty", "loading", "results", "manual", "invalid", "outside", "offline", "expired", "review", "saving", "update", "update-error"];
for (const viewport of VIEWPORTS) test(`Where states at ${viewport.name}: layout and axe`, async ({ page }) => {
  test.skip(!dev, "guarded preview requires the task-owned dev app"); test.setTimeout(180_000); await page.setViewportSize(viewport);
  for (const state of states) {
    await page.goto(`${dev}/dev/components/post-job-where?state=${state}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(state.startsWith("update") ? "When do you need it?" : state === "review" ? "All good?" : "Where and when?");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expectNoA11yViolations(page);
  }
});
