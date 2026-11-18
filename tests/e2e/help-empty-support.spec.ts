import { randomUUID } from "node:crypto";
import pg from "pg";
import { expect, test, type Page } from "@playwright/test";
import { sessionCookies, startAuthStub } from "../../scripts/screenshots/auth-stub";
import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const query = "unmatched search";
const returnPath = "/help?q=unmatched+search&topic=payments";
const composer = "/support/new?returnTo=" + encodeURIComponent(returnPath);
const messageLink = { name: "Message us", exact: true };
const email = "mailto:hello@trademarketplace.nz";

function controls(page: Page) {
  const search = page.getByRole("combobox", { name: "Search help articles" });
  const suggestion = page.getByRole("listbox", { name: "Suggested help articles" }).locator("..").getByRole("link", messageLink);
  const empty = page.getByRole("region", { name: "Help articles" }).getByRole("link", messageLink);
  return { search, suggestion, empty };
}

for (const viewport of VIEWPORTS) {
  test(`guest no-results actions at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/help?topic=payments");
    const { search, suggestion, empty } = controls(page);
    await page.locator("[data-help-ready]").waitFor();
    await search.fill(query);
    await expect(suggestion).toHaveAttribute("href", email);
    await suggestion.click({ trial: true });
    await search.press("Tab");
    await expect(suggestion).toBeFocused();
    await expect(empty).toHaveAttribute("href", email);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expectNoA11yViolations(page);
    await search.focus();
    await search.press("Escape");
    await expect(suggestion).toHaveCount(0);
    await expect(empty).toBeVisible();
    await expectNoA11yViolations(page);
  });
}

const app = process.env.HELP_EMPTY_APP_URL;
const database = process.env.HELP_EMPTY_DATABASE_URL;
const authUrl = "http://127.0.0.1:54584";
test.describe("signed-in Help no-results handoffs", () => {
  test.skip(!app || !database, "Requires a disposable local Help database and Auth stand-in.");
  test.describe.configure({ mode: "serial", timeout: 60000 });
  let db: pg.Client;
  let auth: Awaited<ReturnType<typeof startAuthStub>>;
  const secret = randomUUID();
  test.beforeAll(async () => {
    const url = new URL(database!);
    if (new URL(app!).hostname !== "127.0.0.1" || url.hostname !== "127.0.0.1" || url.pathname !== "/help_584" || url.search || url.hash) {
      throw new Error("Dedicated local Help fixtures required");
    }
    auth = await startAuthStub(secret, 54584);
    db = new pg.Client({ connectionString: database });
    await db.connect();
  });
  test.afterAll(async () => {
    await db?.end();
    if (auth) {
      auth.closeAllConnections();
      await new Promise<void>(resolve => auth.close(() => resolve()));
    }
  });
  for (const role of ["CUSTOMER", "TRADIE", "ADMIN"] as const) {
    test(`${role} reaches the right inbox or returns from a private thread`, async ({ page, context }) => {
      const person = { id: randomUUID(), email: `${randomUUID()}@example.test` };
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [person.id, person.email]);
      await db.query("INSERT INTO profiles(id,email,role,first_name,email_verified_at,updated_at) VALUES($1,$2,$3,'Sarah',now(),now())", [person.id, person.email, role]);
      await context.addCookies(await sessionCookies(person, secret, app!, authUrl));
      // A signed-in customer and tradie follow the complete journey on phone and desktop respectively.
      await page.setViewportSize(role === "CUSTOMER" ? { width: 390, height: 844 } : { width: 1440, height: 900 });
      for (const entry of ["suggestion", "empty"] as const) {
        await page.goto(app + "/help?topic=payments");
        await page.locator("[data-help-ready]").waitFor();
        const { search, suggestion, empty } = controls(page);
        await search.fill(query);
        await expect(suggestion).toHaveAttribute("href", role === "ADMIN" ? "/admin/support" : composer);
        if (entry === "suggestion") {
          await search.press("Tab");
          await expect(suggestion).toBeFocused();
          await expectNoA11yViolations(page);
          await suggestion.press("Enter");
        } else {
          await search.press("Escape");
          await expectNoA11yViolations(page);
          await empty.click();
        }
        if (role === "ADMIN") {
          await expect(page).toHaveURL(app + "/admin/support");
          continue;
        }
        await expect(page).toHaveURL(app + composer);
        const subject = `Help with ${entry}`;
        await page.getByRole("textbox", { name: "Subject", exact: true }).fill(subject);
        await page.getByRole("textbox", { name: "Message", exact: true }).fill("Please help me find this article.");
        await page.getByRole("button", { name: "Send", exact: true }).click();
        await expect(page.getByRole("heading", { name: subject, exact: true })).toBeVisible();
        await page.getByRole("main").getByRole("link", { name: "Back", exact: true }).click();
        await expect(page).toHaveURL(app + returnPath);
        await expect(search).toHaveValue(query);
        await expect(page.getByRole("button", { name: "Payments", exact: true })).toHaveAttribute("aria-pressed", "true");
      }
    });
  }
});
