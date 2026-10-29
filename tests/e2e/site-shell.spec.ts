import { expect, type Page, test } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

// Shell/axe assertions inspect the resting screen; landing.spec exercises M06/M07 with normal motion.
test.use({ reducedMotion: "reduce" });

// The public site header, phone menu and footer (#83), on the home page (signed out: e2e runs keep Supabase off).
// Signed-in states are checked on /dev/components/site-shell against `npm run dev` (bottom of this file).

const DESKTOP_NAV_MIN = 1024;

async function sidewaysScroll(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** Whether the header's Forest fill (the .tm-navfill layer) is showing. */
async function headerIsSolid(page: Page) {
  return page.locator("header").evaluate((el) => getComputedStyle(el, "::before").opacity === "1");
}

for (const viewport of VIEWPORTS) {
  const desktop = viewport.width >= DESKTOP_NAV_MIN;

  test.describe(`site shell at ${viewport.width}px`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("has the header, main and footer landmarks and no sideways scroll", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("banner")).toBeVisible();
      await expect(page.getByRole("main")).toBeVisible();
      await expect(page.getByRole("contentinfo")).toBeVisible();
      await expect(page.getByRole("link", { name: "Trade Marketplace home" })).toHaveAttribute("href", "/");
      const footer = page.getByRole("navigation", { name: "Footer" });
      for (const name of ["How it works", "Trust & safety", "For tradies", "Tradie terms", "About us", "Terms", "Privacy", "Cookies"]) {
        await expect(footer.getByRole("link", { name, exact: true })).toBeVisible();
      }
      expect(await sidewaysScroll(page)).toBe(0);
      await expectNoA11yViolations(page);
    });

    test("skip link is the first thing Tab reaches and jumps to the main content", async ({ page }) => {
      await page.goto("/");
      await page.keyboard.press("Tab");
      const skip = page.getByRole("link", { name: "Skip to content" });
      await expect(skip).toBeFocused();
      await expect(skip).toBeInViewport();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("main")).toBeFocused();
    });

    test("is see-through at the top and solid Forest as scrolling starts (M06)", async ({ page }) => {
      await page.goto("/");
      await expect.poll(() => headerIsSolid(page)).toBe(false);
      await page.evaluate(() => window.scrollTo(0, 1));
      await expect.poll(() => headerIsSolid(page)).toBe(true);
      await page.evaluate(() => window.scrollTo(0, window.innerHeight * 1.5));
      await expect.poll(() => headerIsSolid(page)).toBe(true);
      await expectNoA11yViolations(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect.poll(() => headerIsSolid(page)).toBe(false);
    });

    if (desktop) {
      test("shows the full nav, Log in and Sign up, and no menu button", async ({ page }) => {
        await page.goto("/");
        const nav = page.getByRole("navigation", { name: "Main" });
        for (const name of ["How it works", "For tradies", "Help"]) await expect(nav.getByRole("link", { name })).toBeVisible();
        const banner = page.getByRole("banner");
        await expect(banner.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
        await expect(banner.getByRole("link", { name: "Sign up" })).toHaveAttribute("href", "/signup");
        await expect(page.getByRole("button", { name: "Menu" })).toBeHidden();
      });
    } else {
      test("opens the menu from the keyboard, moves focus into it, and Esc closes it back to the button", async ({ page }) => {
        await page.goto("/");
        await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
        const toggle = page.getByRole("button", { name: "Menu" });
        await expect(toggle).toHaveAttribute("aria-expanded", "false");

        await toggle.focus();
        await page.keyboard.press("Enter");
        await expect(toggle).toHaveAttribute("aria-expanded", "true");
        const menu = page.getByRole("navigation", { name: "Menu" });
        await expect(menu).toBeVisible();
        await expect(menu.getByRole("link", { name: "How it works" })).toBeFocused();
        await expect(menu.getByRole("link", { name: "For tradies", exact: true })).toBeVisible();
        await expect(page.getByRole("link", { name: "Post a job" }).first()).toBeVisible();
        await expect.poll(() => headerIsSolid(page)).toBe(true);
        expect(await sidewaysScroll(page)).toBe(0);
        await expectNoA11yViolations(page);

        await page.keyboard.press("Escape");
        await expect(toggle).toHaveAttribute("aria-expanded", "false");
        await expect(menu).toBeHidden();
        await expect(toggle).toBeFocused();

        // Space opens it too, and tabbing out past its last link closes it.
        await page.keyboard.press("Space");
        await expect(menu).toBeVisible();
        const links = await page.locator(`[id="${await toggle.getAttribute("aria-controls")}"]`).locator("a").count();
        for (let i = 0; i < links; i += 1) await page.keyboard.press("Tab");
        await expect(menu).toBeHidden();
      });

      test("closes the menu when the window grows wide enough for the full nav", async ({ page }) => {
        await page.goto("/");
        await page.getByRole("button", { name: "Menu" }).click();
        await expect(page.getByRole("navigation", { name: "Menu" })).toBeVisible();
        await page.setViewportSize({ width: 1280, height: 800 });
        await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
        await expect(page.getByRole("navigation", { name: "Menu" })).toBeHidden();
      });
    }
  });
}

