import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { WORK_AREA_STATES } from "../../src/lib/account/work-area";
import { expectNoA11yViolations } from "./support/a11y";
import { SECURITY_PASSWORD, SECURITY_TRADIE, SECURITY_USER, startSecurityAuthStub } from "./support/security-auth-stub";
import { VIEWPORTS } from "./support/viewports";

const preview = process.env.POSTED_PREVIEW_E2E_URL || "http://127.0.0.1:3101";
const app = process.env.WORK_AREA_E2E_APP_URL, database = process.env.WORK_AREA_E2E_DATABASE_URL;
const at = (state: string) => `${preview}/dev/components/work-area?state=${state}`;
const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test("work area previews remain guarded on production", async ({ page }) => {
  expect((await page.goto("/dev/components/work-area"))?.status()).toBe(404);
});

for (const viewport of VIEWPORTS) test(`every work area state fits and passes axe at ${viewport.width}px`, async ({ page }) => {
  test.setTimeout(180_000); await page.setViewportSize(viewport);
  for (const state of [...WORK_AREA_STATES, "gallery"]) {
    await page.goto(at(state));
    if (state === "loading") {
      const status = page.getByRole("status").filter({ hasText: "Loading work area" });
      await expect(status).toHaveCount(1); expect(await status.evaluate(element => element.closest("[inert]") === null)).toBe(true);
      await expect(page.getByRole("navigation", { name: "Account settings", exact: true })).toHaveCount(0);
      await page.keyboard.press("Tab"); expect(await page.evaluate(() => document.activeElement?.closest("[inert]") === null)).toBe(true);
    } else await expect(page.getByRole("heading", { name: "Work area", exact: true }).first()).toBeVisible();
    if (state === "saved") await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
    if (state === "field-error") await expect(page.getByText("Choose a suburb from the search results.")).toBeVisible();
    if (state === "search-unavailable") await expect(page.getByText("Suburb search is unavailable. Try again to choose a suburb.", { exact: true })).toBeVisible();
    if (state === "paused") await expect(page.getByRole("switch")).toBeDisabled();
    if (state === "from-jobs") await expect(page.getByRole("link", { name: "Back to jobs", exact: true })).toBeVisible();
    if (state === "unavailable-off") await expect(page.getByText("You won’t get job alerts.", { exact: true })).toBeVisible();
    if (state === "load-error") await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
    expect(await fits(page), state).toBe(true); await expectNoA11yViolations(page);
  }
});

test("failed suburb lookup retries and can select a point without advertising manual entry", async ({ page }) => {
  await page.goto(at("search-unavailable")); await page.getByRole("combobox").fill("Windsor");
  await expect(page.getByText(/Type your suburb or town by hand/)).toHaveCount(0);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await page.getByRole("combobox").focus(); await expect(page.getByRole("option", { name: "Windsor, Invercargill" })).toBeVisible();
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Save changes", exact: true }).click(); await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  await page.getByRole("combobox").fill("No matches"); await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByText("No suburb found. Try again or search another suburb.", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox")).toHaveValue("No matches");
  await expectNoA11yViolations(page);
});

test("keyboard radius save, selected suburb validation, availability and failed saves preserve the draft", async ({ page }) => {
  await page.goto(at("ready")); const save = page.getByRole("button", { name: "Save changes", exact: true });
  await expect(save).toHaveAttribute("aria-disabled", "true");
  await page.getByRole("radio", { name: "25 km", exact: true }).focus(); await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "50 km", exact: true })).toBeChecked();
  expect(await page.getByRole("radio", { name: "50 km", exact: true }).evaluate(element => getComputedStyle(element.nextElementSibling!).outlineStyle)).not.toBe("none");
  await save.focus(); await page.keyboard.press("Enter"); await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  await expect(save).toHaveAttribute("aria-disabled", "true");
  await page.getByRole("switch").press("Space"); await expect(page.getByRole("switch")).not.toBeChecked();
  await expect(page.getByText("You won’t get job alerts.", { exact: true })).toBeVisible();
  await expect(page.getByRole("switch")).toBeFocused();
  await page.getByRole("combobox").fill("Windsor"); await save.click();
  await expect(page.getByText("Choose a suburb from the search results.")).toBeVisible();
  await expect(page.getByRole("combobox")).toBeFocused();
  await expect(page.getByRole("option", { name: "Windsor, Invercargill" })).toBeVisible();
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter"); await save.click();
  await expect(page.getByRole("combobox")).toHaveValue("Windsor, Invercargill"); await expectNoA11yViolations(page);
  await page.goto(at("error")); await page.getByRole("combobox").fill("Windsor");
  await page.getByRole("option", { name: "Windsor, Invercargill" }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Couldn’t save.", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox")).toHaveValue("Windsor, Invercargill");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("combobox")).toHaveValue("Windsor, Invercargill"); await expectNoA11yViolations(page);
});

