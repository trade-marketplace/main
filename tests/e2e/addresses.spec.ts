import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { ADDRESS_STATES } from "../../src/lib/account/addresses";
import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";
import { SECURITY_PASSWORD, SECURITY_USER, SECURITY_TRADIE, startSecurityAuthStub } from "./support/security-auth-stub";

const preview = process.env.ADDRESSES_PREVIEW_URL || process.env.POSTED_PREVIEW_E2E_URL || "http://127.0.0.1:3101";
const app = process.env.ADDRESSES_E2E_APP_URL, database = process.env.ADDRESSES_E2E_DATABASE_URL;
// Capture a trace on retries; the required screenshots are published separately by the PR bot.
test.use({ trace: "on-first-retry", reducedMotion: "reduce" });
const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test("saved-address previews stay guarded on production", async ({ page }) => {
  expect((await page.goto("/dev/components/addresses"))?.status()).toBe(404);
});
for (const viewport of VIEWPORTS) test(`all saved-address states at ${viewport.width}px`, async ({ page }) => {
  test.setTimeout(180_000); await page.setViewportSize(viewport);
  for (const state of [...ADDRESS_STATES, "gallery"]) {
    await page.goto(`${preview}/dev/components/addresses?state=${state}`);
    await page.evaluate(() => document.fonts.ready);
    if (["add-dialog", "searching", "search-unavailable", "field-error", "saving"].includes(state)) {
      await expect(page.getByRole("dialog", { name: "Add address", exact: true })).toBeVisible();
      if (state === "searching") await expect(page.getByText("Looking for addresses…", { exact: true })).toBeVisible();
      if (state === "search-unavailable") await expect(page.getByText("Address search is unavailable. You can type the address by hand.", { exact: true })).toBeVisible();
      if (state === "field-error") await expect(page.getByText("Enter the address.")).toBeVisible();
    } else if (state === "delete-dialog") await expect(page.getByRole("alertdialog", { name: "Delete this address?", exact: true })).toBeVisible();
    else await expect(page.getByRole("heading", { level: 1, name: "Addresses", exact: true })).toBeVisible();
    if (state === "empty") await expect(page.getByText("No saved addresses yet.", { exact: true })).toBeVisible();
    if (state === "at-limit") await expect(page.getByRole("button", { name: "Add address", exact: true })).toHaveAttribute("aria-disabled", "true");
    if (state === "saved") await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
    expect(await fits(page), state).toBe(true); await expectNoA11yViolations(page);
  }
});
test("preview keyboard search, edit, default and delete retain focus and support manual fallback", async ({ page, context }) => {
  await page.goto(`${preview}/dev/components/addresses?state=list`);
  const add = page.getByRole("button", { name: "Add address", exact: true }); await add.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Add address", exact: true });
  await dialog.getByLabel("Label", { exact: true }).fill("Garage");
  await dialog.getByRole("combobox", { name: "Address", exact: true }).fill("12 Dee");
  await expect(page.getByRole("option", { name: "12 Dee Street, Central, Invercargill 9810", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Save", exact: true }).press("Enter");
  await expect(dialog.getByText("Enter the suburb.")).toBeVisible();
  await expect(dialog.getByLabel("Suburb", { exact: true })).toBeFocused();
  await dialog.getByRole("combobox").focus(); await dialog.getByRole("combobox").press("ArrowDown"); await page.keyboard.press("Enter");
  await expect(dialog.getByText("Enter the suburb.")).toHaveCount(0);
  await context.setOffline(true); await expect(dialog.getByRole("button", { name: "Save", exact: true })).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByText("You’re offline.", { exact: true })).toHaveCount(1);
  await expect(dialog.getByLabel("Label", { exact: true })).toHaveValue("Garage"); await context.setOffline(false);
  await dialog.getByRole("button", { name: "Save", exact: true }).press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0); await expect(add).toBeFocused();
  const card = page.getByRole("article", { name: "Garage", exact: true }); await card.getByRole("button", { name: "Edit", exact: true }).press("Enter");
  await page.getByRole("dialog").getByLabel("Label", { exact: true }).fill("Shed"); await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).press("Enter");
  const renamed = page.getByRole("article", { name: "Shed", exact: true }); await expect(renamed.getByRole("button", { name: "Edit", exact: true })).toBeFocused();
  await renamed.getByRole("button", { name: "Make default", exact: true }).press("Enter"); await expect(renamed.getByText("Default", { exact: true })).toBeVisible();
  await renamed.getByRole("button", { name: "Delete", exact: true }).press("Enter");
  await page.getByRole("alertdialog").getByRole("button", { name: "Keep", exact: true }).press("Enter"); await expect(renamed.getByRole("button", { name: "Delete", exact: true })).toBeFocused();
  await renamed.getByRole("button", { name: "Delete", exact: true }).press("Enter"); await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).press("Enter");
  await expect(renamed).toHaveCount(0); await expect(add).toBeFocused(); await expectNoA11yViolations(page);
  await page.goto(`${preview}/dev/components/addresses?state=search-unavailable`);
  await page.getByRole("dialog").getByRole("combobox").fill("23 Manual Street");
  await page.getByRole("dialog").getByLabel("Suburb", { exact: true }).fill("Central");
  await page.getByRole("dialog").getByLabel("City", { exact: true }).fill("Invercargill");
  await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).press("Enter");
  await expect(page.getByRole("article", { name: "Address", exact: true }).getByText("23 Manual Street")).toBeVisible();
  await page.goto(`${preview}/dev/components/addresses?state=error`);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("article", { name: "Home", exact: true })).toBeVisible();
  await expectNoA11yViolations(page);
  await expect(page.getByText("Saved.", { exact: true })).toHaveCount(0);
});

