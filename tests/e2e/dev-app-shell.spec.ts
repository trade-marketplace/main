import { expect, type Page, test } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

// /dev/components/app-shell (#84) is a development-only page. `npm run e2e` runs the production build, where it
// must be a 404. To check the page itself, start `npm run dev` and point these tests at it:
//   E2E_DEV_BASE_URL=http://localhost:3000 npx playwright test tests/e2e/dev-app-shell.spec.ts

test("/dev/components/app-shell is not in production builds", async ({ page }) => {
  test.skip(Boolean(process.env.E2E_DEV_BASE_URL), "checking the dev server instead");
  const response = await page.goto("/dev/components/app-shell");
  expect(response?.status()).toBe(404);
});

const devUrl = process.env.E2E_DEV_BASE_URL;
const url = (query = "") => (devUrl ? new URL(`/dev/components/app-shell${query}`, devUrl).href : "");

const topNav = (page: Page) => page.locator("header").getByRole("navigation", { name: "Main" });
const bottomNav = (page: Page) => page.locator("body > div nav[aria-label='Main']").last();

/** The menu's items by their accessible names (the icons are hidden from screen readers). */
async function itemNames(page: Page) {
  const items = await page.getByRole("menu").getByRole("menuitem").all();
  return Promise.all(items.map((item) => item.evaluate((el) => el.textContent?.replace(el.querySelector("[aria-hidden=true]")?.textContent ?? "", "").trim())));
}

/** Where the sliding bar is, and the box it should line up with. */
async function barAndTarget(page: Page, where: "top" | "bottom") {
  const list = where === "top" ? topNav(page) : bottomNav(page);
  return list.evaluate((nav) => {
    const bar = nav.querySelector<HTMLElement>("[data-tab-indicator]")!.getBoundingClientRect();
    const target = nav.querySelector<HTMLElement>('[aria-current="page"] [data-tab-target]')!.getBoundingClientRect();
    return { bar: { left: bar.left, width: bar.width }, target: { left: target.left, width: target.width } };
  });
}

