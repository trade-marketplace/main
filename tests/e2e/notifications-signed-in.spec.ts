import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import pg from "pg";

import { expectNoA11yViolations } from "./support/a11y";
import { SECURITY_PASSWORD, SECURITY_TRADIE, SECURITY_USER, startSecurityAuthStub } from "./support/security-auth-stub";

const app = process.env.NOTIFICATIONS_E2E_APP_URL;
const database = process.env.NOTIFICATIONS_E2E_DATABASE_URL;

test.describe("signed-in notifications", () => {
  test.skip(!app || !database, "requires the task-owned localhost app, Auth double and disposable database");
  test.describe.configure({ mode: "serial" });
  test.use({ reducedMotion: "reduce" });
  let auth: Awaited<ReturnType<typeof startSecurityAuthStub>>;
  let db: pg.Client;
  test.beforeAll(async () => {
    const target = new URL(database!);
    if (target.hostname !== "127.0.0.1" || target.pathname !== "/tm_local_notifications") throw new Error("Disposable localhost notification database required");
    if (new URL(app!).hostname !== "127.0.0.1") throw new Error("Localhost app required");
    auth = await startSecurityAuthStub(54381);
    db = new pg.Client({ connectionString: database }); await db.connect();
    for (const [user, role] of [[SECURITY_USER, "CUSTOMER"], [SECURITY_TRADIE, "TRADIE"]] as const) {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2) ON CONFLICT(id) DO NOTHING", [user.id, user.email]);
      await db.query("INSERT INTO profiles(id,email,role,first_name,email_verified_at,updated_at) VALUES($1,$2,$3,'Notification Demo',now(),now()) ON CONFLICT(id) DO NOTHING", [user.id, user.email, role]);
    }
  });
  test.afterAll(async () => { await auth?.close(); await db?.end(); });
  test.beforeEach(async () => {
    auth.reset();
    await db.query("DELETE FROM notifications WHERE user_id=ANY($1::uuid[])", [[SECURITY_USER.id, SECURITY_TRADIE.id]]);
    for (const user of [SECURITY_USER, SECURITY_TRADIE]) for (let i = 0; i < 31; i++) {
      await db.query("INSERT INTO notifications(id,user_id,type,payload,created_at) VALUES($1,$2,'job.priced',$3,now()-($4::int * interval '1 hour'))", [randomUUID(), user.id, JSON.stringify({ jobId: `TM-${1005 + i}`, jobTitle: `Owned notification ${i + 1}` }), i]);
    }
  });

  for (const [user, mode, width] of [[SECURITY_USER, "customer", 1440], [SECURITY_TRADIE, "trade", 390]] as const) {
    test(`${mode}: login → bell → full list → pagination/filter → row destination/Back → persisted read all`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.goto(`${app}/login?next=%2Fprofile%2Fsecurity`);
      await page.getByLabel("Email", { exact: true }).fill(user.email);
      await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD);
      await page.getByRole("button", { name: "Log in", exact: true }).click();
      await expect(page).toHaveURL(`${app}/profile/security`);
      await page.getByRole("button", { name: "Notifications, 31 unread" }).click();
      const menu = page.getByRole("menu", { name: "Notifications", exact: true });
      await expect(menu.getByRole("menuitem").filter({ has: page.locator("time") })).toHaveCount(8);
      await menu.getByRole("menuitem", { name: "See all notifications" }).click();
      await expect(page).toHaveURL(`${app}/notifications`);
      await expect(menu).toHaveCount(0);
      await expect(page.locator("html")).toHaveAttribute("data-mode", mode);
      await expect(page.getByRole("tabpanel").getByRole("listitem")).toHaveCount(25);
      await page.getByRole("link", { name: "Next page" }).click();
      await expect(page).toHaveURL(`${app}/notifications?page=2`);
      await expect(page.getByRole("tabpanel").getByRole("listitem")).toHaveCount(6);
      await page.goBack();
      await page.getByRole("tab", { name: "Unread", exact: true }).press("Enter");
      await expect(page).toHaveURL(`${app}/notifications?filter=unread`);
      await page.getByRole("button", { name: /Owned notification 1\b/ }).press("Enter");
      await expect(page).toHaveURL(`${app}/jobs/TM-1005`);
      // The job workspace is a separate issue; its existing 404 is the reachable destination today.
      await expect(page.getByRole("heading", { name: "Wrong address." })).toBeVisible();
      await page.goBack();
      await expect(page).toHaveURL(`${app}/notifications?filter=unread`);
      await expect(page.getByRole("button", { name: /Owned notification 1\b/ })).toHaveCount(0);
      await page.getByRole("button", { name: "Mark all read", exact: true }).press("Enter");
      await expect(page.getByRole("heading", { name: "No unread notifications" })).toBeVisible();
      await page.reload();
      await expect(page.getByRole("heading", { name: "No unread notifications" })).toBeVisible();
      expect((await db.query("SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND read_at IS NULL", [user.id])).rows[0].n).toBe(0);
      const other = user.id === SECURITY_USER.id ? SECURITY_TRADIE.id : SECURITY_USER.id;
      expect((await db.query("SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND read_at IS NULL", [other])).rows[0].n).toBe(31);
      await expectNoA11yViolations(page);
    });
  }
  test("a session lost after render cannot mark any notifications read", async ({ page }) => {
    await page.goto(`${app}/login?next=%2Fnotifications`);
    await page.getByLabel("Email", { exact: true }).fill(SECURITY_USER.email);
    await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Notifications", exact: true })).toBeVisible();
    await page.context().clearCookies();
    await page.getByRole("button", { name: "Mark all read", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect((await db.query("SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND read_at IS NULL", [SECURITY_USER.id])).rows[0].n).toBe(31);
  });
});
