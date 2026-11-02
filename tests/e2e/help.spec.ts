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
        if (route.includes("q=pay")) await expect(page.getByRole("combobox")).toHaveValue("pay");
        if (route.includes("state=no-results")) await expect(page.getByRole("heading", { name: "No articles found", exact: true })).toBeVisible();
        if (route.includes("state=loading")) await expect(page.locator('[aria-busy="true"]').first()).toBeVisible();
        if (route.includes("state=error")) await expect(page.getByRole("heading", { name: "Can’t load help articles", exact: true })).toBeVisible();
        if (route.includes("state=helpful-voted")) await expect(page.getByRole("status").filter({ hasText: "Thanks for your feedback." })).toBeVisible();
        if (route.includes("state=not-helpful")) await expect(page.getByRole("textbox", { name: "What were you looking for?" })).toBeVisible();
        if (route.includes("state=feedback-error")) await expect(page.getByText("Couldn’t save your feedback. Try again.").first()).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await expectNoA11yViolations(page);
      }
    });
  });
}
test("search suggestions support slash, arrows, Enter, Escape and a real article journey", async ({ page }) => {
  await page.goto("/help"); await page.keyboard.press("/");
  const search = page.getByRole("combobox"); await expect(search).toBeFocused();
  await search.fill("When do I"); await expect(page.getByRole("option").first()).toHaveText("When do I pay?"); await expectNoA11yViolations(page);
  await search.press("Escape"); await expect(page.getByRole("listbox")).toHaveCount(0); await expect(search).toHaveValue("When do I");
  await search.press("ArrowDown"); await search.press("Enter");
  await expect(page).toHaveURL(/\/help\/when-do-i-pay$/); await expect(page.getByRole("heading", { name: "When do I pay?", exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Help", exact: true }).click();
  await expect(page).toHaveURL(/\/help$/); await expect(page.getByRole("heading", { name: "Getting started", exact: true })).toBeVisible();
});
test("home groups every article under the six topics, with the intro line and topic cards", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto("/help"); await page.locator("[data-help-ready=true]").waitFor();
  await expect(page.getByText("Answers about posting jobs, prices, payments and doing the work.", { exact: true })).toBeVisible();
  const topics = ["Getting started", "Customers", "Workers & tradies", "Payments", "Account", "Safety & trust"];
  const list = page.getByRole("region", { name: "Help articles" });
  for (const topic of topics) { await expect(list.getByRole("button", { name: topic, exact: true })).toBeVisible(); await expect(list.getByRole("heading", { level: 2, name: topic, exact: true })).toBeVisible(); }
  await expect(list.getByRole("link", { name: "Paying safely" })).toBeVisible();
  await list.getByRole("button", { name: "Safety & trust", exact: true }).click();
  await expect(list.getByRole("button", { name: "Safety & trust", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(list.getByRole("link")).toHaveCount(3);
  await list.getByRole("link", { name: "How do you check workers?" }).click();
  await expect(page).toHaveURL(/\/help\/how-do-you-check-workers$/);
  await expect(page.getByRole("navigation", { name: "Safety & trust help articles" }).getByRole("link", { name: "How do you check workers?" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("complementary").getByRole("link", { name: "Who will do my job?" })).toBeVisible();
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Safety & trust", exact: true }).click();
  await expect(page).toHaveURL(/\/help\?topic=safety-trust$/);
  await expect(page.getByRole("region", { name: "Help articles" }).getByRole("button", { name: "Safety & trust", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.goBack(); await expect(page).toHaveURL(/\/help\/how-do-you-check-workers$/);
});
test("phone FAQ, topic filters and article back navigation work", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/help");
  await page.getByRole("button", { name: "When do I pay?", exact: true }).click();
  await expect(page.getByText("That locks in your booking.", { exact: false })).toBeVisible();
  await page.locator("#answer-when-do-i-pay").getByRole("link", { name: "Read article" }).click();
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
test("unknown articles, and articles held for a founder to confirm, return a real 404", async ({ page }) => {
  for (const slug of ["not-a-real-article", "refunds", "what-will-i-earn"]) { const response = await page.goto(`/help/${slug}`); expect(response?.status()).toBe(404); }
});
test("phone shell is correct before hydration", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto("/help");
  await expect(page.getByRole("navigation", { name: "Main", exact: true })).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "Help & support", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await context.close();
});
