import { expect, test } from "@playwright/test";
import { DRAFT_STORAGE_KEY } from "../../src/lib/job-draft";
import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const dev = process.env.E2E_DEV_BASE_URL;
test.use({ reducedMotion: "reduce" });

test("guest: shared validation → editable guess → Photos → Back → refresh → Save & exit → restore", async ({ page }) => {
  await page.goto("/jobs/new");
  await expect(page.getByRole("heading", { name: "What needs doing?" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Describe the job", exact: true })).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Describe the job", exact: true })).toHaveAttribute("aria-invalid", "true");
  await page.getByRole("textbox", { name: "Describe the job", exact: true }).fill("Lights in the lounge keep flickering.");
  await expect(page.getByRole("radio", { name: "Electrical", exact: true })).toBeChecked();
  await page.getByRole("radio", { name: "Plumbing", exact: true }).check();
  await page.getByRole("textbox", { name: "Describe the job", exact: true }).fill("Lights and wiring in the lounge need checking.");
  await expect(page.getByRole("radio", { name: "Plumbing", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Next", exact: true }).press("Enter");
  await expect(page.getByRole("heading", { name: "Photos", exact: true })).toBeFocused();
  await expect(page.getByRole("complementary", { name: "Your job" })).toContainText("Lights and wiring");
  await page.getByRole("link", { name: /What needs doing/ }).click();
  await expect(page.getByRole("textbox", { name: "Describe the job", exact: true })).toHaveValue("Lights and wiring in the lounge need checking.");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("link", { name: "Back", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Describe the job", exact: true })).toHaveValue("Lights and wiring in the lounge need checking.");
  await page.reload();
  await expect(page.getByText("Draft restored", { exact: true })).toBeVisible();
  const key = await page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey)!).data.postKey, DRAFT_STORAGE_KEY);
  await page.getByRole("button", { name: "Save & exit", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/jobs/new");
  await expect(page.getByRole("textbox", { name: "Describe the job", exact: true })).toHaveValue("Lights and wiring in the lounge need checking.");
  expect(await page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey)!).data.postKey, DRAFT_STORAGE_KEY)).toBe(key);
});

test("unfinished guest text survives refresh; Not sure selects Other and its prompt", async ({ page }) => {
  await page.goto("/jobs/new?description=Garden&type=other");
  await expect(page.getByRole("textbox", { name: "What do you need done?", exact: true })).toHaveValue("Garden");
  await page.getByRole("textbox", { name: "What do you need done?", exact: true }).fill("Mo");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "What do you need done?", exact: true })).toHaveValue("Mo");
  await page.getByRole("button", { name: "Not sure", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Other (anything)", exact: true })).toBeChecked();
  await expect(page.getByText("Moving, cleaning, gardening, assembly or anything else? Pick Other.", { exact: true })).toBeVisible();
});

test.describe("guarded Describe previews", () => {
  test.skip(!dev, "requires the dev or screenshot-only server");
  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: every state fits and passes axe`, async ({ page }) => {
      test.setTimeout(180_000); await page.setViewportSize(viewport);
      for (const state of ["empty", "describe", "other", "restored", "invalid", "saving", "loading", "save-error", "offline", "load-error", "photos"]) {
        await page.goto(new URL(`/dev/components/post-job?state=${state}`, dev).href);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(state === "photos" ? "Photos" : "What needs doing?");
        if (state === "offline") await expect(page.getByRole("button", { name: "Next", exact: true })).toHaveAttribute("aria-disabled", "true");
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), state).toBe(0);
        await expectNoA11yViolations(page);
      }
    });
  }
});
