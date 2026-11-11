import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";

// Run against a throwaway local database and Auth/Storage adapters; never production credentials.
const app = process.env.AVATAR_E2E_APP_URL;
const cookieFile = process.env.AVATAR_E2E_COOKIE_FILE;
if (app && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(app).hostname)) {
  throw new Error("AVATAR_E2E_APP_URL must use a loopback test server.");
}

test("saving a profile photo refreshes the real top bar and keeps it on navigation and Back", async ({ page, context }) => {
  test.skip(!app || !cookieFile, "Requires local avatar Auth/Storage fixtures and a throwaway database.");
  await context.addCookies(JSON.parse(readFileSync(cookieFile!, "utf8")));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(new URL("/profile", app).href);
  const account = page.getByRole("button", { name: "Account: Sarah Thompson", exact: true });
  await expect(account).toHaveText("ST");
  await page.locator("input[type=file]").setInputFiles({
    name: "avatar.jpg", mimeType: "image/jpeg", buffer: readFileSync(new URL("../../public/images/examples/outlet.jpg", import.meta.url)),
  });
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  await expect(account.locator("img")).toBeVisible();
  await expect.poll(() => account.locator("img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await page.getByRole("link", { name: "My jobs", exact: true }).click();
  await expect(page).toHaveURL(new URL("/dashboard", app).href);
  await expect(account.locator("img")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(new URL("/profile", app).href);
  await expect(account.locator("img")).toBeVisible();
  await expectNoA11yViolations(page);
});
