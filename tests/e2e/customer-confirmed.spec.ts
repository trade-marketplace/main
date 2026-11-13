import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { startAuthStub, sessionCookies } from "../../scripts/screenshots/auth-stub";
import { expectNoA11yViolations } from "./support/a11y";
import { waitForPageSettled } from "./support/page-settled";
import { VIEWPORTS } from "./support/viewports";

const preview = process.env.CUSTOMER_CONFIRMED_PREVIEW_URL || process.env.POSTED_PREVIEW_E2E_URL || "http://127.0.0.1:3101";
const states = ["finding", "confirmed", "booked", "updates", "running-late", "asked-for-times", "no-photo", "no-reviews", "other-trade", "card-unavailable", "loading", "empty", "error", "offline", "photo-error", "recovery"];
test.use({ reducedMotion: "reduce" });
test("confirmed previews remain guarded on the normal production app", async ({ request, baseURL }) => {
  expect((await request.get(`${baseURL}/dev/components/customer-confirmed`)).status()).toBe(404);
});
for (const viewport of VIEWPORTS) test(`confirmed states fit ${viewport.width}px and pass axe`, async ({ page }) => {
  test.setTimeout(240_000); await page.setViewportSize(viewport);
  for (const state of states) await test.step(state, async () => {
    expect((await page.goto(`${preview}/dev/components/customer-confirmed?state=${state}`))?.status()).toBe(200);
    if (state === "loading") await expect(page.getByRole("status", { name: "Loading job", exact: true })).toBeVisible();
    else if (state === "error") await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
    else if (state === "finding") await expect(page.getByRole("heading", { name: "We’re finding someone", exact: true })).toBeVisible();
    else if (state !== "recovery") {
      await expect(page.getByRole("heading", { name: "Jack W", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Call Jack", exact: true })).toHaveAttribute("href", "tel:0210000002");
      await expect(page.getByRole("main")).not.toContainText("Wilson");
      if (state === "no-photo" || state === "photo-error") await expect(page.getByText("JW", { exact: true })).toBeVisible();
      if (state === "no-reviews") await expect(page.getByText("4.9 (32)", { exact: true })).toHaveCount(0);
      if (state === "other-trade") await expect(page.getByText("Licensed electrician", { exact: true })).toHaveCount(0);
      if (state === "confirmed") await expect(page.getByText("Jack will book one of your times.", { exact: true })).toBeVisible();
      if (state === "booked") await expect(page.getByText(/Jack’s booked in/)).toBeVisible();
      if (state === "updates") await expect(page.getByRole("list", { name: "Job updates", exact: true }).getByRole("listitem")).toHaveCount(3);
      if (state === "running-late") await expect(page.getByText("Running late · 30 min", { exact: true })).toBeVisible();
      if (state === "asked-for-times") await expect(page.getByRole("link", { name: "Add times", exact: true })).toBeVisible();
      if (state === "card-unavailable") await expect(page.getByText(/Jack’s booked in/)).toHaveCount(0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expectNoA11yViolations(page);
    if ([390, 1440].includes(viewport.width)) await page.screenshot({ path: test.info().outputPath(`${state}-${viewport.width}.png`), fullPage: true });
  });
});

test("Add times opens the existing windows view and Back returns to the request", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${preview}/dev/components/customer-confirmed?state=asked-for-times`);
  await page.getByRole("link", { name: "Add times", exact: true }).press("Enter");
  await expect(page.getByRole("heading", { name: "When do you need it?", exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "ASAP: today if possible", exact: true }).check();
  // Saved appears before router.refresh finishes streaming its replacement metadata.
  const refreshed = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === "/dev/components/customer-confirmed" && url.searchParams.get("state") === "windows" &&
      response.request().method() === "GET" && response.request().headers()["rsc"] === "1" &&
      !response.request().headers()["next-router-prefetch"];
  });
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  const response = await refreshed;
  expect(response.ok()).toBe(true);
  await waitForPageSettled(page, "Tradie confirmed (dev) | Trade Marketplace");
  await expectNoA11yViolations(page);
  await page.getByRole("link", { name: "Back", exact: true }).click();
  await expect(page.getByText("Jack asked for other times.", { exact: true })).toBeVisible();
  await waitForPageSettled(page, "Tradie confirmed (dev) | Trade Marketplace");
  await expectNoA11yViolations(page);
});

test("an avatar that fails before hydration still becomes initials", async ({ page }) => {
  let release!: () => void;
  const hydration = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/*.js", async route => { await hydration; await route.continue(); });
  try {
    await page.goto(`${preview}/dev/components/customer-confirmed?state=photo-error`, { waitUntil: "commit" });
    await expect.poll(() => page.locator('img[src="/images/confirmed-avatar-missing.jpg"]').evaluate(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth === 0)).toBe(true);
  } finally { release(); }
  await page.waitForLoadState("domcontentloaded");
  await expect(page.getByText("JW", { exact: true })).toBeVisible();
  await expectNoA11yViolations(page);
});

const app = process.env.CUSTOMER_CONFIRMED_E2E_APP_URL, database = process.env.CUSTOMER_CONFIRMED_E2E_DATABASE_URL;
const runFixture = promisify(execFile);
test.describe("real customer confirmed job", () => {
  test.skip(!app || !database, "requires isolated local app and lane_a_127 database");
  test.describe.configure({ mode: "serial" });
  let db: pg.Client, auth: Awaited<ReturnType<typeof startAuthStub>>;
  const secret = randomUUID(), customer = { id: randomUUID(), email: `${randomUUID()}@example.test` }, worker = { id: randomUUID(), email: `${randomUUID()}@example.test` };
  test.beforeAll(async () => {
    const target = new URL(database!), host = new URL(app!);
    if (target.hostname !== "127.0.0.1" || target.pathname !== "/lane_a_127" || target.search || host.hostname !== "127.0.0.1") throw Error("Dedicated local Lane A fixtures required");
    auth = await startAuthStub(secret, 54510); db = new pg.Client({ connectionString: database }); await db.connect();
    for (const [person, role, first, last, phone] of [[customer, "CUSTOMER", "Sarah", "Thompson", null], [worker, "TRADIE", "Jack", "Wilson", "+64210000002"]] as const) {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [person.id, person.email]);
      await db.query("INSERT INTO profiles(id,email,role,first_name,last_name,phone,email_verified_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,now(),now())", [person.id, person.email, role, first, last, phone]);
    }
  });
  test.afterAll(async () => { await db?.end(); if (auth) await new Promise<void>(resolve => auth.close(() => resolve())); });
  const create = async (assigned: boolean) => {
    const id = randomUUID(); await db.query("INSERT INTO jobs(id,customer_id,category,status,price_cents,title,description,address_line1,suburb,city,any_time,updated_at) VALUES($1,$2,'OTHER','BOOKABLE',10000,'Confirmed journey','Move the couch upstairs.','1 Example Street','Windsor','Invercargill',true,now())", [id, customer.id]);
    if (assigned) {
      await db.query("BEGIN");
      try {
        await db.query("SELECT set_config('app.actor_id',$1,true)", [worker.id]);
        await db.query("UPDATE jobs SET status='ASSIGNED',worker_id=$1 WHERE id=$2", [worker.id, id]);
        await db.query("INSERT INTO audit_log(id,actor_id,action,record_type,record_id,before,after) VALUES($1,$2,'job.claimed','jobs',$3,$4,$5)", [randomUUID(), worker.id, id, JSON.stringify({ workerId: null, status: "BOOKABLE" }), JSON.stringify({ workerId: worker.id, status: "ASSIGNED" })]);
        await db.query("COMMIT");
      } catch (error) { await db.query("ROLLBACK"); throw error; }
    }
    return id;
  };
  const sendUpdate = async (jobId: string, type: string, payload: Record<string, string | number> = {}) => {
    await runFixture(process.execPath, ["--conditions=react-server", "--import", "tsx", "--input-type=module", "-e", `
      import { createDatabaseClient } from './src/server/database-client.ts';
      import { createNotify } from './src/server/notifications/notify.ts';
      const target = new URL(process.env.CUSTOMER_CONFIRMED_E2E_DATABASE_URL);
      if (target.hostname !== '127.0.0.1' || target.pathname !== '/lane_a_127' || target.search) throw Error('Local Lane A fixtures only');
      const client = createDatabaseClient(target.href);
      try { await client.$transaction(async tx => {
        const [jobId, type, rawPayload, workerId, customerId] = process.argv.slice(1);
        const action = type === 'job.reschedule_requested' ? 'job.times_requested' : type;
        const audit = await tx.auditLog.create({ data: { actorId: workerId, action, recordType: 'jobs', recordId: jobId, after: { sent: true } } });
        await createNotify(tx)(type, [customerId], { eventId: action + ':' + audit.id, payload: { jobId, ...JSON.parse(rawPayload) } });
      }); } finally { await client.$disconnect(); }
    `, jobId, type, JSON.stringify(payload), worker.id, customer.id], { cwd: process.cwd(), env: process.env });
  };
  test("owned updates refresh without a revision change; assigned Add times saves choices and preserves its return", async ({ page, context }) => {
    test.setTimeout(60_000);
    await context.addCookies(await sessionCookies(customer, secret, app!, "http://127.0.0.1:54510"));
    const id = await create(true), path = `/jobs/${id}?from=%2Fdashboard%3Fq%3Dconfirmed%26page%3D2`;
    await page.goto(`${app}${path}`);
    await expect(page.getByRole("heading", { name: "Jack W", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Call Jack", exact: true })).toHaveAttribute("href", "tel:+64210000002");
    const revision = (await db.query("SELECT updated_at FROM jobs WHERE id=$1", [id])).rows[0].updated_at;
    await sendUpdate(id, "job.running_late", { lateMinutes: 30 });
    await expect(page.getByText("Running late · 30 min", { exact: true })).toBeVisible({ timeout: 25_000 });
    expect((await db.query("SELECT updated_at FROM jobs WHERE id=$1", [id])).rows[0].updated_at).toEqual(revision);
    await sendUpdate(id, "job.reschedule_requested");
    await page.reload();
    await page.getByRole("link", { name: "Add times", exact: true }).click();
    await expect(page).toHaveURL(`${app}/jobs/${id}/windows?from=${encodeURIComponent(path)}`);
    await expect(page.getByRole("heading", { name: "When do you need it?", exact: true })).toBeVisible();
    const save = page.getByRole("button", { name: "Save changes", exact: true });
    await expect(save).toBeEnabled();
    await page.getByRole("checkbox", { name: "ASAP: today if possible", exact: true }).check();
    await save.click();
    await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
    expect((await db.query("SELECT asap,status,worker_id FROM jobs WHERE id=$1", [id])).rows[0]).toEqual({ asap: true, status: "ASSIGNED", worker_id: worker.id });
    expect(Number((await db.query("SELECT count(*) FROM audit_log WHERE action='job.windows_updated' AND record_type='jobs' AND record_id=$1 AND actor_id=$2", [id, customer.id])).rows[0].count)).toBe(1);
    await expectNoA11yViolations(page);
    await page.getByRole("link", { name: "Back", exact: true }).click(); await expect(page).toHaveURL(`${app}${path}`);
    await expect(page.getByText("Jack asked for other times.", { exact: true })).toBeVisible();
    // The current contract allows ASSIGNED edits; retain a genuine terminal read-only check as well.
    const closed = randomUUID();
    await db.query("INSERT INTO jobs(id,customer_id,category,status,price_cents,title,description,address_line1,suburb,city,any_time,updated_at) VALUES($1,$2,'OTHER','CANCELLED',10000,'Read-only windows','Closed fixture.','1 Example Street','Windsor','Invercargill',true,now())", [closed, customer.id]);
    await page.goto(`${app}/jobs/${closed}/windows`);
    await expect(page.getByRole("heading", { name: "When do you need it?", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save changes", exact: true })).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByRole("checkbox", { name: "ASAP: today if possible", exact: true })).toBeDisabled();
    await expectNoA11yViolations(page);
  });
  test("finding someone still reaches the editable BOOKABLE windows journey and Back", async ({ page, context }) => {
    await context.addCookies(await sessionCookies(customer, secret, app!, "http://127.0.0.1:54510"));
    const id = await create(false), path = `/jobs/${id}?from=%2Fdashboard`;
    await page.goto(`${app}${path}`);
    await expect(page.getByRole("heading", { name: "We’re finding someone", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Time windows", exact: true }).click();
    await page.getByRole("checkbox", { name: "ASAP: today if possible", exact: true }).check();
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
    expect((await db.query("SELECT asap FROM jobs WHERE id=$1", [id])).rows[0].asap).toBe(true);
    await page.getByRole("link", { name: "Back", exact: true }).click(); await expect(page).toHaveURL(`${app}${path}`);
  });
});
