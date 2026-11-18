// The office Payouts page (#175, #166) in a browser, through its guarded preview: every state at every width (no
// sideways scroll, no axe violations), and the export → mark paid flow by keyboard and pointer.
import { expect, test } from "@playwright/test";

import { PAYOUT_STATES } from "../../src/lib/office/payouts";
import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const preview = process.env.OFFICE_PAYOUTS_PREVIEW_URL || process.env.POSTED_PREVIEW_E2E_URL || "http://127.0.0.1:3101";
const route = (state: string) => `${preview}/dev/components/office-payouts?state=${state}`;
test.use({ trace: "on-first-retry" });

test("office payouts preview stays guarded in production", async ({ page }) => {
  expect((await page.goto("/dev/components/office-payouts?state=queued"))?.status()).toBe(404);
});

for (const viewport of VIEWPORTS) test(`office payouts states at ${viewport.width}px`, async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  for (const state of [...PAYOUT_STATES, "gallery"]) await test.step(state, async () => {
    expect((await page.goto(route(state)))?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Payouts", exact: true, level: 1 }).first()).toBeVisible();
    await expect(page.getByText("These are payroll records. Marking paid doesn’t move money.", { exact: false }).first()).toBeVisible();
    if (state === "mark-paid") await expect(page.getByRole("alertdialog", { name: "Mark the Fri 20 Nov batch paid?" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expectNoA11yViolations(page);
  });
});

test("states show what they should", async ({ page }) => {
  await page.goto(route("blockers"));
  await expect(page.getByText("Mere R · blocks payout")).toBeVisible();
  await expect(page.getByText("No bank details")).toBeVisible();
  await page.goto(route("nothing-queued"));
  await expect(page.getByRole("heading", { name: "Nothing queued." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export payroll CSV" })).toHaveAttribute("aria-disabled", "true");
  await page.goto(route("error"));
  await expect(page.getByRole("heading", { name: "Can’t load payouts" })).toBeVisible();
  await page.goto(route("offline"));
  await expect(page.getByText("We’ll keep trying.", { exact: false }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Export payroll CSV" })).toHaveAttribute("aria-disabled", "true");
  await page.goto(route("paid"));
  await expect(page.getByText("Fri 20 Nov batch marked paid. 3 tradies told.")).toBeVisible();
});

test("keyboard: export downloads the CSV, then mark the batch paid through the confirm dialog", async ({ page }) => {
  await page.goto(route("blockers"));
  const download = page.waitForEvent("download");
  const exportButton = page.getByRole("button", { name: "Export payroll CSV" });
  await exportButton.focus();
  await page.keyboard.press("Enter");
  expect((await download).suggestedFilename()).toBe("payroll-2026-11-20-151200.csv");
  await expect(page.getByText("Exported 4 payouts", { exact: false })).toBeVisible();
  await expect(page.getByText("1 payout held back for missing payroll details.", { exact: false })).toBeVisible();
  // Only the held-back payout is left; exporting again has nothing ready.
  await expect(exportButton).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByRole("cell", { name: "Exported" }).or(page.getByText("Exported", { exact: true })).first()).toBeVisible();

  const mark = page.getByRole("button", { name: "Mark batch paid", exact: true }).first();
  await mark.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("alertdialog", { name: "Mark the Fri 20 Nov batch paid?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("4 jobs · 3 tradies")).toBeVisible();
  await expect(dialog.getByText("Only do this once payroll has paid them.", { exact: false })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(mark).toBeFocused();
  await expect(mark).not.toHaveCSS("outline-style", "none"); // keyboard focus stays visible (M05)

  await page.keyboard.press("Enter");
  await dialog.getByRole("button", { name: "Mark batch paid" }).press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Fri 20 Nov batch marked paid. 3 tradies told.")).toBeVisible();
  await expect(mark).toHaveAttribute("aria-disabled", "true");
  await expectNoA11yViolations(page);
});

test("pointer: a click opens the dialog without leaving a focus box, and Not yet closes it", async ({ page }) => {
  await page.goto(route("exported"));
  await page.getByRole("button", { name: "Mark Fri 20 Nov batch paid" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Not yet" }).click();
  await expect(dialog).toBeHidden();
  const download = page.getByRole("link", { name: "Download CSV, Fri 20 Nov batch" });
  await expect(download).toHaveAttribute("download", "");
});
