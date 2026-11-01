import { expect, type Locator, test } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";

/** Inspect actual text lines as well as element boxes: a grid can fit while its text spills out. */
async function expectTextWithin(section: Locator) {
  expect(await section.evaluate((container) => {
    const box = container.getBoundingClientRect();
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const spills: string[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const parent = node.parentElement!;
      if (!node.textContent?.trim() || parent.closest('[aria-hidden="true"], [inert]')) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      if ([...range.getClientRects()].some((line) => line.width > 0 && (line.left < box.left || line.right > box.right))) {
        spills.push(node.textContent);
      }
    }
    return spills;
  })).toEqual([]);
}

test.use({ reducedMotion: "reduce" });

for (const width of [320, 390, 640, 768, 1024, 1440]) {
  test(`${width}px: landing grids wrap at 200% text without sideways scroll`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    // Wait for client hydration before changing <html>; React can otherwise reset the scale.
    await expect(page.locator("header[data-solid]")).toHaveAttribute("data-solid", /true|false/);
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator("html")).toHaveCSS("font-size", "16px");
    // Sections have their approved heading as an accessible name, including the phone's hidden how heading.
    const how = page.getByRole("region", { name: "Three taps. Job sorted." });
    const why = page.getByRole("region", { name: /No ringing around/ });
    const faq = page.getByRole("region", { name: "Questions?", exact: true });
    const before = await page.getByRole("main").innerText();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);

    await page.evaluate(async () => {
      document.documentElement.style.fontSize = "200%";
      document.body.getBoundingClientRect(); // Flush the resized layout before font readiness is checked.
      await document.fonts.ready;
    });
    await expect(page.locator("html")).toHaveCSS("font-size", "32px");
    await expect(page.locator("#faq-heading")).toHaveCSS("font-size", width < 1024 ? "56px" : "72px");
    await page.evaluate(() => document.fonts.ready);
    for (const step of await how.getByRole("article").all()) await expectTextWithin(step);
    for (const section of [why, faq]) await expectTextWithin(section);
    expect(await page.getByRole("main").innerText()).toBe(before);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);

    for (const question of await faq.getByRole("button").all()) {
      if (await question.getAttribute("aria-expanded") !== "true") await question.press("Enter");
      await expect(question).toHaveAttribute("aria-expanded", "true");
      await expectTextWithin(faq);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    }
    await expectNoA11yViolations(page);
    // Keep the assertion after interactions too, so a late reset cannot turn this into a false pass.
    await expect(page.locator("html")).toHaveCSS("font-size", "32px");
  });
}
