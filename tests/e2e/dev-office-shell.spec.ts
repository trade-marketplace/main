import { expect, type Page, test } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

// The shell's fake viewer is reachable only through guardDevPage(). Run its browser checks against Next dev:
// E2E_DEV_BASE_URL=http://127.0.0.1:3000 npx playwright test tests/e2e/dev-office-shell.spec.ts
const devUrl = process.env.E2E_DEV_BASE_URL;
const url = (query = "") => (devUrl ? new URL(`/dev/components/office-shell${query}`, devUrl).href : "");
const officeNav = (page: Page) => page.getByRole("navigation", { name: "Office", exact: true });
const menuButton = (page: Page) => page.getByRole("button", { name: "Office menu", exact: true });
const navNames = ["Queues", "All jobs", "Tradies", "Customers", "Payouts", "Payments", "Reviews", "Support", "Settings"];

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
}

test("/dev/components/office-shell is a 404 in production", async ({ page }) => {
  test.skip(Boolean(devUrl), "checking the development server instead");
  const response = await page.goto("/dev/components/office-shell");
  expect(response?.status()).toBe(404);
});

test.describe("/dev/components/office-shell", () => {
  test.skip(!devUrl, "set E2E_DEV_BASE_URL to a running npx next dev server");

  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: all states have no axe violations or sideways scroll`, async ({ browser }) => {
      test.setTimeout(180_000);
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
      const page = await context.newPage();
      const desktop = viewport.width >= 1024;
      for (const query of [
        "",
        "?counts=none",
        "?counts=many&at=/admin/tradies",
        "?menu=open",
        "?account=open&name=long",
        "?test=off&name=long",
      ]) {
        // These counts live inside the collapsed menu on phones/tablets. Open it so axe and the overflow
        // check inspect the actual zero/99+ navigation states rather than an unchanged, closed top bar.
        const countState = query.startsWith("?counts=");
        const shownQuery = !desktop && countState ? `${query}&menu=open` : query;
        await page.goto(url(shownQuery));
        await expect(page.getByRole("heading", { name: "Office shell", exact: true })).toBeVisible();
        await noOverflow(page);
        await expect(menuButton(page)).toBeVisible({ visible: !desktop });
        if (desktop) {
          await expect(officeNav(page)).toBeVisible();
          await expect(officeNav(page).getByRole("link")).toHaveCount(9);
          if (query.startsWith("?counts=many")) {
            await expect(officeNav(page).getByRole("link", { name: /waiting/ })).toHaveCount(3);
            for (const name of ["All jobs", "Customers", "Payouts", "Payments", "Reviews", "Settings"]) {
              await expect(officeNav(page).getByRole("link", { name, exact: true })).not.toContainText(/\d/);
            }
          }
        }
        if (desktop && query === "?account=open&name=long") {
          const accountMenu = page.getByRole("menu", { name: "Account", exact: true });
          await expect(accountMenu.locator("..")).toBeInViewport({ ratio: 1 });
          await expect(accountMenu.getByRole("menuitem", { name: "Log out", exact: true })).toBeInViewport({ ratio: 1 });
          expect(await page.evaluate(() => window.scrollY)).toBe(0);
        }
        if (!desktop && (query === "?menu=open" || countState)) {
          const menu = page.getByRole("menu", { name: "Office" });
          await expect(menu).toBeVisible();
          if (query.startsWith("?counts=many")) {
            const tradies = menu.getByRole("menuitem", { name: /^Tradies\s*, 99\+ waiting$/ });
            await expect(tradies).toBeVisible();
            await expect(tradies).toHaveAttribute("aria-current", "page");
            await expect(tradies.getByText("99+", { exact: true })).toBeVisible();
            await expect(menu.getByRole("menuitem", { name: /waiting/ })).toHaveCount(3);
            for (const name of ["All jobs", "Customers", "Payouts", "Payments", "Reviews", "Settings"]) {
              await expect(menu.getByRole("menuitem", { name, exact: true })).not.toContainText(/\d/);
            }
          } else if (query === "?counts=none") {
            await expect(menu.getByRole("menuitem", { name: /waiting/ })).toHaveCount(0);
          }
        }
        await expectNoA11yViolations(page);
      }
      await context.close();
    });
  }

  for (const width of [390, 1440]) {
    test(`${width}px: the skip link is first in the tab order and focuses main`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(url());
      await page.keyboard.press("Tab");
      const skip = page.getByRole("link", { name: "Skip to content" });
      await expect(skip).toBeFocused();
      await expect(skip).toBeInViewport();
      await page.keyboard.press("Enter");
      await expect(page.locator("main#main")).toBeFocused();
      await expect(page.getByRole("heading", { name: "Office shell", exact: true })).toBeInViewport();
    });
  }

  test("the phone menu opens with the keyboard, supports navigation keys and returns focus on Esc", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url("?counts=none"));
    const button = menuButton(page);
    await button.focus();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu", { name: "Office" });
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(menu).toBeVisible();
    const items = menu.getByRole("menuitem");
    await expect(items).toHaveCount(9);
    for (const [index, name] of navNames.entries()) await expect(items.nth(index)).toHaveAccessibleName(name);
    const firstItem = menu.getByRole("menuitem", { name: "Queues", exact: true });
    await expect(firstItem).toBeFocused();
    // The menu is a scrolling container. An outward ring on its first row is clipped at the top and sides.
    const focusRing = await firstItem.evaluate((element) => {
      const style = getComputedStyle(element);
      return { width: parseFloat(style.outlineWidth), offset: parseFloat(style.outlineOffset), style: style.outlineStyle };
    });
    expect(focusRing.style).toBe("solid");
    expect(focusRing.width).toBeGreaterThanOrEqual(2);
    expect(focusRing.offset).toBeLessThanOrEqual(-focusRing.width);
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", { name: "All jobs", exact: true })).toBeFocused();
    await page.keyboard.press("End");
    await expect(menu.getByRole("menuitem", { name: "Settings", exact: true })).toBeFocused();
    await page.keyboard.press("Home");
    await expect(menu.getByRole("menuitem", { name: "Queues", exact: true })).toBeFocused();
    await expectNoA11yViolations(page);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(button).toBeFocused();
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Space");
    await expect(menu).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(menu).toBeHidden();
  });

  test("the phone menu navigates while preserving the preview and its selected state", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url("?counts=none"));
    await menuButton(page).focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    const jobs = page.getByRole("menuitem", { name: "All jobs", exact: true });
    await expect(jobs).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/at=%2Fadmin%2Fjobs/);
    await expect(page.getByRole("menu", { name: "Office" })).toBeHidden();
    await menuButton(page).click();
    await expect(page.getByRole("menuitem", { name: "All jobs", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page).toHaveTitle(/Office shell/);
    await expectNoA11yViolations(page);
  });

  test("the desktop sidebar is 240px, selects nested pages and moves its M16 indicator", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url("?counts=none&at=/admin/jobs/TM-1005"));
    const nav = officeNav(page);
    await expect(nav.getByRole("link", { name: "All jobs", exact: true })).toHaveAttribute("aria-current", "page");
    const firstIcon = nav.getByRole("link").first().locator('span[aria-hidden="true"][translate="no"]');
    await expect(firstIcon).toHaveCSS("font-size", "21px");
    const aligned = async () => nav.evaluate((element) => {
      const bar = element.querySelector<HTMLElement>("[data-tab-indicator]")?.getBoundingClientRect();
      const target = element.querySelector<HTMLElement>('[aria-current="page"]')?.getBoundingClientRect();
      return Boolean(bar && target && bar.height > 0 && Math.abs(bar.top - target.top) < 1 && Math.abs(bar.height - target.height) < 1);
    });
    await expect.poll(aligned).toBe(true);
    await nav.getByRole("link", { name: "Tradies", exact: true }).click();
    await expect(page).toHaveURL(/at=%2Fadmin%2Ftradies/);
    await expect(nav.getByRole("link", { name: "Tradies", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "All jobs", exact: true })).not.toHaveAttribute("aria-current", "page");
    await expect.poll(aligned).toBe(true);
    const sidebarWidth = await nav.evaluate((element) => element.closest("aside")?.getBoundingClientRect().width);
    expect(sidebarWidth).toBe(240);
    await page.goto(url("?counts=none&at=/admin/jobs/TM-1005/price"));
    await expect(nav.getByRole("link", { name: "Queues", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "All jobs", exact: true })).not.toHaveAttribute("aria-current", "page");
    await expect.poll(aligned).toBe(true);
    await expectNoA11yViolations(page);
  });

  for (const width of [390, 1440]) {
    test(`${width}px: the avatar menu has only Help and Log out and restores keyboard focus`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(url());
      const avatar = page.getByRole("button", { name: /^Account:/ });
      await avatar.focus();
      await page.keyboard.press("Enter");
      const menu = page.getByRole("menu", { name: "Account", exact: true });
      await expect(menu).toBeVisible();
      const items = menu.getByRole("menuitem");
      await expect(items).toHaveCount(2);
      for (const [index, name] of ["Help", "Log out"].entries()) await expect(items.nth(index)).toHaveAccessibleName(name);
      await expect(menu.getByRole("menuitem", { name: "Account", exact: true })).toHaveCount(0);
      await expect(menu.locator('a[href="/profile"], a[href="/admin/settings"]')).toHaveCount(0);
      await expect(items.first()).toBeFocused();
      if (width === 1440) {
        await expect(menu.locator("..")).toBeInViewport({ ratio: 1 });
        await expect(menu.getByRole("menuitem", { name: "Log out", exact: true })).toBeInViewport({ ratio: 1 });
        expect(await page.evaluate(() => window.scrollY)).toBe(0);
      }
      await page.keyboard.press("End");
      await expect(menu.getByRole("menuitem", { name: "Log out", exact: true })).toBeFocused();
      await expectNoA11yViolations(page);
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
      await expect(avatar).toBeFocused();
      await expect(page.locator('a[href*="logout"], a[href*="log-out"]')).toHaveCount(0);
    });
  }

  test("test mode can be shown and hidden and counts display none, some and 99+", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url("?counts=none"));
    await expect(page.getByText("Test mode.")).toBeVisible();
    await expect(officeNav(page).getByRole("link", { name: /waiting/ })).toHaveCount(0);
    await page.goto(url("?counts=some"));
    await expect(officeNav(page).getByRole("link", { name: /Queues, \d+ waiting/ })).toBeVisible();
    await expect(officeNav(page).getByRole("link", { name: /waiting/ })).toHaveCount(3);
    await page.goto(url("?counts=many&test=off"));
    await expect(page.getByText("Test mode.")).toHaveCount(0);
    await expect(officeNav(page).getByRole("link", { name: "Queues, 99+ waiting", exact: true })).toBeVisible();
    await expect(officeNav(page).getByRole("link", { name: /waiting/ })).toHaveCount(3);
    await noOverflow(page);
    await expectNoA11yViolations(page);
  });

  test("200% text and a long name fit at both widths", async ({ page }) => {
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(url("?name=long&counts=many&account=open"));
      await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
      await noOverflow(page);
      await expectNoA11yViolations(page);
    }
  });

  test("on a long page the sidebar, its links and the avatar stay in view, and the phone bar stays on top", async ({ page }) => {
    // After hydration: content added before it would be thrown away when React takes over the page.
    const makeLong = async () => {
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => {
        const filler = document.createElement("div");
        filler.style.height = "4000px";
        filler.textContent = "Long page";
        document.querySelector("main")!.append(filler);
        window.scrollTo(0, document.documentElement.scrollHeight);
      });
    };

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url());
    await makeLong();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(3000);
    await expect(officeNav(page).getByRole("link", { name: /^Queues/ })).toBeInViewport();
    await expect(officeNav(page).getByRole("link", { name: "Settings", exact: true })).toBeInViewport();
    await expect(page.locator("aside").getByRole("button", { name: /^Account:/ })).toBeInViewport();
    await noOverflow(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url());
    await makeLong();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(3000);
    await expect(menuButton(page)).toBeInViewport();
    await noOverflow(page);
  });

  test("before scrolling, the avatar is on screen even with the test-mode banner (short windows scroll the links)", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 600 });
    await page.goto(url());
    await expect(page.getByText("Test mode.")).toBeVisible();
    await expect(page.locator("aside").getByRole("button", { name: /^Account:/ })).toBeInViewport({ ratio: 1 });
    await expect(officeNav(page).getByRole("link", { name: /^Queues/ })).toBeInViewport();
  });
});
