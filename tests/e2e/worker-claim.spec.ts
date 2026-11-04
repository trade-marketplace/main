import { expect, test, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import pg from "pg";
import { expectNoA11yViolations } from "./support/a11y";
import { SECURITY_PASSWORD, SECURITY_TRADIE, SECURITY_USER, startSecurityAuthStub } from "./support/security-auth-stub";
const preview = process.env.CLAIM_E2E_APP_URL || process.env.POSTED_PREVIEW_E2E_URL || "http://127.0.0.1:3101";
const states = ["ready", "confirm", "success", "lost", "loading", "empty", "photo-error", "error", "offline", "saving", "load-error", "not-eligible", "wrong-trade", "paused", "licence", "eligibility-gallery"];
test("claim examples retain the ordinary production 404 guard", async ({ page }) => { expect((await page.goto("/dev/components/worker-claim?state=ready"))?.status()).toBe(404); });
for (const width of [320, 390, 768, 1024, 1440]) test(`claim states at ${width}px`, async ({ page }) => {
  test.setTimeout(180_000); await page.setViewportSize({ width, height: 1000 });
  for (const state of states.filter(value => value !== "eligibility-gallery")) await test.step(state, async () => {
    expect((await page.goto(`${preview}/dev/components/worker-claim?state=${state}`))?.status()).toBe(200);
    if (state === "loading") await expect(page.getByRole("status", { name: "Loading job", exact: true })).toBeVisible();
    else if (state === "load-error") await expect(page.getByRole("heading", { name: "Couldn’t load this job", exact: true })).toBeVisible();
    else if (state === "eligibility-gallery") { await expect(page.getByRole("heading", { name: "Claim eligibility", exact: true })).toBeVisible(); await expect(page.getByRole("region", { name: "Messages", exact: true }).getByRole("link", { name: "Back", exact: true })).toBeVisible(); }
    else if (["confirm", "error", "offline", "saving"].includes(state)) await expect(page.getByRole("alertdialog", { name: "Take this job?", exact: true })).toBeVisible();
    else if (state === "success") await expect(page.getByRole("dialog", { name: "It’s yours.", exact: true })).toBeVisible();
    else await expect(page.getByRole("heading", { name: "Sub wiring", level: 1, exact: true })).toBeVisible();
    if (state === "ready") {
      await expect(page.getByText("$189.00", { exact: true }).last()).toBeVisible(); await expect(page.getByRole("button", { name: "Claim job", exact: true })).toBeVisible(); expect(await page.locator("main").innerText()).not.toMatch(/372\.00|Thompson|1 Example Street|0210000001/);
      if (width >= 900) {
        const photos = page.getByRole("button", { name: /^Open photo [123] of 3:/ });
        const [cover, second, third] = await Promise.all([photos.nth(0).boundingBox(), photos.nth(1).boundingBox(), photos.nth(2).boundingBox()]);
        expect(cover).not.toBeNull(); expect(second).not.toBeNull(); expect(third).not.toBeNull();
        expect(second!.x).toBeGreaterThan(cover!.x + cover!.width); expect(second!.y).toBe(cover!.y); expect(third!.x).toBe(second!.x); expect(third!.y + third!.height).toBe(cover!.y + cover!.height);
      }
    }
    if (["confirm", "error", "offline", "saving"].includes(state)) await expect(page.getByText("Once it’s yours, pick a customer time window. Their address unlocks after you claim.", { exact: true })).toBeVisible();
    if (state === "success") await expect(page.getByText("Book one of the customer’s time windows", { exact: true })).toBeVisible();
    if (state === "lost") { await expect(page.getByText("Too slow. Someone else got this one.", { exact: false })).toBeVisible(); await expect(page.getByRole("button", { name: "Claim job", exact: true })).toHaveAttribute("aria-disabled", "true"); }
    if (state === "not-eligible") await expect(page.getByText("Get verified to claim this job.", { exact: true })).toBeVisible();
    if (state === "wrong-trade") await expect(page.getByText("This job needs a different trade.", { exact: true })).toBeVisible();
    if (state === "paused") await expect(page.getByText("Your account is paused. Contact the office.", { exact: true })).toBeVisible();
    if (state === "licence") await expect(page.getByText("You need a current, checked licence for this trade.", { exact: true })).toBeVisible();
    if (state === "empty") await expect(page.getByText("No photos yet", { exact: true })).toBeVisible();
    if (state === "photo-error") await expect(page.getByText("Couldn’t load photos.", { exact: true })).toBeVisible();
    if (state === "error") await expect(page.getByText("Couldn’t claim this job. Try again.", { exact: true })).toBeVisible();
    if (state === "saving") await expect(page.getByRole("button", { name: /^Yes, it’s mine/ })).toHaveAttribute("aria-busy", "true");
    if (state === "offline") await expect(page.getByRole("button", { name: "Yes, it’s mine", exact: true })).toHaveAttribute("aria-disabled", "true");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await expectNoA11yViolations(page);
    if (process.env.CLAIM_SCREENSHOTS_DIR && [390, 1440].includes(width)) await page.screenshot({ path: `${process.env.CLAIM_SCREENSHOTS_DIR}/${state}-${width}.png`, fullPage: true });
  });
});
test("claim return composite fits every width and exposes the existing Messages Back action", async ({ page }) => {
  test.setTimeout(120_000);
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect((await page.goto(`${preview}/dev/components/worker-claim?state=eligibility-gallery`))?.status()).toBe(200);
    await expect(page.getByRole("main")).toHaveCount(1); await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "Claim eligibility", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Messages", exact: true }).getByRole("link", { name: "Back", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await expectNoA11yViolations(page);
    if (process.env.CLAIM_SCREENSHOTS_DIR && [390, 1440].includes(width)) await page.screenshot({ path: `${process.env.CLAIM_SCREENSHOTS_DIR}/eligibility-gallery-${width}.png`, fullPage: true });
  }
});
test("keyboard claim confirmation can cancel, claim, open the unlocked job and follow Messages/Back", async ({ page }) => {
  await page.goto(`${preview}/dev/components/worker-claim?state=ready`);
  const trigger = page.getByRole("button", { name: "Claim job", exact: true }); await trigger.press("Enter");
  const confirm = page.getByRole("alertdialog", { name: "Take this job?", exact: true }); await expect(confirm).toBeVisible();
  await confirm.press("Escape"); await expect(confirm).toHaveCount(0); await expect(trigger).toBeFocused();
  await trigger.press("Enter"); await confirm.getByRole("button", { name: "Yes, it’s mine", exact: true }).press("Enter");
  const success = page.getByRole("dialog", { name: "It’s yours.", exact: true }); await expect(success).toBeVisible(); await expect(page.locator("dialog[open]")).toHaveCount(1);
  await success.getByRole("button", { name: "Open job", exact: true }).press("Enter"); await expect(success).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Customer contact", exact: true })).toContainText("1 Example Street");
  await expect(page.getByRole("heading", { name: "Address", exact: true })).toBeFocused();
  await expect(page.getByRole("heading", { name: "Address", exact: true })).toBeInViewport();
  await page.goto(`${preview}/dev/components/worker-claim?state=success`); await page.getByRole("dialog", { name: "It’s yours.", exact: true }).getByRole("link", { name: "Message Sarah", exact: true }).press("Enter");
  await expect(page).toHaveURL(/problem-threads.*mode=trade/); await expect(page.getByRole("heading", { name: "Messages", exact: true })).toBeVisible();
  await page.goBack(); await expect(page.getByRole("dialog", { name: "It’s yours.", exact: true })).toBeVisible();
  await page.getByRole("dialog").press("Escape"); await expect(page.locator("dialog[open]")).toHaveCount(0);
  await page.getByRole("link", { name: "Back to jobs", exact: true }).press("Enter"); await expect(page).toHaveURL(/kind=ready/); await expect(page.getByRole("heading", { name: "Jobs near you", exact: true })).toBeVisible();
});
test("a lost claim follows See similar jobs to the actual filtered board", async ({ page }) => {
  await page.goto(`${preview}/dev/components/worker-claim?state=lost`); await page.getByRole("link", { name: "See similar jobs", exact: true }).press("Enter");
  await expect(page).toHaveURL(/kind=ready/); await expect(page.getByRole("heading", { name: "Jobs near you", exact: true })).toBeVisible();
});

