import { expect, test } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

// /dev/motion (#73) is a development-only page. `npm run e2e` runs the production build, where it must be a 404.
// To check the page itself, start `npm run dev` and point these tests at it:
//   E2E_DEV_BASE_URL=http://localhost:3000 npx playwright test tests/e2e/dev-motion.spec.ts
// (use "localhost", not 127.0.0.1: `next dev` blocks its scripts on other hosts).

test("/dev/motion is not in production builds", async ({ page }) => {
  test.skip(Boolean(process.env.E2E_DEV_BASE_URL), "checking the dev server instead");
  const response = await page.goto("/dev/motion");
  expect(response?.status()).toBe(404);
});

const devUrl = process.env.E2E_DEV_BASE_URL;
const motionUrl = devUrl ? new URL("/dev/motion", devUrl).href : "";

test.describe("/dev/motion on the dev server", () => {
  test.skip(!devUrl, "set E2E_DEV_BASE_URL to a running `npm run dev`");

  for (const viewport of VIEWPORTS) {
    test(`has no accessibility violations or sideways scroll at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(motionUrl);
      await expect(page.getByRole("heading", { level: 1, name: "Motion" })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBe(0);
      await expectNoA11yViolations(page);
    });
  }

  test("has a play button for each of M01–M27, and every one plays without an error", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(motionUrl);
    const plays = page.getByRole("button", { name: /^Play M\d\d · / });
    await expect(plays).toHaveCount(27);
    for (let i = 0; i < 27; i++) {
      const name = await plays.nth(i).innerText();
      if (/M12|M13/.test(name)) continue; // modal: covered below
      await plays.nth(i).click();
    }
    expect(errors).toEqual([]);
  });

  test("the drawer takes focus, closes with Esc and gives focus back", async ({ page }) => {
    await page.goto(motionUrl);
    const open = page.getByRole("button", { name: "Play M12 · Drawer" });
    await open.click();
    await expect(page.getByRole("heading", { name: "Your estimate" })).toBeFocused();
    await expectNoA11yViolations(page);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(open).toBeFocused();
  });

  test("the toast waits while hovered and leaves 4s after", async ({ page }) => {
    await page.goto(motionUrl);
    await page.getByRole("button", { name: "Play M14 · Toast" }).click();
    const toast = page.getByText("Saved. Find it in My jobs.");
    await toast.hover();
    await page.waitForTimeout(4500);
    await expect(toast).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(toast).toHaveCount(0, { timeout: 5000 });
  });

  test("a celebration plays once per event: revisiting the same event shows it still", async ({ page }) => {
    await page.goto(motionUrl);
    await page.getByRole("button", { name: "Play M10 · Bolt flash" }).click();
    await expect(page.locator("#m10 .tm-flash")).toHaveAttribute("data-playing", "true");
    await page.getByRole("button", { name: "Revisit the same event" }).click();
    await expect(page.locator("#m10 .tm-flash")).toHaveAttribute("data-playing", "false");
  });

  test.describe("with reduced motion", () => {
    test.use({ reducedMotion: "reduce" });

    test("every change is instant and the skeleton is static grey", async ({ page }) => {
      await page.goto(motionUrl);
      await expect(page.getByText("Reduced motion: on")).toBeVisible();
      await page.getByRole("button", { name: "Play M09 · Price reveal" }).click();
      await expect(page.locator("#m09 span[aria-hidden=true]").first()).toHaveText("$372.00");
      await page.getByRole("button", { name: "Keep loading" }).click();
      const shimmer = await page
        .locator(".tm-skel")
        .first()
        .evaluate((el) => getComputedStyle(el, "::after").display);
      expect(shimmer).toBe("none");
      const running = await page.evaluate(() =>
        document.getAnimations().filter((a) => a instanceof CSSAnimation && a.animationName !== "tm-hidden"),
      );
      expect(running).toHaveLength(0);
    });
  });
});
