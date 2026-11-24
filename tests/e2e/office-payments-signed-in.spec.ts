import { randomBytes } from "node:crypto";
import type { Server } from "node:http";

import { expect, type Page, test } from "@playwright/test";
import pg from "pg";

import { PEOPLE } from "../../prisma/seed/data.mjs";
import { sessionCookies, startAuthStub } from "../../scripts/screenshots/auth-stub";
import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

// /admin/payments (#176) signed in as the seeded office user, against a local app built with the screenshot sign-in
// stand-in and a disposable, migrated and seeded localhost database (never Supabase, never Stripe: refunds answer
// "Stripe isn't set up here", which proves the row's dialog reaches the job admin's real action). Opt in with:
//   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_screenshots_stub \
//   DATABASE_URL=postgresql://…@localhost/<db> npm run build && npm run start -- --port 3176   (after migrate + seed)
//   OFFICE_PAYMENTS_E2E_APP_URL=http://127.0.0.1:3176 OFFICE_PAYMENTS_E2E_DATABASE_URL=postgresql://…@localhost/<db> \
//   npx playwright test tests/e2e/office-payments-signed-in.spec.ts

const app = process.env.OFFICE_PAYMENTS_E2E_APP_URL;
const database = process.env.OFFICE_PAYMENTS_E2E_DATABASE_URL;

