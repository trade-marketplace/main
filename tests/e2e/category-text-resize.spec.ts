import { expect, type Locator, test } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";

/** Check the text boxes as well as the tile: a visible heading can still spill below a fixed card. */
async function expectReadable(tiles: Locator) {
  expect(await tiles.evaluateAll((cards) => cards.flatMap((card) => {
    const box = card.getBoundingClientRect();
    return [...card.querySelectorAll<HTMLElement>("h3, article > span:not([aria-hidden])")].flatMap((text) => {
      const bounds = text.getBoundingClientRect();
      return bounds.left < box.left || bounds.right > box.right || bounds.bottom > box.bottom ||
        text.scrollHeight > text.clientHeight + 1 || text.scrollWidth > text.clientWidth + 1
        ? [text.textContent] : [];
    });
  }))).toEqual([]);
}

test.use({ reducedMotion: "reduce" });

for (const width of [320, 390, 640, 768, 1024, 1440]) {
  test(`${width}px: category names and sublabels fit at default and 200% text`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    // Hydration can reset attributes added to <html>; don't let a reset text size produce a false pass.
    await expect(page.locator("header[data-solid]")).toHaveAttribute("data-solid", /true|false/);
    await page.evaluate(() => document.fonts.ready);
    const rootFontSize = await page.locator("html").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    const rail = page.getByRole("list", { name: "Trades", exact: true });
    const tiles = rail.getByRole("article");
    await expect(tiles).toHaveCount(5);
    for (const scale of ["", "200%"]) {
      await page.evaluate(async (size) => {
        document.documentElement.style.fontSize = size;
        document.body.getBoundingClientRect(); // Flush text-size layout before waiting for any newly selected fonts.
        await document.fonts.ready;
      }, scale);
      await expect(page.locator("html")).toHaveCSS("font-size", `${rootFontSize * (scale ? 2 : 1)}px`);
      await expectReadable(tiles);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
      for (const tile of await tiles.all()) {
        if (!scale) {
          expect((await tile.boundingBox())!.width).toBe(159);
          expect((await tile.boundingBox())!.height).toBe(162);
        }
      }
      if (width < 1024) {
        expect(await rail.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
        await rail.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
        await expect.poll(() => tiles.last().evaluate((el) => {
          const card = el.getBoundingClientRect();
          const rail = el.closest("ul")!.getBoundingClientRect();
          return card.left >= rail.left - 1 && card.right <= rail.right + 1;
        })).toBe(true);
      }
      await expectNoA11yViolations(page, { include: "section[aria-labelledby='category-heading']" });
    }
  });
}

test("200% text: keyboard reaches every category and starts the selected job", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 900 });
  await page.goto("/");
  await expect(page.locator("header[data-solid]")).toHaveAttribute("data-solid", /true|false/);
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await expect(page.locator("html")).toHaveCSS("font-size", "32px");
  const rail = page.getByRole("list", { name: "Trades", exact: true });
  const links = rail.getByRole("link");
  await links.first().focus();
  for (let index = 0; index < 5; index++) {
    if (index) await page.keyboard.press("Tab");
    await expect(links.nth(index)).toBeFocused();
    await expect(links.nth(index)).toBeInViewport();
    await expect(rail.getByRole("article").nth(index)).toHaveCSS("outline-style", "solid");
  }
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/login\?next=/);
  const next = new URL(new URL(page.url()).searchParams.get("next")!, "https://example.test");
  expect(next.pathname).toBe("/jobs/new");
  expect(next.searchParams.get("type")).toBe("other");
});

test("200% text: shared kit disabled reasons and long sublabels fit in every mode", async ({ page }) => {
  test.skip(!process.env.E2E_DEV_BASE_URL, "requires the guarded local component fixture");
  await page.setViewportSize({ width: 640, height: 900 });
  for (const mode of ["customer", "trade", "office"]) {
    await page.goto(new URL(`/dev/components/cards?mode=${mode}`, process.env.E2E_DEV_BASE_URL).href);
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    await page.evaluate(() => document.fonts.ready);
    await expectReadable(page.locator("article[data-category]"));
    await expect(page.getByText("Not verified", { exact: true })).toBeVisible();
    await expect(page.getByRole("list", { name: "Browse by trade" }).getByRole("link", { name: "Plumbing" })).toHaveCount(0);
    await expectNoA11yViolations(page, { include: "#categories" });
  }
});
