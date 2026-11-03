import { expect, test } from "@playwright/test";
import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const dev = process.env.E2E_DEV_BASE_URL;
const url = (query = "state=thread") => new URL(`/dev/components/problem-threads?${query}`, dev).href;
test("messages require login with the destination preserved", async ({ page }) => {
  await page.goto("/messages"); await expect(page).toHaveURL(/\/login\?next=%2Fmessages$/);
});
test("photo uploads reject signed-out and cross-site requests", async ({ request, baseURL }) => {
  const body = { jobId: "20000000-0000-4000-8000-000000000001", photo: { name: "photo.png", mimeType: "image/png", buffer: Buffer.from("fixture") } };
  expect((await request.post("/api/messages/photos", { multipart: body, headers: { origin: "https://other.example" } })).status()).toBe(403);
  const origin = new URL(baseURL!).origin;
  expect((await request.post("/api/messages/photos", { multipart: body, headers: { origin } })).status()).toBe(401);
});
test("problem thread fixtures are guarded in production", async ({ page }) => {
  test.skip(Boolean(dev), "using guarded local fixtures");
  expect((await page.goto("/dev/components/problem-threads"))?.status()).toBe(404);
});
test.describe("job problem threads", () => {
  test.skip(!dev, "set E2E_DEV_BASE_URL for local fixtures");
  test.use({ reducedMotion: "reduce" });
  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: every state and role fit and pass axe`, async ({ page }) => {
      test.setTimeout(240_000); await page.setViewportSize(viewport);
      for (const mode of ["customer", "trade"]) for (const state of ["empty", "thread", "offline", "error", "loading"]) {
        await page.goto(url(`state=${state}&mode=${mode}`));
        await expect(page.getByRole("heading", { name: "Messages", exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), `${mode}/${state}`).toBe(false);
        await expectNoA11yViolations(page);
      }
    });
  }
  test("Enter sends once, Shift+Enter keeps a newline, and only the last own message has a receipt", async ({ page }) => {
    await page.goto(url()); const message = page.getByRole("textbox", { name: "Message", exact: true });
    await message.fill("First line"); await message.press("Shift+Enter"); await message.pressSequentially("Second line");
    await expect(message).toHaveValue("First line\nSecond line"); await message.press("Enter");
    await expect(message).toHaveValue(""); await expect(page.getByRole("log")).toContainText("First line\nSecond line");
    await expect(page.getByText("Sent", { exact: true })).toHaveCount(1);
    await message.fill("Another message"); await message.press("Enter");
    await expect(page.getByText("Sent", { exact: true })).toHaveCount(1);
  });
  test("draft text survives Back, another thread, reload and localStorage being unavailable", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto(url());
    const message = page.getByRole("textbox", { name: "Message", exact: true }); await message.fill("Unsent first thread");
    await page.getByRole("link", { name: "Back", exact: true }).click();
    await page.getByRole("link", { name: /Payment question/ }).click();
    await expect(message).toHaveValue(""); await message.fill("Unsent second thread");
    await page.getByRole("link", { name: "Back", exact: true }).click(); await page.getByRole("link", { name: /Job support/ }).click();
    await expect(message).toHaveValue("Unsent first thread"); await page.reload(); await expect(message).toHaveValue("Unsent first thread");
    await page.addInitScript(() => { Object.defineProperty(Storage.prototype, "setItem", { value() { throw new Error("blocked"); } }); Object.defineProperty(Storage.prototype, "getItem", { value() { throw new Error("blocked"); } }); });
    await page.reload(); await message.fill("Works without storage"); await message.press("Enter"); await expect(message).toHaveValue("");
  });
  test("offline disables sending and failed sends keep the typed text", async ({ page }) => {
    await page.goto(url("state=offline")); const message = page.getByRole("textbox", { name: "Message", exact: true });
    await message.fill("Kept offline"); await expect(page.getByRole("button", { name: "Send", exact: true })).toHaveAttribute("aria-disabled", "true");
    await message.press("Enter"); await expect(message).toHaveValue("Kept offline");
    await page.goto(url("state=error")); await message.fill("Still here after failure"); await message.press("Enter");
    await expect(page.getByRole("region", { name: "Messages", exact: true }).getByRole("alert")).toContainText("Your message wasn’t sent."); await expect(message).toHaveValue("Still here after failure");
  });
  test("context opens at tablet width and keyboard opens a new job request", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 }); await page.goto(url());
    const context = page.getByRole("button", { name: "Job context", exact: true }); await context.press("Enter");
    await expect(context).toHaveAttribute("aria-pressed", "true"); await expect(page.getByText("Windsor", { exact: true }).first()).toBeVisible();
    await context.press("Enter"); await expect(context).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", { name: "Ask about a job", exact: true }).first().press("Enter");
    await page.getByRole("textbox", { name: "Subject", exact: true }).fill("Problem with the work");
    await page.getByRole("textbox", { name: "Message", exact: true }).fill("Please check the photos.");
    await page.getByRole("button", { name: "Send request", exact: true }).press("Enter");
    await expect(page.getByRole("heading", { name: "Job support", exact: true })).toBeVisible();
  });
  test("photo controls support upload, removal and recoverable upload failure", async ({ page }) => {
    await page.goto(url()); const input = page.getByLabel("Add photo", { exact: true });
    await input.setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: Buffer.from("test fixture") });
    await expect(page.getByRole("button", { name: "Remove photo.png", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Remove photo.png", exact: true }).click();
    await expect(page.getByRole("button", { name: "Remove photo.png", exact: true })).toHaveCount(0);
    await input.setInputFiles({ name: "fail.png", mimeType: "image/png", buffer: Buffer.from("test fixture") });
    await expect(page.getByRole("region", { name: "Messages", exact: true }).getByRole("alert")).toContainText("Your photo wasn’t uploaded.");
  });
});