test.describe("/admin/payments, signed in", () => {
  test.skip(!app || !database, "set OFFICE_PAYMENTS_E2E_APP_URL and OFFICE_PAYMENTS_E2E_DATABASE_URL to a local seeded build");
  test.use({ reducedMotion: "reduce" });
  test.describe.configure({ mode: "serial", timeout: 120_000 });

  let stub: Server;
  let secret: string;
  let db: pg.Client;
  let paid: { id: string; job_id: string; job_number: number; title: string; provider_payment_id: string }[];
  test.beforeAll(async () => {
    for (const url of [app!, database!]) if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname)) throw new Error("Local app and database only");
    secret = randomBytes(32).toString("hex");
    process.env.SCREENSHOTS_STUB_SECRET = secret;
    stub = await startAuthStub(secret);
    db = new pg.Client({ connectionString: database });
    await db.connect();
    paid = (await db.query("SELECT p.id, p.job_id, j.job_number, j.title, p.provider_payment_id FROM payments p JOIN jobs j ON j.id = p.job_id WHERE p.status = 'PAID' ORDER BY p.created_at DESC, p.id DESC")).rows;
    if (paid.length < 2) throw new Error("Seed the database first (npx prisma db seed).");
  });
  test.afterAll(async () => {
    await db?.end();
    await new Promise<void>((resolve) => stub?.close(() => resolve()));
  });

  const signIn = async (page: Page, who: keyof typeof PEOPLE = "office") => {
    await page.context().addCookies(await sessionCookies({ id: PEOPLE[who].id, email: PEOPLE[who].email }, secret, app!));
  };
  const table = (page: Page) => page.getByRole("table", { name: "Payments" });
  const rows = (page: Page) => table(page).locator("tbody tr");

  test("the office nav opens the ledger: every payment, newest first, with the office-only Stripe id and email", async ({ page }) => {
    await signIn(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${app}/admin/jobs`);
    await page.getByRole("link", { name: "Payments", exact: true }).first().click();
    await expect(page).toHaveURL(`${app}/admin/payments`);
    await expect(page.getByRole("heading", { level: 1, name: "Payments" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Payments", exact: true }).first()).toHaveAttribute("aria-current", "page");
    const total = Number((await db.query("SELECT count(*)::int AS n FROM payments")).rows[0].n);
    await expect(page.getByText(new RegExp(`of ${total}$`))).toBeVisible();
    await expect(table(page)).toContainText(paid[0].provider_payment_id);
    await expect(table(page)).toContainText(PEOPLE.customer.email);
    await expect(page.getByRole("region", { name: "Totals" })).toContainText("Net");
  });

  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: no axe violations and no sideways scroll`, async ({ page }) => {
      await signIn(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const path of ["/admin/payments", "/admin/payments?q=nothing-matches"]) {
        await page.goto(`${app}${path}`);
        await expect(page.getByRole("heading", { level: 1, name: "Payments" })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), path).toBe(0);
        await expectNoA11yViolations(page);
      }
    });
  }

  test("filter by keyboard, open a job from the row, and Back returns to the same filtered list", async ({ page }) => {
    await signIn(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${app}/admin/payments`);
    await page.getByRole("button", { name: /^Status: All/ }).press("Enter");
    await page.getByRole("menuitemradio", { name: "Paid", exact: true }).press("Enter");
    await expect(page).toHaveURL(`${app}/admin/payments?status=paid`);
    await expect(rows(page)).toHaveCount(Math.min(paid.length, 25));
    await page.getByRole("searchbox", { name: "Search payments" }).fill(`TM-${paid[0].job_number}`);
    await expect(page).toHaveURL(`${app}/admin/payments?status=paid&q=TM-${paid[0].job_number}`);
    await expect(rows(page)).toHaveCount(1);
    await table(page).getByRole("link", { name: paid[0].title }).press("Enter");
    await expect(page).toHaveURL(`${app}/admin/jobs/${paid[0].job_id}`);
    await expect(page.getByRole("heading", { level: 1, name: new RegExp(paid[0].title) })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(`${app}/admin/payments?status=paid&q=TM-${paid[0].job_number}`);
    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByRole("searchbox", { name: "Search payments" })).toHaveValue(`TM-${paid[0].job_number}`);
  });

  test("Export CSV downloads the filtered list, office columns included", async ({ page }) => {
    await signIn(page);
    await page.goto(`${app}/admin/payments?status=paid`);
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Export CSV" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^payments-\d{4}-\d{2}-\d{2}\.csv$/);
    const { readFile } = await import("node:fs/promises");
    const csv = await readFile((await file.path())!, "utf8");
    expect(csv.split("\r\n")[0]).toBe("Date,Job number,Job title,Customer,Email,Kind,Amount (NZD incl GST),Refunded (NZD),Status,Stripe payment id,Payment id");
    expect(csv.trim().split("\r\n")).toHaveLength(paid.length + 1);
    expect(csv).toContain(paid[0].provider_payment_id);
  });

  test("Refund on a row sends the job admin's real action: with no Stripe here, nothing changes and it says why", async ({ page }) => {
    await signIn(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${app}/admin/payments?q=TM-${paid[0].job_number}&status=paid`);
    await page.getByRole("button", { name: new RegExp(`^Refund TM-${paid[0].job_number},`) }).click();
    const dialog = page.getByRole("alertdialog", { name: "Refund" });
    await dialog.getByLabel("Note").fill("Checking the ledger refund.");
    await dialog.getByRole("button", { name: "Record refund" }).click();
    await expect(dialog.getByText("Refunds are made in Stripe, and Stripe isn’t set up here. Nothing was changed.")).toBeVisible();
    await dialog.getByRole("button", { name: "Not now" }).click();
    const after = (await db.query("SELECT status, refunded_cents FROM payments WHERE id = $1", [paid[0].id])).rows[0];
    expect(after).toEqual({ status: "PAID", refunded_cents: 0 });
  });

  test("customers and tradies never get the ledger, its export or its Stripe ids", async ({ page }) => {
    for (const who of ["customer", "tradie"] as const) {
      await page.context().clearCookies();
      await signIn(page, who);
      const response = await page.goto(`${app}/admin/payments`);
      expect(page.url()).not.toBe(`${app}/admin/payments`);
      expect(await page.content()).not.toContain("pi_test_DEMO");
      expect(response?.status()).toBeLessThan(500);
      const csv = await page.request.get(`${app}/admin/payments/export`, { maxRedirects: 0 });
      expect(csv.status()).not.toBe(200);
      expect(await csv.text()).not.toContain("pi_test_DEMO");
    }
    await page.context().clearCookies();
    await signIn(page, "customer");
    await page.goto(`${app}/profile/payments`);
    await expect(page.getByRole("heading", { level: 1, name: "Payments" })).toBeVisible();
    const html = await page.content();
    expect(html).not.toMatch(/pi_test_DEMO|re_|tradie@demo\.test|office@demo\.test/);
  });
});
