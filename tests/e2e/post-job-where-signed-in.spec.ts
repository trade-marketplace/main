import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { postingDateRange } from "../../src/lib/job-time-windows";
import { startSecurityAuthStub, SECURITY_PASSWORD, SECURITY_USER, SECURITY_TRADIE } from "./support/security-auth-stub";
import { expectNoA11yViolations } from "./support/a11y";
const app = process.env.WHERE_E2E_APP_URL; const database = process.env.WHERE_E2E_DATABASE_URL;
test.describe("signed-in scheduling through real actions and PostgreSQL", () => {
  test.skip(!app || !database, "requires the task-owned app, Auth double and disposable database");
  test.describe.configure({ mode: "serial" }); test.use({ reducedMotion: "reduce" });
  let auth: Awaited<ReturnType<typeof startSecurityAuthStub>>; let db: pg.Client;
  test.beforeAll(async () => {
    if (!["localhost", "127.0.0.1"].includes(new URL(app!).hostname) || new URL(database!).hostname !== "127.0.0.1" || new URL(database!).pathname !== "/issue119") throw new Error("Task-owned localhost app and database required");
    auth = await startSecurityAuthStub(54319); db = new pg.Client({ connectionString: database }); await db.connect();
    for (const user of [SECURITY_USER, SECURITY_TRADIE]) {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2) ON CONFLICT(id) DO NOTHING", [user.id, user.email]);
      await db.query("INSERT INTO profiles(id,email,role,first_name,email_verified_at,updated_at) VALUES($1,$2,'CUSTOMER','Schedule Demo',now(),now()) ON CONFLICT(id) DO UPDATE SET role='CUSTOMER'", [user.id, user.email]);
    }
  });
  test.afterAll(async () => { await auth?.close(); await db?.end(); });
  async function login(page: Page, next = "/jobs/new") {
    await page.goto(`${app}/login?next=${encodeURIComponent(next)}`); await page.getByLabel("Email", { exact: true }).fill(SECURITY_USER.email); await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD); await page.getByRole("button", { name: "Log in", exact: true }).click(); await expect(page).toHaveURL(`${app}${next}`);
  }
  async function job() {
    const id = randomUUID(); await db.query("INSERT INTO jobs(id,customer_id,category,title,description,address_line1,suburb,city,status,price_cents,updated_at) VALUES($1,$2,'OTHER','Hang a door','Interior door, frame is fine.','1 Example Street','Gladstone','Invercargill','BOOKABLE',12000,now())", [id, SECURITY_USER.id]);
    await db.query("INSERT INTO job_time_windows(job_id,date,time_of_day) VALUES($1,'2026-01-01','MORNING')", [id]); return id;
  }
  test("customer draft saves business/unit/access/windows and restores from server without browser state", async ({ page }) => {
    test.setTimeout(90_000); await db.query("DELETE FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id]); await login(page);
    await page.getByRole("textbox", { name: "Describe the job", exact: true }).fill("Lights and wiring in the lounge need checking."); await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Add some photos", exact: true })).toBeVisible(); await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Where and when?", exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "Address", exact: true }).fill("1 Example Street"); await expect(page.getByLabel("Suburb", { exact: true })).toBeVisible();
    await page.getByLabel("Suburb", { exact: true }).fill("Gladstone"); await page.getByLabel("City", { exact: true }).fill("Invercargill");
    await page.getByLabel("Unit / flat (optional)", { exact: true }).fill("Shop 2"); await page.getByLabel("Anything else? (optional)", { exact: true }).fill("Use the business entrance.");
    await page.getByRole("button", { name: "Any time", exact: true }).click(); await page.getByRole("checkbox", { name: "ASAP: today if possible", exact: true }).check();
    await page.getByRole("button", { name: "Next", exact: true }).click(); await expect(page.getByRole("heading", { name: "All good?", exact: true })).toBeVisible();
    const saved = (await db.query("SELECT data FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id])).rows[0].data;
    expect(saved).toMatchObject({ addressLine1: "1 Example Street", addressLine2: "Shop 2", accessNotes: "Use the business entrance.", anyTime: true, asap: true }); expect(saved.timeWindows).toHaveLength(21);
    await page.evaluate(() => localStorage.clear()); await page.goto(`${app}/jobs/new?step=where`);
    await expect(page.getByLabel("Unit / flat (optional)", { exact: true })).toHaveValue("Shop 2"); await expect(page.locator('input[name="time-windows"]:checked')).toHaveCount(21);
    await page.getByRole("button", { name: "Save & exit", exact: true }).click(); await expect(page).toHaveURL(`${app}/`);
    expect((await db.query("SELECT data->>'postKey' AS key FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id])).rows[0].key).toBe(saved.postKey);
  });
  test("expired reminder opens owned editor → new windows/ASAP save → refresh → working Back to inbox", async ({ page }) => {
    const id = await job(); await db.query("INSERT INTO notifications(id,user_id,type,payload) VALUES($1,$2,'job.reschedule_requested',$3)", [randomUUID(), SECURITY_USER.id, { jobId: id, refreshWindows: true }]);
    await login(page, "/notifications"); await page.getByRole("link", { name: /New time requested/ }).first().click(); await expect(page).toHaveURL(`${app}/jobs/${id}/windows`);
    await expect(page.getByRole("heading", { name: "When do you need it?", exact: true })).toBeVisible(); await page.locator('input[name="time-windows"]').nth(1).press("Space");
    await page.getByRole("checkbox", { name: "ASAP: today if possible", exact: true }).check(); await page.getByRole("button", { name: "Save changes", exact: true }).press("Enter");
    await expect(page.getByText("Saved.", { exact: true })).toBeVisible(); await page.reload(); await expect(page.locator('input[name="time-windows"]').nth(1)).toBeChecked();
    const result = (await db.query("SELECT status,price_cents,asap FROM jobs WHERE id=$1", [id])).rows[0]; expect(result).toEqual({ status: "BOOKABLE", price_cents: 12000, asap: true });
    expect((await db.query("SELECT date::text,time_of_day FROM job_time_windows WHERE job_id=$1", [id])).rows).toEqual([{ date: postingDateRange(new Date()).today, time_of_day: "AFTERNOON" }]);
    await expectNoA11yViolations(page); await page.getByRole("link", { name: "Back", exact: true }).click(); await expect(page).toHaveURL(`${app}/notifications`);
  });
  test("a claim after page load prevents updates, and another customer's job is unavailable", async ({ page }) => {
    const id = await job(); await login(page, `/jobs/${id}/windows`);
    await db.query("UPDATE jobs SET status='ASSIGNED',worker_id=$2 WHERE id=$1", [id, SECURITY_TRADIE.id]);
    await page.locator('input[name="time-windows"]').first().check(); await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByText("Job updated", { exact: true })).toBeVisible(); await expect(page.getByRole("button", { name: "Save changes", exact: true })).toHaveAttribute("aria-disabled", "true");
    const foreign = await job(); await db.query("UPDATE jobs SET customer_id=$2 WHERE id=$1", [foreign, SECURITY_TRADIE.id]); await page.goto(`${app}/jobs/${foreign}/windows`); await expect(page.getByRole("heading", { name: /couldn.t find|not found/i })).toBeVisible();
  });
  test("session expiry preserves the edited schedule while the standard sign-in dialog opens", async ({ page }) => {
    const id = await job(); await login(page, `/jobs/${id}/windows`); await page.locator('input[name="time-windows"]').first().check();
    await page.context().clearCookies(); await page.getByRole("button", { name: "Save changes", exact: true }).click(); await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.locator('input[name="time-windows"]').first()).toBeChecked(); expect((await db.query("SELECT date::text FROM job_time_windows WHERE job_id=$1", [id])).rows).toEqual([{ date: "2026-01-01" }]);
  });
});
