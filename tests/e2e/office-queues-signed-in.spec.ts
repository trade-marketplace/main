import { randomBytes, randomUUID } from "node:crypto";
import type { Server } from "node:http";
import pg from "pg";
import { expect, test, type Page } from "@playwright/test";
import { sessionCookies, startAuthStub } from "../../scripts/screenshots/auth-stub";
import { expectNoA11yViolations } from "./support/a11y";

const app = process.env.OFFICE_QUEUES_E2E_APP_URL, database = process.env.OFFICE_QUEUES_E2E_DATABASE_URL;
test.describe("office queues against signed-in routes and PostgreSQL", () => {
  test.skip(!app || !database, "Requires isolated localhost app/Auth and disposable issue167 database");
  test.describe.configure({ mode: "serial" });
  let db: pg.Client, auth: Server, secret: string;
  const browserProblems = new WeakMap<Page, string[]>();
  test.beforeEach(async ({ page }) => {
    const problems: string[] = []; browserProblems.set(page, problems);
    page.on("pageerror", error => problems.push(error.message));
    page.on("console", message => { if (message.type() === "error" && /hydrat|react error|cannot update|rendering/i.test(message.text())) problems.push(message.text()); });
  });
  test.afterEach(async ({ page }) => { expect(browserProblems.get(page), "No hydration or runtime errors on real office journeys").toEqual([]); });
  const office = { id: randomUUID(), email: "office167@example.test" }, customer = { id: randomUUID(), email: "sarah167@example.test" }, worker = { id: randomUUID(), email: "jack167@example.test" };
  const jobs = Array.from({ length: 8 }, () => randomUUID()), thread = randomUUID();
  test.beforeAll(async () => {
    if (!["localhost", "127.0.0.1"].includes(new URL(app!).hostname) || !["localhost", "127.0.0.1"].includes(new URL(database!).hostname) || new URL(database!).pathname !== "/issue167") throw new Error("Local issue167 fixture database required");
    secret = randomBytes(32).toString("hex"); auth = await startAuthStub(secret, 54167);
    db = new pg.Client({ connectionString: database }); await db.connect();
    for (const person of [{ ...office, role: "ADMIN", name: "Matt" }, { ...customer, role: "CUSTOMER", name: "Sarah" }, { ...worker, role: "TRADIE", name: "Jack" }]) {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [person.id, person.email]);
      await db.query("INSERT INTO profiles(id,email,role,first_name,last_name,phone,email_verified_at) VALUES($1,$2,$3,$4,'Queue fixture','+64211234567',now())", [person.id, person.email, person.role, person.name]);
    }
    await db.query("INSERT INTO worker_profiles(user_id) VALUES($1)", [worker.id]);
    const states = ["REVIEW", "REVIEW", "ASSIGNED", "CANCEL_REVIEW", "SUBMITTED", "BOOKABLE", "PRICED", "ASSIGNED"];
    for (let index = 0; index < jobs.length; index++) {
      const status = states[index], claimed = ["ASSIGNED", "SUBMITTED", "CANCEL_REVIEW"].includes(status);
      await db.query("INSERT INTO jobs(id,customer_id,worker_id,category,title,description,address_line1,suburb,city,status,price_cents) VALUES($1,$2,$3,'OTHER',$4,'Queue browser fixture','1 Private Fixture Street',$7,'Invercargill',$5,$6)", [jobs[index], customer.id, claimed ? worker.id : null, `Queue fixture ${index}`, status, status === "REVIEW" ? null : 12000, index === 5 ? "Richmond" : "Windsor"]);
      // Historical status entries are fixture data in this disposable DB; the app clock is never overridden.
      const hours = index === 0 ? 26 : index === 5 ? 55 : 3;
      await db.query("UPDATE job_status_history SET created_at=now()-($2 * interval '1 hour') WHERE job_id=$1", [jobs[index], hours]);
    }
    await db.query("INSERT INTO estimates(job_id,worker_id,minutes,materials_cents) VALUES($1,$2,120,1234)", [jobs[0], worker.id]);
    for (const text of ["First queue extra", "Second queue extra"]) await db.query("INSERT INTO variations(job_id,requested_by_id,description,requested_minutes) VALUES($1,$2,$3,30)", [jobs[2], worker.id, text]);
    await db.query("INSERT INTO problem_reports(job_id,reported_by_id,topic,details) VALUES($1,$2,'Work not finished','Please check the latch.')", [jobs[7], customer.id]);
    await db.query("INSERT INTO support_threads(id,user_id,job_id,job_participants,subject) VALUES($1,$2,$3,true,'Queue fixture support')", [thread, customer.id, jobs[7]]);
  });
  test.afterAll(async () => {
    await db?.query("DELETE FROM problem_reports WHERE job_id=ANY($1::uuid[])", [jobs]);
    await db?.query("DELETE FROM variations WHERE job_id=ANY($1::uuid[])", [jobs]);
    await db?.query("DELETE FROM jobs WHERE id=ANY($1::uuid[])", [jobs]);
    await db?.query("DELETE FROM profiles WHERE id=ANY($1::uuid[])", [[office.id, customer.id, worker.id]]);
    await db?.query("DELETE FROM auth.users WHERE id=ANY($1::uuid[])", [[office.id, customer.id, worker.id]]);
    await db?.end(); await new Promise<void>(resolve => auth?.close(() => resolve()));
  });
  async function signIn(page: Page, person = office) {
    await page.context().clearCookies();
    await page.context().addCookies(await sessionCookies(person, secret, app!, "http://127.0.0.1:54167"));
  }
  test("real counts, urgent order, pricing-workspace handoff and Back, each existing action destination", async ({ page }) => {
    test.setTimeout(120_000); await signIn(page); await page.goto(`${app}/admin`);
    await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
    await expect(page.getByRole("group", { name: "Queue totals", exact: true }).getByRole("button", { name: "Unclaimed > 48h 1 Richmond", exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: "To price (2)", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Queues, 7 waiting", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Tradies, 1 waiting", exact: true })).toBeVisible();
    const price = page.getByRole("table", { name: "To price", exact: true });
    await expect(price.locator("tbody tr").first()).toContainText("Queue fixture 0");
    await expect(price.locator("tbody tr").first()).toContainText("26h");
    await price.locator("tbody tr").first().getByRole("link", { name: "Price it", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Set the price", exact: true })).toBeVisible();
    await expect(page).toHaveURL(`${app}/admin/jobs/${jobs[0]}/price`);
    await page.goBack(); await expect(price).toBeVisible();
    for (const [tab, heading] of [["Extra work (2)", "Extra work"], ["Cancellations (1)", "Cancellations"], ["Sign-off (1)", "Sign-off"], ["Unclaimed (1)", "Unclaimed"]]) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      const table = page.getByRole("table", { name: heading, exact: true });
      await expect(table).toBeVisible();
      await table.getByRole("link", { name: "Open", exact: true }).first().click();
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Queue fixture");
      await page.goBack(); await expect(table).toBeVisible();
    }
    await page.getByRole("link", { name: "Problems (1)", exact: true }).click();
    await page.getByRole("table", { name: "Problems", exact: true }).getByRole("link", { name: "Open", exact: true }).click();
    await expect(page).toHaveURL(`${app}/admin/jobs/${jobs[7]}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Queue fixture 7");
    await page.goBack(); await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Waiting on customer (1)", exact: true }).click();
    await expect(page).toHaveURL(`${app}/admin/jobs?status=customer`);
    await expect(page.getByRole("table", { name: "All jobs", exact: true })).toContainText("Queue fixture 6");
  });
  test("search by customer email, formatted phone and tradie name reaches actual matching jobs; customer/tradie sessions get no office data", async ({ page }) => {
    test.setTimeout(90_000); await signIn(page);
    for (const q of [customer.email, "021 123 4567", "Jack Queue fixture"]) {
      await page.goto(`${app}/admin`);
      const search = page.getByRole("searchbox", { name: "Search jobs and people", exact: true });
      await search.click(); await expect(search).toBeFocused(); await search.fill(q);
      await expect(page.getByRole("table", { name: "Search results", exact: true })).toContainText("Queue fixture");
    }
    for (const person of [customer, worker]) {
      await signIn(page, person); const denied = await page.goto(`${app}/admin`);
      expect(page.url()).not.toContain("/admin"); expect(await denied!.text()).not.toContain("Queue fixture");
    }
  });
  test("390px actual route fits and passes axe, offline input stays and network actions disable", async ({ page, context }) => {
    await signIn(page); await page.setViewportSize({ width: 390, height: 844 }); await page.goto(`${app}/admin`);
    await expect(page.getByRole("group", { name: "Queue totals", exact: true }).getByRole("button", { name: "Unclaimed > 48h 1 Needs you", exact: true })).toBeVisible();
    await expectNoA11yViolations(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    const search = page.getByRole("searchbox", { name: "Search jobs and people", exact: true });
    await context.setOffline(true); await search.fill("retained draft");
    await expect(search).toHaveValue("retained draft");
    await expect(page.getByRole("button", { name: "Price it", exact: true })).toHaveAttribute("aria-disabled", "true");
    await context.setOffline(false);
    await expect(page).toHaveURL(/q=retained/);
    await expect(page.getByRole("heading", { name: "No jobs match that.", exact: true })).toBeVisible();
  });
});
