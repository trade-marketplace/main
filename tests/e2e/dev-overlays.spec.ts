import { expect, type Locator, type Page, test } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

// /dev/components/overlays (#78) is a development-only page. `npm run e2e` runs the production build, where it must
// be a 404. To check the page itself, start `npm run dev` and point these tests at it:
//   E2E_DEV_BASE_URL=http://localhost:3000 npx playwright test tests/e2e/dev-overlays.spec.ts

test("/dev/components/overlays is not in production builds", async ({ page }) => {
  test.skip(Boolean(process.env.E2E_DEV_BASE_URL), "checking the dev server instead");
  const response = await page.goto("/dev/components/overlays");
  expect(response?.status()).toBe(404);
});

const devUrl = process.env.E2E_DEV_BASE_URL;
const url = (query = "") => (devUrl ? new URL(`/dev/components/overlays${query}`, devUrl).href : "");

/** Sideways scroll on the page, and how far the open overlay (or menu, or toast) reaches past either side. */
async function overflows(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const width = document.documentElement.clientWidth;
    const spilled = [...document.querySelectorAll<HTMLElement>(sel)].flatMap((el) => {
      const box = el.getBoundingClientRect();
      const out = [box.left < -1 && `left ${box.left}`, box.right > width + 1 && `right ${box.right - width}`];
      // Anything inside that is wider than its own box (text that didn't wrap).
      const inner = [...el.querySelectorAll<HTMLElement>("h2, p, b, span, button, a")]
        .filter((child) => !child.closest("[aria-hidden=true], [translate=no]")) // icons and their boxes
        .filter((child) => child.scrollWidth > child.clientWidth + 1 && getComputedStyle(child).overflowX === "visible")
        .filter((child) => getComputedStyle(child).display !== "inline")
        .map((child) => `spills: ${child.textContent?.slice(0, 30)}`);
      // Any part of it that scrolls sideways (a column stretched by a long word).
      const sideways = [el, ...el.querySelectorAll<HTMLElement>("*")]
        .filter((child) => ["auto", "scroll"].includes(getComputedStyle(child).overflowX))
        .filter((child) => child.scrollWidth > child.clientWidth + 1)
        .map((child) => `scrolls sideways: ${child.className}`);
      return [...out.filter(Boolean), ...inner, ...sideways] as string[];
    });
    return { page: document.documentElement.scrollWidth - width, spilled };
  }, selector);
}

const modal = (page: Page) => page.locator("dialog[open]");

/** Waits for overlays to finish sliding or fading in (M08, M12, M13, sheet), so boxes are where they end up. */
async function settled(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => {
          const target = (a.effect as KeyframeEffect | null)?.target;
          return target instanceof Element && (target.tagName === "DIALOG" || target.querySelector("[role=menu]") !== null);
        })
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
}

// ?open=<id> opens one overlay on load; `what` finds it.
const OPEN_STATES: { id: string; what: string; name: string | RegExp }[] = [
  { id: "dialog", what: "dialog[open]", name: "Jack found extra work" },
  { id: "confirm", what: "dialog[open]", name: "Take this job?" },
  { id: "session-expired", what: "dialog[open]", name: "Logged out" },
  { id: "long-dialog", what: "dialog[open]", name: /^Book Wiremu/ },
  { id: "drawer", what: "dialog[open]", name: "Your estimate" },
  { id: "long-drawer", what: "dialog[open]", name: /^Add Wiremu/ },
  { id: "sheet", what: "dialog[open]", name: "Filter" },
  { id: "menu", what: "[role=menu]", name: "Account menu" },
  { id: "long-menu", what: "[role=menu]", name: "More options" },
  { id: "toast", what: "[role=status] > div", name: "Photo removed." },
  { id: "long-toast", what: "[role=status] > div", name: /Receipt sent to/ },
];

async function expectOpen(page: Page, state: (typeof OPEN_STATES)[number]) {
  if (state.what === "dialog[open]") {
    await expect(page.getByRole(state.id === "confirm" ? "alertdialog" : "dialog", { name: state.name })).toBeVisible();
  } else if (state.what === "[role=menu]") {
    await expect(page.getByRole("menu", { name: state.name })).toBeVisible();
  } else {
    await expect(page.getByRole("status").filter({ hasText: state.name }).first()).toBeVisible();
  }
}

