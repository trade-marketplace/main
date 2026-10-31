import { expect, test } from "@playwright/test";

import { CATEGORIES } from "../../src/lib/cards";
import { SERVICE_PREVIEW_STATES } from "../../src/lib/services";

import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const dev = process.env.E2E_DEV_BASE_URL;
const fixture = (state = "live", trade = "electrical") => new URL(`/dev/components/services?state=${state}&trade=${trade}`, dev).href;
const formName = "What needs doing?";

test.describe("public service pages", () => {
  test.use({ reducedMotion: "reduce" });
  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: service template fits and passes axe`, async ({ page }) => {
      await page.setViewportSize(viewport); await page.goto("/services/electrical");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Electricians in\s*Invercargill/);
      await expect(page.getByRole("form", { name: formName })).toBeVisible();
      await expect(page.getByRole("button", { name: "Get a price", exact: true })).toBeInViewport();
      await expect(page.getByRole("link", { name: "New power point", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
      await expectNoA11yViolations(page);
    });
  }
  for (const category of CATEGORIES) {
    test(`${category}: public SEO metadata, live state and typed job survive login and signup handoffs`, async ({ page }) => {
      await page.goto(`/services/${category}`);
      await expect(page).toHaveTitle(/in Invercargill.*Trade Marketplace/);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`/services/${category}$`));
      await page.getByRole("form", { name: formName }).getByRole("textbox").fill("My job & more");
      await page.getByRole("form", { name: formName }).getByRole("textbox").press("Enter");
      await expect(page).toHaveURL(/\/login\?next=/);
      const next = new URL(new URL(page.url()).searchParams.get("next")!, "https://example.test");
      expect(next.pathname).toBe("/jobs/new"); expect(next.searchParams.get("type")).toBe(category);
      expect(next.searchParams.get("description")).toBe("My job & more");
      await page.getByRole("link", { name: "Sign up", exact: true }).click();
      await page.getByRole("radio", { name: /I need a job done/ }).check();
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await expect(page).toHaveURL(/\/signup\/customer\?next=/);
      expect(new URL(page.url()).searchParams.get("next")).toBe(next.pathname + next.search);
      await page.goBack(); await expect(page.getByRole("heading", { name: "Create account", exact: true })).toBeVisible();
    });
  }
  test("unknown trades are 404; state query flags cannot invent availability or a successful signup", async ({ page }) => {
    expect((await page.goto("/services/invented"))?.status()).toBe(404);
    await page.goto("/services/other?state=joined");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Anything else in/);
    await expect(page.getByRole("form", { name: formName })).toBeVisible();
    await expect(page.getByText("You’re on the list.", { exact: true })).toHaveCount(0);
    if (!dev) expect((await page.goto("/dev/components/services"))?.status()).toBe(404);
  });
  test("popular named job and Something else both preserve Other and the appropriate description", async ({ page }) => {
    for (const [job, expected] of [["Move a couch", "Move a couch"], ["Something else", "An unusual job"]]) {
      await page.goto("/services/other");
      await page.getByRole("form", { name: formName }).getByRole("textbox").fill("An unusual job");
      await page.getByRole("link", { name: job, exact: true }).press("Enter");
      await expect(page).toHaveURL(/\/login\?next=/);
      const next = new URL(new URL(page.url()).searchParams.get("next")!, "https://example.test");
      expect(next.searchParams.get("type")).toBe("other"); expect(next.searchParams.get("description")).toBe(expected);
      expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("tm-post-job-start")!))).toMatchObject({ category: "other", description: expected });
    }
  });
  test("keyboard search shortcut, visible focus, location dismissal and storage-denied handoff work", async ({ page }) => {
    await page.addInitScript(() => { Object.defineProperty(window, "sessionStorage", { get() { throw new Error("blocked"); } }); });
    await page.goto("/services/electrical");
    await expect(page.locator("header[data-solid]")).toHaveAttribute("data-solid", /true|false/);
    await page.keyboard.press("/");
    const input = page.getByRole("form", { name: formName }).getByRole("textbox");
    await expect(input).toBeFocused(); await input.fill("Safe & local");
    await input.press("Tab");
    const location = page.getByRole("button", { name: /Location: Invercargill/ });
    await expect(location).toBeFocused(); expect(await location.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
    await location.press("Enter"); await expect(page.getByRole("dialog", { name: "Location", exact: true })).toBeVisible();
    await page.keyboard.press("Escape"); await expect(location).toBeFocused();
    await page.getByRole("button", { name: "Get a price", exact: true }).click();
    await expect(page).toHaveURL(/\/login\?next=/);
    expect(new URL(new URL(page.url()).searchParams.get("next")!, "https://example.test").searchParams.get("description")).toBe("Safe & local");
  });
});

test.describe("guarded service states", () => {
  test.skip(!dev, "Requires guarded local service fixtures; run explicitly with E2E_DEV_BASE_URL.");
  test.use({ reducedMotion: "reduce" });
  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: every service, list, review and waitlist state fits with axe`, async ({ page }) => {
      test.setTimeout(120_000); await page.setViewportSize(viewport);
      for (const state of SERVICE_PREVIEW_STATES) {
        await page.goto(fixture(state));
        if (state === "loading") await expect(page.getByText("Loading service", { exact: true })).toBeAttached();
        else await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), state).toBe(0);
        await expectNoA11yViolations(page);
      }
    });
  }
  test("waitlist validates, saves, retains values and recognizes repeat signups", async ({ page }) => {
    await page.goto(fixture("coming-soon", "other"));
    await page.getByRole("button", { name: "Tell me", exact: true }).press("Enter");
    await expect(page.getByLabel("Email", { exact: true })).toBeFocused();
    await expect(page.getByText("Enter your email.")).toBeVisible();
    await page.getByLabel("Email", { exact: true }).fill("person@example.test");
    await page.getByLabel("Suburb", { exact: true }).fill(" ");
    await page.getByRole("button", { name: "Tell me", exact: true }).press("Enter");
    await expect(page.getByLabel("Suburb", { exact: true })).toBeFocused();
    await page.getByLabel("Suburb", { exact: true }).fill("Invercargill");
    await page.getByRole("button", { name: "Tell me", exact: true }).press("Enter");
    await expect(page.getByText("You’re on the list.", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Email", { exact: true })).toHaveValue("person@example.test");
    await page.getByRole("button", { name: "Tell me", exact: true }).press("Enter");
    await expect(page.getByText("You’re already on the list.", { exact: true })).toBeVisible();
    await expectNoA11yViolations(page);
  });
  test("failed save retains input; offline disables submit and reconnect allows retry", async ({ page, context }) => {
    await page.goto(fixture("waitlist-error"));
    await page.getByLabel("Email", { exact: true }).fill("person@example.test");
    await page.getByRole("button", { name: "Tell me", exact: true }).click();
    await expect(page.getByText("Couldn’t join the list. Try again.", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Email", { exact: true })).toHaveValue("person@example.test");
    await context.setOffline(true);
    await expect(page.getByRole("button", { name: "Tell me", exact: true })).toHaveAttribute("aria-disabled", "true");
    await context.setOffline(false);
    await expect(page.getByRole("button", { name: "Tell me", exact: true })).not.toHaveAttribute("aria-disabled", "true");
  });
  test("outside coverage leads to the real area waitlist with the draft and trade preserved", async ({ page }) => {
    await page.goto(fixture("live", "other"));
    await page.getByRole("form", { name: formName }).getByRole("textbox").fill("Move a couch");
    await page.getByRole("button", { name: /Location:/ }).click();
    await page.getByRole("combobox", { name: "Town or suburb", exact: true }).fill("Well");
    await page.getByRole("option", { name: /Wellington/ }).click();
    await page.getByRole("button", { name: "Get notified", exact: true }).click();
    await expect(page).toHaveURL(/\/coming-soon\?/);
    await expect(page.getByLabel("Suburb", { exact: true })).toHaveValue("Wellington");
    const url = new URL(page.url()); expect(url.searchParams.get("type")).toBe("other"); expect(url.searchParams.get("description")).toBe("Move a couch");
  });
  test("manual location fallback keeps the trade and text; empty popular jobs focuses the search", async ({ page }) => {
    await page.goto(fixture("empty"));
    await page.getByRole("button", { name: "Describe your job", exact: true }).click();
    await expect(page.getByRole("form", { name: formName }).getByRole("textbox")).toBeFocused();
    await page.getByRole("button", { name: /Location:/ }).click();
    await page.getByRole("combobox", { name: "Town or suburb", exact: true }).fill("Manual town");
    await expect(page.getByText("Search unavailable. Enter your location.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Use location", exact: true }).click();
    await expect(page.getByRole("button", { name: /Location: Manual town/ })).toBeVisible();
  });
});
