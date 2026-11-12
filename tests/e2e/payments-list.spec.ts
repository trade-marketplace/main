import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { PAYMENT_STATES } from "../../src/lib/account/payments-list";
import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";
import { SECURITY_PASSWORD, SECURITY_USER, SECURITY_TRADIE, startSecurityAuthStub } from "./support/security-auth-stub";

const preview = process.env.PAYMENTS_LIST_PREVIEW_URL || process.env.POSTED_PREVIEW_E2E_URL || "http://127.0.0.1:3101";
const app = process.env.PAYMENTS_LIST_E2E_APP_URL, database = process.env.PAYMENTS_LIST_E2E_DATABASE_URL;
test.use({ trace: "on-first-retry", reducedMotion: "reduce" });
test("payment previews retain the production guard", async ({ page }) => {
  expect((await page.goto("/dev/components/payments-list"))?.status()).toBe(404);
});
for (const viewport of VIEWPORTS) test(`all payment list states at ${viewport.width}px`, async ({ page }) => {
  test.setTimeout(180_000); await page.setViewportSize(viewport);
  for (const state of PAYMENT_STATES) {
    await page.goto(`${preview}/dev/components/payments-list?state=${state}`);
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByRole("heading", { level: 1, name: "Payments", exact: true })).toBeVisible();
    await expect(page.getByText("Tax invoices are coming soon.", { exact: true })).toBeVisible();
    if (state === "empty") await expect(page.getByRole("heading", { name: "No payments yet.", exact: true })).toBeVisible();
    if (state === "error") await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
    if (state === "offline") await expect(page.getByText("You’re offline.", { exact: true })).toBeVisible();
    if (state === "loading") await expect(page.getByRole("table", { name: "Payments", exact: true })).toHaveAttribute("aria-busy", "true");
    if (state === "with-refund") await expect(page.getByText("−$120.00", { exact: true })).toBeVisible();
    if (state === "part-refund") await expect(page.getByText("−$30.00", { exact: true })).toBeVisible();
    if (state === "page-2") await expect(page.getByText("Showing 26–30 of 30", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), state).toBe(true);
    await expectNoA11yViolations(page);
  }
});
test("preview error recovery and pagination work with the keyboard and Back", async ({ page }) => {
  await page.goto(`${preview}/dev/components/payments-list?state=error`);
  await page.getByRole("button", { name: "Try again", exact: true }).press("Enter");
  await expect(page.getByRole("link", { name: "Sub wiring", exact: true })).toBeVisible();
  await page.goto(`${preview}/dev/components/payments-list?state=page-2`);
  await page.getByRole("link", { name: "Previous page", exact: true }).press("Enter");
  await expect(page.getByText("Showing 1–25 of 30", { exact: true })).toBeVisible();
  await page.goBack(); await expect(page.getByText("Showing 26–30 of 30", { exact: true })).toBeVisible();
  await expectNoA11yViolations(page);
});

