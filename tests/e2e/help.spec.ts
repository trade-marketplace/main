import { expect, test } from "@playwright/test";
import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";
for (const viewport of VIEWPORTS) {
  test.describe(`Help centre ${viewport.width}px`, () => {
    test.use({ viewport });
    test("home, article and every review state fit and remain accessible", async ({ page }) => {
      for (const route of ["/help", "/help?q=pay", "/help?state=no-results", "/help?state=loading", "/help?state=error", "/help/when-do-i-pay", "/help/when-do-i-pay?state=helpful-voted", "/help/when-do-i-pay?state=not-helpful", "/help/when-do-i-pay?state=feedback-error"]) {
        await page.goto(route); await expect(page.getByRole("searchbox").or(page.getByRole("combobox"))).toBeVisible();
        await page.locator("[data-help-ready=true]").waitFor(); await page.evaluate(() => document.fonts.ready);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await expectNoA11yViolations(page);
      }
    });
  });
}
test("search suggestions support slash, arrows, Enter, Escape and a real article journey", async ({ page }) => {
  await page.goto("/help"); await page.keyboard.press("/");
  const search = page.getByRole("combobox"); await expect(search).toBeFocused();
  await search.fill("When do I"); await expect(page.getByRole("option")).toHaveCount(1); await expectNoA11yViolations(page);
  await search.press("Escape"); await expect(page.getByRole("listbox")).toHaveCount(0); await expect(search).toHaveValue("When do I");
  await search.press("ArrowDown"); await search.press("Enter");
  await expect(page).toHaveURL(/\/help\/when-do-i-pay$/); await expect(page.getByRole("heading", { name: "When do I pay?", exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Help", exact: true }).click();
  await expect(page).toHaveURL(/\/help$/); await expect(page.getByRole("heading", { name: "Popular articles" })).toBeVisible();
});
test("phone FAQ, topic filters and article back navigation work", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/help");
  await page.getByRole("button", { name: "When do I pay?", exact: true }).click();
  await expect(page.getByText("That locks in your booking.", { exact: false })).toBeVisible();
  await page.getByRole("link", { name: "Read article" }).last().click();
  await expect(page).toHaveURL(/\/help\/when-do-i-pay$/);
  await page.getByRole("link", { name: "Back to help" }).click(); await expect(page).toHaveURL(/\/help$/);
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await expect(page.getByRole("button", { name: "Reset your password" })).toBeVisible();
});
test("feedback keeps the optional note and truthfully reports unavailable persistence", async ({ page }) => {
  await page.goto("/help/when-do-i-pay");
  await page.getByRole("button", { name: "No", exact: true }).click();
  const note = page.getByRole("textbox", { name: "What were you looking for?" });
  await expect(note).toBeFocused(); await note.fill("Where is my invoice?");
  await expect(page.getByText("Couldn’t save your feedback. Try again.").first()).toBeVisible();
  await page.getByRole("button", { name: "Send feedback" }).click();
  await expect(note).toHaveValue("Where is my invoice?"); await expect(page.getByText("Thanks for your feedback.")).toHaveCount(0);
});
test("unknown articles return a real 404", async ({ page }) => { const response = await page.goto("/help/not-a-real-article"); expect(response?.status()).toBe(404); });
