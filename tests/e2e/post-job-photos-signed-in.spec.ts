import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import sharp from "sharp";
import { expectNoA11yViolations } from "./support/a11y";
import { startPhotoStorageStub } from "./support/photo-storage-stub";
import { SECURITY_PASSWORD, SECURITY_TRADIE, SECURITY_USER } from "./support/security-auth-stub";

const app = process.env.PHOTO_DRAFT_E2E_APP_URL;
const database = process.env.PHOTO_DRAFT_E2E_DATABASE_URL;
test.describe("signed-in draft photos through real actions, private Storage transport and PostgreSQL", () => {
  test.skip(!app || !database, "requires the task-owned local app, Auth/Storage doubles and disposable database");
  test.describe.configure({ mode: "serial" }); test.use({ reducedMotion: "reduce" });
  let storage: Awaited<ReturnType<typeof startPhotoStorageStub>>; let db: pg.Client;
  test.beforeAll(async () => {
    if (!["localhost", "127.0.0.1"].includes(new URL(app!).hostname) || new URL(database!).hostname !== "127.0.0.1" || new URL(database!).pathname !== "/issue118") throw new Error("Task-owned localhost app and database required");
    storage = await startPhotoStorageStub(); db = new pg.Client({ connectionString: database }); await db.connect();
    for (const user of [SECURITY_USER, SECURITY_TRADIE]) {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2) ON CONFLICT(id) DO NOTHING", [user.id, user.email]);
      await db.query("INSERT INTO profiles(id,email,role,first_name,email_verified_at,updated_at) VALUES($1,$2,'CUSTOMER','Photo Demo',now(),now()) ON CONFLICT(id) DO UPDATE SET role='CUSTOMER'", [user.id, user.email]);
    }
    await db.query("DELETE FROM job_drafts WHERE profile_id=ANY($1::uuid[])", [[SECURITY_USER.id, SECURITY_TRADIE.id]]);
  });
  test.afterAll(async () => { await storage?.close(); await db?.end(); });
  async function login(page: Page, email: string, next = "/jobs/new") {
    await page.goto(`${app}/login?next=${encodeURIComponent(next)}`); await page.getByLabel("Email", { exact: true }).fill(email); await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD); await page.getByRole("button", { name: "Log in", exact: true }).click(); await expect(page).toHaveURL(`${app}${next}`);
  }
  test("large direct upload/progress → cover/order/save → refresh/server-only restore → account isolation", async ({ page, request }) => {
    test.setTimeout(120_000); const jsonBodies: number[] = [];
    page.on("request", req => { if (req.url().startsWith(app!) && req.method() === "POST") jsonBodies.push(req.postDataBuffer()?.length ?? 0); });
    await login(page, SECURITY_USER.email);
    await page.getByRole("textbox", { name: "Describe the job", exact: true }).fill("Lights and wiring in the lounge need checking."); await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Add some photos", exact: true })).toBeVisible();
    const small = await sharp({ create: { width: 3200, height: 1600, channels: 3, background: "red" } }).jpeg().withExif({ IFD0: { Artist: "Private metadata" } }).toBuffer();
    // A HEIC-labelled input deliberately contains real JPEG bytes with trailing padding. This proves the
    // pass-through transport exceeds4.5MB while the server detects/rewrites the actual bytes, not the label.
    const large = Buffer.concat([small, Buffer.alloc(5 * 1024 * 1024)]);
    let release!: () => void; storage.holdUploads(new Promise<void>(resolve => { release = resolve; }));
    await page.locator('input[type="file"]').last().setInputFiles([{ name: "large-camera.HEIC", mimeType: "image/heic", buffer: large }, { name: "close.jpg", mimeType: "image/jpeg", buffer: small }]);
    await expect(page.getByRole("button", { name: /Uploading [12]…/ })).toHaveAttribute("aria-disabled", "true");
    await expect.poll(() => storage.events.filter(event => event.method === "PUT" && event.bytes > 4.5 * 1024 * 1024).length).toBe(1);
    release(); storage.holdUploads();
    await expect(page.getByRole("button", { name: "Next", exact: true })).not.toHaveAttribute("aria-disabled", "true", { timeout: 30_000 });
    expect(jsonBodies.every(size => size < 4096)).toBe(true);
    expect([...storage.objects.keys()].filter(path => path.startsWith("draft-photo-uploads/"))).toHaveLength(0);
    const imageBuffers = [...storage.objects.entries()].filter(([path]) => path.startsWith("photos/")); expect(imageBuffers).toHaveLength(2);
    for (const [, bytes] of imageBuffers) { const metadata = await sharp(bytes).metadata(); expect(metadata).toMatchObject({ format: "webp", width: 1600, height: 800 }); expect(metadata.exif).toBeUndefined(); }
    const rawWrite = storage.events.find(event => event.method === "PUT")!;
    expect((await request.get(`http://127.0.0.1:54318${rawWrite.path}`)).status()).toBe(403);
    const originalOrder = (await db.query("SELECT data->'photoPaths' AS paths FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id])).rows[0].paths;
    await page.getByRole("button", { name: "Photo options close.jpg", exact: true }).press("Enter"); await page.getByRole("menuitem", { name: "Make cover", exact: true }).press("Enter");
    const ordered = [...originalOrder].reverse();
    await expect.poll(async () => (await db.query("SELECT data->'photoPaths' AS paths FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id])).rows[0]?.paths).toEqual(ordered);
    await page.reload(); await expect(page.getByRole("button", { name: "Next", exact: true })).not.toHaveAttribute("aria-disabled", "true");
    await expect(page.getByRole("list", { name: "Photos", exact: true }).getByRole("img").first()).toHaveAttribute("alt", "Photo 1: close.jpg");
    await expectNoA11yViolations(page);
    await page.context().clearCookies(); await login(page, SECURITY_TRADIE.email);
    await expect(page.getByRole("textbox", { name: "Describe the job", exact: true })).toHaveValue("");
    await page.getByRole("textbox", { name: "Describe the job", exact: true }).fill("Check the upstairs lights and wiring."); await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByRole("list", { name: "Photos", exact: true }).getByRole("img")).toHaveCount(0);
    expect((await db.query("SELECT data->'photoPaths' AS paths FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id])).rows[0].paths).toEqual(ordered);
    await page.context().clearCookies(); await page.evaluate(async () => { localStorage.clear(); await new Promise<void>((resolve, reject) => { const deleted = indexedDB.deleteDatabase("trade.job-photos.v1"); deleted.onsuccess = () => resolve(); deleted.onerror = deleted.onblocked = () => reject(new Error("Could not clear test cache")); }); });
    await login(page, SECURITY_USER.email, "/jobs/new?step=photos");
    await expect(page.getByRole("button", { name: "Next", exact: true })).not.toHaveAttribute("aria-disabled", "true", { timeout: 15_000 });
    await expect(page.getByRole("list", { name: "Photos", exact: true }).getByRole("img")).toHaveCount(2);
    expect((await db.query("SELECT data->'photoPaths' AS paths FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id])).rows[0].paths).toEqual(ordered);
    expect(storage.events.filter(event => event.method === "POST" && /^\/storage\/v1\/object\/photos\//.test(event.path))).toHaveLength(2);
    await page.getByRole("button", { name: "Next", exact: true }).click(); await expect(page.getByRole("heading", { name: "Where & when", exact: true })).toBeVisible();
  });
  test("an expired upload session keeps its file and recovers through the shared login dialog", async ({ page }) => {
    await login(page, SECURITY_USER.email, "/jobs/new?step=photos");
    await expect(page.getByRole("button", { name: "Next", exact: true })).not.toHaveAttribute("aria-disabled", "true");
    await page.context().clearCookies();
    const bytes = await sharp({ create: { width: 64, height: 64, channels: 3, background: "blue" } }).jpeg().toBuffer();
    await page.locator('input[type="file"]').last().setInputFiles({ name: "retry-after-login.jpg", mimeType: "image/jpeg", buffer: bytes });
    const dialog = page.getByRole("dialog", { name: "You’ve been logged out", exact: true }); await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Log in again", exact: true }).click(); await dialog.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD); await dialog.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(dialog).toHaveCount(0); await expect(page.getByRole("button", { name: "Next", exact: true })).not.toHaveAttribute("aria-disabled", "true", { timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Remove retry-after-login.jpg", exact: true })).toBeVisible();
    expect((await db.query("SELECT data->'photoPaths' AS paths FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id])).rows[0].paths).toHaveLength(3);
  });
});
