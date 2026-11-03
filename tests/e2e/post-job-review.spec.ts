import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import sharp from "sharp";
import { DRAFT_STORAGE_KEY } from "../../src/lib/job-draft";
import { encodeWizardDraft, initialWizardDraft } from "../../src/lib/post-job-wizard";
import { startPhotoStorageStub } from "./support/photo-storage-stub";
import { SECURITY_PASSWORD, SECURITY_USER, SECURITY_TRADIE } from "./support/security-auth-stub";
import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const app = process.env.POST_REVIEW_E2E_APP_URL; const database = process.env.POST_REVIEW_E2E_DATABASE_URL;
test.describe("review and verified posting through real services", () => {
  test.skip(!app || !database, "requires the task-owned app, Auth/Storage double and disposable database");
  test.describe.configure({ mode: "serial" }); test.use({ reducedMotion: "reduce" });
  let storage: Awaited<ReturnType<typeof startPhotoStorageStub>>; let db: pg.Client;
  test.beforeAll(async () => {
    if (!["localhost", "127.0.0.1"].includes(new URL(app!).hostname) || new URL(database!).hostname !== "127.0.0.1" || new URL(database!).pathname !== "/issue120") throw new Error("Task-owned localhost app and database required");
    storage = await startPhotoStorageStub(54320, { signup: { databaseUrl: database! } }); db = new pg.Client({ connectionString: database }); await db.connect();
    for (const user of [SECURITY_USER, SECURITY_TRADIE]) {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2) ON CONFLICT(id) DO NOTHING", [user.id, user.email]);
      await db.query("INSERT INTO profiles(id,email,role,first_name,email_verified_at,updated_at) VALUES($1,$2,'CUSTOMER','Review Demo',now(),now()) ON CONFLICT(id) DO UPDATE SET role='CUSTOMER',email_verified_at=now()", [user.id, user.email]);
    }
  });
  test.afterAll(async () => { await storage?.close(); await db?.end(); });
  async function login(page: Page, email: string, next: string) {
    await page.goto(`${app}/login?next=${encodeURIComponent(next)}`); await page.getByLabel("Email", { exact: true }).fill(email); await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD); await page.getByRole("button", { name: "Log in", exact: true }).click();
  }
  async function guest(page: Page, photo = false, count = 1) {
    const data = { postKey: randomUUID(), description: "Repair the leaking tap downstairs.", category: "PLUMBING" as const, photoPaths: [], addressLine1: "1 Example Street", suburb: "Gladstone", city: "Invercargill", postcode: "9810", locationSource: "TYPED" as const, anyTime: true, asap: false, timeWindows: [] };
    await page.goto(`${app}/`); await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: DRAFT_STORAGE_KEY, raw: encodeWizardDraft(initialWizardDraft(data, true), null) });
    await page.goto(`${app}/jobs/new?step=${photo ? "photos" : "review"}`);
    if (photo) {
      const files = await Promise.all(Array.from({ length: count }, async (_, index) => ({ name: `guest-tap-${index + 1}.jpg`, mimeType: "image/jpeg", buffer: await sharp({ create: { width: 80, height: 60, channels: 3, background: index ? "red" : "blue" } }).jpeg().toBuffer() })));
      await page.locator('input[type="file"]').last().setInputFiles(files);
      await expect(page.getByRole("button", { name: "Next", exact: true })).not.toHaveAttribute("aria-disabled", "true");
      await page.getByRole("button", { name: "Next", exact: true }).click(); await expect(page.getByRole("heading", { name: "Where and when?", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Next", exact: true }).click();
    }
    await expect(page.getByRole("heading", { name: "All good?", exact: true })).toBeVisible(); return data;
  }
  async function register(page: Page, email: string) {
    const dialog = page.getByRole("dialog", { name: "Create account", exact: true });
    await dialog.getByLabel("Full name", { exact: true }).fill("Posting Demo"); await dialog.getByLabel("Email", { exact: true }).fill(email); await dialog.getByLabel("Mobile", { exact: true }).fill("021 555 0192");
    await dialog.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD); await dialog.getByRole("checkbox").check(); await dialog.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(page).toHaveURL(/\/verify\?/); const next = new URL(page.url()).searchParams.get("next")!;
    await page.goto(storage.auth.confirmationUrl(email, app!, next));
    await expect(page.getByRole("heading", { name: "You’re all set", exact: true })).toBeVisible();
    await login(page, email, next); return next;
  }
  test("guest photo → signup → real verification/signout → fresh login → owned upload → same draft posted", async ({ page }) => {
    test.setTimeout(90_000); const data = await guest(page, true);
    await page.getByRole("button", { name: "Post it", exact: true }).press("Enter");
    await expect(page.getByRole("dialog", { name: "Create account", exact: true })).toBeVisible(); await expectNoA11yViolations(page);
    const email = `posted-${randomUUID()}@example.test`; await register(page, email);
    await expect(page.getByRole("heading", { name: "Posted.", exact: true })).toBeVisible({ timeout: 30_000 });
    const user = storage.auth.registeredUser(email)!;
    const posted = (await db.query("SELECT id,customer_id,post_key,description FROM jobs WHERE post_key=$1", [data.postKey])).rows;
    expect(posted).toHaveLength(1); expect(posted[0]).toMatchObject({ customer_id: user.id, description: data.description });
    const photos = (await db.query("SELECT path FROM job_photos WHERE job_id=$1 ORDER BY position", [posted[0].id])).rows;
    expect(photos).toHaveLength(1); expect(photos[0].path).toContain(`drafts/${user.id}/${data.postKey}/`);
    expect((await db.query("SELECT email_verified_at FROM profiles WHERE id=$1", [user.id])).rows[0].email_verified_at).not.toBeNull();
    await page.reload(); await expect(page.getByRole("heading", { name: "Posted.", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Home", exact: true }).click(); await expect(page).toHaveURL(`${app}/`);
  });
  for (const held of [0, 1]) test(`partial refresh resumes reviewed order when selected photo ${held + 1} is still uploading`, async ({ page }) => {
    test.setTimeout(90_000); const data = await guest(page, true, 2); await page.getByRole("button", { name: "Post it", exact: true }).click();
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/storage/v1/object/upload/sign/**", async route => {
      if (route.request().method() === "PUT") {
        const stats = await sharp(route.request().postDataBuffer()!).stats(); const blue = stats.channels[2].mean > stats.channels[0].mean;
        if (blue === (held === 0)) await gate;
      }
      await route.continue().catch(() => {});
    });
    try {
      await register(page, `partial-${randomUUID()}@example.test`);
      await expect.poll(async () => (await db.query("SELECT jsonb_array_length(data->'photoPaths') AS count FROM job_drafts WHERE data->>'postKey'=$1", [data.postKey])).rows[0]?.count).toBe(1);
      await page.reload(); await expect(page.getByRole("heading", { name: "All good?", exact: true })).toBeVisible();
      release();
      await expect(page.getByRole("heading", { name: "Posted.", exact: true })).toBeVisible({ timeout: 30_000 });
      const photos = (await db.query("SELECT p.path FROM job_photos p JOIN jobs j ON j.id=p.job_id WHERE j.post_key=$1 ORDER BY p.position", [data.postKey])).rows;
      expect(photos).toHaveLength(2);
      const first = await sharp(storage.objects.get(`photos/${photos[0].path}`)!).stats(); expect(first.channels[2].mean).toBeGreaterThan(first.channels[0].mean);
    } finally { release?.(); await page.unroute("**/storage/v1/object/upload/sign/**"); }
  });
  test("blocked posted cleanup cannot reuse the consumed key as a new job", async ({ page }) => {
    const data = await guest(page);
    await db.query("INSERT INTO job_drafts(profile_id,data,manual_category,updated_at) VALUES($1,$2,true,now()) ON CONFLICT(profile_id) DO UPDATE SET data=EXCLUDED.data,manual_category=true", [SECURITY_USER.id, data]);
    await login(page, SECURITY_USER.email, "/jobs/new?step=review"); await expect(page.getByRole("heading", { name: "All good?", exact: true })).toBeVisible();
    await page.evaluate(() => { const remove = Storage.prototype.removeItem; Storage.prototype.removeItem = function(key) { if (key === "trade.job-draft.v1") throw new DOMException("Blocked", "SecurityError"); remove.call(this, key); }; });
    await page.getByRole("button", { name: "Post it", exact: true }).click(); await expect(page.getByRole("heading", { name: "Posted.", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Home", exact: true }).click(); await page.goto(`${app}/jobs/new`);
    await expect(page.getByRole("textbox", { name: "Describe the job", exact: true })).toHaveValue("");
    await page.getByRole("textbox", { name: "Describe the job", exact: true }).fill("Check the upstairs lights and wiring."); await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Add some photos", exact: true })).toBeVisible();
    expect((await db.query("SELECT data->>'postKey' AS key FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id])).rows[0].key).not.toBe(data.postKey);
    expect((await db.query("SELECT count(*)::int AS count FROM jobs WHERE post_key=$1", [data.postKey])).rows[0].count).toBe(1);
  });
  test("rail edits during a slow verified upload require a new Post-it gesture", async ({ page }) => {
    test.setTimeout(90_000); const data = await guest(page, true); await page.getByRole("button", { name: "Post it", exact: true }).click();
    let release!: () => void; storage.holdUploads(new Promise<void>(resolve => { release = resolve; }));
    try {
      const email = `edited-${randomUUID()}@example.test`; await register(page, email);
      await expect(page.getByRole("heading", { name: "All good?", exact: true })).toBeVisible(); await expect(page.getByText("Uploading…", { exact: true })).toBeVisible();
      await page.getByRole("navigation", { name: "Post a job", exact: true }).getByRole("link", { name: /^What needs doing/ }).click();
      await page.getByRole("textbox", { name: "Describe the job", exact: true }).fill("Repair the different leaking tap upstairs."); await page.getByRole("button", { name: "Next", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Add some photos", exact: true })).toBeVisible();
      release(); storage.holdUploads();
      await expect(page.getByRole("button", { name: "Next", exact: true })).not.toHaveAttribute("aria-disabled", "true", { timeout: 30_000 });
      await page.getByRole("button", { name: "Next", exact: true }).click(); await expect(page.getByRole("heading", { name: "Where and when?", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Next", exact: true }).click(); await expect(page.getByRole("heading", { name: "All good?", exact: true })).toBeVisible();
      await expect(page.getByText("Couldn’t post.", { exact: true })).toBeVisible(); expect((await db.query("SELECT count(*)::int AS count FROM jobs WHERE post_key=$1", [data.postKey])).rows[0].count).toBe(0);
      await page.getByRole("button", { name: "Post it", exact: true }).click(); await expect(page.getByRole("heading", { name: "Posted.", exact: true })).toBeVisible();
    } finally { release?.(); storage.holdUploads(); }
  });
  test("Edit keeps every section and keyboard dialog dismissal returns focus; URL alone never posts", async ({ page }) => {
    const data = await guest(page); await page.getByRole("region", { name: "Where and when", exact: true }).getByRole("link", { name: "Edit", exact: true }).press("Enter");
    await expect(page.getByRole("combobox", { name: "Address", exact: true })).toHaveValue(data.addressLine1); await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByRole("button", { name: "Post it", exact: true }).press("Enter"); await page.getByRole("dialog").press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0); await expect(page.getByRole("button", { name: "Post it", exact: true })).toBeFocused();
    await page.evaluate(() => localStorage.removeItem("trade.job-post-intent.v1")); await page.goto(`${app}/jobs/new?step=review&postIntent=${data.postKey}`);
    await expect(page.getByRole("heading", { name: "All good?", exact: true })).toBeVisible(); expect((await db.query("SELECT count(*)::int AS count FROM jobs WHERE post_key=$1", [data.postKey])).rows[0].count).toBe(0);
  });
  test("lost final response keeps the review; retry acknowledges exactly one job and cleans only its key", async ({ page }) => {
    const data = await guest(page);
    await db.query("INSERT INTO job_drafts(profile_id,data,manual_category,updated_at) VALUES($1,$2,true,now()) ON CONFLICT(profile_id) DO UPDATE SET data=EXCLUDED.data,manual_category=true", [SECURITY_USER.id, data]);
    await login(page, SECURITY_USER.email, "/jobs/new?step=review"); await expect(page.getByRole("heading", { name: "All good?", exact: true })).toBeVisible();
    let lost = false;
    await page.route("**/jobs/new**", async route => {
      let args; try { args = JSON.parse(route.request().postData() ?? "null"); } catch { /* A normal navigation has no action arguments. */ }
      if (!lost && Array.isArray(args) && args[1] === data.postKey && args[2] === SECURITY_USER.id && args[3]?.postKey === data.postKey) {
        lost = true; await route.fetch(); await route.abort("connectionfailed");
      } else await route.continue();
    });
    await page.getByRole("button", { name: "Post it", exact: true }).click(); await expect(page.getByText("Couldn’t post.", { exact: true })).toBeVisible();
    expect(lost).toBe(true); await expect(page.getByRole("region", { name: "What needs doing", exact: true })).toContainText(data.description);
    expect(await page.evaluate(key => localStorage.getItem(key) !== null, DRAFT_STORAGE_KEY)).toBe(true);
    await page.getByRole("button", { name: "Try again", exact: true }).click(); await expect(page.getByRole("heading", { name: "Posted.", exact: true })).toBeVisible();
    expect((await db.query("SELECT count(*)::int AS count FROM jobs WHERE post_key=$1", [data.postKey])).rows[0].count).toBe(1);
    expect(await page.evaluate(key => localStorage.getItem(key), DRAFT_STORAGE_KEY)).toBeNull();
  });
  test("review, all recovery states and account sheet fit five widths with keyboard-accessible controls", async ({ page }) => {
    test.setTimeout(240_000);
    const states = ["ready", "no-photos", "loading", "uploading", "photo-error", "posting", "error", "offline", "signup", "signup-pending", "signup-error", "signup-offline", "posted"];
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      for (const state of states) {
        await page.goto(`${app}/dev/components/post-job-review?state=${state}`); await expect(page.locator("h1").filter({ hasText: state === "posted" ? "Posted." : "All good?" })).toBeAttached();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await expectNoA11yViolations(page);
        if (viewport.width === 390 && state === "ready" || viewport.width === 1440 && state === "ready") await page.screenshot({ path: `/tmp/120-review-${viewport.width}.png`, fullPage: true });
      }
    }
  });
  test("combined account recovery visibly covers unavailable and offline states within the bot route cap", async ({ page }) => {
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport); await page.goto(`${app}/dev/components/post-job-review?state=signup-recovery`);
      const dialog = page.getByRole("dialog", { name: "Create account", exact: true }); await expect(dialog).toBeVisible();
      await expect(dialog.getByText("You’re offline.", { exact: true })).toBeVisible(); await expect(dialog.getByText("We can’t create your account right now.", { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await expectNoA11yViolations(page);
      if (viewport.width === 390 || viewport.width === 1440) await page.screenshot({ path: `/tmp/120-signup-recovery-${viewport.width}.png`, fullPage: true });
    }
  });
});
