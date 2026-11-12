import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

import { expectNoA11yViolations } from "./support/a11y";
import { SECURITY_PASSWORD, SECURITY_TRADIE, startSecurityAuthStub } from "./support/security-auth-stub";
import { VIEWPORTS } from "./support/viewports";

const preview = process.env.SETTINGS_RETURN_PREVIEW_URL;
const app = process.env.SETTINGS_RETURN_APP_URL;
const database = process.env.SETTINGS_RETURN_DATABASE_URL;
const back = "/jobs?kind=bounty&distance=10";
const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test.describe("account settings return previews", () => {
  test.skip(!preview, "Needs the guarded local account settings previews.");
  for (const viewport of VIEWPORTS) test(`${viewport.width}px: with and without return`, async ({ page }) => {
    await page.setViewportSize(viewport);
    for (const state of ["with-return", "without-return"]) {
      await page.goto(`${preview}/dev/components/account-settings?state=${state}`);
      await expect(page.getByRole("heading", { name: "Work area", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Back to jobs", exact: true })).toHaveCount(state === "with-return" ? 1 : 0);
      if (viewport.width < 1024) await page.locator("summary").filter({ hasText: "Account settings" }).click();
      const nav = page.getByRole("navigation", { name: "Account settings", exact: true });
      await expect(nav.getByRole("link", { name: "Security", exact: true })).toHaveAttribute("href", "/profile/security");
      expect(await fits(page)).toBe(true);
      await expectNoA11yViolations(page);
    }
  });
});

test.describe("real filtered board settings hops", () => {
  test.skip(!app || !database, "Needs a disposable localhost lane_d_521 database and local Auth stand-in.");
  test.describe.configure({ mode: "serial", timeout: 120_000 });
  let db: pg.Client, auth: Awaited<ReturnType<typeof startSecurityAuthStub>>;
  test.beforeAll(async () => {
    const url = new URL(database!);
    if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/lane_d_521" || url.search || !["127.0.0.1", "localhost"].includes(new URL(app!).hostname)) throw Error("Use the dedicated localhost lane_d_521 database and app.");
    auth = await startSecurityAuthStub(Number(process.env.SETTINGS_RETURN_AUTH_PORT ?? 55440));
    db = new pg.Client({ connectionString: database }); await db.connect();
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2) ON CONFLICT(id) DO NOTHING", [SECURITY_TRADIE.id, SECURITY_TRADIE.email]);
    await db.query("INSERT INTO profiles(id,email,role,first_name,email_verified_at,updated_at) VALUES($1,$2,'TRADIE','Jack',now(),now()) ON CONFLICT(id) DO UPDATE SET role='TRADIE',email_verified_at=now()", [SECURITY_TRADIE.id, SECURITY_TRADIE.email]);
    await db.query("INSERT INTO worker_profiles(user_id,base_suburb,area_lat,area_lng,area_radius_km,available,identity_checked_at,identity_checked_by_id,updated_at) VALUES($1,'Invercargill',-46.4132,168.3538,25,true,now(),$1,now()) ON CONFLICT(user_id) DO UPDATE SET base_suburb='Invercargill',area_lat=-46.4132,area_lng=168.3538,area_radius_km=25,available=true,paused_at=NULL", [SECURITY_TRADIE.id]);
    await db.query("INSERT INTO worker_trades(user_id,trade) VALUES($1,'OTHER') ON CONFLICT DO NOTHING", [SECURITY_TRADIE.id]);
  });
  test.afterAll(async () => { await auth?.close(); await db?.end(); });
  async function choose(page: Page, label: string, keyboard: boolean) {
    if ((page.viewportSize()?.width ?? 1440) < 1024) {
      const summary = page.locator("summary").filter({ hasText: "Account settings" });
      if (keyboard) await summary.press("Enter"); else await summary.click();
    }
    const link = page.getByRole("navigation", { name: "Account settings", exact: true }).getByRole("link", { name: label, exact: true });
    if (keyboard) await link.press("Enter"); else await link.click();
    if ((page.viewportSize()?.width ?? 1440) < 1024) await expect(page.locator("details").filter({ has: page.locator("summary").filter({ hasText: "Account settings" }) })).not.toHaveAttribute("open", "");
  }
  for (const keyboard of [false, true]) test(`${keyboard ? "keyboard" : "mouse"}: four-page hops preserve the filtered board at all widths`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto(`${app}/login?next=${encodeURIComponent(back)}`);
    await page.getByLabel("Email", { exact: true }).fill(SECURITY_TRADIE.email);
    await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(`${app}${back}`, { timeout: 20_000 });
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.goto(`${app}${back}`);
      const area = page.getByRole("link", { name: "Change it", exact: true });
      if (keyboard) await area.press("Enter"); else await area.click();
      for (const [label, path] of [["Trades & licences", "trades"], ["Bank & tax", "payroll"], ["Notifications", "notifications"], ["Work area", "area"]]) {
        await choose(page, label, keyboard);
        await expect(page).toHaveURL(`${app}/profile/${path}?next=${encodeURIComponent(back)}`);
        await expect(page.getByRole("heading", { level: 1, name: label, exact: true })).toBeVisible();
        await expect(page.getByRole("link", { name: "Back to jobs", exact: true })).toBeVisible();
        expect(await fits(page)).toBe(true); await expectNoA11yViolations(page);
      }
      const returnLink = page.getByRole("link", { name: "Back to jobs", exact: true });
      if (keyboard) await returnLink.press("Enter"); else await returnLink.click();
      await expect(page).toHaveURL(`${app}${back}`);
    }
  });
  test("without next and with invalid next, navigation stays plain", async ({ page }) => {
    await page.goto(`${app}/login?next=%2Fprofile%2Farea`);
    await page.getByLabel("Email", { exact: true }).fill(SECURITY_TRADIE.email); await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(`${app}/profile/area`, { timeout: 20_000 });
    for (const next of ["", "?next=%2F%2Fevil.test%2Fjobs", `?next=${encodeURIComponent("/jobs?x=" + "a".repeat(4096))}`]) {
      await page.goto(`${app}/profile/area${next}`);
      await expect(page.getByRole("heading", { level: 1, name: "Work area", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Back to jobs", exact: true })).toHaveCount(0);
      await choose(page, "Trades & licences", false);
      await expect(page).toHaveURL(`${app}/profile/trades`);
      await choose(page, "Bank & tax", true);
      await expect(page).toHaveURL(`${app}/profile/payroll`);
      await expect(page.getByRole("link", { name: "Back to jobs", exact: true })).toHaveCount(0);
    }
  });
});
