import { expect, test } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const PROMISES = [
  ["Licences checked by hand", /\/help\/how-do-you-check-workers$/, "How do you check workers?"],
  ["Paperwork every time", /\/help\/electrical-work-and-your-coc$/, "Electrical work and your CoC"],
  ["Secure payments", /\/help\/paying-safely$/, "Paying safely"],
  ["No surprise bills", /\/help\/extra-work$/, "What if the job needs more work?"],
  ["Real people", /\/help\/something-is-not-right$/, "Something’s not right"],
  ["Honest reviews", /\/help\/leaving-a-review$/, "Leaving a review"],
] as const;

test.describe("Trust & safety", () => {
  test.use({ reducedMotion: "reduce" });

  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: default state fits and passes axe`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/trust");
      await expect(page).toHaveTitle(/Trust & safety/);
      await expect(page.getByRole("heading", { level: 1, name: "Your home. Done right." })).toBeVisible();
      for (const [name] of PROMISES) await expect(page.getByRole("heading", { level: 2, name, exact: true })).toBeVisible();
      await expect(page.getByText("Any kind of job, in Invercargill.")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Got a job that needs doing?" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
      await expectNoA11yViolations(page);
    });
  }

  test("each promise opens its help article with a real click and comes back", async ({ page }) => {
    await page.goto("/trust");
    for (const [name, url, title] of PROMISES) {
      await page.getByRole("link", { name, exact: true }).click();
      await expect(page).toHaveURL(url);
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
      await page.goBack();
      await expect(page.getByRole("heading", { level: 1, name: "Your home. Done right." })).toBeVisible();
    }
  });

  test("the whole card is the link, and keyboard Tab and Enter work", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/trust");
    // Tapping the card's text, not the title, still follows the link.
    const text = page.getByText("You pay through us.");
    await text.scrollIntoViewIfNeeded();
    const box = (await text.boundingBox())!;
    await page.mouse.click(box.x + 8, box.y + box.height / 2);
    await expect(page).toHaveURL(/\/help\/paying-safely$/);
    await page.goBack();
    const link = page.getByRole("link", { name: "Honest reviews", exact: true });
    await link.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(link).toBeFocused();
    // The visible ring is drawn around the whole card by the stretched link's ::after (M05).
    expect(await link.evaluate(el => getComputedStyle(el, "::after").outlineStyle)).not.toBe("none");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/help\/leaving-a-review$/);
  });

  test("Post a job and Contact us follow real clicks", async ({ page }) => {
    await page.goto("/trust");
    await page.getByRole("main").getByRole("link", { name: "Post a job", exact: true }).click();
    await expect(page).toHaveURL(/\/jobs\/new$/);
    await page.goBack();
    const contact = page.getByRole("link", { name: "Contact us", exact: true });
    await expect(contact).toHaveAttribute("href", "/contact");
  });

  test("the footer's Trust & safety link opens this page", async ({ page }) => {
    await page.goto("/how-it-works");
    await page.getByRole("contentinfo").getByRole("link", { name: "Trust & safety", exact: true }).click();
    await expect(page).toHaveURL(/\/trust$/);
    await expect(page.getByRole("heading", { level: 1, name: "Your home. Done right." })).toBeVisible();
  });

  test("phone menu dismisses after keyboard use and axe stays clean", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/trust");
    const menu = page.getByRole("button", { name: "Menu", exact: true });
    await menu.press("Enter");
    await page.keyboard.press("Escape");
    await expect(menu).toBeFocused();
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await expectNoA11yViolations(page);
  });

  test("M10 plays once on the first visit and not again on a revisit", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/trust");
    const flash = page.locator(".tm-flash");
    await expect(flash).toHaveAttribute("data-playing", "true");
    await expect(flash).toHaveAttribute("aria-hidden", "true");
    await page.reload();
    await expect(page.locator(".tm-flash")).toHaveAttribute("data-playing", "false");
  });

  test("reduced motion shows the shield straight away and nothing animates", async ({ page }) => {
    await page.goto("/trust");
    await expect(page.locator(".tm-flash")).toHaveAttribute("data-playing", "false");
    await expect(page.locator(".tm-flash")).toBeVisible();
  });
});
