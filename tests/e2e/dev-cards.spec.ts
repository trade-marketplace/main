import { expect, type Page, test } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

// /dev/components/cards (#76) is a development-only page. `npm run e2e` runs the production build, where it must be
// a 404. To check the page itself, start `npm run dev` and point these tests at it:
//   E2E_DEV_BASE_URL=http://localhost:3000 npx playwright test tests/e2e/dev-cards.spec.ts

test("/dev/components/cards is not in production builds", async ({ page }) => {
  test.skip(Boolean(process.env.E2E_DEV_BASE_URL), "checking the dev server instead");
  const response = await page.goto("/dev/components/cards");
  expect(response?.status()).toBe(404);
});

const devUrl = process.env.E2E_DEV_BASE_URL;
const url = (query = "") => (devUrl ? new URL(`/dev/components/cards${query}`, devUrl).href : "");

/** Sideways scroll on the page, and any card whose text spills out of it (the rail scrolls on purpose). */
async function overflows(page: Page) {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const cards = [...document.querySelectorAll<HTMLElement>("main article, main section[aria-label], main [class*='kpi'], main [class*='stat']")];
    const spilled = cards
      .filter((card) => !(card instanceof SVGElement) && !card.closest("ul[class*='rail'], [aria-hidden=true]"))
      .flatMap((card) => {
        const box = card.getBoundingClientRect();
        const out = box.left < -1 || box.right > width + 1 ? [`off screen: ${card.textContent?.slice(0, 30)}`] : [];
        const inner = [...card.querySelectorAll<HTMLElement>("*")]
          .filter((el) => getComputedStyle(el).position !== "absolute" || el.tagName === "SPAN")
          .filter((el) => {
            const b = el.getBoundingClientRect();
            return b.width > 0 && (b.right > box.right + 1 || b.left < box.left - 1);
          })
          .filter((el) => !el.closest("[aria-hidden=true]"))
          .map((el) => `spills: ${el.textContent?.slice(0, 30)}`);
        return [...out, ...inner];
      });
    return { page: document.documentElement.scrollWidth - width, spilled };
  });
}

