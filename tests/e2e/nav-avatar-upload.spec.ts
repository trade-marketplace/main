import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";

// Run against a throwaway local database and Auth/Storage adapters; never production credentials.
const app = process.env.AVATAR_E2E_APP_URL;
const cookieFile = process.env.AVATAR_E2E_COOKIE_FILE;
const storage = process.env.AVATAR_E2E_STORAGE_URL;
for (const value of [app, storage]) {
  if (value && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname)) {
    throw new Error("Avatar E2E URLs must use loopback test servers.");
  }
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
  await expect(page).not.toHaveTitle("");
  await expectNoA11yViolations(page);
});

test("opening the phone account menu refreshes a signed photo that expired before its first request", async ({ page, context }) => {
  test.skip(!app || !cookieFile || !storage, "Requires local avatar fixtures with signed-link expiry control.");
  await context.addCookies(JSON.parse(readFileSync(cookieFile!, "utf8")));
  const uploaded = await context.request.post(new URL("/api/profile/avatar", app).href, {
    headers: { origin: new URL(app!).origin },
    multipart: { photo: { name: "avatar.jpg", mimeType: "image/jpeg", buffer: readFileSync(new URL("../../public/images/examples/outlet.jpg", import.meta.url)) } },
  });
  expect(uploaded.ok()).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(new URL("/dashboard", app).href);
  const account = page.getByRole("button", { name: "Account: Sarah Thompson", exact: true });
  await expect(account).toBeVisible();
  expect((await context.request.post(new URL("/__expire", storage).href)).ok()).toBe(true);
  await account.click();
  const menu = page.getByRole("menu", { name: "Account", exact: true });
  await expect(menu).toBeVisible();
  const image = menu.locator("..").locator("img");
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(account).toBeFocused();
  await expect(page).not.toHaveTitle("");
  await expectNoA11yViolations(page);
});
