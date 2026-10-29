import { expect, type Page, test } from "@playwright/test";

import { VIEWPORTS } from "./support/viewports";

test.use({ reducedMotion: "reduce" });

async function details(page: Page, role: "customer" | "tradie") {
  await expect(page).toHaveURL(new RegExp(`/signup/${role}(?:\\?|$)`));
  await expect(page.getByLabel("Full name", { exact: false })).toBeVisible();
  await expect(page.locator("body [data-mode]").first()).toHaveAttribute("data-mode", role === "tradie" ? "trade" : "customer");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
}

for (const viewport of VIEWPORTS) {
  test.describe(`signup journeys at ${viewport.width}px`, () => {
    test.use({ viewport });

    test("header Sign up reaches both roles; browser back and next paths work", async ({ page }) => {
      await page.goto("/");
      if (viewport.width < 1024) await page.getByRole("button", { name: "Menu", exact: true }).click();
      await page.getByRole("banner").getByRole("link", { name: "Sign up", exact: true }).click();
      await expect(page).toHaveURL(/\/signup$/);
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await details(page, "customer");
      await page.goBack();
      await page.getByRole("radio", { name: /I’m a tradie/ }).check();
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await details(page, "tradie");
    });

    test("Join CTA and footer Join open tradie details, then Your trade and Back preserve details", async ({ page }) => {
      await page.goto("/");
      await page.getByRole("link", { name: "Join as a tradie", exact: true }).click();
      await details(page, "tradie");
      await page.getByLabel("Full name", { exact: false }).fill("Example Worker");
      await page.getByLabel("Email", { exact: false }).fill("worker@example.test");
      await page.getByLabel("Mobile", { exact: false }).fill("027 555 0192");
      await page.getByLabel("Password", { exact: true }).fill("korimako-gumboot-41");
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Your trade" })).toBeVisible();
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await expect(page.getByLabel("Full name", { exact: false })).toHaveValue("Example Worker");
      await page.goBack();
      await expect(page).toHaveURL(/\/$/);
      await page.getByRole("contentinfo").getByRole("link", { name: "Join", exact: true }).click();
      await details(page, "tradie");
    });

    test("keyboard role selection and Next preserve the return path", async ({ page, browserName }) => {
      await page.goto("/signup?next=%2Fjobs%3Fview%3Dmap");
      await page.getByRole("radio", { name: /I need a job done/ }).focus();
      await page.keyboard.press("ArrowDown");
      await expect(page.getByRole("radio", { name: /I’m a tradie/ })).toBeChecked();
      // WebKit on macOS uses Option-Tab when full keyboard access is off.
      await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
      await expect(page.getByRole("button", { name: "Next", exact: true })).toBeFocused();
      await page.keyboard.press("Enter");
      await details(page, "tradie");
      await expect(page.locator('input[name="next"]')).toHaveValue("/jobs?view=map");
      await page.goBack();
      await page.getByRole("radio", { name: /I need a job done/ }).check();
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await details(page, "customer");
      await expect(page.locator('input[name="next"]')).toHaveValue("/jobs?view=map");
    });

    if (viewport.width < 1024) {
      test("menu link survives blur without a relatedTarget before its click", async ({ page }) => {
        await page.goto("/");
        await page.getByRole("button", { name: "Menu", exact: true }).click();
        const signup = page.getByRole("banner").getByRole("link", { name: "Sign up", exact: true });
        // Safari can blur the focused menu item before assigning focus on a pointer press.
        await signup.evaluate((link) => link.addEventListener("pointerdown", () => {
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        }, { once: true }));
        await signup.click();
        await expect(page).toHaveURL(/\/signup$/);
        await page.getByRole("radio", { name: /I’m a tradie/ }).check();
        await page.getByRole("button", { name: "Next", exact: true }).click();
        await details(page, "tradie");
      });

      test("outside click, Tab and Escape still dismiss the menu", async ({ page }) => {
        await page.goto("/");
        const toggle = page.getByRole("button", { name: "Menu", exact: true });
        await toggle.click();
        // A non-focusable target must dismiss too; focus alone cannot detect it.
        const panelId = await toggle.getAttribute("aria-controls");
        const panel = await page.locator(`[id="${panelId}"]`).boundingBox();
        expect(panel).not.toBeNull();
        await page.mouse.click(4, panel!.y + panel!.height + 8);
        await expect(toggle).toHaveAttribute("aria-expanded", "false");
        await toggle.focus();
        await page.keyboard.press("Enter");
        await page.keyboard.press("Escape");
        await expect(toggle).toBeFocused();
        await expect(toggle).toHaveAttribute("aria-expanded", "false");
        await page.keyboard.press("Space");
        await page.getByRole("banner").getByRole("link", { name: "Log in", exact: true }).last().focus();
        await page.keyboard.press("Tab");
        await expect(toggle).toHaveAttribute("aria-expanded", "false");
      });
    }
  });
}

for (const viewport of VIEWPORTS) test.describe(`touch signup at ${viewport.width}px`, () => {
  test.use({ viewport, hasTouch: true, isMobile: true });
  test("header signup tap and tradie card tap reach the tradie account step", async ({ page }) => {
    await page.goto("/");
    if (viewport.width < 1024) await page.getByRole("button", { name: "Menu", exact: true }).tap();
    await page.getByRole("banner").getByRole("link", { name: "Sign up", exact: true }).tap();
    await expect(page).toHaveURL(/\/signup$/);
    await page.getByRole("radio", { name: /I’m a tradie/ }).tap();
    await page.getByRole("button", { name: "Next", exact: true }).tap();
    await details(page, "tradie");
  });
});