test.describe("real claim server action", () => {
  const app = process.env.CLAIM_E2E_APP_URL, database = process.env.CLAIM_E2E_DATABASE_URL;
  test.skip(!app || !database, "Requires the dedicated localhost issue144 app/database and fake Auth.");
  test.describe.configure({ mode: "serial", timeout: 120_000 }); test.use({ reducedMotion: "reduce" });
  let db: pg.Client, auth: Awaited<ReturnType<typeof startSecurityAuthStub>>;
  const office = "14400000-0000-4000-8000-000000000099", other = "14400000-0000-4000-8000-000000000088", job = randomUUID();
  test.beforeAll(async () => {
    const url = new URL(database!); if (url.hostname !== "127.0.0.1" || url.pathname !== "/issue144" || url.search || url.hash || !["127.0.0.1", "localhost"].includes(new URL(app!).hostname)) throw Error("Claim fixture requires dedicated localhost issue144 app/database.");
    auth = await startSecurityAuthStub(Number(process.env.CLAIM_E2E_AUTH_PORT ?? 54330)); db = new pg.Client({ connectionString: database }); await db.connect();
    for (const [id, email, role, name] of [[SECURITY_USER.id, SECURITY_USER.email, "CUSTOMER", "Sarah"], [SECURITY_TRADIE.id, SECURITY_TRADIE.email, "TRADIE", "Jack"], [office, "office-claim@example.test", "ADMIN", "Office"], [other, "other-claim@example.test", "TRADIE", "Other"]]) {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2) ON CONFLICT(id) DO NOTHING", [id, email]);
      await db.query("INSERT INTO profiles(id,email,role,first_name,email_verified_at,updated_at) VALUES($1,$2,$3,$4,now(),now()) ON CONFLICT(id) DO UPDATE SET role=excluded.role,first_name=excluded.first_name,email_verified_at=now()", [id, email, role, name]);
    }
    await db.query("INSERT INTO worker_profiles(user_id,identity_checked_at,identity_checked_by_id,base_suburb,area_lat,area_lng,area_radius_km,available,updated_at) VALUES($1,now(),$2,'Invercargill',-46.4132,168.3538,50,true,now()) ON CONFLICT(user_id) DO UPDATE SET identity_checked_at=now(),identity_checked_by_id=$2,paused_at=NULL,area_radius_km=50", [SECURITY_TRADIE.id, office]);
    await db.query("DELETE FROM jobs WHERE id=$1", [job]);
    await db.query("INSERT INTO jobs(id,customer_id,category,status,title,description,address_line1,suburb,city,lat,lng,approx_lat,approx_lng,any_time) VALUES($1,$2,'OTHER','REVIEW','Claim real job','Move the couch upstairs.','144 Private Street','Windsor','Invercargill',-46.4132,168.3538,-46.4117,168.3538,true)", [job, SECURITY_USER.id]);
    // Use the actual pricing command under its server-only condition; the browser runner never imports server modules.
    await promisify(execFile)(process.execPath, ["--conditions=react-server", "--import", "tsx", "--input-type=module", "-e",
      `import { createDatabaseClient } from './src/server/database-client.ts'; import { priceJob } from './src/server/pricing/price-job.ts'; const db = createDatabaseClient(process.env.CLAIM_E2E_DATABASE_URL); try { await priceJob(db, { jobId: '${job}', minutes: 120, materialsCents: 8500, pricedById: '${office}' }); } finally { await db.$disconnect(); }`]);
    await db.query("UPDATE jobs SET status='BOOKABLE' WHERE id=$1", [job]);
  });
  test.afterAll(async () => { await auth?.close(); await db?.end(); });
  async function login(page: Page) {
    await page.goto(`${app}/login?next=${encodeURIComponent(`/jobs/${job}?from=${encodeURIComponent("/jobs?kind=ready")}`)}`);
    await page.getByLabel("Email", { exact: true }).fill(SECURITY_TRADIE.email); await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD); await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Claim real job", exact: true })).toBeVisible();
  }
  test("a verified worker confirms real frozen numbers, claims, opens the private job and follows Messages", async ({ page }) => {
    await login(page); expect(await page.locator("main").innerText()).not.toContain("144 Private Street");
    const pricing = (await db.query("SELECT worker_gross_cents + holiday_pay_cents AS earn FROM job_pricing WHERE job_id=$1", [job])).rows[0];
    const earn = new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(pricing.earn / 100);
    await expect(page.getByText(earn, { exact: true }).and(page.locator('[aria-hidden="true"]'))).toBeVisible();
    await page.getByRole("button", { name: "Claim job", exact: true }).press("Enter");
    const confirm = page.getByRole("alertdialog", { name: "Take this job?", exact: true });
    await confirm.getByRole("button", { name: "Yes, it’s mine", exact: true }).press("Enter");
    const success = page.getByRole("dialog", { name: "It’s yours.", exact: true }); await expect(success).toBeVisible();
    expect((await db.query("SELECT status,worker_id FROM jobs WHERE id=$1", [job])).rows[0]).toEqual({ status: "ASSIGNED", worker_id: SECURITY_TRADIE.id });
    await success.getByRole("button", { name: "Open job", exact: true }).press("Enter"); await expect(page.locator("dialog[open]")).toHaveCount(0); await expect(page.getByRole("region", { name: "Customer contact", exact: true })).toContainText("144 Private Street");
    await expect(page.getByRole("region", { name: "Customer contact", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Address", exact: true })).toBeInViewport();
    await page.reload();
    await expect(page.getByRole("region", { name: "Customer contact", exact: true })).toContainText("144 Private Street");
    await expect(page.getByText(earn, { exact: true }).and(page.locator('[aria-hidden="true"]'))).toBeVisible();
    await expect(page.getByText("$85.00", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Claim job", exact: true })).toHaveCount(0);
    await page.getByRole("region", { name: "Customer contact", exact: true }).getByRole("link", { name: "Message Sarah", exact: true }).press("Enter");
    await expect(page).toHaveURL(new RegExp(`/messages\\?job=${job}`)); await expect(page.getByRole("heading", { name: "Messages", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Back", exact: true }).click();
    await expect(page.getByRole("region", { name: "Customer contact", exact: true })).toContainText("144 Private Street");
    await expect(page.getByRole("button", { name: "Claim job", exact: true })).toHaveCount(0);
    expect((await db.query("SELECT count(*)::int AS count FROM audit_log WHERE record_id=$1 AND action='job.claimed'", [job])).rows[0].count).toBe(1);
    await page.getByRole("link", { name: "Back to jobs", exact: true }).press("Enter"); await expect(page).toHaveURL(/kind=ready/); await expect(page.getByRole("heading", { name: "Jobs near you", exact: true })).toBeVisible();
  });
  test("a worker losing eligibility after opening confirmation is refused without assigning the job", async ({ page }) => {
    await db.query("UPDATE jobs SET status='BOOKABLE',worker_id=NULL WHERE id=$1", [job]);
    await login(page); await page.getByRole("button", { name: "Claim job", exact: true }).click(); await db.query("UPDATE worker_profiles SET paused_at=now() WHERE user_id=$1", [SECURITY_TRADIE.id]);
    try { await page.getByRole("button", { name: "Yes, it’s mine", exact: true }).click(); await expect(page.getByRole("alert").filter({ hasText: "Your account is paused. Contact the office." })).toBeVisible(); expect((await db.query("SELECT worker_id FROM jobs WHERE id=$1", [job])).rows[0].worker_id).toBeNull(); }
    finally { await db.query("UPDATE worker_profiles SET paused_at=NULL WHERE user_id=$1", [SECURITY_TRADIE.id]); }
  });
  test("a claim taken while confirmation is open shows Too slow without leaking the winner", async ({ page }) => {
    await login(page); await page.getByRole("button", { name: "Claim job", exact: true }).click(); await db.query("UPDATE jobs SET status='ASSIGNED',worker_id=$2 WHERE id=$1", [job, other]);
    await page.getByRole("button", { name: "Yes, it’s mine", exact: true }).click(); await expect(page.getByText("Too slow. Someone else got this one.", { exact: false })).toBeVisible();
    expect(await page.locator("main").innerText()).not.toContain("144 Private Street");
    await page.getByRole("link", { name: "See similar jobs", exact: true }).press("Enter"); await expect(page).toHaveURL(/kind=ready/); await expect(page.getByRole("heading", { name: "Jobs near you", exact: true })).toBeVisible();
    for (const id of [job, "14400000-0000-4000-8000-000000000fff"]) {
      const denied = await page.request.get(`${app}/jobs/${id}`); expect(denied.status()).toBe(404);
      expect(await denied.text()).not.toMatch(/Claim real job|144 Private Street/);
    }
  });
});
