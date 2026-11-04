import { expect, test } from "@playwright/test";
import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const app = process.env.E2E_DEV_BASE_URL;
const states = ["price", "extra", "cancel", "signoff", "unclaimed", "all-clear", "loading", "error", "offline", "search", "search-empty", "long"];
const href = (state = "price") => new URL(`/dev/components/office-queues?state=${state}`, app!).href;

test("office queue previews are guarded in production", async ({ page }) => {
  test.skip(Boolean(app), "preview run");
  expect((await page.goto("/dev/components/office-queues"))?.status()).toBe(404);
});
test.describe("office queue preview states", () => {
  test.skip(!app, "Set E2E_DEV_BASE_URL for guarded previews");
  test.use({ reducedMotion: "reduce" });
  for (const viewport of VIEWPORTS) test(`${viewport.width}px: all queue/loading/empty/error/offline/search/long states fit and pass axe`, async ({ page }) => {
    test.setTimeout(240_000); await page.setViewportSize(viewport);
    for (const state of states) {
      await page.goto(href(state));
      await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), state).toBe(0);
      await expectNoA11yViolations(page);
      if (state === "all-clear") await expect(page.getByRole("heading", { name: "All clear", exact: true })).toBeVisible();
      if (state === "error") await expect(page.getByRole("heading", { name: "Can’t load jobs", exact: true })).toBeVisible();
      if (state === "search-empty") await expect(page.getByRole("heading", { name: "No jobs match that.", exact: true })).toBeVisible();
    }
  });
  test("phone and desktop KPI copy match their own mockups and accessible names", async ({ page }) => {
    for (const { width } of VIEWPORTS) {
      await page.setViewportSize({ width, height: 900 }); await page.goto(href());
      const totals = page.getByRole("group", { name: "Queue totals" });
      for (const [phone, desktop] of [["Extra work to price", "Extra work"], ["Cancel requests", "Cancellations"], ["Waiting sign-off", "Sign-off"]]) {
        const visible = width < 600 ? phone : desktop, hidden = width < 600 ? desktop : phone;
        await expect(totals.getByRole("button", { name: new RegExp(`^${visible} [0-9]`) })).toBeVisible();
        await expect(totals.getByRole("button", { name: new RegExp(`^${hidden} [0-9]`) })).toHaveCount(0);
        await expect(totals.getByText(visible, { exact: true })).toBeVisible();
        await expect(totals.getByText(hidden, { exact: true })).toBeHidden();
      }
      for (const [phone, desktop, count, detail, status] of [
        ["To price", "To price", 4, "oldest 26h", "Needs you"],
        ["Extra work to price", "Extra work", 2, "oldest 3h", "Needs you"],
        ["Cancel requests", "Cancellations", 1, "new", "Needs you"],
        ["Waiting sign-off", "Sign-off", 3, "2 auto-release today", "Waiting"],
        ["Unclaimed > 48h", "Unclaimed > 48h", 1, "Richmond", "Needs you"],
      ] as const) {
        await expect(totals.getByRole("button", { name: `${width < 600 ? phone : desktop} ${count} ${width < 600 ? status : detail}`, exact: true })).toBeVisible();
      }
      if (width < 600) await expect(totals.getByText("Richmond", { exact: true })).toBeHidden();
      else await expect(totals.getByText("Richmond", { exact: true })).toBeVisible();
      await expect(page.getByRole("tab", { name: "Extra work (2)", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      await expectNoA11yViolations(page);
      await page.goto(href("all-clear"));
      await expect(page.getByRole("group", { name: "Queue totals" }).getByText("Needs you", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("group", { name: "Queue totals" }).getByText("Waiting", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("group", { name: "Queue totals" }).getByRole("button", { name: "Unclaimed > 48h 0 —", exact: true })).toBeVisible();
      await expectNoA11yViolations(page);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    for (const state of ["loading", "error"]) {
      await page.goto(href(state));
      const totals = page.getByRole("group", { name: "Queue totals" });
      await expect(totals.getByText("Needs you", { exact: true })).toHaveCount(0);
      await expect(totals.getByText("Waiting", { exact: true })).toHaveCount(0);
    }
  });
  test("KPI and keyboard tabs keep counts and URL aligned; Back restores state; / ignores form fields and menus", async ({ page }) => {
    await page.goto(href());
    const totals = page.getByRole("group", { name: "Queue totals" });
    await totals.getByRole("button", { name: /Extra work/ }).click();
    await expect(page.getByRole("tab", { name: "Extra work (2)", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(/tab=extra/); await expect(page.getByRole("table", { name: "Extra work", exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Extra work (2)", exact: true }).press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Cancellations (1)", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.goBack(); await expect(page.getByRole("tab", { name: "Extra work (2)", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.locator("h1").click(); await page.keyboard.press("/");
    const search = page.getByRole("searchbox", { name: "Search jobs and people" });
    await expect(search).toBeFocused(); await search.fill("Sarah"); await search.press("/"); await expect(search).toHaveValue("Sarah/");
    await search.fill(""); await search.press("Escape");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Office menu", exact: true }).click();
    await page.keyboard.press("/"); await expect(search).not.toBeFocused();
    await page.keyboard.press("Escape"); await expect(page.getByRole("button", { name: "Office menu", exact: true })).toBeFocused();
  });
  test("search empty can clear, all-clear remains empty when switching tabs, and offline row actions cannot navigate", async ({ page }) => {
    await page.goto(href("search-empty"));
    await page.getByRole("button", { name: "Clear search", exact: true }).last().click();
    await expect(page.getByRole("table", { name: "To price", exact: true })).toBeVisible();
    await page.goto(href("all-clear")); await page.getByRole("tab", { name: "Extra work (0)", exact: true }).click();
    await expect(page.getByRole("heading", { name: "All clear", exact: true })).toBeVisible();
    await page.goto(href("offline"));
    await page.getByRole("tab", { name: "To price (4)", exact: true }).focus();
    await expect(page.getByRole("tab", { name: "To price (4)", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "To price (4)", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("button", { name: "Price it", exact: true }).first()).toHaveAttribute("aria-disabled", "true");
    expect(await page.getByRole("table", { name: "To price", exact: true }).getByRole("link").count()).toBe(0);
  });
  test("a pending search cannot reappear after a rapid KPI/tab switch, and Problems always has a rendered target", async ({ page }) => {
    await page.goto(href());
    await page.clock.install();
    const search = page.getByRole("searchbox", { name: "Search jobs and people" });
    for (const via of ["card", "tab"]) {
      await search.fill(`pending-${via}`);
      if (via === "card") await page.getByRole("group", { name: "Queue totals" }).getByRole("button", { name: /Extra work/ }).click();
      else await page.getByRole("tab", { name: "Cancellations (1)", exact: true }).click();
      await expect(search).toHaveValue("");
      await expect(page.getByRole("table", { name: via === "card" ? "Extra work" : "Cancellations", exact: true })).toBeVisible();
      // Wait beyond the actual debounce interval to prove the cancelled callback cannot restore the old query.
      await page.clock.runFor(350);
      expect(new URL(page.url()).searchParams.has("q")).toBe(false);
    }
    await page.goto(href("search")); await expect(page.getByRole("link", { name: "Problems (1)", exact: true })).toHaveCount(0);
    await page.goto(href()); await page.getByRole("link", { name: "Problems (1)", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Problems (1)", exact: true })).toBeInViewport();
  });
});
