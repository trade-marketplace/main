import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import pg from "pg";
import { SECURITY_PASSWORD, SECURITY_TRADIE, SECURITY_USER, startSecurityAuthStub } from "./support/security-auth-stub";
import { expect, test } from "@playwright/test";
import { expectNoA11yViolations } from "./support/a11y";
const preview = process.env.POSTED_PREVIEW_E2E_URL || "http://127.0.0.1:3101";
const states = ["not-booked", "booked", "electrical", "other-trade", "late-menu", "sending", "sent", "try-later", "waiting-extra", "submitted", "completed", "on-hold", "error", "offline", "loading", "load-error", "recovery-gallery"];
test("workspace preview keeps the production guard", async ({ page }) => { expect((await page.goto("/dev/components/worker-workspace?state=booked"))?.status()).toBe(404); });
for (const width of [320, 390, 768, 1024, 1440]) test(`workspace states at ${width}px`, async ({ page }) => {
  test.setTimeout(180_000); await page.setViewportSize({ width, height: 1000 });
  for (const state of states) await test.step(state, async () => {
    expect((await page.goto(`${preview}/dev/components/worker-workspace?state=${state}`))?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    if (state === "loading") await expect(page.getByRole("status", { name: "Loading workspace" })).toBeVisible();
    else if (state === "load-error") await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
    else if (state !== "recovery-gallery") {
      const main = page.locator("main"); await expect(main).toContainText("Earn $259.20"); expect(await main.innerText()).not.toMatch(/You earn|customer price|margin|estimate/i);
      if (state === "other-trade") { expect(await main.innerText()).not.toContain("Telfer"); await expect(main).toContainText("Keep your receipt. You’ll add it when you finish."); }
      if (state === "waiting-extra") await expect(page.getByRole("button", { name: "Finish job", exact: true })).toHaveAttribute("aria-disabled", "true");
      if (["submitted", "completed", "on-hold"].includes(state)) { await expect(page.getByRole("button", { name: "Running late", exact: true })).toHaveCount(0); await expect(page.getByRole("link", { name: "Finish job", exact: true })).toHaveCount(0); }
      if (state === "offline") await expect(page.getByRole("button", { name: "I’m on my way", exact: true })).toHaveAttribute("aria-disabled", "true");
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await expectNoA11yViolations(page);
    if (process.env.WORKSPACE_SCREENSHOTS_DIR && [390, 1440].includes(width)) await page.screenshot({ path: `${process.env.WORKSPACE_SCREENSHOTS_DIR}/${state}-${width}.png`, fullPage: true });
  });
});
test("keyboard copies the supplier number, sends 30 minutes late and dismisses its menu", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]); await page.goto(`${preview}/dev/components/worker-workspace?state=electrical`);
  await page.getByRole("button", { name: "Copy TM-1005", exact: true }).press("Enter"); expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("TM-1005");
  const trigger = page.getByRole("button", { name: "Running late", exact: true }); await trigger.press("ArrowDown"); await expect(page.getByRole("menuitem", { name: "15 min", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown"); await expect(page.getByRole("menuitem", { name: "30 min", exact: true })).toBeFocused(); await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toHaveCount(0); await expect(trigger).toBeFocused(); await expect(page.getByRole("status").filter({ hasText: "Sent to Sarah." })).toBeVisible();
  await trigger.press("ArrowDown"); await page.keyboard.press("Escape"); await expect(page.getByRole("menu")).toHaveCount(0); await expect(trigger).toBeFocused(); await expectNoA11yViolations(page);
  await page.getByRole("button", { name: "Customer not home", exact: true }).press("Enter"); await expect(page.getByRole("status").filter({ hasText: "The office has been told." })).toBeVisible();
});
test("retry recovers an update and a load error; booking/finish and breadcrumb keep the exact planned addresses", async ({ page }) => {
  await page.goto(`${preview}/dev/components/worker-workspace?state=error`); await page.getByRole("button", { name: "Try again", exact: true }).press("Enter"); await expect(page.getByRole("alert").filter({ hasText: "Couldn’t send this update." })).toHaveCount(0); await expect(page.getByRole("status").filter({ hasText: "Sent to Sarah." })).toBeVisible();
  await page.goto(`${preview}/dev/components/worker-workspace?state=load-error`); await page.getByRole("button", { name: "Try again", exact: true }).press("Enter"); await expect(page.getByRole("heading", { name: "Sub wiring", exact: true })).toBeVisible();
  for (const label of ["Change", "Need to reschedule"]) await expect(page.getByRole("link", { name: label, exact: true })).toHaveAttribute("href", "/jobs/14900000-0000-4000-8000-000000000001/book");
  await expect(page.getByRole("link", { name: "Finish job", exact: true })).toHaveAttribute("href", "/jobs/14900000-0000-4000-8000-000000000001/complete");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "My work", exact: true })).toHaveAttribute("href", "/dashboard");
  await expectNoA11yViolations(page);
});


