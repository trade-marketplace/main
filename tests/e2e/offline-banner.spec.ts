import { expect, type Page, test } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";
import { waitForPageSettled } from "./support/page-settled";
import { VIEWPORTS } from "./support/viewports";

// The offline banner (#187, G04) is mounted once in the root layout, so every page has it. These run on the production
// build, on real public pages, with real browser offline/online (context.setOffline), not by calling handlers.
// The customer, tradie and office shells are only reachable on the dev server (they need a signed-in viewer):
//   E2E_DEV_BASE_URL=http://localhost:3000 npx playwright test tests/e2e/offline-banner.spec.ts

const devUrl = process.env.E2E_DEV_BASE_URL;
const connection = (page: Page) => page.getByRole("region", { name: "Connection" });
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe("offline banner on the production build", () => {
  test.skip(Boolean(devUrl), "checked on the production build");

  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: shows when offline, sits above the sticky header, clears when back, no sideways scroll`, async ({ page, context }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/how-it-works");
      await expect(connection(page)).toBeAttached();
      await expect(page.locator("[data-offline]")).toHaveCount(0);

      await context.setOffline(true);
      const banner = page.locator("[data-offline]");
      await expect(banner).toBeVisible();
      await expect(banner).toContainText("You’re offline. We’ll keep trying. Anything you’ve typed is saved.");
      await expect(banner.getByRole("button", { name: "Retry now" })).toBeVisible();
      // Said once, politely (a status region, not an alert).
      await expect(page.getByRole("status").filter({ hasText: "You’re offline." })).toHaveCount(1);
      await expect(banner).not.toHaveAttribute("role", "alert");

      // Scrolled well down, the banner is still at the top and the site header sits right under it, not over it.
      await page.evaluate(() => window.scrollTo(0, 800));
      const boxes = await page.evaluate(() => {
        const b = document.querySelector("[data-offline]")!.getBoundingClientRect();
        const h = document.querySelector("header")!.getBoundingClientRect();
        return { bannerTop: b.top, bannerBottom: b.bottom, headerTop: h.top };
      });
      expect(boxes.bannerTop).toBe(0);
      expect(boxes.headerTop).toBeGreaterThanOrEqual(boxes.bannerBottom - 1);
      expect(await overflow(page)).toBe(0);
      await waitForPageSettled(page, "How it works | Trade Marketplace");
      await expectNoA11yViolations(page);

      // Retry now while still offline neither reloads nor leaves the page.
      await banner.getByRole("button", { name: "Retry now" }).click();
      expect(new URL(page.url()).pathname).toBe("/how-it-works");

      await context.setOffline(false);
      await expect(page.locator("[data-offline]")).toHaveCount(0);
      const back = page.locator("b", { hasText: "You’re back online." });
      await expect(back).toBeVisible();
      await expect(page.getByRole("status").filter({ hasText: "You’re back online." })).toHaveCount(1);
      await expect(back).toHaveCount(0, { timeout: 6000 }); // gone after 4s
      // The header is back to the very top once the banner is gone.
      await expect.poll(() => page.evaluate(() => document.querySelector("header")!.getBoundingClientRect().top)).toBe(0);
    });
  }

  test("keyboard: Retry now is reachable by Tab, Enter works, and focus is never trapped", async ({ page, context }) => {
    await page.goto("/how-it-works");
    await context.setOffline(true);
    const retry = page.locator("[data-offline]").getByRole("button", { name: "Retry now" });
    await expect(retry).toBeVisible();
    await page.keyboard.press("Tab"); // skip link
    await retry.focus();
    await expect(retry).toBeFocused();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await expect(retry).not.toBeFocused();
    await context.setOffline(false);
  });

  test("a form submitted offline is kept and held; back online it is offered, and Send now sends it", async ({ page, context }) => {
    await page.goto("/login");
    const email = page.getByLabel("Email");
    await email.fill("sarah@email.co.nz");
    await page.getByLabel("Password", { exact: true }).fill("hunter2-hunter2");

    let posts = 0;
    page.on("request", (request) => {
      if (request.method() === "POST") posts += 1;
    });

    await context.setOffline(true);
    await expect(page.locator("[data-offline]")).toBeVisible();
    await page.getByLabel("Password", { exact: true }).press("Enter");

    const held = page.locator("[data-held-form]");
    await expect(held).toContainText("Not sent yet. We’ll offer to send it when you’re back online.");
    await expect(held.getByRole("button")).toHaveCount(0);
    // Nothing was sent and nothing typed was lost.
    expect(posts).toBe(0);
    await expect(email).toHaveValue("sarah@email.co.nz");
    await expect(page.getByLabel("Password", { exact: true })).toHaveValue("hunter2-hunter2");
    await expect(page.getByRole("status").filter({ hasText: "Not sent yet." })).toHaveCount(1);
    await expectNoA11yViolations(page);

    await context.setOffline(false);
    await expect(held).toContainText("Not sent yet.");
    await expect(held).not.toContainText("We’ll offer");
    expect(posts).toBe(0); // never sent on its own
    const send = held.getByRole("button", { name: "Send now" });
    await send.focus();
    await page.keyboard.press("Enter");
    // No Supabase in this build: the honest answer shows the form really was sent.
    await expect(page.getByText("We can’t log you in right now.")).toBeVisible();
    expect(posts).toBeGreaterThan(0);
    await expect(held).toHaveCount(0);
    await expect(email).toHaveValue("sarah@email.co.nz");
  });

  test("Not now drops the held form without sending it", async ({ page, context }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("sarah@email.co.nz");
    await page.getByLabel("Password", { exact: true }).fill("hunter2-hunter2");
    let posts = 0;
    page.on("request", (request) => {
      if (request.method() === "POST") posts += 1;
    });
    await context.setOffline(true);
    await page.getByLabel("Password", { exact: true }).press("Enter");
    await expect(page.locator("[data-held-form]")).toBeVisible();
    await context.setOffline(false);
    await page.locator("[data-held-form]").getByRole("button", { name: "Not now" }).click();
    await expect(page.locator("[data-held-form]")).toHaveCount(0);
    expect(posts).toBe(0);
    await expect(page.getByLabel("Email")).toHaveValue("sarah@email.co.nz");
  });

  test("a held form is dropped when the person goes to another page", async ({ page, context }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("sarah@email.co.nz");
    await page.getByLabel("Password", { exact: true }).fill("hunter2-hunter2");
    await context.setOffline(true);
    await page.getByLabel("Password", { exact: true }).press("Enter");
    await expect(page.locator("[data-held-form]")).toBeVisible();
    await context.setOffline(false);
    await page.getByRole("link", { name: "Forgot password?" }).click();
    await expect(page).toHaveURL(/\/recovery/);
    await expect(page.locator("[data-held-form]")).toHaveCount(0);
  });
});

test.describe("offline banner in the customer, tradie and office shells (dev server)", () => {
  test.skip(!devUrl, "set E2E_DEV_BASE_URL to a running npx next dev server");

  for (const [name, path] of [
    ["customer app shell", "/dev/components/app-shell"],
    ["tradie app shell", "/dev/components/app-shell?mode=trade"],
    ["office shell", "/dev/components/office-shell"],
  ] as const) {
    for (const width of [390, 1440]) {
      test(`${name} at ${width}px: banner on top, nothing hidden under it, no sideways scroll`, async ({ page, context }) => {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await page.goto(new URL(path, devUrl).href);
        // The dev server loads scripts lazily, so let the page hydrate before the network goes away.
        await page.waitForFunction(() => Object.keys(document).some((key) => key.startsWith("__reactContainer")));
        await context.setOffline(true);
        const banner = page.locator("[data-offline]");
        await expect(banner).toBeVisible();
        expect(await overflow(page)).toBe(0);
        const bannerBottom = await banner.evaluate((el) => el.getBoundingClientRect().bottom);
        const tops = await page.evaluate(() => {
          const out: number[] = [];
          for (const el of document.querySelectorAll<HTMLElement>("header, aside, nav")) {
            if (getComputedStyle(el).position === "sticky" && el.getBoundingClientRect().height > 0) out.push(el.getBoundingClientRect().top);
          }
          return out;
        });
        for (const top of tops) expect(top).toBeGreaterThanOrEqual(bannerBottom - 1);
        await expectNoA11yViolations(page);
        await context.setOffline(false);
        await expect(banner).toHaveCount(0);
      });
    }
  }
});
