import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { expect, test, type Page } from "@playwright/test";
import { sessionCookies } from "../../scripts/screenshots/auth-stub";
import { startPricingServiceStub } from "./support/pricing-service-stub";
import { expectNoA11yViolations } from "./support/a11y";

const app = process.env.OFFICE_VARIATION_E2E_APP_URL, database = process.env.OFFICE_VARIATION_E2E_DATABASE_URL;
const authUrl = "http://127.0.0.1:54402";
test.describe("extra-work pricing through real office routes, private Storage and PostgreSQL", () => {
  test.skip(!app || !database, "Needs isolated localhost issue169 app/database and local Auth/Storage double");
  test.describe.configure({ mode: "serial" });
  let db: pg.Client, services: Awaited<ReturnType<typeof startPricingServiceStub>>, secret: string;
  const office = { id: randomUUID(), email: "office169@example.test" }, customer = { id: randomUUID(), email: "customer169@example.test" }, worker = { id: randomUUID(), email: "worker169@example.test" };
  const jobs = Array.from({ length: 6 }, () => randomUUID()), variations = jobs.map(() => randomUUID());
  const title = (index: number) => `Variation browser fixture ${index}`;
  const queue = "/admin?tab=extra";
  const route = (index: number, back = queue) => `${app}/admin/variations/${variations[index]}?${new URLSearchParams({ from: back })}`;
  const errors = new WeakMap<Page, string[]>();
  test.beforeEach(async ({ page }) => { const list: string[] = []; errors.set(page, list); page.on("pageerror", error => list.push(error.message)); });
  test.afterEach(async ({ page }) => { expect(errors.get(page), "No runtime errors").toEqual([]); });
  test.beforeAll(async () => {
    if (!["localhost", "127.0.0.1"].includes(new URL(app!).hostname) || !["localhost", "127.0.0.1"].includes(new URL(database!).hostname) || new URL(database!).pathname !== "/issue169") throw new Error("Disposable localhost issue169 app/database required");
    secret = randomBytes(32).toString("hex"); services = await startPricingServiceStub(secret, 54402);
    db = new pg.Client({ connectionString: database }); await db.connect();
    for (const [person, role, first] of [[office, "ADMIN", "Matt"], [customer, "CUSTOMER", "Sarah"], [worker, "TRADIE", "Jack"]] as const) {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [person.id, person.email]);
      await db.query("INSERT INTO profiles(id,email,role,first_name,last_name,email_verified_at) VALUES($1,$2,$3,$4,'Fixture',now())", [person.id, person.email, role, first]);
    }
    const photo = await readFile("public/images/examples/switch.jpg");
    for (let index = 0; index < jobs.length; index++) {
      const requestKey = randomUUID();
      await db.query("INSERT INTO jobs(id,customer_id,category,title,description,address_line1,suburb,city,status,price_cents) VALUES($1,$2,'ELECTRICAL',$3,'Replace a switch.','Private address canary169','Windsor','Invercargill','REVIEW',null)", [jobs[index], customer.id, title(index)]);
      await db.query("INSERT INTO job_pricing(job_id,worker_rate_cents,min_minutes,holiday_pay_bps,on_cost_bps,margin_bps,gst_bps,minutes,materials_cents,worker_gross_cents,holiday_pay_cents,on_cost_cents,margin_cents,gst_cents) VALUES($1,7000,120,800,1250,2000,1500,120,0,14000,1120,1890,3402,3062)", [jobs[index]]);
      await db.query("UPDATE jobs SET status='ASSIGNED',worker_id=$1,price_cents=23474 WHERE id=$2", [worker.id, jobs[index]]);
      await db.query("INSERT INTO variations(id,job_id,requested_by_id,description,requested_minutes,requested_materials_cents,request_key) VALUES($1,$2,$3,'Replace second cracked switch',30,1000,$4)", [variations[index], jobs[index], worker.id, requestKey]);
      const path = `variations/${jobs[index]}/${worker.id}/${randomUUID().replaceAll("-", "")}.webp`; services.seed(path, photo);
      await db.query("INSERT INTO variation_photos(path,job_id,variation_id,uploaded_by_id,request_key,ready,position) VALUES($1,$2,$3,$4,$5,true,0)", [path, jobs[index], variations[index], worker.id, requestKey]);
    }
  });
  test.afterAll(async () => {
    if (db) {
      await db.query("DELETE FROM payments WHERE job_id=ANY($1::uuid[])", [jobs]);
      await db.query("DELETE FROM jobs WHERE id=ANY($1::uuid[])", [jobs]);
      const ids = [office.id, customer.id, worker.id]; await db.query("DELETE FROM profiles WHERE id=ANY($1::uuid[])", [ids]); await db.query("DELETE FROM auth.users WHERE id=ANY($1::uuid[])", [ids]); await db.end();
    }
    await services?.close();
  });
  async function signIn(page: Page, person = office) { await page.context().clearCookies(); await page.context().addCookies(await sessionCookies(person, secret, app!, authUrl)); }
  test("queue→private request/photos→cancel→publish→same queue; customer opens canonical notification destination", async ({ page }) => {
    test.setTimeout(120_000); await signIn(page); await page.goto(`${app}${queue}`);
    const row = page.getByRole("table", { name: "Extra work", exact: true }).getByRole("row").filter({ hasText: title(0) });
    await row.getByRole("link", { name: "Price it", exact: true }).click(); await expect(page).toHaveURL(route(0));
    await expect(page.getByRole("heading", { name: "Tradie request", exact: true })).toBeVisible();
    const image = page.locator('ul[aria-label="Photos"] img').first(); await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    const send = page.getByRole("button", { name: "Send price to customer", exact: true }); await send.focus(); await send.press("Enter");
    const confirm = page.getByRole("alertdialog", { name: "Send price to customer", exact: true }); await expect(confirm).toContainText("$72.50"); await expect(confirm).not.toContainText("Margin");
    await confirm.getByRole("button", { name: "Not now", exact: true }).click(); await expect(send).toBeFocused();
    expect((await db.query("SELECT status,revision FROM variations WHERE id=$1", [variations[0]])).rows[0]).toMatchObject({ status: "REQUESTED", revision: 0 });
    await send.click(); await confirm.getByRole("button", { name: "Send price to customer", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Price sent to customer", exact: true })).toBeVisible();
    expect((await db.query("SELECT status,revision,price_cents,requested_minutes FROM variations WHERE id=$1", [variations[0]])).rows[0]).toMatchObject({ status: "PRICED", revision: 1, price_cents: 7250, requested_minutes: 30 });
    expect((await db.query("SELECT count(*) FROM notifications WHERE user_id=$1 AND type='variation.priced'", [customer.id])).rows[0].count).toBe("1");
    await page.getByRole("link", { name: "Back to queues", exact: true }).click(); await expect(page).toHaveURL(`${app}${queue}`);
    await expect(page.getByRole("table", { name: "Extra work", exact: true })).not.toContainText(title(0));
    await signIn(page, customer); await page.goto(`${app}/notifications`); await page.getByRole("main").getByRole("button", { name: /Extra-work price ready/ }).click(); await expect(page).toHaveURL(`${app}/jobs/${jobs[0]}`, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: title(0), exact: true })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Margin");
    await page.getByRole("navigation", { name: /Back ·/ }).getByRole("link", { name: "Home", exact: true }).click(); await expect(page).toHaveURL(`${app}/`);
    expect(services.events.some(event => event.path.startsWith("/storage/v1/object/sign/photos/variations/"))).toBe(true);
  });
  test("changed request rejects captured confirmation, retains draft until explicit reload and requires confirmation again", async ({ page }) => {
    await signIn(page); await page.goto(route(1)); await page.getByRole("button", { name: "Send price to customer", exact: true }).click();
    await db.query("UPDATE variations SET description='Changed request from tradie' WHERE id=$1", [variations[1]]);
    await page.getByRole("alertdialog").getByRole("button", { name: "Send price to customer", exact: true }).click();
    await expect(page.getByText("Extra work changed", { exact: true })).toBeVisible();
    expect((await db.query("SELECT status,revision FROM variations WHERE id=$1", [variations[1]])).rows[0]).toMatchObject({ status: "REQUESTED", revision: 0 });
    await page.getByRole("button", { name: "Reload latest", exact: true }).click(); await expect(page.getByText("Changed request from tradie", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Send price to customer", exact: true }).click(); await expect(page.getByRole("alertdialog")).toContainText("Changed request from tradie");
    await page.getByRole("alertdialog").getByRole("button", { name: "Not now", exact: true }).click();
  });
  test("terminal saved/no-price workspaces are read-only and preserve filtered queue return through sign-in", async ({ page }) => {
    await db.query("UPDATE jobs SET status='CANCELLED' WHERE id=$1", [jobs[2]]);
    const filtered = "/admin?tab=extra&q=Variation&page=2";
    await page.context().clearCookies(); await page.goto(route(2, filtered)); await expect(page).toHaveURL(/\/login\?/);
    const next = new URL(page.url()).searchParams.get("next"); expect(next).toBe(route(2, filtered).slice(app!.length));
    await signIn(page); await page.goto(`${app}${next}`); await expect(page.getByText("This workspace is read-only.", { exact: true })).toBeVisible(); await expect(page.getByText("No price has been saved.", { exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Hours", exact: true })).toBeDisabled(); await page.getByRole("link", { name: "Back to queues", exact: true }).click(); await expect(page).toHaveURL(`${app}${filtered}`);
    await db.query("INSERT INTO payments(job_id,variation_id,variation_revision,kind,status,amount_cents,paid_at,idempotency_key) VALUES($1,$2,1,'VARIATION','PAID',7250,now(),$3)", [jobs[0], variations[0], randomUUID()]);
    await db.query("UPDATE variations SET status='APPROVED' WHERE id=$1", [variations[0]]); await page.goto(route(0)); await expect(page.getByRole("region", { name: "Price breakdown", exact: true })).toContainText("$72.50"); await expect(page.getByRole("button", { name: "Send price to customer", exact: true })).toHaveCount(0);
  });
  test("offline draft survives, reconnect recalculates, invalid values reject and pending payment cannot be repriced", async ({ page, context }) => {
    await db.query("UPDATE variations SET status='PRICED',revision=1,minutes=30,materials_cents=1000,worker_gross_cents=3500,holiday_pay_cents=280,on_cost_cents=473,margin_cents=1051,gst_cents=946,price_cents=7250 WHERE id=$1", [variations[3]]);
    await signIn(page); await page.setViewportSize({ width: 390, height: 844 }); await page.goto(route(3));
    const hours = page.getByRole("textbox", { name: "Hours", exact: true }), materials = page.getByRole("textbox", { name: "Materials", exact: true }), send = page.getByRole("button", { name: "Send price to customer", exact: true });
    await context.setOffline(true); await hours.fill("1.5"); await materials.fill("20.50"); await expect(send).toHaveAttribute("aria-disabled", "true"); await context.setOffline(false); await expect(send).not.toHaveAttribute("aria-disabled", "true");
    await hours.fill("101"); await expect(hours).toHaveAccessibleDescription(/no more than 100 hours/); await hours.fill("1.5"); await expect(send).not.toHaveAttribute("aria-disabled", "true");
    await db.query("INSERT INTO payments(job_id,variation_id,variation_revision,kind,amount_cents,idempotency_key,provider_payment_id) VALUES($1,$2,1,'VARIATION',7250,$3,'pi_local_processing')", [jobs[3], variations[3], randomUUID()]);
    await send.click(); await page.getByRole("alertdialog").getByRole("button", { name: "Send price to customer", exact: true }).click(); await expect(page.getByRole("alertdialog")).toContainText("A payment is being checked.");
    await page.getByRole("alertdialog").getByRole("button", { name: "Not now", exact: true }).click(); await expect(hours).toHaveValue("1.5"); await expect(materials).toHaveValue("20.50"); await expectNoA11yViolations(page);
    expect((await db.query("SELECT status FROM variations WHERE id=$1", [variations[3]])).rows[0].status).toBe("PRICED");
  });
  test("every actual viewport fits, expired sessions retain inputs and other roles cannot read office payload", async ({ page, context }) => {
    await signIn(page);
    for (const width of [320, 390, 768, 1024, 1440]) { await page.setViewportSize({ width, height: 900 }); await page.goto(route(4)); await expect(page.getByRole("heading", { name: "Set the price", exact: true })).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0); await expectNoA11yViolations(page); }
    await context.clearCookies(); await page.getByRole("textbox", { name: "Hours", exact: true }).fill("2"); await expect(page.getByRole("heading", { name: /logged out/i })).toBeVisible(); await expect(page.getByRole("textbox", { name: "Hours", exact: true, includeHidden: true })).toHaveValue("2");
    for (const person of [customer, worker]) { await signIn(page, person); const response = await page.goto(route(4)); expect(page.url()).not.toContain("/admin"); expect(await response!.text()).not.toMatch(/Replace second cracked switch|Tradie earns|Margin|storage\/v1/); }
    expect((await db.query("SELECT status FROM variations WHERE id=$1", [variations[4]])).rows[0].status).toBe("REQUESTED");
  });
});
