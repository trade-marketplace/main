import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

import { expectNoA11yViolations } from "./support/a11y";
import { SECURITY_PASSWORD, SECURITY_TRADIE, startSecurityAuthStub } from "./support/security-auth-stub";
import { VIEWPORTS } from "./support/viewports";

// Tradie home · setup checklist (D01, #132).
// 1. Every state at the five widths on the guarded preview (the second server in playwright.config.ts), in CI.
// 2. The real /jobs journey, signed in, against a disposable local database. Opt in with a local build that uses
//    the sign-in stand-in (never Supabase):
//      NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54432 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_screenshots_stub npm run build
//      DATABASE_URL=postgresql://postgres@127.0.0.1:5433/issue132 DIRECT_URL=$DATABASE_URL npm run start -- --port 3232   (after prisma migrate deploy)
//      TRADIE_SETUP_E2E_APP_URL=http://127.0.0.1:3232 TRADIE_SETUP_E2E_DATABASE_URL=postgresql://postgres@127.0.0.1:5433/issue132 npx playwright test tests/e2e/tradie-setup.spec.ts
const preview = process.env.POSTED_PREVIEW_E2E_URL || "http://127.0.0.1:3101";
const app = process.env.TRADIE_SETUP_E2E_APP_URL, database = process.env.TRADIE_SETUP_E2E_DATABASE_URL;
const at = (state: string) => `${preview}/dev/components/tradie-setup?state=${state}`;
const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const welcome = (page: Page) => page.getByRole("heading", { level: 1, name: "Welcome, Jack. Let’s get you working.", exact: true });

test("setup checklist examples stay private on deployed/production sites", async ({ page }) => {
  expect((await page.goto("/dev/components/tradie-setup"))?.status()).toBe(404);
});

