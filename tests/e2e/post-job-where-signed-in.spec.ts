import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { postingDateRange } from "../../src/lib/job-time-windows";
import { DRAFT_STORAGE_KEY } from "../../src/lib/job-draft";
import { editWhere, encodeWizardDraft, initialWizardDraft } from "../../src/lib/post-job-wizard";
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
  async function recoverableDraft(page: Page, partial = true) {
    const data = { postKey: randomUUID(), description: "Lights and wiring need checking upstairs.", category: "ELECTRICAL" as const, photoPaths: [], locationSource: "TYPED" as const, addressLine1: "1 Example Street", suburb: "Gladstone", city: "Invercargill", postcode: "9810", anyTime: true, asap: false, timeWindows: [] };
    await db.query("INSERT INTO job_drafts(profile_id,data,manual_category,updated_at) VALUES($1,$2,false,now()) ON CONFLICT(profile_id) DO UPDATE SET data=EXCLUDED.data,manual_category=false", [SECURITY_USER.id, data]);
    await login(page);
    const local = partial ? editWhere(initialWizardDraft(data, true, false), { postcode: "98" }) : { ...initialWizardDraft({ postKey: data.postKey, description: data.description, category: data.category, photoPaths: [] }, true, false), completedPhotos: true };
    await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: DRAFT_STORAGE_KEY, raw: encodeWizardDraft(local, SECURITY_USER.id) });
    return data;
  }
  async function blockDraftWrites(page: Page) {
    await page.addInitScript(() => {
      const fixture = window as typeof window & { denyDraftWrites?: boolean }; fixture.denyDraftWrites = true;
      const write = Storage.prototype.setItem; const remove = Storage.prototype.removeItem;
      Storage.prototype.setItem = function(key, value) { if (key === "trade.job-draft.v1" && fixture.denyDraftWrites) throw new DOMException("Storage full", "QuotaExceededError"); write.call(this, key, value); };
      Storage.prototype.removeItem = function(key) { if (key === "trade.job-draft.v1" && fixture.denyDraftWrites) throw new DOMException("Storage blocked", "SecurityError"); remove.call(this, key); };
    });
  }
  test("confirmed Where survives stale-readable storage, Back and refresh; a later local edit clears recovery", async ({ page }) => {
    const data = await recoverableDraft(page); await blockDraftWrites(page); await page.goto(`${app}/jobs/new?step=where`);
    const postcode = page.getByLabel("Postcode (optional)", { exact: true }); await expect(postcode).toHaveValue("98"); await postcode.fill("9810");
    await page.getByRole("button", { name: "Next", exact: true }).click(); await expect(page.getByRole("heading", { name: "All good?", exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.get("savedWhere")).toBe(data.postKey);
    await page.reload(); await expect(page.getByRole("heading", { name: "All good?", exact: true })).toBeVisible();
    await expect(page.getByText("Couldn’t save.", { exact: true })).toBeVisible(); await expect(page.getByText("Draft saved", { exact: true })).toHaveCount(0);
    await page.getByRole("link", { name: "Back", exact: true }).click(); await expect(page.getByRole("heading", { name: "Where and when?", exact: true })).toBeVisible(); await page.reload(); await expect(postcode).toHaveValue("9810");
    await page.getByRole("button", { name: "Save & exit", exact: true }).click(); await expect(postcode).toHaveValue("9810"); expect(new URL(page.url()).pathname).toBe("/jobs/new");
    await page.evaluate(() => { (window as typeof window & { denyDraftWrites?: boolean }).denyDraftWrites = false; });
    await postcode.fill("9811"); await expect.poll(() => new URL(page.url()).searchParams.has("savedWhere")).toBe(false);
    await page.reload(); await expect(postcode).toHaveValue("9811");
    expect((await db.query("SELECT data->>'postcode' AS postcode FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id])).rows[0].postcode).toBe("9810");
  });
  test("confirmed optional-postcode clear does not revive an older partial value after Review Back refresh", async ({ page }) => {
    await recoverableDraft(page); await blockDraftWrites(page); await page.goto(`${app}/jobs/new?step=where`);
    const postcode = page.getByLabel("Postcode (optional)", { exact: true }); await expect(postcode).toHaveValue("98"); await postcode.fill("");
    await page.getByRole("button", { name: "Next", exact: true }).click(); await expect(page.getByRole("heading", { name: "All good?", exact: true })).toBeVisible();
    expect((await db.query("SELECT data ? 'postcode' AS has_postcode FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id])).rows[0].has_postcode).toBe(false);
    await page.reload(); await page.getByRole("link", { name: "Back", exact: true }).click(); await expect(page.getByRole("heading", { name: "Where and when?", exact: true })).toBeVisible(); await page.reload(); await expect(postcode).toHaveValue("");
  });
  test("a later partial Photos save invalidates the older confirmed Where recovery context", async ({ page }) => {
    await recoverableDraft(page); await blockDraftWrites(page); await page.goto(`${app}/jobs/new?step=where`);
    const postcode = page.getByLabel("Postcode (optional)", { exact: true }); await postcode.fill("9810");
    await page.getByRole("button", { name: "Next", exact: true }).click(); await expect(page.getByRole("heading", { name: "All good?", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Back", exact: true }).click(); await postcode.fill("98");
    await page.getByRole("link", { name: "Back", exact: true }).click(); await expect(page.getByRole("heading", { name: "Add some photos", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Next", exact: true }).click(); await expect(page.getByRole("heading", { name: "Where and when?", exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.has("savedWhere")).toBe(false);
    await page.reload(); await expect(postcode).toHaveValue("98");
    await page.getByRole("button", { name: "Next", exact: true }).click(); await expect(postcode).toBeFocused();
    await expect(page.getByText("Couldn’t save.", { exact: true })).toBeVisible(); await expect(page.getByText("Draft saved", { exact: true })).toHaveCount(0);
  });
  test("Describe and Photos Next retain genuinely unfinished Where; server-only exit refuses its loss", async ({ page }) => {
    await recoverableDraft(page); await blockDraftWrites(page); await page.goto(`${app}/jobs/new?step=describe`);
    await page.getByRole("button", { name: "Next", exact: true }).click(); await expect(page.getByRole("heading", { name: "Add some photos", exact: true })).toBeVisible(); await page.reload();
    await page.getByRole("button", { name: "Next", exact: true }).click(); await expect(page.getByRole("heading", { name: "Where and when?", exact: true })).toBeVisible(); await page.reload();
    const postcode = page.getByLabel("Postcode (optional)", { exact: true }); await expect(postcode).toHaveValue("98");
    await page.getByRole("button", { name: "Save & exit", exact: true }).click(); await expect(postcode).toHaveValue("98"); await expect(page.getByText("Couldn’t save.", { exact: true })).toBeVisible();
    await expect(page.getByText("Draft saved", { exact: true })).toHaveCount(0); expect(new URL(page.url()).pathname).toBe("/jobs/new");
  });
  test("unvisited local Where inherits the owned server address and schedule during a full Describe save", async ({ page }) => {
    const data = await recoverableDraft(page, false); await page.goto(`${app}/jobs/new?step=describe`);
    await page.getByRole("button", { name: "Next", exact: true }).click(); await expect(page.getByRole("heading", { name: "Add some photos", exact: true })).toBeVisible();
    const saved = (await db.query("SELECT data FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id])).rows[0].data;
    expect(saved).toMatchObject({ addressLine1: data.addressLine1, postcode: "9810", anyTime: true });
    await page.getByRole("button", { name: "Next", exact: true }).click(); await expect(page.getByLabel("Postcode (optional)", { exact: true })).toHaveValue("9810");
  });
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
    await login(page, "/notifications"); await page.getByRole("button", { name: /New time requested/ }).first().click(); await expect(page).toHaveURL(`${app}/jobs/${id}/windows`);
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
    const foreign = await job(); await db.query("UPDATE jobs SET customer_id=$2 WHERE id=$1", [foreign, SECURITY_TRADIE.id]); await page.goto(`${app}/jobs/${foreign}/windows`); await expect(page.getByRole("heading", { name: "Wrong address.", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save changes", exact: true })).toHaveCount(0); await expect(page.getByText("Hang a door", { exact: true })).toHaveCount(0);
  });
  test("session expiry preserves the edited schedule while the standard sign-in dialog opens", async ({ page }) => {
    const id = await job(); await login(page, `/jobs/${id}/windows`); await page.locator('input[name="time-windows"]').first().check();
    await page.context().clearCookies(); await page.getByRole("button", { name: "Save changes", exact: true }).click(); await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.locator('input[name="time-windows"]').first()).toBeChecked(); expect((await db.query("SELECT date::text FROM job_time_windows WHERE job_id=$1", [id])).rows).toEqual([{ date: "2026-01-01" }]);
  });
});