test.describe("/dev/components/cards", () => {
  test.skip(!devUrl, "set E2E_DEV_BASE_URL to a running `npm run dev` to check the dev-only page");

  for (const viewport of VIEWPORTS) {
    test(`${viewport.name} (${viewport.width}px): no axe violations, no sideways scroll, nothing spills`, async ({ browser }) => {
      test.setTimeout(120_000); // three modes of a long page, each checked by axe
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
      const page = await context.newPage();
      for (const mode of ["", "?mode=trade", "?mode=office"]) {
        await page.goto(url(mode));
        await expect(page.getByRole("heading", { name: "Cards, tiles and rows" })).toBeVisible();
        expect(await overflows(page), mode || "customer").toEqual({ page: 0, spilled: [] });
        await expectNoA11yViolations(page);
      }
      await context.close();
    });
  }

  test("each card is one link: a click anywhere on it opens it, and its name is just the title", async ({ page }) => {
    await page.goto(url());
    const row = page.getByRole("list", { name: "Your jobs" }).getByRole("article").first();
    await expect(row.getByRole("link")).toHaveCount(1);
    await expect(row.getByRole("link")).toHaveAccessibleName("Sub wiring");
    await row.scrollIntoViewIfNeeded();
    const box = (await row.boundingBox())!;
    await page.mouse.click(box.x + box.width - 20, box.y + 12); // the price corner, nowhere near the title
    await expect(page).toHaveURL(/1005$/); // (signed out, /jobs/1005 sends you to log in first)

    await page.goto(url());
    const tile = page.getByRole("list", { name: "Jobs near you", exact: true }).getByRole("article").first();
    await expect(tile.getByRole("link", { name: "Sub wiring" })).toHaveAccessibleDescription("You earn $259");
    await tile.scrollIntoViewIfNeeded();
    const tileBox = (await tile.boundingBox())!;
    await page.mouse.click(tileBox.x + tileBox.width / 2, tileBox.y + tileBox.height / 2);
    await expect(page).toHaveURL(/t1$/);
  });

  test("a row's own button is pressed by itself, not the row", async ({ page }) => {
    await page.goto(url());
    await page.getByRole("link", { name: "See price" }).click();
    await expect(page).toHaveURL(/1005#price$/);
  });

  test("Save toggles, keeps focus, and pops once when it becomes saved (M23)", async ({ page }) => {
    await page.goto(url());
    const save = page.getByRole("list", { name: "Jobs near you (phone)" }).getByRole("button", { name: "Save Sub wiring" });
    await expect(save).toHaveAttribute("aria-pressed", "false");
    await save.focus();
    await page.keyboard.press("Enter");
    await expect(save).toHaveAttribute("aria-pressed", "true");
    await expect(save).toBeFocused();
    await expect(save.locator("xpath=../..")).toHaveClass(/tm-anim-save/);
    await page.keyboard.press("Space");
    await expect(save).toHaveAttribute("aria-pressed", "false");
    // Saving one tile doesn't open it.
    await expect(page).toHaveURL(url());
  });

  test("keyboard: Tab reaches each card's link with a visible ring; a greyed-out trade isn't a stop", async ({ page }) => {
    await page.goto(url());
    const rail = page.getByRole("list", { name: "Browse by trade" });
    await rail.getByRole("link", { name: "Electrical" }).focus();
    const ring = await rail.getByRole("article").first().evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(ring).toBe("solid");
    await page.keyboard.press("Tab");
    await expect(rail.getByRole("link", { name: "Other" })).toBeFocused(); // Plumbing (not verified) is skipped
    await expect(rail.getByText("Not verified")).toBeVisible();
    await expect(rail.getByRole("link", { name: "Plumbing" })).toHaveCount(0);
  });

  test("hover lifts a tile 2px and zooms its photo (M03)", async ({ page }) => {
    await page.goto(url());
    const tile = page.getByRole("list", { name: "Jobs near you", exact: true }).getByRole("article").nth(1);
    await tile.hover();
    await expect.poll(() => tile.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m42)).toBeCloseTo(-2, 0);
    await expect.poll(() => tile.locator("img").evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a)).toBeCloseTo(1.04, 2);
  });

  test("long text: titles end in “…” with the whole title as the tooltip", async ({ page }) => {
    await page.goto(url());
    const row = page.getByRole("list", { name: "Long rows" }).getByRole("link");
    await expect(row).toHaveAttribute("title", /^Replace the whole switchboard/);
    expect(await row.evaluate((el) => el.scrollWidth > el.clientWidth && getComputedStyle(el).textOverflow === "ellipsis")).toBe(true);
    const tile = page.getByRole("list", { name: "Edge cases" }).getByRole("link", { name: /^Replace the whole/ });
    expect(await tile.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true); // clamped to two lines
  });

  test("category tiles scroll sideways inside their row on a phone, never the page", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url());
    const rail = page.getByRole("list", { name: "What needs doing?" });
    expect(await rail.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    expect(await overflows(page)).toEqual({ page: 0, spilled: [] });
  });

  test("KPI numbers count up to the final value, and an overdue card is marked", async ({ page }) => {
    await page.goto(url("#numbers"));
    const card = page.getByRole("link", { name: "To price" }).locator("xpath=..");
    await expect(card).toHaveAttribute("data-alert", "true");
    await expect(card).toContainText("4");
    await expect(page.getByText("$3,452.80").first()).toBeVisible();
  });

  test("still usable at 200% zoom: nothing spills and the page doesn't scroll sideways", async ({ browser }) => {
    // A 1280 × 800 window at 200% is a 640 × 400 page drawn at twice the size.
    const context = await browser.newContext({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    await page.goto(url());
    await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
    expect(await overflows(page)).toEqual({ page: 0, spilled: [] });
    await context.close();
  });
});