test.describe("/dev/components/app-shell", () => {
  test.skip(!devUrl, "set E2E_DEV_BASE_URL to a running `npm run dev` to check the dev-only page");

  for (const viewport of VIEWPORTS) {
    test(`${viewport.name} (${viewport.width}px): no axe violations, no sideways scroll, the right nav`, async ({ browser }) => {
      test.setTimeout(120_000);
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
      const page = await context.newPage();
      const wide = viewport.width >= 1024;
      for (const query of ["", "?viewer=tradie", "?viewer=long&counts=many", "?viewer=first-only&menu=open"]) {
        await page.goto(url(query));
        await expect(page.getByRole("heading", { name: "App navigation" })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), query).toBe(0);
        await expect(topNav(page)).toBeVisible({ visible: wide });
        await expect(bottomNav(page)).toBeVisible({ visible: !wide });
        await expectNoA11yViolations(page);
      }
      await context.close();
    });
  }

  test("the skip link is the first thing Tab reaches and jumps past the nav", async ({ page }) => {
    await page.goto(url());
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(page.locator("main#main")).toBeFocused();
  });

  test("computer: the current tab's bar slides to the tab you pick (M16)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url());
    const nav = topNav(page);
    await expect(nav.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    const linedUp = async () => {
      const { bar, target } = await barAndTarget(page, "top");
      return Math.abs(bar.left - target.left) < 1 && Math.abs(bar.width - target.width) < 1 && target.width > 0;
    };
    await expect.poll(linedUp).toBe(true);

    await nav.getByRole("link", { name: "My jobs" }).click();
    await expect(page).toHaveURL(/at=%2Fdashboard/);
    await expect(nav.getByRole("link", { name: "My jobs" })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current", "page");
    await expect.poll(linedUp).toBe(true);
  });

  test("phone: the bar sits over the current icon and moves with it", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url("?viewer=tradie"));
    const nav = bottomNav(page);
    await expect(nav.getByRole("link", { name: "Find work" })).toHaveAttribute("aria-current", "page");
    await nav.getByRole("link", { name: "All jobs" }).click();
    await expect(page).toHaveURL(/at=%2Fjobs%3Fview%3Dall/);
    await expect(nav.getByRole("link", { name: "All jobs" })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Find work" })).not.toHaveAttribute("aria-current", "page");
    await expect.poll(async () => {
      const { bar, target } = await barAndTarget(page, "bottom");
      return Math.round(bar.left - target.left) + Math.round(bar.width - 28);
    }).toBe(0);
  });

  test("phone: the end of the page is never hidden behind the bottom bar", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url());
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const last = page.getByText("The end of the page: never hidden behind the bottom bar.");
    const lastBox = (await last.boundingBox())!;
    const navBox = (await bottomNav(page).boundingBox())!;
    expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(navBox.y);
    expect(navBox.y + navBox.height).toBeCloseTo(844, 0);
    expect(navBox.height).toBeGreaterThanOrEqual(64);
  });

  test("phone: icons are named, with the unread count, and each is a big enough target", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(url());
    const nav = bottomNav(page);
    for (const name of ["Home", "Post a job", "My jobs", "Messages, 1 unread", "Account"]) {
      const link = nav.getByRole("link", { name, exact: true });
      await expect(link).toBeVisible();
      const box = (await link.boundingBox())!;
      expect(box.width, name).toBeGreaterThanOrEqual(44);
      expect(box.height, name).toBeGreaterThanOrEqual(44);
    }
  });

  test("a new message or notification pops the badge (M20); reading them takes it away", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url());
    const bell = page.getByRole("button", { name: /^Notifications/ });
    await expect(bell).toHaveAccessibleName("Notifications, 2 unread");
    await page.getByRole("button", { name: "New notification" }).click();
    await expect(bell).toHaveAccessibleName("Notifications, 3 unread");
    await expect(bell.locator("[aria-hidden=true]").last()).toHaveClass(/tm-anim-badge/);
    await expect(bell.locator("[aria-hidden=true]").last()).toHaveText("3");
    await page.getByRole("button", { name: "Read everything" }).click();
    await expect(bell).toHaveAccessibleName("Notifications");
    await expect(topNav(page).getByRole("link", { name: "Messages", exact: true })).toBeVisible();
  });

  test("the avatar menu works by keyboard and logs out with a form", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url());
    const avatar = page.getByRole("button", { name: "Account: Sarah Thompson" });
    await avatar.focus();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(page.locator("header").first()).toContainText("sarah@email.co.nz");
    await expect(menu).toHaveAccessibleDescription(/Sarah Thompson/);
    expect(await itemNames(page)).toEqual(["Account", "Payments", "Notification settings", "Help", "Log out"]);
    await expect(menu.getByRole("menuitem", { name: "Account" })).toBeFocused();
    await page.keyboard.press("End");
    await expect(menu.getByRole("menuitem", { name: "Log out" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(avatar).toBeFocused();
  });

  test("a tradie's menu has no Payments, and their nav has the Tradie flag and no Post a job", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url("?viewer=tradie&menu=open"));
    await expect(page.getByRole("menu")).toBeVisible();
    expect(await itemNames(page)).toEqual(["Account", "Notification settings", "Help", "Log out"]);
    await expect(page.locator("header").first()).toContainText("Tradie");
    await expect(page.locator("header").getByRole("link", { name: "Post a job" })).toHaveCount(0);
  });

  test("pages outside the nav mark no tab, and full-screen flows drop the bottom bar", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url("?at=/notifications"));
    await expect(bottomNav(page).locator('[aria-current="page"]')).toHaveCount(0);
    await expect(bottomNav(page).locator("[data-tab-indicator]")).toBeHidden();
    await page.goto(url("?at=/jobs/new"));
    await expect(page.getByRole("heading", { name: "App navigation" })).toBeVisible();
    await expect(page.getByRole("link", { name: "My jobs" })).toHaveCount(0);
  });

  test("the test-mode banner shows until payments are live", async ({ page }) => {
    await page.goto(url());
    await expect(page.getByText("Test mode.")).toBeVisible();
    await page.goto(url("?test=off"));
    await expect(page.getByText("Test mode.")).toHaveCount(0);
  });

  test("200% text: the computer's nav still fits without sideways scroll", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url("?viewer=tradie&counts=many"));
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  });
});
