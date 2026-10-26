import { expect, type Page, test } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

// /dev/components/status (#77) is a development-only page. `npm run e2e` runs the production build, where it must be
// a 404. To check the page itself, start `npm run dev` and point these tests at it:
//   E2E_DEV_BASE_URL=http://localhost:3000 npx playwright test tests/e2e/dev-status-components.spec.ts

test("/dev/components/status is not in production builds", async ({ page }) => {
  test.skip(Boolean(process.env.E2E_DEV_BASE_URL), "checking the dev server instead");
  const response = await page.goto("/dev/components/status");
  expect(response?.status()).toBe(404);
});

const devUrl = process.env.E2E_DEV_BASE_URL;
const url = (mode?: string) => (devUrl ? new URL(`/dev/components/status${mode ? `?mode=${mode}` : ""}`, devUrl).href : "");

async function sidewaysScroll(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** Every element in the "Long text" boxes stays inside its box (the price block's bolt is decorative and clipped). */
async function overflowingInLongText(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("#long h3")].flatMap((heading) => {
      const box = heading.parentElement!;
      const edge = box.getBoundingClientRect().right;
      return [...box.querySelectorAll("*")]
        .filter((el) => !el.closest("svg"))
        .filter((el) => el.getBoundingClientRect().right > edge + 0.5)
        .map((el) => `${heading.textContent}: ${el.tagName} ${el.textContent}`);
    }),
  );
}

test.describe("/dev/components/status on the dev server", () => {
  test.skip(!devUrl, "set E2E_DEV_BASE_URL to a running `npm run dev`");

  for (const mode of ["customer", "trade", "office"]) {
    for (const viewport of VIEWPORTS) {
      test(`${mode} mode at ${viewport.width}px: no sideways scroll, nothing overflows, no axe violations`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(url(mode === "customer" ? undefined : mode));
        await expect(page.getByRole("heading", { level: 1, name: "Status components" })).toBeVisible();
        expect(await sidewaysScroll(page)).toBe(0);
        expect(await overflowingInLongText(page)).toEqual([]);
        await expectNoA11yViolations(page);
      });
    }
  }

  test("still works at 200% zoom (a 1280px window is 640 CSS pixels)", async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 400 });
    await page.goto(url());
    expect(await sidewaysScroll(page)).toBe(0);
    expect(await overflowingInLongText(page)).toEqual([]);
    await expect(page.getByRole("button", { name: "Move the job on" })).toBeVisible();
  });

  test("shows each mode's own labels", async ({ page }) => {
    await page.goto(url("trade"));
    const table = page.getByRole("table", { name: "Tradie pill for each job status" });
    await expect(table.getByText("Needs an estimate", { exact: true })).toBeVisible();
    await expect(table.getByText("Quote bounty", { exact: true })).toBeVisible();
    await page.goto(url("office"));
    await expect(page.getByRole("table", { name: "Office pill for each job status" }).getByText("To price", { exact: true })).toBeVisible();
  });

  test("M25: moving the job on with the keyboard announces the new status as text", async ({ page }) => {
    await page.goto(url());
    const live = page.locator("#m25").getByRole("status");
    await expect(live).toHaveText("Getting your price");
    const button = page.getByRole("button", { name: "Move the job on" });
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(live.locator("[data-kind]")).toHaveCount(1); // the old pill has faded out
    await expect(live).toHaveText("Needs a quick look");
    await page.keyboard.press("Space");
    await expect(live).toHaveText("Price ready");
    await expectNoA11yViolations(page);
  });

  test("M11: the tracker moves on a step at a time and marks the current step", async ({ page }) => {
    await page.goto(url());
    const tracker = page.getByRole("list", { name: "Tracker progress demo" });
    await expect(tracker.locator("[aria-current='step']")).toContainText("Getting your price");
    await page.getByRole("button", { name: "Next step" }).click();
    await expect(tracker.locator("[aria-current='step']")).toContainText("Accept & pay");
    await expect(tracker.getByText("Done: Getting your price")).toBeAttached();
    for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Next step" }).click();
    await expect(tracker.locator("[aria-current='step']")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Next step" })).toBeDisabled();
    await expectNoA11yViolations(page);
  });

  test("M09: the reveal ends on the real numbers, each side seeing only its own", async ({ page }) => {
    await page.goto(url());
    await page.getByRole("button", { name: "Play the price reveal" }).click();
    const section = page.locator("#m09");
    const customer = section.locator("[data-audience='customer']");
    const tradie = section.locator("[data-audience='tradie']");
    await expect(customer.locator("[aria-hidden='true']", { hasText: "$372.00" })).toBeVisible();
    await expect(tradie.locator("[aria-hidden='true']", { hasText: "$259.20" })).toBeVisible();
    await expect(customer).not.toContainText("259.20");
    await expect(tradie).not.toContainText("372.00");
    await expectNoA11yViolations(page);
  });

  test("a truncated pill keeps its full label in a tooltip", async ({ page }) => {
    await page.goto(url());
    await expect(page.locator("#long [title='Paid · Visa ending 4242 · 31 October 2026']")).toBeVisible();
  });
});
