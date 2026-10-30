import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

import { expectNoA11yViolations } from "./support/a11y";
import { SECURITY_PASSWORD, SECURITY_TRADIE, SECURITY_USER, startSecurityAuthStub } from "./support/security-auth-stub";

const appUrl = process.env.PREFERENCES_APP_URL;
const dbUrl = process.env.PREFERENCES_DATABASE_URL;

test.describe("notification preferences real pages and server actions", () => {
  test.skip(!appUrl || !dbUrl, "Needs an isolated localhost app and disposable local_notifications database.");
  test.describe.configure({ mode: "serial" });
  let auth: Awaited<ReturnType<typeof startSecurityAuthStub>>;
  let db: pg.Client;
  test.beforeAll(async () => {
    const target = new URL(dbUrl!);
    if (target.hostname !== "127.0.0.1" || !target.pathname.includes("local_notifications")) throw new Error("Only a disposable localhost local_notifications database is allowed");
    if (new URL(appUrl!).hostname !== "127.0.0.1") throw new Error("Only a localhost app is allowed");
    auth = await startSecurityAuthStub(54338);
    db = new pg.Client({ connectionString: dbUrl }); await db.connect();
    for (const [user, role] of [[SECURITY_USER, "CUSTOMER"], [SECURITY_TRADIE, "TRADIE"]] as const) {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2) ON CONFLICT(id) DO NOTHING", [user.id, user.email]);
      await db.query("INSERT INTO profiles(id,email,role,first_name,email_verified_at,updated_at) VALUES($1,$2,$3,'Notification Demo',now(),now()) ON CONFLICT(id) DO NOTHING", [user.id, user.email, role]);
    }
  });
  test.afterAll(async () => { await auth?.close(); await db?.end(); });
  test.beforeEach(async () => {
    auth.reset();
    await db.query("DELETE FROM notification_preferences WHERE user_id = ANY($1::uuid[])", [[SECURITY_USER.id, SECURITY_TRADIE.id]]);
  });
  async function login(page: Page, email = SECURITY_USER.email) {
    await page.goto(`${appUrl}/login?next=%2Fprofile%2Fnotifications`);
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(`${appUrl}/profile/notifications`);
    await expect(page.getByRole("heading", { name: "Notifications", exact: true })).toBeVisible();
  }
  const enabled = async (userId = SECURITY_USER.id, event = "job.priced") => (await db.query("SELECT enabled FROM notification_preferences WHERE user_id=$1 AND event=$2 AND channel='EMAIL'", [userId, event])).rows[0]?.enabled;

  test("login → immediate save → persisted reload → Undo; another account stays unchanged", async ({ page }) => {
    await login(page);
    const email = page.getByRole("checkbox", { name: "Email: Your price is ready", exact: true });
    await email.uncheck(); await expect.poll(() => enabled()).toBe(false);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(() => enabled()).toBe(true);
    await email.uncheck(); await expect.poll(() => enabled()).toBe(false);
    await page.reload(); await expect(email).not.toBeChecked();
    expect(await enabled(SECURITY_TRADIE.id)).toBeUndefined();
    expect(auth.events.filter(event => event.method === "PUT" || event.path.includes("logout"))).toEqual([]);
    await expectNoA11yViolations(page);
  });

  test("Account menu opens notification settings and keyboard navigation returns through Security", async ({ page }) => {
    await login(page);
    await page.getByRole("button", { name: "Account: Notification Demo" }).click();
    await page.getByRole("menuitem", { name: "Notification settings", exact: true }).click();
    await expect(page).toHaveURL(`${appUrl}/profile/notifications`); await expect(page.getByRole("menu")).toHaveCount(0);
    const nav = page.getByRole("navigation", { name: "Account settings" });
    await nav.getByRole("link", { name: "Security", exact: true }).press("Enter");
    await expect(page.getByRole("form", { name: "Change password" })).toBeVisible();
    await page.getByRole("navigation", { name: "Account settings" }).getByRole("link", { name: "Notifications", exact: true }).press("Enter");
    await expect(page).toHaveURL(`${appUrl}/profile/notifications`);
    await expect(page.getByRole("navigation", { name: "Account settings" }).getByRole("link", { name: "Notifications", exact: true })).toHaveAttribute("aria-current", "page");
    await page.goBack(); await expect(page).toHaveURL(`${appUrl}/profile/security`);
  });

  test("phone tradie navigation preserves mode, saves the correct event and dismisses its menu", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, SECURITY_TRADIE.email);
    await expect(page.locator("html")).toHaveAttribute("data-mode", "trade");
    const checkbox = page.getByRole("checkbox", { name: "Email: Payout paid", exact: true });
    await checkbox.uncheck(); await expect.poll(() => enabled(SECURITY_TRADIE.id, "payout.paid")).toBe(false);
    await page.locator("summary").filter({ hasText: "Account settings" }).press("Enter");
    await page.getByRole("navigation", { name: "Account settings" }).getByRole("link", { name: "Security", exact: true }).press("Enter");
    await expect(page.getByRole("form", { name: "Change password" })).toBeVisible();
    await expect(page.locator("details")).not.toHaveAttribute("open");
    await page.locator("summary").filter({ hasText: "Account settings" }).press("Enter");
    await page.getByRole("navigation", { name: "Account settings" }).getByRole("link", { name: "Notifications", exact: true }).press("Enter");
    await expect(checkbox).not.toBeChecked(); await expectNoA11yViolations(page);
  });

  test("a session lost after loading cannot save and returns to login with this destination", async ({ page, context }) => {
    await login(page); await context.clearCookies();
    const checkbox = page.getByRole("checkbox", { name: "Email: Your price is ready", exact: true });
    await checkbox.click(); await expect(page.getByText("Log in to save.", { exact: true }).first()).toBeVisible();
    await expect(checkbox).toBeChecked(); await expect(checkbox).toBeDisabled();
    expect(await enabled()).toBeUndefined();
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(/\/login\?next=%2Fprofile%2Fnotifications$/);
  });
});