test.describe("at 200% zoom", () => {
  // A 1280px window at 200% lays out like 640 CSS pixels with twice the device pixels.
  test.use({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 2 });

  test("everything is reachable through the menu with no sideways scroll", async ({ page }) => {
    await page.goto("/");
    expect(await sidewaysScroll(page)).toBe(0);
    await page.getByRole("button", { name: "Menu" }).click();
    const menu = page.getByRole("navigation", { name: "Menu" });
    await expect(menu).toBeVisible();
    // The menu scrolls inside itself when it's taller than the window, so its last action can be reached.
    const last = page.getByRole("banner").getByRole("link", { name: "Log in" }).last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    expect(await sidewaysScroll(page)).toBe(0);
    await expectNoA11yViolations(page);
  });
});

// ---- /dev/components/site-shell: signed-in states with fake viewers (development only) ----

test("/dev/components/site-shell is not in production builds", async ({ page }) => {
  test.skip(Boolean(process.env.E2E_DEV_BASE_URL), "checking the dev server instead");
  const response = await page.goto("/dev/components/site-shell");
  expect(response?.status()).toBe(404);
});

const devUrl = process.env.E2E_DEV_BASE_URL;
const dev = (query = "") => (devUrl ? new URL(`/dev/components/site-shell${query}`, devUrl).href : "");

test.describe("/dev/components/site-shell on the dev server", () => {
  test.skip(!devUrl, "set E2E_DEV_BASE_URL to a running `npm run dev`");

  const STATES = [
    { query: "", name: "signed out", app: null },
    { query: "?viewer=customer", name: "a customer", app: "My jobs" },
    { query: "?viewer=tradie", name: "a tradie", app: "Find work" },
    { query: "?viewer=office", name: "the office", app: "Office" },
    { query: "?viewer=long&hero=off", name: "a long name", app: "My jobs" },
  ] as const;

  for (const viewport of VIEWPORTS) {
    const desktop = viewport.width >= DESKTOP_NAV_MIN;
    for (const state of STATES) {
      test(`${state.name} at ${viewport.width}px`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(dev(state.query));
        await expect(page.getByRole("heading", { level: 1, name: "Site header and footer" })).toBeVisible();
        const banner = page.getByRole("banner");
        if (!desktop) {
          await page.getByRole("button", { name: "Menu" }).click();
          await expect(page.getByRole("navigation", { name: "Menu" })).toBeVisible();
        }
        if (state.app) {
          await expect(banner.getByRole("link", { name: state.app, exact: true }).locator("visible=true")).toHaveCount(1);
          await expect(banner.getByRole("link", { name: "Log in" })).toHaveCount(0);
        } else {
          await expect(banner.getByRole("link", { name: "Log in" }).locator("visible=true").first()).toBeVisible();
        }
        // Tradies and the office can't post a job; customers and visitors can.
        const canPost = state.app === null || state.app === "My jobs";
        await expect(banner.getByRole("link", { name: "Post a job" }).locator("visible=true")).toHaveCount(canPost && !desktop ? 1 : 0);

        // A long name is cut off with "…" inside its link, never pushing the page sideways.
        const name = banner.getByRole("link", { name: /^Your account:/ }).locator("visible=true");
        if (state.app && state.app !== "Office") {
          const shown = name.locator("span").last();
          const cut = await shown.evaluate((el) => el.scrollWidth > el.clientWidth);
          // In the wide menu (768px) even the long name fits; in the bar and on phones it's cut off.
          expect(cut).toBe(state.query.includes("long") && (desktop || viewport.width <= 390));
          const box = await shown.boundingBox();
          expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
        }
        expect(await sidewaysScroll(page)).toBe(0);
        await expectNoA11yViolations(page);
      });
    }
  }

  test("the public site stays green for a signed-in tradie", async ({ page }) => {
    await page.goto(dev("?viewer=tradie"));
    const fill = await page
      .getByRole("banner")
      .getByRole("link", { name: "Find work" })
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(fill).toBe("rgb(108, 189, 69)"); // Leaf, the customer action colour (--trade-leaf)
  });
});
