import { expect, type Page, test } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

// The tradie's Earnings page (#165, D12) in every state, with pretend payouts and no database. It is reachable only
// through guardDevPage(), so run its browser checks against Next dev:
//   E2E_DEV_BASE_URL=http://127.0.0.1:3000 npx playwright test tests/e2e/dev-earnings.spec.ts
// The pretend "today" is Monday 2 November 2026, so the next payroll is Fri 6 Nov and the last paid one Fri 30 Oct.
const devUrl = process.env.E2E_DEV_BASE_URL;
const url = (query = "") => (devUrl ? new URL(`/dev/components/earnings${query}`, devUrl).href : "");

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
}

test("/dev/components/earnings is a 404 in production", async ({ page }) => {
  test.skip(Boolean(devUrl), "checking the development server instead");
  const response = await page.goto("/dev/components/earnings");
  expect(response?.status()).toBe(404);
});

test.describe("/dev/components/earnings", () => {
  test.skip(!devUrl, "set E2E_DEV_BASE_URL to a running npx next dev server");
  test.use({ reducedMotion: "reduce" });

  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: every state fits, has a heading and passes axe`, async ({ browser }) => {
      test.setTimeout(240_000);
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, reducedMotion: "reduce" });
      const page = await context.newPage();
      // Each state, and what shows when it is open. A phone has no chart: it shows the next payroll's list.
      const lists = viewport.width < 640 ? "Next payroll · Fri 6 Nov" : "Last 8 weeks";
      const states: [string, (page: Page) => Promise<void>][] = [
        ["", (p) => expect(p.getByRole("heading", { name: lists })).toBeVisible()],
        ["?state=long", (p) => expect(p.getByRole("heading", { name: lists })).toBeVisible()],
        ["?state=no-paid", (p) => expect(p.getByRole("heading", { name: lists })).toBeVisible()],
        ["?details=missing", (p) => expect(p.getByText("Add bank account & IRD number.")).toBeVisible()],
        ["?state=empty", (p) => expect(p.getByRole("heading", { name: "No earnings yet." })).toBeVisible()],
        ["?state=error", (p) => expect(p.getByRole("heading", { name: "Can’t load your earnings" })).toBeVisible()],
        ["?state=loading", (p) => expect(p.getByRole("heading", { level: 1, name: "Earnings" })).toBeVisible()],
        ["?payroll=next", (p) => expect(p.getByRole("dialog").getByRole("heading", { name: "Next payroll · Fri 6 Nov" })).toBeVisible()],
        ["?payroll=2026-10-30", (p) => expect(p.getByRole("dialog").getByRole("heading", { name: "Payroll 30 Oct" })).toBeVisible()],
        ["?state=long&payroll=next", (p) => expect(p.getByRole("dialog").getByRole("heading", { name: "Next payroll · Fri 6 Nov" })).toBeVisible()],
      ];
      for (const [query, shows] of states) {
        await page.goto(url(query));
        await shows(page);
        await noOverflow(page);
        await expectNoA11yViolations(page);
      }
      await context.close();
    });
  }

  test("a computer shows the three KPIs, the chart and the payroll table, and no phone lists", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url());
    await expect(page.getByText("Paid in November").first()).toBeVisible();
    await expect(page.getByText("Next payroll · Fri 6 Nov").first()).toBeVisible();
    await expect(page.getByText("$259.20").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Last 8 weeks" })).toBeVisible();
    await expect(page.getByRole("table", { name: "Payrolls" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Paid", exact: true })).toBeHidden();
    await expect(page.getByRole("row")).toHaveCount(1 + 6);
    const queued = page.getByRole("row", { name: /Fri 6 Nov/ });
    await expect(queued.getByText("Queued")).toBeVisible();
    await expect(page.getByRole("row", { name: /Fri 30 Oct/ }).getByText("Paid")).toBeVisible();
  });

  test("a phone shows the money card and lists instead, as in the mockup", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url());
    await expect(page.getByRole("heading", { name: "Next payroll · Fri 6 Nov" })).toBeVisible();
    await expect(page.getByText("TM-0990 · signed off Fri")).toBeVisible();
    await expect(page.getByText("TM-1005 · in progress")).toBeVisible();
    await expect(page.getByText("After sign-off")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Paid", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Last 8 weeks" })).toBeHidden();
    await expect(page.getByRole("table")).toBeHidden();
  });

  test("the current week's bar is Hi-Vis, and hovering or focusing a bar shows its amount", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url());
    await expect(page.getByRole("listitem", { name: /^Week of 26 Oct, \$/ })).toHaveCount(1);
    const thisWeek = page.getByRole("listitem", { name: /^This week, / });
    const older = page.getByRole("listitem", { name: /^Week of 19 Oct, / });
    const colour = (locator: typeof thisWeek) => locator.locator("span").first().evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(await colour(thisWeek)).not.toBe(await colour(older));
    const tip = older.locator("span").nth(1);
    await expect(tip).toHaveCSS("opacity", "0");
    await older.hover();
    await expect(tip).toHaveCSS("opacity", "1");
    await expect(tip).toHaveText(/^\$[\d,]+\.\d\d$/);
    await page.mouse.move(0, 0);
    await expect(tip).toHaveCSS("opacity", "0");
    // The keyboard gets the same: Tab onto a bar.
    await older.focus();
    await expect(tip).toHaveCSS("opacity", "1");
  });

  test("clicking a payroll row opens its breakdown; Esc closes it and focus comes back; Back does too", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url());
    // Anywhere on the row opens it, not only the date.
    await page.getByRole("row", { name: /Fri 30 Oct/ }).getByRole("cell").nth(1).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("heading", { name: "Payroll 30 Oct" })).toBeVisible();
    await expect(page).toHaveURL(/payroll=2026-10-30/);
    for (const label of ["Hours", "Rate", "Holiday pay", "Total"]) await expect(drawer.getByText(label, { exact: true }).first()).toBeVisible();
    await expect(drawer.getByText("Heat pump circuit")).toBeVisible();
    await expect(drawer.getByText("$70.00/hr").first()).toBeVisible();
    await expect(drawer.getByText("Paid", { exact: true })).toBeVisible();
    await expectNoA11yViolations(page);

    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(page).not.toHaveURL(/payroll=/);

    // Open again, then browser Back closes it.
    await page.getByRole("link", { name: "Fri 30 Oct" }).click();
    await expect(drawer).toBeVisible();
    await page.goBack();
    await expect(drawer).toBeHidden();
    await expect(page).not.toHaveURL(/payroll=/);
  });

  test("keyboard: Tab to a payroll's link and press Enter to open it; the × closes it", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url());
    const link = page.getByRole("link", { name: "Fri 6 Nov" });
    await link.focus();
    await page.keyboard.press("Enter");
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("heading", { name: "Next payroll · Fri 6 Nov" })).toBeVisible();
    await expect(drawer.getByText("Queued", { exact: true })).toBeVisible();
    await drawer.getByRole("button", { name: "Close" }).press("Enter");
    await expect(drawer).toBeHidden();
    await expect(link).toBeFocused();
  });

  test("no focus box after a click on a row, the statement button or a bar", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url());
    await page.getByRole("link", { name: "Download statement" }).click({ trial: true });
    const bar = page.getByRole("listitem", { name: /^Week of 19 Oct/ });
    await bar.click();
    expect(await bar.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("none");
  });

  test("a phone: tapping a paid payroll opens its breakdown in a sheet; the × closes it", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url());
    await page.getByRole("link", { name: "Payroll 30 Oct" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: "Payroll 30 Oct" })).toBeVisible();
    await expect(sheet.getByText("Holiday pay").first()).toBeVisible();
    await noOverflow(page);
    await sheet.getByRole("button", { name: "Close" }).click();
    await expect(sheet).toBeHidden();
    await expect(page).not.toHaveURL(/payroll=/);
  });

  test("the error state's Try again and the empty state's Find work are real buttons", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url("?state=error"));
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await page.goto(url("?state=empty"));
    await expect(page.getByRole("link", { name: "Find work" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Download statement" })).toHaveAttribute("aria-disabled", "true");
  });

  test("the Earnings link in the top nav is the current page", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url());
    await expect(page.getByRole("link", { name: "Earnings" }).first()).toHaveAttribute("aria-current", "page");
  });
});
