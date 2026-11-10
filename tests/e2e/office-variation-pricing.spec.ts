import { expect, test } from "@playwright/test";
import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";
const dev = process.env.E2E_DEV_BASE_URL;
const states = ["ready", "empty", "loading", "error", "offline", "confirm", "sent", "approved", "declined", "long", "changed", "payment-pending"];
const href = (state = "ready") => new URL(`/dev/components/office-variation-pricing?state=${state}`, dev!).href;
test("extra-work pricing dev page and calculator are production guarded", async ({ page }) => {
  test.skip(Boolean(dev), "preview run");
  expect((await page.goto("/dev/components/office-variation-pricing"))?.status()).toBe(404);
  expect((await page.request.post("/dev/components/office-variation-pricing/preview", { data: { hours: "1", materials: "0" } })).status()).toBe(404);
});
test.describe("office extra-work pricing states", () => {
  test.skip(!dev, "Set E2E_DEV_BASE_URL for guarded previews");
  test.use({ reducedMotion: "reduce" });
  for (const viewport of VIEWPORTS) test(`${viewport.width}px every request, empty, loading, error, offline, confirm, success, terminal and changed state fits and passes axe`, async ({ page }) => {
    test.setTimeout(240_000); await page.setViewportSize(viewport);
    for (const state of states) {
      await page.goto(href(state));
      if (state === "loading") await expect(page.getByLabel("Loading pricing workspace")).toBeVisible();
      else if (state === "error") await expect(page.getByRole("heading", { name: "Can’t load this extra work", exact: true })).toBeVisible();
      else if (state === "sent") await expect(page.getByRole("heading", { name: "Price sent to customer", exact: true })).toBeVisible();
      else if (state === "confirm") await expect(page.getByRole("alertdialog", { name: "Send price to customer", exact: true })).toBeVisible();
      else await expect(page.getByRole("heading", { name: "Tradie request", exact: true })).toBeVisible();
      if (state === "empty") await expect(page.getByText("No photos yet.", { exact: true })).toBeVisible();
      if (["approved", "declined"].includes(state)) { await expect(page.getByRole("textbox", { name: "Hours", exact: true })).toBeDisabled(); await expect(page.getByRole("button", { name: "Send price to customer", exact: true })).toHaveCount(0); }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), state).toBe(0);
      await expectNoA11yViolations(page);
    }
  });
  test("photos and confirmation support keyboard, restore focus, hide internal amounts and focus success", async ({ page }) => {
    await page.goto(href());
    const photo = page.getByRole("button", { name: "Open photo 1 of 2: Cracked switch", exact: true }); await photo.focus(); await photo.press("Enter");
    const gallery = page.getByRole("dialog", { name: "Photos", exact: true }); await expect(gallery).toBeVisible(); await page.keyboard.press("ArrowRight"); await expect(gallery.getByRole("img")).toHaveAttribute("src", /wires/);
    await page.keyboard.press("Escape"); await expect(photo).toBeFocused();
    const send = page.getByRole("button", { name: "Send price to customer", exact: true }); await send.focus(); await send.press("Enter");
    const confirm = page.getByRole("alertdialog", { name: "Send price to customer", exact: true }); await expect(confirm).toContainText("$72.50");
    for (const label of ["Tradie earns", "Margin", "Materials budget"]) await expect(confirm.getByText(label, { exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape"); await expect(send).toBeFocused();
    await send.press("Enter"); await confirm.getByRole("button", { name: "Send price to customer", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Price sent to customer", exact: true })).toBeFocused();
  });
  test("retains offline draft and rejects invalid input on the server before enabling send", async ({ page }) => {
    await page.goto(href("offline")); const hours = page.getByRole("textbox", { name: "Hours", exact: true });
    await hours.fill("2.5"); await expect(hours).toHaveValue("2.5"); await expect(page.getByRole("button", { name: "Send price to customer", exact: true })).toHaveAttribute("aria-disabled", "true");
    await page.goto(href()); await hours.fill("bad"); await expect(hours).toHaveAttribute("aria-invalid", "true");
    await expect(hours).toHaveAccessibleDescription(/Enter the hours as a number above zero/);
    await hours.fill("101"); await expect(hours).toHaveAccessibleDescription(/no more than 100 hours/);
    await hours.fill("1"); await expect(page.getByRole("button", { name: "Send price to customer", exact: true })).not.toHaveAttribute("aria-disabled", "true");
  });
  test("an old delayed calculation cannot overwrite a restored draft or leave it calculating", async ({ page }) => {
    await page.goto(href());
    const hours = page.getByRole("textbox", { name: "Hours", exact: true }), breakdown = page.getByRole("region", { name: "Price breakdown", exact: true }), original = await breakdown.textContent();
    let release!: () => void, started!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; }), pending = new Promise<void>(resolve => { started = resolve; });
    await page.route("**/dev/components/office-variation-pricing/preview", async route => { started(); await held; await route.continue(); });
    await hours.fill("2"); await pending; await expect(breakdown).toHaveAttribute("aria-busy", "true");
    await hours.fill("0.5"); await expect(breakdown).toHaveAttribute("aria-busy", "false");
    const response = page.waitForResponse(value => value.request().method() === "POST"); release(); await response;
    await expect(breakdown).toHaveText(original ?? ""); await page.unrouteAll({ behavior: "wait" });
  });
});
