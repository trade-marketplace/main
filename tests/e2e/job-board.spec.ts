import pg from "pg";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { expectNoA11yViolations } from "./support/a11y";
import { SECURITY_PASSWORD, SECURITY_TRADIE, SECURITY_USER, startSecurityAuthStub } from "./support/security-auth-stub";

const dev = process.env.E2E_DEV_BASE_URL;
const states = ["ready", "empty", "not-verified", "loading", "error", "offline", "saved", "no-photo", "pay-pending", "new-jobs", "loading-more", "storage-error"];
test("job board examples stay private on deployed/production sites", async ({ page }) => {
  const response = await page.goto("/dev/components/job-board?state=ready"); expect(response?.status()).toBe(404);
});
test.describe("guarded job board states", () => {
  test.skip(!dev, "Needs the isolated guarded development server.");
  test.use({ reducedMotion: "reduce" });
  for (const width of [320, 390, 768, 1024, 1440]) test(`all board states at ${width}px`, async ({ page }) => {
    test.setTimeout(180_000); await page.setViewportSize({ width, height: 1000 });
    for (const state of states) {
      await page.goto(`${dev}/dev/components/job-board?state=${state}${state === "saved" ? "&saved=1" : ""}`);
      await expect(page.getByRole("heading", { name: "Jobs near you", exact: true })).toBeVisible();
      if (state === "empty") await expect(page.getByRole("heading", { name: "No jobs match that.", exact: true })).toBeVisible();
      if (state === "not-verified") await expect(page.getByRole("heading", { name: "Get verified to see jobs", exact: true })).toBeVisible();
      if (state === "error") await expect(page.getByRole("heading", { name: "Can’t load your jobs", exact: true })).toBeVisible();
      if (state === "storage-error") await expect(page.getByText(/Couldn’t save your jobs on this browser/)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expectNoA11yViolations(page);
      if (process.env.BOARD_E2E_SCREENSHOTS_DIR && [390, 1440].includes(width)) await page.screenshot({ path: join(process.env.BOARD_E2E_SCREENSHOTS_DIR, `${state}-${width}.png`), fullPage: true, animations: "disabled" });
    }
  });
  test("filters, tabs, sorting and map use keyboard and URL history", async ({ page }) => {
    await page.goto(`${dev}/dev/components/job-board?state=ready`);
    const all = page.getByRole("tab", { name: /^All jobs/ }); await all.focus(); await all.press("ArrowRight");
    await expect(page).toHaveURL(/kind=ready/);
    const ready = page.getByRole("tab", { name: /^Ready to claim/ }); await ready.press("ArrowRight");
    await expect(page).toHaveURL(/kind=estimate/);
    await expect(page.getByRole("tab", { name: /^Needs a quote/ })).toBeFocused();
    await page.getByLabel("Sort by", { exact: true }).selectOption("earn"); await expect(page).toHaveURL(/sort=earn/);
    await page.getByRole("tab", { name: "Map", exact: true }).press("Enter"); await expect(page.getByRole("heading", { name: /\d+ jobs? in view/ })).toBeVisible();
    await page.getByRole("tab", { name: "Grid", exact: true }).press("Enter");
    await expect(page).not.toHaveURL(/view=map/); await expect(page).toHaveURL(/kind=estimate/);
    await page.goBack(); await expect(page.getByRole("heading", { name: /\d+ jobs? in view/ })).toBeVisible();
    await page.getByRole("tab", { name: "Grid", exact: true }).click();
    await expect(page).not.toHaveURL(/view=map/);
    await page.getByRole("tab", { name: /^Quote bounty/ }).click();
    await expect(page.locator('#board-cards [data-kind="bounty"]')).toHaveCount(5);
    await expect(page.locator('#board-cards [data-kind="estimated"]')).toHaveCount(0);
    await page.getByRole("tab", { name: /^Needs a quote/ }).click();
    await expect(page.locator("#board-cards article")).toHaveCount(6);
    await expect(page.locator('#board-cards [data-kind="bounty"]')).toHaveCount(0);
    await expectNoA11yViolations(page);
  });
  test("board boundaries at five widths keep real destinations and Back", async ({ page }) => {
    test.setTimeout(90_000);
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`${dev}/dev/components/job-board?state=ready&kind=ready`);
      await page.getByRole("link", { name: "Sub wiring", exact: true }).first().press("Enter");
      await expect(page.getByRole("heading", { name: "Sub wiring", level: 1, exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await expectNoA11yViolations(page);
      if (process.env.BOARD_E2E_SCREENSHOTS_DIR && [390, 1440].includes(width)) await page.screenshot({ path: join(process.env.BOARD_E2E_SCREENSHOTS_DIR, `detail-${width}.png`), fullPage: true, animations: "disabled" });
      await page.getByRole("link", { name: "Back to jobs", exact: true }).press("Enter"); await expect(page).toHaveURL(/kind=ready/);
      await page.getByRole("tab", { name: "Map", exact: true }).press("Enter"); await expect(page.getByRole("heading", { name: /\d+ jobs? in view/ })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await expectNoA11yViolations(page);
      if (process.env.BOARD_E2E_SCREENSHOTS_DIR && [390, 1440].includes(width)) await page.screenshot({ path: join(process.env.BOARD_E2E_SCREENSHOTS_DIR, `map-${width}.png`), fullPage: true, animations: "disabled" });
      await page.getByRole("tab", { name: "Grid", exact: true }).press("Enter"); await expect(page).toHaveURL(/kind=ready/); await expect(page).not.toHaveURL(/view=map/);
    }
  });
  test("phone cards preserve full suburbs beside the bookmark", async ({ page }) => {
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 1000 }); await page.goto(`${dev}/dev/components/job-board?state=ready`);
      const card = page.locator("#board-cards article").first(), metadata = card.getByText("<1 km · Windsor", { exact: true });
      await expect(metadata).toHaveCSS("white-space", "normal");
      expect(await metadata.evaluate(element => element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight)).toBe(true);
      const box = await metadata.boundingBox(), bookmark = await card.getByRole("button", { name: "Save Sub wiring", exact: true }).boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(bookmark!.x);
      const nearby = page.locator("#board-cards article").nth(9).getByText("1.2 km · Windsor", { exact: true });
      await expect(nearby).toBeVisible();
      expect(await nearby.evaluate(element => element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await expectNoA11yViolations(page);
      if (process.env.BOARD_E2E_SCREENSHOTS_DIR) await page.screenshot({ path: join(process.env.BOARD_E2E_SCREENSHOTS_DIR, `ready-${width}.png`), fullPage: true, animations: "disabled" });
    }
    await page.goto(`${dev}/dev/components/job-board?state=error`); await expectNoA11yViolations(page);
    if (process.env.BOARD_E2E_SCREENSHOTS_DIR) await page.screenshot({ path: join(process.env.BOARD_E2E_SCREENSHOTS_DIR, "error-390.png"), fullPage: true, animations: "disabled" });
  });
});

test.describe("signed-in eligible board", () => {
  const app = process.env.BOARD_E2E_APP_URL, database = process.env.BOARD_E2E_DATABASE_URL;
  test.skip(!app || !database, "Needs disposable localhost database and isolated Auth provider.");
  test.describe.configure({ mode: "serial", timeout: 120_000 }); test.use({ reducedMotion: "reduce" });
  let db: pg.Client, auth: Awaited<ReturnType<typeof startSecurityAuthStub>>;
  const office = "13800000-0000-4000-8000-000000000099";
  const jobId = (i: number) => `13800000-0000-4000-8000-${String(i).padStart(12, "0")}`;
  test.beforeAll(async () => {
    if (new URL(database!).hostname !== "127.0.0.1" || !/issue138|local_board/.test(new URL(database!).pathname) || !["127.0.0.1", "localhost"].includes(new URL(app!).hostname)) throw Error("Board e2e needs a disposable localhost app/database.");
    auth = await startSecurityAuthStub(Number(process.env.BOARD_E2E_AUTH_PORT ?? 54338));
    db = new pg.Client({ connectionString: database }); await db.connect();
    for (const [id, email, role] of [[SECURITY_USER.id, SECURITY_USER.email, "CUSTOMER"], [SECURITY_TRADIE.id, SECURITY_TRADIE.email, "TRADIE"], [office, "office-board@example.test", "ADMIN"]]) {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2) ON CONFLICT(id) DO NOTHING", [id, email]);
      await db.query("INSERT INTO profiles(id,email,role,first_name,email_verified_at,updated_at) VALUES($1,$2,$3,'Board Demo',now(),now()) ON CONFLICT(id) DO UPDATE SET role=excluded.role,email_verified_at=now()", [id, email, role]);
    }
    await db.query("INSERT INTO worker_profiles(user_id,identity_checked_at,identity_checked_by_id,base_suburb,area_lat,area_lng,area_radius_km,available,updated_at) VALUES($1,now(),$2,'Invercargill',-46.4132,168.3538,50,false,now()) ON CONFLICT(user_id) DO UPDATE SET identity_checked_at=now(),identity_checked_by_id=$2,paused_at=NULL,area_radius_km=50", [SECURITY_TRADIE.id, office]);
    await db.query("DELETE FROM jobs WHERE id::text LIKE '13800000-%'");
    for (let i = 1; i <= 23; i++) {
      await db.query("INSERT INTO jobs(id,customer_id,category,status,title,description,address_line1,suburb,city,lat,lng,approx_lat,approx_lng,asap,any_time) VALUES($1,$2,'OTHER','REVIEW',$3,'Call +64211111111','1 Private Street','Windsor','Invercargill',-46.4132,168.3538,-46.4117,168.3538,$4,true)", [jobId(i), SECURITY_USER.id, `Board job ${i}`, i % 2 === 0]);
      if (i % 3 === 0) {
        await db.query("INSERT INTO job_pricing(job_id,worker_rate_cents,min_minutes,holiday_pay_bps,on_cost_bps,margin_bps,gst_bps,minutes,materials_cents,worker_gross_cents,holiday_pay_cents,on_cost_cents,margin_cents,gst_cents) VALUES($1,6000,60,800,2000,2000,1500,60,0,6000,480,1000,2000,1500)", [jobId(i)]);
        await db.query("UPDATE jobs SET status='BOOKABLE',price_cents=99999 WHERE id=$1", [jobId(i)]);
      }
    }
  });
  test.afterAll(async () => { await auth?.close(); await db?.end(); });
  async function login(page: import("@playwright/test").Page, person = SECURITY_TRADIE) {
    await page.goto(`${app}/login?next=%2Fjobs`);
    await expect(async () => { await page.getByRole("button", { name: /^(Show|Hide) password$/ }).click(); await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text", { timeout: 500 }); }).toPass();
    await page.getByLabel("Email", { exact: true }).fill(person.email); await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD);
    await Promise.all([page.waitForURL(`${app}/jobs`), page.getByRole("button", { name: "Log in", exact: true }).click()]);
    await expect(page.getByRole("link", { name: person.id === SECURITY_TRADIE.id ? "Board job 1" : "Shared board job", exact: true })).toBeVisible();
  }
  test("real login → eligible data → local Saved → detail/back → map/back → empty → alerts/contact/back", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 }); await login(page);
    await expect(page.getByText("Earn $64.80", { exact: true }).first()).toBeVisible();
    expect(await page.locator("main").innerText()).not.toMatch(/99999|999\.99|Private Street|11111111/);
    const bookmark = page.getByRole("button", { name: "Save Board job 1", exact: true }); await bookmark.focus();
    await Promise.all([page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/jobs"), bookmark.press("Enter")]);
    await expect(bookmark).toBeFocused();
    await page.reload(); await expect(page.getByRole("button", { name: "Save Board job 1", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Filters", exact: true }).click(); await page.getByRole("checkbox", { name: /^Saved/ }).check();
    await expect(page).toHaveURL(/saved=1/); await expect(page.locator("#board-cards article")).toHaveCount(1);
    await Promise.all([page.waitForURL(url => url.pathname === `/jobs/${jobId(1)}`), page.getByRole("link", { name: "Board job 1", exact: true }).press("Enter")]);
    await expect(page.getByRole("heading", { name: "Board job 1", level: 1, exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Back to jobs", exact: true }).press("Enter"); await expect(page).toHaveURL(/saved=1/);
    await page.getByRole("tab", { name: "Map", exact: true }).click(); await expect(page.getByRole("heading", { name: /\d+ jobs? in view/ })).toBeVisible();
    await page.getByRole("tab", { name: "Grid", exact: true }).click(); await expect(page).not.toHaveURL(/view=map/);
    await page.goto(`${app}/jobs?trade=electrical&distance=10`); await expect(page.getByRole("heading", { name: "No jobs match that.", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Alerts settings", exact: true }).click(); await expect(page.getByRole("heading", { name: "Notifications", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Back to jobs", exact: true }).click(); await expect(page).toHaveURL(/trade=electrical&distance=10/);
    await page.getByRole("link", { name: "Contact us", exact: true }).click(); await expect(page.getByRole("heading", { name: "Get in touch", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Back to jobs", exact: true }).click(); await expect(page).toHaveURL(/trade=electrical&distance=10/);
    await expectNoA11yViolations(page);
    await page.goto(`${app}/jobs/${jobId(1)}?from=/jobs&from=/jobs`);
    await expect(page.getByRole("heading", { name: "Board job 1", level: 1, exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Back to jobs", exact: true }).click(); await expect(page).toHaveURL(`${app}/jobs`);
    await page.goto(`${app}/profile/notifications?next=/jobs&next=/jobs`);
    await expect(page.getByRole("heading", { name: "Notifications", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to jobs", exact: true })).toHaveCount(0);
    await expectNoA11yViolations(page);
    await page.goto(`${app}/jobs?trade=electrcial&when=this-week`);
    await expect(page.getByRole("link", { name: "Board job 1", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "No jobs match that.", exact: true })).toHaveCount(0);
  });
  test("real list is contained/accessible at five widths, detects new jobs without duplicates, and blocks after office pause", async ({ page }) => {
    await login(page);
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await expectNoA11yViolations(page);
      if (process.env.BOARD_E2E_SCREENSHOTS_DIR && [390, 1440].includes(width)) await page.screenshot({ path: join(process.env.BOARD_E2E_SCREENSHOTS_DIR, `actual-${width}.png`), fullPage: true, animations: "disabled" });
    }
    await expect(page.locator("#board-cards article")).toHaveCount(20);
    await page.getByRole("button", { name: "Load more jobs", exact: true }).scrollIntoViewIfNeeded();
    await expect(page.locator("#board-cards article")).toHaveCount(23);
    expect(new Set(await page.locator("#board-cards article h2").allTextContents()).size).toBe(23);
    await db.query("INSERT INTO jobs(id,customer_id,category,status,title,description,address_line1,suburb,city,lat,lng,approx_lat,approx_lng,any_time) VALUES($1,$2,'OTHER','REVIEW','New board job','Work','1 Private Street','Windsor','Invercargill',-46.4132,168.3538,-46.4120,168.3538,true)", [jobId(50), SECURITY_USER.id]);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.getByRole("button", { name: "1 new job", exact: true }).click();
    await expect(page.getByRole("link", { name: "New board job", exact: true })).toHaveCount(1);
    await db.query("UPDATE worker_profiles SET paused_at=now() WHERE user_id=$1", [SECURITY_TRADIE.id]);
    await page.reload(); await expect(page.getByRole("heading", { name: "Your account is paused", exact: true })).toBeVisible(); await expect(page.locator("#board-cards article")).toHaveCount(0);
    await db.query("UPDATE worker_profiles SET paused_at=NULL WHERE user_id=$1", [SECURITY_TRADIE.id]);
  });
  test("expired session → login → Alerts → Back preserves the filtered board", async ({ page }) => {
    await login(page);
    const board = "/jobs?trade=electrical&distance=10&sort=earn";
    const alerts = `/profile/notifications?next=${encodeURIComponent(board)}`;
    await page.goto(`${app}${board}`);
    await expect(page.getByRole("heading", { name: "No jobs match that.", exact: true })).toBeVisible();
    await page.context().clearCookies();
    await Promise.all([page.waitForURL(url => url.pathname === "/login"), page.getByRole("link", { name: "Alerts settings", exact: true }).click()]);
    expect(new URL(page.url()).searchParams.get("next")).toBe(alerts);
    await expect(async () => { await page.getByRole("button", { name: /^(Show|Hide) password$/ }).click(); await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text", { timeout: 500 }); }).toPass();
    await page.getByLabel("Email", { exact: true }).fill(SECURITY_TRADIE.email); await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD);
    await Promise.all([page.waitForURL(`${app}${alerts}`), page.getByRole("button", { name: "Log in", exact: true }).click()]);
    await expect(page.getByRole("heading", { name: "Notifications", exact: true })).toBeVisible(); await expectNoA11yViolations(page);
    await page.getByRole("link", { name: "Back to jobs", exact: true }).click(); await expect(page).toHaveURL(`${app}${board}`);
    await expect(page.getByLabel("Sort by", { exact: true })).toHaveValue("earn");
    await expect(page.getByRole("heading", { name: "No jobs match that.", exact: true })).toBeVisible(); await expectNoA11yViolations(page);
  });
  test("phone All jobs → filters → card → Back keeps its active navigation and layout", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 }); await login(page);
    const allJobs = page.getByRole("link", { name: "All jobs", exact: true });
    await Promise.all([page.waitForURL(url => url.pathname === "/jobs" && url.searchParams.get("view") === "all"), allJobs.click()]); await expect(allJobs).toHaveAttribute("aria-current", "page");
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    await page.getByLabel("Distance", { exact: true }).selectOption("10"); await page.getByLabel("Sort by", { exact: true }).selectOption("earn");
    await page.getByRole("tab", { name: /^Ready to claim/ }).click();
    await expect(page).toHaveURL(/view=all/); await expect(allJobs).toHaveAttribute("aria-current", "page");
    const back = new URL(page.url()).pathname + new URL(page.url()).search;
    await Promise.all([page.waitForURL(url => url.pathname === `/jobs/${jobId(3)}`), page.getByRole("link", { name: "Board job 3", exact: true }).press("Enter")]);
    await expect(page.getByRole("heading", { name: "Board job 3", level: 1, exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.get("view")).toBe("all"); await expect(allJobs).toHaveAttribute("aria-current", "page");
    await page.getByRole("link", { name: "Back to jobs", exact: true }).click(); await expect(page).toHaveURL(`${app}${back}`); await expect(allJobs).toHaveAttribute("aria-current", "page");
    await page.getByRole("tab", { name: "Map", exact: true }).click(); await expect(page.getByRole("heading", { name: /\d+ jobs? in view/ })).toBeVisible();
    expect(new URL(page.url()).searchParams.get("view")).toBe("all"); expect(new URL(page.url()).searchParams.get("layout")).toBe("map");
    await expect(allJobs).toHaveAttribute("aria-current", "page"); await expectNoA11yViolations(page);
    await Promise.all([page.waitForURL(url => url.pathname === "/jobs" && url.searchParams.get("view") === "all" && !url.searchParams.has("layout")), page.getByRole("tab", { name: "Grid", exact: true }).click()]);
    const filters = page.getByRole("button", { name: "Filters", exact: true }); if (await filters.getAttribute("aria-expanded") !== "true") await filters.click();
    await page.getByRole("button", { name: "Reset filters", exact: true }).click(); await expect(page).toHaveURL(`${app}/jobs?view=all`);
    await expect(allJobs).toHaveAttribute("aria-current", "page"); await expect(page.locator("#board-cards")).not.toContainText("Filters on");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await expectNoA11yViolations(page);
  });
  test("offline Saved/filter changes hide stale cards and reconnect loads the current selection", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 }); await login(page);
    await page.getByRole("button", { name: "Save Board job 1", exact: true }).click();
    await expect(page.getByRole("button", { name: "Save Board job 1", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    await page.getByRole("checkbox", { name: /^Saved/ }).check();
    await expect(page.locator("#board-cards article")).toHaveCount(1);
    let failReconnect = true, reconnectAttempts = 0;
    await page.route(url => url.origin === new URL(app!).origin && url.pathname === "/jobs", route => {
      if (route.request().method() === "POST" && failReconnect) { reconnectAttempts++; return route.abort("failed"); }
      return route.continue();
    });
    let offlinePosts = 0;
    const requested = (request: import("@playwright/test").Request) => { if (request.method() === "POST" && new URL(request.url()).pathname === "/jobs") offlinePosts++; };
    await page.context().setOffline(true); page.on("request", requested);
    try {
      // The unchanged snapshot remains useful until a data selection no longer matches it.
      await expect(page.getByRole("link", { name: "Board job 1", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Save Board job 1", exact: true }).click();
      await expect(page.locator("#board-cards article")).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Can’t load your jobs", exact: true })).toBeVisible();
      await expect(page.getByRole("checkbox", { name: "Saved", exact: true })).toBeChecked();
      await expect(page.getByRole("tab", { name: "All jobs", exact: true })).toBeVisible();
      await page.getByRole("checkbox", { name: "Saved", exact: true }).uncheck();
      await page.getByLabel("Distance", { exact: true }).selectOption("10");
      await page.getByRole("tab", { name: "Ready to claim", exact: true }).click();
      await expect(page).toHaveURL(/kind=ready&distance=10/);
      await expect(page.getByLabel("Distance", { exact: true })).toHaveValue("10");
      await expect(page.locator("#board-cards article")).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Can’t load your jobs", exact: true })).toBeVisible();
      await expectNoA11yViolations(page); expect(offlinePosts).toBe(0);
    } finally { page.off("request", requested); await page.context().setOffline(false); }
    await expect.poll(() => reconnectAttempts).toBeGreaterThan(0);
    await expect(page.getByRole("heading", { name: "Can’t load your jobs", exact: true })).toBeVisible();
    await expect(page.locator("#board-cards article")).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Ready to claim", exact: true })).toBeVisible();
    await expectNoA11yViolations(page);
    failReconnect = false;
    await page.locator("#board-cards").getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page.getByRole("link", { name: "Board job 3", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Board job 1", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Can’t load your jobs", exact: true })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: /^Ready to claim/ })).toHaveAttribute("aria-selected", "true");
    await expectNoA11yViolations(page);
  });
  test("online changed-selection failure hides old cards until Retry while a same-selection failure keeps its cache", async ({ page }) => {
    await login(page);
    let failLoads = true, failures = 0;
    await page.route(url => url.origin === new URL(app!).origin && url.pathname === "/jobs", route => {
      if (route.request().method() === "POST" && failLoads) { failures++; return route.abort("failed"); }
      return route.continue();
    });
    await page.getByRole("tab", { name: /^Ready to claim/ }).click();
    await expect.poll(() => failures).toBeGreaterThan(0);
    await expect(page.getByRole("heading", { name: "Can’t load your jobs", exact: true })).toBeVisible();
    await expect(page.locator("#board-cards article")).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Ready to claim", exact: true })).toBeVisible();
    await expectNoA11yViolations(page);
    failLoads = false;
    await page.locator("#board-cards").getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page.getByRole("link", { name: "Board job 3", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Board job 1", exact: true })).toHaveCount(0);
    const readyCount = await page.locator("#board-cards article").count();
    failLoads = true; const previousFailures = failures;
    await page.context().setOffline(true);
    await expect(page.getByRole("link", { name: "Board job 3", exact: true })).toBeVisible();
    await page.context().setOffline(false);
    await expect.poll(() => failures).toBeGreaterThan(previousFailures);
    await expect(page.getByText("Can’t load your jobs. Check your connection and try again.", { exact: true }).first()).toBeVisible();
    await expect(page.locator("#board-cards article")).toHaveCount(readyCount);
    await expect(page.getByRole("heading", { name: "Can’t load your jobs", exact: true })).toHaveCount(0);
    failLoads = false;
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page.getByText("Can’t load your jobs. Check your connection and try again.", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Board job 3", exact: true })).toBeVisible();
    await expectNoA11yViolations(page);
  });
  test("ASAP jobs show their matching Flexible or This week schedule under those filters", async ({ page }) => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    await db.query("INSERT INTO job_time_windows(job_id,date,time_of_day) VALUES($1,$2::date,'MORNING') ON CONFLICT DO NOTHING", [jobId(2), today]);
    await page.setViewportSize({ width: 390, height: 900 }); await login(page);
    const card = page.locator("#board-cards article").filter({ has: page.getByRole("link", { name: "Board job 2", exact: true }) }).locator("..");
    await expect(card.getByText("ASAP", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    await page.getByRole("checkbox", { name: "ASAP", exact: true }).uncheck();
    await page.getByRole("checkbox", { name: "This week", exact: true }).uncheck();
    await expect(page).toHaveURL(/when=flexible/);
    await expect(card.getByText("Flexible", { exact: true })).toBeVisible();
    await expect(card.getByText("ASAP", { exact: true })).toHaveCount(0);
    await page.getByRole("checkbox", { name: "This week", exact: true }).check();
    await page.getByRole("checkbox", { name: "Flexible", exact: true }).uncheck();
    await expect(page).toHaveURL(/when=week/);
    await expect(card.getByText(/Morning/)).toBeVisible();
    await expect(card.getByText("ASAP", { exact: true })).toHaveCount(0);
    await expectNoA11yViolations(page);
    await page.getByRole("checkbox", { name: "ASAP", exact: true }).check();
    await expect(card.getByText("ASAP", { exact: true })).toBeVisible();
    await expectNoA11yViolations(page);
  });
  test("failed browser storage never pretends to save a bookmark", async ({ page }) => {
    await page.addInitScript(() => { const write = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key.startsWith("trade.jobs.saved.")) throw Error("quota"); return write.call(this, key, value); }; });
    await login(page); await page.getByRole("button", { name: "Save Board job 1", exact: true }).click();
    await expect(page.getByText(/Couldn’t save your jobs on this browser/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Save Board job 1", exact: true })).toHaveAttribute("aria-pressed", "false");
  });
  test("Saved survives returning to an account and never follows a switch to another owner", async ({ page }) => {
    await login(page); await page.getByRole("button", { name: "Save Board job 1", exact: true }).click();
    await db.query("UPDATE profiles SET role='TRADIE' WHERE id=$1", [SECURITY_USER.id]);
    await db.query("INSERT INTO worker_profiles(user_id,identity_checked_at,identity_checked_by_id,base_suburb,area_lat,area_lng,area_radius_km,updated_at) VALUES($1,now(),$2,'Invercargill',-46.4132,168.3538,50,now()) ON CONFLICT(user_id) DO UPDATE SET identity_checked_at=now(),identity_checked_by_id=$2", [SECURITY_USER.id, office]);
    await db.query("INSERT INTO jobs(id,customer_id,category,status,title,description,address_line1,suburb,city,lat,lng,approx_lat,approx_lng,any_time) VALUES($1,$2,'OTHER','REVIEW','Shared board job','Work','1 Private Street','Windsor','Invercargill',-46.4132,168.3538,-46.4117,168.3538,true)", [jobId(60), office]);
    try {
      await page.context().clearCookies(); await login(page, SECURITY_USER);
      await expect(page.getByRole("button", { name: "Save Shared board job", exact: true })).toHaveAttribute("aria-pressed", "false");
      await page.goto(`${app}/jobs?saved=1`); await expect(page.getByRole("heading", { name: "No jobs match that.", exact: true })).toBeVisible();
      await page.context().clearCookies(); await login(page); await expect(page.getByRole("button", { name: "Save Board job 1", exact: true })).toHaveAttribute("aria-pressed", "true");
    } finally { await db.query("UPDATE profiles SET role='CUSTOMER' WHERE id=$1", [SECURITY_USER.id]); }
  });
});
