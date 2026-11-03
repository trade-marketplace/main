import { expect as playwrightExpect, test, type Page } from "@playwright/test";
import pg from "pg";
import { expectNoA11yViolations } from "./support/a11y";
import { SECURITY_PASSWORD, SECURITY_TRADIE, startSecurityAuthStub } from "./support/security-auth-stub";
import { OFFICE_TAX_CODE } from "../../src/lib/payroll";

const dev = process.env.E2E_DEV_BASE_URL;
const app = process.env.PAYROLL_E2E_APP_URL;
const database = process.env.PAYROLL_E2E_DATABASE_URL;
const expect = playwrightExpect.configure({ timeout: 15_000 });
const states = ["missing", "saved", "editing", "validation", "error", "no-key", "loading", "offline", "saving", "load-error"];
async function fill(page: Page, password = SECURITY_PASSWORD) {
  await page.getByLabel("Current password", { exact: true }).fill(password);
  await page.getByLabel("Bank account", { exact: true }).fill("01-0902-0068389-00");
  await page.getByLabel("IRD number", { exact: true }).fill("49091850");
  await page.getByLabel("Tax code", { exact: true }).selectOption("M SL");
  await page.getByLabel("KiwiSaver", { exact: true }).selectOption("3.5");
}
test("bank/tax details require login and previews stay private in production", async ({ page }) => {
  await page.goto("/profile/payroll");
  await expect(page).toHaveURL(/\/login\?next=%2Fprofile%2Fpayroll/);
  const response = await page.goto("/dev/components/payroll?state=saved");
  expect(response?.status()).toBe(404);
});
test.describe("payroll preview", () => {
  test.skip(!dev, "Run against an isolated dev server for component journeys.");
  for (const width of [320, 390, 768, 1024, 1440]) test(`every state at ${width}px has no overflow or axe violations`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width, height: 900 });
    for (const state of states) {
      await page.goto(`${dev}/dev/components/payroll?state=${state}`);
      await expect(page.getByRole("heading", { name: "Bank & tax", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await expectNoA11yViolations(page);
    }
  });
  test("keyboard validation → correct → masked save → reauth failure → cancel; tax help opens", async ({ page, context }) => {
    test.setTimeout(120_000);
    await page.goto(`${dev}/dev/components/payroll?state=missing`);
    await page.getByRole("button", { name: "Save details", exact: true }).press("Enter");
    await expect(page.getByLabel("Current password", { exact: true })).toBeFocused();
    await fill(page);
    await context.route("https://www.ird.govt.nz/**", route => route.fulfill({ body: "<h1>IRD tax code guidance</h1>", contentType: "text/html" }));
    const popup = context.waitForEvent("page");
    await page.getByRole("link", { name: /Work out your tax code/ }).press("Enter");
    const help = await popup; await expect(help.getByRole("heading", { name: "IRD tax code guidance" })).toBeVisible(); await help.close();
    await page.getByRole("button", { name: "Save details", exact: true }).press("Enter");
    await expect(page.getByText("•••• •••• 8900", { exact: true })).toBeVisible();
    await expect(page.getByText("••• ••• 850", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Bank account", { exact: true })).toHaveCount(0);
    await expect(page.getByText("3.5%", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Edit (asks for your password)", exact: true }).press("Enter");
    await expect(page.getByLabel("Current password", { exact: true })).toHaveValue("");
    await fill(page, "wrong-password");
    await page.getByRole("button", { name: "Save details", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "That’s not your current password." })).toBeVisible();
    await expect(page.getByLabel("Bank account", { exact: true })).toHaveValue("01-0902-0068389-00");
    await page.getByRole("button", { name: "Cancel", exact: true }).press("Enter");
    await expect(page.getByText("•••• •••• 8900", { exact: true })).toBeVisible();
  });
  test("failed saves preserve entered values; offline and no-key prevent saving", async ({ page, context }) => {
    test.setTimeout(120_000);
    await page.goto(`${dev}/dev/components/payroll?state=error`); await fill(page);
    await page.getByRole("button", { name: "Save details", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Couldn’t save that" })).toBeVisible();
    await expect(page.getByLabel("IRD number", { exact: true })).toHaveValue("49091850");
    await context.setOffline(true);
    await expect(page.getByText("You’re offline. Reconnect before saving.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save details", exact: true })).toBeDisabled();
    await context.setOffline(false);
    await expect(page.getByRole("button", { name: "Save details", exact: true })).toBeEnabled();
    await expect(page.getByLabel("IRD number", { exact: true })).toHaveValue("49091850");
    await page.goto(`${dev}/dev/components/payroll?state=no-key`);
    await expect(page.getByText("Bank details can’t be saved yet. Try again later.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save details", exact: true })).toBeDisabled();
  });
  for (const width of [320, 390, 768, 1024, 1440]) test(`legacy-review Bank & tax and Earnings at ${width}px`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${dev}/dev/components/payroll?state=review`);
    await expect(page.getByText("Your saved 3% rate needs review.")).toBeVisible();
    await expect(page.getByText("Your tax code needs a payroll review.")).toBeVisible();
    await expect(page.getByText("•••• •••• 8900", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expectNoA11yViolations(page);
    await page.goto(`${dev}/dev/components/earnings?details=review`);
    await expect(page.getByText("Payroll needs a review before you can be paid.")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expectNoA11yViolations(page);
  });
  test("legacy-review and special-code selections hand off to the usable office contact form", async ({ page }) => {
    await page.goto(`${dev}/dev/components/payroll?state=review`);
    await page.getByRole("button", { name: "Edit (asks for your password)" }).click();
    await expect(page.getByLabel("KiwiSaver", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("Tax code", { exact: true })).toHaveValue(OFFICE_TAX_CODE);
    await expect(page.getByRole("button", { name: "Save details" })).toBeDisabled();
    await expect(page.getByLabel("KiwiSaver", { exact: true }).locator('option[value="3"]')).toHaveCount(0);
    await page.getByRole("link", { name: "Contact us", exact: true }).first().press("Enter");
    await expect(page).toHaveURL(`${dev}/contact`);
    await expect(page.getByRole("form", { name: "Contact", exact: true })).toBeVisible();
    await page.goBack(); await expect(page.getByText("Your saved 3% rate needs review.")).toBeVisible();
    await page.goto(`${dev}/dev/components/payroll?state=missing`);
    await page.getByLabel("Tax code", { exact: true }).selectOption(OFFICE_TAX_CODE);
    await expect(page.getByText("Your tax code needs a payroll review.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save details" })).toBeDisabled();
    await page.getByRole("link", { name: "Contact us", exact: true }).press("Enter");
    await expect(page.getByRole("heading", { name: "Get in touch", exact: true })).toBeVisible();
  });
});
test.describe("signed-in payroll", () => {
  test.skip(!app || !database, "Needs a disposable localhost database and isolated Auth double.");
  test.describe.configure({ mode: "serial" });
  let auth: Awaited<ReturnType<typeof startSecurityAuthStub>>, db: pg.Client;
  test.beforeAll(async () => {
    const target = new URL(database!);
    if (target.hostname !== "127.0.0.1" || !/issue134|local_payroll/.test(target.pathname) || new URL(app!).hostname !== "127.0.0.1") throw new Error("Payroll e2e requires a disposable localhost app and database.");
    auth = await startSecurityAuthStub(Number(process.env.PAYROLL_E2E_AUTH_PORT ?? 54334));
    db = new pg.Client({ connectionString: database }); await db.connect();
    await db.query("DELETE FROM rate_limit_buckets"); // Only this explicitly guarded disposable fixture database.
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2) ON CONFLICT(id) DO NOTHING", [SECURITY_TRADIE.id, SECURITY_TRADIE.email]);
    await db.query("INSERT INTO profiles(id,email,role,first_name,email_verified_at,updated_at) VALUES($1,$2,'TRADIE','Payroll Demo',now(),now()) ON CONFLICT(id) DO NOTHING", [SECURITY_TRADIE.id, SECURITY_TRADIE.email]);
    await db.query("DELETE FROM payroll_details WHERE user_id=$1", [SECURITY_TRADIE.id]);
  });
  test.afterAll(async () => { await auth?.close(); await db?.end(); });
  test("login → account Bank & tax → invalid/wrong password → encrypted save → reload masked → edit", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto(`${app}/login?next=%2Fprofile%2Fsecurity`);
    await page.getByLabel("Email", { exact: true }).fill(SECURITY_TRADIE.email);
    await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(`${app}/profile/security`);
    await page.getByRole("navigation", { name: "Account settings" }).getByRole("link", { name: "Bank & tax", exact: true }).click();
    await expect(page).toHaveURL(`${app}/profile/payroll`);
    await fill(page, "wrong-password");
    await page.getByRole("button", { name: "Save details", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "That’s not your current password." })).toBeVisible();
    expect((await db.query("SELECT count(*) FROM payroll_details WHERE user_id=$1", [SECURITY_TRADIE.id])).rows[0].count).toBe("0");
    await page.getByLabel("Current password", { exact: true }).fill(SECURITY_PASSWORD);
    const responsePromise = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/profile/payroll"));
    await page.getByRole("button", { name: "Save details", exact: true }).click();
    const response = await responsePromise, wire = await response.text();
    expect(wire).not.toContain("49091850"); expect(wire).not.toContain("01-0902-0068389-00"); expect(wire).not.toContain(SECURITY_PASSWORD);
    await expect(page.getByText("•••• •••• 8900", { exact: true })).toBeVisible();
    const row = (await db.query("SELECT bank_account_encrypted,ird_number_encrypted,kiwisaver_rate_pct FROM payroll_details WHERE user_id=$1", [SECURITY_TRADIE.id])).rows[0];
    expect(row.bank_account_encrypted).toMatch(/^v1\./); expect(row.ird_number_encrypted).toMatch(/^v1\./); expect(Number(row.kiwisaver_rate_pct)).toBe(3.5);
    expect(JSON.stringify(row)).not.toMatch(/49091850|01-0902-0068389-00/);
    await page.reload();
    await expect(page.getByText("••• ••• 850", { exact: true })).toBeVisible();
    await expectNoA11yViolations(page);
    await page.getByRole("button", { name: "Edit (asks for your password)", exact: true }).click();
    await expect(page.getByLabel("Current password", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("Bank account", { exact: true })).toHaveValue("");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Earnings", exact: true }).click();
    await expect(page).toHaveURL(`${app}/earnings`);
    await page.goBack(); await expect(page.getByText("•••• •••• 8900", { exact: true })).toBeVisible();
    await db.query("UPDATE payroll_details SET kiwisaver_rate_pct=3,tax_code='STC' WHERE user_id=$1", [SECURITY_TRADIE.id]);
    await page.reload();
    await expect(page.getByText("Your saved 3% rate needs review.")).toBeVisible();
    await expect(page.getByText("Your tax code needs a payroll review.")).toBeVisible();
    await page.getByRole("link", { name: "Contact us", exact: true }).first().click();
    await expect(page.getByRole("form", { name: "Contact", exact: true })).toBeVisible();
    await page.goBack(); await expect(page.getByText("•••• •••• 8900", { exact: true })).toBeVisible();
    const preserved = (await db.query("SELECT kiwisaver_rate_pct,tax_code FROM payroll_details WHERE user_id=$1", [SECURITY_TRADIE.id])).rows[0];
    expect(Number(preserved.kiwisaver_rate_pct)).toBe(3); expect(preserved.tax_code).toBe("STC");
  });
});
