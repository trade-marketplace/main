import { expect, type Page, test } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

// /dev/components/data (#80) is a development-only page. `npm run e2e` runs the production build, where it must be
// a 404. To check the page itself, start `npm run dev` and point these tests at it:
//   E2E_DEV_BASE_URL=http://localhost:3000 npx playwright test tests/e2e/dev-data.spec.ts

test("/dev/components/data is not in production builds", async ({ page }) => {
  test.skip(Boolean(process.env.E2E_DEV_BASE_URL), "checking the dev server instead");
  const response = await page.goto("/dev/components/data");
  expect(response?.status()).toBe(404);
});

const devUrl = process.env.E2E_DEV_BASE_URL;
const url = (query = "") => (devUrl ? new URL(`/dev/components/data${query}`, devUrl).href : "");

/** The big "All jobs" example. */
const jobs = (page: Page) => page.getByRole("table", { name: "All jobs" });
const jobRows = (page: Page) => jobs(page).locator("tbody tr");
const showing = (page: Page) => page.getByRole("navigation", { name: "Jobs", exact: true }).getByRole("status");
/** Its filter bar (the page has other examples with the same chips). */
const filters = (page: Page) => page.getByRole("search", { name: "Filter jobs", exact: true });

/** Sideways scroll on the page, and anything inside the given parts wider than its own box. */
async function overflows(page: Page) {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const spilled = [...document.querySelectorAll<HTMLElement>("main table, main [role=search], main [role=tablist], main nav")]
      .filter((el) => {
        const box = el.getBoundingClientRect();
        return box.left < -1 || box.right > width + 1;
      })
      .map((el) => `${el.tagName} ${el.getAttribute("aria-label") ?? ""}`);
    return { page: document.documentElement.scrollWidth - width, spilled };
  });
}

