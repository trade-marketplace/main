import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { BOOKING_STATES } from "../../src/lib/worker-booking";
import { postingDays } from "../../src/lib/job-time-windows";
import { expectNoA11yViolations } from "./support/a11y";
import { SECURITY_PASSWORD, SECURITY_TRADIE, SECURITY_USER, startSecurityAuthStub } from "./support/security-auth-stub";
const preview = process.env.BOOK_E2E_PREVIEW_URL || process.env.POSTED_PREVIEW_E2E_URL || "http://127.0.0.1:3101";
test("booking previews retain the ordinary production 404 guard", async ({ page }) => { expect((await page.goto("/dev/components/worker-book?state=pick"))?.status()).toBe(404); });
for (const width of [320, 390, 768, 1024, 1440]) test(`booking states at ${width}px`, async ({ page }) => {
  test.setTimeout(180_000); await page.setViewportSize({ width, height: 900 });
  for (const state of BOOKING_STATES) await test.step(state, async () => {
    expect((await page.goto(`${preview}/dev/components/worker-book?state=${state}`))?.status()).toBe(200);
    if (state === "loading") await expect(page.getByRole("status", { name: "Loading times" })).toBeVisible();
    else if (state === "load-error") await expect(page.getByRole("heading", { name: "Couldn’t load times" })).toBeVisible();
    else await expect(page.getByRole("heading", { name: "Pick a time", exact: true })).toBeVisible();
    if (state === "any-time") { await expect(page.getByRole("radio")).toHaveCount(21); await expect(page.getByText("Any time works for Sarah.")).toBeVisible(); }
    if (state === "none-left") { await expect(page.getByRole("radio")).toHaveCount(0); await expect(page.getByText("None of Sarah’s times are left.")).toBeVisible(); }
    if (state === "changed") await expect(page.getByText("The times changed. Pick again.")).toBeVisible();
    if (state === "asked") await expect(page.getByText("Sarah’s been asked for more times.")).toBeVisible();
    if (state === "booked") await expect(page.getByText("Booked: Thu 12 Nov · Morning")).toBeVisible();
    if (state === "offline") await expect(page.getByRole("button", { name: "Suggest other times", exact: true })).toHaveAttribute("aria-disabled", "true");
    if (state === "error") await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await expectNoA11yViolations(page);
    if (process.env.BOOK_SCREENSHOTS_DIR && [390, 1440].includes(width)) await page.screenshot({ path: `${process.env.BOOK_SCREENSHOTS_DIR}/${state}-${width}.png`, fullPage: true });
  });
});
test("persistent assigned-job entry preview is fully rendered at every width", async ({ page }) => {
  test.setTimeout(120_000);
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 }); await page.goto(`${preview}/dev/components/worker-book?view=entry`);
    await expect(page.getByRole("heading", { name: "Sub wiring", exact: true })).toBeVisible(); await expect(page.getByRole("link", { name: "Book a time", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await expectNoA11yViolations(page);
  }
});
test("keyboard booking, rescheduling, requests and Back preserve the job journey", async ({ page }) => {
  await page.goto(`${preview}/dev/components/worker-book?state=pick`);
  const morning = page.getByRole("group", { name: "Thu 12 Nov" }).getByRole("radio", { name: "Morning" });
  await morning.focus(); await morning.press("Space"); await expect(morning).toBeChecked(); expect(await morning.evaluate(input => getComputedStyle(input.nextElementSibling!).outlineStyle)).not.toBe("none");
  await page.getByRole("button", { name: "Book Thu 12 Nov · Morning", exact: true }).press("Enter");
  await expect(page.getByRole("heading", { name: "Sub wiring", exact: true })).toBeVisible(); await expect(page.getByRole("status").filter({ hasText: "Booked Thu 12 Nov · Morning" })).toBeVisible();
  await page.getByRole("link", { name: "Book a time", exact: true }).press("Enter"); await page.getByRole("link", { name: "Back to job", exact: true }).press("Enter"); await expect(page.getByRole("heading", { name: "Sub wiring", exact: true })).toBeVisible();
  await page.goto(`${preview}/dev/components/worker-book?state=booked`); await page.getByRole("group", { name: "Fri 13 Nov" }).getByRole("radio", { name: "Evening" }).check(); await page.getByRole("button", { name: "Change to Fri 13 Nov · Evening" }).click(); await expect(page.getByRole("status").filter({ hasText: "Changed to Fri 13 Nov · Evening" })).toBeVisible();
  await page.goto(`${preview}/dev/components/worker-book?state=changed`); await page.getByRole("group", { name: "Thu 12 Nov" }).getByRole("radio", { name: "Morning" }).check(); await page.getByRole("button", { name: "Book Thu 12 Nov · Morning", exact: true }).click();
  await expect(page.getByText("The times changed. Pick again.")).toBeVisible(); await expect(page.getByRole("radio")).toHaveCount(1); await page.getByRole("group", { name: "Sun 15 Nov" }).getByRole("radio", { name: "Morning" }).check(); await page.getByRole("button", { name: "Book Sun 15 Nov · Morning", exact: true }).click(); await expect(page.getByRole("heading", { name: "Sub wiring", exact: true })).toBeVisible();
  await page.goto(`${preview}/dev/components/worker-book?state=pick`); await page.getByRole("button", { name: "Suggest other times" }).click(); await expect(page.getByText("Sarah’s been asked for more times.")).toBeVisible(); await expectNoA11yViolations(page);
});
test.describe("real booking command journey", () => {
  const app = process.env.BOOK_E2E_APP_URL, database = process.env.BOOK_E2E_DATABASE_URL;
  test.skip(!app || !database, "Requires the dedicated localhost lane_b_146 app/database and fake Auth.");
  test.describe.configure({ mode: "serial", timeout: 120_000 });
  let db: pg.Client, auth: Awaited<ReturnType<typeof startSecurityAuthStub>>;
  const id = randomUUID(), day = postingDays(new Date())[1], date = { ...day, label: day.label.replace(",", "") };
  test.beforeAll(async () => {
    const url = new URL(database!); if (url.hostname !== "127.0.0.1" || url.pathname !== "/lane_b_146" || url.search || url.hash || !["127.0.0.1", "localhost"].includes(new URL(app!).hostname)) throw Error("Requires isolated lane_b_146 localhost fixture");
    auth = await startSecurityAuthStub(Number(process.env.BOOK_E2E_AUTH_PORT ?? 54520)); db = new pg.Client({ connectionString: database }); await db.connect();
    for (const [user, role, name] of [[SECURITY_USER, "CUSTOMER", "Sarah"], [SECURITY_TRADIE, "TRADIE", "Jack"]] as const) {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2) ON CONFLICT(id) DO NOTHING", [user.id, user.email]);
      await db.query("INSERT INTO profiles(id,email,role,first_name,email_verified_at,updated_at) VALUES($1,$2,$3,$4,now(),now()) ON CONFLICT(id) DO UPDATE SET role=excluded.role,email_verified_at=now()", [user.id, user.email, role, name]);
    }
    await db.query("INSERT INTO jobs(id,customer_id,worker_id,status,category,title,description,address_line1,suburb,city,price_cents,updated_at) VALUES($1,$2,$3,'PRICED','OTHER','Real booking job','Check wiring','146 Private Street','Windsor','Invercargill',12000,now())", [id, SECURITY_USER.id, SECURITY_TRADIE.id]);
    await db.query("INSERT INTO job_pricing(job_id,worker_rate_cents,min_minutes,holiday_pay_bps,on_cost_bps,margin_bps,gst_bps,minutes,materials_cents,worker_gross_cents,holiday_pay_cents,on_cost_cents,margin_cents,gst_cents) VALUES($1,7000,120,800,1250,2000,1500,120,1500,14000,1120,1890,3702,3032)", [id]);
    await db.query("UPDATE jobs SET status='ASSIGNED' WHERE id=$1", [id]);
    await db.query("INSERT INTO job_time_windows(job_id,date,time_of_day) VALUES($1,$2,'MORNING'),($1,$2,'AFTERNOON')", [id, date.value]);
  });
  test.afterAll(async () => { await db?.end(); await auth?.close(); });
  test("existing auth redirects are retained and other tradies and statuses see the not-found view", async ({ page }) => {
    const next = `/jobs/${id}/book`;
    await page.goto(`${app}/login?next=${encodeURIComponent(next)}`); await page.getByLabel("Email", { exact: true }).fill(SECURITY_TRADIE.email); await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD); await page.getByRole("button", { name: "Log in", exact: true }).click(); await expect(page).toHaveURL(`${app}${next}`);
    const other = randomUUID(); await db.query("INSERT INTO auth.users(id) VALUES($1)", [other]); await db.query("INSERT INTO profiles(id,email,role,first_name,updated_at) VALUES($1,$2,'TRADIE','Other',now())", [other, `${other}@example.test`]);
    await db.query("UPDATE jobs SET worker_id=$2 WHERE id=$1", [id, other]); const response = await page.request.get(`${app}${next}`); expect([200, 404]).toContain(response.status()); const body = await response.text(); expect(body).toContain("Wrong address."); expect(body).not.toMatch(/Real booking job|146 Private Street/);
    await db.query("UPDATE jobs SET worker_id=$2,status='SUBMITTED' WHERE id=$1", [id, SECURITY_TRADIE.id]); const submitted = await page.goto(`${app}${next}`); expect([200, 404]).toContain(submitted?.status()); await expect(page.getByRole("heading", { name: "Wrong address.", exact: true })).toBeVisible(); expect(await page.locator("main").innerText()).not.toMatch(/Real booking job|146 Private Street/);
    await db.query("UPDATE jobs SET status='ASSIGNED' WHERE id=$1", [id]);
    await page.context().clearCookies(); await page.goto(`${app}/login?next=${encodeURIComponent(next)}`); await page.getByLabel("Email", { exact: true }).fill(SECURITY_USER.email); await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD); await page.getByRole("button", { name: "Log in", exact: true }).click(); await expect(page).toHaveURL(`${app}/`);
    await page.goto(`${app}${next}`); await expect(page).toHaveURL(`${app}/`);
    await page.context().clearCookies(); await page.goto(`${app}${next}`); await expect(page).toHaveURL(/\/login\?next=/);
  });
  test("books through the action, returns with toast, reschedules and goes Back", async ({ page }) => {
    const next = `/jobs/${id}`; await page.goto(`${app}/login?next=${encodeURIComponent(next)}`); await page.getByRole("textbox", { name: "Email", exact: true }).fill(SECURITY_TRADIE.email); await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD); await page.getByRole("button", { name: "Log in", exact: true }).click(); await expect(page).toHaveURL(`${app}${next}`);
    await page.getByRole("link", { name: "Book a time", exact: true }).press("Enter"); await expect(page).toHaveURL(`${app}${next}/book`);
    expect(await page.locator("main").innerText()).not.toContain("146 Private Street");
    await page.getByRole("radio", { name: "Morning", exact: true }).focus(); await page.getByRole("radio", { name: "Morning", exact: true }).press("Space");
    await page.context().setOffline(true); await expect(page.getByText("You’re offline.", { exact: true })).toHaveCount(1);
    await expect(page.getByRole("button", { name: `Book ${date.label} · Morning`, exact: true })).toHaveAttribute("aria-disabled", "true");
    await page.getByRole("button", { name: `Book ${date.label} · Morning`, exact: true }).press("Enter");
    expect((await db.query("SELECT booked_time FROM jobs WHERE id=$1", [id])).rows[0].booked_time).toBeNull();
    await page.context().setOffline(false); await expect(page.getByRole("button", { name: `Book ${date.label} · Morning`, exact: true })).toBeEnabled();
    await page.getByRole("button", { name: `Book ${date.label} · Morning`, exact: true }).press("Enter"); await expect(page).toHaveURL(`${app}/jobs/${id}`); await expect(page.getByRole("status").filter({ hasText: `Booked ${date.label} · Morning` })).toBeVisible();
    expect((await db.query("SELECT booked_time FROM jobs WHERE id=$1", [id])).rows[0].booked_time).toBe("MORNING");
    await page.reload(); await expect(page.getByRole("link", { name: "Book a time", exact: true })).toBeVisible(); await page.getByRole("link", { name: "Book a time", exact: true }).click(); await expect(page).toHaveURL(`${app}${next}/book`); await page.getByRole("radio", { name: "Afternoon", exact: true }).check(); await page.getByRole("button", { name: `Change to ${date.label} · Afternoon`, exact: true }).click(); await expect(page).toHaveURL(`${app}/jobs/${id}`); await expect(page.getByRole("status").filter({ hasText: `Changed to ${date.label} · Afternoon` })).toBeVisible();
    await page.getByRole("link", { name: "Book a time", exact: true }).click(); await expect(page).toHaveURL(`${app}${next}/book`); await page.getByRole("button", { name: "Suggest other times", exact: true }).click(); await expect(page.getByText("Sarah’s been asked for more times.")).toBeVisible(); await page.getByRole("link", { name: "Back to job", exact: true }).press("Enter"); await expect(page).toHaveURL(`${app}/jobs/${id}`);
    expect((await db.query("SELECT count(*)::int AS count FROM notifications WHERE type='job.window_booked' AND payload->>'jobId'=$1", [id])).rows[0].count).toBe(2);
    expect((await db.query("SELECT booked_time FROM jobs WHERE id=$1", [id])).rows[0].booked_time).toBe("AFTERNOON");
    const missing = await page.request.get(`${app}/jobs/${randomUUID()}/book`); expect([200, 404]).toContain(missing.status()); expect(await missing.text()).toContain("Wrong address.");
    await page.context().clearCookies(); await page.goto(`${app}/login?next=%2Fnotifications`); await page.getByLabel("Email", { exact: true }).fill(SECURITY_USER.email); await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD); await page.getByRole("button", { name: "Log in", exact: true }).click(); await expect(page).toHaveURL(`${app}/notifications`);
    const requestNotice = (await db.query("SELECT id FROM notifications WHERE type='job.reschedule_requested' AND payload->>'jobId'=$1", [id])).rows[0];
    await page.getByRole("button", { name: /New time requested/ }).and(page.locator(`[id="${requestNotice.id}"]`)).press("Enter"); await expect(page).toHaveURL(url => url.pathname === `/jobs/${id}`); await expect(page.getByRole("heading", { name: "Real booking job", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Time windows", exact: true }).press("Enter"); await expect(page.getByRole("heading", { name: "When do you need it?", exact: true })).toBeVisible(); await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeEnabled(); await expectNoA11yViolations(page);
    await page.getByRole("button", { name: "Any time", exact: true }).press("Enter"); await page.getByRole("button", { name: "Save changes", exact: true }).press("Enter"); await expect.poll(async () => (await db.query("SELECT any_time FROM jobs WHERE id=$1", [id])).rows[0].any_time).toBe(true);
    expect((await db.query("SELECT booked_time FROM jobs WHERE id=$1", [id])).rows[0].booked_time).toBe("AFTERNOON");
    await page.getByRole("link", { name: "Back", exact: true }).press("Enter"); await expect(page.getByRole("heading", { name: "Real booking job", exact: true })).toBeVisible(); await expectNoA11yViolations(page);

  });
});
