import { expect, test } from "@playwright/test";
import { join } from "node:path";

import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const preview = process.env.PREFERENCES_PREVIEW_URL;

test.describe("shared account layout regression", () => {
  test.skip(!preview, "Needs the guarded local account previews.");
  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: notification and existing Security surfaces fill the shell and keep controls usable`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize(viewport);
      for (const mode of ["customer", "trade"]) for (const route of ["notification-preferences", "security"]) {
        await page.goto(`${preview}/dev/components/${route}?mode=${mode}`);
        const heading = page.getByRole("heading", { name: route === "security" ? "Security" : "Notifications", exact: true });
        await expect(heading).toBeVisible();
        await expect(page.locator("main .tm-anim-rise")).toHaveCSS("opacity", "1");
        const bounds = await heading.boundingBox();
        // Geometry from w-account, keeping the 390 layout's existing 16px inset and 36px title.
        if (viewport.width === 1440) expect(bounds?.x).toBe(464);
        if (viewport.width === 390 || viewport.width === 320) expect(bounds?.x).toBe(16);
        await expect(heading).toHaveCSS("font-size", viewport.width >= 1024 ? "32px" : "36px");
        const surface = page.locator("main > div").first();
        const box = await surface.boundingBox();
        expect(box!.y + box!.height).toBeGreaterThanOrEqual(viewport.height - (viewport.width < 1024 ? 64 : 0));
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
        if (route === "security") {
          await expect(page.getByRole("form", { name: "Change password" })).toBeVisible();
          await expect(page.getByRole("form", { name: "Change email" }).getByLabel("New email")).toBeEnabled();
        } else await expect(page.getByRole("checkbox", { name: mode === "customer" ? "Email: Your price is ready" : "Email: New job", exact: true })).toBeEnabled();
        await expectNoA11yViolations(page);
        if (process.env.PREFERENCES_SCREENSHOTS_DIR && [1440, 390].includes(viewport.width)) {
          await page.evaluate(() => document.fonts.ready);
          await page.screenshot({ path: join(process.env.PREFERENCES_SCREENSHOTS_DIR, `${route}-after-${mode}-${viewport.width}.png`), fullPage: true, animations: "disabled" });
        }
      }
    });
  }
});