test.describe("real work area journey", () => {
  test.skip(!app || !database, "Needs an isolated localhost lane_c_135 database and local sign-in stand-in.");
  test.describe.configure({ mode: "serial", timeout: 120_000 });
  let db: pg.Client, auth: Awaited<ReturnType<typeof startSecurityAuthStub>>;
  const me = SECURITY_TRADIE.id, office = "13500000-0000-4000-8000-000000000099";
  test.beforeAll(async () => {
    const target = new URL(database!);
    if (!["127.0.0.1", "localhost"].includes(target.hostname) || target.pathname !== "/lane_c_135" || target.search || !["127.0.0.1", "localhost"].includes(new URL(app!).hostname)) throw Error("Use a throwaway localhost lane_c_135 database and app.");
    auth = await startSecurityAuthStub(Number(process.env.WORK_AREA_E2E_AUTH_PORT ?? 54530));
    db = new pg.Client({ connectionString: database }); await db.connect();
    for (const [id, email, role] of [[me, SECURITY_TRADIE.email, "TRADIE"], [SECURITY_USER.id, SECURITY_USER.email, "CUSTOMER"], [office, "work-area-office@example.test", "ADMIN"]]) {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2) ON CONFLICT(id) DO NOTHING", [id, email]);
      await db.query("INSERT INTO profiles(id,email,role,first_name,email_verified_at,updated_at) VALUES($1,$2,$3,'Jack',now(),now()) ON CONFLICT(id) DO UPDATE SET role=excluded.role,email_verified_at=now()", [id, email, role]);
    }
  });
  test.afterAll(async () => { await auth?.close(); await db?.end(); });
  test.beforeEach(async () => {
    auth.reset();
    await db.query("INSERT INTO worker_profiles(user_id,base_suburb,area_lat,area_lng,area_radius_km,available,identity_checked_at,identity_checked_by_id,updated_at) VALUES($1,'Invercargill',-46.4132,168.3538,25,true,now(),$2,now()) ON CONFLICT(user_id) DO UPDATE SET base_suburb='Invercargill',area_lat=-46.4132,area_lng=168.3538,area_radius_km=25,available=true,paused_at=NULL", [me, office]);
  });
  async function login(page: Page, customer = false) {
    await page.goto(`${app}/login?next=%2Fprofile%2Farea`); await page.getByLabel("Email", { exact: true }).fill(customer ? SECURITY_USER.email : SECURITY_TRADIE.email);
    await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD); await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(customer ? `${app}/` : `${app}/profile/area`);
  }
  test("checklist preview opens the real page, keyboard save persists, and Back returns to jobs", async ({ page }) => {
    await login(page); await expect(page.getByRole("heading", { level: 1, name: "Work area", exact: true })).toBeVisible();
    await page.goto(`${app}/dev/components/tradie-setup?state=new`);
    await page.getByRole("link", { name: "Add (Set your work area & job alerts)", exact: true }).press("Enter");
    await expect(page).toHaveURL(`${app}/profile/area?next=%2Fjobs`);
    await page.getByRole("radio", { name: "25 km", exact: true }).focus(); await page.keyboard.press("ArrowRight");
    await page.getByRole("button", { name: "Save changes", exact: true }).press("Enter");
    await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
    expect((await db.query("SELECT area_radius_km FROM worker_profiles WHERE user_id=$1", [me])).rows[0].area_radius_km).toBe(50);
    await page.getByRole("switch").press("Space"); await expect(page.getByRole("switch")).not.toBeChecked();
    expect((await db.query("SELECT available FROM worker_profiles WHERE user_id=$1", [me])).rows[0].available).toBe(false);
    await page.getByRole("link", { name: "Back to jobs", exact: true }).press("Enter"); await expect(page).toHaveURL(`${app}/jobs`);
    await expect(page.getByRole("heading", { name: "Welcome, Jack. Let’s get you working.", exact: true })).toBeVisible();
    await page.goto(`${app}/jobs?view=all&trade=electrical&distance=10`); await page.getByRole("link", { name: "Change it", exact: true }).click();
    await expect(page).toHaveURL(`${app}/profile/area?next=%2Fjobs%3Ftrade%3Delectrical%26distance%3D10%26view%3Dall`);
    await page.getByRole("link", { name: "Notification settings", exact: true }).click();
    await expect(page).toHaveURL(`${app}/profile/notifications?next=%2Fjobs%3Ftrade%3Delectrical%26distance%3D10%26view%3Dall`);
    await page.getByRole("link", { name: "Back to jobs", exact: true }).click(); await expect(page).toHaveURL(`${app}/jobs?trade=electrical&distance=10&view=all`);
    await page.getByRole("link", { name: "Change it", exact: true }).click(); await page.getByRole("region", { name: "Your trades", exact: true }).getByRole("link", { name: "Trades & licences", exact: true }).click();
    await expect(page).toHaveURL(`${app}/profile/trades?next=%2Fjobs%3Ftrade%3Delectrical%26distance%3D10%26view%3Dall`);
    await page.getByRole("link", { name: "Back to jobs", exact: true }).click(); await expect(page).toHaveURL(`${app}/jobs?trade=electrical&distance=10&view=all`);
    await page.getByRole("link", { name: "Change it", exact: true }).click();
    await page.getByRole("link", { name: "Back to jobs", exact: true }).click(); await expect(page).toHaveURL(`${app}/jobs?trade=electrical&distance=10&view=all`);
    await db.query("UPDATE worker_profiles SET area_lat=NULL,area_lng=NULL WHERE user_id=$1", [me]);
    await page.reload(); await expect(page.getByText("Choose your suburb and travel radius.", { exact: true })).toBeVisible();
    await expect(page.getByText("Contact us to set the area you work in.", { exact: true })).toHaveCount(0);
    await page.getByRole("link", { name: "Set your work area", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Work area", exact: true })).toBeVisible();
    await expect(page.getByRole("switch")).toBeDisabled(); await expect(page.getByText("Save your work area before turning on job alerts.", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Back to jobs", exact: true }).click(); await expect(page).toHaveURL(`${app}/jobs?trade=electrical&distance=10&view=all`);
    await page.goto(`${app}/profile/area`); await page.getByRole("link", { name: "Notification settings", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Notifications", exact: true })).toBeVisible(); await page.goBack();
    await page.getByRole("region", { name: "Your trades", exact: true }).getByRole("link", { name: "Trades & licences", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Trades & licences", exact: true })).toBeVisible(); await page.goBack();
    await expect(page.getByRole("heading", { level: 1, name: "Work area", exact: true })).toBeVisible(); await expectNoA11yViolations(page);
  });
  test("paused tradies can read but cannot save, and the role proxy refuses customers", async ({ page }) => {
    await db.query("UPDATE worker_profiles SET paused_at=now() WHERE user_id=$1", [me]);
    await login(page); await expect(page.getByText("Your account is paused.", { exact: false })).toBeVisible(); await expect(page.getByRole("switch")).toBeDisabled();
    await page.context().clearCookies(); await login(page, true);
    await page.goto(`${app}/profile/area`);
    await expect(page).toHaveURL(`${app}/`);
    await expect(page.getByRole("heading", { level: 1, name: "Work area", exact: true })).toHaveCount(0);
  });
  test("sidebar destinations preserve filtered Back at every width and default links stay unchanged", async ({ page }) => {
    await login(page);
    const back = "/jobs?trade=electrical&distance=10&view=all";
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      for (const [label, path] of [["Notifications", "/profile/notifications"], ["Trades & licences", "/profile/trades"]]) {
        await page.goto(`${app}/profile/area?next=${encodeURIComponent(back)}`);
        await expect(page.getByRole("heading", { level: 1, name: "Work area", exact: true })).toBeVisible();
        if (viewport.width < 1024) await page.locator("summary").filter({ hasText: "Account settings" }).press("Enter");
        const navigation = page.getByRole("navigation", { name: "Account settings", exact: true });
        await expect(navigation.getByRole("link", { name: "Security", exact: true })).toHaveAttribute("href", "/profile/security");
        await expectNoA11yViolations(page); expect(await fits(page)).toBe(true);
        await navigation.getByRole("link", { name: label, exact: true }).press("Enter");
        await expect(page).toHaveURL(`${app}${path}?next=${encodeURIComponent(back)}`);
        await expect(page.getByRole("heading", { level: 1, name: label, exact: true })).toBeVisible();
        if (viewport.width < 1024) await expect(page.locator("details").filter({ has: page.locator("summary").filter({ hasText: "Account settings" }) })).not.toHaveAttribute("open", "");
        await page.getByRole("link", { name: "Back to jobs", exact: true }).click(); await expect(page).toHaveURL(`${app}${back}`);
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 }); await page.goto(`${app}/profile/area`);
    await page.getByRole("navigation", { name: "Account settings", exact: true }).getByRole("link", { name: "Notifications", exact: true }).click();
    await expect(page).toHaveURL(`${app}/profile/notifications`); await expect(page.getByRole("link", { name: "Back to jobs", exact: true })).toHaveCount(0);
  });
  test("expired sessions recover and resend both area and availability saves without losing the draft", async ({ page }) => {
    await login(page); await page.getByRole("radio", { name: "25 km", exact: true }).focus(); await page.keyboard.press("ArrowRight");
    await page.context().clearCookies(); await page.getByRole("button", { name: "Save changes", exact: true }).click();
    const recover = async () => {
      await expect(page.getByRole("dialog", { name: "You’ve been logged out" })).toBeVisible();
      await page.getByRole("button", { name: "Log in again", exact: true }).click(); await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD);
      await page.getByRole("button", { name: "Log in", exact: true }).click(); await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
    };
    await recover(); await expect(page.getByRole("radio", { name: "50 km", exact: true })).toBeChecked();
    expect((await db.query("SELECT area_radius_km FROM worker_profiles WHERE user_id=$1", [me])).rows[0].area_radius_km).toBe(50);
    await page.context().clearCookies(); await page.getByRole("switch").press("Space"); await recover(); await expect(page.getByRole("switch")).not.toBeChecked();
    expect((await db.query("SELECT available FROM worker_profiles WHERE user_id=$1", [me])).rows[0].available).toBe(false);
    await expectNoA11yViolations(page);
  });
  test("expired suburb lookup recovers, retries the current query, and saves the selected point", async ({ page }) => {
    test.skip(process.env.WORK_AREA_E2E_LOOKUP_FIXTURE !== "1", "Needs the external local Mapbox stand-in, never a live token.");
    await login(page); await page.getByRole("radio", { name: "25 km", exact: true }).focus(); await page.keyboard.press("ArrowRight");
    await page.context().clearCookies(); await page.getByRole("combobox").fill("Windsor");
    await expect(page.getByRole("dialog", { name: "You’ve been logged out" })).toBeVisible();
    await page.getByRole("button", { name: "Log in again", exact: true }).click(); await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD);
    await page.getByRole("button", { name: "Log in", exact: true }).click(); await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("combobox")).toHaveValue("Windsor");
    await expect(page.getByRole("radio", { name: "50 km", exact: true })).toBeChecked();
    await expect(page.getByText("1 suggestions. Use up and down arrows, then Enter to choose.", { exact: true })).toBeVisible();
    await page.getByRole("combobox").press("ArrowDown"); await expect(page.getByRole("option", { name: "Windsor, Invercargill", exact: true })).toBeVisible(); await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Save changes", exact: true }).click(); await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
    expect((await db.query("SELECT base_suburb,area_radius_km,area_lat,area_lng FROM worker_profiles WHERE user_id=$1", [me])).rows[0]).toMatchObject({ base_suburb: "Windsor, Invercargill", area_radius_km: 50, area_lat: -46.4, area_lng: 168.36 });
    await expect(page.getByRole("navigation", { name: "Account settings", exact: true }).getByRole("link", { name: "Notifications", exact: true })).toHaveAttribute("href", "/profile/notifications");
    await expectNoA11yViolations(page);
  });
});
