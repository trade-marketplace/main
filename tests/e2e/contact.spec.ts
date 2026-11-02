import { expect, test } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const dev = process.env.E2E_DEV_BASE_URL;
const fixture = (state = "empty", extra = "") => new URL(`/dev/components/contact?state=${state}${extra}`, dev).href;
const noSidewaysScroll = (page: import("@playwright/test").Page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

test("preview states are guarded; a public query flag cannot claim a message was sent", async ({ page }) => {
  expect((await page.goto("/dev/components/contact"))?.status()).toBe(404);
  await page.goto("/contact?state=sent");
  await expect(page.getByRole("heading", { name: "Get in touch", level: 1 })).toBeVisible();
  await expect(page.getByText("Message sent.", { exact: true })).toHaveCount(0);
});

for (const viewport of VIEWPORTS) {
  test(`${viewport.width}px public contact page fits, passes axe; at 390 it keeps what was typed after a failed send`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/contact");
    await expect(page.getByRole("heading", { name: "Get in touch", level: 1 })).toBeVisible();
    await expect(page.getByText("We reply within one working day.")).toBeVisible();
    expect(await noSidewaysScroll(page)).toBe(0);
    await expectNoA11yViolations(page);
    // Each real send counts against the Contact rate limit (5 an hour), so only one width tries it.
    if (viewport.width !== 390) return;
    await page.getByLabel("What’s it about?").selectOption("payments");
    await page.getByLabel("Your email").fill("someone@example.test");
    await page.getByLabel("Message").fill("Hi, I wanted to ask about a payment.");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    // The test server has no email provider, so sending fails: the message stays exactly as typed.
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Couldn’t send your message.");
    await expect(page.getByLabel("What’s it about?")).toHaveValue("payments");
    await expect(page.getByLabel("Your email")).toHaveValue("someone@example.test");
    await expect(page.getByLabel("Message")).toHaveValue("Hi, I wanted to ask about a payment.");
    expect(await noSidewaysScroll(page)).toBe(0);
    await expectNoA11yViolations(page);
  });
}

test("each field says what is missing, focuses it and clears when corrected", async ({ page }) => {
  await page.goto("/contact");
  const send = page.getByRole("button", { name: "Send message", exact: true });
  await send.press("Enter");
  await expect(page.getByLabel("Your email")).toBeFocused();
  await expect(page.getByText("Enter your email.")).toBeVisible();
  await expect(page.getByLabel("Your email")).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("Your email").fill("not-an-email");
  await send.press("Enter");
  await expect(page.getByText("Enter your email.")).toBeVisible();
  await page.getByLabel("Your email").fill("someone@example.test");
  await send.press("Enter");
  await expect(page.getByLabel("Message")).toBeFocused();
  await expect(page.getByText("Enter your message.")).toBeVisible();
  await page.getByLabel("Message").fill("   ");
  await send.press("Enter");
  await expect(page.getByText("Enter your message.")).toBeVisible();
  await page.getByLabel("Message").fill("Hello");
  await expect(page.getByText("Enter your message.")).toHaveCount(0);
  await expectNoA11yViolations(page);
});

test("pending send shows Sending, keeps values and blocks repeated submissions", async ({ page }) => {
  let release!: () => void;
  let requests = 0;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/contact", async (route) => {
    if (route.request().method() === "POST") { requests++; await wait; }
    await route.continue();
  });
  await page.goto("/contact");
  await page.getByLabel("Your email").fill("pending@example.test");
  await page.getByLabel("Message").fill("Still typing");
  const send = page.getByRole("button", { name: /^Send message/ });
  await send.click();
  await expect(send).toHaveAttribute("aria-busy", "true");
  await expect(page.getByLabel("Message")).toHaveValue("Still typing");
  await send.press("Enter");
  await expect.poll(() => requests).toBe(1);
  release();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Couldn’t send your message.");
});

test("offline keeps the message, disables send and says so; reconnecting lets them retry", async ({ page, context }) => {
  await page.goto("/contact");
  await page.getByLabel("Message").fill("Written offline");
  await context.setOffline(true);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("You’re offline.");
  await expect(page.getByRole("button", { name: /^Send message/ })).toHaveAttribute("aria-disabled", "true");
  await context.setOffline(false);
  await expect(page.getByRole("button", { name: /^Send message/ })).not.toHaveAttribute("aria-disabled", "true");
  await expect(page.getByLabel("Message")).toHaveValue("Written offline");
});

