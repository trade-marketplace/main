import { expect, test } from "@playwright/test";
import { REVIEW_STATES } from "../../src/lib/office/reviews";
import { expectNoA11yViolations } from "./support/a11y";
const preview = process.env.OFFICE_REVIEWS_PREVIEW_URL || process.env.POSTED_PREVIEW_E2E_URL || "http://127.0.0.1:3101";
test.use({ trace: "on-first-retry" });
test("office reviews preview remains guarded in production", async ({ page }) => { expect((await page.goto("/dev/components/office-reviews?state=reported"))?.status()).toBe(404); });
for (const width of [320, 390, 768, 1024, 1440]) test(`office review states at ${width}px`, async ({ page }) => {
  test.setTimeout(180_000); await page.setViewportSize({ width, height: 1000 });
  for (const state of REVIEW_STATES) await test.step(state, async () => {
    expect((await page.goto(`${preview}/dev/components/office-reviews?state=${state}`))?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Reviews", exact: true, level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expectNoA11yViolations(page);
    if (process.env.OFFICE_REVIEWS_QA_DIR && (width === 390 || width === 1440)) {
      const { mkdir } = await import("node:fs/promises"); await mkdir(process.env.OFFICE_REVIEWS_QA_DIR, { recursive: true });
      await page.screenshot({ path: `${process.env.OFFICE_REVIEWS_QA_DIR}/${state}-${width}.png`, fullPage: true });
    }
  });
});
test("keyboard moderation validates reason, preserves it offline and restores focus", async ({ page, context }) => {
  await page.goto(`${preview}/dev/components/office-reviews?state=reported`);
  const hide = page.getByRole("button", { name: "Hide", exact: true }); await hide.press("Enter");
  await page.getByRole("button", { name: "Hide review", exact: true }).press("Enter");
  await expect(page.getByText("Enter a reason between 3 and 500 characters.")).toBeVisible();
  await page.getByLabel("Reason", { exact: true }).fill("Includes private contact details."); await context.setOffline(true);
  await expect(page.getByRole("button", { name: "Hide review", exact: true })).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByLabel("Reason", { exact: true })).toHaveValue("Includes private contact details."); await context.setOffline(false);
  await page.keyboard.press("Escape"); await expect(hide).toBeFocused();
  await hide.press("Enter"); await page.getByLabel("Reason", { exact: true }).fill("Includes private contact details.");
  await page.getByRole("button", { name: "Hide review", exact: true }).press("Enter"); await expect(page.getByText("Nothing reported.")).toBeVisible();
  await page.goto(`${preview}/dev/components/office-reviews?state=hidden`); await page.getByRole("button", { name: "Show again", exact: true }).press("Enter");
  await expect(page.getByRole("alertdialog", { name: "Show this review again?" })).toBeVisible();
  await page.getByRole("alertdialog").getByRole("button", { name: "Show again", exact: true }).press("Enter"); await expect(page.getByText("No reviews yet.")).toBeVisible();
});
test("tabs, search and browser Back preserve URL state; long comments expand", async ({ page }) => {
  await page.goto(`${preview}/dev/components/office-reviews?state=all&tab=all`);
  const more = page.getByRole("button", { name: "Show more", exact: true }); await more.click(); await expect(page.getByRole("button", { name: "Show less", exact: true })).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("tab", { name: /^Hidden/ }).click(); await expect(page).toHaveURL(/tab=hidden/);
  await page.getByRole("searchbox", { name: "Search reviews" }).fill("Alex"); await expect(page).toHaveURL(/q=Alex/);
  await page.getByRole("tab", { name: /^All/ }).click(); await expect(page).toHaveURL(/tab=all.*q=Alex/);
  await page.goBack(); await expect(page.getByRole("tab", { name: /^Hidden/ })).toHaveAttribute("aria-selected", "true"); await expect(page.getByRole("searchbox", { name: "Search reviews" })).toHaveValue("Alex");
  await page.getByRole("searchbox", { name: "Search reviews" }).fill("Nobody"); await expect(page.getByText("No reviews match that.")).toBeVisible();
  await page.getByRole("tabpanel").getByRole("button", { name: "Clear search", exact: true }).click(); await expect(page.getByRole("searchbox", { name: "Search reviews" })).toHaveValue("");
});
test.describe("actual office moderation persistence", () => {
  const app = process.env.OFFICE_REVIEWS_APP_URL, database = process.env.OFFICE_REVIEWS_DATABASE_URL;
  test.skip(!app || !database, "Opt in with the dedicated localhost reviews app and database.");
  test("office hides, reloads, shows again and restores the public testimonial", async ({ browser }) => {
    const { randomBytes, randomUUID } = await import("node:crypto"), { execFile } = await import("node:child_process"), { promisify } = await import("node:util");
    const { default: pg } = await import("pg"), { startAuthStub, sessionCookies } = await import("../../scripts/screenshots/auth-stub");
    const url = new URL(database!), appUrl = new URL(app!);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/lane_c_242" || url.search || appUrl.hostname !== "127.0.0.1") throw Error("Only the isolated localhost lane_c_242 database/app is allowed.");
    const db = new pg.Client({ connectionString: database }), secret = randomBytes(32).toString("hex"), auth = await startAuthStub(secret, 54574); await db.connect();
    const office = { id: randomUUID(), email: `${randomUUID()}@office.example.test` }, worker = { id: randomUUID(), email: `${randomUUID()}@tradie.example.test` }, customer = { id: randomUUID(), email: `${randomUUID()}@customer.example.test` }, job = randomUUID(), review = randomUUID(), comment = `Browser review ${randomUUID()}`;
    const context = await browser.newContext();
    try {
      for (const [person, role, first] of [[office, "ADMIN", "Matt"], [worker, "TRADIE", "Jack"], [customer, "CUSTOMER", "Sarah"]] as const) {
        await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [person.id, person.email]);
        await db.query("INSERT INTO profiles(id,email,role,first_name,last_name,email_verified_at,updated_at) VALUES($1,$2,$3,$4,'Taylor',now(),now())", [person.id, person.email, role, first]);
      }
      await db.query("INSERT INTO jobs(id,customer_id,category,title,description,address_line1,suburb,city,any_time) VALUES($1,$2,'OTHER','Browser review moderation','Fix a door.','242 Test Street','Windsor','Invercargill',true)", [job, customer.id]);
      await promisify(execFile)(process.execPath, ["--conditions=react-server", "--import", "tsx", "--input-type=module", "-e", `import {createDatabaseClient} from './src/server/database-client.ts';import {priceJob} from './src/server/pricing/price-job.ts';const db=createDatabaseClient(process.env.OFFICE_REVIEWS_DATABASE_URL);try{await priceJob(db,{jobId:'${job}',minutes:60,materialsCents:0});await db.job.update({where:{id:'${job}'},data:{status:'COMPLETED',workerId:'${worker.id}'}});await db.review.create({data:{id:'${review}',jobId:'${job}',reviewerId:'${customer.id}',workerId:'${worker.id}',rating:5,tags:['Tidy'],comment:'${comment}',reportedAt:new Date(),reportedById:'${worker.id}',reportReason:'Please check this review.'}});}finally{await db.$disconnect();}`]);
      const number = (await db.query("SELECT job_number FROM jobs WHERE id=$1", [job])).rows[0].job_number;
      await context.addCookies(await sessionCookies(office, secret, app!, "http://127.0.0.1:54574")); const page = await context.newPage();
      await page.goto(`${app}/admin/reviews?tab=reported&q=TM-${number}`); await expect(page.getByText(comment, { exact: true })).toBeVisible();
      const publicPage = await context.newPage(); await publicPage.goto(`${app}/services/other`); await expect(publicPage.locator("blockquote").filter({ hasText: comment })).toBeVisible();
      await page.getByRole("button", { name: "Hide", exact: true }).press("Enter"); await page.getByLabel("Reason", { exact: true }).fill("Includes private contact details."); await page.getByRole("button", { name: "Hide review", exact: true }).press("Enter");
      await expect(page.getByText("No reviews match that.")).toBeVisible(); await page.reload(); await expect(page.getByText(comment, { exact: true })).toHaveCount(0);
      const hidden = (await db.query("SELECT hidden_reason,hidden_by_id,rating,comment,tags FROM reviews WHERE id=$1", [review])).rows[0]; expect(hidden).toMatchObject({ hidden_reason: "Includes private contact details.", hidden_by_id: office.id, rating: 5, comment, tags: ["Tidy"] });
      await publicPage.reload(); await expect(publicPage.locator("blockquote").filter({ hasText: comment })).toHaveCount(0);
      await page.getByRole("tab", { name: /^Hidden/ }).click(); await expect(page.getByText(comment, { exact: true })).toBeVisible(); await page.getByRole("button", { name: "Show again", exact: true }).press("Enter"); await page.getByRole("alertdialog").getByRole("button", { name: "Show again", exact: true }).press("Enter");
      await expect(page.getByText(comment, { exact: true })).toHaveCount(0); await page.getByRole("tab", { name: /^All/ }).click(); await expect(page.getByText(comment, { exact: true })).toBeVisible(); await page.reload(); await expect(page.getByText(comment, { exact: true })).toBeVisible();
      await publicPage.reload(); await expect(publicPage.locator("blockquote").filter({ hasText: comment })).toBeVisible();
      expect((await db.query("SELECT hidden_at,hidden_reason,hidden_by_id,rating,comment,tags FROM reviews WHERE id=$1", [review])).rows[0]).toMatchObject({ hidden_at: null, hidden_reason: null, hidden_by_id: null, rating: 5, comment, tags: ["Tidy"] });
      expect((await db.query("SELECT action FROM audit_log WHERE record_id=$1 ORDER BY created_at", [review])).rows.map(row => row.action)).toEqual(["review.hidden", "review.shown"]);
      await expectNoA11yViolations(page); await expectNoA11yViolations(publicPage);
      await page.getByRole("link", { name: `TM-${number}`, exact: true }).press("Enter"); await expect(page).toHaveURL(new RegExp(`/admin/jobs/${job}`)); await expect(page.getByRole("heading", { level: 1 })).toContainText("Browser review moderation");
      await page.goBack(); await expect(page.getByText(comment, { exact: true })).toBeVisible(); await expect(page.getByRole("searchbox", { name: "Search reviews" })).toHaveValue(`TM-${number}`);
      await page.getByRole("link", { name: "Jack Taylor", exact: true }).press("Enter"); await expect(page.getByRole("heading", { name: "Tradies", level: 1, exact: true })).toBeVisible(); await page.goBack(); await expect(page.getByText(comment, { exact: true })).toBeVisible();
    } finally { await context.close(); await db.end(); await new Promise<void>((resolve, reject) => auth.close(error => error ? reject(error) : resolve())); }
  });
});
