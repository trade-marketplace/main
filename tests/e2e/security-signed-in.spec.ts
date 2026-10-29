import { expect, test, type Page, type BrowserContext } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { join } from "node:path";
import pg from "pg";

import { expectNoA11yViolations } from "./support/a11y";
import { SECURITY_PASSWORD, SECURITY_TRADIE, SECURITY_USER, startSecurityAuthStub } from "./support/security-auth-stub";

// Opt-in real pages/actions/SDK + throwaway Postgres + local Auth HTTP double. See docs/testing/security.md.
const appUrl = process.env.SECURITY_E2E_APP_URL;
const dbUrl = process.env.SECURITY_E2E_DATABASE_URL;
test.describe("signed-in account security", () => {
  test.skip(!appUrl || !dbUrl, "Needs the isolated local Auth double and disposable local database.");
  test.describe.configure({ mode: "serial" });
  test.use({ hasTouch: true, viewport: { width: 1440, height: 900 } });
  let auth: Awaited<ReturnType<typeof startSecurityAuthStub>>;
  let db: pg.Client;
  test.beforeAll(async () => {
    const target = new URL(dbUrl!);
    if (target.hostname !== "127.0.0.1" || !target.pathname.includes("local_security")) throw new Error("Security e2e requires a disposable localhost database named …local_security…");
    if (new URL(appUrl!).hostname !== "127.0.0.1") throw new Error("Security e2e requires a localhost app");
    auth = await startSecurityAuthStub(54322);
    db = new pg.Client({ connectionString: dbUrl }); await db.connect();
    for (const [user, role] of [[SECURITY_USER, "CUSTOMER"], [SECURITY_TRADIE, "TRADIE"]] as const) {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2) ON CONFLICT(id) DO NOTHING", [user.id, user.email]);
      await db.query("INSERT INTO profiles(id,email,role,first_name,email_verified_at,updated_at) VALUES($1,$2,$3,'Security Demo',now(),now()) ON CONFLICT(id) DO NOTHING", [user.id, user.email, role]);
    }
  });
  test.afterAll(async () => { await auth?.close(); await db?.end(); });
  test.beforeEach(async () => {
    auth.reset();
    await db.query("UPDATE profiles SET email=$1 WHERE id=$2", [SECURITY_USER.email, SECURITY_USER.id]);
  });
  async function login(page: Page, email = SECURITY_USER.email) {
    await page.goto(`${appUrl}/login?next=%2Fprofile%2Fsecurity`);
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(`${appUrl}/profile/security`);
    await expect(page.getByRole("heading", { name: "Security", exact: true })).toBeVisible();
  }
  async function refresh(context: BrowserContext) {
    const jar = await context.cookies();
    const client = createServerClient("http://127.0.0.1:54322", "sb_publishable_local_security", {
      cookies: { getAll: () => jar.map(({ name, value }) => ({ name, value })), setAll: () => {} },
    });
    return client.auth.refreshSession();
  }
  test("real login → Account menu → security → browser Back; menu dismisses", async ({ page }) => {
    await login(page);
    await page.getByRole("button", { name: "Account: Security Demo" }).click();
    await page.getByRole("menuitem", { name: "Account", exact: true }).click();
    await expect(page).toHaveURL(`${appUrl}/profile/security`);
    await expect(page.getByRole("menu")).toHaveCount(0);
    await page.getByRole("navigation", { name: "Account settings" }).getByRole("link", { name: "Security", exact: true }).press("Enter");
    await expect(page.getByRole("form", { name: "Change password" })).toBeVisible();
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Home", exact: true }).click();
    await expect(page).toHaveURL(`${appUrl}/`);
    await page.goBack();
    await expect(page).toHaveURL(`${appUrl}/profile/security`);
    await expectNoA11yViolations(page);
    if (process.env.SECURITY_SCREENSHOTS_DIR) {
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator("main .tm-anim-rise")).toHaveCSS("opacity", "1");
      await page.screenshot({ path: join(process.env.SECURITY_SCREENSHOTS_DIR, "security-desktop.png"), fullPage: true, animations: "disabled" });
    }
  });
  test("wrong password never updates Auth; a corrected password revokes other refresh sessions", async ({ page, browser }) => {
    await login(page);
    const second = await browser.newContext(); const other = await second.newPage(); await login(other);
    const form = page.getByRole("form", { name: "Change password" });
    await form.getByLabel("Current password", { exact: true }).fill("wrong-password");
    await form.getByLabel("New password", { exact: true }).fill("new isolated password");
    await form.getByLabel("Confirm new password", { exact: true }).fill("new isolated password");
    await form.getByRole("button", { name: "Change password", exact: true }).click();
    await expect(form.getByRole("alert")).toContainText("That’s not your current password");
    expect(auth.events.filter(event => event.method === "PUT")).toHaveLength(0);
    await form.getByLabel("Current password", { exact: true }).fill(SECURITY_PASSWORD);
    await form.getByLabel("New password", { exact: true }).fill("new isolated password");
    await form.getByLabel("Confirm new password", { exact: true }).fill("new isolated password");
    await form.getByRole("button", { name: "Change password", exact: true }).click();
    await expect(form.getByRole("status").filter({ hasText: "Password changed" })).toBeVisible();
    expect(auth.password()).toBe("new isolated password");
    expect(auth.events.some(event => event.path === "/auth/v1/logout" && event.scope === "others")).toBe(true);
    expect((await refresh(second)).error?.code).toBe("refresh_token_not_found");
    expect((await refresh(page.context())).error).toBeNull();
    await page.reload(); await expect(page).toHaveURL(`${appUrl}/profile/security`);
    await expectNoA11yViolations(page); await second.close();
  });
  test("email stays unchanged in Postgres until the PKCE confirmation link is followed", async ({ page }) => {
    await login(page);
    const form = page.getByRole("form", { name: "Change email" });
    await form.getByLabel("Current password", { exact: true }).fill(SECURITY_PASSWORD);
    await form.getByLabel("New email", { exact: true }).fill("new-security@example.test");
    await form.getByRole("button", { name: "Change email", exact: true }).click();
    await expect(form.getByRole("status").filter({ hasText: "Check new-security@example.test" })).toBeVisible();
    expect((await db.query("SELECT email FROM profiles WHERE id=$1", [SECURITY_USER.id])).rows[0].email).toBe(SECURITY_USER.email);
    const link = `${appUrl}/profile/security/confirm?code=${auth.confirmationCode()}`;
    await page.goto(link);
    await expect(page.getByText("Current email: new-security@example.test")).toBeVisible();
    expect((await db.query("SELECT email FROM profiles WHERE id=$1", [SECURITY_USER.id])).rows[0].email).toBe("new-security@example.test");
    await page.goto(link);
    await expect(page.getByText("That email link has expired or is invalid. Request a new link below.")).toBeVisible();
    await expectNoA11yViolations(page);
  });
  test("a failed revocation is not reported as a successful password change", async ({ page }) => {
    await login(page); auth.setLogoutFailure(true);
    const form = page.getByRole("form", { name: "Change password" });
    await form.getByLabel("Current password", { exact: true }).fill(SECURITY_PASSWORD);
    await form.getByLabel("New password", { exact: true }).fill("new isolated password");
    await form.getByLabel("Confirm new password", { exact: true }).fill("new isolated password");
    await form.getByRole("button", { name: "Change password", exact: true }).click();
    await expect(form.getByRole("alert")).toContainText("Password changed, but other devices couldn’t be logged out");
    auth.setLogoutFailure(false);
    const sessions = page.getByRole("form", { name: "Log out other devices" });
    await sessions.getByLabel("Current password", { exact: true }).fill("new isolated password");
    await sessions.getByRole("button", { name: "Log out other devices" }).click();
    await expect(sessions.getByRole("status").filter({ hasText: "You’re still logged in" })).toBeVisible();
  });
  test("phone Account navigation keeps the tradie palette and opens the usable destination", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, SECURITY_TRADIE.email);
    await expect(page.locator("html")).toHaveAttribute("data-mode", "trade");
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Account", exact: true }).tap();
    await expect(page).toHaveURL(`${appUrl}/profile/security`);
    await expect(page.getByRole("form", { name: "Change email" })).toBeVisible();
    if (process.env.SECURITY_SCREENSHOTS_DIR) {
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator("main .tm-anim-rise")).toHaveCSS("opacity", "1");
      await page.screenshot({ path: join(process.env.SECURITY_SCREENSHOTS_DIR, "security-phone.png"), fullPage: true, animations: "disabled" });
    }
    const settings = page.locator("summary").filter({ hasText: "Account settings" });
    await settings.press("Enter");
    await page.getByRole("navigation", { name: "Account settings" }).getByRole("link", { name: "Security", exact: true }).press("Enter");
    await expect(page.locator("details")).not.toHaveAttribute("open");
    await expect(settings).toBeFocused();
    await expectNoA11yViolations(page);
  });
});
