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
});
