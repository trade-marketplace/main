import { expect, test } from "@playwright/test";
import pg from "pg";

import { expectNoA11yViolations } from "./support/a11y";
import { SECURITY_PASSWORD, SECURITY_TRADIE, startSecurityAuthStub } from "./support/security-auth-stub";
import { VIEWPORTS } from "./support/viewports";

const preview = process.env.PAYROLL_RETRY_PREVIEW_URL || process.env.POSTED_PREVIEW_E2E_URL || "http://127.0.0.1:3101";
const app = process.env.PAYROLL_RETRY_APP_URL;
const database = process.env.PAYROLL_RETRY_DATABASE_URL;
const back = "/jobs?kind=bounty&distance=10";
const destination = `/profile/payroll?next=${encodeURIComponent(back)}`;
test.use({ reducedMotion: "reduce" });

for (const viewport of VIEWPORTS) test(`${viewport.width}px: load-error retry keeps only a valid board return`, async ({ page }) => {
  await page.setViewportSize(viewport);
  for (const next of [back, "", "https://outside.test/jobs"]) {
    await page.goto(`${preview}/dev/components/payroll?state=load-error${next ? `&next=${encodeURIComponent(next)}` : ""}`);
    await expect(page.getByRole("heading", { name: "Bank & tax", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Try again", exact: true })).toHaveAttribute("href", next === back ? destination : "/profile/payroll");
    await expect(page.getByRole("link", { name: "Back to jobs", exact: true })).toHaveCount(next === back ? 1 : 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page).toHaveTitle("Bank & tax (dev) | Trade Marketplace");
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await expectNoA11yViolations(page);
  }
});

test.describe("real payroll reader-error retry", () => {
  test.skip(!app || !database, "Needs the dedicated localhost lane_d_543 database, local Auth and app PGOPTIONS=-c lock_timeout=1000.");
  test.describe.configure({ mode: "serial", timeout: 120_000 });
  let db: pg.Client, auth: Awaited<ReturnType<typeof startSecurityAuthStub>>;
  test.beforeAll(async () => {
    const url = new URL(database!), target = new URL(app!);
    if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/lane_d_543" || url.search || url.hash ||
      !["127.0.0.1", "localhost"].includes(target.hostname) || target.protocol !== "http:" || target.search || target.hash) throw Error("Use the dedicated localhost lane_d_543 database and app only.");
    auth = await startSecurityAuthStub(Number(process.env.PAYROLL_RETRY_AUTH_PORT ?? 55440));
    db = new pg.Client({ connectionString: database }); await db.connect();
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2) ON CONFLICT(id) DO NOTHING", [SECURITY_TRADIE.id, SECURITY_TRADIE.email]);
    await db.query("INSERT INTO profiles(id,email,role,first_name,email_verified_at,updated_at) VALUES($1,$2,'TRADIE','Jack',now(),now()) ON CONFLICT(id) DO UPDATE SET role='TRADIE',email_verified_at=now()", [SECURITY_TRADIE.id, SECURITY_TRADIE.email]);
    await db.query("INSERT INTO worker_profiles(user_id,base_suburb,area_lat,area_lng,area_radius_km,available,identity_checked_at,identity_checked_by_id,updated_at) VALUES($1,'Invercargill',-46.4132,168.3538,25,true,now(),$1,now()) ON CONFLICT(user_id) DO UPDATE SET available=true,paused_at=NULL", [SECURITY_TRADIE.id]);
    await db.query("INSERT INTO worker_trades(user_id,trade) VALUES($1,'OTHER') ON CONFLICT DO NOTHING", [SECURITY_TRADIE.id]);
  });
  test.afterAll(async () => { await auth?.close(); await db?.end(); });
  for (const width of [390, 1440]) test(`${width}px: actual reader error → Try again → Back keeps the filtered board`, async ({ page, context }) => {
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      return ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || ["data:", "blob:"].includes(url.protocol) ? route.continue() : route.abort();
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${app}/login?next=${encodeURIComponent(destination)}`);
    await page.getByLabel("Email", { exact: true }).fill(SECURITY_TRADIE.email);
    await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(`${app}${destination}`, { timeout: 20_000 });
    await expect(page.getByText("Your bank and IRD details are encrypted and only used for payroll.", { exact: true })).toBeVisible();
    const locker = new pg.Client({ connectionString: database }); await locker.connect();
    try {
      await locker.query("BEGIN");
      // Only this disposable database is locked. The app's local lock_timeout makes its real SELECT fail.
      await locker.query("LOCK TABLE payroll_details IN ACCESS EXCLUSIVE MODE");
      await page.reload();
      await expect(page.getByText("Couldn’t load your bank and tax details.", { exact: false })).toBeVisible();
      await expect(page.getByRole("link", { name: "Try again", exact: true })).toHaveAttribute("href", destination);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expectNoA11yViolations(page);
    } finally { await locker.query("ROLLBACK"); await locker.end(); }
    const retry = page.getByRole("link", { name: "Try again", exact: true });
    if (width === 390) await retry.press("Enter"); else await retry.click();
    await expect(page).toHaveURL(`${app}${destination}`);
    await expect(page.getByText("Your bank and IRD details are encrypted and only used for payroll.", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Try again", exact: true })).toHaveCount(0);
    const returnLink = page.getByRole("link", { name: "Back to jobs", exact: true });
    if (width === 390) await returnLink.press("Enter"); else await returnLink.click();
    await expect(page).toHaveURL(`${app}${back}`);
    await expect(page.getByRole("heading", { name: "Jobs near you", exact: true })).toBeVisible();
  });
});
