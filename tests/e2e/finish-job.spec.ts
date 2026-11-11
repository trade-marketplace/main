import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import pg from "pg";
import { expect, test, type Page } from "@playwright/test";
import { expectNoA11yViolations } from "./support/a11y";
import { SECURITY_PASSWORD, SECURITY_TRADIE, SECURITY_USER } from "./support/security-auth-stub";
import { startPhotoStorageStub } from "./support/photo-storage-stub";
const preview = process.env.POSTED_PREVIEW_E2E_URL || "http://127.0.0.1:3101";
const states = ["electrical", "other-trade", "no-budget", "over-budget", "uploading", "upload-error", "field-errors", "draft-saved", "sending", "sent", "waiting-extra", "not-configured", "read-only", "error", "offline", "loading", "load-error", "recovery-gallery"];
test("finish preview keeps the production guard", async ({ page }) => { expect((await page.goto("/dev/components/finish-job?state=electrical"))?.status()).toBe(404); });
for (const width of [320, 390, 768, 1024, 1440]) test(`finish states at ${width}px`, async ({ page }) => {
  test.setTimeout(180_000); await page.setViewportSize({ width, height: 1000 });
  for (const state of states) await test.step(state, async () => {
    expect((await page.goto(`${preview}/dev/components/finish-job?state=${state}`))?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    if (state === "loading") await expect(page.getByRole("status", { name: "Loading finish job" })).toBeVisible();
    else if (state === "load-error") await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
    else if (state !== "recovery-gallery") {
      await expect(page.getByRole("heading", { name: "Finish up", exact: true })).toBeVisible();
      if (state === "no-budget") await expect(page.getByRole("region", { name: "Materials", exact: true })).toHaveCount(0);
      if (state === "other-trade") { await expect(page.getByLabel("Materials spend", { exact: true })).toBeVisible(); await expect(page.getByLabel("CoC number", { exact: true })).toHaveCount(0); }
      if (state === "electrical") await expect(page.getByText("Budget $85.00", { exact: true })).toBeVisible();
      if (state === "over-budget") { await expect(page.getByLabel("Why was it over?", { exact: true })).toBeVisible(); await expect(page.getByText("The office checks this before you’re paid.", { exact: true })).toBeVisible(); }
      if (["uploading", "upload-error", "sending", "waiting-extra", "not-configured", "offline"].includes(state)) await expect(page.getByRole("button", { name: /^Send for sign-off/ })).toHaveAttribute("aria-disabled", "true");
      if (state === "read-only") { await expect(page.getByRole("button", { name: "Send for sign-off", exact: true })).toHaveCount(0); await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(0); }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await expectNoA11yViolations(page);
    if (process.env.FINISH_SCREENSHOTS_DIR && [390, 1440].includes(width)) await page.screenshot({ path: `${process.env.FINISH_SCREENSHOTS_DIR}/${state}-${width}.png`, fullPage: true });
  });
});
test("keyboard adds a photo, edits and sends; retries failed uploads and load errors", async ({ page }) => {
  await page.goto(`${preview}/dev/components/finish-job?state=electrical`);
  const chooser = page.waitForEvent("filechooser"); await page.getByRole("button", { name: "Add", exact: true }).press("Enter"); await (await chooser).setFiles("public/images/examples/outlet.jpg");
  await expect(page.getByRole("button", { name: "Remove outlet.jpg", exact: true })).toBeVisible();
  await page.getByLabel("CoC number", { exact: true }).fill("COC-keyboard"); await page.getByLabel("Notes", { exact: true }).fill("Checked and finished.");
  const checkbox = page.getByRole("checkbox", { name: "The work matches the job and any approved extras.", exact: true }); await checkbox.uncheck(); await expect(page.getByRole("button", { name: "Send for sign-off", exact: true })).toHaveAttribute("aria-disabled", "true"); await checkbox.press("Space");
  await page.getByRole("button", { name: "Send for sign-off", exact: true }).press("Enter"); await expect(page.getByRole("heading", { name: "Sent for sign-off", exact: true })).toBeVisible(); await expectNoA11yViolations(page);
  await page.goto(`${preview}/dev/components/finish-job?state=upload-error`); await page.getByRole("button", { name: /^Retry / }).press("Enter"); await expect(page.getByRole("button", { name: /^Retry / })).toHaveCount(0);
  await page.goto(`${preview}/dev/components/finish-job?state=load-error`); await page.getByRole("button", { name: "Try again", exact: true }).press("Enter"); await expect(page.getByRole("heading", { name: "Finish up", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Sub wiring", exact: true })).toHaveAttribute("href", "/jobs/15000000-0000-4000-8000-000000000001");
});

test.describe("real finish page, private files and transactions", () => {
  const app = process.env.FINISH_E2E_APP_URL, database = process.env.FINISH_E2E_DATABASE_URL;
  test.skip(!app || !database, "Requires dedicated localhost lane_b_150 app/database and local Auth/Storage.");
  test.describe.configure({ mode: "serial", timeout: 120_000 });
  let db: pg.Client, storage: Awaited<ReturnType<typeof startPhotoStorageStub>>;
  const electrical = randomUUID(), otherJob = randomUUID(), anotherDraft = randomUUID(), noBudget = randomUUID(), office = "15000000-0000-4000-8000-000000000099", stranger = "15000000-0000-4000-8000-000000000088";
  const pdf = { name: "CoC-finish.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF") };
  test.beforeAll(async () => {
    const url = new URL(database!); if (url.hostname !== "127.0.0.1" || url.pathname !== "/lane_b_150" || url.search || url.hash || !["127.0.0.1", "localhost"].includes(new URL(app!).hostname)) throw Error("Finish fixture requires dedicated localhost lane_b_150 app/database.");
    storage = await startPhotoStorageStub(Number(process.env.FINISH_E2E_STORAGE_PORT ?? 54520)); db = new pg.Client({ connectionString: database }); await db.connect();
    for (const [id, email, role] of [[SECURITY_USER.id, SECURITY_USER.email, "CUSTOMER"], [SECURITY_TRADIE.id, SECURITY_TRADIE.email, "TRADIE"], [office, "office-finish@example.test", "ADMIN"], [stranger, "stranger-finish@example.test", "TRADIE"]]) {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2) ON CONFLICT(id) DO NOTHING", [id, email]);
      await db.query("INSERT INTO profiles(id,email,role,first_name,email_verified_at,updated_at) VALUES($1,$2,$3,'Sarah',now(),now()) ON CONFLICT(id) DO UPDATE SET role=excluded.role,first_name=excluded.first_name,email_verified_at=now()", [id, email, role]);
    }
    for (const [id, category, title] of [[electrical, "ELECTRICAL", "Real electrical finish"], [otherJob, "OTHER", "Real materials finish"], [anotherDraft, "OTHER", "Real isolated draft"], [noBudget, "OTHER", "Real no-budget finish"]]) {
      await db.query("INSERT INTO jobs(id,customer_id,category,status,title,description,address_line1,suburb,city,any_time) VALUES($1,$2,$3,'REVIEW',$4,'Finish the real test work.','150 Private Street','Windsor','Invercargill',true)", [id, SECURITY_USER.id, category, title]);
      await promisify(execFile)(process.execPath, ["--conditions=react-server", "--import", "tsx", "--input-type=module", "-e", `import { createDatabaseClient } from './src/server/database-client.ts'; import { priceJob } from './src/server/pricing/price-job.ts'; const db = createDatabaseClient(process.env.FINISH_E2E_DATABASE_URL); try { await priceJob(db, { jobId: '${id}', minutes: 120, materialsCents: 8500, pricedById: '${office}' }); } finally { await db.$disconnect(); }`]);
      await db.query("UPDATE jobs SET status='ASSIGNED',worker_id=$2 WHERE id=$1", [id, SECURITY_TRADIE.id]);
      // Budgeted journeys explicitly seed the existing row. The no-row lifecycle is separately tested.
      if (id !== noBudget) await db.query("INSERT INTO job_materials(job_id,budget_cents) VALUES($1,8500)", [id]);
    }
    await db.query("UPDATE settings SET auto_release_hours=72 WHERE id=1");
  });
  test.afterAll(async () => { await db?.query("UPDATE settings SET auto_release_hours=48 WHERE id=1"); await storage?.close(); await db?.end(); });
  async function login(page: Page, id: string) {
    await page.goto(`${app}/login?next=${encodeURIComponent(`/jobs/${id}/complete`)}`); await page.getByLabel("Email", { exact: true }).fill(SECURITY_TRADIE.email); await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD); await page.getByRole("button", { name: "Log in", exact: true }).click(); await expect(page.getByRole("heading", { name: "Finish up", exact: true })).toBeVisible();
  }
  async function photo(page: Page) { const chooser = page.waitForEvent("filechooser"); await page.getByRole("button", { name: "Add", exact: true }).press("Enter"); await (await chooser).setFiles("public/images/examples/outlet.jpg"); await expect(page.getByRole("button", { name: "Save for later", exact: true })).not.toHaveAttribute("aria-disabled", "true"); }
  async function document(page: Page, label: string) { const chooser = page.waitForEvent("filechooser"); await page.getByRole("region", { name: label, exact: true }).getByRole("button", { name: "choose files", exact: true }).press("Enter"); await (await chooser).setFiles(pdf); await expect(page.getByRole("region", { name: label, exact: true }).getByRole("link", { name: pdf.name })).toBeVisible(); }
  test("actual photo and CoC uploads survive Save/reload; keyboard Send moves the job and returns through its breadcrumb", async ({ page, context }) => {
    await login(page, electrical); await expect(page.getByText("Sarah gets 72 hours to check. Then you’re paid next payroll.", { exact: true })).toBeVisible();
    // Simulate a lost response after a real committed upload. Removing the failed tile
    // must still remove its server row, rather than resurrect it on reload.
    await page.evaluate(id => {
      const nativeFetch = window.fetch.bind(window); (window as Window & { finishNativeFetch?: typeof fetch }).finishNativeFetch = nativeFetch; let lost = false;
      window.fetch = async (input, init) => { const response = await nativeFetch(input, init); if (!lost && String(input).includes(`/api/jobs/${id}/evidence`) && init?.method === "POST") { lost = true; throw new TypeError("Fixture lost response after commit"); } return response; };
    }, electrical);
    const lostChooser = page.waitForEvent("filechooser"); await page.getByRole("button", { name: "Add", exact: true }).press("Enter"); await (await lostChooser).setFiles("public/images/examples/outlet.jpg"); await expect(page.getByRole("button", { name: "Retry outlet.jpg", exact: true })).toBeVisible();
    expect((await db.query("SELECT count(*)::int AS n FROM completion_evidence_photos WHERE job_id=$1", [electrical])).rows[0].n).toBe(1);
    await page.getByRole("button", { name: "Remove outlet.jpg", exact: true }).press("Enter"); await expect(page.getByRole("button", { name: "Remove outlet.jpg", exact: true })).toHaveCount(0); expect((await db.query("SELECT count(*)::int AS n FROM completion_evidence_photos WHERE job_id=$1", [electrical])).rows[0].n).toBe(0); await page.evaluate(() => { const saved = (window as Window & { finishNativeFetch?: typeof fetch }).finishNativeFetch; if (saved) window.fetch = saved; });
    await photo(page); await document(page, "CoC document"); await page.getByLabel("CoC number", { exact: true }).fill("COC-150-real"); await page.getByLabel("Notes", { exact: true }).fill("Finished and checked the circuit."); await page.getByLabel("Telfer spend", { exact: true }).fill("72.50");
    await page.getByRole("checkbox", { name: "The work matches the job and any approved extras.", exact: true }).check();
    await context.setOffline(true); await expect(page.getByRole("button", { name: "Save for later", exact: true })).toHaveAttribute("aria-disabled", "true"); await context.setOffline(false);
    await page.getByRole("button", { name: "Save for later", exact: true }).press("Enter"); await expect(page.getByRole("status").filter({ hasText: "Saved for later." })).toBeVisible(); await page.reload();
    await expect(page.getByLabel("CoC number", { exact: true })).toHaveValue("COC-150-real"); await expect(page.getByLabel("Telfer spend", { exact: true })).toHaveValue("72.5"); await expect(page.getByRole("button", { name: "Remove Photo 1", exact: true })).toBeVisible();
    const files = (await db.query("SELECT coc_path FROM completion_evidence WHERE job_id=$1", [electrical])).rows[0]; expect(files.coc_path).toMatch(new RegExp(`^coc/${SECURITY_TRADIE.id}/[a-f0-9]+\\.pdf$`)); expect(storage.objects.has(`documents/${files.coc_path}`)).toBe(true);
    await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Real electrical finish", exact: true }).press("Enter"); await expect(page).toHaveURL(`${app}/jobs/${electrical}`); await page.goBack(); await expect(page.getByRole("heading", { name: "Finish up", exact: true })).toBeVisible();
    await expectNoA11yViolations(page); await page.getByRole("button", { name: "Send for sign-off", exact: true }).press("Enter"); await expect(page.getByRole("heading", { name: "Sent for sign-off", exact: true })).toBeVisible(); await expect(page).toHaveURL(`${app}/jobs/${electrical}`);
    expect((await db.query("SELECT status FROM jobs WHERE id=$1", [electrical])).rows[0].status).toBe("SUBMITTED");
    expect((await db.query("SELECT count(*)::int AS n FROM notifications WHERE type='job.submitted' AND user_id=$2 AND payload->>'jobId'=$1", [electrical, SECURITY_USER.id])).rows[0].n).toBe(1);
    await page.goto(`${app}/jobs/${electrical}/complete`); await expect(page.getByRole("button", { name: "Send for sign-off", exact: true })).toHaveCount(0); await expect(page.getByText("Sent for sign-off", { exact: true })).toBeVisible();
    const foreign = await context.newPage(); await db.query("UPDATE jobs SET worker_id=$2 WHERE id=$1", [electrical, stranger]); await foreign.goto(`${app}/jobs/${electrical}/complete`); await expect(foreign.getByRole("heading", { name: "Wrong address.", exact: true })).toBeVisible(); expect(await foreign.locator("body").innerText()).not.toContain("COC-150-real"); await foreign.close();
  });
  test("over-budget reason survives the same browser draft, storage failure is honest, and Send tells office and clears it", async ({ page }) => {
    await login(page, otherJob); await photo(page); await page.getByLabel("Notes", { exact: true }).fill("Finished the materials work."); await page.getByLabel("Materials spend", { exact: true }).fill("95"); await document(page, "Receipt"); await page.getByLabel("Why was it over?", { exact: true }).fill("The damaged cable needed replacing."); await page.getByRole("checkbox", { name: "The work matches the job and any approved extras.", exact: true }).check();
    await page.evaluate(() => { const original = Storage.prototype.setItem; Object.defineProperty(window, "finishSetItem", { value: original, configurable: true }); Storage.prototype.setItem = () => { throw Error("Fixture storage unavailable"); }; });
    await page.getByRole("button", { name: "Save for later", exact: true }).press("Enter"); await expect(page.getByText("Your over-budget reason couldn’t be saved on this browser. Keep this page open and try Save for later again.", { exact: true })).toBeVisible(); expect((await db.query("SELECT spent_cents FROM job_materials WHERE job_id=$1", [otherJob])).rows[0].spent_cents).toBeNull(); await expect(page.getByLabel("Why was it over?", { exact: true })).toHaveValue("The damaged cable needed replacing.");
    await page.evaluate(() => { Storage.prototype.setItem = (window as unknown as { finishSetItem: Storage["setItem"] }).finishSetItem; }); await page.getByRole("button", { name: "Save for later", exact: true }).press("Enter"); await expect(page.getByRole("status").filter({ hasText: "Saved for later." })).toBeVisible(); await page.reload(); await expect(page.getByLabel("Why was it over?", { exact: true })).toHaveValue("The damaged cable needed replacing.");
    expect((await db.query("SELECT count(*)::int AS n FROM audit_log WHERE record_id=$1 AND action='job.materials_reported'", [otherJob])).rows[0].n).toBe(0);
    // Unmount the old form, then ensure another job's live edits ignore its storage events.
    await page.goto(`${app}/jobs/${anotherDraft}/complete`); await page.getByLabel("Materials spend", { exact: true }).fill("95"); await expect(page.getByLabel("Why was it over?", { exact: true })).toHaveValue(""); await page.getByLabel("Why was it over?", { exact: true }).fill("Unsaved other-job reason");
    await page.evaluate(key => window.dispatchEvent(new StorageEvent("storage", { key, newValue: localStorage.getItem(key) })), `trade.finish-reason.v1:${SECURITY_TRADIE.id}:${otherJob}`); await expect(page.getByLabel("Why was it over?", { exact: true })).toHaveValue("Unsaved other-job reason");
    await page.goto(`${app}/jobs/${otherJob}/complete`); await expect(page.getByLabel("Why was it over?", { exact: true })).toHaveValue("The damaged cable needed replacing.");
    await page.getByRole("button", { name: "Send for sign-off", exact: true }).press("Enter"); await expect(page).toHaveURL(`${app}/jobs/${otherJob}`);
    expect((await db.query("SELECT reason FROM audit_log WHERE record_id=$1 AND action='job.materials_reported'", [otherJob])).rows[0].reason).toBe("The damaged cable needed replacing.");
    expect((await db.query("SELECT count(*)::int AS n FROM notifications WHERE type='job.materials_over_budget' AND payload->>'jobId'=$1", [otherJob])).rows[0].n).toBe((await db.query("SELECT count(*)::int AS n FROM profiles WHERE role='ADMIN'")).rows[0].n);
    expect(await page.evaluate(key => localStorage.getItem(key), `trade.finish-reason.v1:${SECURITY_TRADIE.id}:${otherJob}`)).toBeNull();
  });
  test("a real missing-budget row hides the block and sends with zero spend", async ({ page }) => {
    await login(page, noBudget); await expect(page.getByRole("region", { name: "Materials", exact: true })).toHaveCount(0); await photo(page); await page.getByLabel("Notes", { exact: true }).fill("Finished without materials."); await page.getByRole("checkbox", { name: "The work matches the job and any approved extras.", exact: true }).check(); await page.getByRole("button", { name: "Send for sign-off", exact: true }).press("Enter"); await expect(page).toHaveURL(`${app}/jobs/${noBudget}`);
    expect((await db.query("SELECT budget_cents,spent_cents FROM job_materials WHERE job_id=$1", [noBudget])).rows[0]).toEqual({ budget_cents: 0, spent_cents: 0 });
    await page.context().clearCookies(); await page.goto(`${app}/login?next=${encodeURIComponent(`/jobs/${otherJob}/complete`)}`); await page.getByLabel("Email", { exact: true }).fill(SECURITY_USER.email); await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD); await page.getByRole("button", { name: "Log in", exact: true }).click(); await expect(page).toHaveURL(`${app}/`); await expect(page.getByRole("heading", { name: "Kia ora Sarah. What needs doing?", exact: true })).toBeVisible(); expect(await page.locator("body").innerText()).not.toContain("The damaged cable needed replacing.");
  });
});