test.describe("/dev/components/overlays on the dev server", () => {
  test.skip(!devUrl, "set E2E_DEV_BASE_URL to a running `npm run dev`");

  for (const viewport of VIEWPORTS) {
    test.describe(`at ${viewport.width}px`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } });

      test("the page has no accessibility violations or sideways scroll", async ({ page }) => {
        await page.goto(url());
        await expect(page.getByRole("heading", { level: 1, name: "Dialogs, drawers, sheets, menus and toasts" })).toBeVisible();
        expect(await overflows(page, ".tm-never-matches")).toEqual({ page: 0, spilled: [] });
        await expectNoA11yViolations(page);
      });

      test("every overlay, open, has no accessibility violations and stays inside the screen", async ({ page }) => {
        test.slow();
        for (const state of OPEN_STATES) {
          await test.step(state.id, async () => {
            await page.goto(url(`?open=${state.id}`));
            await expectOpen(page, state);
            await settled(page);
            expect(await overflows(page, state.what), state.id).toEqual({ page: 0, spilled: [] });
            await expectNoA11yViolations(page);
          });
        }
      });
    });
  }

  for (const mode of ["trade", "office"] as const) {
    test(`a dialog, a menu and a toast have no accessibility violations in ${mode} mode`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      for (const id of ["dialog", "menu", "toast"]) {
        await page.goto(url(`?mode=${mode}&open=${id}`));
        await expectOpen(page, OPEN_STATES.find((s) => s.id === id)!);
        await expectNoA11yViolations(page);
      }
    });
  }

  test("a dialog: focus goes to its title, Tab stays inside, Esc closes, focus comes back", async ({ page }) => {
    await page.goto(url());
    const opener = page.getByRole("button", { name: "Review extra work" });
    await opener.focus();
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog", { name: "Jack found extra work" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Jack found extra work" })).toBeFocused();
    expect(await modal(page).evaluate((el) => el.matches(":modal"))).toBe(true);

    // Tab round the dialog twice: focus never leaves it. Shift+Tab from the first control goes to the last.
    const visited: string[] = [];
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      visited.push(await page.evaluate(() => (document.activeElement?.closest("dialog") ? document.activeElement.getAttribute("aria-label") || document.activeElement.textContent || "?" : "OUTSIDE")));
    }
    expect(visited).not.toContain("OUTSIDE");
    expect(visited.slice(0, 4)).toEqual(["Close", "Decline", "Approve & pay $148.00", "Close"]);
    await dialog.getByRole("button", { name: "Close" }).focus();
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("button", { name: "Approve & pay $148.00" })).toBeFocused();

    // The page behind can't scroll while it's open.
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("hidden");

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("");
  });

  test("a dialog closes from the scrim and from ×, not from a click inside it", async ({ page }) => {
    await page.goto(url());
    const opener = page.getByRole("button", { name: "Review extra work" });
    const dialog = page.getByRole("dialog", { name: "Jack found extra work" });

    await opener.click();
    await dialog.getByText("Extra cost · fixed · incl. GST").click();
    await expect(dialog).toBeVisible();
    await page.mouse.click(10, 10); // the scrim
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();

    await opener.click();
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
  });

  test("the page behind an open dialog can't be reached", async ({ page }) => {
    await page.goto(url("?open=dialog"));
    await expect(page.getByRole("dialog")).toBeVisible();
    await settled(page);
    // Everything outside the dialog is inert: it can't be focused, and a click lands on the scrim, not on it.
    const behind = page.getByRole("button", { name: "Claim job" });
    await behind.evaluate((el) => (el as HTMLElement).focus());
    await expect(behind).not.toBeFocused();
    const hit = await behind.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return document.elementFromPoint(box.left + 5, box.top + 5)?.tagName;
    });
    expect(hit).toBe("DIALOG");
  });

  test("a dialog that isn't dismissible ignores Esc and the scrim and has no ×", async ({ page }) => {
    await page.goto(url());
    await page.getByRole("button", { name: "Pretend the session expired" }).click();
    const dialog = page.getByRole("dialog", { name: "Logged out" });
    await expect(dialog).toHaveAccessibleDescription("");
    await expect(dialog.getByRole("button", { name: "Close" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.mouse.click(5, 5);
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Log in" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Logged in again.")).toBeVisible();
  });

  test("a destructive confirm waits for its action, then shows a toast whose Undo works", async ({ page }) => {
    await page.goto(url());
    await page.getByRole("button", { name: "Cancel job", exact: true }).first().click();
    const dialog = page.getByRole("alertdialog", { name: "Cancel this job?" });
    await dialog.getByRole("button", { name: "Cancel job" }).click();
    await expect(dialog.getByRole("button", { name: /^Cancel job/ })).toHaveAttribute("aria-busy", "true");
    await expect(dialog.getByRole("button", { name: "Keep job" })).toHaveAccessibleDescription("Wait for “Cancel job” to finish");
    await page.keyboard.press("Escape"); // busy: can't be closed
    await expect(dialog).toBeVisible();
    await expect(dialog).toBeHidden({ timeout: 5000 });

    const toast = page.getByRole("status").filter({ hasText: "Job cancelled." });
    await expect(toast).toBeVisible();
    await toast.getByRole("button", { name: "Undo" }).click();
    await expect(toast).toBeHidden();
    await expect(page.getByText("Job restored.")).toBeVisible();
  });

  test("a confirm whose action fails stays open with an alert", async ({ page }) => {
    await page.goto(url());
    await page.getByRole("button", { name: "Send price to customer" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Send this price to Sarah?" });
    await dialog.getByRole("button", { name: "Send price" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(/We couldn’t send it/, { timeout: 5000 });
    await expect(dialog.getByRole("button", { name: "Send price" })).not.toHaveAttribute("aria-busy", "true");
    await expectNoA11yViolations(page);
  });

  test("a drawer: focus on its title, the form works, Esc closes and focus comes back", async ({ page }) => {
    await page.goto(url());
    const opener = page.getByRole("button", { name: "Estimate now" });
    await opener.click();
    const drawer = page.getByRole("dialog", { name: "Your estimate" });
    await expect(drawer.getByRole("heading", { name: "Your estimate" })).toBeFocused();
    await settled(page);
    const box = await drawer.boundingBox();
    expect(Math.round((box?.x ?? 0) + (box?.width ?? 0))).toBe(page.viewportSize()?.width); // on the right edge
    await drawer.getByLabel("Hours on site").fill("4");
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test("a bottom sheet on a phone closes when dragged down, and springs back from a small drag", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url());
    const opener = page.getByRole("button", { name: "Filter" });
    await opener.click();
    const sheet = page.getByRole("dialog", { name: "Filter" });
    await expect(sheet).toBeVisible();
    await settled(page);
    const title = await sheet.getByRole("heading", { name: "Filter" }).boundingBox();
    const x = (title?.x ?? 0) + 10;
    const y = (title?.y ?? 0) + 10;

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 10, { steps: 5 });
    await page.waitForTimeout(400); // slow: not a flick
    await page.mouse.up();
    await expect(sheet).toBeVisible();

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 200, { steps: 10 });
    await page.mouse.up();
    await expect(sheet).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test("dialogs are bottom sheets on a phone, unless asked to stay dialogs", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url("?open=dialog"));
    // The server can't know the screen width, so it draws a dialog; once in the browser it becomes a sheet.
    await expect(modal(page)).toHaveClass(/tm-anim-sheet/);
    await settled(page);
    const box = await modal(page).boundingBox();
    expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(844);
    expect(box?.width).toBe(390);

    await page.goto(url("?open=dialog-on-phone"));
    await settled(page);
    const centred = await modal(page).boundingBox();
    expect(centred?.width).toBeLessThan(390);
    expect((centred?.y ?? 0) + (centred?.height ?? 0)).toBeLessThan(844);
  });

  test("a menu works by keyboard: arrows, Home/End, first letter, Esc back to the button", async ({ page }) => {
    await page.goto(url());
    const trigger = page.getByRole("button", { name: "Account menu" });
    await expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await trigger.focus();
    await page.keyboard.press("Enter");

    const menu = page.getByRole("menu", { name: "Account menu" });
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAccessibleDescription(/Sarah Thompson/);
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    const item = (name: string) => menu.getByRole("menuitem", { name });
    await expect(item("Account")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(item("Payments")).toBeFocused();
    await page.keyboard.press("End");
    await expect(item("Log out")).toBeFocused();
    await page.keyboard.press("ArrowDown"); // wraps
    await expect(item("Account")).toBeFocused();
    await page.keyboard.press("h");
    await expect(item("Help")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();

    await page.keyboard.press("ArrowUp"); // opens on the last item
    await expect(item("Log out")).toBeFocused();
    await page.keyboard.press("Home");
    await expect(item("Account")).toBeFocused();
    await page.keyboard.press("Tab"); // Tab leaves and closes
    await expect(menu).toBeHidden();
  });

  test("a menu item can open a confirm; closing it puts focus back on the menu button", async ({ page }) => {
    await page.goto(url());
    const trigger = page.getByRole("button", { name: "Account menu" });
    await trigger.click();
    await page.getByRole("menuitem", { name: "Log out" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Log out?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Not now" }).click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("a menu skips disabled items and closes on a click outside", async ({ page }) => {
    await page.goto(url());
    await page.getByRole("button", { name: "Actions" }).click();
    const menu = page.getByRole("menu", { name: "Actions" });
    await expect(menu.getByRole("menuitem", { name: "Download receipt (after payment)" })).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("End");
    await expect(menu.getByRole("menuitem", { name: "Report a problem" })).toBeFocused();
    await page.mouse.click(5, 5);
    await expect(menu).toBeHidden();
  });

  test("a toast goes after 4 seconds, but not while the pointer is on it", async ({ page }) => {
    await page.goto(url());
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const toast = page.getByRole("status").filter({ hasText: "Saved." });
    await expect(toast).toBeVisible();
    await toast.hover();
    await page.waitForTimeout(4500);
    await expect(toast).toBeVisible();
    await page.mouse.move(5, 5);
    await expect(toast).toBeHidden({ timeout: 6000 });
  });

  test("a toast's Undo undoes, and a new toast replaces the old one", async ({ page }) => {
    await page.goto(url());
    await page.getByRole("button", { name: "Remove photo" }).click();
    await expect(page.getByText("The photo is gone.")).toBeVisible();
    await page.getByRole("status").getByRole("button", { name: "Undo" }).click();
    await expect(page.getByText("The photo is there.")).toBeVisible();

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("button", { name: "Copy link" }).click();
    await expect(page.getByText("Link copied.", { exact: true })).toBeVisible();
    await expect(page.getByText("Saved.", { exact: true })).toHaveCount(0);
  });

  test("a live banner is read out when it appears; a dismissible one can be closed", async ({ page }) => {
    await page.goto(url());
    await page.getByRole("button", { name: "Pretend to go offline" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Offline." })).toBeVisible();
    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByRole("button", { name: "Show the tip again" })).toBeVisible();
  });

  test("with reduced motion, overlays open and close without animating", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto(url());
    await page.getByRole("button", { name: "Review extra work" }).click();
    expect(await modal(page).evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    await page.keyboard.press("Escape");
    // Gone straight away: no 150ms exit to wait for.
    await expect(page.locator("dialog")).toHaveCount(0);
    await context.close();
  });

  test("still usable at 200% zoom: long overlays wrap, fit and scroll, with no sideways scroll", async ({ browser }) => {
    // A 1280 × 800 window at 200% is a 640 × 400 page drawn at twice the size.
    const context = await browser.newContext({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    for (const id of ["long-dialog", "long-drawer", "sheet", "long-menu", "long-toast"]) {
      await page.goto(url(`?open=${id}`));
      await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
      const state = OPEN_STATES.find((s) => s.id === id)!;
      await expectOpen(page, state);
      await settled(page);
      expect(await overflows(page, state.what), id).toEqual({ page: 0, spilled: [] });
      if (state.what === "dialog[open]") {
        // The last button can be scrolled to and pressed.
        const last: Locator = modal(page).getByRole("button").last();
        await last.scrollIntoViewIfNeeded();
        await expect(last).toBeInViewport();
        const box = await modal(page).boundingBox();
        expect((box?.y ?? 0) + (box?.height ?? 0), id).toBeLessThanOrEqual(401);
      }
    }
    await context.close();
  });
});
