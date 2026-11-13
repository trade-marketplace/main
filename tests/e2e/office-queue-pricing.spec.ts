import { randomBytes, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import type { Server } from "node:http";
import pg from "pg";
import { expect, test, type Page } from "@playwright/test";
import { sessionCookies, startAuthStub } from "../../scripts/screenshots/auth-stub";
import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const preview = process.env.OFFICE_QUEUE_PRICING_PREVIEW_URL || process.env.POSTED_PREVIEW_E2E_URL;
const app = process.env.OFFICE_QUEUE_PRICING_APP_URL;
const database = process.env.OFFICE_QUEUE_PRICING_DATABASE_URL;
const authUrl = "http://127.0.0.1:55368";
const qa = process.env.OFFICE_QUEUE_PRICING_QA_DIR;
test.use({ trace: "on-first-retry", reducedMotion: "reduce" });

async function audit(page: Page) {
  await expect(page).not.toHaveTitle("");
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  await expectNoA11yViolations(page);
}
async function capture(page: Page, name: string) {
  if (!qa) return;
  await mkdir(qa, { recursive: true });
  await page.screenshot({ path: `${qa}/${name}-${page.viewportSize()!.width}.png`, fullPage: true });
}

test.describe("office pricing entry previews", () => {
  test.skip(!preview, "Requires the guarded local dev preview app");
  for (const viewport of VIEWPORTS) {
    test(`queue and job entry states at ${viewport.width}px`, async ({ page }) => {
      test.setTimeout(120_000);
      const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
      await page.setViewportSize(viewport);
      for (const state of ["price", "all-clear", "loading", "error", "offline"]) {
        await page.goto(`${preview}/dev/components/office-queues?state=${state}`);
        await expect(page).toHaveTitle(/Office queues/);
        if (state === "price") {
          const row = page.getByRole("row").filter({ hasText: "Hot water cylinder" });
          await expect(row.getByRole("link", { name: "Price it", exact: true })).toBeVisible();
          await expect(row).toContainText("0");
        } else if (state === "offline") {
          await expect(page.getByRole("button", { name: "Price it", exact: true }).first()).toHaveAttribute("aria-disabled", "true");
        } else if (state === "error") await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
        else if (state === "loading") await expect(page.locator('[aria-busy="true"]').first()).toBeVisible();
        else await expect(page.getByRole("link", { name: "Price it", exact: true })).toHaveCount(0);
        await audit(page); await capture(page, `queue-${state}`);
      }
      for (const state of ["no-estimates", "bounty", "default", "loading", "error"]) {
        await page.goto(`${preview}/dev/components/office-job?state=${state}`);
        await expect(page).toHaveTitle(/Office job admin/);
        const price = page.getByRole("link", { name: "Price it", exact: true });
        if (state === "no-estimates" || state === "bounty") {
          await expect(price).toBeVisible(); await expect(price).toHaveAttribute("href", /\/admin\/jobs\/[0-9a-f-]+\/price$/);
          await price.focus(); await expect(price).toBeFocused();
          await page.getByRole("button", { name: "Actions", exact: true }).click();
          await expect(page.getByRole("menu")).toBeVisible();
          await page.keyboard.press("Escape"); await expect(page.getByRole("menu")).toHaveCount(0);
        } else {
          await expect(price).toHaveCount(0);
          if (state === "error") await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
          if (state === "loading") await expect(page.locator('[aria-busy="true"]').first()).toBeVisible();
        }
        await audit(page); await capture(page, `job-${state}`);
      }
      expect(errors).toEqual([]);
    });
  }
});

const statuses = ["REVIEW", "QUOTE_BOUNTY", "PRICED", "BOOKABLE", "ASSIGNED", "SUBMITTED", "COMPLETED", "CANCEL_REVIEW", "CANCELLED"] as const;
test.describe("zero-estimate pricing entry through real signed-in routes", () => {
  test.skip(!app || !database, "Requires isolated localhost app/Auth and lane_c_568 database");
  test.describe.configure({ mode: "serial" });
  const office = { id: randomUUID(), email: "office568@example.test" };
  const customer = { id: randomUUID(), email: "customer568@example.test" };
  const worker = { id: randomUUID(), email: "worker568@example.test" };
  const jobs = statuses.map(status => ({ id: randomUUID(), title: `Pricing entry ${status} ${randomUUID().slice(0, 8)}`, status, number: "" }));
  let db: pg.Client, auth: Server, secret: string;
  test.beforeAll(async () => {
    if (!["localhost", "127.0.0.1"].includes(new URL(app!).hostname) || !["localhost", "127.0.0.1"].includes(new URL(database!).hostname) || new URL(database!).pathname !== "/lane_c_568") throw Error("Disposable local lane_c_568 database required");
    secret = randomBytes(32).toString("hex"); auth = await startAuthStub(secret, 55368);
    db = new pg.Client({ connectionString: database }); await db.connect();
    for (const [person, role] of [[office, "ADMIN"], [customer, "CUSTOMER"], [worker, "TRADIE"]] as const) {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [person.id, person.email]);
      await db.query("INSERT INTO profiles(id,email,role,first_name,email_verified_at) VALUES($1,$2,$3,'Pricing entry fixture',now())", [person.id, person.email, role]);
    }
    await db.query("INSERT INTO worker_profiles(user_id) VALUES($1)", [worker.id]);
    for (const job of jobs) {
      const waiting = job.status === "REVIEW" || job.status === "QUOTE_BOUNTY";
      const assigned = ["ASSIGNED", "SUBMITTED", "COMPLETED", "CANCEL_REVIEW"].includes(job.status);
      const inserted = await db.query("INSERT INTO jobs(id,customer_id,worker_id,category,title,description,address_line1,suburb,city,status,price_cents) VALUES($1,$2,$3,'OTHER',$4,'Pricing entry fixture','1 Fixture Street','Windsor','Invercargill',$5,$6) RETURNING job_number", [job.id, customer.id, assigned ? worker.id : null, job.title, job.status, waiting ? null : 12000]);
      job.number = `TM-${inserted.rows[0].job_number}`;
    }
  });
  test.afterAll(async () => {
    if (db) {
      await db.query("DELETE FROM jobs WHERE id=ANY($1::uuid[])", [jobs.map(job => job.id)]);
      await db.query("DELETE FROM profiles WHERE id=ANY($1::uuid[])", [[office.id, customer.id, worker.id]]);
      await db.query("DELETE FROM auth.users WHERE id=ANY($1::uuid[])", [[office.id, customer.id, worker.id]]);
      await db.end();
    }
    if (auth) await new Promise<void>(resolve => auth.close(() => resolve()));
  });
  for (const viewport of VIEWPORTS) {
    test(`queue and detail handoffs, existing breadcrumbs and status limits at ${viewport.width}px`, async ({ page, context }) => {
      test.setTimeout(180_000); const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.setViewportSize(viewport);
      await context.addCookies(await sessionCookies(office, secret, app!, authUrl));
      for (const job of jobs.slice(0, 2)) {
        await page.goto(`${app}/admin`);
        const row = page.getByRole("table", { name: "To price", exact: true }).getByRole("row").filter({ hasText: job.title });
        const price = row.getByRole("link", { name: "Price it", exact: true });
        await expect(price).toBeVisible(); await expect(row).toContainText("0");
        await audit(page);
        await price.click();
        await expect(page).toHaveURL(`${app}/admin/jobs/${job.id}/price`);
        await expect(page.getByRole("heading", { name: "Set the price", exact: true })).toBeVisible();
        await expect(page).toHaveTitle(/Price a job/); await audit(page);
        await page.getByRole("navigation", { name: "Breadcrumb", exact: true }).getByRole("link", { name: job.number, exact: true }).click();
        await expect(page).toHaveURL(`${app}/admin/jobs/${job.id}`);
        await expect(page.getByRole("heading", { level: 1 }).filter({ hasText: job.title })).toBeVisible();
        const detailPrice = page.getByRole("link", { name: "Price it", exact: true });
        await expect(detailPrice).toBeVisible(); await audit(page); await capture(page, `real-detail-${job.status}`);
        await detailPrice.focus(); await detailPrice.press("Enter");
        await expect(page).toHaveURL(`${app}/admin/jobs/${job.id}/price`);
        await expect(page.getByRole("heading", { name: "Set the price", exact: true })).toBeVisible();
        await page.getByRole("navigation", { name: "Breadcrumb", exact: true }).getByRole("link", { name: "Queues", exact: true }).click();
        await expect(page).toHaveURL(`${app}/admin`); await expect(row).toBeVisible();
        expect((await db.query("SELECT status,price_cents,(SELECT count(*)::int FROM estimates WHERE job_id=jobs.id) AS estimates FROM jobs WHERE id=$1", [job.id])).rows[0]).toEqual({ status: job.status, price_cents: null, estimates: 0 });
      }
      for (const job of jobs.slice(2)) {
        await page.goto(`${app}/admin/jobs/${job.id}`);
        await expect(page.getByRole("heading", { level: 1 }).filter({ hasText: job.title })).toBeVisible();
        await expect(page.getByRole("link", { name: "Price it", exact: true })).toHaveCount(0);
      }
      expect(errors).toEqual([]);
    });
  }
});
