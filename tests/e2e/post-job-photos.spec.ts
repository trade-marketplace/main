import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const dev = process.env.E2E_DEV_BASE_URL;
test.use({ reducedMotion: "reduce" });
const input = (page: import("@playwright/test").Page) => page.locator('input[type="file"]').last();
async function describe(page: import("@playwright/test").Page) {
  await page.goto("/jobs/new"); await page.getByRole("textbox", { name: "Describe the job", exact: true }).fill("Lights and wiring in the lounge need checking.");
  await page.getByRole("button", { name: "Next", exact: true }).click(); await expect(page.getByRole("heading", { name: "Add some photos", exact: true })).toBeVisible();
}
test("guest multi-picker: immediate previews → resize/draft → cover/menu → remove/paused Undo → Back/refresh → Next", async ({ page }) => {
  test.setTimeout(90_000); const uploads: string[] = []; page.on("request", request => { if (request.url().includes("/api/jobs/draft-photos")) uploads.push(request.url()); });
  await page.setViewportSize({ width: 390, height: 844 }); await describe(page);
  await expect(page.getByRole("button", { name: "Add photos", exact: true })).toBeVisible();
  const chooserEvent = page.waitForEvent("filechooser"); await page.getByRole("button", { name: "Add photos", exact: true }).click(); const chooser = await chooserEvent;
  expect(chooser.isMultiple()).toBe(true); expect(await input(page).getAttribute("accept")).toBe("image/*");
  const bytes = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: "red" } }).jpeg().toBuffer();
  await chooser.setFiles([{ name: "wide.jpg", mimeType: "image/jpeg", buffer: bytes }, { name: "close.jpg", mimeType: "image/jpeg", buffer: bytes }]);
  await expect(page.getByRole("img", { name: "Photo 1: wide.jpg", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Next", exact: true })).not.toHaveAttribute("aria-disabled", "true");
  const stored = await page.evaluate(async () => new Promise<{ name: string; width: number; height: number }[]>((resolve, reject) => {
    const request = indexedDB.open("trade.job-photos.v1", 1); request.onerror = () => reject(request.error); request.onsuccess = () => {
      const db = request.result; const all = db.transaction("drafts").objectStore("drafts").getAll(); all.onsuccess = async () => { const files = (all.result as { file: File; name: string }[][]).flat(); resolve(await Promise.all(files.map(async photo => { const bitmap = await createImageBitmap(photo.file); const output = { name: photo.name, width: bitmap.width, height: bitmap.height }; bitmap.close(); return output; }))); db.close(); };
    };
  }));
  expect(stored).toEqual([{ name: "wide.jpg", width: 2000, height: 1500 }, { name: "close.jpg", width: 2000, height: 1500 }]);
  expect(uploads).toEqual([]);
  await page.getByRole("button", { name: "Photo options close.jpg", exact: true }).press("Enter"); await page.getByRole("menuitem", { name: "Make cover", exact: true }).press("Enter");
  await expect(page.getByRole("list", { name: "Photos", exact: true }).getByRole("img").first()).toHaveAttribute("alt", "Photo 1: close.jpg");
  await page.getByRole("button", { name: "Remove close.jpg", exact: true }).click();
  const undo = page.getByRole("button", { name: "Undo", exact: true }); await undo.focus(); await page.waitForTimeout(5200); await undo.press("Enter");
  await expect(page.getByRole("list", { name: "Photos", exact: true }).getByRole("img").first()).toHaveAttribute("alt", "Photo 1: close.jpg");
  await page.getByRole("link", { name: "Back", exact: true }).click(); await expect(page.getByRole("textbox", { name: "Describe the job", exact: true })).toHaveValue("Lights and wiring in the lounge need checking.");
  await page.getByRole("button", { name: "Next", exact: true }).click(); await expect(page.getByRole("heading", { name: "Add some photos", exact: true })).toBeVisible(); await page.reload();
  await expect(page.getByRole("list", { name: "Photos", exact: true }).getByRole("img").first()).toHaveAttribute("alt", "Photo 1: close.jpg");
  await page.getByRole("button", { name: "Next", exact: true }).click(); await expect(page.getByRole("heading", { name: "Where & when", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Back", exact: true }).click(); await expect(page.getByRole("heading", { name: "Add some photos", exact: true })).toBeVisible(); await expectNoA11yViolations(page);
});

test("no photos is allowed with the nudge; HEIC uses a clean grid and sidebar fallback; wrong files stay isolated", async ({ page }) => {
  await describe(page); await expect(page.getByText("Photos get you a price faster", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click(); await expect(page.getByRole("heading", { name: "Where & when", exact: true })).toBeVisible(); await page.getByRole("link", { name: "Back", exact: true }).click();
  await input(page).setInputFiles([{ name: "IMG_1001.HEIC", mimeType: "image/heic", buffer: Buffer.from("0000ftypheic") }, { name: "notes.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7") }]);
  await expect(page.getByRole("button", { name: "Next", exact: true })).not.toHaveAttribute("aria-disabled", "true");
  await expect(page.getByRole("list", { name: "Photos", exact: true }).getByRole("img", { name: "Photo 1: IMG_1001.HEIC", exact: true })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Your job" }).getByRole("img", { name: "Photo 1: IMG_1001.HEIC", exact: true })).toBeVisible();
  await expect(page.getByText(/notes.pdf.*isn’t a photo/)).toBeVisible();
  await expect.poll(() => page.locator('img[src^="blob:"]').count()).toBe(0); await expectNoA11yViolations(page);
});

test("desktop drop and drag reorder preserve the cover; keyboard move controls remain available", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 }); await describe(page);
  const bytes = await sharp({ create: { width: 80, height: 60, channels: 3, background: "green" } }).jpeg().toBuffer();
  const transfer = await page.evaluateHandle(base64 => {
    const bytes = Uint8Array.from(atob(base64), value => value.charCodeAt(0)); const transfer = new DataTransfer();
    for (const name of ["wide.jpg", "close.jpg"]) transfer.items.add(new File([bytes], name, { type: "image/jpeg" }));
    return transfer;
  }, bytes.toString("base64"));
  await page.locator(".tm-dropzone").dispatchEvent("drop", { dataTransfer: transfer }); await transfer.dispose();
  const grid = page.getByRole("list", { name: "Photos", exact: true });
  await expect(grid.getByRole("img")).toHaveCount(2); await expect(page.getByRole("button", { name: "Next", exact: true })).not.toHaveAttribute("aria-disabled", "true");
  await grid.locator("[data-photo-id]").nth(1).dragTo(grid.locator("[data-photo-id]").first());
  await expect(grid.getByRole("img").first()).toHaveAttribute("alt", "Photo 1: close.jpg");
  await page.getByRole("button", { name: "Photo options close.jpg", exact: true }).press("Enter"); await page.getByRole("menuitem", { name: "Move right", exact: true }).press("Enter");
  await expect(grid.getByRole("img").first()).toHaveAttribute("alt", "Photo 1: wide.jpg");
  await page.getByRole("button", { name: "Photo options close.jpg", exact: true }).press("Enter"); await page.getByRole("menuitem", { name: "Move left", exact: true }).press("Enter");
  await expect(grid.getByRole("img").first()).toHaveAttribute("alt", "Photo 1: close.jpg"); await expectNoA11yViolations(page);
});

test.describe("guarded photo states", () => {
  test.skip(!dev, "requires the guarded development/screenshot server");
  for (const viewport of VIEWPORTS) test(`${viewport.width}px: photo states fit and pass axe`, async ({ page }) => {
    test.setTimeout(180_000); await page.setViewportSize(viewport);
    for (const state of ["empty", "picking", "uploading", "failed", "full", "drag-over", "offline", "invalid", "removed", "heic", "loading", "save-error", "where-when", "conflict"]) {
      await page.goto(new URL(`/dev/components/post-job-photos?state=${state}`, dev).href);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(state === "where-when" ? "Where & when" : "Add some photos");
      for (const tile of await page.locator('[data-reorder="true"]').all()) { const box = await tile.boundingBox(); expect(Math.abs(box!.width - box!.height), `${state}: square thumbnail`).toBeLessThan(1); }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), state).toBe(0); await expectNoA11yViolations(page);
      if (state === "conflict") { await expect(page.getByRole("button", { name: "Next", exact: true })).toHaveAttribute("aria-disabled", "true"); await expect(page.getByText(/^6 of 6 ·/)).toBeVisible(); await expect(page.getByText(/^12 of 6/)).toHaveCount(0); }
    }
  });
});
