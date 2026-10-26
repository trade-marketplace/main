import { mkdir } from "node:fs/promises";
import path from "node:path";

import { expect, type Page, test } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const devUrl = process.env.E2E_DEV_BASE_URL;
const url = (query = "") => devUrl ? new URL(`/dev/components/data${query}`, devUrl).href : "";
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  expect(await page.locator("main").evaluate((main) => [...main.querySelectorAll<HTMLElement>("button, td, label, p")]
    .filter((element) => element.clientWidth > 1 && element.scrollWidth > element.clientWidth + 1)
    .map((element) => element.textContent?.slice(0, 80)))).toEqual([]);
}

test("/dev/components/data stays unavailable in production", async ({ page }) => {
  test.skip(Boolean(devUrl), "checking the dev server instead");
  expect((await page.goto("/dev/components/data"))?.status()).toBe(404);
});

test.describe("data components on the dev server", () => {
  test.skip(!devUrl, "set E2E_DEV_BASE_URL to a running dev server");

  for (const viewport of VIEWPORTS) {
    test(`fits at ${viewport.width}px and is accessible`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(url());
      await expect(page.getByRole("table", { name: "Example jobs", exact: true })).toBeVisible();
      await noOverflow(page);
      await expectNoA11yViolations(page);
    });
  }

  for (const mode of ["office", "customer", "trade"]) {
    for (const state of ["default", "loading", "empty", "error", "disabled", "selected", "filtered", "long"]) {
      for (const width of [390, 1440]) {
        test(`${mode} ${state} at ${width}px`, async ({ page }) => {
          await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
          await page.goto(url(`?mode=${mode}&state=${state}`));
          await expect(page.getByRole("radio", { name: state[0].toUpperCase() + state.slice(1), exact: true })).toBeChecked();
          await noOverflow(page);
          await expectNoA11yViolations(page);
          const directory = process.env.DATA_SCREENSHOTS_DIR;
          if (directory) {
            await mkdir(directory, { recursive: true });
            await page.evaluate(() => document.fonts.ready);
            await page.screenshot({ path: path.join(directory, `${mode}-${state}-${width}.png`), fullPage: true, animations: "disabled" });
          }
        });
      }
    }
  }

  test("keyboard tabs wrap, skip disabled tabs, and move the M16 indicator", async ({ page }) => {
    await page.goto(url());
    const tabs = page.getByRole("tablist", { name: "Tab example", exact: true });
    const all = tabs.getByRole("tab", { name: "All jobs", exact: true });
    await all.focus();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.getByRole("tab", { name: "Active", exact: true })).toBeFocused();
    await expect(tabs.getByRole("tab", { name: "Active", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("End");
    await expect(tabs.getByRole("tab", { name: "Done", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(all).toBeFocused();
    await expect(tabs.locator("[data-tab-indicator]")).toHaveAttribute("data-ready", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(tabs.getByRole("tab", { name: "Done", exact: true })).toBeFocused();
    await page.keyboard.press("Home");
    await expect(all).toBeFocused();
    expect(await all.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none");
    await expectNoA11yViolations(page);
  });

  test("sort, row actions, mixed selection and selection across pages work together", async ({ page }) => {
    await page.goto(url());
    const table = page.getByRole("table", { name: "Example jobs", exact: true });
    await table.getByRole("button", { name: "Job", exact: true }).click();
    await expect(table.getByRole("columnheader", { name: "Job", exact: true })).toHaveAttribute("aria-sort", "descending");
    const checkboxes = table.getByRole("checkbox");
    await checkboxes.nth(1).check();
    await expect(checkboxes.first()).toHaveAttribute("aria-checked", "mixed");
    await checkboxes.first().focus();
    await page.keyboard.press("Space");
    await expect(page.getByRole("status", { name: "", exact: true }).filter({ hasText: "25 selected" })).toHaveText("25 selected");
    await page.getByRole("navigation", { name: "Pagination", exact: true }).getByRole("button", { name: "Next page", exact: true }).click();
    await expect(checkboxes.first()).not.toBeChecked();
    await checkboxes.first().focus();
    await page.keyboard.press("Space");
    await expect(page.getByText("31 selected", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Open selected jobs", exact: true }).click();
    await expect(page.getByText("Opened 31 selected example jobs.", { exact: true })).toBeVisible();
    await table.getByRole("button", { name: /^Open TM-/ }).first().click();
    await expect(page.locator('[aria-live="polite"]').filter({ hasText: /^TM-/ })).toContainText("TM-");
    await page.getByRole("button", { name: "Clear selection", exact: true }).click();
    await expect(page.getByText("0 selected", { exact: true })).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("filters reset pagination; saved filters restore after reload and can be removed", async ({ page }) => {
    await page.goto(url());
    await page.getByRole("navigation", { name: "Pagination", exact: true }).getByRole("button", { name: "Next page", exact: true }).click();
    await page.getByRole("combobox", { name: "Suburb", exact: true }).selectOption("Windsor");
    await page.getByRole("searchbox", { name: "Search jobs", exact: true }).fill("gate");
    await expect(page.getByRole("navigation", { name: "Pagination", exact: true })).toContainText("1–3 of 3");
    await page.getByRole("textbox", { name: "Filter name", exact: true }).fill("Windsor gates");
    await page.getByRole("button", { name: "Save filters", exact: true }).click();
    await page.reload();
    await page.getByRole("button", { name: "Windsor gates", exact: true }).click();
    await expect(page.getByRole("searchbox", { name: "Search jobs", exact: true })).toHaveValue("gate");
    await expect(page.getByRole("combobox", { name: "Suburb", exact: true })).toHaveValue("Windsor");
    await page.getByRole("button", { name: "Remove Suburb: Windsor", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Suburb", exact: true })).toHaveValue("");
    await page.getByRole("button", { name: "Delete saved filter Windsor gates", exact: true }).click();
    await expect(page.getByRole("button", { name: "Windsor gates", exact: true })).toHaveCount(0);
    await page.getByRole("searchbox", { name: "Search jobs", exact: true }).fill("no matching job");
    await expect(page.getByRole("heading", { name: "No jobs match that.", exact: true })).toBeVisible();
    await page.locator("#usage").getByRole("button", { name: "Reset filters", exact: true }).last().click();
    await expect(page.getByRole("table", { name: "Example jobs", exact: true })).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("error recovery, disabled rows and sticky headers", async ({ page }) => {
    await page.goto(url("?state=error"));
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page.getByRole("table", { name: "Example jobs", exact: true })).toBeVisible();
    const region = page.getByRole("region", { name: "Example jobs rows", exact: true });
    const before = await region.locator("thead").boundingBox();
    await region.evaluate((element) => { element.scrollTop = 200; });
    const after = await region.locator("thead").boundingBox();
    expect(Math.abs(after!.y - before!.y)).toBeLessThan(2);
    await page.getByRole("radio", { name: "Disabled", exact: true }).check();
    await expect(page.getByRole("searchbox", { name: "Search jobs", exact: true })).toBeDisabled();
    await expect(page.getByRole("checkbox").first()).toBeDisabled();
    await expectNoA11yViolations(page);
  });

  test("200% zoom and very long text remain usable without sideways scroll", async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 450 });
    await page.goto(url("?state=long"));
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    await noOverflow(page);
    await page.getByRole("checkbox", { name: "Select TM-1001", exact: true }).check();
    await expect(page.getByText("1 selected", { exact: true })).toBeVisible();
    await expectNoA11yViolations(page);
  });
});
