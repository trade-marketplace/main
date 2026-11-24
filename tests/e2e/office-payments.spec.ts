// The office Payments ledger (#176) in a browser, through its guarded preview: every state at every width (no
// sideways scroll, no axe violations), filters, search and paging in the URL with Back, the job link, Export CSV,
// and the refund dialog (the job admin's own) by keyboard and pointer. The preview's refund is pretend; the real
// action is covered in tests/unit/office-payments-db.test.ts.
import { expect, test, type Page } from "@playwright/test";

import { OFFICE_PAYMENT_STATES } from "../../src/lib/office-payments";
import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const preview = process.env.OFFICE_PAYMENTS_PREVIEW_URL || process.env.POSTED_PREVIEW_E2E_URL || "http://127.0.0.1:3101";
const base = `${preview}/dev/components/office-payments`;
const route = (state: string) => `${base}?state=${state}`;
test.use({ trace: "on-first-retry", reducedMotion: "reduce" });

const table = (page: Page) => page.getByRole("table", { name: "Payments" });
const rows = (page: Page) => table(page).locator("tbody tr");
const heading = (page: Page) => page.getByRole("heading", { level: 1, name: "Payments", exact: true });

test("office payments preview stays guarded in production", async ({ page }) => {
  expect((await page.goto("/dev/components/office-payments?state=list"))?.status()).toBe(404);
});

for (const viewport of VIEWPORTS) test(`office payments states at ${viewport.width}px`, async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  for (const state of OFFICE_PAYMENT_STATES) await test.step(state, async () => {
    expect((await page.goto(route(state)))?.status()).toBe(200);
    await page.evaluate(() => document.fonts.ready);
    await expect(heading(page)).toBeVisible();
    if (state === "list" || state === "offline") await expect(page.getByText("Showing 1–25 of 30", { exact: true })).toBeVisible();
    if (state === "filtered") {
      await expect(page.getByRole("button", { name: /^Kind: Job/ })).toBeVisible();
      await expect(page.getByRole("button", { name: /^Date: Last 30 days/ })).toBeVisible();
    }
    if (state === "refund-dialog") await expect(page.getByRole("alertdialog", { name: "Refund" })).toBeVisible();
    if (state === "empty") await expect(page.getByRole("heading", { name: "No payments yet.", exact: true })).toBeVisible();
    if (state === "no-match") await expect(page.getByRole("heading", { name: "No payments match that.", exact: true })).toBeVisible();
    if (state === "error") await expect(page.getByRole("heading", { name: "Can’t load payments", exact: true })).toBeVisible();
    if (state === "offline") await expect(page.getByText("You’re offline.", { exact: true })).toBeVisible();
    if (state === "loading") await expect(table(page)).toHaveAttribute("aria-busy", "true");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), state).toBe(true);
    await expectNoA11yViolations(page);
  });
});

test("states show what they should: totals, office-only columns, greyed-out actions", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(route("list"));
  const totals = page.getByRole("region", { name: "Totals" });
  await expect(totals).toContainText("Paid");
  await expect(totals).toContainText("Net");
  await expect(table(page)).toContainText("pi_3Example0000Test");
  await expect(table(page)).toContainText("sarah.thompson@example.test");
  await expect(table(page)).toContainText("Part refunded");
  // TM-1026 is fully refunded: nothing left to give back.
  await expect(page.getByRole("button", { name: "Refund TM-1026, Job" })).toHaveAttribute("aria-disabled", "true");
  await page.goto(route("offline"));
  await expect(page.getByRole("button", { name: "Refund TM-1030, Job" })).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByRole("link", { name: "Export CSV" })).toHaveAttribute("aria-disabled", "true");
  await page.goto(route("error"));
  await page.getByRole("button", { name: "Try again" }).press("Enter");
  await expect(rows(page)).toHaveCount(25);
});

test("keyboard: filters, search and pages go in the URL, and Back brings each one back", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base);
  await page.getByRole("button", { name: /^Status: All/ }).press("Enter");
  await page.getByRole("menuitemradio", { name: "Refunded", exact: true }).press("Enter");
  await expect(page).toHaveURL(`${base}?status=refunded`);
  await expect(rows(page)).toHaveCount(1);
  await expect(page.getByRole("menu")).toBeHidden();
  await page.getByRole("button", { name: /^Kind: All/ }).click();
  await page.getByRole("menuitemradio", { name: "Job", exact: true }).click();
  await expect(page).toHaveURL(`${base}?status=refunded&kind=JOB`);
  await page.goBack();
  await expect(page).toHaveURL(`${base}?status=refunded`);
  await page.goBack();
  await expect(page).toHaveURL(`${base}`);
  await expect(page.getByText("Showing 1–25 of 30", { exact: true })).toBeVisible();

  await page.getByRole("searchbox", { name: "Search payments" }).or(page.getByRole("textbox", { name: "Search payments" })).fill("tom baker");
  await expect(page).toHaveURL(`${base}?q=tom+baker`);
  await expect(page.getByText("Showing 1–8 of 8", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).first().press("Enter");
  await expect(page).toHaveURL(`${base}`);

  await page.getByRole("button", { name: "Next page" }).press("Enter");
  await expect(page).toHaveURL(`${base}?page=2`);
  await expect(page.getByText("Showing 26–30 of 30", { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByText("Showing 1–25 of 30", { exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.getByText("Showing 26–30 of 30", { exact: true })).toBeVisible();
});

test("the job link opens that job's admin page (signed out here, so it asks to log in and comes back to it)", async ({ page }) => {
  await page.goto(route("list"));
  await table(page).getByRole("link", { name: "Sub wiring" }).first().click();
  await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Fjobs%2F17600000-0000-4000-8000-000000000500/);
  await page.goBack();
  await expect(heading(page)).toBeVisible();
});

test("Export CSV downloads the filtered list", async ({ page }) => {
  await page.goto(route("list"));
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export CSV" }).press("Enter");
  expect(await (await download).path()).toBeTruthy();
});

test("keyboard: Refund opens the job admin's dialog; Escape returns focus; a part refund is recorded on the row", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(route("list"));
  const refund = page.getByRole("button", { name: "Refund TM-1030, Job" });
  await refund.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("alertdialog", { name: "Refund" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("No real money moves until real payments are on.", { exact: false })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(refund).toBeFocused();
  await expect(refund).not.toHaveCSS("outline-style", "none");

  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  // Nothing typed: the note is required, as in the job admin.
  await dialog.getByRole("button", { name: "Record refund" }).press("Enter");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("radio", { name: "Part refund" }).check();
  await dialog.getByLabel("Amount to refund").fill("10");
  await dialog.getByLabel("Note").fill("Part of the job not done.");
  await dialog.getByRole("button", { name: "Record refund" }).press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Refund recorded for TM-1030.", { exact: true })).toBeVisible();
  const row = rows(page).filter({ hasText: "TM-1030" });
  await expect(row).toContainText("Part refunded");
  await expect(row).toContainText("$10.00");
  await expectNoA11yViolations(page);
});

test("pointer: a click opens the dialog, Not now closes it, and no focus box is left behind", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(route("list"));
  const refund = page.getByRole("button", { name: "Refund TM-1030, Job" });
  await refund.click();
  const dialog = page.getByRole("alertdialog", { name: "Refund" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Not now" }).click();
  await expect(dialog).toBeHidden();
  await expect(refund).toHaveCSS("outline-style", "none");
});
