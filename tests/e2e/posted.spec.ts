import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import sharp from "sharp";
import { startPhotoStorageStub } from "./support/photo-storage-stub";
import { SECURITY_PASSWORD, SECURITY_USER, SECURITY_TRADIE } from "./support/security-auth-stub";
import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

for (const viewport of VIEWPORTS) test(`posted, permission, current-status, owned-detail and email previews fit ${viewport.width}px`, async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize(viewport);
  for (const state of ["ready", "loading", "requesting", "enabled", "denied", "unsupported", "unavailable", "error", "status-gallery", "detail", "legacy", "email"]) {
    await test.step(state, async () => {
      await page.goto(`/dev/components/posted?state=${state}`);
      if (state === "email") await expect(page.getByTitle("Posted confirmation email")).toBeVisible();
      else await expect(page.locator("h1").first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expectNoA11yViolations(page);
      if ((viewport.width === 390 || viewport.width === 1440) && state === "ready") await page.screenshot({ path: `/tmp/121-posted-${viewport.width}.png`, fullPage: true });
    });
  }
});

const app = process.env.POSTED_E2E_APP_URL, database = process.env.POSTED_E2E_DATABASE_URL;
test.describe("real owned posted success and optional browser pings", () => {
  test.skip(!app || !database, "requires the task-owned app, Auth/Storage double and disposable database");
  test.describe.configure({ mode: "serial" });
  let storage: Awaited<ReturnType<typeof startPhotoStorageStub>>, db: pg.Client;
  test.beforeAll(async () => {
    if (!["127.0.0.1", "localhost"].includes(new URL(app!).hostname) || new URL(database!).hostname !== "127.0.0.1" || new URL(database!).pathname !== "/issue121") throw new Error("Task-owned localhost app and issue121 database required");
    storage = await startPhotoStorageStub(54322, { signup: { databaseUrl: database! } }); db = new pg.Client({ connectionString: database }); await db.connect();
    for (const user of [SECURITY_USER, SECURITY_TRADIE]) {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2) ON CONFLICT(id) DO NOTHING", [user.id, user.email]);
      await db.query("INSERT INTO profiles(id,email,role,first_name,email_verified_at,updated_at) VALUES($1,$2,'CUSTOMER','Posted Demo',now(),now()) ON CONFLICT(id) DO UPDATE SET role='CUSTOMER',email_verified_at=now()", [user.id, user.email]);
    }
  });
  test.afterAll(async () => { await storage?.close(); await db?.end(); });
  async function job(status = "REVIEW", workerId: string | null = null) {
    const price = ["REVIEW", "QUOTE_BOUNTY", "CANCELLED"].includes(status) ? null : 12500;
    return (await db.query("INSERT INTO jobs(customer_id,category,title,description,address_line1,suburb,city,status,price_cents,worker_id,any_time,updated_at) VALUES($1,'OTHER','Move the couch','Move the couch upstairs.','1 Example Street','Gladstone','Invercargill',$2::job_status,$3,$4,true,now()) RETURNING id,job_number", [SECURITY_USER.id, status, price, workerId])).rows[0];
  }
  async function login(page: Page, id: string, email = SECURITY_USER.email) {
    await page.goto(`${app}/login?next=${encodeURIComponent(`/jobs/${id}?posted=1`)}`); await page.getByLabel("Email", { exact: true }).fill(email); await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD); await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Posted.", exact: true })).toBeVisible();
  }
  test("guest photo → signup and one-use verification → fresh login → Posted → real owned job", async ({ page }) => {
    test.setTimeout(90_000); await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${app}/jobs/new`);
    await page.getByRole("textbox", { name: "Describe the job", exact: true }).fill("Move the couch upstairs safely.");
    await page.getByRole("radio", { name: "Other (anything)", exact: true }).check();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Add some photos", exact: true })).toBeVisible();
    const bytes = await sharp({ create: { width: 80, height: 60, channels: 3, background: "blue" } }).jpeg().toBuffer();
    await page.locator('input[type="file"]').last().setInputFiles({ name: "guest-couch.jpg", mimeType: "image/jpeg", buffer: bytes });
    await expect(page.getByRole("button", { name: "Next", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Where and when?", exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "Address", exact: true }).fill("1 Example Street");
    await page.getByLabel("Suburb", { exact: true }).fill("Gladstone"); await page.getByLabel("City", { exact: true }).fill("Invercargill");
    await page.getByLabel("Unit / flat (optional)", { exact: true }).fill("Unit 2");
    await page.getByLabel("Postcode (optional)", { exact: true }).fill("9810");
    await page.getByLabel("Anything else? (optional)", { exact: true }).fill("Use the side entrance.");
    await page.getByRole("button", { name: "Any time", exact: true }).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByRole("heading", { name: "All good?", exact: true })).toBeVisible();
    expect(storage.events.filter(event => event.method === "PUT")).toHaveLength(0);
    await page.getByRole("button", { name: "Post it", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Create account", exact: true }); await expect(dialog).toBeVisible();
    const email = `posted-journey-${randomUUID()}@example.test`;
    await dialog.getByLabel("Full name", { exact: true }).fill("Posted Journey");
    await dialog.getByLabel("Email", { exact: true }).fill(email); await dialog.getByLabel("Mobile", { exact: true }).fill("021 555 0192");
    await dialog.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD); await dialog.getByRole("checkbox").check();
    await dialog.getByRole("button", { name: "Create account", exact: true }).click(); await expect(page).toHaveURL(/\/verify\?/);
    const next = new URL(page.url()).searchParams.get("next")!; const registered = storage.auth.registeredUser(email)!;
    expect((await db.query("SELECT email_verified_at FROM profiles WHERE id=$1", [registered.id])).rows[0].email_verified_at).toBeNull();
    expect((await db.query("SELECT count(*)::int AS count FROM jobs WHERE customer_id=$1", [registered.id])).rows[0].count).toBe(0);
    const confirmation = storage.auth.confirmationUrl(email, app!, next);
    await page.goto(confirmation); await expect(page.getByRole("heading", { name: "You’re all set", exact: true })).toBeVisible();
    expect(storage.auth.events.some(event => event.path === "/auth/v1/logout" && event.userId === registered.id && event.scope === "local")).toBe(true);
    expect((await db.query("SELECT count(*)::int AS count FROM jobs WHERE customer_id=$1", [registered.id])).rows[0].count).toBe(0);
    await page.getByRole("link", { name: "Continue", exact: true }).click(); await expect(page).toHaveURL(/\/login\?next=/);
    await page.getByLabel("Email", { exact: true }).fill(email); await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Posted.", exact: true })).toBeVisible({ timeout: 30_000 });
    const posted = (await db.query("SELECT id,post_key,description,address_line2,access_notes,status FROM jobs WHERE customer_id=$1", [registered.id])).rows;
    expect(posted).toHaveLength(1); const value = posted[0];
    expect(value).toMatchObject({ description: "Move the couch upstairs safely.", address_line2: "Unit 2", access_notes: "Use the side entrance.", status: "REVIEW" });
    await expect(page).toHaveURL(`${app}/jobs/${value.id}?posted=1`);
    const photos = (await db.query("SELECT path,uploaded_by_id FROM job_photos WHERE job_id=$1 ORDER BY position", [value.id])).rows;
    expect(photos).toHaveLength(1); expect(photos[0].uploaded_by_id).toBe(registered.id);
    expect(photos[0].path).toContain(`drafts/${registered.id}/${value.post_key}/`); expect(storage.objects.has(`photos/${photos[0].path}`)).toBe(true);
    expect((await db.query("SELECT email_verified_at FROM profiles WHERE id=$1", [registered.id])).rows[0].email_verified_at).not.toBeNull();
    await expect(page.getByText("We’re on it. We’ll let you know when your price is ready.", { exact: true })).toBeVisible();
    await expectNoA11yViolations(page);
    await page.reload(); await expect(page.getByRole("heading", { name: "Posted.", exact: true })).toBeVisible();
    await expect(page.locator(".tm-flash")).toHaveAttribute("data-playing", "false");
    await page.getByRole("link", { name: "View my job", exact: true }).click(); await expect(page).toHaveURL(`${app}/jobs/${value.id}`);
    await expect(page.getByRole("heading", { name: "Move the couch upstairs safely.", exact: true })).toBeVisible();
    await expect(page.getByText("Unit 2, 1 Example Street, Gladstone, Invercargill, 9810", { exact: true })).toBeVisible();
    await expect(page.getByText("Use the side entrance.", { exact: true })).toBeVisible(); await expect(page.getByText("Any time", { exact: true })).toBeVisible();
    await expectNoA11yViolations(page);
  });
  test("own card comes first; dismissing the native prompt asks once, and reduced motion remains still", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      Object.defineProperty(Notification, "permission", { configurable: true, get: () => "default" });
      Object.defineProperty(Notification, "requestPermission", { configurable: true, value: async () => {
        const calls = String(Number(localStorage.getItem("fixture121-native-prompts") ?? 0) + 1);
        localStorage.setItem("fixture121-native-prompts", calls); document.documentElement.dataset.nativePrompts = calls; return "default";
      } });
    });
    const value = await job(); await login(page, value.id);
    await expect(page.getByRole("button", { name: "Yes please", exact: true })).toBeVisible();
    expect(await page.locator("html").getAttribute("data-native-prompts")).toBeNull();
    await expect(page.locator(".tm-flash")).toHaveAttribute("data-playing", "false");
    await page.getByRole("button", { name: "Yes please", exact: true }).press("Enter");
    await expect(page.getByRole("region", { name: "Get a ping when it’s ready?", exact: true })).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute("data-native-prompts", "1");
    await page.reload(); await expect(page.getByRole("button", { name: "Yes please", exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("fixture121-native-prompts"))).toBe("1");
    await page.getByRole("link", { name: "View my job", exact: true }).press("Enter");
    await expect(page).toHaveURL(`${app}/jobs/${value.id}`); await expect(page.getByRole("heading", { name: "Move the couch", exact: true })).toBeVisible();
    await expect(page.getByText("Any time", { exact: true })).toBeVisible(); await expectNoA11yViolations(page);
    await page.getByRole("main").getByRole("link", { name: "Home", exact: true }).click(); await expect(page).toHaveURL(`${app}/`);
  });
  test("a granted token survives a lost binding response and foreground retries display only once", async ({ page, context }) => {
    test.setTimeout(60_000); const token = `test-browser-fcm-${randomUUID()}`;
    await test.step("grant the browser's native notification permission", () => context.grantPermissions(["notifications"], { origin: app! }));
    await test.step("install local subscription and provider HTTP doubles", async () => { await page.addInitScript(() => {
      const subscription = { endpoint: "https://push.example.test/test-device", getKey: (name: string) => new Uint8Array(name === "auth" ? 16 : 65).fill(1).buffer };
      Object.defineProperty(PushManager.prototype, "getSubscription", { configurable: true, value: async () => subscription });
      Object.defineProperty(ServiceWorkerRegistration.prototype, "showNotification", { configurable: true, value: async () => { document.documentElement.dataset.shownPings = String(Number(document.documentElement.dataset.shownPings ?? 0) + 1); } });
    });
    await page.route("https://firebaseinstallations.googleapis.com/**", route => route.fulfill({ json: { fid: "c1234567890123456789012", refreshToken: "test-refresh", authToken: { token: "test-installation-token", expiresIn: "604800s" } } }));
    await page.route("https://fcmregistrations.googleapis.com/**", route => route.fulfill({ json: { token } })); });
    const value = await test.step("create an owned job fixture", () => job());
    await test.step("log in through the actual Auth SDK", () => login(page, value.id)); let lost = false;
    expect(await page.evaluate(() => Notification.permission)).toBe("granted");
    await page.route(`**/jobs/${value.id}?posted=1`, async route => {
      let args; try { args = JSON.parse(route.request().postData() ?? "null"); } catch { /* Ordinary page load. */ }
      if (!lost && Array.isArray(args) && args[0] === SECURITY_USER.id && args[1] === token) { lost = true; await route.fetch(); await route.abort("connectionfailed"); }
      else await route.continue();
    });
    await test.step("choose Yes please with native permission already granted", () => page.getByRole("button", { name: "Yes please", exact: true }).click());
    await test.step("observe the intentionally lost binding response", async () => {
      await expect(page.getByText("Couldn’t turn on notifications.", { exact: true })).toBeVisible(); expect(lost).toBe(true);
    });
    const proof = (await context.cookies()).find(cookie => cookie.name === "tm-push-device"); expect(proof?.httpOnly).toBe(true);
    await test.step("retry the same token and device proof", async () => {
      await page.getByRole("button", { name: "Try again", exact: true }).click(); await expect(page.getByText("Notifications are on.", { exact: true })).toBeVisible();
    });
    expect((await context.cookies()).find(cookie => cookie.name === "tm-push-device")?.value).toBe(proof!.value);
    await db.query("UPDATE jobs SET status='PRICED',price_cents=12500 WHERE id=$1", [value.id]);
    const notificationId = randomUUID(); await db.query("INSERT INTO notifications(id,user_id,type,payload) VALUES($1,$2,'job.priced',$3)", [notificationId, SECURITY_USER.id, { jobId: value.id, jobNumber: value.job_number }]);
    const delivery = (await db.query("SELECT id FROM price_ready_push_deliveries WHERE notification_id=$1", [notificationId])).rows[0].id;
    const displayResponses: number[] = [];
    page.on("response", response => { if (new URL(response.url()).pathname === `/api/notifications/push/${delivery}/display`) displayResponses.push(response.status()); });
    // Retry the same durable delivery while the receiver initializes. Distinct transport ids ensure the
    // server's once-only claim is exercised even if the SDK deduplicates identical FCM message ids.
    await expect.poll(async () => {
      await page.evaluate(id => { for (let attempt = 0; attempt < 2; attempt++) { const message = { isFirebaseMessaging: true, messageType: "push-received", from: "12345678", fcmMessageId: crypto.randomUUID(), data: { deliveryId: id } }; navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: message })); } }, delivery);
      return Number(await page.locator("html").getAttribute("data-shown-pings") ?? 0);
    }).toBe(1);
    await expect.poll(() => displayResponses.length).toBeGreaterThanOrEqual(2);
    expect(displayResponses.filter(status => status === 200)).toHaveLength(1);
    await expect(page.locator("html")).toHaveAttribute("data-shown-pings", "1");
    expect((await db.query("SELECT displayed_at,delivered_at FROM price_ready_push_deliveries WHERE id=$1", [delivery])).rows[0]).toMatchObject({ displayed_at: expect.any(Date), delivered_at: null });
    await expectNoA11yViolations(page);
    await expect(page.locator("html")).toHaveAttribute("data-shown-pings", "1");
  });
  test("stale success URLs show current cancellation and legacy timing, with owner-only access", async ({ page }) => {
    const value = await job("CANCELLED"); await login(page, value.id);
    await expect(page.getByText("Cancelled", { exact: true })).toBeVisible(); await expect(page.getByText("Sorted", { exact: true })).toHaveCount(0);
    await db.query("UPDATE jobs SET any_time=false,asap=true WHERE id=$1", [value.id]);
    await page.getByRole("link", { name: "View my job", exact: true }).click(); await expect(page.getByText("Time to be arranged", { exact: true })).toBeVisible(); await expect(page.getByText("ASAP", { exact: true })).toBeVisible();
    await page.context().clearCookies(); await page.goto(`${app}/login?next=${encodeURIComponent(`/jobs/${value.id}?posted=1`)}`);
    await page.getByLabel("Email", { exact: true }).fill(SECURITY_TRADIE.email); await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD); await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Posted.", exact: true })).toHaveCount(0); await expect(page.getByRole("link", { name: "View my job", exact: true })).toHaveCount(0);
  });
  test("the shared job route retains the assigned-worker destination", async ({ page }) => {
    await db.query("UPDATE profiles SET role='TRADIE' WHERE id=$1", [SECURITY_TRADIE.id]);
    try {
      const value = await job("ASSIGNED", SECURITY_TRADIE.id);
      await page.goto(`${app}/login?next=${encodeURIComponent(`/jobs/${value.id}?posted=1`)}`);
      await page.getByLabel("Email", { exact: true }).fill(SECURITY_TRADIE.email); await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD); await page.getByRole("button", { name: "Log in", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Move the couch", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Back to jobs", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Posted.", exact: true })).toHaveCount(0);
      await page.getByRole("link", { name: "Back to jobs", exact: true }).click(); await expect(page).toHaveURL(new RegExp(`/jobs(?:\\?|$)`));
    } finally { await db.query("UPDATE profiles SET role='CUSTOMER' WHERE id=$1", [SECURITY_TRADIE.id]); }
  });
});