test.describe("real assigned workspace and updates", () => {
  const app = process.env.WORKSPACE_E2E_APP_URL, database = process.env.WORKSPACE_E2E_DATABASE_URL;
  test.skip(!app || !database, "Requires dedicated localhost lane_b_149 app/database and fake Auth.");
  test.describe.configure({ mode: "serial", timeout: 120_000 });
  let db: pg.Client, auth: Awaited<ReturnType<typeof startSecurityAuthStub>>;
  const job = randomUUID(), office = "14900000-0000-4000-8000-000000000099", office2 = "14900000-0000-4000-8000-000000000098", other = "14900000-0000-4000-8000-000000000088";
  test.beforeAll(async () => {
    const url = new URL(database!); if (url.hostname !== "127.0.0.1" || url.pathname !== "/lane_b_149" || url.search || url.hash || !["127.0.0.1", "localhost"].includes(new URL(app!).hostname)) throw Error("Workspace fixture requires dedicated localhost lane_b_149 app/database.");
    auth = await startSecurityAuthStub(Number(process.env.WORKSPACE_E2E_AUTH_PORT ?? 54520)); db = new pg.Client({ connectionString: database }); await db.connect();
    for (const [id, email, role] of [[SECURITY_USER.id, SECURITY_USER.email, "CUSTOMER"], [SECURITY_TRADIE.id, SECURITY_TRADIE.email, "TRADIE"], [office, "office-workspace@example.test", "ADMIN"], [office2, "office2-workspace@example.test", "ADMIN"], [other, "other-workspace@example.test", "TRADIE"]]) {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2) ON CONFLICT(id) DO NOTHING", [id, email]);
      await db.query("INSERT INTO profiles(id,email,role,first_name,last_name,phone,email_verified_at,updated_at) VALUES($1,$2,$3,'Sarah','Thompson','+64215550192',now(),now()) ON CONFLICT(id) DO UPDATE SET role=excluded.role,first_name=excluded.first_name,last_name=excluded.last_name,phone=excluded.phone,email_verified_at=now()", [id, email, role]);
    }
    await db.query("INSERT INTO jobs(id,customer_id,category,status,title,description,address_line1,suburb,city,any_time) VALUES($1,$2,'OTHER','REVIEW','Real workspace job','Move the couch upstairs.','149 Private Street','Windsor','Invercargill',true)", [job, SECURITY_USER.id]);
    await promisify(execFile)(process.execPath, ["--conditions=react-server", "--import", "tsx", "--input-type=module", "-e", `import { createDatabaseClient } from './src/server/database-client.ts'; import { priceJob } from './src/server/pricing/price-job.ts'; const db = createDatabaseClient(process.env.WORKSPACE_E2E_DATABASE_URL); try { await priceJob(db, { jobId: '${job}', minutes: 120, materialsCents: 8500, pricedById: '${office}' }); } finally { await db.$disconnect(); }`]);
    await db.query("UPDATE jobs SET status='ASSIGNED',worker_id=$2 WHERE id=$1", [job, SECURITY_TRADIE.id]);
  });
  test.afterAll(async () => { await auth?.close(); await db?.end(); });
  test("actual buttons notify atomically, survive reload and follow Messages/Back and My work", async ({ page, context }) => {
    await page.goto(`${app}/login?next=${encodeURIComponent(`/jobs/${job}`)}`); await page.getByLabel("Email", { exact: true }).fill(SECURITY_TRADIE.email); await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD); await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Real workspace job", exact: true })).toBeVisible(); await expect(page.getByRole("region", { name: "Customer contact", exact: true })).toContainText("149 Private Street");
    const pricing = (await db.query("SELECT worker_gross_cents + holiday_pay_cents AS earn FROM job_pricing WHERE job_id=$1", [job])).rows[0]; const earn = new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(pricing.earn / 100);
    await expect(page.getByText(`Earn ${earn}`, { exact: true })).toBeVisible(); expect(await page.locator("main").innerText()).not.toMatch(/Telfer|customer price|margin|You earn/);
    await context.setOffline(true); await expect(page.getByRole("button", { name: "I’m on my way", exact: true })).toHaveAttribute("aria-disabled", "true"); await page.getByRole("button", { name: "I’m on my way", exact: true }).press("Enter"); expect((await db.query("SELECT count(*)::int AS n FROM audit_log WHERE record_id=$1 AND action='job.on_my_way'", [job])).rows[0].n).toBe(0); await context.setOffline(false); await expect(page.getByRole("button", { name: "I’m on my way", exact: true })).not.toHaveAttribute("aria-disabled", "true");
    await page.getByRole("button", { name: "I’m on my way", exact: true }).press("Enter"); await expect(page.getByRole("status").filter({ hasText: "Sent to Sarah." })).toBeVisible();
    const late = page.getByRole("button", { name: "Running late", exact: true }); await late.press("ArrowDown"); await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter"); await expect(page.getByRole("menu")).toHaveCount(0); await expect(page.getByRole("button", { name: "Customer not home", exact: true })).not.toHaveAttribute("aria-disabled", "true");
    await page.getByRole("button", { name: "Customer not home", exact: true }).press("Enter"); await expect(page.getByRole("status").filter({ hasText: "The office has been told." })).toBeVisible();
    await page.getByRole("button", { name: "Customer not home", exact: true }).press("Enter"); await expect(page.getByRole("button", { name: "Customer not home", exact: true })).not.toHaveAttribute("aria-busy", "true");
    const audits = (await db.query("SELECT action,actor_id FROM audit_log WHERE record_id=$1 AND action IN ('job.on_my_way','job.running_late','job.customer_not_home')", [job])).rows; expect(audits).toHaveLength(3); expect(audits.every(row => row.actor_id === SECURITY_TRADIE.id)).toBe(true);
    const notices = (await db.query("SELECT type,user_id,payload FROM notifications WHERE payload->>'jobId'=$1 AND type IN ('job.on_my_way','job.running_late','job.customer_not_home')", [job])).rows;
    expect(notices.filter(row => row.type === 'job.on_my_way').map(row => row.user_id)).toEqual([SECURITY_USER.id]); expect(notices.find(row => row.type === 'job.running_late')).toMatchObject({ user_id: SECURITY_USER.id, payload: { lateMinutes: 30 } });
    expect(notices.filter(row => row.type === 'job.customer_not_home').map(row => row.user_id).sort()).toEqual((await db.query("SELECT id FROM profiles WHERE role='ADMIN'")).rows.map(row => row.id).sort());
    await page.getByRole("region", { name: "Customer contact", exact: true }).getByRole("link", { name: "Messages", exact: true }).press("Enter"); await expect(page.getByRole("heading", { name: "Messages", exact: true })).toBeVisible(); await page.goBack(); await expect(page.getByRole("heading", { name: "Real workspace job", exact: true })).toBeVisible();
    await page.reload(); await expect(page.getByText(`Earn ${earn}`, { exact: true })).toBeVisible(); await expectNoA11yViolations(page);
    await expect(page.getByRole("link", { name: "Book a time", exact: true })).toHaveAttribute("href", `/jobs/${job}/book`); await expect(page.getByRole("link", { name: "Finish job", exact: true })).toHaveAttribute("href", `/jobs/${job}/complete`);
    await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "My work", exact: true }).press("Enter"); await expect(page).toHaveURL(/\/dashboard$/); await expect(page.getByRole("heading", { name: "Wrong address.", exact: true })).toBeVisible(); await page.goBack(); await expect(page.getByRole("heading", { name: "Real workspace job", exact: true })).toBeVisible();
    await db.query("UPDATE jobs SET worker_id=$2 WHERE id=$1", [job, other]); const denied = await page.request.get(`${app}/jobs/${job}`); expect(denied.status()).toBe(404); expect(await denied.text()).not.toMatch(/149 Private Street|Real workspace job/);
  });
});