test.describe("actual customer saved addresses", () => {
  test.skip(!app || !database, "Needs a dedicated localhost lane_d_237 database and local Auth stand-in.");
  test.describe.configure({ mode: "serial", timeout: 120_000 });
  let db: pg.Client, auth: Awaited<ReturnType<typeof startSecurityAuthStub>>;
  test.beforeAll(async () => {
    const url = new URL(database!);
    if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/lane_d_237" || url.search || !["127.0.0.1", "localhost"].includes(new URL(app!).hostname)) throw Error("Use a disposable localhost lane_d_237 database and app.");
    auth = await startSecurityAuthStub(Number(process.env.ADDRESSES_E2E_AUTH_PORT ?? 55440));
    db = new pg.Client({ connectionString: database }); await db.connect();
    for (const [who, role, name] of [[SECURITY_USER, "CUSTOMER", "Sarah"], [SECURITY_TRADIE, "TRADIE", "Jack"]] as const) {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2) ON CONFLICT(id) DO NOTHING", [who.id, who.email]);
      await db.query("INSERT INTO profiles(id,email,role,first_name,email_verified_at,updated_at) VALUES($1,$2,$3,$4,now(),now()) ON CONFLICT(id) DO UPDATE SET role=excluded.role,email_verified_at=now()", [who.id, who.email, role, name]);
    }
  });
  test.afterAll(async () => { await auth?.close(); await db?.end(); });
  test.beforeEach(async () => { await db.query("DELETE FROM addresses WHERE user_id=$1", [SECURITY_USER.id]); });
  async function login(page: Page, tradie = false) {
    await page.goto(`${app}/login?next=%2Fprofile%2Faddresses`);
    await page.getByLabel("Email", { exact: true }).fill(tradie ? SECURITY_TRADIE.email : SECURITY_USER.email);
    await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(`${app}${tradie ? "/jobs" : "/profile/addresses"}`, { timeout: 20_000 });
  }
  async function fill(page: Page, label: string, line: string) {
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Label", { exact: true }).fill(label);
    await dialog.getByRole("combobox").fill(line);
    await expect(dialog.getByLabel("Suburb", { exact: true })).toBeVisible();
    await dialog.getByLabel("Suburb", { exact: true }).fill("Central"); await dialog.getByLabel("City", { exact: true }).fill("Invercargill");
    await dialog.getByLabel("Postcode", { exact: true }).fill("9810");
  }
  test("real keyboard commands save typed fallback, move default, edit and delete with current database state", async ({ page }) => {
    await login(page);
    await page.getByRole("link", { name: "Profile", exact: true }).click(); await expect(page).toHaveURL(`${app}/profile`);
    await page.getByRole("link", { name: "Addresses", exact: true }).press("Enter"); await expect(page).toHaveURL(`${app}/profile/addresses`);
    await page.goBack(); await expect(page).toHaveURL(`${app}/profile`);
    await page.getByRole("link", { name: "Addresses", exact: true }).press("Enter"); await expect(page).toHaveURL(`${app}/profile/addresses`);
    await page.getByRole("button", { name: "Add address", exact: true }).press("Enter"); await fill(page, "Home", "12 Local Test Street");
    await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).press("Enter"); await expect(page.getByRole("dialog")).toHaveCount(0);
    const add = page.getByRole("button", { name: "Add address", exact: true }); await expect(add).toBeFocused();
    expect((await db.query("SELECT location_source,lat,lng,is_default FROM addresses WHERE user_id=$1", [SECURITY_USER.id])).rows).toEqual([{ location_source: "TYPED", lat: null, lng: null, is_default: true }]);
    await add.press("Enter"); await fill(page, "Rental", "34 Local Test Street"); await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).press("Enter");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const rental = page.getByRole("article", { name: "Rental", exact: true }); await rental.getByRole("button", { name: "Make default", exact: true }).press("Enter"); await expect(rental.getByText("Default", { exact: true })).toBeVisible();
    await rental.getByRole("button", { name: "Edit", exact: true }).press("Enter"); await page.getByRole("dialog").getByLabel("Label", { exact: true }).fill("Rental house");
    await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).press("Enter");
    const edited = page.getByRole("article", { name: "Rental house", exact: true }); await expect(edited.getByRole("button", { name: "Edit", exact: true })).toBeFocused();
    await edited.getByRole("button", { name: "Delete", exact: true }).press("Enter"); await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).press("Enter");
    await expect(add).toBeFocused(); const home = page.getByRole("article", { name: "Home", exact: true }); await expect(home.getByText("Default", { exact: true })).toBeVisible();
    await home.getByRole("button", { name: "Delete", exact: true }).press("Enter"); await page.getByRole("alertdialog").getByRole("button", { name: "Keep", exact: true }).press("Enter");
    await expect(home.getByRole("button", { name: "Delete", exact: true })).toBeFocused();
    await home.getByRole("button", { name: "Delete", exact: true }).press("Enter"); await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).press("Enter");
    await expect(page.getByText("No saved addresses yet.", { exact: true })).toBeVisible(); await expect(page.getByRole("button", { name: "Add address", exact: true })).toBeFocused();
    expect((await db.query("SELECT count(*)::int AS count FROM addresses WHERE user_id=$1", [SECURITY_USER.id])).rows[0].count).toBe(0);
    const audits = (await db.query("SELECT before,after FROM audit_log WHERE actor_id=$1 AND action LIKE 'address.%'", [SECURITY_USER.id])).rows;
    expect(JSON.stringify(audits)).not.toContain("Local Test Street"); await expectNoA11yViolations(page);
  });
  test("legacy PIN and unknown provenance expose manual fields, preserve label edits and drop stale points on correction", async ({ page }) => {
    const fixtures = [{ id: randomUUID(), label: "Legacy PIN", source: "PIN", lat: -46.41, lng: 168.35 }, { id: randomUUID(), label: "Legacy unknown", source: null, lat: null, lng: null }];
    for (const [index, item] of fixtures.entries()) await db.query("INSERT INTO addresses(id,user_id,label,line1,suburb,city,postcode,lat,lng,location_source,is_default) VALUES($1,$2,$3,'12 Legacy Test Street','Central','Invercargill','9810',$4,$5,$6,$7)", [item.id, SECURITY_USER.id, item.label, item.lat, item.lng, item.source, index === 0]);
    await login(page);
    for (const item of fixtures) {
      await page.getByRole("article", { name: item.label, exact: true }).getByRole("button", { name: "Edit", exact: true }).click();
      let dialog = page.getByRole("dialog");
      await expect(dialog.getByLabel("Suburb", { exact: true })).toHaveValue("Central");
      await expect(dialog.getByLabel("City", { exact: true })).toHaveValue("Invercargill");
      await expect(dialog.getByLabel("Postcode", { exact: true })).toHaveValue("9810");
      await dialog.getByLabel("Label", { exact: true }).fill(`${item.label} renamed`); await dialog.getByRole("button", { name: "Save", exact: true }).click(); await expect(dialog).toHaveCount(0);
      expect((await db.query("SELECT location_source,lat,lng FROM addresses WHERE id=$1", [item.id])).rows[0]).toEqual({ location_source: item.source, lat: item.lat, lng: item.lng });
      await page.getByRole("article", { name: `${item.label} renamed`, exact: true }).getByRole("button", { name: "Edit", exact: true }).click();
      dialog = page.getByRole("dialog"); await dialog.getByLabel("Suburb", { exact: true }).fill("Windsor");
      await expect(dialog.getByRole("combobox")).toHaveValue("12 Legacy Test Street");
      await expect(dialog.getByLabel("City", { exact: true })).toHaveValue("Invercargill");
      await expect(dialog.getByLabel("Postcode", { exact: true })).toHaveValue("9810");
      await expectNoA11yViolations(page);
      await dialog.getByRole("button", { name: "Save", exact: true }).click(); await expect(dialog).toHaveCount(0);
      expect((await db.query("SELECT line1,suburb,city,postcode,location_source,lat,lng FROM addresses WHERE id=$1", [item.id])).rows[0]).toEqual({ line1: "12 Legacy Test Street", suburb: "Windsor", city: "Invercargill", postcode: "9810", location_source: "TYPED", lat: null, lng: null });
    }
    await page.reload(); await expect(page.getByRole("article")).toHaveCount(2);
    for (const item of fixtures) await expect(page.getByRole("article", { name: `${item.label} renamed`, exact: true })).toContainText("Windsor, Invercargill, 9810");
  });
  test("a response lost after commit reuses the same create key on retry", async ({ page }) => {
    const auditsBefore = (await db.query("SELECT count(*)::int AS count FROM audit_log WHERE actor_id=$1 AND action='address.saved' AND after->>'label'='Committed retry'", [SECURITY_USER.id])).rows[0].count;
    await login(page); await page.getByRole("button", { name: "Add address", exact: true }).click(); await fill(page, "Committed retry", "78 Local Test Street");
    let deliver = false;
    await page.route("**/profile/addresses", async route => {
      if (!deliver && route.request().method() === "POST") { await route.fetch(); return route.abort("failed"); }
      return route.continue();
    });
    await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Couldn’t save your addresses. Try again.", { exact: true }).first()).toBeVisible();
    expect((await db.query("SELECT count(*)::int AS count FROM addresses WHERE user_id=$1", [SECURITY_USER.id])).rows[0].count).toBe(1);
    await expect(page.getByRole("dialog").getByLabel("Label", { exact: true })).toHaveValue("Committed retry");
    deliver = true;
    await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click(); await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("article", { name: "Committed retry", exact: true })).toHaveCount(1);
    expect((await db.query("SELECT count(*)::int AS count FROM addresses WHERE user_id=$1", [SECURITY_USER.id])).rows[0].count).toBe(1);
    expect((await db.query("SELECT count(*)::int AS count FROM audit_log WHERE actor_id=$1 AND action='address.saved' AND after->>'label'='Committed retry'", [SECURITY_USER.id])).rows[0].count).toBe(auditsBefore + 1);
  });
  test("a response lost after deleting returns the current list on retry", async ({ page }) => {
    const auditsBefore = (await db.query("SELECT count(*)::int AS count FROM audit_log WHERE actor_id=$1 AND action='address.deleted' AND before->>'label'='Delete retry'", [SECURITY_USER.id])).rows[0].count;
    await login(page); await page.getByRole("button", { name: "Add address", exact: true }).click(); await fill(page, "Delete retry", "90 Local Test Street");
    await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click(); await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("article", { name: "Delete retry", exact: true }).getByRole("button", { name: "Delete", exact: true }).click();
    let deliver = false;
    await page.route("**/profile/addresses", async route => {
      if (!deliver && route.request().method() === "POST") { await route.fetch(); return route.abort("failed"); }
      return route.continue();
    });
    const dialog = page.getByRole("alertdialog");
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(dialog.getByText("Couldn’t save your addresses. Try again.", { exact: true }).first()).toBeVisible();
    expect((await db.query("SELECT count(*)::int AS count FROM addresses WHERE user_id=$1", [SECURITY_USER.id])).rows[0].count).toBe(0);
    deliver = true;
    await dialog.getByRole("button", { name: "Delete", exact: true }).click(); await expect(dialog).toHaveCount(0);
    await expect(page.getByText("No saved addresses yet.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add address", exact: true })).toBeFocused();
    expect((await db.query("SELECT count(*)::int AS count FROM audit_log WHERE actor_id=$1 AND action='address.deleted' AND before->>'label'='Delete retry'", [SECURITY_USER.id])).rows[0].count).toBe(auditsBefore + 1);
  });
  test("a failed request retains the draft and retry creates one address; wrong-role route exposes no customer data", async ({ page }) => {
    await login(page); await page.getByRole("button", { name: "Add address", exact: true }).click(); await fill(page, "Retry", "56 Local Test Street");
    let deliver = false;
    await page.route("**/profile/addresses", route => !deliver && route.request().method() === "POST" ? route.abort("failed") : route.continue());
    await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Couldn’t save your addresses. Try again.", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("dialog").getByLabel("Label", { exact: true })).toHaveValue("Retry");
    deliver = true;
    await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click(); await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await db.query("SELECT count(*)::int AS count FROM addresses WHERE user_id=$1", [SECURITY_USER.id])).rows[0].count).toBe(1);
    await page.context().clearCookies(); await login(page, true); await page.goto(`${app}/profile/addresses`);
    await expect(page).toHaveURL(`${app}/jobs`); await expect(page.getByText("56 Local Test Street", { exact: true })).toHaveCount(0);
  });
});
