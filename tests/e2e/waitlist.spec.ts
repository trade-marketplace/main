import { expect, test } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const dev = process.env.E2E_DEV_BASE_URL;
const fixture = (state = "empty") => new URL(`/dev/components/waitlist?state=${state}`, dev).href;

test("waitlist previews are guarded; public state flags cannot claim a successful signup", async ({ page }) => {
  expect((await page.goto("/dev/components/waitlist"))?.status()).toBe(404);
  await page.goto("/coming-soon?location=Wellington&state=joined");
  await expect(page.getByRole("heading", { name: "We’re not in Wellington yet." })).toBeVisible();
  await expect(page.getByText("You’re on the list.", { exact: true })).toHaveCount(0);
});

for (const viewport of VIEWPORTS) {
  test(`${viewport.width}px public waitlist keeps form values after a failed save and fits with axe`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/coming-soon?location=Wellington");
    await expect(page.getByLabel("Suburb", { exact: true })).toHaveValue("Wellington");
    await page.getByLabel("Email", { exact: true }).fill("someone@example.test");
    await page.getByRole("button", { name: "Tell me", exact: true }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Try again.");
    await expect(page.getByLabel("Email", { exact: true })).toHaveValue("someone@example.test");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await expectNoA11yViolations(page);
  });
}

test("empty location, invalid fields and hostile location parameters remain safe", async ({ page }) => {
  await page.goto("/coming-soon?location=A&location=B");
  await expect(page.getByRole("heading", { name: "Not in your area yet." })).toBeVisible();
  await page.getByRole("button", { name: "Tell me", exact: true }).press("Enter");
  await expect(page.getByLabel("Email", { exact: true })).toBeFocused();
  await expect(page.getByText("Enter your email.")).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill("test@example.test");
  await page.getByRole("button", { name: "Tell me", exact: true }).press("Enter");
  await expect(page.getByLabel("Suburb", { exact: true })).toBeFocused();
  await expect(page.getByText("Enter your suburb.")).toBeVisible();
});

test("offline keeps the draft, disables submit, and reconnecting enables retry", async ({ page, context }) => {
  await page.goto("/coming-soon?location=Wellington");
  await page.getByLabel("Email", { exact: true }).fill("offline@example.test");
  await context.setOffline(true);
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(/You’re offline/);
  await expect(page.getByRole("button", { name: "Tell me", exact: true })).toHaveAttribute("aria-disabled", "true");
  await context.setOffline(false);
  await expect(page.getByRole("button", { name: "Tell me", exact: true })).not.toHaveAttribute("aria-disabled", "true");
  await page.reload();
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("offline@example.test");
});

test("pending save keeps values and blocks repeated submissions", async ({ page }) => {
  let release!: () => void;
  let requests = 0;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/coming-soon*", async (route) => {
    if (route.request().method() === "POST") { requests++; await wait; }
    await route.continue();
  });
  await page.goto("/coming-soon?location=Wellington");
  await page.getByLabel("Email", { exact: true }).fill("pending@example.test");
  const submit = page.getByRole("button", { name: /^Tell me/ });
  await submit.click();
  await expect(submit).toHaveAttribute("aria-busy", "true");
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("pending@example.test");
  await submit.press("Enter");
  await expect.poll(() => requests).toBe(1);
  release();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Try again.");
});

test.describe("guarded waitlist states", () => {
  test.skip(!dev, "guarded local fixtures");
  test.use({ reducedMotion: "reduce" });
  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px every state fits and passes axe`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize(viewport);
      for (const state of ["empty", "loading", "joined", "already-on-list", "error", "offline"]) {
        await page.goto(fixture(state));
        await expect(page.getByRole("form", { name: "Waitlist", exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), state).toBe(0);
        await expectNoA11yViolations(page);
      }
    });
  }
  test("keyboard signup keeps the form, repeated signup says You’re on it, and copy shares only location", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(fixture());
    await page.getByLabel("Email", { exact: true }).fill("keyboard@example.test");
    await page.getByLabel("Email", { exact: true }).press("Tab");
    const submit = page.getByRole("button", { name: "Tell me", exact: true });
    await expect(submit).toBeFocused();
    expect(await submit.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status").filter({ hasText: "You’re on the list." })).toBeVisible();
    await expect(page.getByLabel("Email", { exact: true })).toHaveValue("keyboard@example.test");
    await submit.press("Enter");
    await expect(page.getByText("You’re on it.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "copy link", exact: true }).press("Enter");
    await expect(page.getByText("Copied.", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(new URL("/coming-soon?location=Wellington", dev).href);
  });
  test("the real server action persists to local Postgres and a repeated request survives reload", async ({ page }, info) => {
    await page.goto(new URL("/coming-soon?location=Wellington&description=Private+job&lat=-41&lng=174", dev).href);
    const email = `waitlist-${Date.now()}-${info.workerIndex}@example.test`;
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByRole("button", { name: "Tell me", exact: true }).press("Enter");
    await expect(page.getByText("You’re on the list.", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Email", { exact: true })).toHaveValue(email);
    await page.getByRole("button", { name: "Tell me", exact: true }).press("Enter");
    await expect(page.getByText("You’re on it.", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Suburb", { exact: true })).toHaveValue("Wellington");
  });
  test("copy failures are visible and never claim Copied", async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator.clipboard, "writeText", { value: async () => { throw new Error("denied"); } }));
    await page.goto(fixture("joined"));
    await page.getByRole("button", { name: "copy link", exact: true }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Try again.");
    await expect(page.getByText("Copied.", { exact: true })).toHaveCount(0);
  });
});
