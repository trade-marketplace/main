import { expect, test } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

test.use({ reducedMotion: "reduce" });

for (const viewport of VIEWPORTS) {
  test.describe(`For tradies at ${viewport.width}px`, () => {
    test.use({ viewport });
    test("uses trade colours, truthful missing rates, and accessible responsive content", async ({ page }) => {
      await page.goto("/for-tradies");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("You do the work. We find the jobs.");
      await expect(page.getByRole("heading", { name: "Rates unavailable" })).toBeVisible();
      expect(await page.locator("body").innerText()).not.toContain("$");
      expect(await page.getByRole("main").evaluate((el) => getComputedStyle(el).getPropertyValue("--trade-signature").trim())).toBe("#eca154");
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
      await page.getByText("Any job?", { exact: true }).click();
      await expect(page.getByText("Yes. Other work needs photo ID.", { exact: false })).toBeVisible();
      await expectNoA11yViolations(page);
    });

    test("clicks through signup and returns, with the mobile menu dismissed", async ({ page }) => {
      await page.goto("/for-tradies");
      if (viewport.width < 1024) {
        await page.getByRole("button", { name: "Menu", exact: true }).click();
        await page.getByRole("navigation", { name: "Menu", exact: true }).getByRole("link", { name: "For tradies" }).click();
        await expect(page.getByRole("button", { name: "Menu", exact: true })).toHaveAttribute("aria-expanded", "false");
      }
      await page.getByRole("main").getByRole("link", { name: "Join as a tradie", exact: true }).first().click();
      await expect(page).toHaveURL(/\/signup\/tradie$/);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.getByLabel("Full name", { exact: false }).fill("Example Worker");
      await page.getByLabel("Email", { exact: false }).fill("worker@example.test");
      await page.getByLabel("Mobile", { exact: false }).fill("027 555 0192");
      await page.getByLabel("Password", { exact: true }).fill("korimako-gumboot-41");
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await page.getByRole("checkbox", { name: "Other / general labour", exact: false }).check();
      await expect(page.locator('input[name^="licence_"]')).toHaveCount(0);
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await expect(page.getByLabel("Full name", { exact: false })).toHaveValue("Example Worker");
      await page.goBack();
      await expect(page).toHaveURL(/\/for-tradies$/);
      await page.getByRole("main").getByRole("link", { name: "How it works", exact: true }).click();
      await expect(page).toHaveURL(/#how-it-works$/);
      await expect(page.getByRole("heading", { name: "How it works", exact: true })).toBeInViewport();
    });
  });
}

test("keyboard skip, FAQ and signup remain usable with visible focus", async ({ page }) => {
  await page.goto("/for-tradies");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  await page.keyboard.press("Tab");
  const signup = page.getByRole("main").getByRole("link", { name: "Join as a tradie", exact: true }).first();
  await expect(signup).toBeFocused();
  expect(await signup.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/signup\/tradie$/);
});

test("M06 fills the nav on scroll and M07 respects reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/for-tradies");
  await expect(page.locator("header.tm-navfill")).toHaveAttribute("data-solid", "false");
  await expect(page.locator("h1 > span").first()).toHaveClass(/tm-anim-reveal/);
  await page.evaluate(() => window.scrollTo(0, 250));
  await expect(page.locator("header.tm-navfill")).toHaveAttribute("data-solid", "true");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await page.locator("h1 > span").first().evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
});

for (const viewport of VIEWPORTS) {
  for (const state of ["ready", "empty", "error", "loading"] as const) {
    test(`preview ${state} fits ${viewport.width}px and passes axe`, async ({ page }) => {
      test.skip(!process.env.E2E_FOR_TRADIES_PREVIEW, "Run against the isolated screenshot build, with guarded dev pages enabled.");
      await page.setViewportSize(viewport);
      await page.goto(`/dev/components/for-tradies?state=${state}`);
      if (state === "ready") await expect(page.getByRole("heading", { name: "Sub wiring" })).toBeVisible({ visible: viewport.width >= 1024 });
      else if (state === "loading") {
        await expect(page.locator('[aria-busy="true"]')).toBeVisible();
        await expect(page.locator(".tm-skel")).toHaveCSS("opacity", "1");
      }
      else await expect(page.getByRole("heading", { name: "Rates unavailable" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
      await expectNoA11yViolations(page);
      await page.getByText("Any job?", { exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByText("Yes. Other work needs photo ID.", { exact: false })).toBeVisible();
      await expectNoA11yViolations(page);
    });
  }
}
