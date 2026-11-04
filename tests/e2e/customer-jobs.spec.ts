import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import pg from "pg";
import { expect, test, type Page } from "@playwright/test";
import { mintAccessToken, sessionCookies, startAuthStub } from "../../scripts/screenshots/auth-stub";
import { expectNoA11yViolations } from "./support/a11y";

const preview = process.env.POSTED_PREVIEW_E2E_URL;
test.describe("customer jobs guarded previews", () => {
  test.setTimeout(90_000);
  test.skip(!preview, "Needs the explicit guarded preview server");
  for (const query of ["state=jobs", "tab=done", "tab=cancelled", "state=empty", "state=empty&tab=done", "state=empty&tab=cancelled", "q=not-found", "state=extra-work", "state=long", "state=pages", "state=loading", "state=error", "state=offline"]) {
    test(`${query} at five widths`, async ({ page }) => {
      const response = await page.goto(`${preview}/dev/components/customer-jobs?${query}`);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { name: "My jobs", exact: true })).toBeVisible();
      for (const width of [320, 390, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await expectNoA11yViolations(page);
      }
    });
  }
  test("tabs, search, reset and pagination work through actual URL changes", async ({ page }) => {
    await page.goto(`${preview}/dev/components/customer-jobs?state=pages`);
    await page.getByRole("link", { name: "Next page", exact: true }).click();
    await expect(page).toHaveURL(/page=2/); await expect(page.getByRole("status").filter({ hasText: "Showing" })).toContainText("21–40 of 45");
    await page.getByRole("tab", { name: /^Active/ }).focus(); await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: /^Done/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Nothing finished yet." })).toBeVisible();
    await page.getByRole("tab", { name: /^Active/ }).click();
    await page.getByRole("searchbox", { name: "Search my jobs", exact: true }).fill("does not exist");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByRole("heading", { name: "No jobs match that." })).toBeVisible();
    await page.getByRole("button", { name: "Reset filters", exact: true }).click();
    await expect(page.getByRole("table", { name: "My jobs", exact: true })).toContainText("Example job 1");
  });
  test("the production server continues to reject guarded previews", async ({ request }) => {
    const response = await request.get("/dev/components/customer-jobs"); expect(response.status()).toBe(404);
  });
});

