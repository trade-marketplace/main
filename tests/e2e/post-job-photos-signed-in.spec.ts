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
    await page.context().clearCookies(); await page.goto(`${app}/`);
    await page.evaluate(async () => { localStorage.clear(); await new Promise<void>((resolve, reject) => { const deleted = indexedDB.deleteDatabase("trade.job-photos.v1"); deleted.onsuccess = () => resolve(); deleted.onerror = () => reject(new Error("Could not clear test cache")); }); });
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
  test("stale local snapshots cannot detach another device's added, reordered or removed photos on Next or exit", async ({ page, browser }) => {
    test.setTimeout(90_000);
    await login(page, SECURITY_USER.email, "/jobs/new?step=photos");
    await expect(page.getByRole("button", { name: "Next", exact: true })).not.toHaveAttribute("aria-disabled", "true");
    const oldPaths = (await db.query("SELECT data->'photoPaths' AS paths FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id])).rows[0].paths as string[];
    const remote = await browser.newContext(); const other = await remote.newPage();
    try {
      await login(other, SECURITY_USER.email, "/jobs/new?step=photos");
      await expect(other.getByRole("button", { name: "Next", exact: true })).not.toHaveAttribute("aria-disabled", "true");
      const bytes = await sharp({ create: { width: 100, height: 80, channels: 3, background: "green" } }).jpeg().toBuffer();
      await other.locator('input[type="file"]').last().setInputFiles({ name: "remote-device.jpg", mimeType: "image/jpeg", buffer: bytes });
      await expect(other.getByRole("button", { name: "Next", exact: true })).not.toHaveAttribute("aria-disabled", "true");
      await other.getByRole("button", { name: "Photo options remote-device.jpg", exact: true }).click(); await other.getByRole("menuitem", { name: "Make cover", exact: true }).click();
      await other.getByRole("button", { name: "Remove Photo 2", exact: true }).click();
      await expect.poll(async () => (await db.query("SELECT data->'photoPaths' AS paths FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id])).rows[0].paths).not.toEqual(oldPaths);
      await expect(other.getByRole("button", { name: "Next", exact: true })).not.toHaveAttribute("aria-disabled", "true");
      const current = (await db.query("SELECT data->'photoPaths' AS paths FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id])).rows[0].paths as string[];
      expect(current).toHaveLength(3); expect(current[0]).not.toBe(oldPaths[0]); expect(current).not.toContain(oldPaths[1]);
      // Device A still has its older localStorage AND IndexedDB records. A real reload must reconcile both.
      await page.reload(); await expect(page.getByRole("button", { name: "Next", exact: true })).not.toHaveAttribute("aria-disabled", "true");
      const photos = page.getByRole("list", { name: "Photos", exact: true }).getByRole("img"); await expect(photos).toHaveCount(3);
      await expect(photos.first()).toHaveAttribute("src", new RegExp(current[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      await page.getByRole("button", { name: "Next", exact: true }).click(); await expect(page.getByRole("heading", { name: "Where & when", exact: true })).toBeVisible();
      expect((await db.query("SELECT data->'photoPaths' AS paths FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id])).rows[0].paths).toEqual(current);
      await page.getByRole("link", { name: "Back", exact: true }).click(); await expect(page.getByRole("heading", { name: "Add some photos", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Save & exit", exact: true }).click(); await expect(page).toHaveURL(`${app}/`);
      expect((await db.query("SELECT data->'photoPaths' AS paths FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id])).rows[0].paths).toEqual(current);
    } finally { await remote.close(); }
  });
  test("six saved photos plus six unsynced local files stay recoverable through exit/refresh and explicit Retry", async ({ page }) => {
    test.setTimeout(120_000); await login(page, SECURITY_USER.email, "/jobs/new?step=photos");
    await expect(page.getByRole("button", { name: "Next", exact: true })).not.toHaveAttribute("aria-disabled", "true");
    const bytes = await sharp({ create: { width: 100, height: 80, channels: 3, background: "blue" } }).jpeg().toBuffer();
    await page.locator('input[type="file"]').last().setInputFiles(Array.from({ length: 3 }, (_, index) => ({ name: `saved-${index}.jpg`, mimeType: "image/jpeg", buffer: bytes })));
    await expect(page.getByRole("button", { name: "Next", exact: true })).not.toHaveAttribute("aria-disabled", "true");
    const data = (await db.query("SELECT data FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id])).rows[0].data;
    expect(data.photoPaths).toHaveLength(6);
    await page.evaluate(async ({ key, base64, draft, ownerId }) => {
      const bytes = Uint8Array.from(atob(base64), value => value.charCodeAt(0));
      const photos = Array.from({ length: 6 }, (_, index) => ({ id: `offline-${index}`, name: `offline-local-${index}.jpg`, file: new File([bytes], `offline-local-${index}.jpg`, { type: "image/jpeg" }), prepared: true }));
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("trade.job-photos.v1", 1); request.onerror = () => reject(request.error); request.onsuccess = () => {
          const db = request.result; const tx = db.transaction("drafts", "readwrite"); tx.objectStore("drafts").put(photos, key);
          tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error);
        };
      });
      const wizard = JSON.parse(localStorage.getItem("trade.job-draft.v1") ?? "null") ?? { version: 1, ownerId, data: draft, description: draft.description, manualCategory: true, completedDescribe: true, completedPhotos: false };
      wizard.data.photoPaths = []; localStorage.setItem("trade.job-draft.v1", JSON.stringify(wizard));
    }, { key: `${SECURITY_USER.id}:${data.postKey}`, base64: bytes.toString("base64"), draft: data, ownerId: SECURITY_USER.id });
    const writes = storage.events.filter(event => event.method === "PUT").length;
    await page.reload(); const grid = page.getByRole("list", { name: "Photos", exact: true });
    await expect(grid.locator('[data-status="done"]')).toHaveCount(6); await expect(grid.locator('[data-status="failed"]')).toHaveCount(6);
    await expect(page.getByText(/^6 of 6 ·/)).toBeVisible(); await expect(page.getByRole("button", { name: "Next", exact: true })).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByRole("button", { name: "Retry offline-local-0.jpg", exact: true })).toBeDisabled();
    expect(storage.events.filter(event => event.method === "PUT")).toHaveLength(writes);
    await page.getByRole("button", { name: "Save & exit", exact: true }).click(); await expect(page).toHaveURL(`${app}/`);
    expect((await db.query("SELECT data->'photoPaths' AS paths FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id])).rows[0].paths).toEqual(data.photoPaths);
    await page.goto(`${app}/jobs/new?step=photos`); await expect(grid.locator("[data-photo-id]")).toHaveCount(12);
    await expect(grid.locator('[data-status="done"]')).toHaveCount(6);
    for (let index = 0; index < 6; index++) await grid.locator('[data-status="done"]').first().getByRole("button", { name: /^Remove / }).click();
    for (let index = 0; index < 6; index++) await page.getByRole("button", { name: `Retry offline-local-${index}.jpg`, exact: true }).click();
    await expect(page.getByRole("button", { name: "Next", exact: true })).not.toHaveAttribute("aria-disabled", "true", { timeout: 30_000 });
    const next = (await db.query("SELECT data->'photoPaths' AS paths FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id])).rows[0].paths as string[];
    expect(next).toHaveLength(6); expect(next.every(path => !data.photoPaths.includes(path))).toBe(true);
    expect(storage.events.filter(event => event.method === "PUT")).toHaveLength(writes + 6); await expectNoA11yViolations(page);
  });
  test("same-document session recovery reconciles fresh same-postKey server paths before Next and exit", async ({ page, browser }) => {
    test.setTimeout(90_000); await login(page, SECURITY_USER.email, "/jobs/new?step=photos");
    await expect(page.getByRole("button", { name: "Next", exact: true })).not.toHaveAttribute("aria-disabled", "true");
    await page.evaluate(() => Object.assign(window, { __photoRscMarker: "same-document" }));
    const remote = await browser.newContext(); const other = await remote.newPage();
    try {
      await login(other, SECURITY_USER.email, "/jobs/new?step=photos"); await expect(other.getByRole("button", { name: "Next", exact: true })).not.toHaveAttribute("aria-disabled", "true");
      await page.context().clearCookies(); await page.getByRole("button", { name: "Remove Photo 1", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "You’ve been logged out", exact: true }); await expect(dialog).toBeVisible();
      await other.getByRole("button", { name: "Remove Photo 2", exact: true }).click();
      const bytes = await sharp({ create: { width: 100, height: 80, channels: 3, background: "green" } }).jpeg().toBuffer();
      await other.locator('input[type="file"]').last().setInputFiles({ name: "rsc-device.jpg", mimeType: "image/jpeg", buffer: bytes });
      await expect(other.getByRole("button", { name: "Next", exact: true })).not.toHaveAttribute("aria-disabled", "true");
      await other.getByRole("button", { name: "Photo options rsc-device.jpg", exact: true }).click(); await other.getByRole("menuitem", { name: "Make cover", exact: true }).click();
      await expect(other.getByRole("button", { name: "Next", exact: true })).not.toHaveAttribute("aria-disabled", "true");
      const current = (await db.query("SELECT data->'photoPaths' AS paths FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id])).rows[0].paths as string[];
      await dialog.getByRole("button", { name: "Log in again", exact: true }).click(); await dialog.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD); await dialog.getByRole("button", { name: "Log in", exact: true }).click(); await expect(dialog).toHaveCount(0);
      await expect(page.getByRole("list", { name: "Photos", exact: true }).getByRole("img").first()).toHaveAttribute("src", new RegExp(current[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      expect(await page.evaluate(() => (window as Window & { __photoRscMarker?: string }).__photoRscMarker)).toBe("same-document");
      await expect(page.getByRole("button", { name: "Next", exact: true })).not.toHaveAttribute("aria-disabled", "true");
      await page.getByRole("button", { name: "Next", exact: true }).click(); await expect(page.getByRole("heading", { name: "Where & when", exact: true })).toBeVisible();
      await page.getByRole("link", { name: "Back", exact: true }).click(); await expect(page.getByRole("heading", { name: "Add some photos", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Save & exit", exact: true }).click(); await expect(page).toHaveURL(`${app}/`);
      expect((await db.query("SELECT data->'photoPaths' AS paths FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id])).rows[0].paths).toEqual(current);
    } finally { await remote.close(); }
  });
  test("Next and exit CAS preserve a second-device update committed after their fresh read", async ({ page, browser }) => {
    test.setTimeout(120_000); await login(page, SECURITY_USER.email, "/jobs/new?step=photos");
    // Keep this race regression independently runnable after the shared fixture clears drafts.
    if (!(await db.query("SELECT data FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id])).rows.length) {
      await page.getByRole("textbox", { name: "Describe the job", exact: true }).fill("Lights and wiring need checking in the lounge"); await page.getByRole("button", { name: "Next", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Add some photos", exact: true })).toBeVisible();
      const seed = await sharp({ create: { width: 100, height: 80, channels: 3, background: "green" } }).jpeg().toBuffer();
      await page.locator('input[type="file"]').last().setInputFiles(Array.from({ length: 6 }, (_, index) => ({ name: `cas-base-${index}.jpg`, mimeType: "image/jpeg", buffer: seed })));
      await expect(page.getByRole("button", { name: "Next", exact: true })).not.toHaveAttribute("aria-disabled", "true", { timeout: 30_000 });
    }
    const remote = await browser.newContext(); const other = await remote.newPage();
    try {
      await login(other, SECURITY_USER.email, "/jobs/new?step=photos");
      const bytes = await sharp({ create: { width: 100, height: 80, channels: 3, background: "red" } }).jpeg().toBuffer();
      for (const action of ["Next", "Save & exit"]) {
        await expect(page.getByRole("button", { name: "Next", exact: true })).not.toHaveAttribute("aria-disabled", "true");
        let armed = true; let pause!: () => void; let release!: () => void;
        const paused = new Promise<void>(resolve => { pause = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
        const handler = async (route: import("@playwright/test").Route) => {
          const request = route.request(); const body = request.postData() ?? "";
          if (armed && request.method() === "POST" && request.headers()["next-action"] && body.includes('"photoPaths"') && body.includes('"paths"')) { armed = false; pause(); await gate; }
          await route.continue();
        };
        await page.route("**/jobs/new**", handler);
        try {
          await page.getByRole("button", { name: action, exact: true }).click(); await paused;
          const grid = other.getByRole("list", { name: "Photos", exact: true }); await grid.locator('[data-status="done"]').last().getByRole("button", { name: /^Remove / }).click();
          const name = action === "Next" ? "cas-next.jpg" : "cas-exit.jpg";
          await other.locator('input[type="file"]').last().setInputFiles({ name, mimeType: "image/jpeg", buffer: bytes });
          await expect(other.getByRole("button", { name: "Next", exact: true })).not.toHaveAttribute("aria-disabled", "true", { timeout: 30_000 });
          await other.getByRole("button", { name: `Photo options ${name}`, exact: true }).click(); await other.getByRole("menuitem", { name: "Make cover", exact: true }).click();
          await expect(other.getByRole("button", { name: "Next", exact: true })).not.toHaveAttribute("aria-disabled", "true");
          const current = (await db.query("SELECT data->'photoPaths' AS paths FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id])).rows[0].paths as string[];
          release(); await expect(page.getByText("Couldn’t save.", { exact: true })).toBeVisible();
          await expect(page.getByRole("button", { name: "Next", exact: true })).not.toHaveAttribute("aria-disabled", "true");
          expect((await db.query("SELECT data->'photoPaths' AS paths FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id])).rows[0].paths).toEqual(current);
          await page.getByRole("button", { name: action, exact: true }).click();
          if (action === "Next") { await expect(page.getByRole("heading", { name: "Where & when", exact: true })).toBeVisible(); await page.getByRole("link", { name: "Back", exact: true }).click(); await expect(page.getByRole("heading", { name: "Add some photos", exact: true })).toBeVisible(); }
          else await expect(page).toHaveURL(`${app}/`, { timeout: 15_000 });
          expect((await db.query("SELECT data->'photoPaths' AS paths FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id])).rows[0].paths).toEqual(current);
        } finally { release(); await page.unrouteAll({ behavior: "wait" }); }
      }
    } finally { await remote.close(); }
  });
  test("a paused first creation cannot replace another device's newly created postKey and photos", async ({ page, browser }) => {
    test.setTimeout(90_000); await db.query("DELETE FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id]);
    await login(page, SECURITY_USER.email); await page.getByRole("textbox", { name: "Describe the job", exact: true }).fill("The first device's unfinished description"); await page.getByRole("radio", { name: "Other (anything)", exact: true }).check();
    const staleKey = await page.evaluate(() => JSON.parse(localStorage.getItem("trade.job-draft.v1")!).data.postKey);
    let pause!: () => void; let release!: () => void; let armed = true;
    const paused = new Promise<void>(resolve => { pause = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
    const handler = async (route: import("@playwright/test").Route) => {
      const request = route.request(); if (armed && request.method() === "POST" && request.headers()["next-action"] && (request.postData() ?? "").includes('"absent":true')) { armed = false; pause(); await gate; }
      await route.continue();
    };
    await page.route("**/jobs/new**", handler); const remote = await browser.newContext(); const other = await remote.newPage();
    try {
      await page.getByRole("button", { name: "Next", exact: true }).click(); await paused;
      await login(other, SECURITY_USER.email); await other.getByRole("textbox", { name: "Describe the job", exact: true }).fill("The remote device's description and photos"); await other.getByRole("radio", { name: "Other (anything)", exact: true }).check(); await other.getByRole("button", { name: "Next", exact: true }).click();
      await expect(other.getByRole("heading", { name: "Add some photos", exact: true })).toBeVisible();
      const bytes = await sharp({ create: { width: 100, height: 80, channels: 3, background: "blue" } }).jpeg().toBuffer();
      await other.locator('input[type="file"]').last().setInputFiles({ name: "first-remote.jpg", mimeType: "image/jpeg", buffer: bytes }); await expect(other.getByRole("button", { name: "Next", exact: true })).not.toHaveAttribute("aria-disabled", "true", { timeout: 30_000 });
      const current = (await db.query("SELECT data FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id])).rows[0].data;
      expect(current.postKey).not.toBe(staleKey); expect(current.photoPaths).toHaveLength(1);
      release(); await expect(page.getByRole("form", { name: "Describe the job", exact: true }).getByRole("textbox")).toHaveValue(current.description);
      expect((await db.query("SELECT data FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id])).rows[0].data).toEqual(current);
      await page.getByRole("button", { name: "Save & exit", exact: true }).click(); await expect(page).toHaveURL(`${app}/`, { timeout: 15_000 });
      expect((await db.query("SELECT data FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id])).rows[0].data).toEqual(current);
    } finally { release(); await page.unrouteAll({ behavior: "wait" }); await remote.close(); }
  });
  test("an initial draft-load failure cannot blind-save over the existing remote draft", async ({ page }) => {
    test.setTimeout(60_000); const current = (await db.query("SELECT data FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id])).rows[0].data;
    // The test URL is strictly restricted to the disposable issue118 database above. A brief table rename
    // exercises the page's real load-failure path; restore it before allowing any customer save.
    await db.query('ALTER TABLE public.job_drafts RENAME TO job_drafts_hidden_for_118_test');
    try { await login(page, SECURITY_USER.email); await expect(page.getByText("Couldn’t load your draft.", { exact: true })).toBeVisible(); }
    finally { await db.query('ALTER TABLE public.job_drafts_hidden_for_118_test RENAME TO job_drafts'); }
    await page.getByRole("textbox", { name: "Describe the job", exact: true }).fill("An edit made after the draft failed to load");
    await page.getByRole("radio", { name: "Other (anything)", exact: true }).check();
    await page.getByRole("button", { name: "Next", exact: true }).click(); await expect(page.getByRole("form", { name: "Describe the job", exact: true }).getByRole("textbox")).toHaveValue(current.description);
    expect((await db.query("SELECT data FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id])).rows[0].data).toEqual(current);
    await page.getByRole("button", { name: "Save & exit", exact: true }).click(); await expect(page).toHaveURL(`${app}/`, { timeout: 15_000 });
    expect((await db.query("SELECT data FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id])).rows[0].data).toEqual(current);
  });
  test("blank Save & exit creates a confirmed draft that can resume through its next save", async ({ page }) => {
    await db.query("DELETE FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id]); await login(page, SECURITY_USER.email);
    await page.getByRole("button", { name: "Save & exit", exact: true }).click(); await expect(page).toHaveURL(`${app}/`);
    const first = (await db.query("SELECT data FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id])).rows[0].data;
    expect(first.postKey).toMatch(/^[a-f0-9-]{36}$/);
    await page.goto(`${app}/jobs/new`); await page.getByRole("textbox", { name: "Describe the job", exact: true }).fill("Move the garden bench to the shed");
    await page.getByRole("button", { name: "Next", exact: true }).click(); await expect(page.getByRole("heading", { name: "Add some photos", exact: true })).toBeVisible();
    expect((await db.query("SELECT data FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id])).rows[0].data.postKey).toBe(first.postKey);
  });
  for (const mode of ["blocked", "cached-file"] as const) test(`server-only photos remain usable with IndexedDB ${mode}: preview → reorder → Next → Back → exit`, async ({ page }) => {
    const key = crypto.randomUUID(); const paths = ["a", "b"].map(letter => `drafts/${SECURITY_USER.id}/${key}/${letter.repeat(32)}.webp`);
    const bytes = await sharp({ create: { width: 120, height: 90, channels: 3, background: "green" } }).webp().toBuffer();
    for (const path of paths) {
      storage.objects.set(`photos/${path}`, bytes);
      await db.query("INSERT INTO draft_photo_cleanup(path,user_id,post_key,check_after) VALUES($1,$2,$3,now()+interval '1 day')", [path, SECURITY_USER.id, key]);
    }
    const data = { postKey: key, description: "Check the upstairs lights and wiring.", category: "ELECTRICAL", photoPaths: paths };
    await db.query("INSERT INTO job_drafts(profile_id,data,updated_at) VALUES($1,$2,now()) ON CONFLICT(profile_id) DO UPDATE SET data=EXCLUDED.data", [SECURITY_USER.id, data]);
    if (mode === "blocked") await page.addInitScript(() => { Object.defineProperty(window, "indexedDB", { configurable: true, get() { throw new DOMException("Storage blocked", "SecurityError"); } }); });
    else {
      await page.goto(`${app}/jobs/new`);
      await page.evaluate(async ({ owner, key, paths, bytes }) => {
        const files = paths.map((path, index) => ({ id: `cached-${index}`, name: `cached-${index + 1}.jpg`, path, file: new File([Uint8Array.from(atob(bytes), char => char.charCodeAt(0))], `cached-${index + 1}.jpg`, { type: "image/webp" }), prepared: true }));
        await new Promise<void>((resolve, reject) => {
          const request = indexedDB.open("trade.job-photos.v1", 1); request.onupgradeneeded = () => request.result.createObjectStore("drafts"); request.onerror = () => reject(request.error);
          request.onsuccess = () => { const db = request.result; const tx = db.transaction("drafts", "readwrite"); tx.objectStore("drafts").put(files, `${owner}:${key}`); tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error); };
        });
      }, { owner: SECURITY_USER.id, key, paths, bytes: bytes.toString("base64") });
      await page.addInitScript(() => { IDBObjectStore.prototype.put = function() { throw new DOMException("Storage full", "QuotaExceededError"); }; });
    }
    const writes = storage.events.filter(event => event.method === "PUT").length;
    await login(page, SECURITY_USER.email, "/jobs/new?step=photos");
    const grid = page.getByRole("list", { name: "Photos", exact: true }); await expect(grid.getByRole("img")).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Next", exact: true })).not.toHaveAttribute("aria-disabled", "true");
    await expect(page.getByText("Couldn’t save.", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: `Photo options ${mode === "blocked" ? "Photo 2" : "cached-2.jpg"}`, exact: true }).click(); await page.getByRole("menuitem", { name: "Make cover", exact: true }).click();
    await expect.poll(async () => (await db.query("SELECT data->'photoPaths' AS paths FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id])).rows[0].paths).toEqual([...paths].reverse());
    await page.getByRole("button", { name: "Next", exact: true }).click(); await expect(page.getByRole("heading", { name: "Where & when", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Back", exact: true }).click(); await expect(page.getByRole("button", { name: "Next", exact: true })).not.toHaveAttribute("aria-disabled", "true");
    await expectNoA11yViolations(page); await page.getByRole("button", { name: "Save & exit", exact: true }).click(); await expect(page).toHaveURL(`${app}/`);
    expect((await db.query("SELECT data->'photoPaths' AS paths FROM job_drafts WHERE profile_id=$1", [SECURITY_USER.id])).rows[0].paths).toEqual([...paths].reverse());
    expect(storage.events.filter(event => event.method === "PUT")).toHaveLength(writes);
  });
});