test.describe("/dev/components/data", () => {
  test.skip(!devUrl, "set E2E_DEV_BASE_URL to a running `npm run dev` to check the dev-only page");

  for (const viewport of VIEWPORTS) {
    test(`${viewport.name} (${viewport.width}px): no axe violations and no sideways scroll`, async ({ browser }) => {
      test.setTimeout(120_000); // three modes of a long page, each checked by axe
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
      const page = await context.newPage();
      for (const mode of ["", "?mode=customer", "?mode=trade"]) {
        await page.goto(url(mode));
        await expect(jobs(page)).toBeVisible();
        expect(await overflows(page), mode || "office").toEqual({ page: 0, spilled: [] });
        await expectNoA11yViolations(page);
      }
      await context.close();
    });
  }

  test("each ?open= menu passes axe and stays on screen", async ({ page }) => {
    for (const [id, name] of [
      ["status-filter", "Status"],
      ["saved-filters", "Saved filters"],
      ["row-menu", /^More for/],
    ] as const) {
      await page.goto(url(`?open=${id}`));
      await expect(page.getByRole("menu", { name }), id).toBeVisible();
      await expectNoA11yViolations(page);
    }
  });

  test("sorting: a header click sorts, a second flips it, and aria-sort and the URL say so", async ({ page }) => {
    await page.goto(url());
    const price = jobs(page).getByRole("columnheader", { name: "Price" });
    await price.getByRole("button").click();
    await expect(price).toHaveAttribute("aria-sort", "descending"); // money starts biggest first
    await expect(page).toHaveURL(/sort=price\.desc/);
    const first = await jobRows(page).first().locator("td").nth(5).textContent();
    await price.getByRole("button").press("Enter");
    await expect(price).toHaveAttribute("aria-sort", "ascending");
    expect(await jobRows(page).first().locator("td").nth(5).textContent()).not.toBe(first);
    // Not-yet-priced jobs go last both ways.
    for (const direction of ["asc", "desc"]) {
      await page.goto(url(`?sort=price.${direction}&page=6`));
      await expect(jobRows(page).last().locator("td").nth(5), direction).toHaveText("—");
    }
  });

  test("ticking rows: the bulk bar counts them, Shift+click ticks a run, select-all and Clear selection", async ({ page }) => {
    await page.goto(url());
    await jobs(page).getByRole("checkbox", { name: "Select Sub wiring" }).check();
    const bar = page.getByRole("region", { name: "Bulk actions for all jobs" });
    await expect(bar).toContainText("1 selected");
    await jobs(page).getByRole("checkbox", { name: "Select Control panel" }).click({ modifiers: ["Shift"] });
    await expect(bar).toContainText("4 selected");
    const all = jobs(page).getByRole("checkbox", { name: "Select all rows on this page" });
    expect(await all.evaluate((el: HTMLInputElement) => el.indeterminate)).toBe(true);
    await all.check();
    await expect(bar).toContainText("25 selected");
    await bar.getByRole("button", { name: "Clear selection" }).click();
    await expect(bar).toBeHidden();
    // The header still sticks to the top while the long list scrolls.
    await page.mouse.wheel(0, 1200);
    const head = jobs(page).locator("thead th").first();
    expect(Math.round((await head.boundingBox())?.y ?? -1)).toBe(0);
  });

  test("filters: a chip's menu works by keyboard, fills the chip, lands in the URL; Clear filters undoes it", async ({ page }) => {
    await page.goto(url());
    const status = filters(page).getByRole("button", { name: "Status: All" });
    await status.focus();
    await page.keyboard.press("ArrowDown");
    const menu = page.getByRole("menu", { name: "Status" });
    await expect(menu.getByRole("menuitemradio", { name: "All" })).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown"); // To price
    await page.keyboard.press("Enter");
    await expect(filters(page).getByRole("button", { name: "Status: To price" })).toBeFocused();
    await expect(page).toHaveURL(/status=price/);
    await expect(showing(page)).toHaveText(/of \d+$/);
    // Every row left is one to price.
    for (const pill of await jobRows(page).locator("td:nth-child(3)").allTextContents()) expect(pill).toBe("To price");
    // The saved filter for this set is now ticked on its chip.
    await expect(filters(page).getByRole("button", { name: "Saved filters: Overdue to price" })).toBeVisible();
    await filters(page).getByRole("button", { name: "Clear filters" }).click();
    await expect(filters(page).getByRole("button", { name: "Status: All" })).toBeVisible();
    await expect(page).not.toHaveURL(/status=/);
  });

  test("search narrows the list; Esc or × clears it; nothing found shows the empty state", async ({ page }) => {
    await page.goto(url());
    const search = filters(page).getByRole("searchbox", { name: "Search jobs" });
    await search.fill("TM-1003");
    await expect(jobRows(page)).toHaveCount(1);
    await expect(page).toHaveURL(/q=TM-1003/);
    await search.press("Escape");
    await expect(search).toHaveValue("");
    await search.fill("zzz nothing");
    await expect(page.getByRole("heading", { name: "No jobs match that." })).toBeVisible();
    await expect(showing(page)).toHaveText("No results");
    await filters(page).getByRole("button", { name: "Clear search" }).click();
    await expect(search).toBeFocused();
    await expect(jobRows(page)).toHaveCount(25);
  });

  test("saving filters: name them in the dialog, then they're ticked under Saved filters", async ({ page }) => {
    await page.goto(url("?region=gore"));
    await filters(page).getByRole("button", { name: "Saved filters" }).click();
    await page.getByRole("menuitem", { name: "Save these filters…" }).click();
    const dialog = page.getByRole("dialog", { name: "Save these filters" });
    await dialog.getByRole("button", { name: "Save filters" }).click();
    await expect(dialog.getByText("Give it a name.")).toBeVisible();
    await dialog.getByRole("textbox", { name: "Name" }).fill("Gore jobs");
    await dialog.getByRole("button", { name: "Save filters" }).click();
    await expect(dialog).toBeHidden();
    await expect(filters(page).getByRole("button", { name: "Saved filters: Gore jobs" })).toBeVisible();
  });

  test("pagination: Next and Previous move 25 at a time, are greyed out at the ends, and keep the page in the URL", async ({ page }) => {
    await page.goto(url());
    const pages = page.getByRole("navigation", { name: "Jobs", exact: true });
    await expect(showing(page)).toHaveText("Showing 1–25 of 128");
    await expect(pages.getByRole("button", { name: "Previous page" })).toHaveAttribute("aria-disabled", "true");
    await pages.getByRole("button", { name: "Next page" }).click();
    await expect(showing(page)).toHaveText("Showing 26–50 of 128");
    await expect(page).toHaveURL(/page=2/);
    await page.goto(url("?page=6"));
    await expect(showing(page)).toHaveText("Showing 126–128 of 128");
    await expect(pages.getByRole("button", { name: "Next page" })).toHaveAttribute("aria-disabled", "true");
  });

  test("a row opens with a click anywhere on it, and then is the tinted, current one", async ({ page }) => {
    await page.goto(url());
    await jobRows(page).nth(1).locator("td").nth(3).click(); // the Customer cell, not the link
    await expect(page).toHaveURL(/active=job-2/);
    await expect(jobRows(page).nth(1)).toHaveAttribute("aria-current", "true");
    await expect(jobs(page).getByRole("link", { name: "Switchboard upgrade" })).toHaveAttribute("aria-current", "page");
    // Ticking a box or opening the ⋯ menu doesn't open the row.
    await jobs(page).getByRole("checkbox", { name: "Select Kitchen tap leaking" }).check();
    await jobs(page).getByRole("button", { name: "More for Kitchen tap leaking" }).click();
    await expect(page).toHaveURL(/active=job-2/);
  });

  test("opening a row keeps the list as it is now: filters and sort chosen after the page loaded stay", async ({ page }) => {
    await page.goto(url());
    await filters(page).getByRole("button", { name: "Region: All" }).click();
    await page.getByRole("menuitemradio", { name: "Invercargill" }).click();
    await jobs(page).getByRole("columnheader", { name: "Customer" }).getByRole("button").click();
    await expect(page).toHaveURL(/region=invercargill.*sort=customer\.asc|sort=customer\.asc.*region=invercargill/);
    await jobRows(page).first().locator("td").nth(4).click();
    await expect(page).toHaveURL(/active=/);
    await expect(page).toHaveURL(/region=invercargill/);
    await expect(page).toHaveURL(/sort=customer\.asc/);
  });

  test("tabs and segmented controls: arrows move and choose, Home/End jump, Tab goes into the panel", async ({ page }) => {
    await page.goto(url());
    const tradies = page.getByRole("tablist", { name: "Tradies" });
    await tradies.getByRole("tab", { name: "To check (3)" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(tradies.getByRole("tab", { name: "Verified (41)" })).toBeFocused();
    await expect(tradies.getByRole("tab", { name: "Verified (41)" })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("End");
    await expect(tradies.getByRole("tab", { name: "Paused (1)" })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowRight"); // wraps
    await expect(tradies.getByRole("tab", { name: "To check (3)" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("tabpanel", { name: "To check (3)" })).toBeFocused();

    // The underline sits under the chosen tab.
    await tradies.getByRole("tab", { name: "Paused (1)" }).click();
    await page.waitForTimeout(300);
    const tab = await tradies.getByRole("tab", { name: "Paused (1)" }).boundingBox();
    const bar = await tradies.locator("[data-tab-indicator]").boundingBox();
    expect(Math.abs((bar?.x ?? 0) - (tab?.x ?? 0))).toBeLessThan(2);
    expect(Math.abs((bar?.width ?? 0) - (tab?.width ?? 0))).toBeLessThan(2);

    const myJobs = page.getByRole("tablist", { name: "My jobs" });
    await myJobs.getByRole("tab", { name: "Active (3)" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(myJobs.getByRole("tab", { name: "Done (8)" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel", { name: "Done (8)" })).toContainText("Finished jobs");
  });

  test("many tabs on a narrow screen: the bar scrolls by itself, the page doesn't", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(url());
    const list = page.getByRole("tablist", { name: "Queues on a phone" });
    await list.scrollIntoViewIfNeeded();
    // The chosen tab (4th of 5) has been scrolled into the bar's own view.
    const where = () =>
      list.evaluate((el) => {
        const bar = el.getBoundingClientRect();
        const tab = el.querySelector('[aria-selected="true"]')!.getBoundingClientRect();
        return { scrolled: el.scrollLeft > 0, inside: tab.left >= bar.left - 1 && tab.right <= bar.right + 1 };
      });
    await expect.poll(where).toEqual({ scrolled: true, inside: true }); // once the page has hydrated
    expect(await overflows(page)).toEqual({ page: 0, spilled: [] });
  });

  test("on a phone the table is cards, with Select all and a Sort menu instead of headers", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url());
    // The headers are out of sight but still name each column for screen readers; their controls step aside.
    await expect(jobs(page).getByRole("columnheader", { name: "Customer" })).toHaveCount(1);
    expect(await jobs(page).locator("thead button, thead input").count()).toBeGreaterThan(0);
    for (const control of await jobs(page).locator("thead button, thead input").all()) await expect(control).toBeHidden();
    await expect(jobRows(page).first().locator("td[data-label=Customer]")).toBeVisible();
    await page.getByRole("button", { name: /^Sort:/ }).first().click();
    await expect(page.getByRole("menu", { name: "Sort by" })).toBeVisible();
    await page.getByRole("menuitemradio", { name: "Price: Highest first" }).click();
    await expect(page).toHaveURL(/sort=price\.desc/);
    await page.getByText("Select all").first().click();
    await expect(page.getByRole("region", { name: "Bulk actions for all jobs" })).toContainText("25 selected");
  });

  test("still usable at 200% zoom: no sideways scroll, menus and the last button reachable", async ({ browser }) => {
    // A 1280 × 800 window at 200% is a 640 × 400 page drawn at twice the size.
    const context = await browser.newContext({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    await page.goto(url());
    await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
    expect(await overflows(page)).toEqual({ page: 0, spilled: [] });
    await filters(page).getByRole("button", { name: "Status: All" }).click();
    await expect(page.getByRole("menu", { name: "Status" })).toBeInViewport();
    await page.keyboard.press("Escape");
    const next = page.getByRole("navigation", { name: "Jobs", exact: true }).getByRole("button", { name: "Next page" });
    await next.scrollIntoViewIfNeeded();
    await next.click();
    await expect(showing(page)).toHaveText("Showing 26–50 of 128");
    await context.close();
  });

  test("reduced motion: the tab underline and the segmented thumb jump instead of sliding", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto(url());
    // "0s", or the 0.01ms the global reduced-motion rule uses: either way nothing visibly slides.
    const seconds = (el: Element) => parseFloat(getComputedStyle(el).transitionDuration);
    const thumb = page.getByRole("tablist", { name: "My jobs" }).locator("span").first();
    expect(await thumb.evaluate(seconds)).toBeLessThan(0.001);
    const bar = page.getByRole("tablist", { name: "Tradies" }).locator("[data-tab-indicator]");
    expect(await bar.evaluate(seconds)).toBeLessThan(0.001);
    await context.close();
  });
});
