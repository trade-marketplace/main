import { expect, test } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const preview = process.env.POSTED_PREVIEW_E2E_URL || "http://127.0.0.1:3101";

for (const { width, height } of VIEWPORTS) {
  test(`bottom account menu keeps page position and keyboard focus at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    // Flipping the panel can shrink the document and undo a focus-induced scroll before Playwright gets control.
    // Capture scroll at the focus event as well as checking the final placement.
    await page.addInitScript(() => {
      document.addEventListener("focusin", ({ target }) => {
        if (target instanceof HTMLElement && target.matches('[role="menuitem"]')) {
          target.dataset.scrollYOnFocus = String(window.scrollY);
        }
      });
    });
    await page.goto(new URL("/dev/components/app-shell?state=bottom-menu&menu=open", preview).href);
    const trigger = page.getByRole("button", { name: /^Account:/ });
    const menu = page.getByRole("menu", { name: "Account" });
    const account = menu.getByRole("menuitem", { name: "Account", exact: true });
    const logout = menu.getByRole("menuitem", { name: "Log out", exact: true });

    async function expectPanelAboveTrigger() {
      // The header and border live on the role=menu container's parent.
      const panel = menu.locator("..");
      await expect(panel).toHaveAttribute("data-up", "true");
      await panel.evaluate(async (el) => Promise.all(el.getAnimations().map((animation) => animation.finished)));
      const box = await panel.boundingBox();
      const anchor = await trigger.boundingBox();
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(anchor!.y);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      const position = await page.evaluate(() => ({
        x: window.scrollX, y: window.scrollY,
        width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight,
      }));
      expect(position).toEqual({ x: 0, y: 0, width, height });
    }

    await expect(account).toBeFocused();
    await expect(account).toHaveAttribute("data-scroll-y-on-focus", "0");
    await expectPanelAboveTrigger();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();

    await page.keyboard.press("ArrowUp");
    await expect(logout).toBeFocused();
    await expect(logout).toHaveAttribute("data-scroll-y-on-focus", "0");
    await expectPanelAboveTrigger();
    await expectNoA11yViolations(page);
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
  });
}
