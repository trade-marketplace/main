import { randomBytes } from "node:crypto";
import type { Server } from "node:http";

import { expect, type Page, test } from "@playwright/test";

import { PEOPLE } from "../../prisma/seed/data.mjs";
import { sessionCookies, startAuthStub } from "../../scripts/screenshots/auth-stub";
import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

// /admin/jobs (#170) signed in as the seeded office user, against a local app built with the screenshot sign-in
// stand-in and a disposable, seeded database (never Supabase). Opt in with:
//   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_screenshots_stub \
//   DATABASE_URL=postgresql://…@localhost/tm_local npm run build && npm run start -- --port 3100   (after migrate + seed)
//   OFFICE_JOBS_E2E_APP_URL=http://127.0.0.1:3100 npx playwright test tests/e2e/office-jobs-signed-in.spec.ts
// The seed has ten jobs, TM-1001 to TM-1010, one per status, all in Invercargill.

const app = process.env.OFFICE_JOBS_E2E_APP_URL;

test.describe("/admin/jobs, signed in as the office", () => {
  test.skip(!app, "set OFFICE_JOBS_E2E_APP_URL to a local build with the sign-in stand-in and a seeded database");
  test.use({ reducedMotion: "reduce" });

  let stub: Server;
  let secret: string;
  test.beforeAll(async () => {
    if (!["127.0.0.1", "localhost"].includes(new URL(app!).hostname)) throw new Error("Local app only");
    secret = randomBytes(32).toString("hex");
    process.env.SCREENSHOTS_STUB_SECRET = secret;
    stub = await startAuthStub(secret);
  });
  test.afterAll(async () => {
    await new Promise<void>((resolve) => stub?.close(() => resolve()));
  });

  const signIn = async (page: Page) => {
    const office = PEOPLE.office;
    await page.context().addCookies(await sessionCookies({ id: office.id, email: office.email }, secret, app!));
  };
  const table = (page: Page) => page.getByRole("table", { name: "All jobs" });
  const rows = (page: Page) => table(page).locator("tbody tr");

  test("lists every job, newest change first, with office words and prices", async ({ page }) => {
    await signIn(page);
    await page.goto(`${app}/admin/jobs`);
    await expect(page.locator("html")).toHaveAttribute("data-mode", "office");
    await expect(page.getByRole("heading", { level: 1, name: "All jobs" })).toBeVisible();
    await expect(rows(page)).toHaveCount(10);
    await expect(page.getByText("Showing 1–10 of 10")).toBeVisible();
    await expect(table(page)).toContainText("TM-1008 · Electrical");
    await expect(table(page)).toContainText("To price");
    await expect(page.getByRole("link", { name: "All jobs" }).first()).toHaveAttribute("aria-current", "page");
  });

  for (const viewport of VIEWPORTS) {
    test(`${viewport.name} (${viewport.width}px): no axe violations and no sideways scroll`, async ({ page }) => {
      await signIn(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const path of ["/admin/jobs", "/admin/jobs?q=nothing-matches"]) {
        await page.goto(`${app}${path}`);
        await expect(page.getByRole("heading", { level: 1, name: "All jobs" })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), path).toBe(0);
        await expectNoA11yViolations(page);
      }
    });
  }

  test("filters by keyboard put the list in the URL; Back brings it back", async ({ page }) => {
    await signIn(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${app}/admin/jobs`);
    await page.getByRole("button", { name: /^Status: All/ }).press("Enter");
    await page.getByRole("menuitemradio", { name: "To price" }).press("Enter");
    await expect(page).toHaveURL(`${app}/admin/jobs?status=price`);
    await expect(rows(page)).toHaveCount(3);
    await page.getByRole("button", { name: /^Trade: All/ }).click();
    await page.getByRole("menuitemradio", { name: "Electrical" }).click();
    await expect(page).toHaveURL(`${app}/admin/jobs?status=price&trade=ELECTRICAL`);
    await expect(rows(page)).toHaveCount(1);
    await expect(table(page)).toContainText("Heat pump circuit");
    await page.goBack();
    await expect(page).toHaveURL(`${app}/admin/jobs?status=price`);
    await expect(rows(page)).toHaveCount(3);
  });

  test("search by job number or words; nothing matching offers Clear filters", async ({ page }) => {
    await signIn(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${app}/admin/jobs`);
    const search = page.getByRole("searchbox", { name: "Search jobs" });
    await search.fill("TM-1006");
    await expect(page).toHaveURL(`${app}/admin/jobs?q=TM-1006`);
    await expect(rows(page)).toHaveCount(1);
    await expect(table(page)).toContainText("Kitchen reno");
    await search.fill("deck");
    await expect(rows(page)).toHaveCount(2);
    await search.fill("nothing-matches");
    await expect(page.getByRole("heading", { name: "No jobs match that." })).toBeVisible();
    await expect(page.getByRole("link", { name: "Export CSV" })).toHaveAttribute("aria-disabled", "true");
    await page.getByRole("table", { name: "All jobs" }).getByRole("button", { name: "Clear filters" }).click();
    await expect(page).toHaveURL(`${app}/admin/jobs`);
    await expect(search).toHaveValue("");
    await expect(rows(page)).toHaveCount(10);
  });

  test("sorting by price puts the dearest first and unpriced jobs last", async ({ page }) => {
    await signIn(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${app}/admin/jobs`);
    await table(page).getByRole("button", { name: /^Price/ }).click();
    await expect(page).toHaveURL(`${app}/admin/jobs?sort=price.desc`);
    await expect(rows(page).first()).toContainText("$846.98");
    await expect(rows(page).last()).toContainText("—");
  });

  test("opening a job follows its link; Export CSV downloads the filtered list", async ({ page }) => {
    await signIn(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${app}/admin/jobs?trade=PLUMBING`);
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Export CSV" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^jobs-\d{4}-\d{2}-\d{2}\.csv$/);
    const text = await (await file.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString("utf8"));
    const lines = text.trim().split("\r\n");
    expect(lines[0]).toBe("Job number,Title,Trade,Status,Customer,Tradie,Price (NZD incl GST),Suburb,City,Updated");
    expect(lines).toHaveLength(3); // the header and the two plumbing jobs
    expect(lines.slice(1).every((line) => line.includes(",Plumbing,"))).toBe(true);

    await table(page).getByRole("link", { name: /Low water pressure/ }).click();
    await expect(page).toHaveURL(/\/admin\/jobs\/[0-9a-f-]{36}$/);
  });

  test("a customer gets no list and no export", async ({ page }) => {
    const customer = PEOPLE.customer;
    await page.context().addCookies(await sessionCookies({ id: customer.id, email: customer.email }, secret, app!));
    await page.goto(`${app}/admin/jobs`);
    await expect(page).not.toHaveURL(/\/admin/);
    const response = await page.request.get(`${app}/admin/jobs/export`, { maxRedirects: 0 });
    expect(response.status()).not.toBe(200);
    expect(await response.text()).not.toContain("Job number");
  });

  test("the export sends anyone who isn't signed in to log in, with no data", async ({ request }) => {
    const response = await request.get(`${app}/admin/jobs/export?trade=PLUMBING`, { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers().location).toMatch(/^\/login\?next=/);
    expect(await response.text()).not.toContain("Job number");
  });
});