test.describe("actual customer payment list", () => {
  test.skip(!app || !database, "Needs a dedicated localhost lane_d_156 database and local Auth stand-in.");
  test.describe.configure({ mode: "serial", timeout: 120_000 });
  let db: pg.Client, auth: Awaited<ReturnType<typeof startSecurityAuthStub>>;
  const jobs: string[] = [];
  test.beforeAll(async () => {
    const url = new URL(database!);
    if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/lane_d_156" || url.search || !["127.0.0.1", "localhost"].includes(new URL(app!).hostname)) throw Error("Use a disposable localhost lane_d_156 database and app.");
    auth = await startSecurityAuthStub(Number(process.env.PAYMENTS_LIST_E2E_AUTH_PORT ?? 55440));
    db = new pg.Client({ connectionString: database }); await db.connect();
    for (const [who, role, name] of [[SECURITY_USER, "CUSTOMER", "Sarah"], [SECURITY_TRADIE, "TRADIE", "Jack"]] as const) {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2) ON CONFLICT(id) DO NOTHING", [who.id, who.email]);
      await db.query("INSERT INTO profiles(id,email,role,first_name,email_verified_at,updated_at) VALUES($1,$2,$3,$4,now(),now()) ON CONFLICT(id) DO UPDATE SET role=excluded.role,email_verified_at=now()", [who.id, who.email, role, name]);
    }
    // Fresh jobs on every run; payments are immutable business history and are never deleted for cleanup.
    const old = await db.query("SELECT count(*)::int AS n FROM payments p JOIN jobs j ON j.id=p.job_id WHERE j.customer_id=$1", [SECURITY_USER.id]);
    if (old.rows[0].n !== 0) throw Error("Use a fresh migrated lane_d_156 database for this journey.");
    const foreign = randomUUID();
    await db.query("INSERT INTO auth.users(id) VALUES($1)", [foreign]);
    await db.query("INSERT INTO profiles(id,email,role,first_name) VALUES($1,$2,'CUSTOMER','Other')", [foreign, `${foreign}@example.test`]);
    for (let n = 0; n < 30; n++) {
      const job = randomUUID(); jobs.push(job);
      await db.query("INSERT INTO jobs(id,customer_id,category,title,description,address_line1,suburb,city,status) VALUES($1,$2,'OTHER',$3,'Local payment navigation fixture','1 Fixture Street','Windsor','Invercargill','REVIEW')", [job, n === 29 ? foreign : SECURITY_USER.id, n === 29 ? "Foreign customer canary" : `Payments fixture ${n}`]);
      const status = n === 0 ? "PARTIALLY_REFUNDED" : n === 27 ? "PENDING" : n === 28 ? "FAILED" : "PAID";
      await db.query("INSERT INTO payments(job_id,kind,status,amount_cents,refunded_cents,paid_at,refunded_at,idempotency_key,provider_payment_id,provider_checkout_id,failure_reason) VALUES($1,'QUICK_LOOK',$2,3000,$3,$4,$5,$6,$7,$8,'Private provider canary156')", [job, status, n === 0 ? 1200 : 0, n < 27 || n === 29 ? new Date(Date.UTC(2026, 10, n + 1)) : null, n === 0 ? new Date("2026-12-01T00:00:00Z") : null, randomUUID(), `pi_canary156_${n}`, `cs_canary156_${n}`]);
    }
  });
  test.afterAll(async () => { await auth?.close(); await db?.end(); });
  async function login(page: Page, tradie = false) {
    await page.goto(`${app}/login?next=%2Fprofile%2Fpayments`);
    await page.getByLabel("Email", { exact: true }).fill(tradie ? SECURITY_TRADIE.email : SECURITY_USER.email);
    await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(`${app}${tradie ? "/jobs" : "/profile/payments"}`, { timeout: 20_000 });
  }
  test("real account link, refunded list, pagination, job opening and Back retain the page", async ({ page }) => {
    await login(page);
    await page.getByRole("link", { name: "Profile", exact: true }).click(); await expect(page).toHaveURL(`${app}/profile`);
    await page.getByRole("link", { name: "Payments", exact: true }).press("Enter"); await expect(page).toHaveURL(`${app}/profile/payments`);
    await expect(page.getByText("Showing 1–25 of 28", { exact: true })).toBeVisible();
    await expect(page.getByText("−$12.00", { exact: true })).toBeVisible();
    const html = await page.content();
    expect(html).not.toMatch(/pi_canary156|cs_canary156|Private provider canary156|Foreign customer canary|Payments fixture 27|Payments fixture 28/);
    await page.getByRole("link", { name: "Next page", exact: true }).press("Enter");
    await expect(page).toHaveURL(`${app}/profile/payments?page=2`); await expect(page.getByText("Showing 26–28 of 28", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Payments fixture 0", exact: true }).press("Enter");
    await expect(page).toHaveURL(`${app}/jobs/${jobs[0]}`); await expect(page.getByRole("heading", { level: 1, name: "Payments fixture 0", exact: true })).toBeVisible();
    await page.goBack(); await expect(page).toHaveURL(`${app}/profile/payments?page=2`);
    await expect(page.getByText("Showing 26–28 of 28", { exact: true })).toBeVisible();
    await page.reload(); await expect(page.getByText("Showing 26–28 of 28", { exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready); await expectNoA11yViolations(page);
    const count = await db.query("SELECT count(*)::int AS n FROM payments p JOIN jobs j ON j.id=p.job_id WHERE j.customer_id=$1", [SECURITY_USER.id]); expect(count.rows[0].n).toBe(29);
  });
  test("tradies never receive the customer's list", async ({ page }) => {
    await login(page, true);
    await page.goto(`${app}/profile/payments`);
    // Existing protected auth proxy redirects this route before the page's own customer-only 404.
    await expect(page).toHaveURL(`${app}/jobs`);
    expect(await page.content()).not.toMatch(/Payments fixture|pi_canary156|cs_canary156|−\$12.00/);
  });
});
