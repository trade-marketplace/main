import { expect, type Page, test } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

// /dev/components/media (#81) is a development-only page. `npm run e2e` runs the production build, where it must be
// a 404. To check the page itself, start `npm run dev` and point these tests at it:
//   E2E_DEV_BASE_URL=http://localhost:3000 npx playwright test tests/e2e/dev-media.spec.ts

test("/dev/components/media is not in production builds", async ({ page }) => {
  test.skip(Boolean(process.env.E2E_DEV_BASE_URL), "checking the dev server instead");
  const response = await page.goto("/dev/components/media");
  expect(response?.status()).toBe(404);
});

const devUrl = process.env.E2E_DEV_BASE_URL;
const url = () => (devUrl ? new URL("/dev/components/media", devUrl).href : "");
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const computer = (page: Page) => page.getByRole("region", { name: /Drop zone and photo picker/ });

// A tiny real JPEG (1×1 px), so the picker gets a file the browser can preview.
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);

test.describe("/dev/components/media", () => {
  test.skip(!devUrl, "set E2E_DEV_BASE_URL to a running `npm run dev` to check the dev-only page");

  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: no axe violations and no sideways scroll`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
      const page = await context.newPage();
      await page.goto(url());
      await expect(page.getByRole("heading", { level: 1, name: "Upload, photos and avatars" })).toBeVisible();
      expect(await overflow(page)).toBe(0);
      await expectNoA11yViolations(page);
      await context.close();
    });
  }

  test("choosing files: previews appear, upload, and bad files are explained", async ({ page }) => {
    await page.goto(url());
    const region = computer(page);
    const chooser = page.waitForEvent("filechooser");
    await region.getByRole("button", { name: "choose files" }).click();
    await (await chooser).setFiles([
      { name: "kitchen.jpg", mimeType: "image/jpeg", buffer: JPEG },
      { name: "plan.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") },
    ]);
    await expect(region.getByRole("img", { name: "Photo 5: kitchen.jpg" })).toBeVisible();
    await expect(region.getByRole("progressbar", { name: "Uploading kitchen.jpg" })).toBeVisible();
    await expect(region.getByRole("alert")).toContainText("“plan.pdf” isn’t a photo we can use.");
    await expect(region.getByText("5 of 6 · JPG, PNG or HEIC up to 10 MB each")).toBeVisible();
    await expect(region.getByRole("progressbar", { name: "Uploading kitchen.jpg" })).toBeHidden({ timeout: 5000 });
  });

  test("Retry starts a failed upload again; remove has Undo", async ({ page }) => {
    await page.goto(url());
    const region = computer(page);
    await region.getByRole("button", { name: "Retry switch.jpg" }).click();
    await expect(region.getByRole("progressbar", { name: "Uploading switch.jpg" })).toBeVisible();

    await region.getByRole("button", { name: "Remove wires.jpg" }).click();
    await expect(region.getByRole("img", { name: /wires\.jpg/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(region.getByRole("img", { name: "Photo 1: wires.jpg" })).toBeVisible();
  });

  test("dragging files over the drop zone shows the drag-over state (M26)", async ({ page }) => {
    await page.goto(url());
    const zone = computer(page).locator(".tm-dropzone");
    const data = await page.evaluateHandle(() => new DataTransfer());
    await zone.dispatchEvent("dragenter", { dataTransfer: data });
    await expect(zone).toHaveAttribute("data-over", "true");
    await zone.dispatchEvent("dragleave", { dataTransfer: data });
    await expect(zone).toHaveAttribute("data-over", "false");
  });

  test("the viewer: opens from a photo, arrows move, Esc closes and focus returns", async ({ page }) => {
    await page.goto(url());
    const thumb = page.getByRole("button", { name: "Open photo 2 of 4: Scorched power point" });
    await thumb.click();
    const viewer = page.getByRole("dialog", { name: "Photos of Sub wiring" });
    await expect(viewer).toBeVisible();
    await expect(viewer.getByText("2 of 4")).toBeVisible();
    await expect(viewer.getByRole("img", { name: "Scorched power point" })).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(viewer.getByText("3 of 4")).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(viewer.getByText("1 of 4")).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(viewer.getByText("4 of 4")).toBeVisible();
    await expectNoA11yViolations(page);
    await page.keyboard.press("Escape");
    await expect(viewer).toBeHidden();
    await expect(thumb).toBeFocused();
  });

  test("star input works by keyboard and says the chosen words", async ({ page }) => {
    await page.goto(url());
    const group = page.getByRole("group", { name: "How did Jack do?" }).first();
    await group.getByRole("radio", { name: "4 stars, Great" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(group.getByRole("radio", { name: "5 stars, Excellent" })).toBeChecked();
    await expect(group.getByText("Excellent", { exact: true })).toBeVisible();
  });

  test("200% text: nothing spills", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url());
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    expect(await overflow(page)).toBe(0);
  });
});
