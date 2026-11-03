import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { expect, test, type Page } from "@playwright/test";
import { sessionCookies } from "../../scripts/screenshots/auth-stub";
import { startPricingServiceStub } from "./support/pricing-service-stub";
import { expectNoA11yViolations } from "./support/a11y";

const app = process.env.OFFICE_PRICING_E2E_APP_URL, database = process.env.OFFICE_PRICING_E2E_DATABASE_URL;
const authUrl = "http://127.0.0.1:54168";
test.describe("office pricing through signed-in routes, SDK Storage and PostgreSQL", () => {
  test.skip(!app || !database, "Needs isolated localhost app/Auth/Storage and disposable issue168 database");
  test.describe.configure({ mode: "serial" });
  let originalRate: number | undefined;
  let db: pg.Client, services: Awaited<ReturnType<typeof startPricingServiceStub>>, secret: string;
  const office = { id: randomUUID(), email: "office168@example.test" }, customer = { id: randomUUID(), email: "customer168@example.test" };
  const worker = { id: randomUUID(), email: "worker168@example.test" }, nextWorker = { id: randomUUID(), email: "nextworker168@example.test" }, foreign = { id: randomUUID(), email: "foreign168@example.test" };
  const jobs = Array.from({ length: 6 }, () => randomUUID()), titles = jobs.map((_, index) => `Pricing browser fixture ${index}`), legacyThread = randomUUID();
  const problems = new WeakMap<Page, string[]>();
  const priceUrl = (id: string) => `${app}/admin/jobs/${id}/price`;
  const money = (cents: number) => new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(cents / 100);
  test.beforeEach(async ({ page }) => {
    const errors: string[] = []; problems.set(page, errors);
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", entry => { if (entry.type() === "error" && /hydrat|react error|cannot update|rendering/i.test(entry.text())) errors.push(entry.text()); });
  });
  test.afterEach(async ({ page }) => { expect(problems.get(page), "No hydration/runtime errors on the real pricing journey").toEqual([]); });
  test.beforeAll(async () => {
    if (!["127.0.0.1", "localhost"].includes(new URL(app!).hostname) || !["127.0.0.1", "localhost"].includes(new URL(database!).hostname) || new URL(database!).pathname !== "/issue168") throw new Error("Disposable localhost issue168 app/database required");
    secret = randomBytes(32).toString("hex"); services = await startPricingServiceStub(secret);
    db = new pg.Client({ connectionString: database }); await db.connect();
    originalRate = (await db.query("SELECT other_rate_cents FROM settings WHERE id=1")).rows[0].other_rate_cents;
    await db.query("UPDATE settings SET other_rate_cents=3800 WHERE id=1");
    for (const [person, role, first] of [[office, "ADMIN", "Matt"], [customer, "CUSTOMER", "Sarah"], [worker, "TRADIE", "Jack"], [nextWorker, "TRADIE", "Aroha"], [foreign, "CUSTOMER", "Foreign"]] as const) {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [person.id, person.email]);
      await db.query("INSERT INTO profiles(id,email,role,first_name,last_name,email_verified_at) VALUES($1,$2,$3,$4,'Fixture',now())", [person.id, person.email, role, first]);
    }
    const statuses = ["REVIEW", "REVIEW", "REVIEW", "PRICED", "REVIEW", "CANCELLED"];
    for (let index = 0; index < jobs.length; index++) await db.query("INSERT INTO jobs(id,customer_id,category,title,description,address_line1,suburb,city,status,price_cents,created_at) VALUES($1,$2,'OTHER',$3,'The hinge is loose.','1 Private Pricing Fixture Street','Windsor','Invercargill',$4,$5,now()-interval '26 hours')", [jobs[index], customer.id, titles[index], statuses[index], index === 3 ? 14123 : null]);
    await db.query("INSERT INTO job_pricing(job_id,worker_rate_cents,min_minutes,holiday_pay_bps,on_cost_bps,margin_bps,gst_bps,minutes,materials_cents,worker_gross_cents,holiday_pay_cents,on_cost_cents,margin_cents,gst_cents,priced_by_id) VALUES($1,3800,60,800,1250,2000,1500,120,1000,7600,608,1026,2047,1842,$2)", [jobs[3], office.id]);
    const image = await readFile("public/images/examples/switch.jpg");
    for (const id of [jobs[0], jobs[2]]) {
      const path = `jobs/${id}/${"a".repeat(32)}.webp`; services.seed(path, image);
      await db.query("INSERT INTO job_photos(job_id,uploaded_by_id,path,position) VALUES($1,$2,$3,0)", [id, customer.id, path]);
    }
    for (const [id, minutes, materials] of [[worker.id, 90, 500], [nextWorker.id, 150, 1500]] as const) await db.query("INSERT INTO estimates(job_id,worker_id,minutes,materials_cents,note) VALUES($1,$2,$3,$4,'Estimate fixture note')", [jobs[0], id, minutes, materials]);
    await db.query("INSERT INTO support_threads(id,user_id,job_id,subject) VALUES($1,$2,$3,'Legacy private thread')", [legacyThread, customer.id, jobs[2]]);
    await db.query("INSERT INTO support_messages(thread_id,author_id,body) VALUES($1,$2,'Legacy private canary168')", [legacyThread, office.id]);
  });
  test.afterAll(async () => {
    if (db) {
      if (originalRate !== undefined) await db.query("UPDATE settings SET other_rate_cents=$1 WHERE id=1", [originalRate]);
      await db.query("DELETE FROM support_threads WHERE job_id=ANY($1::uuid[])", [jobs]);
      await db.query("DELETE FROM support_photo_cleanup WHERE path LIKE ANY($1::text[])", [jobs.map(id => `support/${id}/%`)]);
      await db.query("DELETE FROM jobs WHERE id=ANY($1::uuid[])", [jobs]);
      const ids = [office.id, customer.id, worker.id, nextWorker.id, foreign.id];
      await db.query("DELETE FROM profiles WHERE id=ANY($1::uuid[])", [ids]); await db.query("DELETE FROM auth.users WHERE id=ANY($1::uuid[])", [ids]); await db.end();
    }
    await services?.close();
  });
  async function signIn(page: Page, person = office) { await page.context().clearCookies(); await page.context().addCookies(await sessionCookies(person, secret, app!, authUrl)); }
  async function readyPrice(page: Page, hours = "2", materials = "10.00") {
    await page.getByRole("textbox", { name: "Hours", exact: true }).fill(hours);
    await page.getByRole("textbox", { name: "Materials", exact: true }).fill(materials);
    await expect(page.getByRole("button", { name: "Send price to customer", exact: true })).not.toHaveAttribute("aria-disabled", "true");
  }
  test("office queue→real workspace/photos→cancel confirmation→send→queue count drops and saved snapshot stays frozen", async ({ page }) => {
    test.setTimeout(120_000); await signIn(page); await page.goto(`${app}/admin`);
    await expect(page.getByRole("link", { name: "Queues, 4 waiting", exact: true })).toBeVisible();
    const row = page.getByRole("table", { name: "To price", exact: true }).getByRole("row").filter({ hasText: titles[0] });
    await row.getByRole("link", { name: "Price it", exact: true }).click();
    await expect(page).toHaveURL(priceUrl(jobs[0])); await expect(page.getByRole("heading", { name: "Set the price", exact: true })).toBeVisible();
    const image = page.locator('ul[aria-label="Photos"] img').first(); await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await expect(page.getByRole("table", { name: "Blind estimates", exact: true })).toContainText("Jack F");
    await page.getByRole("button", { name: "Send price to customer", exact: true }).click();
    const confirm = page.getByRole("alertdialog", { name: "Send price to customer", exact: true }); await expect(confirm).toContainText("$141.23");
    for (const label of ["Margin", "Tradie earns", "Blind estimates"]) await expect(confirm.getByText(label, { exact: true })).toHaveCount(0);
    await confirm.getByRole("button", { name: "Not now", exact: true }).click();
    expect((await db.query("SELECT status FROM jobs WHERE id=$1", [jobs[0]])).rows[0].status).toBe("REVIEW");
    expect((await db.query("SELECT count(*) FROM job_pricing WHERE job_id=$1", [jobs[0]])).rows[0].count).toBe("0");
    await page.getByRole("button", { name: "Send price to customer", exact: true }).click(); await confirm.getByRole("button", { name: "Send price to customer", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Price sent to customer", exact: true })).toBeVisible();
    expect((await db.query("SELECT status,price_cents FROM jobs WHERE id=$1", [jobs[0]])).rows[0]).toMatchObject({ status: "PRICED", price_cents: 14123 });
    expect((await db.query("SELECT count(*) FROM notifications WHERE user_id=$1 AND type='job.priced'", [customer.id])).rows[0].count).toBe("1");
    await page.getByRole("link", { name: "Back to queues", exact: true }).click(); await expect(page.getByRole("link", { name: "Queues, 3 waiting", exact: true })).toBeVisible();
    await expect(page.getByRole("table", { name: "To price", exact: true })).not.toContainText(titles[0]);
    await db.query("UPDATE settings SET other_rate_cents=4200 WHERE id=1"); await page.goto(priceUrl(jobs[0]));
    await expect(page.getByText("This job’s price is saved. This workspace is read-only.", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Price breakdown", exact: true })).toContainText("$141.23");
    await expect(page.getByRole("textbox", { name: "Hours", exact: true })).toBeDisabled(); await db.query("UPDATE settings SET other_rate_cents=3800 WHERE id=1");
  });
  test("a changed rate rejects the open confirmation and needs a fresh explicit confirmation", async ({ page }) => {
    await signIn(page); await page.goto(priceUrl(jobs[1])); await readyPrice(page);
    await page.getByRole("button", { name: "Send price to customer", exact: true }).click();
    const confirm = page.getByRole("alertdialog", { name: "Send price to customer", exact: true }); await expect(confirm).toContainText("$141.23");
    await db.query("UPDATE settings SET other_rate_cents=4200 WHERE id=1"); await confirm.getByRole("button", { name: "Send price to customer", exact: true }).click();
    const changed = page.getByRole("alert").filter({ hasText: "The job or its rates changed. Check the latest breakdown before sending." });
    await expect(changed).toBeVisible();
    expect((await db.query("SELECT status FROM jobs WHERE id=$1", [jobs[1]])).rows[0].status).toBe("REVIEW");
    await changed.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page.getByRole("button", { name: "Send price to customer", exact: true })).not.toHaveAttribute("aria-disabled", "true");
    await expect(page.getByRole("region", { name: "Price breakdown", exact: true })).not.toContainText("$141.23");
    await page.getByRole("button", { name: "Send price to customer", exact: true }).click();
    const finalText = await confirm.locator("dd").first().innerText(); await confirm.getByRole("button", { name: "Send price to customer", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Price sent to customer", exact: true })).toBeVisible();
    expect(money((await db.query("SELECT price_cents FROM jobs WHERE id=$1", [jobs[1]])).rows[0].price_cents)).toBe(finalText);
  });
  test("photo request→actual customer notification→readable thread→reply/photo; future assignee sees ordinary messages while foreign/legacy access stays denied", async ({ page }) => {
    test.setTimeout(180_000); await signIn(page); await page.goto(priceUrl(jobs[2]));
    await page.getByRole("button", { name: "Ask for more photos", exact: true }).click();
    const ask = page.getByRole("dialog", { name: "Ask for more photos", exact: true }); await expect(ask).toContainText("Shared with the customer, assigned tradie and office.");
    const body = "Please send a close photo of the hinge."; await ask.getByRole("textbox", { name: "Message to customer", exact: true }).fill(body); await ask.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByText("Message sent.", { exact: true }).first()).toBeVisible();
    const threadId = (await db.query("SELECT id FROM support_threads WHERE job_id=$1 AND job_participants", [jobs[2]])).rows[0].id;
    await db.query("INSERT INTO support_messages(thread_id,author_id,body,internal) VALUES($1,$2,'Internal margin canary168',true)", [threadId, office.id]);
    await signIn(page, customer); await page.goto(`${app}/notifications`); await page.getByRole("main").getByRole("button", { name: /New message/ }).click();
    await expect(page).toHaveURL(`${app}/messages/${threadId}`, { timeout: 30_000 }); await expect(page.getByRole("log")).toContainText(body);
    await expect(page.locator("body")).not.toContainText("Internal margin canary168"); await expect(page.locator("body")).not.toContainText("Legacy private canary168");
    await page.getByLabel("Add photo", { exact: true }).setInputFiles("public/images/examples/switch.jpg");
    const reply = page.getByRole("textbox", { name: "Message", exact: true }); await reply.fill("Here is the hinge photo.");
    await page.getByRole("button", { name: "Send", exact: true }).click(); await expect(reply).toHaveValue("");
    await page.reload(); await expect(page.getByRole("log")).toContainText("Here is the hinge photo.");
    const photo = page.getByRole("img", { name: "Message photo 1", exact: true }); await expect.poll(() => photo.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    expect((await db.query("SELECT count(*) FROM support_message_photos p JOIN support_messages m ON m.id=p.message_id WHERE m.thread_id=$1", [threadId])).rows[0].count).toBe("1");
    await db.query("UPDATE jobs SET status='ASSIGNED',worker_id=$1,price_cents=12000 WHERE id=$2", [worker.id, jobs[2]]);
    await signIn(page, worker); await page.goto(`${app}/messages/${threadId}`); await expect(page.getByRole("log")).toContainText(body); await expect(page.getByRole("log")).toContainText("Here is the hinge photo.");
    await expect(page.locator("body")).not.toContainText("Internal margin canary168"); await expect(page.locator("body")).not.toContainText("Legacy private canary168");
    await db.query("UPDATE jobs SET worker_id=$1 WHERE id=$2", [nextWorker.id, jobs[2]]);
    for (const [person, deniedId] of [[worker, threadId], [foreign, threadId], [customer, legacyThread]] as const) {
      await signIn(page, person); const denied = await page.goto(`${app}/messages/${deniedId}?fresh=1`);
      await expect(page.getByRole("heading", { name: "Wrong address.", exact: true })).toBeVisible();
      expect(await denied!.text()).not.toMatch(/Please send a close photo|Here is the hinge photo|Internal margin canary168|Legacy private canary168/);
    }
    expect(services.events.some(event => event.path === "/auth/v1/user")).toBe(true);
    expect(services.events.some(event => event.method === "POST" && event.path.startsWith("/storage/v1/object/photos/support/"))).toBe(true);
  });
  test("actual390 read-only/never-priced states fit, preserve stored inputs and pass axe", async ({ page }) => {
    await signIn(page); await page.setViewportSize({ width: 390, height: 844 }); await page.goto(priceUrl(jobs[3]));
    await expect(page.getByRole("textbox", { name: "Hours", exact: true })).toHaveValue("2"); await expect(page.getByRole("textbox", { name: "Hours", exact: true })).toBeDisabled();
    await expect(page.getByRole("region", { name: "Price breakdown", exact: true })).toContainText("$141.23"); await expectNoA11yViolations(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    await page.goto(priceUrl(jobs[5])); await expect(page.getByText("No price has been saved.", { exact: true })).toBeVisible();
    await expect(page.getByText("This job’s price is saved. This workspace is read-only.", { exact: true })).toHaveCount(0);
  });
  test("expired sessions retain entered fields without a write, and customer/tradie sessions cannot read office pricing", async ({ page, context }) => {
    await signIn(page); await page.goto(priceUrl(jobs[4])); await readyPrice(page); await context.clearCookies();
    await page.getByRole("textbox", { name: "Hours", exact: true }).fill("3");
    await expect(page.getByRole("heading", { name: /logged out/i })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Hours", exact: true, includeHidden: true })).toHaveValue("3");
    expect((await db.query("SELECT count(*) FROM job_pricing WHERE job_id=$1", [jobs[4]])).rows[0].count).toBe("0");
    for (const person of [customer, worker]) {
      await signIn(page, person); const response = await page.goto(priceUrl(jobs[4]));
      expect(page.url()).not.toContain("/admin"); expect(await response!.text()).not.toContain("Set the price");
    }
  });
  test("actual offline form retains a draft, reconnect recalculates and validation stays on the real server", async ({ page, context }) => {
    await signIn(page); await page.setViewportSize({ width: 390, height: 844 }); await page.goto(priceUrl(jobs[4]));
    const hours = page.getByRole("textbox", { name: "Hours", exact: true }), materials = page.getByRole("textbox", { name: "Materials", exact: true });
    await context.setOffline(true); await expect(page.getByRole("button", { name: "Send price to customer", exact: true })).toHaveAttribute("aria-disabled", "true");
    await hours.fill("2.5"); await materials.fill("11.23"); await expect(hours).toHaveValue("2.5"); await context.setOffline(false);
    await expect(page.getByRole("button", { name: "Send price to customer", exact: true })).not.toHaveAttribute("aria-disabled", "true");
    await hours.fill("bad"); await expect(hours).toHaveAttribute("aria-invalid", "true"); await readyPrice(page, "2.5", "11.23");
    await expectNoA11yViolations(page); expect((await db.query("SELECT count(*) FROM job_pricing WHERE job_id=$1", [jobs[4]])).rows[0].count).toBe("0");
  });
});
