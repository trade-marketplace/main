import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { MY_WORK_STATES } from "../../src/lib/my-work";
import { expectNoA11yViolations } from "./support/a11y";
import { SECURITY_PASSWORD, SECURITY_TRADIE, SECURITY_USER, startSecurityAuthStub } from "./support/security-auth-stub";
import { VIEWPORTS } from "./support/viewports";

const preview = process.env.POSTED_PREVIEW_E2E_URL || "http://127.0.0.1:3101";
const app = process.env.MY_WORK_E2E_APP_URL, database = process.env.MY_WORK_E2E_DATABASE_URL;
const at = (state: string) => `${preview}/dev/components/my-work?state=${state}`;
test("My work previews remain guarded on production", async ({ page }) => { expect((await page.goto("/dev/components/my-work"))?.status()).toBe(404); });
for (const viewport of VIEWPORTS) test(`all My work states fit and pass axe at ${viewport.width}px`, async ({ page }) => {
  test.setTimeout(180_000); await page.setViewportSize(viewport);
  for (const state of MY_WORK_STATES) {
    await page.goto(at(state)); await expect(page.getByRole("heading", { name: "My work", exact: true })).toBeVisible();
    if (state === "empty") await expect(page.getByRole("heading", { name: "No jobs yet.", exact: true })).toBeVisible();
    if (state === "waiting-ok") await expect(page.getByText("Waiting on OK", { exact: true }).filter({ visible: true }).first()).toBeVisible();
    if (state === "on-hold") await expect(page.getByText("On hold", { exact: true }).filter({ visible: true }).first()).toBeVisible();
    if (state === "paused") await expect(page.getByText("Paused", { exact: true }).filter({ visible: true }).first()).toBeVisible();
    if (state === "queued-and-paid") { await expect(page.getByText("Queued", { exact: true }).filter({ visible: true }).first()).toBeVisible(); await expect(page.getByText("Paid", { exact: true }).filter({ visible: true }).first()).toBeVisible(); }
    if (state === "quotes-empty") await expect(page.getByRole("heading", { name: "No quotes yet.", exact: true })).toBeVisible();
    if (state === "error") await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
    if (state === "loading") await expect(page.getByRole("status").filter({ hasText: "Loading your work" })).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), state).toBe(true); await expectNoA11yViolations(page);
  }
});
test("tabs and phone columns change by keyboard, keep their URL and expose readable focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(at("full"));
  await page.getByRole("tab", { name: "Jobs", exact: true }).focus(); await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Quotes (5)", exact: true })).toHaveAttribute("aria-selected", "true"); await expect(page).toHaveURL(/tab=quotes/);
  await page.keyboard.press("ArrowLeft"); await expect(page.getByRole("tab", { name: "Jobs", exact: true })).toHaveAttribute("aria-selected", "true");
  const columns = page.getByRole("tablist", { name: "Work columns", exact: true });
  await columns.getByRole("tab", { name: "To book (1)", exact: true }).focus(); await page.keyboard.press("ArrowRight");
  const selected = columns.getByRole("tab", { name: "On now (2)", exact: true }); await expect(selected).toHaveAttribute("aria-selected", "true"); await expect(page).toHaveURL(/column=on-now/);
  expect(await selected.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe("none");
  await expect(page.getByRole("heading", { name: "New power point", exact: true })).toBeVisible();
  await page.reload(); await expect(selected).toHaveAttribute("aria-selected", "true"); await expectNoA11yViolations(page);
});
test("a failed read retries without losing the tab or treating the failure as empty", async ({ page }) => {
  await page.goto(at("error")); await expect(page.getByRole("heading", { name: "No jobs yet.", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Try again", exact: true }).click(); await expect(page.getByRole("heading", { name: "Sub wiring", exact: true }).first()).toBeVisible();
});

test.describe("real My work journeys", () => {
  test.skip(!app || !database, "Needs a throwaway localhost lane_c_148 database and local Auth stand-in.");
  test.describe.configure({ mode: "serial", timeout: 120_000 });
  let db: pg.Client, auth: Awaited<ReturnType<typeof startSecurityAuthStub>>;
  const me = SECURITY_TRADIE.id, customer = SECURITY_USER.id, other = "14800000-0000-4000-8000-000000000098";
  const tag = randomUUID().slice(0, 8), ids = { own: randomUUID(), booked: randomUUID(), waiting: randomUUID(), priced: randomUUID(), lost: randomUUID() };
  const title = (kind: keyof typeof ids) => `Work ${kind} ${tag}`;
  test.beforeAll(async () => {
    const target = new URL(database!);
    if (!["127.0.0.1", "localhost"].includes(target.hostname) || target.pathname !== "/lane_c_148" || target.search || !["127.0.0.1", "localhost"].includes(new URL(app!).hostname)) throw Error("Use the disposable localhost lane_c_148 database and app.");
    auth = await startSecurityAuthStub(Number(process.env.MY_WORK_E2E_AUTH_PORT ?? 54530)); db = new pg.Client({ connectionString: database }); await db.connect();
    for (const [id, email, role] of [[me, SECURITY_TRADIE.email, "TRADIE"], [customer, SECURITY_USER.email, "CUSTOMER"], [other, "my-work-other@example.test", "TRADIE"]]) {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2) ON CONFLICT(id) DO NOTHING", [id, email]);
      await db.query("INSERT INTO profiles(id,email,role,first_name,email_verified_at,updated_at) VALUES($1,$2,$3,'Jack',now(),now()) ON CONFLICT(id) DO UPDATE SET role=excluded.role,email_verified_at=now()", [id, email, role]);
    }
    for (const [kind, id] of Object.entries(ids)) await db.query("INSERT INTO jobs(id,customer_id,category,title,description,address_line1,suburb,city,any_time) VALUES($1,$2,'OTHER',$3,'Fixture description','Private fixture street','Windsor','Invercargill',true)", [id, customer, title(kind as keyof typeof ids)]);
    // Use the existing production pricing helper to seed snapshots; no pricing implementation lives in this fixture.
    const priceModule = new URL("../../src/server/pricing/price-job.ts", import.meta.url).href;
    const databaseModule = new URL("../../src/server/database-client.ts", import.meta.url).href;
    const code = `import {createDatabaseClient} from ${JSON.stringify(databaseModule)}; import {priceJob} from ${JSON.stringify(priceModule)}; const db=createDatabaseClient(process.env.MY_WORK_E2E_DATABASE_URL); try { for(const jobId of JSON.parse(process.env.MY_WORK_FIXTURE_IDS)) {const result=await priceJob(db,{jobId,minutes:120,materialsCents:5000});if(!result.ok)throw Error(result.error);} } finally {await db.$disconnect();}`;
    await promisify(execFile)(process.execPath, ["--conditions=react-server", "--import", "tsx", "--input-type=module", "-e", code], { cwd: process.cwd(), env: { ...process.env, MY_WORK_FIXTURE_IDS: JSON.stringify(Object.values(ids)) } });
    await db.query("UPDATE jobs SET status='ASSIGNED',worker_id=$2 WHERE id=ANY($1::uuid[])", [[ids.own, ids.booked], me]);
    await db.query("UPDATE jobs SET booked_date='2026-11-12',booked_time='MORNING' WHERE id=$1", [ids.booked]);
    await db.query("UPDATE jobs SET status='PRICED' WHERE id=$1", [ids.priced]);
    await db.query("UPDATE jobs SET status='ASSIGNED',worker_id=$2 WHERE id=$1", [ids.lost, other]);
    for (const id of [ids.own, ids.waiting, ids.priced, ids.lost]) await db.query("INSERT INTO estimates(job_id,worker_id,minutes,note) VALUES($1,$2,90,'Private own quote note')", [id, me]);
  });
  test.afterAll(async () => { await auth?.close(); await db?.end(); });
  async function login(page: Page, asCustomer = false) {
    await page.goto(`${app}/login?next=%2Fdashboard`); await page.getByLabel("Email", { exact: true }).fill(asCustomer ? SECURITY_USER.email : SECURITY_TRADIE.email);
    await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD); await page.getByRole("button", { name: "Log in", exact: true }).click(); await expect(page).toHaveURL(`${app}/dashboard`);
  }
  test("own job and readable quote links return to their same tab and phone column", async ({ page }) => {
    await login(page); await expect(page).toHaveTitle(/My work/);
    await page.getByRole("heading", { name: title("own"), exact: true }).locator("..").press("Enter");
    await expect(page.getByRole("heading", { name: title("own"), exact: true }).first()).toBeVisible();
    await page.getByRole("main").getByRole("link", { name: "Back to jobs", exact: true }).click(); await expect(page).toHaveURL(`${app}/dashboard`);
    await page.getByRole("link", { name: "See all paid", exact: true }).click(); await expect(page.getByRole("heading", { name: "Earnings", exact: true })).toBeVisible();
    await page.goBack(); await expect(page).toHaveURL(`${app}/dashboard`);
    await page.getByRole("tab", { name: /^Quotes/ }).click(); await expect(page).toHaveURL(`${app}/dashboard?tab=quotes`);
    await page.getByRole("link", { name: title("waiting"), exact: true }).press("Enter"); await expect(page.getByRole("heading", { name: title("waiting"), exact: true })).toBeVisible();
    await page.getByRole("main").getByRole("link", { name: "Back to jobs", exact: true }).click(); await expect(page).toHaveURL(`${app}/dashboard?tab=quotes`);
    await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole("tab", { name: "Jobs", exact: true }).click();
    await page.getByRole("tablist", { name: "Work columns", exact: true }).getByRole("tab", { name: /^On now/ }).click();
    await page.getByRole("heading", { name: title("booked"), exact: true }).locator("..").click(); await expect(page.getByRole("heading", { name: title("booked"), exact: true }).first()).toBeVisible();
    await page.getByRole("main").getByRole("link", { name: "Back to jobs", exact: true }).click(); await expect(page).toHaveURL(`${app}/dashboard?column=on-now`);
    await expect(page.getByRole("tab", { name: /^On now/ })).toHaveAttribute("aria-selected", "true"); await expectNoA11yViolations(page);
  });
  test("restricted own quote history has no refused link and never widens the job read boundary", async ({ page }) => {
    await login(page); await page.goto(`${app}/dashboard?tab=quotes`);
    for (const kind of ["priced", "lost"] as const) {
      await expect(page.getByText(title(kind), { exact: true }).filter({ visible: true })).toBeVisible(); await expect(page.locator(`a[href*="/jobs/${ids[kind]}"]`)).toHaveCount(0);
      expect((await page.goto(`${app}/jobs/${ids[kind]}?from=%2Fdashboard%3Ftab%3Dquotes`))?.status()).toBe(404);
      await page.goto(`${app}/dashboard?tab=quotes`);
    }
    await expect(page.getByRole("link", { name: title("waiting"), exact: true })).toBeVisible();
    const content = await page.getByRole("main").textContent(); expect(content).not.toContain("Private own quote note"); expect(content).not.toContain("Private fixture street");
  });
  test("customers still get My jobs and never receive the worker board or pay", async ({ page }) => {
    await login(page, true); await expect(page.getByRole("heading", { name: "My jobs", exact: true })).toBeVisible(); await expect(page).toHaveTitle(/My jobs/);
    await expect(page.getByRole("heading", { name: "My work", exact: true })).toHaveCount(0); await expect(page.getByRole("tab", { name: /^Quotes/ })).toHaveCount(0);
    expect(await page.getByRole("main").textContent()).not.toContain("Earn"); await expectNoA11yViolations(page);
  });
});
