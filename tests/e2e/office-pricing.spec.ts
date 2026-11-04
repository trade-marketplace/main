import { expect, test } from "@playwright/test";
import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const dev = process.env.E2E_DEV_BASE_URL;
const states = ["ready", "no-estimates", "site-visit", "loading", "error", "offline", "confirm", "photos", "sent", "frozen", "long", "changed"];
const href = (state = "ready") => new URL(`/dev/components/office-pricing?state=${state}${state === "long" ? "&invalid=1" : ""}`, dev!).href;
test("office pricing previews are guarded in production", async ({ page }) => {
  test.skip(Boolean(dev), "preview run");
  expect((await page.goto("/dev/components/office-pricing"))?.status()).toBe(404);
  expect((await page.request.post("/dev/components/office-pricing/preview", { data: { hours: "4", materials: "85" } })).status()).toBe(404);
});
test.describe("office pricing preview states", () => {
  test.skip(!dev, "Set E2E_DEV_BASE_URL for guarded previews");
  test.use({ reducedMotion: "reduce" });
  for (const viewport of VIEWPORTS) test(`${viewport.width}px: every pricing/empty/site-visit/loading/error/offline/confirm/photo/success/frozen/long/changed state fits and passes axe`, async ({ page }) => {
    test.setTimeout(240_000); await page.setViewportSize(viewport);
    for (const state of states) {
      await page.goto(href(state));
      if (state === "loading") await expect(page.getByLabel("Loading pricing workspace")).toBeVisible();
      else if (state === "error") await expect(page.getByRole("heading", { name: "Can’t load this job", exact: true })).toBeVisible();
      else if (state === "sent") await expect(page.getByRole("heading", { name: "Price sent to customer", exact: true })).toBeVisible();
      else if (state === "confirm") await expect(page.getByRole("alertdialog", { name: "Send price to customer", exact: true })).toBeVisible();
      else if (state === "photos") await expect(page.getByRole("dialog", { name: "Ask for more photos", exact: true })).toBeVisible();
      else if (state === "site-visit") await expect(page.getByRole("dialog", { name: "Needs a site visit", exact: true })).toBeVisible();
      else await expect(page.getByRole("heading", { name: "Set the price", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), state).toBe(0);
      await expectNoA11yViolations(page);
      if (state === "no-estimates") await expect(page.getByRole("heading", { name: "No estimates yet", exact: true })).toBeVisible();
      if (state === "long") {
        const hours = page.getByRole("textbox", { name: "Hours", exact: true });
        await expect(hours).toHaveAttribute("aria-invalid", "true");
        await expect(hours).toHaveAccessibleDescription(/Enter the hours as a number above zero\./);
      }
    }
  });
  test("phone/desktop wording, photo viewer keyboard dismissal, confirm cancellation/privacy and future-visit handoff", async ({ page }) => {
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 }); await page.goto(href());
      await expect(page.getByText(width === 390 ? "Trimmed average (drop high + low):" : "Trimmed average (drop highest + lowest):", { exact: true })).toBeVisible();
      const photo = page.getByRole("button", { name: "Open photo 1 of 2: Exposed wiring", exact: true });
      await photo.focus(); await photo.press("Enter");
      const viewer = page.getByRole("dialog", { name: "Photos", exact: true }); await expect(viewer).toBeVisible();
      await page.keyboard.press("ArrowRight"); await expect(viewer.getByRole("img")).toHaveAttribute("src", /switch/);
      await page.keyboard.press("Escape"); await expect(viewer).not.toBeVisible(); await expect(photo).toBeFocused();
      const send = page.getByRole("button", { name: "Send price to customer", exact: true });
      await send.focus(); await send.press("Enter");
      const confirm = page.getByRole("alertdialog", { name: "Send price to customer", exact: true }); await expect(confirm).toBeVisible();
      await expect(confirm.getByText("Fixed price (incl GST)", { exact: true })).toBeVisible();
      for (const word of ["Margin", "Tradie earns", "Blind quotes", "Track record"]) await expect(confirm.getByText(word, { exact: true })).toHaveCount(0);
      await page.keyboard.press("Escape"); await expect(confirm).not.toBeVisible(); await expect(send).toBeFocused();
      await page.getByRole("button", { name: "Needs a site visit", exact: true }).click();
      const visit = page.getByRole("dialog", { name: "Needs a site visit", exact: true }); await expect(visit).toContainText("Paid quick looks are coming soon.");
      await visit.getByRole("button", { name: "Ask for more photos", exact: true }).click();
      const ask = page.getByRole("dialog", { name: "Ask for more photos", exact: true });
      await expect(ask).toContainText("Shared with the customer, assigned tradie and office.");
      await ask.getByRole("textbox", { name: "Message to customer", exact: true }).fill("Please send a close photo.");
      await ask.getByRole("button", { name: "Not now", exact: true }).click(); await expect(ask).not.toBeVisible();
    }
  });
  test("cancelled preview response cannot leave the original price stuck calculating or overwrite it", async ({ page }) => {
    await page.goto(href());
    const hours = page.getByRole("textbox", { name: "Hours", exact: true }), original = await hours.inputValue();
    const breakdown = page.getByRole("region", { name: "Price breakdown", exact: true }), originalPrice = await breakdown.textContent() ?? "";
    let release!: () => void, started!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; }), pending = new Promise<void>(resolve => { started = resolve; });
    await page.route("**/dev/components/office-pricing**", async route => {
      if (route.request().method() === "POST") { started(); await held; }
      await route.continue();
    });
    await hours.fill("8"); await pending; await expect(breakdown).toHaveAttribute("aria-busy", "true");
    await hours.fill(original);
    await expect(breakdown).toHaveAttribute("aria-busy", "false");
    await expect(page.getByRole("button", { name: "Send price to customer", exact: true })).not.toHaveAttribute("aria-disabled", "true");
    const response = page.waitForResponse(reply => reply.request().method() === "POST"); release(); await response;
    await expect(breakdown).toHaveText(originalPrice); await page.unrouteAll({ behavior: "wait" });
  });
  test("offline inputs stay editable, sends disable, and invalid fields are server-validated without a price write", async ({ page }) => {
    await page.goto(href("offline")); const hours = page.getByRole("textbox", { name: "Hours", exact: true });
    await hours.fill("5.5"); await expect(hours).toHaveValue("5.5");
    await expect(page.getByRole("button", { name: "Send price to customer", exact: true })).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByRole("button", { name: "Ask for more photos", exact: true })).toHaveAttribute("aria-disabled", "true");
    await page.goto(href()); await hours.fill("bad");
    await expect(hours).toHaveAttribute("aria-invalid", "true");
    await expect(hours).toHaveAccessibleDescription(/Enter the hours as a number above zero\./);
    await expect(page.getByRole("button", { name: "Send price to customer", exact: true })).toHaveAttribute("aria-disabled", "true");
  });
});
