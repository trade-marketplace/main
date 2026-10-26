import { expect, type Page, test } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

// /dev/components/buttons (#74) is a development-only page. `npm run e2e` runs the production build, where it must
// be a 404. To check the page itself, start `npm run dev` and point these tests at it:
//   E2E_DEV_BASE_URL=http://localhost:3000 npx playwright test tests/e2e/dev-buttons.spec.ts

test("/dev/components/buttons is not in production builds", async ({ page }) => {
  test.skip(Boolean(process.env.E2E_DEV_BASE_URL), "checking the dev server instead");
  const response = await page.goto("/dev/components/buttons");
  expect(response?.status()).toBe(404);
});

const devUrl = process.env.E2E_DEV_BASE_URL;
const url = (query = "") => (devUrl ? new URL(`/dev/components/buttons${query}`, devUrl).href : "");

/** Sideways scroll on the page, and any button or link whose content spills out of it. */
async function overflows(page: Page) {
  return page.evaluate(() => {
    const spilled = [...document.querySelectorAll<HTMLElement>("main button, main a")]
      .filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).display !== "inline")
      .map((el) => el.textContent?.slice(0, 40));
    return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, spilled };
  });
}

test.describe("/dev/components/buttons on the dev server", () => {
  test.skip(!devUrl, "set E2E_DEV_BASE_URL to a running `npm run dev`");

  for (const viewport of VIEWPORTS) {
    test(`has no accessibility violations, sideways scroll or spilled labels at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(url());
      await expect(page.getByRole("heading", { level: 1, name: "Buttons and links" })).toBeVisible();
      expect(await overflows(page)).toEqual({ page: 0, spilled: [] });
      await expectNoA11yViolations(page);
    });
  }

  for (const mode of ["trade", "office"] as const) {
    test(`has no accessibility violations in ${mode} mode`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(url(`?mode=${mode}`));
      await expect(page.getByRole("link", { name: mode === "trade" ? "Trade" : "Office" })).toHaveAttribute("aria-current", "page");
      await expectNoA11yViolations(page);
    });
  }

  test("still works at 200% zoom: labels wrap, nothing spills, no sideways scroll", async ({ browser }) => {
    // A 1280px window at 200% is a 640px-wide page drawn at twice the size.
    const context = await browser.newContext({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    await page.goto(url());
    await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
    expect(await overflows(page)).toEqual({ page: 0, spilled: [] });
    await context.close();
  });

  test("primary buttons take the mode colours, with Forest labels on coloured fills", async ({ page }) => {
    const look = async (query: string) => {
      await page.goto(url(query));
      return page
        .locator("#variants")
        .getByRole("button", { name: "Post a job" })
        .evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el).color }));
    };
    const forest = "rgb(12, 37, 29)";
    expect(await look("")).toEqual({ bg: "rgb(108, 189, 69)", fg: forest }); // Leaf
    expect(await look("?mode=trade")).toEqual({ bg: "rgb(255, 130, 0)", fg: forest }); // Hi-Vis
    expect(await look("?mode=office")).toEqual({ bg: forest, fg: "rgb(255, 255, 255)" }); // Forest, white label
  });

  test("Enter and Space press a button; loading keeps the width and ignores more presses", async ({ page }) => {
    await page.goto(url());
    // The name gains ", loading" while it works, so find it by the start of its name.
    const button = page.getByRole("button", { name: /^Post job/ });
    const before = await button.boundingBox();
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(button).toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("button", { name: "Post job , loading" })).toBeVisible();
    const during = await button.boundingBox();
    expect(during?.width).toBe(before?.width);
    await page.keyboard.press("Space");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Pressed 1 time · finished 0")).toBeVisible();
    await expect(page.getByText("Pressed 1 time · finished 1")).toBeVisible({ timeout: 5000 });
    await page.keyboard.press("Space");
    await expect(page.getByText("Pressed 2 times")).toBeVisible();
  });

  test("a disabled button can be reached by Tab, explains itself, and can't be pressed", async ({ page }) => {
    await page.goto(url());
    const next = page.locator("#states").getByRole("button", { name: "Next", exact: true });
    await expect(next).toHaveAttribute("aria-disabled", "true");
    await expect(next).toHaveAccessibleDescription("Add at least one photo first");

    // Tab onto it: the tooltip shows at once, with a visible focus ring.
    await page.getByRole("button", { name: "Post job", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(next).toBeFocused();
    const tip = page.locator(`[id="${await next.getAttribute("aria-describedby")}"]`);
    await expect(tip).toBeVisible();
    const outline = await next.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).toBe("solid");

    // Enter and Space do nothing (it isn't a form submit or a click); Esc hides the tooltip.
    await page.keyboard.press("Enter");
    await page.keyboard.press("Space");
    await page.keyboard.press("Escape");
    await expect(tip).toBeHidden();
  });

  test("a disabled button shows its reason on a tap, and after 500ms of hover", async ({ page }) => {
    await page.goto(url());
    const resend = page.getByRole("button", { name: "Resend email" });
    const tip = page.getByText("You can resend in 0:42");
    await resend.click({ force: true }); // Playwright won't click an aria-disabled button unless forced; people can.
    await expect(tip).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(tip).toBeHidden();
    await resend.hover();
    await expect(tip).toBeHidden();
    await expect(tip).toBeVisible({ timeout: 2000 });
  });

  test("a tooltip next to the edge of a 320px screen slides back inside it", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(url());
    for (const [section, name] of [["icon-buttons", "Call Jack"], ["states", "Next"]]) {
      const button = page.locator(`#${section}`).getByRole("button", { name, exact: true });
      await button.focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      const tip = page.locator(`[id="${await button.getAttribute("aria-describedby")}"]`).locator("xpath=..");
      await expect(tip).toBeVisible();
      const box = await tip.boundingBox();
      expect(box?.x, name).toBeGreaterThanOrEqual(15);
      expect((box?.x ?? 0) + (box?.width ?? 0), name).toBeLessThanOrEqual(305);
    }
  });

  test("icon buttons have names, show them as tooltips, and report on/off", async ({ page }) => {
    await page.goto(url());
    const close = page.getByRole("button", { name: "Close" });
    await close.hover();
    await expect(page.locator("#icon-buttons").getByText("Close", { exact: true })).toBeVisible({ timeout: 2000 });
    await expect(page.getByRole("button", { name: "Save job", pressed: true })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Call Jack" })).toHaveAccessibleDescription("Jack hasn’t shared a phone number");
  });

  test("a truncated label keeps its whole text for screen readers and shows it in a tooltip", async ({ page }) => {
    await page.goto(url());
    const long = page.locator("#long-labels").getByRole("button", { name: /^Book Wiremu .* Papatoetoe$/ });
    await expect(long).toHaveCount(4); // 2 wrapping, 2 truncated
    const truncated = long.nth(2);
    await truncated.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(truncated.locator("xpath=following-sibling::span")).toBeVisible();
  });

  test("links are links, and the external one says it opens a new tab", async ({ page }) => {
    await page.goto(url());
    await expect(page.getByRole("link", { name: "Forgot password?" })).toBeVisible();
    const external = page.getByRole("link", { name: "Consumer Protection (opens in a new tab)" });
    await expect(external).toHaveAttribute("target", "_blank");
    await expect(external).toHaveAttribute("rel", "noopener noreferrer");
    const inline = page.getByRole("link", { name: "terms" });
    expect(await inline.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe("underline");
  });

  test("the usage example works: Cancel job loads, Keep job waits", async ({ page }) => {
    await page.goto(url());
    await page.getByRole("button", { name: "Cancel job", exact: true }).last().click();
    await expect(page.getByRole("button", { name: "Keep job" })).toHaveAccessibleDescription("Wait for the cancel to finish");
    await expect(page.getByText("Cancelled.")).toBeVisible({ timeout: 5000 });
  });
});
