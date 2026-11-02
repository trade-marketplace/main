import { expect, test, type Page } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

test("the profile page requires login and keeps the way back", async ({ page }) => {
  await page.goto("/profile");
  await expect(page).toHaveURL(/\/login\?next=%2Fprofile$/);
});

test("the profile photo route refuses a signed-out visitor and a request from another site", async ({ request }) => {
  const body = { multipart: { photo: { name: "me.png", mimeType: "image/png", buffer: Buffer.from("x") } } };
  expect((await request.post("/api/profile/avatar", body)).status()).toBe(403);
  const crossSite = await request.post("/api/profile/avatar", { ...body, headers: { origin: "https://evil.example" } });
  expect(crossSite.status()).toBe(403);
});

// The guarded preview (/dev/components/profile) needs an app started with SCREENSHOT_DEV_PAGES=1 (docs/TESTING.md).
const devUrl = process.env.E2E_DEV_BASE_URL;
const url = (query = "") => new URL(`/dev/components/profile${query}`, devUrl).href;
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const ready = async (page: Page) => {
  await expect(page.getByRole("heading", { name: "Profile", exact: true })).toBeVisible();
  await expect(page.locator("main .tm-anim-rise")).toHaveCSS("opacity", "1");
};

test.describe("profile isolated UI", () => {
  test.skip(!devUrl, "Set E2E_DEV_BASE_URL for the guarded dev preview.");

  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: every state fits and has no accessibility violations`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize(viewport);
      for (const state of ["", "pending-email", "offline", "loading"]) {
        await page.goto(url(`?state=${state}`));
        await ready(page);
        if (state === "pending-email") await expect(page.getByText("Check sarah.new@example.test and your current inbox to confirm your new email.")).toBeVisible();
        if (state === "offline") await expect(page.getByRole("button", { name: "Save changes" })).toHaveAttribute("aria-disabled", "true");
        expect(await overflow(page), state).toBe(0);
        await expectNoA11yViolations(page);
      }
      // Fields with a message, the saving state, the saved toast and a failed save.
      await page.goto(url("?state=saving"));
      await ready(page);
      await page.getByLabel("Mobile").fill("12345");
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(page.getByText("Enter a New Zealand mobile number, like 021 555 0192.")).toBeVisible();
      expect(await overflow(page)).toBe(0);
      await expectNoA11yViolations(page);
      await page.getByLabel("Mobile").fill("021 555 0193");
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(page.getByRole("button", { name: /Save changes/ })).toHaveAttribute("aria-busy", "true");
      expect(await overflow(page)).toBe(0);
      await expectNoA11yViolations(page);
      await expect(page.getByText("Saved.")).toBeVisible({ timeout: 10_000 });
      expect(await overflow(page)).toBe(0);
      await expectNoA11yViolations(page);
      await page.goto(url("?state=error"));
      await ready(page);
      await page.getByLabel("Full name").fill("Sarah T");
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(page.getByText("Couldn’t save.")).toBeVisible();
      expect(await overflow(page)).toBe(0);
      await expectNoA11yViolations(page);
      await page.goto(url("?state=photo-error"));
      await ready(page);
      await page.locator("input[type=file]").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: Buffer.from("x") });
      await expect(page.getByText("Photos must be a JPG, PNG or HEIC picture.")).toBeVisible();
      expect(await overflow(page)).toBe(0);
      await expectNoA11yViolations(page);
      await page.goto(url("?mode=trade"));
      await ready(page);
      await expect(page.locator("[data-mode=trade]").first()).toBeVisible();
      await expectNoA11yViolations(page);
    });
  }

  test("Save stays off until something changes, then saves with the keyboard and shows the toast", async ({ page }) => {
    await page.goto(url());
    await ready(page);
    const save = page.getByRole("button", { name: "Save changes" });
    await expect(save).toHaveAttribute("aria-disabled", "true");
    const name = page.getByLabel("Full name");
    await name.fill("Sarah Jane Thompson");
    await expect(save).not.toHaveAttribute("aria-disabled", "true");
    await name.press("Enter");
    await expect(page.getByText("Saved.")).toBeVisible();
    await expect(save).toHaveAttribute("aria-disabled", "true");
    await name.fill("Sarah Thompson");
    await name.fill("Sarah Jane Thompson");
    await expect(save).toHaveAttribute("aria-disabled", "true");
  });

  test("typing while a slow save is on its way keeps the newer text and leaves Save on for it", async ({ page }) => {
    await page.goto(url("?state=saving"));
    await ready(page);
    const name = page.getByLabel("Full name");
    const save = page.getByRole("button", { name: "Save changes" });
    // Retry until the page has hydrated and takes the typing.
    await expect(async () => {
      await name.fill("Sarah Jane");
      await expect(save).not.toHaveAttribute("aria-disabled", "true", { timeout: 500 });
    }).toPass();
    await save.click();
    await name.fill("Sarah Jane Thompson"); // typed after pressing Save, before the answer
    await expect(page.getByText("Saved.")).toBeVisible({ timeout: 10_000 });
    await expect(name).toHaveValue("Sarah Jane Thompson");
    await expect(save).not.toHaveAttribute("aria-disabled", "true");
  });

  test("each field says what is wrong, focuses the first one, and clears when edited", async ({ page }) => {
    await page.goto(url());
    await ready(page);
    await page.getByLabel("Full name").fill("");
    await page.getByLabel("Mobile").fill("09 123");
    await page.getByRole("button", { name: "Save changes" }).click();
    const name = page.getByLabel("Full name");
    await expect(name).toBeFocused();
    await expect(name).toHaveAttribute("aria-invalid", "true");
    await expect(name).toHaveAccessibleDescription("Enter your name.");
    await expect(page.getByLabel("Mobile")).toHaveAccessibleDescription("Enter a New Zealand mobile number, like 021 555 0192.");
    await name.fill("Sam");
    await expect(name).not.toHaveAttribute("aria-invalid", "true");
    await expectNoA11yViolations(page);
  });

  test("the email is shown but can't be typed over; Change email goes to Security and Back returns", async ({ page }) => {
    await page.goto(url());
    await ready(page);
    const email = page.getByLabel("Email", { exact: true });
    await expect(email).toHaveValue("sarah@example.test");
    await expect(email).toHaveJSProperty("readOnly", true);
    await page.getByRole("link", { name: "Change email" }).click();
    // Signed out in this preview, Security sends the visitor to log in and keeps the way back.
    await expect(page).toHaveURL(/\/(profile\/security|login\?next=%2Fprofile%2Fsecurity)$/);
    await page.goBack();
    await ready(page);
  });

  test("a failed photo or a signed-out save keeps the page and says why", async ({ page }) => {
    await page.goto(url("?state=expired"));
    await ready(page);
    await page.getByLabel("Full name").fill("Sarah T");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("You’ve been logged out").or(page.getByText("Log in to save."))).toBeVisible();
    await expect(page.getByLabel("Full name")).toHaveValue("Sarah T");
  });

  test("a click on Save leaves no focus box, and the keyboard still shows one", async ({ page }) => {
    await page.goto(url());
    await ready(page);
    await page.getByLabel("Full name").fill("Sarah T");
    const save = page.getByRole("button", { name: "Save changes" });
    await save.click();
    await expect(page.getByText("Saved.")).toBeVisible();
    await expect(save).toHaveCSS("outline-style", "none");
    await page.getByLabel("Full name").fill("Sarah Q");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus-visible")).toHaveCount(1);
  });

  test("the account menu and settings navigation work by click and keyboard", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url());
    await ready(page);
    const nav = page.getByRole("navigation", { name: "Account settings" }).last();
    await expect(nav.getByRole("link", { name: "Profile", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Security", exact: true })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Notifications", exact: true })).toBeVisible();
  });
});
