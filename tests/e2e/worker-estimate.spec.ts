import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { expectNoA11yViolations } from "./support/a11y";
import { SECURITY_PASSWORD, SECURITY_TRADIE, SECURITY_USER, startSecurityAuthStub } from "./support/security-auth-stub";
const preview = process.env.ESTIMATE_E2E_APP_URL || process.env.POSTED_PREVIEW_E2E_URL || "http://127.0.0.1:3101";
const states = ["ready", "drawer", "estimated", "not-eligible", "wrong-trade", "loading", "empty", "error", "load-error", "offline", "saving", "sent", "priced", "photo-error", "invalid", "edited", "eligibility-gallery", "estimate-gallery"];
test("estimate examples remain guarded on the ordinary production server", async ({ page }) => {
  expect((await page.goto("/dev/components/worker-estimate?state=ready"))?.status()).toBe(404);
});
for (const width of [320, 390, 768, 1024, 1440]) test(`estimate states at ${width}px`, async ({ page }) => {
  test.setTimeout(180_000); await page.setViewportSize({ width, height: 1000 });
  for (const state of states) await test.step(state, async () => {
    const response = await page.goto(`${preview}/dev/components/worker-estimate?state=${state}`); expect(response?.status()).toBe(200);
    if (state === "eligibility-gallery") {
      await expect(page.getByRole("heading", { name: "Quote eligibility", exact: true })).toBeVisible();
      await expect(page.getByText("Get verified to quote this job.", { exact: true })).toBeVisible(); await expect(page.getByText("This job needs a different trade.", { exact: true })).toBeVisible();
    } else if (state === "estimate-gallery") {
      await expect(page.getByRole("heading", { name: "Invalid quote", exact: true })).toBeVisible();
      for (const name of ["Already quoted", "Job edited", "Priced (read-only)"]) await expect(page.getByRole("region", { name, exact: true })).toBeVisible();
    } else if (state === "loading") await expect(page.getByRole("status", { name: "Loading job", exact: true })).toBeVisible();
    else if (state === "load-error") await expect(page.getByRole("heading", { name: "Couldn’t load this job", exact: true })).toBeVisible();
    else if (["drawer", "error", "offline", "saving", "invalid"].includes(state)) await expect(page.getByRole("complementary", { name: "Quote this job", exact: true })).toBeVisible();
    else await expect(page.getByRole("heading", { name: "Sub wiring", level: 1, exact: true })).toBeVisible();
    if (state === "not-eligible") await expect(page.getByText("Get verified to quote this job.", { exact: true })).toBeVisible();
    if (state === "wrong-trade") await expect(page.getByText("This job needs a different trade.", { exact: true })).toBeVisible();
    if (state === "error") await expect(page.getByText("Couldn’t save.", { exact: true })).toBeVisible();
    if (state === "ready") await expect(page.getByRole("button", { name: "Submit", exact: true })).toBeVisible();
    if (state === "estimated") { await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible(); await expect(page.getByRole("complementary", { name: "Your quote" })).toContainText("2.5 h"); }
    if (state === "offline") { const dialog = page.getByRole("complementary", { name: "Quote this job", exact: true }); await expect(dialog.getByText("You’re offline.", { exact: true })).toBeVisible(); await expect(dialog.getByRole("button", { name: "Submit", exact: true })).toHaveAttribute("aria-disabled", "true"); }
    if (state === "saving") await expect(page.getByRole("button", { name: /^Submit/ })).toHaveAttribute("aria-busy", "true");
    if (state === "sent") await expect(page.getByText("Quote sent. +1 point", { exact: true })).toBeVisible();
    if (state === "photo-error") await expect(page.getByText("Couldn’t load photos.", { exact: true })).toBeVisible();
    if (state === "invalid") await expect(page.getByLabel("Hours on site", { exact: true })).toHaveAttribute("aria-invalid", "true");
    if (state === "edited") { await expect(page.getByText("Job updated", { exact: true })).toBeVisible(); await expect(page.getByText("Check your quote and send it again.", { exact: false })).toBeVisible(); }
    if (state === "priced") { await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0); }
    if (state === "empty") await expect(page.getByText("No photos yet", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await expectNoA11yViolations(page);
    if (process.env.ESTIMATE_SCREENSHOTS_DIR && [390, 1440].includes(width)) await page.screenshot({ path: `${process.env.ESTIMATE_SCREENSHOTS_DIR}/${state}-${width}.png`, fullPage: true });
  });
});
test("quote from the job page: quick picks, keyboard half-hours, edit, and Back keeps the board filter", async ({ page }) => {
  await page.goto(`${preview}/dev/components/worker-estimate?state=ready`);
  const photo = page.getByRole("button", { name: "Open photo 1 of 3: Sub wiring", exact: true }); await photo.press("Enter");
  const viewer = page.getByRole("dialog", { name: "Photos of Sub wiring", exact: true }); await expect(viewer).toBeVisible(); await viewer.press("ArrowRight"); await expect(viewer.getByText("2 of 3", { exact: true })).toBeVisible();
  await viewer.press("Escape"); await expect(viewer).toHaveCount(0); await expect(photo).toBeFocused();
  const form = page.getByRole("complementary", { name: "Quote this job", exact: true }), hours = form.getByLabel("Hours on site", { exact: true });
  await form.getByText("4 h", { exact: true }).click(); await expect(hours).toHaveValue("4");
  await hours.fill("3"); await hours.press("ArrowRight"); await expect(hours).toHaveValue("3.5");
  await form.getByText("$50", { exact: true }).click(); await expect(form.getByLabel("Materials", { exact: true })).toHaveValue("50.00");
  await form.getByLabel("Materials", { exact: true }).fill("85");
  await form.getByLabel("Notes", { exact: true }).fill("A cooked switch");
  await form.getByRole("button", { name: "Submit", exact: true }).click(); await expect(form).toHaveCount(0);
  const quote = page.getByRole("complementary", { name: "Your quote", exact: true });
  await expect(quote).toContainText("3.5 h"); await expect(quote).toContainText("$85.00");
  await expect(page.getByText("Quote sent. +1 point · 13 points", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "12 points" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click(); await expect(hours).toHaveValue("3.5");
  await expect(form.getByLabel("Notes", { exact: true })).toHaveValue("A cooked switch");
  await form.getByRole("button", { name: "Cancel", exact: true }).click(); await expect(form).toHaveCount(0);
  await page.getByRole("link", { name: "Back to jobs", exact: true }).press("Enter");
  await expect(page.getByRole("heading", { name: "Jobs near you", exact: true })).toBeVisible(); await expect(page).toHaveURL(/kind=estimate/);
});

test("an edited job asks the worker to check and resend, then clears the stale guidance", async ({ page }) => {
  test.setTimeout(120_000);
  for (const width of [320, 390, 768, 1024, 1440]) for (const state of ["edited", "estimate-gallery"]) {
    await page.setViewportSize({ width, height: 1000 });
    expect((await page.goto(`${preview}/dev/components/worker-estimate?state=${state}`))?.status()).toBe(200);
    await expect(page.getByText("Check your quote and send it again.", { exact: false })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expectNoA11yViolations(page);
    if (process.env.ESTIMATE_SCREENSHOTS_DIR && [390, 1440].includes(width)) await page.screenshot({ path: `${process.env.ESTIMATE_SCREENSHOTS_DIR}/${state}-${width}.png`, fullPage: true });
  }
  await page.goto(`${preview}/dev/components/worker-estimate?state=edited`);
  await expect(page.getByText("Check your quote and send it again.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).press("Enter");
  const dialog = page.getByRole("complementary", { name: "Quote this job", exact: true });
  await expect(dialog.getByLabel("Hours on site", { exact: true })).toHaveValue("2.5");
  await dialog.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Check your quote and send it again.", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
});

test.describe("real blind estimate server action", () => {
  const app = process.env.ESTIMATE_E2E_APP_URL, database = process.env.ESTIMATE_E2E_DATABASE_URL;
  test.skip(!app || !database, "Requires a disposable localhost app/database and local Auth stub.");
  test.describe.configure({ mode: "serial", timeout: 120_000 }); test.use({ reducedMotion: "reduce" });
  let db: pg.Client, auth: Awaited<ReturnType<typeof startSecurityAuthStub>>;
  const office = "14200000-0000-4000-8000-000000000099", other = "14200000-0000-4000-8000-000000000088", job = "14200000-0000-4000-8000-000000000001";
  test.beforeAll(async () => {
    const url = new URL(database!); if (url.hostname !== "127.0.0.1" || url.pathname !== "/issue142" || url.search || url.hash || !["127.0.0.1", "localhost"].includes(new URL(app!).hostname)) throw Error("Estimate tests require dedicated localhost issue142 app/database.");
    auth = await startSecurityAuthStub(Number(process.env.ESTIMATE_E2E_AUTH_PORT ?? 54342)); db = new pg.Client({ connectionString: database }); await db.connect();
    for (const [id, email, role, name] of [[SECURITY_USER.id, SECURITY_USER.email, "CUSTOMER", "Sarah"], [SECURITY_TRADIE.id, SECURITY_TRADIE.email, "TRADIE", "Jack"], [office, "office-estimate@example.test", "ADMIN", "Office"], [other, "other-estimate@example.test", "TRADIE", "Other"]]) {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2) ON CONFLICT(id) DO NOTHING", [id, email]);
      await db.query("INSERT INTO profiles(id,email,role,first_name,email_verified_at,updated_at) VALUES($1,$2,$3,$4,now(),now()) ON CONFLICT(id) DO UPDATE SET role=excluded.role,first_name=excluded.first_name,email_verified_at=now()", [id, email, role, name]);
    }
    await db.query("INSERT INTO worker_profiles(user_id,identity_checked_at,identity_checked_by_id,base_suburb,area_lat,area_lng,area_radius_km,available,updated_at) VALUES($1,now(),$2,'Invercargill',-46.4132,168.3538,50,true,now()) ON CONFLICT(user_id) DO UPDATE SET identity_checked_at=now(),identity_checked_by_id=$2,paused_at=NULL,area_radius_km=50", [SECURITY_TRADIE.id, office]);
    await db.query("DELETE FROM jobs WHERE id=$1", [job]);
    await db.query("INSERT INTO jobs(id,customer_id,category,status,title,description,address_line1,suburb,city,lat,lng,approx_lat,approx_lng,any_time) VALUES($1,$2,'OTHER','REVIEW','Estimate real job','Move the couch upstairs.','142 Private Street','Windsor','Invercargill',-46.4132,168.3538,-46.4117,168.3538,true)", [job, SECURITY_USER.id]);
    await db.query("INSERT INTO estimates(job_id,worker_id,minutes,materials_cents,note) VALUES($1,$2,300,19999,'Someone else private estimate')", [job, other]);
  });
  test.afterAll(async () => { await auth?.close(); await db?.end(); });
  async function login(page: Page) {
    await page.goto(`${app}/login?next=${encodeURIComponent(`/jobs/${job}?from=${encodeURIComponent("/jobs?kind=estimate")}`)}`);
    await page.getByLabel("Email", { exact: true }).fill(SECURITY_TRADIE.email); await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD); await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Estimate real job", exact: true })).toBeVisible();
  }
  test("verified worker saves, edits and sees only their own numbers; Back preserves the board filter", async ({ page }) => {
    await login(page); expect(await page.locator("main").innerText()).not.toMatch(/Private Street|199\.99|Someone else private/);
    const dialog = page.getByRole("complementary", { name: "Quote this job", exact: true });
    await dialog.getByLabel("Hours on site", { exact: true }).fill("3.5"); await dialog.getByLabel("Materials", { exact: true }).fill("85");
    await dialog.getByRole("button", { name: "Submit", exact: true }).click(); await expect(dialog).toHaveCount(0); await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
    expect((await db.query("SELECT minutes,materials_cents FROM estimates WHERE job_id=$1 AND worker_id=$2", [job, SECURITY_TRADIE.id])).rows[0]).toEqual({ minutes: 210, materials_cents: 8500 });
    await page.reload(); await page.getByRole("button", { name: "Edit", exact: true }).press("Enter"); await expect(dialog.getByLabel("Hours on site", { exact: true })).toHaveValue("3.5");
    await dialog.getByLabel("Hours on site", { exact: true }).press("ArrowUp"); await dialog.getByRole("button", { name: "Submit", exact: true }).click(); await expect(dialog).toHaveCount(0);
    expect((await db.query("SELECT count(*)::int AS count FROM estimates WHERE job_id=$1 AND worker_id=$2", [job, SECURITY_TRADIE.id])).rows[0].count).toBe(1);
    await page.getByRole("link", { name: "Back to jobs", exact: true }).press("Enter"); await expect(page.getByRole("heading", { name: "Jobs near you", exact: true })).toBeVisible(); await expect(page).toHaveURL(/kind=estimate/);
    await page.getByRole("link", { name: "Estimate real job", exact: true }).press("Enter"); await expect(page.getByRole("heading", { name: "Estimate real job", exact: true })).toBeVisible();
  });
  test("eligibility changes while the quote form is open refuse writes with the current reason", async ({ page }) => {
    await login(page); await page.getByRole("button", { name: "Edit", exact: true }).click();
    await db.query("UPDATE worker_profiles SET paused_at=now() WHERE user_id=$1", [SECURITY_TRADIE.id]);
    try {
      await page.getByRole("button", { name: "Submit", exact: true }).click(); await expect(page.getByText("Your account is paused. Contact the office.", { exact: true })).toBeVisible();
      await expect(page.getByRole("complementary", { name: "Quote this job", exact: true })).toHaveCount(0); await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
    } finally { await db.query("UPDATE worker_profiles SET paused_at=NULL WHERE user_id=$1", [SECURITY_TRADIE.id]); }
  });
  test("a foreign assignment and missing job retain an actual404 before any private detail streams", async ({ page }) => {
    await login(page);
    await db.query("UPDATE jobs SET status='ASSIGNED',worker_id=$2,price_cents=12000 WHERE id=$1", [job, other]);
    try {
      const response = await page.goto(`${app}/jobs/${job}`); expect(response?.status()).toBe(404);
      expect(await page.locator("main").innerText()).not.toMatch(/Estimate real job|Private Street|Sarah|Your quote/);
      expect((await page.goto(`${app}/jobs/14200000-0000-4000-8000-000000000404`))?.status()).toBe(404);
    } finally { await db.query("UPDATE jobs SET status='REVIEW',worker_id=NULL WHERE id=$1", [job]); }
  });
});
