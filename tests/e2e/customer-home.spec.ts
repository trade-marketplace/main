import { randomBytes, randomUUID } from "node:crypto";
import type { Server } from "node:http";
import pg from "pg";
import { expect, test, type Page } from "@playwright/test";
import { sessionCookies, startAuthStub } from "../../scripts/screenshots/auth-stub";
import { expectNoA11yViolations } from "./support/a11y";

const preview = process.env.POSTED_PREVIEW_E2E_URL;
test.describe("customer home previews", () => {
  test.setTimeout(90_000);
  test.skip(!preview, "Needs the guarded preview server");
  for (const state of ["empty", "jobs", "no-action", "extra-work", "sign-off", "outside", "recent", "long", "error", "loading", "offline"]) {
    test(`${state} works at five widths with accessible states`, async ({ page }) => {
      await page.goto(`${preview}/dev/components/customer-home?state=${state}`).then(response => expect(response?.status()).toBe(200));
      await expect(page.getByRole("heading", { level: 1 })).toContainText("What needs doing?");
      for (const width of [320, 390, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await expectNoA11yViolations(page);
      }
      if (state === "empty" || state === "no-action") await expect(page.getByRole("heading", { name: /^Needs you/ })).toHaveCount(0);
      if (state === "outside") await expect(page.getByRole("link", { name: "Join the waitlist" })).toBeVisible();
      if (state === "error") await expect(page.getByRole("heading", { name: "Can’t load your jobs" })).toBeVisible();
      if (state === "offline") await expect(page.getByRole("button", { name: "Get a price" })).toHaveAttribute("aria-disabled", "true");
    });
  }
  test("job ideas survive offline Enter, then continue through the real wizard and Back", async ({ page, context }) => {
    await page.goto(`${preview}/dev/components/customer-home?state=empty`);
    await page.getByRole("button", { name: "Leaking tap", exact: true }).click();
    const description = page.getByRole("searchbox", { name: "What needs doing?", exact: true });
    await expect(description).toHaveValue("Leaking tap"); await expect(description).toBeFocused();
    await context.setOffline(true);
    await expect(page.getByRole("button", { name: "Get a price", exact: true })).toHaveAttribute("aria-disabled", "true");
    await description.press("Enter");
    await expect(page).toHaveURL(`${preview}/dev/components/customer-home?state=empty`);
    await expect(description).toHaveValue("Leaking tap");
    await context.setOffline(false);
    await expect(page.getByRole("button", { name: "Get a price", exact: true })).not.toHaveAttribute("aria-disabled", "true");
    await description.press("Enter");
    await expect(page).toHaveURL(/\/jobs\/new(?:\?|$)/);
    await expect(page.getByRole("heading", { name: "What needs doing?", exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Describe the job", exact: true })).toHaveValue("Leaking tap");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Add some photos", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Back", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Describe the job", exact: true })).toHaveValue("Leaking tap");
  });
  test("outside-area saved location follows the real waitlist form", async ({ page }) => {
    await page.goto(`${preview}/dev/components/customer-home?state=outside`);
    await page.getByRole("link", { name: "Join the waitlist" }).click();
    await expect(page).toHaveURL(/\/coming-soon\?/);
    await expect(page.getByRole("heading", { level: 1, name: "We’re not in Dunedin yet.", exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: /suburb/i })).toHaveValue("Dunedin");
    await page.getByRole("button", { name: "Tell me", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Email", exact: true })).toBeFocused();
    await expect(page.getByRole("textbox", { name: "Email", exact: true })).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("textbox", { name: "Email", exact: true })).toHaveAccessibleDescription("Enter your email.");
    // This destination has a single form and no Next/Back controls; browser Back returns to the outside-area home.
    await page.goBack();
    await expect(page.getByRole("link", { name: "Join the waitlist", exact: true })).toBeVisible();
  });
  test("category starts the real wizard with its type selected; trust opens the real page", async ({ page }) => {
    await page.goto(`${preview}/dev/components/customer-home?state=empty`);
    await page.getByRole("link", { name: "Plumbing", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/jobs\/new(?:\?|$)/);
    await expect(page.getByRole("radio", { name: "Plumbing", exact: true })).toBeChecked();
    await page.goto(`${preview}/dev/components/customer-home?state=empty`);
    await page.getByRole("link", { name: "Learn more", exact: true }).click();
    await expect(page).toHaveURL(/\/trust$/);
    await expect(page.getByRole("heading", { level: 1, name: /^Your home\.\s*Done right\.$/ })).toBeVisible();
    await expect(page.getByRole("region", { name: "Our promises", exact: true })).toContainText("No surprise bills");
  });
  test("production keeps the state previews guarded", async ({ request }) => {
    expect((await request.get("/dev/components/customer-home?state=jobs")).status()).toBe(404);
  });
});

const app = process.env.CUSTOMER_HOME_E2E_APP_URL, database = process.env.CUSTOMER_HOME_E2E_DATABASE_URL;
const authPort = Number(process.env.CUSTOMER_HOME_E2E_AUTH_PORT ?? "54336");
test.describe("signed-in customer home journeys", () => {
  test.skip(!app || !database, "Needs an isolated localhost issue115 app/database");
  test.describe.configure({ mode: "serial" });
  let db: pg.Client, auth: Server, secret: string;
  const customer = { id: randomUUID(), email: `home115-${randomUUID()}@example.test` };
  const foreign = { id: randomUUID(), email: `foreign115-${randomUUID()}@example.test` };
  const worker = { id: randomUUID(), email: `worker115-${randomUUID()}@example.test` };
  const ids: string[] = [];
  test.beforeAll(async () => {
    if (!["localhost", "127.0.0.1"].includes(new URL(app!).hostname) || !["localhost", "127.0.0.1"].includes(new URL(database!).hostname) || new URL(database!).pathname !== "/issue115") throw new Error("Disposable localhost issue115 database required");
    secret = randomBytes(32).toString("hex"); auth = await startAuthStub(secret, authPort);
    db = new pg.Client({ connectionString: database }); await db.connect();
    for (const [person, role] of [[customer, "CUSTOMER"], [foreign, "CUSTOMER"], [worker, "TRADIE"]] as const) {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [person.id, person.email]);
      await db.query("INSERT INTO profiles(id,email,role,first_name,email_verified_at) VALUES($1,$2,$3,'Browser fixture',now())", [person.id, person.email, role]);
    }
    for (const [status, title] of [["REVIEW", "Home progress tap"], ["PRICED", "Home price tap"], ["SUBMITTED", "Home sign-off tap"]]) {
      const id = randomUUID(); ids.push(id);
      await db.query("INSERT INTO jobs(id,customer_id,worker_id,category,title,description,address_line1,suburb,city,status,price_cents) VALUES($1,$2,$3,'OTHER',$4,'Private description','Private street','Windsor','Invercargill',$5,$6)", [id, customer.id, status === "SUBMITTED" ? worker.id : null, title, status, status === "REVIEW" ? null : 12345]);
    }
  });
  test.afterAll(async () => {
    await db?.query("DELETE FROM jobs WHERE id=ANY($1::uuid[])", [ids]);
    await db?.query("DELETE FROM profiles WHERE id=ANY($1::uuid[])", [[customer.id, foreign.id, worker.id]]);
    await db?.query("DELETE FROM auth.users WHERE id=ANY($1::uuid[])", [[customer.id, foreign.id, worker.id]]);
    await db?.end(); await new Promise<void>(resolve => auth ? auth.close(() => resolve()) : resolve());
  });
  async function signIn(page: Page, person = customer) {
    await page.context().clearCookies();
    await page.context().addCookies(await sessionCookies(person, secret, app!, `http://127.0.0.1:${authPort}`));
  }
  test("real action cards come first; job Back and All my jobs keep working", async ({ page }) => {
    await signIn(page); await page.setViewportSize({ width: 1440, height: 900 });
    const response = await page.goto(app!); expect(response?.status()).toBe(200);
    expect(response?.headers()["cache-control"]).toContain("private");
    const needs = page.getByRole("region", { name: /^Needs you/ });
    await expect(needs).toContainText("Home price tap"); await expect(needs).toContainText("Home sign-off tap");
    await expect(needs).not.toContainText("Home progress tap");
    await needs.getByRole("link", { name: "See price", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 1, name: "Home price tap", exact: true })).toBeVisible();
    await page.getByRole("main").getByRole("link", { name: "Home", exact: true }).click();
    await expect(page).toHaveURL(`${app}/`);
    await page.getByRole("link", { name: "All my jobs", exact: true }).first().click();
    await expect(page.getByRole("heading", { name: "My jobs", exact: true })).toBeVisible();
    await page.getByRole("table").getByRole("link", { name: "Home price tap", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Home price tap", exact: true })).toBeVisible();
    await page.getByRole("main").getByRole("link", { name: "My jobs", exact: true }).click();
    await expect(page).toHaveURL(`${app}/dashboard`);
  });
  test("a different customer sees only their empty home, and workers retain their board redirect", async ({ page }) => {
    await signIn(page, foreign); const response = await page.goto(app!); expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Nothing on yet.", exact: true })).toBeVisible();
    expect(await response!.text()).not.toContain("Home price tap");
    await signIn(page, worker); await page.goto(app!); await expect(page).toHaveURL(`${app}/jobs`);
    expect(await page.content()).not.toContain("Home price tap");
  });
});
