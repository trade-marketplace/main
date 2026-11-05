import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import sharp from "sharp";
import { startPhotoStorageStub } from "./support/photo-storage-stub";
import { SECURITY_PASSWORD, SECURITY_USER, SECURITY_TRADIE } from "./support/security-auth-stub";
import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const app = process.env.CUSTOMER_JOB_E2E_APP_URL, database = process.env.CUSTOMER_JOB_E2E_DATABASE_URL;
const previewApp = process.env.POSTED_PREVIEW_E2E_URL || "http://127.0.0.1:3101";
const states = ["ready", "quick-look", "priced", "booked", "assigned", "submitted", "completed", "cancel-requested", "cancelled", "empty", "loading", "error", "offline", "long", "photos-error", "status-gallery"];
for (const viewport of VIEWPORTS) test(`customer job panels and recovery states fit ${viewport.width}px`, async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize(viewport);
  for (const state of states) await test.step(state, async () => {
    const response = await page.goto(`${previewApp}/dev/components/customer-job?state=${state}`);
    expect(response?.status(), `${state} must be a real preview`).toBe(200);
    if (state === "loading") await expect(page.getByRole("status", { name: "Loading job", exact: true })).toBeVisible();
    else if (state === "error") await expect(page.getByRole("heading", { name: "Couldn’t load the job.", exact: true })).toBeVisible();
    else if (state === "status-gallery") {
      await expect(page.getByRole("heading", { name: "Sub wiring", exact: true })).toHaveCount(9);
      for (const status of ["REVIEW", "QUOTE_BOUNTY", "PRICED", "BOOKABLE", "ASSIGNED", "SUBMITTED", "COMPLETED", "CANCEL_REVIEW", "CANCELLED"]) await expect(page.locator(`[data-status="${status}"]`)).toHaveCount(1);
    }
    else await expect(page.getByRole("heading", { name: state === "long" ? "A very long job title with enough detail to wrap comfortably on a small phone" : "Sub wiring", exact: true })).toBeVisible();
    if (state === "cancelled") { await expect(page.getByText("This job was cancelled.", { exact: true })).toBeVisible(); await expect(page.getByRole("link", { name: "Time windows", exact: true })).toHaveCount(0); }
    if (state === "empty") { await expect(page.getByText("No photos yet.", { exact: true })).toBeVisible(); await expect(page.getByText("Time to be arranged", { exact: true })).toBeVisible(); }
    if (state === "offline") await expect(page.getByText("You’re offline.", { exact: true })).toBeVisible();
    if (state === "photos-error") await expect(page.getByText("Can’t load photos.", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Time windows", exact: true })).toHaveCount(["booked", "status-gallery"].includes(state) ? 1 : 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expectNoA11yViolations(page);
    if ([390, 1440].includes(viewport.width) && ["ready", "empty", "cancelled", "loading", "error", "offline", "photos-error", "status-gallery"].includes(state)) await page.screenshot({ path: `/tmp/122-${state}-${viewport.width}.png`, fullPage: true });
  });
});

test("customer photo viewer uses keyboard, restores focus and reaches real help", async ({ page }) => {
  const response = await page.goto(`${previewApp}/dev/components/customer-job`);
  expect(response?.status()).toBe(200);
  const photo = page.getByRole("button", { name: "Open photo 1 of 3: Sub wiring · 1", exact: true });
  await photo.focus(); await photo.press("Enter");
  const viewer = page.getByRole("dialog", { name: "Photos of Sub wiring", exact: true });
  await expect(viewer).toBeVisible(); await expectNoA11yViolations(page);
  await page.keyboard.press("ArrowRight"); await expect(viewer.getByText("2 of 3", { exact: true })).toBeVisible();
  await page.keyboard.press("ArrowLeft"); await expect(viewer.getByText("1 of 3", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape"); await expect(viewer).not.toBeVisible(); await expect(photo).toBeFocused();
  await page.getByRole("link", { name: "Need a hand?", exact: true }).press("Enter");
  await expect(page).toHaveURL(/\/help$/); await expect(page.getByRole("heading", { name: /How can we help/ })).toBeVisible();
  await page.goBack(); await expect(page.getByRole("heading", { name: "Sub wiring", exact: true })).toBeVisible();
});

test.describe("real owned customer job route", () => {
  test.skip(!app || !database, "requires the task-owned app, Auth/Storage double and disposable issue122 database");
  test.describe.configure({ mode: "serial" });
  let storage: Awaited<ReturnType<typeof startPhotoStorageStub>>, db: pg.Client;
  test.beforeAll(async () => {
    if (!["127.0.0.1", "localhost"].includes(new URL(app!).hostname) || new URL(database!).hostname !== "127.0.0.1" || new URL(database!).pathname !== "/issue122") throw new Error("Task-owned localhost app and issue122 database required");
    storage = await startPhotoStorageStub(54324);
    db = new pg.Client({ connectionString: database }); await db.connect();
    for (const user of [SECURITY_USER, SECURITY_TRADIE]) {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2) ON CONFLICT(id) DO NOTHING", [user.id, user.email]);
      await db.query("INSERT INTO profiles(id,email,role,first_name,email_verified_at,updated_at) VALUES($1,$2,'CUSTOMER','Customer frame',now(),now()) ON CONFLICT(id) DO UPDATE SET role='CUSTOMER',email_verified_at=now()", [user.id, user.email]);
    }
  });
  test.afterAll(async () => { await storage?.close(); await db?.end(); });
  async function fixture() {
    const id = randomUUID();
    await db.query("INSERT INTO jobs(id,customer_id,category,title,description,address_line1,suburb,city,status,any_time,updated_at) VALUES($1,$2,'OTHER','Move the couch','Move the couch upstairs.','1 Example Street','Gladstone','Invercargill','REVIEW',true,now())", [id, SECURITY_USER.id]);
    const path = `jobs/${id}/couch.webp`;
    storage.objects.set(`photos/${path}`, await sharp(await readFile("public/images/examples/wires.jpg")).webp().toBuffer());
    await db.query("INSERT INTO job_photos(job_id,path,position,uploaded_by_id) VALUES($1,$2,0,$3)", [id, path, SECURITY_USER.id]);
    return id;
  }
  async function login(page: Page, next: string, email = SECURITY_USER.email) {
    await page.goto(`${app}/login?next=${encodeURIComponent(next)}`);
    await page.getByLabel("Email", { exact: true }).fill(email); await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
  }
  test("Posted → read-only REVIEW → PRICED → editable BOOKABLE windows → Back → read-only cancellation", async ({ page }) => {
    test.setTimeout(90_000); await page.setViewportSize({ width: 390, height: 844 });
    const id = await fixture();
    await login(page, `/jobs/${id}?posted=1`);
    await expect(page.getByRole("heading", { name: "Posted.", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "View my job", exact: true }).press("Enter");
    await expect(page.getByRole("heading", { name: "Move the couch", exact: true })).toBeVisible();
    await expect(page.getByText("1 Example Street, Gladstone, Invercargill", { exact: true })).toBeVisible();
    await expect(page.getByText("Any time", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Time windows", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Open photo 1 of 1: Move the couch · 1", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Photos of Move the couch", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await db.query("UPDATE jobs SET status='PRICED',price_cents=17777 WHERE id=$1", [id]);
    await expect(page.locator('[data-status="PRICED"]')).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText("$177.77", { exact: true }).and(page.locator('[aria-hidden="true"]'))).toBeVisible();
    await expect(page.getByRole("link", { name: "Time windows", exact: true })).toHaveCount(0);
    await db.query("UPDATE jobs SET status='BOOKABLE' WHERE id=$1", [id]);
    await expect(page.locator('[data-status="BOOKABLE"]')).toBeVisible({ timeout: 25_000 });
    await page.getByRole("link", { name: "Time windows", exact: true }).press("Enter");
    await expect(page.getByRole("heading", { name: "When do you need it?", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Any time", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeEnabled();
    await page.getByRole("checkbox", { name: "ASAP: today if possible", exact: true }).check();
    await page.getByRole("button", { name: "Save changes", exact: true }).press("Enter");
    await expect.poll(async () => (await db.query("SELECT asap FROM jobs WHERE id=$1", [id])).rows[0].asap).toBe(true);
    await page.getByRole("link", { name: "Back", exact: true }).press("Enter");
    await expect(page).toHaveURL(`${app}/jobs/${id}?from=%2F`);
    await expect(page.getByRole("heading", { name: "Move the couch", exact: true })).toBeVisible();
    await expect(page.getByText("ASAP", { exact: true })).toBeVisible();
    await db.query("UPDATE jobs SET status='CANCELLED',updated_at=now() WHERE id=$1", [id]);
    await expect(page.getByText("This job was cancelled.", { exact: true })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByRole("link", { name: "Time windows", exact: true })).toHaveCount(0);
    await expectNoA11yViolations(page);
    await page.getByRole("main").getByRole("link", { name: "Home", exact: true }).press("Enter");
    await expect(page).toHaveURL(`${app}/`);
    await expect(page.getByRole("heading", { name: /Sorted in\s*a flash\./ })).toBeVisible();
  });
  test("foreign and missing jobs both return HTTP404 and expose no job details", async ({ page }) => {
    const id = await fixture(); await login(page, `/jobs/${id}?from=%2F`, SECURITY_TRADIE.email);
    await expect(page.getByRole("heading", { name: "Wrong address.", exact: true })).toBeVisible();
    for (const candidate of [id, randomUUID()]) {
      const response = await page.goto(`${app}/jobs/${candidate}?from=%2F`);
      expect(response?.status()).toBe(404); expect(await response!.text()).not.toMatch(/Move the couch|1 Example Street|priceCents|marginCents/);
      const revision = await page.request.get(`${app}/api/jobs/${candidate}/revision`);
      expect(revision.status()).toBe(404); expect(await revision.json()).toEqual({ error: "not-found" });
      expect(revision.headers()["cache-control"]).toBe("private, no-store");
    }
    await db.query("UPDATE profiles SET role='TRADIE' WHERE id=$1", [SECURITY_TRADIE.id]);
    const forbidden = await page.request.get(`${app}/api/jobs/${id}/revision`);
    expect(forbidden.status()).toBe(403); expect(await forbidden.json()).toEqual({ error: "forbidden" });
  });
  test("unchanged revision polls keep photo URLs, changed status refreshes, and TTL renewal is bounded", async ({ page, context, request }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.clock.install({ time: new Date() });
    const id = await fixture(), path = `/api/jobs/${id}/revision`;
    const anonymous = await request.get(`${app}${path}`);
    expect(anonymous.status()).toBe(401);
    expect(anonymous.headers()["cache-control"]).toBe("private, no-store");
    let imageGets = 0, polls = 0;
    page.on("request", request => { if (request.method() === "GET" && request.url().includes(`/object/sign/photos/jobs/${id}/`)) imageGets++; });
    page.on("response", response => { if (new URL(response.url()).pathname === path) polls++; });
    const signs = () => storage.events.filter(event => event.method === "POST" && event.path.includes(`/object/sign/photos/jobs/${id}/`)).length;
    await login(page, `/jobs/${id}`);
    await expect(page.getByRole("heading", { name: "Move the couch", exact: true })).toBeVisible();
    const image = page.locator('main ul img').first();
    await expect(image).toHaveJSProperty("complete", true);
    expect(await image.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await page.clock.pauseAt(new Date(Date.now() + 1_000));
    async function poll(ms = 15_000) {
      const response = page.waitForResponse(response => new URL(response.url()).pathname === path);
      await page.clock.runFor(ms);
      const result = await response;
      expect(result.status()).toBe(200);
      expect(Object.keys(await result.json()).sort()).toEqual(["revision", "status"]);
    }
    const original = await image.getAttribute("src"), initialSigns = signs(), initialGets = imageGets;
    for (let index = 0; index < 3; index++) await poll();
    expect(signs()).toBe(initialSigns); expect(imageGets).toBe(initialGets);
    await expect(image).toHaveAttribute("src", original!);

    await page.getByRole("button", { name: "Open photo 1 of 1: Move the couch · 1", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Photos of Move the couch", exact: true })).toBeVisible();
    const paused = polls; await page.clock.runFor(15_000); expect(polls).toBe(paused); expect(signs()).toBe(initialSigns);
    await page.keyboard.press("Escape");
    await page.evaluate(() => Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }));
    await page.clock.runFor(15_000); expect(polls).toBe(paused);
    await page.evaluate(() => Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }));
    await context.setOffline(true); await page.clock.runFor(15_000); expect(polls).toBe(paused);
    const resumed = page.waitForResponse(response => new URL(response.url()).pathname === path);
    await context.setOffline(false); await resumed;
    // The shared connection banner deliberately retries the page after reconnecting.
    await expect(image).not.toHaveAttribute("src", original!);
    await expect(image).toHaveJSProperty("complete", true);
    const recoveredSigns = signs(), recovered = await image.getAttribute("src");

    await db.query("UPDATE jobs SET status='PRICED',price_cents=17777 WHERE id=$1", [id]);
    await poll(); await expect(page.locator('[data-status="PRICED"]')).toBeVisible();
    await expect.poll(signs).toBe(recoveredSigns + 1);
    await expect(image).not.toHaveAttribute("src", recovered!);
    await expect(image).toHaveJSProperty("complete", true);
    await page.clock.runFor(1);
    const priced = await image.getAttribute("src"), pricedGets = imageGets;
    // The real signer reports 300 seconds. Check once near its conservative 270-second renewal boundary.
    let response = page.waitForResponse(response => new URL(response.url()).pathname === path);
    await page.clock.fastForward(240_000); await response;
    response = page.waitForResponse(response => new URL(response.url()).pathname === path);
    await page.clock.fastForward(25_000); await response;
    expect(signs()).toBe(recoveredSigns + 1); expect(imageGets).toBe(pricedGets);
    await page.clock.fastForward(6_000);
    await expect.poll(signs).toBe(recoveredSigns + 2);
    await expect(image).not.toHaveAttribute("src", priced!);
    await expect(image).toHaveJSProperty("complete", true);
    const renewedGets = imageGets;
    await poll(); expect(signs()).toBe(recoveredSigns + 2); expect(imageGets).toBe(renewedGets);

    await db.query("UPDATE jobs SET status='CANCELLED' WHERE id=$1", [id]);
    await poll(); await expect(page.getByText("This job was cancelled.", { exact: true })).toBeVisible();
    const terminalPolls = polls; await page.clock.fastForward(45_000);
    expect(polls).toBe(terminalPolls);
  });
});