test("the honeypot is not reachable by keyboard or screen reader and a normal message leaves it empty", async ({ page }) => {
  await page.goto("/contact");
  const trap = page.locator('input[name="website"]');
  await expect(trap).toHaveAttribute("tabindex", "-1");
  await expect(page.getByRole("textbox", { name: "Website" })).toHaveCount(0);
  await page.getByLabel("Message").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: /^Send message/ })).toBeFocused();
  await expect(trap).toHaveValue("");
});

test("keyboard-only: tab order, focus ring on keys only, no ring after a click", async ({ page }) => {
  await page.goto("/contact");
  await page.getByLabel("What’s it about?").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Your email")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Message")).toBeFocused();
  await page.keyboard.press("Tab");
  const send = page.getByRole("button", { name: "Send message", exact: true });
  await expect(send).toBeFocused();
  expect(await send.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
  await page.getByLabel("Your email").click();
  await send.click();
  expect(await send.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("solid");
});

test("real clicks: the footer Contact link opens the page, a help topic opens the help centre", async ({ page }) => {
  await page.goto("/how-it-works");
  await page.getByRole("contentinfo").getByRole("link", { name: "Contact", exact: true }).click();
  await expect(page).toHaveURL(/\/contact$/);
  await expect(page.getByRole("heading", { name: "Get in touch", level: 1 })).toBeVisible();
  await page.getByRole("navigation", { name: "Help centre" }).getByRole("link", { name: "Payments" }).click();
  await expect(page).toHaveURL(/\/help\?topic=payments$/);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Get in touch", level: 1 })).toBeVisible();
});

test.describe("guarded contact states", () => {
  test.skip(!dev, "guarded local fixtures");
  test.use({ reducedMotion: "reduce" });

  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px every state fits and passes axe`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize(viewport);
      for (const state of ["empty", "sending", "sent", "error", "offline"]) {
        await page.goto(fixture(state));
        await expect(page.getByRole("form", { name: "Contact", exact: true })).toBeVisible();
        expect(await noSidewaysScroll(page), state).toBe(0);
        await expectNoA11yViolations(page);
      }
      await page.goto(fixture("empty", "&signedin=1"));
      await expect(page.getByLabel("Your email")).toHaveValue("sarah@email.co.nz");
      expect(await noSidewaysScroll(page)).toBe(0);
      await expectNoA11yViolations(page);
    });
  }

  test("states show the right words", async ({ page }) => {
    await page.goto(fixture("sending"));
    await expect(page.getByRole("button", { name: /^Send message/ })).toHaveAttribute("aria-busy", "true");
    await page.goto(fixture("sent"));
    await expect(page.getByRole("status").filter({ hasText: "Message sent." })).toBeVisible();
    await page.goto(fixture("error"));
    await expect(page.getByRole("main").getByRole("alert")).toContainText("It’s still here. Try again.");
    await expect(page.getByLabel("Message")).toHaveValue("Hi, I wanted to ask about…");
    await page.goto(fixture("empty"));
    await expect(page.getByText("Message us from the job page instead.")).toBeVisible();
    await expect(page.getByRole("link", { name: "the job page" })).toHaveCount(0);
    await page.goto(fixture("empty", "&signedin=1"));
    await expect(page.getByRole("link", { name: "the job page" })).toHaveAttribute("href", "/dashboard");
  });

  test("keyboard send says Message sent, empties the message, and typing again clears the notice", async ({ page }) => {
    await page.goto(fixture());
    await page.getByLabel("Your email").fill("keyboard@example.test");
    await page.getByLabel("Message").fill("Hello there");
    await page.getByLabel("Message").press("Tab");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status").filter({ hasText: "Message sent." })).toBeVisible();
    await expect(page.getByLabel("Message")).toHaveValue("");
    await expect(page.getByLabel("Your email")).toHaveValue("keyboard@example.test");
    await page.getByLabel("Message").fill("Another");
    await expect(page.getByText("Message sent.", { exact: true })).toHaveCount(0);
  });

  test("a failed send keeps every value; Too many tries says when to try again", async ({ page }) => {
    await page.goto(fixture());
    await page.getByLabel("What’s it about?").selectOption("account");
    await page.getByLabel("Your email").fill("keep@example.test");
    await page.getByLabel("Message").fill("please fail this one");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Couldn’t send your message.");
    await expect(page.getByLabel("What’s it about?")).toHaveValue("account");
    await expect(page.getByLabel("Your email")).toHaveValue("keep@example.test");
    await expect(page.getByLabel("Message")).toHaveValue("please fail this one");
    await page.getByLabel("Message").fill("this is a rate test");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Too many tries.");
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Try again in 10 minutes.");
  });
});