test.describe("setup checklist states", () => {
  test.use({ reducedMotion: "reduce" });
  for (const viewport of VIEWPORTS) test(`every state fits and passes axe at ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(120_000); await page.setViewportSize({ width: viewport.width, height: viewport.height });
    // Pending verification, as drawn in the mockup: 3 of 6, licence with the office.
    await page.goto(at("pending")); await expect(welcome(page)).toBeVisible();
    await expect(page.getByText("Finish these and you can claim jobs. You can browse while we check your licence.", { exact: true })).toBeVisible();
    await expect(page.getByRole("progressbar", { name: "Get set up" })).toHaveAttribute("aria-valuetext", "3 of 6 done");
    const steps = page.getByRole("list").filter({ hasText: "Licence check" }).getByRole("listitem");
    await expect(steps).toHaveCount(6);
    await expect(steps.nth(2)).toContainText("Checking"); await expect(steps.nth(2).getByRole("link")).toHaveCount(0);
    await expect(steps.nth(0).locator("s")).toHaveText("Verify your email");
    await expect(page.getByRole("heading", { name: "While you wait", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "How it works", exact: true })).toBeVisible();
    expect(await fits(page)).toBe(true); await expectNoA11yViolations(page);

    await page.goto(at("new")); await expect(page.getByText("0 of 5", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Send the link again (Verify your email)", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "While you wait", exact: true })).toHaveCount(0);
    expect(await fits(page)).toBe(true); await expectNoA11yViolations(page);

    await page.goto(at("other-only")); await expect(page.getByText("3 of 5", { exact: true })).toBeVisible();
    await expect(page.getByText("Licence check", { exact: true })).toHaveCount(0);
    expect(await fits(page)).toBe(true); await expectNoA11yViolations(page);

    for (const [state, pill, action] of [["rejected", "Rejected", "Try again"], ["expired", "Expired", "Update"]]) {
      await page.goto(at(state)); await expect(page.getByText(pill, { exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: `${action} (Licence check)`, exact: true })).toBeVisible();
      expect(await fits(page)).toBe(true); await expectNoA11yViolations(page);
    }

    await page.goto(at("cannot-browse")); await expect(page.getByText("Finish these and you can claim jobs.", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Browse jobs", exact: true })).toHaveCount(0);
    expect(await fits(page)).toBe(true); await expectNoA11yViolations(page);

    await page.goto(at("loading")); await expect(welcome(page)).toBeVisible();
    await expect(page.locator("[aria-busy=true]")).toBeVisible(); await expect(page.getByText("Licence check", { exact: true })).toHaveCount(0);
    expect(await fits(page)).toBe(true); await expectNoA11yViolations(page);

    await page.goto(at("error")); await expect(page.getByRole("heading", { name: "Can’t load your setup", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
    expect(await fits(page)).toBe(true); await expectNoA11yViolations(page);

    // The board keeps a slim banner until setup is done; it opens the checklist.
    await page.goto(at("board")); await expect(page.getByRole("heading", { name: "Jobs near you", exact: true })).toBeVisible();
    const finish = page.getByRole("link", { name: "Finish setup (4/6)", exact: true }); await expect(finish).toBeVisible();
    expect(await fits(page)).toBe(true); await expectNoA11yViolations(page);
    await finish.click(); await expect(welcome(page)).toBeVisible();
  });

  for (const viewport of VIEWPORTS) test(`every action is a real link and Back returns to the checklist at ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(120_000); await page.setViewportSize({ width: viewport.width, height: viewport.height });
    // The preview server is signed out, so each settings page answers with its log-in guard, still carrying the
    // destination and the way back. The signed-in journey below opens the pages themselves.
    for (const [state, name, path] of [["pending", "Add (Add bank account & IRD number)", "/profile/payroll"], ["pending", "Upload (Add a profile photo)", "/profile"], ["new", "Add (Add your trades)", "/profile/trades"],
      ["new", "Add (Set your work area & job alerts)", "/profile/area"], ["rejected", "Try again (Licence check)", "/profile/trades"], ["pending", "Browse jobs", "/jobs"]] as const) {
      await page.goto(at(state)); await expect(welcome(page)).toBeVisible();
      await page.getByRole("link", { name, exact: true }).click();
      await expect.poll(() => decodeURIComponent(decodeURIComponent(page.url()))).toContain(name === "Browse jobs" ? "/jobs?view=all" : `${path}?next=/jobs`);
      await page.goBack(); await expect(welcome(page)).toBeVisible(); await expect(page).toHaveURL(at(state));
    }
  });

  test("keyboard reaches every action in order with a visible focus ring, and clicks leave none", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 }); await page.goto(at("pending")); await expect(welcome(page)).toBeVisible();
    const bank = page.getByRole("link", { name: "Add (Add bank account & IRD number)", exact: true }), photo = page.getByRole("link", { name: "Upload (Add a profile photo)", exact: true }), browse = page.getByRole("link", { name: "Browse jobs", exact: true });
    await page.locator("#main").focus();
    await page.keyboard.press("Tab"); await expect(bank).toBeFocused();
    expect(await bank.evaluate(element => element.matches(":focus-visible"))).toBe(true);
    await page.keyboard.press("Tab"); await expect(photo).toBeFocused();
    await page.keyboard.press("Tab"); await expect(browse).toBeFocused();
    await page.keyboard.press("Enter"); await expect(page).not.toHaveURL(at("pending"));
    await page.goBack(); await expect(welcome(page)).toBeVisible();
    await page.mouse.move(0, 0); await bank.dispatchEvent("pointerdown"); await bank.evaluate(element => (element as HTMLElement).focus());
    expect(await bank.evaluate(element => getComputedStyle(element).outlineStyle)).toBe("none");
  });
});

