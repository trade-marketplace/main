import { expect, type Page, test } from "@playwright/test";

import { GEO_ASKED_KEY, LANDING_DRAFT_KEY } from "../../src/lib/landing";

import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const dev = process.env.E2E_DEV_BASE_URL;
const fixture = (state = "signed-out") => new URL(`/dev/components/landing?state=${state}`, dev).href;
const firstForm = (page: Page) => page.getByRole("form", { name: "What needs doing?", exact: true });
async function open(page: Page, path = "/") {
  await page.goto(path);
  await expect(page.locator("header[data-solid]")).toHaveAttribute("data-solid", /true|false/);
}

test("landing fixtures are guarded on production deployments", async ({ page }) => {
  test.skip(Boolean(dev));
  expect((await page.goto("/dev/components/landing"))?.status()).toBe(404);
});

test.describe("public homepage", () => {
  test.use({ reducedMotion: "reduce" });
  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: all sections fit, accessible, with one primary start above the fold`, async ({ page }) => {
      await page.setViewportSize(viewport); await open(page);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Sorted in\s*a flash\./);
      await expect(firstForm(page)).toBeVisible();
      await expect(firstForm(page).getByRole("button", { name: "Get a price", exact: true })).toBeInViewport();
      await expect(page.getByRole("heading", { name: "All sorts. Any job." })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Kiwis getting it sorted" })).toBeVisible();
      await expect(page.getByText("Example reviews", { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
      await expectNoA11yViolations(page);
    });
  }

  test("Enter carries text and location through the existing login return path and saves the same draft", async ({ page }) => {
    await open(page); const query = "Fix the gate & fence";
    await firstForm(page).getByRole("textbox", { name: "What needs doing?" }).fill(query);
    await firstForm(page).getByRole("textbox").press("Enter");
    await expect(page).toHaveURL(/\/login\?next=/);
    const next = new URL(new URL(page.url()).searchParams.get("next")!, "https://example.test");
    expect(next.pathname).toBe("/jobs/new"); expect(next.searchParams.get("description")).toBe(query); expect(next.searchParams.get("location")).toBe("Invercargill");
    expect(await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)!), LANDING_DRAFT_KEY)).toMatchObject({ description: query, location: { label: "Invercargill" } });
  });

  test("a phone example fills the visible input; final CTA shares the text", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); await open(page);
    await page.getByRole("button", { name: "Leaking tap", exact: true }).click();
    await expect(firstForm(page).getByRole("textbox")).toHaveValue("Leaking tap");
    await expect(firstForm(page).getByRole("textbox")).toBeFocused();
    await expect(page.getByRole("form", { name: "Start a job", exact: true }).getByRole("textbox")).toHaveValue("Leaking tap");
  });

  test("a category carries its type and the entered query", async ({ page }) => {
    await open(page); await firstForm(page).getByRole("textbox").fill("Add a socket");
    await page.getByRole("link", { name: "Electrical", exact: true }).click();
    await expect(page).toHaveURL(/\/login\?next=/);
    const next = new URL(new URL(page.url()).searchParams.get("next")!, "https://example.test");
    expect(next.searchParams.get("type")).toBe("electrical"); expect(next.searchParams.get("description")).toBe("Add a socket");
  });

  test("storage denied still retains text in the return URL", async ({ page }) => {
    await page.addInitScript(() => { Object.defineProperty(window, "sessionStorage", { get() { throw new Error("blocked storage"); } }); });
    await open(page); await firstForm(page).getByRole("textbox").fill("Move a couch"); await firstForm(page).getByRole("button", { name: "Get a price" }).click();
    await expect(page).toHaveURL(/\/login\?next=/);
    expect(new URL(new URL(page.url()).searchParams.get("next")!, "https://example.test").searchParams.get("description")).toBe("Move a couch");
  });

  test("geolocation is requested once and updates coverage even with development effect replay", async ({ page }) => {
    await page.addInitScript(() => {
      let calls = 0;
      Object.defineProperty(window, "geoCalls", { get: () => calls });
      Object.defineProperty(navigator.geolocation, "getCurrentPosition", { value: (success: PositionCallback) => { calls++; setTimeout(() => success({ coords: { latitude: -41.2866, longitude: 174.7756 } } as GeolocationPosition), 50); } });
    });
    await open(page); await expect(page.getByText("We're in Invercargill.", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { geoCalls: number }).geoCalls)).toBe(1);
    expect(await page.evaluate((key) => sessionStorage.getItem(key), GEO_ASKED_KEY)).toBe("1");
    await page.reload(); await expect(firstForm(page)).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { geoCalls: number }).geoCalls)).toBe(0);
  });

  test("FAQ is a keyboard-operable M24 accordion", async ({ page }) => {
    await open(page); const question = page.getByRole("button", { name: "Who are the tradies?" });
    await question.press("Enter"); await expect(question).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("region", { name: "Who are the tradies?" })).toContainText("licence checked");
    await question.press("Enter"); await expect(question).toHaveAttribute("aria-expanded", "false");
  });
});

test.describe("landing fixtures", () => {
  test.skip(!dev, "guarded local state fixtures");
  test.use({ reducedMotion: "reduce" });
  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: signed-in, outside, reviews, lookup loading/error states fit and pass axe`, async ({ page }) => {
      test.setTimeout(90_000); await page.setViewportSize(viewport);
      for (const state of ["signed-in", "outside", "reviews", "location-loading", "location-error"]) {
        await open(page, fixture(state));
        if (state.startsWith("location-")) await expect(page.getByRole("dialog")).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), state).toBe(0);
        await expectNoA11yViolations(page);
      }
    });
  }
  test("outside-area starts carry details to the waitlist hand-off", async ({ page }) => {
    await open(page, fixture("outside")); await firstForm(page).getByRole("textbox").fill("Fix the gate");
    await firstForm(page).getByRole("button", { name: "Get notified" }).click();
    await expect(page).toHaveURL(/\/coming-soon\?/);
    expect(new URL(page.url()).searchParams.get("description")).toBe("Fix the gate"); expect(new URL(page.url()).searchParams.get("location")).toBe("Wellington");
  });
  test("the location picker selects a real provider shape and supports manual fallback", async ({ page }) => {
    await open(page, fixture()); await firstForm(page).getByRole("button", { name: /^Location:/ }).click();
    const input = page.getByRole("combobox", { name: "Town or suburb" }); await input.fill("Well");
    await page.getByRole("option", { name: "Wellington" }).click();
    await expect(page.getByRole("dialog")).toBeHidden(); await expect(page.getByText("We're in Invercargill.", { exact: true })).toBeVisible();
    await firstForm(page).getByRole("button", { name: /^Location:/ }).click(); await input.fill("Manual town");
    await expect(page.getByText("Search unavailable.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Use location" }).click();
    await expect(firstForm(page).getByRole("button", { name: /Location: Manual town/ })).toBeVisible();
    await expect(firstForm(page).getByRole("button", { name: "Get a price" })).toBeVisible();
  });
  for (const width of [1440, 390]) {
    test(`${width}px: M06 parallax/nav fill, M07 reveal and reduced motion`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ reducedMotion: "no-preference" }); await open(page, fixture());
      const header = page.locator("header[data-solid]"); const bolt = page.locator("[data-site-hero] .tm-parallax");
      await expect(page.locator("h1 > span").first()).toHaveClass(/tm-anim-reveal/);
      await expect(page.locator("h1 > span").first()).toHaveCSS("animation-name", "tm-reveal");
      await expect(header).toHaveAttribute("data-solid", "false");
      if (width === 1440) {
        const price = page.locator("strong").filter({ hasText: "$372.00" });
        await expect(price).toHaveCSS("font-family", /Trade Display/);
        await expect(price).toHaveCSS("font-weight", "900");
        await expect(price).toHaveCSS("font-variation-settings", /"wdth" 151/);
        await expect(page.locator(".tm-hero-float")).toHaveCSS("animation-name", "tm-hero-float");
        await expect(page.locator(".tm-hero-float")).toHaveCSS("animation-duration", "3s");
      }
      await page.evaluate(() => window.scrollTo(0, 120));
      await expect(header).toHaveAttribute("data-solid", "true");
      await expect.poll(() => bolt.evaluate((el) => el.style.getPropertyValue("--tm-parallax-y"))).toBe("36px");
      await page.evaluate(() => window.scrollTo(0, 900)); await expect(header).toHaveAttribute("data-solid", "true");
      await page.reload(); await expect(page.locator("h1 > span").first()).not.toHaveClass(/tm-anim-reveal/);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect.poll(() => bolt.evaluate((el) => el.style.getPropertyValue("--tm-parallax-y"))).toBe("0px");
      if (width === 1440) await expect(page.locator(".tm-hero-float")).toHaveCSS("animation-name", "none");
    });
  }
});
