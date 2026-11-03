import { expect, test } from "@playwright/test";
import pg from "pg";
import { expectNoA11yViolations } from "./support/a11y";
import { SECURITY_PASSWORD, SECURITY_TRADIE, SECURITY_USER, startSecurityAuthStub } from "./support/security-auth-stub";

const app = process.env.POST_JOB_E2E_APP_URL;
const database = process.env.POST_JOB_E2E_DATABASE_URL;
test.describe("customer Describe draft through the real server action", () => {
  test.skip(!app || !database, "requires the task-owned local app, Auth double and disposable database");
  test.describe.configure({ mode: "serial" });
  let auth: Awaited<ReturnType<typeof startSecurityAuthStub>>; let db: pg.Client;
  test.beforeAll(async () => {
    if (!["localhost", "127.0.0.1"].includes(new URL(app!).hostname) || new URL(database!).pathname !== "/issue117") throw new Error("Task-owned localhost app/database required");
    auth = await startSecurityAuthStub(54317);
    db = new pg.Client({ connectionString: database }); await db.connect();
    for (const [user, role] of [[SECURITY_USER, "CUSTOMER"], [SECURITY_TRADIE, "TRADIE"]] as const) {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2) ON CONFLICT(id) DO NOTHING", [user.id, user.email]);
      await db.query("INSERT INTO profiles(id,email,role,first_name,email_verified_at,updated_at) VALUES($1,$2,$3,'Wizard Demo',now(),now()) ON CONFLICT(id) DO NOTHING", [user.id, user.email, role]);
    }
    await db.query("DELETE FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id]);
  });
  test.afterAll(async () => { await auth?.close(); await db?.end(); });
  test("login → Describe → save action → Photos → server-only restore → guest isolation", async ({ page }) => {
    await page.goto(`${app}/login?next=%2Fjobs%2Fnew`);
    await page.getByLabel("Email", { exact: true }).fill(SECURITY_USER.email);
    await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(`${app}/jobs/new`);
    await page.goto(`${app}/jobs/new?step=photos`);
    await page.getByRole("textbox", { name: "Describe the job", exact: true }).fill("A leaking tap in the downstairs bathroom.");
    await expect(page.getByRole("heading", { name: "What needs doing?", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Photos", exact: true })).toHaveCount(0);
    await page.context().clearCookies();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Log in again", exact: true }).click();
    await dialog.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD);
    await dialog.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Photos", exact: true })).toBeVisible();
    const row = (await db.query("SELECT data FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id])).rows[0];
    expect(row.data).toMatchObject({ description: "A leaking tap in the downstairs bathroom.", category: "PLUMBING" });
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${app}/jobs/new?step=photos`);
    await expect(page.getByRole("heading", { name: "Photos", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Back", exact: true }).click();
    await expect(page.getByText("Draft restored", { exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Describe the job", exact: true })).toHaveValue(row.data.description);
    await expectNoA11yViolations(page);
    await page.getByRole("textbox", { name: "Describe the job", exact: true }).fill("A private unfinished change");
    await page.evaluate(() => { Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false }); window.dispatchEvent(new Event("offline")); });
    await page.getByRole("button", { name: "Save & exit", exact: true }).click();
    await expect(page).toHaveURL(`${app}/`);
    await page.goto(`${app}/jobs/new`);
    await expect(page.getByRole("textbox", { name: "Describe the job", exact: true })).toHaveValue("A private unfinished change");
    await page.context().clearCookies();
    await page.reload();
    await expect(page.getByRole("textbox", { name: "Describe the job", exact: true })).toHaveValue("");
    await expect(page.getByText("Draft restored", { exact: true })).toHaveCount(0);
    expect((await db.query("SELECT data FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id])).rows[0].data.description).toBe(row.data.description);
  });
  test("blocked browser storage still permits a durable customer save, while unfinished unsaved text prevents exit", async ({ page }) => {
    await db.query("DELETE FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id]);
    await page.addInitScript(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) { if (key === "trade.job-draft.v1") throw new DOMException("Storage blocked", "QuotaExceededError"); original.call(this, key, value); };
    });
    await page.goto(`${app}/login?next=%2Fjobs%2Fnew`); await page.getByLabel("Email", { exact: true }).fill(SECURITY_USER.email); await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD); await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(`${app}/jobs/new`);
    await page.getByRole("textbox", { name: "Describe the job", exact: true }).fill("A leaking tap downstairs needs repair.");
    await expect(page.getByText("Draft saved", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Next", exact: true }).click(); await expect(page.getByRole("heading", { name: "Photos", exact: true })).toBeVisible();
    expect((await db.query("SELECT data FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id])).rows[0].data.description).toBe("A leaking tap downstairs needs repair.");
    await page.getByRole("link", { name: "Back", exact: true }).click(); await page.getByRole("textbox", { name: "Describe the job", exact: true }).fill("Li");
    await page.getByRole("button", { name: "Save & exit", exact: true }).click(); await expect(page.getByRole("textbox", { name: "Describe the job", exact: true })).toHaveValue("Li");
    await expect(page.getByText("Couldn’t save.", { exact: true })).toBeVisible(); await expect(page.getByText("Draft saved", { exact: true })).toHaveCount(0);
    await page.getByRole("textbox", { name: "Describe the job", exact: true }).fill("   ");
    await page.getByRole("button", { name: "Save & exit", exact: true }).click(); await expect(page.getByRole("textbox", { name: "Describe the job", exact: true })).toHaveValue("   ");
    await expect(page.getByText("Couldn’t save.", { exact: true })).toBeVisible(); await expect(page.getByText("Draft saved", { exact: true })).toHaveCount(0);
    expect((await db.query("SELECT data FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id])).rows[0].data.description).toBe("A leaking tap downstairs needs repair.");
    await page.getByRole("textbox", { name: "Describe the job", exact: true }).fill("Check the upstairs lights and wiring.");
    await page.getByRole("button", { name: "Save & exit", exact: true }).click(); await expect(page).toHaveURL(`${app}/`);
    await page.goto(`${app}/jobs/new`); await expect(page.getByRole("textbox", { name: "Describe the job", exact: true })).toHaveValue("Check the upstairs lights and wiring.");
  });
  test("incomplete server data stays on Describe; complete owned data can resume after Save & exit", async ({ page }) => {
    const data = { postKey: crypto.randomUUID(), description: "Check the lights and wiring upstairs." };
    await db.query("INSERT INTO job_drafts(profile_id,data,updated_at) VALUES($1,$2,now()) ON CONFLICT(profile_id) DO UPDATE SET data=EXCLUDED.data", [SECURITY_USER.id, data]);
    await page.goto(`${app}/login?next=%2Fjobs%2Fnew%3Fstep%3Dphotos`); await page.getByLabel("Email", { exact: true }).fill(SECURITY_USER.email); await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD); await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "What needs doing?", exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Describe the job", exact: true })).toHaveValue(data.description);
    await expect(page.getByRole("heading", { name: "Photos", exact: true })).toHaveCount(0);
    // Save & exit validates and saves the fields; Next is navigation, not an authorization boundary.
    await page.getByRole("button", { name: "Save & exit", exact: true }).click(); await expect(page).toHaveURL(`${app}/`);
    await page.evaluate(() => localStorage.clear()); await page.goto(`${app}/jobs/new?step=photos`);
    await expect(page.getByRole("heading", { name: "Photos", exact: true })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Your job" })).toContainText(data.description);
  });
  test("an explicit handoff updates a signed-in server draft once, retaining its key and later fields", async ({ page }) => {
    const key = crypto.randomUUID(); const data = { postKey: key, description: "Fix the fence beside the garage.", category: "CONSTRUCTION", photoPaths: [`drafts/${SECURITY_USER.id}/${key}/${"a".repeat(32)}.webp`], addressLine1: "1 Example Street", suburb: "Gladstone", city: "Invercargill" };
    await db.query("INSERT INTO job_drafts(profile_id,data,updated_at) VALUES($1,$2,now()) ON CONFLICT(profile_id) DO UPDATE SET data=EXCLUDED.data", [SECURITY_USER.id, data]);
    const next = "/jobs/new?description=Move+a+sofa+upstairs&type=other&step=photos";
    await page.goto(`${app}/login?next=${encodeURIComponent(next)}`); await page.getByLabel("Email", { exact: true }).fill(SECURITY_USER.email); await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD); await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(`${app}/jobs/new`); await expect(page.getByRole("heading", { name: "What needs doing?", exact: true })).toBeVisible();
    await expect(page.getByRole("form", { name: "Describe the job", exact: true }).getByRole("textbox")).toHaveValue("Move a sofa upstairs"); await expect(page.getByRole("radio", { name: "Other (anything)", exact: true })).toBeChecked();
    await page.getByRole("button", { name: "Next", exact: true }).click(); await expect(page.getByRole("heading", { name: "Photos", exact: true })).toBeVisible();
    expect((await db.query("SELECT data FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id])).rows[0].data).toMatchObject({ ...data, description: "Move a sofa upstairs", category: "OTHER" });
    await page.getByRole("link", { name: "Back", exact: true }).click(); await page.getByRole("form", { name: "Describe the job", exact: true }).getByRole("textbox").fill("Assemble the new garden bench."); await page.reload();
    await expect(page.getByRole("form", { name: "Describe the job", exact: true }).getByRole("textbox")).toHaveValue("Assemble the new garden bench.");
  });
  test("an unpersisted location hint retains its URL fallback and prevents unsafe server-only exit", async ({ page }) => {
    test.setTimeout(90_000); const key = crypto.randomUUID(); const data = { postKey: key, description: "Check the lights and wiring upstairs.", category: "ELECTRICAL", photoPaths: [] };
    await db.query("INSERT INTO job_drafts(profile_id,data,updated_at) VALUES($1,$2,now()) ON CONFLICT(profile_id) DO UPDATE SET data=EXCLUDED.data", [SECURITY_USER.id, data]);
    await page.addInitScript(() => {
      Object.defineProperty(window, "sessionStorage", { configurable: true, get() { throw new Error("Storage blocked"); } });
      const original = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key === "trade.job-draft.v1" && !Reflect.get(window, "allowDraftStorage")) throw new DOMException("Storage full", "QuotaExceededError"); original.call(this, key, value); };
    });
    const next = "/jobs/new?location=Bluff&lat=-46.599&lng=168.345";
    await page.goto(`${app}/login?next=${encodeURIComponent(next)}`); await page.getByLabel("Email", { exact: true }).fill(SECURITY_USER.email); await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD); await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Describe the job", exact: true })).toHaveValue(data.description); await expect(page.getByText("Couldn’t save.", { exact: true })).toBeVisible();
    const response = page.waitForResponse(response => response.request().method() === "POST" && response.url().includes("/jobs/new"));
    await page.getByRole("button", { name: "Save & exit", exact: true }).click(); await response;
    await expect(page.getByRole("button", { name: "Save & exit", exact: true })).not.toHaveAttribute("aria-busy", "true");
    expect(new URL(page.url()).pathname).toBe("/jobs/new"); expect(new URL(page.url()).searchParams.get("location")).toBe("Bluff"); await expect(page.getByText("Draft saved", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Next", exact: true }).click(); await expect(page.getByRole("heading", { name: "Photos", exact: true })).toBeVisible();
    await page.reload(); await expect(page.getByRole("heading", { name: "Photos", exact: true })).toBeVisible();
    const url = new URL(page.url()); expect(url.searchParams.get("step")).toBe("photos"); expect(url.searchParams.get("lat")).toBe("-46.599"); expect(url.searchParams.get("lng")).toBe("168.345");
    await page.getByRole("link", { name: "Back", exact: true }).click(); await expect(page.getByRole("textbox", { name: "Describe the job", exact: true })).toHaveValue(data.description);
    await page.evaluate(() => Reflect.set(window, "allowDraftStorage", true)); await page.getByRole("button", { name: "Save & exit", exact: true }).click(); await expect(page).toHaveURL(`${app}/`);
    await page.goto(`${app}/jobs/new`); const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("trade.job-draft.v1")!));
    expect(saved.locationHint).toEqual({ label: "Bluff", point: { lat: -46.599, lng: 168.345 } }); expect(saved.data.postKey).toBe(key);
    expect((await db.query("SELECT data FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id])).rows[0].data).toEqual(data);
  });
  test("a readable old envelope cannot restore stale input after a server-only save", async ({ page }) => {
    test.setTimeout(90_000); const key = crypto.randomUUID(); const data = { postKey: key, description: "Check the lights and wiring upstairs.", category: "ELECTRICAL", photoPaths: [] };
    await db.query("INSERT INTO job_drafts(profile_id,data,updated_at) VALUES($1,$2,now()) ON CONFLICT(profile_id) DO UPDATE SET data=EXCLUDED.data", [SECURITY_USER.id, data]);
    await page.addInitScript(({ owner, data }) => {
      const original = Storage.prototype.setItem; if (!localStorage.getItem("trade.job-draft.v1")) original.call(localStorage, "trade.job-draft.v1", JSON.stringify({ version: 1, ownerId: owner, data, description: data.description, manualCategory: false, completedDescribe: false }));
      Storage.prototype.setItem = function(key, value) { if (key === "trade.job-draft.v1" && !Reflect.get(window, "allowDraftStorage")) throw new DOMException("Storage full", "QuotaExceededError"); original.call(this, key, value); };
    }, { owner: SECURITY_USER.id, data });
    await page.goto(`${app}/login?next=%2Fjobs%2Fnew`); await page.getByLabel("Email", { exact: true }).fill(SECURITY_USER.email); await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD); await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(`${app}/jobs/new`); const field = page.getByRole("textbox", { name: "Describe the job", exact: true });
    await field.fill("Check the outside lights and wiring.");
    await page.getByRole("button", { name: "Save & exit", exact: true }).click();
    await expect.poll(async () => (await db.query("SELECT data->>'description' AS description FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id])).rows[0].description).toBe("Check the outside lights and wiring.");
    await expect(field).toHaveValue("Check the outside lights and wiring."); await expect(page.getByText("Couldn’t save.", { exact: true })).toBeVisible();
    await field.fill(data.description); await page.getByRole("radio", { name: "Plumbing", exact: true }).check(); await page.getByRole("radio", { name: "Electrical", exact: true }).check();
    const response = page.waitForResponse(response => response.request().method() === "POST" && response.url().includes("/jobs/new")); await page.getByRole("button", { name: "Save & exit", exact: true }).click(); await response;
    await expect(page.getByRole("button", { name: "Save & exit", exact: true })).not.toHaveAttribute("aria-busy", "true"); await expect(field).toBeVisible(); await expect(page.getByText("Draft saved", { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("trade.job-draft.v1")!).manualCategory)).toBe(false);
    await page.evaluate(() => Reflect.set(window, "allowDraftStorage", true)); await page.getByRole("button", { name: "Save & exit", exact: true }).click(); await expect(page).toHaveURL(`${app}/`);
    await page.goto(`${app}/jobs/new`); await expect(page.getByText(/We guessed Electrical/)).toHaveCount(0); await expect(field).toHaveValue(data.description);
  });
});