const app = process.env.CUSTOMER_JOBS_E2E_APP_URL, database = process.env.CUSTOMER_JOBS_E2E_DATABASE_URL;
const authPort = Number(process.env.CUSTOMER_JOBS_E2E_AUTH_PORT ?? "54328");
test.describe("customer My jobs signed-in journeys", () => {
  test.skip(!app || !database, "Needs an isolated localhost issue131 app/database");
  test.describe.configure({ mode: "serial" });
  let db: pg.Client, auth: Server, authProxy: Server, secret: string;
  const customer = { id: randomUUID(), email: `customer131-${randomUUID()}@example.test` };
  const foreign = { id: randomUUID(), email: `foreign131-${randomUUID()}@example.test` };
  const worker = { id: randomUUID(), email: `worker131-${randomUUID()}@example.test` };
  const ids: string[] = [];
  test.beforeAll(async () => {
    if (!["localhost", "127.0.0.1"].includes(new URL(app!).hostname) || !["localhost", "127.0.0.1"].includes(new URL(database!).hostname) || new URL(database!).pathname !== "/issue131") throw new Error("Disposable localhost issue131 database required");
    secret = randomBytes(32).toString("hex"); auth = await startAuthStub(secret, authPort + 1);
    // Exercise the app's real password action while every Auth request remains on disposable localhost.
    authProxy = createServer(async (request, response) => {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      if (request.method === "POST" && request.url?.startsWith("/auth/v1/token?grant_type=password")) {
        const credentials = JSON.parse(body.toString());
        if (credentials.email !== customer.email || credentials.password !== "LocalFixture131!") {
          response.writeHead(400, { "content-type": "application/json" }); response.end(JSON.stringify({ code: "invalid_credentials", msg: "Invalid login credentials" })); return;
        }
        const accessToken = mintAccessToken(customer, secret);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ access_token: accessToken, refresh_token: accessToken, token_type: "bearer", expires_in: 3600,
          user: { id: customer.id, email: customer.email, email_confirmed_at: "2026-11-04T00:00:00Z", aud: "authenticated", role: "authenticated", app_metadata: { provider: "email" }, user_metadata: {}, identities: [], created_at: "2026-11-04T00:00:00Z" } })); return;
      }
      const forwarded = await fetch(`http://127.0.0.1:${authPort + 1}${request.url}`, { method: request.method, headers: { authorization: request.headers.authorization ?? "", "content-type": "application/json" }, body: request.method === "GET" || request.method === "HEAD" ? undefined : body });
      response.writeHead(forwarded.status, { "content-type": "application/json" }); response.end(await forwarded.text());
    });
    await new Promise<void>(resolve => authProxy.listen(authPort, "127.0.0.1", resolve));
    db = new pg.Client({ connectionString: database }); await db.connect();
    for (const [person, role] of [[customer, "CUSTOMER"], [foreign, "CUSTOMER"], [worker, "TRADIE"]] as const) {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [person.id, person.email]);
      await db.query("INSERT INTO profiles(id,email,role,first_name,email_verified_at) VALUES($1,$2,$3,'Browser fixture',now())", [person.id, person.email, role]);
    }
    for (let i = 0; i < 23; i++) {
      const id = randomUUID(); ids.push(id);
      await db.query("INSERT INTO jobs(id,customer_id,category,title,description,address_line1,suburb,city,status,price_cents,created_at) VALUES($1,$2,'OTHER',$3,'Private description','Private street','Windsor','Invercargill',$4,$5,$6)", [id, customer.id, `Customer list tap ${i}`, i < 21 ? "PRICED" : "REVIEW", i < 21 ? 12345 : null, new Date(Date.UTC(2026, 10, 1, i))]);
    }
  });
  test.afterAll(async () => {
    await db?.query("DELETE FROM jobs WHERE id=ANY($1::uuid[])", [ids]);
    await db?.query("DELETE FROM profiles WHERE id=ANY($1::uuid[])", [[customer.id, foreign.id, worker.id]]);
    await db?.query("DELETE FROM auth.users WHERE id=ANY($1::uuid[])", [[customer.id, foreign.id, worker.id]]);
    await db?.end(); await new Promise<void>(resolve => authProxy ? authProxy.close(() => resolve()) : resolve());
    await new Promise<void>(resolve => auth ? auth.close(() => resolve()) : resolve());
  });
  async function signIn(page: Page, person = customer) {
    await page.context().clearCookies();
    await page.context().addCookies(await sessionCookies(person, secret, app!, `http://127.0.0.1:${authPort}`));
  }
  test("search → next page → job → My jobs preserves the actual page and search", async ({ page }) => {
    await signIn(page); await page.setViewportSize({ width: 1440, height: 900 });
    const response = await page.goto(`${app}/dashboard`); expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "My jobs", exact: true })).toBeVisible();
    await page.getByRole("searchbox", { name: "Search my jobs", exact: true }).fill("tap");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page).toHaveURL(`${app}/dashboard?q=tap`);
    await page.getByRole("link", { name: "Next page", exact: true }).click();
    await expect(page).toHaveURL(`${app}/dashboard?q=tap&page=2`);
    const table = page.getByRole("table", { name: "My jobs", exact: true });
    await table.getByRole("link", { name: "Customer list tap 0", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 1, name: "Customer list tap 0", exact: true })).toBeVisible();
    await page.getByRole("main").getByRole("link", { name: "My jobs", exact: true }).click();
    await expect(page).toHaveURL(`${app}/dashboard?q=tap&page=2`);
    await expect(table).toContainText("Customer list tap 0");
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expectNoA11yViolations(page);
    }
    await page.setViewportSize({ width: 390, height: 900 });
    await page.getByRole("link", { name: "See price", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 1, name: "Customer list tap 0", exact: true })).toBeVisible();
    await page.getByRole("main").getByRole("link", { name: "My jobs", exact: true }).click();
    await expect(page).toHaveURL(`${app}/dashboard?q=tap&page=2`);
    const body = await page.content(); expect(body).not.toMatch(/marginCents|workerGrossCents|onCostCents|estimates/);
  });
  test("another customer gets their own empty list; a worker never sees customer titles or prices", async ({ page }) => {
    await signIn(page, foreign); const response = await page.goto(`${app}/dashboard`); expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Nothing on yet." })).toBeVisible(); expect(await response!.text()).not.toContain("Customer list tap");
    await signIn(page, worker); const denied = await page.goto(`${app}/dashboard`); expect(denied?.status()).toBe(404); expect(await denied!.text()).not.toContain("Customer list tap");
  });
  test("an expired list session goes through actual log-in and returns from the job to the same list", async ({ page }) => {
    await signIn(page); await page.goto(`${app}/dashboard?q=tap&page=2`);
    const table = page.getByRole("table", { name: "My jobs", exact: true });
    await page.context().clearCookies();
    await table.getByRole("link", { name: "Customer list tap 21", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Welcome back", exact: true })).toBeVisible();
    const next = new URL(page.url()).searchParams.get("next");
    expect(new URL(next!, app).searchParams.get("from")).toBe("/dashboard?q=tap&page=2");
    await page.getByRole("textbox", { name: "Email", exact: true }).fill(customer.email);
    await page.getByLabel("Password", { exact: true }).fill("LocalFixture131!");
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Customer list tap 21", exact: true })).toBeVisible();
    await page.getByRole("main").getByRole("link", { name: "My jobs", exact: true }).click();
    await expect(page).toHaveURL(`${app}/dashboard?q=tap&page=2`);
  });
});
