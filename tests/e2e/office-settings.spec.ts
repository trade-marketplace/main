import { expect, test } from "@playwright/test";
import pg from "pg";
import { SECURITY_PASSWORD, SECURITY_TRADIE, SECURITY_USER, startSecurityAuthStub } from "./support/security-auth-stub";
import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const dev = process.env.E2E_DEV_BASE_URL;
const url = (query = "") => `${dev}/dev/components/office-settings${query}`;
test("office settings preview is guarded in production", async ({ page }) => {
  test.skip(Boolean(dev), "checking the dev server");
  expect((await page.goto("/dev/components/office-settings"))?.status()).toBe(404);
});
test.describe("office settings", () => {
  test.describe.configure({ timeout: 60_000 });
  test.use({ reducedMotion: "reduce" });
  test.skip(!dev, "set E2E_DEV_BASE_URL to a running dev server");
  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: confirm the exact rate change, keep editing, save, and disable unchanged save`, async ({ page }) => {
      await page.setViewportSize(viewport); await page.goto(url());
      await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
      await expect(page.getByRole("tabpanel").getByRole("button", { name: "Save settings", exact: true })).toBeDisabled();
      await expect(async () => {
        await page.getByRole("group", { name: "Licensed trades", exact: true }).getByLabel("Tradie hourly rate").fill("75");
        await expect(page.getByRole("tabpanel").getByRole("button", { name: "Save settings", exact: true })).toBeEnabled({ timeout: 500 });
      }).toPass();
      await page.getByRole("tabpanel").getByRole("button", { name: "Save settings", exact: true }).click();
      const dialog = page.getByRole("alertdialog", { name: "Save changes?" });
      await expect(dialog).toContainText("Licensed trades: Tradie hourly rate"); await expect(dialog).toContainText("$70.00 → $75.00");
      await expectNoA11yViolations(page);
      await dialog.getByRole("button", { name: "Keep editing" }).click();
      await expect(page.getByRole("group", { name: "Licensed trades", exact: true }).getByLabel("Tradie hourly rate")).toHaveValue("75");
      await page.getByRole("tabpanel").getByRole("button", { name: "Save settings", exact: true }).click();
      await dialog.getByRole("button", { name: "Save settings", exact: true }).click();
      await expect(dialog).not.toBeVisible(); await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
      await expect(page.getByRole("tabpanel").getByRole("button", { name: "Save settings", exact: true })).toBeDisabled();
      await page.getByRole("group", { name: "Licensed trades", exact: true }).getByLabel("Tradie hourly rate").fill("75.00");
      await expect(page.getByRole("tabpanel").getByRole("button", { name: "Save settings", exact: true })).toBeDisabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expectNoA11yViolations(page);
    });
    test(`${viewport.width}px: navigate all tabs and manage the Team safely`, async ({ page }) => {
      await page.setViewportSize(viewport); await page.goto(url("?tab=trades"));
      await expect(async () => {
        await page.getByRole("switch", { name: "Gas fitting" }).setChecked(false);
        await expect(page.getByRole("tabpanel").getByRole("button", { name: "Save settings", exact: true })).toBeEnabled({ timeout: 500 });
      }).toPass();
      await page.getByRole("tabpanel").getByRole("button", { name: "Save settings", exact: true }).click();
      await expect(page.getByRole("alertdialog")).toContainText("On → Off");
      await page.getByRole("alertdialog").getByRole("button", { name: "Save settings", exact: true }).click();
      await page.getByRole("tab", { name: "Coverage", exact: true }).click();
      await expect(page.getByLabel("Radius (km)")).toHaveValue("60");
      await expect(page.getByText("12 waitlist entries inside this area", { exact: false })).toBeVisible();
      await expect(page.getByText("3 not located", { exact: false })).toBeVisible();
      await expectNoA11yViolations(page);
      await page.getByRole("tab", { name: "Emails", exact: true }).click(); await expect(page.getByText("Coming soon", { exact: true })).toBeVisible();
      await page.getByRole("tab", { name: "Team", exact: true }).click();
      await page.getByLabel("Email address").fill("new@demo.test"); await page.getByRole("button", { name: "Add office user", exact: true }).click();
      await expect(page.getByRole("alertdialog")).toContainText("CUSTOMER → ADMIN");
      await page.getByRole("alertdialog").getByRole("button", { name: "Save settings", exact: true }).click();
      await expect(page.getByText("new@demo.test", { exact: true })).toBeVisible();
      const row = page.getByRole("listitem").filter({ hasText: "new@demo.test" }); await row.getByRole("button", { name: "Remove", exact: true }).click();
      await expect(page.getByRole("alertdialog")).toContainText("ADMIN → CUSTOMER");
      await page.getByRole("alertdialog").getByRole("button", { name: "Save settings", exact: true }).click();
      await expect(page.getByText("new@demo.test", { exact: true })).not.toBeVisible();
      await expect(page.getByRole("alertdialog")).not.toBeVisible();
      await page.getByRole("tab", { name: "Team", exact: true }).focus(); await page.keyboard.press("Home");
      await expect(page.getByRole("tab", { name: "Rates", exact: true })).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expectNoA11yViolations(page);
    });
  }
  for (const state of ["loading", "saving", "saved", "validation", "save-error", "no-changes", "offline"]) test(`${state} state remains accessible`, async ({ page }) => {
    await page.goto(url(`?state=${state}`));
    if (state === "saving") await expect(page.getByRole("button", { name: /Saving/ })).toBeDisabled();
    if (state === "no-changes" || state === "offline") await expect(page.getByRole("tabpanel").getByRole("button", { name: "Save settings", exact: true })).toBeDisabled();
    if (state === "validation") await expect(page.getByText("Enter tradie hourly rate from 1 to 1000.")).toBeVisible();
    if (state === "save-error") await expect(page.getByText("Couldn’t save that. Nothing was changed. Try again.")).toBeVisible();
    await expectNoA11yViolations(page);
  });
  test("invalid and failed saves keep entered fields and a reachable retry", async ({ page }) => {
    await page.goto(url("?state=save-error"));
    const rate = page.getByRole("group", { name: "Licensed trades", exact: true }).getByLabel("Tradie hourly rate");
    await expect(async () => {
      await rate.fill("-1"); await page.getByRole("tabpanel").getByRole("button", { name: "Save settings", exact: true }).click();
      await expect(rate).toBeFocused({ timeout: 500 });
    }).toPass();
    await expect(rate).toBeFocused(); await expect(rate).toHaveValue("-1");
    await rate.fill("76"); await page.getByRole("tabpanel").getByRole("button", { name: "Save settings", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Save settings", exact: true }).click();
    await expect(page.getByRole("alertdialog")).toContainText("Couldn’t save that.");
    await page.getByRole("alertdialog").getByRole("button", { name: "Keep editing" }).click(); await expect(rate).toHaveValue("76");
  });
});

test.describe("signed-in office settings", () => {
  const app = process.env.SETTINGS_E2E_APP_URL;
  const database = process.env.SETTINGS_E2E_DATABASE_URL;
  test.skip(!app || !database, "Needs a disposable localhost database and isolated Auth double.");
  test.describe.configure({ mode: "serial", timeout: 90_000 });
  test.use({ reducedMotion: "reduce" });
  let auth: Awaited<ReturnType<typeof startSecurityAuthStub>>, db: pg.Client;
  test.beforeAll(async () => {
    if (new URL(database!).hostname !== "127.0.0.1" || !/issue177|local_settings/.test(new URL(database!).pathname) || !["127.0.0.1", "localhost"].includes(new URL(app!).hostname)) throw new Error("Settings e2e requires a disposable localhost app and database.");
    auth = await startSecurityAuthStub(Number(process.env.SETTINGS_E2E_AUTH_PORT ?? 54377));
    db = new pg.Client({ connectionString: database }); await db.connect();
    for (const [person, role] of [[SECURITY_TRADIE, "ADMIN"], [SECURITY_USER, "CUSTOMER"]] as const) {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2) ON CONFLICT(id) DO NOTHING", [person.id, person.email]);
      await db.query("INSERT INTO profiles(id,email,role,first_name,email_verified_at,updated_at) VALUES($1,$2,$3,'Settings Demo',now(),now()) ON CONFLICT(id) DO UPDATE SET role=excluded.role", [person.id, person.email, role]);
    }
    await db.query("UPDATE settings SET shared_rate_cents=7000, revision=0, enabled_trades=ARRAY['ELECTRICAL','PLUMBING','GAS','CONSTRUCTION','OTHER']::trade[] WHERE id=1");
  });
  test.afterAll(async () => { await auth?.close(); await db?.end(); });
  test("login → real settings → audited save → persisted reload → Team → disabled homepage trade waitlist", async ({ page, browser }) => {
    await page.goto(`${app}/login?next=%2Fadmin%2Fsettings`);
    await expect(async () => {
      await page.getByRole("button", { name: /^(Show|Hide) password$/ }).click();
      await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text", { timeout: 500 });
    }).toPass();
    await page.getByLabel("Email", { exact: true }).fill(SECURITY_TRADIE.email);
    await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(`${app}/admin/settings`);
    await expect(page.locator("html")).toHaveAttribute("data-mode", "office");
    const card = page.getByRole("group", { name: "Licensed trades", exact: true });
    const oldExample = await card.getByText(/4 h licensed job/).textContent();
    await expect(async () => {
      await card.getByLabel("Tradie hourly rate").fill("75.25");
      await expect(page.getByRole("tabpanel").getByRole("button", { name: "Save settings", exact: true })).toBeEnabled({ timeout: 500 });
    }).toPass();
    await expect(card.getByText(/4 h licensed job/)).not.toContainText("Updating example");
    await expect(card.getByText(/4 h licensed job/)).not.toHaveText(oldExample!);
    await page.getByRole("tabpanel").getByRole("button", { name: "Save settings", exact: true }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("$70.00 → $75.25");
    expect((await db.query("SELECT shared_rate_cents FROM settings WHERE id=1")).rows[0].shared_rate_cents).toBe(7000);
    await dialog.getByRole("button", { name: "Save settings", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect((await db.query("SELECT shared_rate_cents FROM settings WHERE id=1")).rows[0].shared_rate_cents).toBe(7525);
    const audit = (await db.query("SELECT actor_id, before, after FROM audit_log WHERE action='settings.updated' ORDER BY created_at DESC LIMIT 1")).rows[0];
    expect(audit).toMatchObject({ actor_id: SECURITY_TRADIE.id, before: { sharedRateCents: 7000 }, after: { sharedRateCents: 7525 } });
    await page.reload(); await expect(card.getByLabel("Tradie hourly rate")).toHaveValue("75.25");
    await page.getByRole("tab", { name: "Team", exact: true }).click();
    await page.getByLabel("Email address").fill(SECURITY_USER.email);
    await page.getByRole("button", { name: "Add office user", exact: true }).click();
    await expect(dialog).toContainText("CUSTOMER → ADMIN");
    await dialog.getByRole("button", { name: "Save settings", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText(SECURITY_USER.email, { exact: true })).toBeVisible();
    expect((await db.query("SELECT role FROM profiles WHERE id=$1", [SECURITY_USER.id])).rows[0].role).toBe("ADMIN");
    await page.getByRole("tab", { name: "Emails", exact: true }).click(); await expect(page.getByText("Coming soon", { exact: true })).toBeVisible();
    await expectNoA11yViolations(page);
    await page.getByRole("tab", { name: "Trades", exact: true }).click();
    await page.getByRole("switch", { name: "Gas fitting" }).setChecked(false);
    await page.getByRole("tabpanel").getByRole("button", { name: "Save settings", exact: true }).click();
    await Promise.all([
      page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).searchParams.get("tab") === "trades"),
      dialog.getByRole("button", { name: "Save settings", exact: true }).click(),
    ]);
    await expect(dialog).not.toBeVisible();
    const guest = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    try {
      const home = await guest.newPage(); await home.goto(`${app}/`);
      const tile = home.locator('article[data-category="gas"]');
      await expect(tile).toContainText("Coming soon");
      await tile.getByRole("link", { name: "Gas fitting", exact: true }).click();
      await expect(home).toHaveURL(`${app}/services/gas`);
      const waitlist = home.getByRole("form", { name: "Gas fitting waitlist", exact: true });
      await expect(waitlist).toBeVisible();
      const email = `settings-${Date.now()}@example.test`;
      await waitlist.getByLabel("Email", { exact: true }).fill(email);
      await waitlist.getByLabel("Suburb", { exact: true }).fill("Invercargill");
      await waitlist.getByRole("button", { name: "Tell me", exact: true }).click();
      await expect(home.getByText("You’re on the list.", { exact: true })).toBeVisible();
      expect((await db.query("SELECT trade FROM service_waitlist_entries WHERE email=$1", [email])).rows[0].trade).toBe("GAS");
      await expectNoA11yViolations(home);
    } finally { await guest.close(); }
    await page.getByRole("tab", { name: "Rates", exact: true }).click();
    await card.getByLabel("Tradie hourly rate").fill("80");
    await page.getByRole("tabpanel").getByRole("button", { name: "Save settings", exact: true }).click();
    await page.context().clearCookies();
    await dialog.getByRole("button", { name: "Save settings", exact: true }).click();
    const expired = page.getByRole("dialog", { name: "You’ve been logged out", exact: true });
    await expect(expired).toBeVisible();
    await expired.getByRole("button", { name: "Log in again", exact: true }).click();
    await expired.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD);
    await expired.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(expired).not.toBeVisible(); await expect(dialog).not.toBeVisible();
    await expect(card.getByLabel("Tradie hourly rate")).toHaveValue("80");
    expect((await db.query("SELECT shared_rate_cents FROM settings WHERE id=1")).rows[0].shared_rate_cents).toBe(8000);
  });
});

test.describe("disabled homepage trade preview", () => {
  test.skip(!dev, "Needs the guarded local preview.");
  test.use({ reducedMotion: "reduce" });
  for (const viewport of VIEWPORTS) test(`${viewport.width}px disabled homepage tile is clear and accessible`, async ({ page }) => {
    await page.setViewportSize(viewport); await page.goto(`${dev}/dev/components/landing?state=trade-disabled`);
    await expect(page.locator('article[data-category="gas"]')).toContainText("Coming soon");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expectNoA11yViolations(page);
  });
});