test.describe("real /jobs setup journey, signed in", () => {
  test.skip(!app || !database, "Needs a disposable localhost issue132 database and the isolated sign-in stand-in.");
  test.describe.configure({ mode: "serial", timeout: 120_000 }); test.use({ reducedMotion: "reduce" });
  let db: pg.Client, auth: Awaited<ReturnType<typeof startSecurityAuthStub>>;
  const office = "13200000-0000-4000-8000-000000000099", me = SECURITY_TRADIE.id;
  test.beforeAll(async () => {
    const target = new URL(database!);
    if (!["127.0.0.1", "localhost"].includes(target.hostname) || target.pathname !== "/issue132" || target.search || !["127.0.0.1", "localhost"].includes(new URL(app!).hostname)) throw new Error("Setup e2e needs a disposable localhost issue132 database and app.");
    auth = await startSecurityAuthStub(Number(process.env.TRADIE_SETUP_E2E_AUTH_PORT ?? 54432));
    db = new pg.Client({ connectionString: database }); await db.connect();
    for (const [id, email, role] of [[me, SECURITY_TRADIE.email, "TRADIE"], [office, "office-setup@example.test", "ADMIN"]]) {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2) ON CONFLICT(id) DO NOTHING", [id, email]);
      await db.query("INSERT INTO profiles(id,email,role,first_name,email_verified_at,updated_at) VALUES($1,$2,$3,'Jack',now(),now()) ON CONFLICT(id) DO UPDATE SET role=excluded.role,first_name='Jack',email_verified_at=now()", [id, email, role]);
    }
  });
  test.afterAll(async () => { await auth?.close(); await db?.end(); });
  // The mockup's tradie: email and trades done, electrical licence with the office, work area set, no bank, no photo.
  test.beforeEach(async () => {
    auth.reset();
    await db.query("UPDATE profiles SET avatar_path=NULL,email_verified_at=now() WHERE id=$1", [me]);
    await db.query("DELETE FROM payroll_details WHERE user_id=$1", [me]); await db.query("DELETE FROM worker_trades WHERE user_id=$1", [me]);
    await db.query("INSERT INTO worker_profiles(user_id,identity_checked_at,identity_checked_by_id,base_suburb,area_lat,area_lng,area_radius_km,updated_at) VALUES($1,now(),$2,'Invercargill',-46.4132,168.3538,25,now()) ON CONFLICT(user_id) DO UPDATE SET identity_checked_at=now(),identity_checked_by_id=$2,paused_at=NULL,base_suburb='Invercargill',area_lat=-46.4132,area_lng=168.3538,area_radius_km=25", [me, office]);
    await db.query("INSERT INTO worker_trades(user_id,trade) VALUES($1,'ELECTRICAL')", [me]);
    await db.query("INSERT INTO licences(user_id,trade,number,expires_on) VALUES($1,'ELECTRICAL','E 220981','2027-03-31')", [me]);
  });
  const savePayroll = () => db.query("INSERT INTO payroll_details(user_id,ird_number_encrypted,ird_number_last3,bank_account_encrypted,bank_account_last4,tax_code,updated_at) VALUES($1,'local-test','123','local-test','0001','M',now())", [me]);
  async function login(page: Page) {
    await page.goto(`${app}/login?next=%2Fjobs`); await page.getByLabel("Email", { exact: true }).fill(SECURITY_TRADIE.email); await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD);
    await page.getByRole("button", { name: "Log in", exact: true }).click(); await expect(page).toHaveURL(`${app}/jobs`);
  }
  const done = (page: Page, count: string) => expect(page.getByRole("progressbar", { name: "Get set up" })).toHaveAttribute("aria-valuetext", `${count} done`);

  for (const viewport of VIEWPORTS) test(`a new tradie lands on the checklist; every action opens its page and comes back at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height }); await login(page);
    await expect(welcome(page)).toBeVisible(); await done(page, "3 of 6");
    await expect(page.getByRole("listitem").filter({ hasText: "Licence check" })).toContainText("Checking");
    expect(await fits(page)).toBe(true); await expectNoA11yViolations(page);

    // Bank & IRD: the page's own "Back to jobs" link returns to the checklist.
    await page.getByRole("link", { name: "Add (Add bank account & IRD number)", exact: true }).click();
    await expect(page).toHaveURL(`${app}/profile/payroll?next=%2Fjobs`); await expect(page.getByRole("heading", { level: 1, name: "Bank & tax", exact: true })).toBeVisible();
    expect(await fits(page)).toBe(true); await expectNoA11yViolations(page);
    await page.getByRole("link", { name: "Back to jobs", exact: true }).click(); await expect(page).toHaveURL(`${app}/jobs`); await expect(welcome(page)).toBeVisible();

    // Profile photo and trades: browser Back returns too, and a step finished meanwhile shows as done.
    await page.getByRole("link", { name: "Upload (Add a profile photo)", exact: true }).click();
    await expect(page).toHaveURL(`${app}/profile?next=%2Fjobs`); await expect(page.getByRole("heading", { level: 1, name: "Profile", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to jobs", exact: true })).toBeVisible();
    await savePayroll();
    await page.goBack(); await expect(page).toHaveURL(`${app}/jobs`); await expect(welcome(page)).toBeVisible(); await done(page, "4 of 6");
    await expect(page.getByRole("link", { name: "Add (Add bank account & IRD number)", exact: true })).toHaveCount(0);

    // Work area & job alerts (#135) isn't built yet: the link is real and Back still returns.
    await db.query("UPDATE worker_profiles SET area_lat=NULL,area_lng=NULL WHERE user_id=$1", [me]);
    await page.reload(); await done(page, "3 of 6");
    await expect(page.getByRole("link", { name: "Browse jobs", exact: true })).toHaveCount(0);
    await page.getByRole("link", { name: "Add (Set your work area & job alerts)", exact: true }).click();
    await expect(page).toHaveURL(`${app}/profile/area?next=%2Fjobs`);
    // Leaving for a 404 is a full page load, and Back can replay Next's cached redirect for /jobs, which leaves its
    // internal ?_rsc= marker in the address. The checklist still comes back; the marker goes when #135 adds the page.
    await page.goBack(); await expect(page).toHaveURL(/\/jobs(\?_rsc=[\w-]+)?$/); await expect(welcome(page)).toBeVisible(); await done(page, "3 of 6");
  });

  test("a rejected licence goes back to the tradie through Trades & licences", async ({ page }) => {
    await db.query("UPDATE licences SET status='REJECTED',rejection_reason='Photo is blurry',checked_at=now(),checked_by_id=$2 WHERE user_id=$1", [me, office]);
    await login(page);
    const row = page.getByRole("listitem").filter({ hasText: "Licence check" }); await expect(row).toContainText("Rejected");
    await row.getByRole("link", { name: "Try again (Licence check)", exact: true }).press("Enter");
    await expect(page).toHaveURL(`${app}/profile/trades?next=%2Fjobs`); await expect(page.getByRole("heading", { level: 1, name: "Trades & licences", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Back to jobs", exact: true }).press("Enter"); await expect(welcome(page)).toBeVisible();
  });

  test("Browse jobs opens the board with the slim banner; a finished setup makes /jobs the board", async ({ page }) => {
    await login(page); await expect(welcome(page)).toBeVisible();
    await page.getByRole("link", { name: "Browse jobs", exact: true }).click();
    await expect(page).toHaveURL(`${app}/jobs?view=all`); await expect(page.getByRole("heading", { level: 1, name: "Jobs near you", exact: true })).toBeVisible();
    const finish = page.getByRole("link", { name: "Finish setup (3/6)", exact: true }); await expect(finish).toBeVisible();
    expect(await fits(page)).toBe(true); await expectNoA11yViolations(page);
    await finish.click(); await expect(page).toHaveURL(`${app}/jobs`); await expect(welcome(page)).toBeVisible();

    await savePayroll(); await db.query("UPDATE profiles SET avatar_path=$2 WHERE id=$1", [me, `avatars/${me}/${"a".repeat(32)}.webp`]);
    await db.query("UPDATE licences SET status='VERIFIED',checked_at=now(),checked_by_id=$2 WHERE user_id=$1", [me, office]);
    await page.goto(`${app}/jobs`); await expect(page.getByRole("heading", { level: 1, name: "Jobs near you", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /Finish setup/ })).toHaveCount(0);
  });

  test("an Other-only tradie has no licence step", async ({ page }) => {
    await db.query("DELETE FROM worker_trades WHERE user_id=$1", [me]); await db.query("INSERT INTO worker_trades(user_id,trade) VALUES($1,'OTHER')", [me]);
    await login(page); await done(page, "3 of 5");
    await expect(page.getByText("Licence check", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Finish these and you can claim jobs.", { exact: true })).toBeVisible();
  });
});
