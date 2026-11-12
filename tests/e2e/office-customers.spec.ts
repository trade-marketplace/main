import { expect, test } from "@playwright/test";
import { CUSTOMER_STATES } from "../../src/lib/office/customers";
import { expectNoA11yViolations } from "./support/a11y";
const preview = process.env.OFFICE_CUSTOMERS_PREVIEW_URL || process.env.POSTED_PREVIEW_E2E_URL || "http://127.0.0.1:3101";
test.use({ trace: "on-first-retry" });
test("office customers preview remains guarded in production", async ({ page }) => { expect((await page.goto("/dev/components/office-customers?state=list"))?.status()).toBe(404); });
for (const width of [320, 390, 768, 1024, 1440]) test(`office customer states at ${width}px`, async ({ page }) => {
  test.setTimeout(180_000); await page.setViewportSize({ width, height: 1000 });
  for (const state of CUSTOMER_STATES) await test.step(state, async () => {
    expect((await page.goto(`${preview}/dev/components/office-customers?state=${state}`))?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Customers", exact: true, level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await expectNoA11yViolations(page);
    if (process.env.OFFICE_CUSTOMERS_QA_DIR && (width === 390 || width === 1440)) { const { mkdir } = await import("node:fs/promises"); await mkdir(process.env.OFFICE_CUSTOMERS_QA_DIR, { recursive: true }); await page.screenshot({ path: `${process.env.OFFICE_CUSTOMERS_QA_DIR}/${state}-${width}.png`, fullPage: true }); }
  });
});
test("keyboard search, sorting and pagination stay in the URL and browser Back restores the list", async ({ page }) => {
  await page.goto(`${preview}/dev/components/office-customers?state=list`);
  await page.getByRole("button", { name: "Name", exact: true }).press("Enter"); await expect(page).toHaveURL(/sort=name.asc/);
  await page.getByRole("searchbox", { name: "Search customers" }).fill("Sarah"); await expect(page).toHaveURL(/q=Sarah/); await expect(page.getByRole("link", { name: "Sarah Taylor", exact: true })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search customers" }).fill("Nobody"); await expect(page.getByRole("heading", { name: "No customers match that.", exact: true })).toBeVisible(); await page.getByRole("table").getByRole("button", { name: "Clear search", exact: true }).press("Enter");
  await expect(page.getByRole("searchbox", { name: "Search customers" })).toHaveValue("");
  await page.getByRole("link", { name: "Next page", exact: true }).press("Enter"); await expect(page).toHaveURL(/page=2/); await expect(page.getByText(/Showing 26–27 of 27/)).toBeVisible();
  await page.goBack(); await expect(page).not.toHaveURL(/page=2/); await expect(page.getByRole("columnheader", { name: "Name" })).toHaveAttribute("aria-sort", "ascending");
});
test("phone sort menu works by keyboard and dismisses after selection", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 }); await page.goto(`${preview}/dev/components/office-customers?state=list`);
  await page.getByRole("button", { name: /^Sort:/ }).press("Enter"); await page.getByRole("menuitemradio", { name: "Jobs: Most first", exact: true }).press("Enter");
  await expect(page).toHaveURL(/sort=jobs.desc/); await expect(page.getByRole("menu")).toHaveCount(0); await expect(page.getByRole("button", { name: "Sort: Jobs, most first", exact: true })).toBeVisible(); await expectNoA11yViolations(page);
});
test.describe("actual read-only customer lookup and job scope", () => {
  const app = process.env.OFFICE_CUSTOMERS_APP_URL, database = process.env.OFFICE_CUSTOMERS_DATABASE_URL;
  test.skip(!app || !database, "Opt in with the isolated localhost office customers app and database.");
  test("customer lookup → scoped jobs → job → Back; removing the chip preserves trade, then Back restores the customer list", async ({ browser }) => {
    const { randomUUID, randomBytes } = await import("node:crypto"), { default: pg } = await import("pg"), { startAuthStub, sessionCookies } = await import("../../scripts/screenshots/auth-stub");
    const url = new URL(database!), appUrl = new URL(app!); if (url.hostname !== "127.0.0.1" || url.pathname !== "/lane_c_241" || url.search || appUrl.hostname !== "127.0.0.1") throw Error("Only the isolated localhost lane_c_241 database/app is allowed.");
    const db = new pg.Client({ connectionString: database }), secret = randomBytes(32).toString("hex"), auth = await startAuthStub(secret, 54575); await db.connect();
    const prefix = randomUUID(), office = { id: randomUUID(), email: `${prefix}-office@example.test` }, sarah = { id: randomUUID(), email: `${prefix}-sarah@example.test` }, alex = { id: randomUUID(), email: `${prefix}-alex@example.test` }, first = randomUUID(), second = randomUUID(), other = randomUUID();
    const context = await browser.newContext();
    try {
      for (const [person, role, name] of [[office, "ADMIN", "Matt"], [sarah, "CUSTOMER", "Sarah"], [alex, "CUSTOMER", "Alex"]] as const) { await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [person.id, person.email]); await db.query("INSERT INTO profiles(id,email,role,first_name,last_name,email_verified_at,updated_at) VALUES($1,$2,$3,$4,'Taylor',now(),now())", [person.id, person.email, role, name]); }
      for (const [id, customer, category, title] of [[first, sarah.id, "OTHER", "Sarah lookup other"], [second, sarah.id, "PLUMBING", "Sarah lookup plumbing"], [other, alex.id, "OTHER", "Alex lookup job"]] as const) await db.query("INSERT INTO jobs(id,customer_id,category,title,description,address_line1,suburb,city,any_time) VALUES($1,$2,$3,$4,'A test job','241 Test Street','Windsor','Invercargill',true)", [id, customer, category, title]);
      const initialProfiles = (await db.query("SELECT id,updated_at FROM profiles ORDER BY id")).rows;
      await context.addCookies(await sessionCookies(office, secret, app!, "http://127.0.0.1:54575")); const page = await context.newPage();
      await page.goto(`${app}/admin/customers`); await page.getByRole("searchbox", { name: "Search customers" }).fill(prefix); await expect(page).toHaveURL(new RegExp(`q=${prefix}`));
      await page.getByRole("button", { name: "Name", exact: true }).press("Enter"); await expect(page).toHaveURL(/sort=name.asc/);
      await page.getByRole("link", { name: "Sarah Taylor", exact: true }).press("Enter"); await expect(page.getByRole("heading", { name: "All jobs", exact: true })).toBeVisible(); await expect(page).toHaveURL(new RegExp(`customer=${sarah.id}`));
      const chip = page.getByRole("button", { name: "Remove customer filter: Sarah T.", exact: true }); await expect(chip).toBeVisible();
      await expect(page.getByRole("link", { name: "Sarah lookup other", exact: true })).toBeVisible(); await expect(page.getByRole("link", { name: "Sarah lookup plumbing", exact: true })).toBeVisible(); await expect(page.locator(`a[href="/admin/jobs/${other}"]`)).toHaveCount(0);
      for (const width of [320, 390, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 1000 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await expectNoA11yViolations(page);
        if (process.env.OFFICE_CUSTOMERS_QA_DIR && (width === 390 || width === 1440)) await page.screenshot({ path: `${process.env.OFFICE_CUSTOMERS_QA_DIR}/scoped-jobs-${width}.png`, fullPage: true });
      }
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.getByRole("link", { name: "Sarah lookup other", exact: true }).press("Enter"); await expect(page.getByRole("heading", { level: 1 })).toContainText("Sarah lookup other"); await page.goBack(); await expect(chip).toBeVisible();
      await page.getByRole("button", { name: "Trade: All", exact: true }).press("Enter"); await page.getByRole("menuitemradio", { name: "Other", exact: true }).press("Enter"); await expect(page).toHaveURL(/trade=OTHER/); await expect(page.getByRole("link", { name: "Sarah lookup plumbing", exact: true })).toHaveCount(0); await expect(page.getByRole("menu")).toHaveCount(0);
      const downloadStarted = page.waitForEvent("download"); await page.getByRole("link", { name: "Export CSV", exact: true }).click(); const download = await downloadStarted;
      const { readFile } = await import("node:fs/promises"); const csv = await readFile((await download.path())!, "utf8"); expect(csv).toContain("Sarah lookup other"); expect(csv).not.toContain("Sarah lookup plumbing"); expect(csv).not.toContain("Alex lookup job");
      await chip.press("Enter"); await expect(page).not.toHaveURL(/customer=/); await expect(page).toHaveURL(/trade=OTHER/); await expect(page.locator(`a[href="/admin/jobs/${other}"]`)).toBeVisible();
      await page.goBack(); await expect(chip).toBeVisible(); await page.goBack(); await expect(page).not.toHaveURL(/trade=OTHER/); await page.goBack(); await expect(page.getByRole("heading", { name: "Customers", exact: true })).toBeVisible(); await expect(page.getByRole("searchbox", { name: "Search customers" })).toHaveValue(prefix); await expect(page.getByRole("columnheader", { name: "Name" })).toHaveAttribute("aria-sort", "ascending");
      expect((await db.query("SELECT id,updated_at FROM profiles ORDER BY id")).rows).toEqual(initialProfiles); expect((await db.query("SELECT count(*) FROM audit_log")).rows[0].count).toBe("0"); await expectNoA11yViolations(page);
    } finally { await context.close(); await db.end(); await new Promise<void>((resolve, reject) => auth.close(error => error ? reject(error) : resolve())); }
  });
});
