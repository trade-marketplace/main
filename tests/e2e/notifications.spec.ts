import { expect, type Page, test } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const dev = process.env.E2E_DEV_BASE_URL;
const url = (state = "unread", query = "") => new URL(`/dev/components/notifications?state=${state}${query}`, dev).href;
const panel = (page: Page) => page.getByRole("menu", { name: "Notifications", exact: true });
const bell = (page: Page) => page.getByRole("button", { name: /^Notifications/ });
const rows = (page: Page) => panel(page).getByRole("menuitem").filter({ has: page.locator("time") });
async function openFixture(page: Page, state = "unread", query = "") {
  await page.goto(url(state, query));
  // Default-open markup exists before hydration. The menu's initial focus proves its handlers are ready.
  await expect.poll(() => panel(page).evaluate((el) => el.contains(document.activeElement))).toBe(true);
}

test("notification fixtures are unavailable on production deployments", async ({ page }) => {
  test.skip(Boolean(dev), "checking local fixtures instead");
  expect((await page.goto("/dev/components/notifications"))?.status()).toBe(404);
});

test.describe("notification bell", () => {
  test.skip(!dev, "set E2E_DEV_BASE_URL for guarded local role fixtures");
  test.use({ reducedMotion: "reduce" });

  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: every state fits and passes axe`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize(viewport);
      for (const state of ["unread", "read", "empty", "loading", "error", "many", "long", "saving"]) {
        await openFixture(page, state);
        await expect(panel(page)).toBeVisible();
        await expect.poll(() => panel(page).evaluate((el) => {
          const b = el.getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth && b.bottom <= innerHeight;
        }), state).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), state).toBe(0);
        await expectNoA11yViolations(page);
      }
    });
  }

  test("empty means an icon and two words; loading has no explanation", async ({ page }) => {
    await openFixture(page, "empty");
    await expect(page.getByRole("status")).toContainText("No notifications");
    expect((await panel(page).locator("p").innerText()).trim().split(/\s+/)).toHaveLength(2);
    expect(await rows(page).count()).toBe(0);
    await openFixture(page, "loading");
    await expect(page.getByRole("status")).toContainText("Loading notifications");
    await expect(panel(page).getByText(/wait|loading|please/i)).toHaveCount(0);
  });

  test("rows use one short line plus time; long user text keeps its full accessible name", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openFixture(page, "long");
    const row = rows(page).first();
    await expect(row).toHaveAccessibleName(/the unusually long shared driveway/);
    const line = row.locator("time").locator("..").locator("span").first();
    await expect(line).toHaveCSS("white-space", "nowrap");
    await expect(line).toHaveCSS("text-overflow", "ellipsis");
    expect(await line.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await expect(row.getByRole("img", { name: "Unread" })).toBeVisible();
  });

  test("latest eight remain scrollable while the badge includes unread rows beyond the panel", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await openFixture(page, "many");
    await expect(rows(page)).toHaveCount(8);
    await expect(bell(page)).toHaveAccessibleName("Notifications, 12 unread");
    await rows(page).last().scrollIntoViewIfNeeded();
    await expect(rows(page).last()).toBeInViewport();
    await expect(panel(page).getByRole("menuitem", { name: "See all notifications" })).toBeInViewport();
  });

  test("keyboard opens, moves through items, closes with Escape and restores the bell", async ({ page }) => {
    await openFixture(page);
    await page.keyboard.press("Escape");
    await expect(panel(page)).toBeHidden();
    await expect(bell(page)).toBeFocused();
    await bell(page).press("ArrowDown");
    await expect(panel(page).getByRole("menuitem", { name: "Mark all read" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rows(page).first()).toBeFocused();
    await page.keyboard.press("End");
    await expect(panel(page).getByRole("menuitem", { name: "See all notifications" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(bell(page)).toBeFocused();
  });

  test("mark all read waits for the save, clears the badge and keeps the panel open", async ({ page }) => {
    await openFixture(page);
    await panel(page).getByRole("menuitem", { name: "Mark all read" }).click();
    await expect(rows(page).first().locator("..")).toHaveAttribute("aria-busy", "true");
    await expect(bell(page)).toHaveAccessibleName("Notifications");
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).getByRole("img", { name: "Unread" })).toHaveCount(0);
    await expect(rows(page).first()).toBeFocused();
  });

  test("a row waits for read confirmation before following its exact job destination", async ({ page }) => {
    await openFixture(page);
    await rows(page).first().click();
    await expect(rows(page).first()).toHaveAttribute("aria-disabled", "true");
    expect(new URL(page.url()).pathname).toBe("/dev/components/notifications");
    // The local fixture has no real session: the protected destination retains the exact return path.
    await expect(page).toHaveURL(/\/login\?next=%2Fjobs%2FTM-1005/);
  });

  test("Retry recovers without leaving and restores keyboard focus to an available action", async ({ page }) => {
    await openFixture(page, "error");
    await panel(page).getByRole("menuitem", { name: "Try again" }).press("Enter");
    await expect(rows(page)).toHaveCount(4);
    await expect(panel(page).getByRole("menuitem", { name: "Try again" })).toHaveCount(0);
    await expect.poll(() => panel(page).evaluate((el) => el.contains(document.activeElement) && document.activeElement?.getAttribute("role") === "menuitem" && document.activeElement.getAttribute("aria-disabled") !== "true")).toBe(true);
    await page.keyboard.press("Home");
    await expect(panel(page).getByRole("menuitem", { name: "Mark all read" })).toBeFocused();
  });

  test("an expired session opens the existing login dialog without discarding the page", async ({ page }) => {
    await openFixture(page, "expired");
    await rows(page).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/dev/components/notifications");
  });

  test("M20 pops when fresh server data increases the count; M08 uses the existing named animation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openFixture(page, "unread", "&controls=1");
    await expect(panel(page).locator("..")).toHaveClass(/tm-anim-suggest/);
    await page.getByRole("button", { name: "Add notification", exact: true }).click();
    await expect(bell(page)).toHaveAccessibleName("Notifications, 3 unread");
    await expect(bell(page).locator('[aria-hidden="true"]').last()).toHaveClass(/tm-anim-badge/);
    await expect(bell(page).locator('[aria-hidden="true"]').last()).toHaveCSS("animation-name", "tm-badge");
  });

  test("tradie mode retains the kit colours, tooltip and account actions", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openFixture(page, "unread", "&mode=trade");
    await expect(page.locator('[data-mode="trade"]').first()).toBeVisible();
    await page.keyboard.press("Escape");
    await bell(page).hover();
    await expect(page.getByText("Notifications, 2 unread", { exact: true }).filter({ visible: true })).toBeVisible();
    await page.getByRole("button", { name: "Account: Jack Wilson" }).click();
    await expect(page.getByRole("menu", { name: "Account" }).getByRole("menuitem", { name: "Payments" })).toHaveCount(0);
    await expect(page.getByRole("menu", { name: "Account" }).getByRole("menuitem", { name: "Log out" })).toBeVisible();
    await expectNoA11yViolations(page);
  });
});
