import { randomBytes, randomUUID } from "node:crypto";
import type { Server } from "node:http";
import pg from "pg";
import { expect, test, type Page } from "@playwright/test";
import { JOBS, moneyIds, PEOPLE } from "../../prisma/seed/data.mjs";
import { sessionCookies, startAuthStub } from "../../scripts/screenshots/auth-stub";
import { expectNoA11yViolations } from "./support/a11y";

// Opt in against a migrated/seeded localhost issue95 database and an app using the Auth stub on 54395.
const app = process.env.JOB_VIEWS_E2E_APP_URL, database = process.env.JOB_VIEWS_E2E_DATABASE_URL;
test.describe("job views at real signed-in page/API boundaries", () => {
  test.skip(!app || !database, "Needs an isolated localhost app and disposable issue95 database");
  test.describe.configure({ mode: "serial" });
  let db: pg.Client, auth: Server, secret: string;
  const foreign = { id: randomUUID(), email: "foreign-job-view@example.test" };
  const job = randomUUID(), thread = randomUUID();
  test.beforeAll(async () => {
    if (!["localhost", "127.0.0.1"].includes(new URL(app!).hostname) || !["localhost", "127.0.0.1"].includes(new URL(database!).hostname) || new URL(database!).pathname !== "/issue95") throw new Error("Isolated localhost issue95 database required");
    secret = randomBytes(32).toString("hex"); auth = await startAuthStub(secret, 54395);
    db = new pg.Client({ connectionString: database }); await db.connect();
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [foreign.id, foreign.email]);
    await db.query("INSERT INTO profiles(id,email,role,first_name,email_verified_at) VALUES($1,$2,'CUSTOMER','Foreign fixture',now())", [foreign.id, foreign.email]);
    await db.query("INSERT INTO jobs(id,customer_id,worker_id,category,title,description,address_line1,suburb,city,status,price_cents) VALUES($1,$2,$3,'OTHER','Job views browser fixture','A private fixture job','1 Private Fixture Street','Windsor','Invercargill','ASSIGNED',12000)", [job, PEOPLE.customer.id, PEOPLE.tradie.id]);
    await db.query("INSERT INTO support_threads(id,user_id,job_id,job_participants,subject) VALUES($1,$2,$3,true,'Job views privacy')", [thread, PEOPLE.customer.id, job]);
    await db.query("INSERT INTO support_messages(thread_id,author_id,body) VALUES($1,$2,'Private fixture message, call 021 123 4567 or privacy95@example.test')", [thread, PEOPLE.customer.id]);
  });
  test.afterAll(async () => {
    await db?.query("DELETE FROM jobs WHERE id=$1", [job]);
    await db?.query("DELETE FROM profiles WHERE id=$1", [foreign.id]);
    await db?.query("DELETE FROM auth.users WHERE id=$1", [foreign.id]);
    await db?.end(); await new Promise<void>(resolve => auth?.close(() => resolve()));
  });
  async function signIn(page: Page, person: { id: string; email: string }) {
    await page.context().clearCookies();
    await page.context().addCookies(await sessionCookies(person, secret, app!, "http://127.0.0.1:54395"));
  }

  test("customer checkout keeps the total/GST; guessed foreign and missing payment IDs both return404", async ({ page }) => {
    test.setTimeout(90_000);
    const pending = JOBS.find(value => value.checkoutStarted)!;
    const paymentId = moneyIds(pending.id).payment;
    await signIn(page, PEOPLE.customer); await page.setViewportSize({ width: 390, height: 844 });
    const response = await page.goto(`${app}/pay/${paymentId}`);
    await expect(page.getByRole("heading", { name: "Pay & book", exact: true })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Order summary" })).toContainText(pending.title);
    expect(await response!.text()).not.toMatch(/workerGrossCents|marginCents|onCostCents|estimates/);
    await expectNoA11yViolations(page);
    await page.getByRole("link", { name: "Back to job", exact: true }).click();
    await expect(page).toHaveURL(`${app}/jobs/${pending.id}`); // Job detail is not built yet; preserve the existing destination.
    await page.goBack(); await expect(page.getByRole("heading", { name: "Pay & book", exact: true })).toBeVisible();
    await signIn(page, foreign);
    for (const id of [paymentId, randomUUID()]) {
      const denied = await page.goto(`${app}/pay/${id}`);
      expect(denied?.status()).toBe(404);
      expect(await denied!.text()).not.toContain(pending.title);
    }
  });

  test("office list→job→Back and filtered CSV retain the authorized office data", async ({ page }) => {
    await signIn(page, PEOPLE.office); await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${app}/admin/jobs?trade=PLUMBING`);
    const table = page.getByRole("table", { name: "All jobs" });
    await table.getByRole("link", { name: /Low water pressure/ }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Low water pressure");
    await page.goBack(); await expect(table).toBeVisible();
    const downloaded = page.waitForEvent("download"); await page.getByRole("link", { name: "Export CSV" }).click();
    const stream = await (await downloaded).createReadStream();
    const csv = Buffer.concat(await stream.toArray()).toString("utf8");
    expect(csv).toContain("Price (NZD incl GST)"); expect(csv).toContain("Low water pressure");
    await signIn(page, PEOPLE.customer);
    const denied = await page.request.get(`${app}/admin/jobs/export`, { maxRedirects: 0 });
    expect(denied.status()).not.toBe(200); expect(await denied.text()).not.toContain("Price (NZD incl GST)");
  });

  test("worker message DTO refresh hides contacts after cancellation and denies the former worker after reassignment", async ({ page }) => {
    await signIn(page, PEOPLE.tradie);
    await page.goto(`${app}/messages/${thread}`);
    await expect(page.getByRole("log")).toContainText("privacy95@example.test");
    await db.query("UPDATE jobs SET status='CANCELLED' WHERE id=$1", [job]);
    const cancelled = await page.reload();
    await expect(page.getByRole("log")).toContainText("hidden until the job is booked");
    expect(await cancelled!.text()).not.toMatch(/privacy95@example.test|021 123 4567|1 Private Fixture Street|priceCents|marginCents/);
    await db.query("UPDATE jobs SET worker_id=$2 WHERE id=$1", [job, PEOPLE.otherWorker.id]);
    const reassigned = await page.reload();
    await expect(page.getByRole("heading", { name: "Wrong address.", exact: true })).toBeVisible();
    expect(await reassigned!.text()).not.toContain("Private fixture message");
    await signIn(page, PEOPLE.otherWorker); await page.goto(`${app}/messages/${thread}`);
    await expect(page.getByRole("log")).toContainText("Private fixture message");
  });
});
