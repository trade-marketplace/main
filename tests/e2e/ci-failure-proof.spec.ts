import { expect, test } from "@playwright/test";

// TEMPORARY (#287): proves a failing e2e test turns CI red and attaches the report. Reverted in the next commit.
test("CI failure proof: fails on purpose", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "This heading does not exist" })).toBeVisible({
    timeout: 2_000,
  });
});
