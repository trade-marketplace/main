import { randomUUID } from "node:crypto";
import pg from "pg";
import { startAuthStub, sessionCookies } from "../../scripts/screenshots/auth-stub";
import { expect, test, type Page } from "@playwright/test";
import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

test.use({ trace: "on-first-retry" });
const preview = process.env.REVIEW_CARD_PREVIEW_URL || process.env.POSTED_PREVIEW_E2E_URL || "http://127.0.0.1:3101";
const states = ["none", "stars-picked", "saving", "posted-editable", "editing", "posted-fixed", "locked", "error", "offline", "loading", "empty", "load-error"];
async function settle(page: Page) {
  await expect(page).toHaveTitle(/\S/);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().filter(animation => { const end = animation.effect?.getComputedTiming().endTime; return typeof end === "number" && end > 0 && end <= 1000; }).map(animation => animation.finished.catch(() => {})));
  });
}
test("review preview stays guarded in production", async ({ request, baseURL }) => expect((await request.get(`${baseURL}/dev/components/review-card`)).status()).toBe(404));
for (const viewport of VIEWPORTS) test(`review states fit ${viewport.width}px and pass axe`, async ({ page }) => {
  test.setTimeout(180_000); await page.setViewportSize(viewport);
  for (const state of states) await test.step(state, async () => {
    expect((await page.goto(`${preview}/dev/components/review-card?state=${state}`))?.status()).toBe(200);
    if (["none", "empty"].includes(state)) { await expect(page.getByRole("button", { name: "Post review", exact: true })).toHaveAttribute("aria-disabled", "true"); await expect(page.getByLabel("Add a comment (optional)", { exact: true })).toHaveCount(0); }
    if (state === "posted-fixed") { await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0); await expect(page.getByText("Great work, thank you.", { exact: true })).toBeVisible(); }
    if (state === "posted-editable") await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
    if (state === "locked") { await expect(page.getByText("This review can’t be changed now.", { exact: true })).toBeVisible(); await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveAttribute("aria-disabled", "true"); }
    if (state === "loading") await expect(page.getByRole("status", { name: "Loading review", exact: true })).toBeVisible();
    if (state === "offline") await expect(page.getByRole("button", { name: "Post review", exact: true })).toHaveAttribute("aria-disabled", "true");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await settle(page); await expectNoA11yViolations(page);
    if (process.env.REVIEW_CARD_SCREENSHOTS === "1" && [390, 1440].includes(viewport.width)) await page.screenshot({ path: test.info().outputPath(`${state}-${viewport.width}.png`), fullPage: true });
  });
});
test("keyboard picks stars with arrows, adds a tag, posts, edits and cancels with focus restored", async ({ page }) => {
  await page.goto(`${preview}/dev/components/review-card?state=none`);
  const first = page.getByRole("radio", { name: "1 star, Poor", exact: true }); await first.focus();
  await first.press("ArrowRight"); await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "4 stars, Great", exact: true })).toBeChecked();
  const tidy = page.getByRole("checkbox", { name: "Tidy", exact: true }); await tidy.focus(); await tidy.press("Space");
  await page.getByLabel("Add a comment (optional)", { exact: true }).fill("The repair is working well.");
  await page.getByRole("button", { name: "Post review", exact: true }).press("Enter");
  await expect(page.getByRole("heading", { name: "Your review", exact: true })).toBeFocused();
  await expect(page.getByRole("status").filter({ hasText: "Thanks. Review posted." })).toBeVisible();
  await expect(page.getByText("The repair is working well.", { exact: true })).toBeVisible();
  const edit = page.getByRole("button", { name: "Edit", exact: true }); await edit.press("Enter");
  await page.getByLabel("Add a comment (optional)", { exact: true }).fill("A draft change.");
  await page.getByRole("button", { name: "Cancel", exact: true }).press("Enter"); await expect(edit).toBeFocused();
  await expect(page.getByText("The repair is working well.", { exact: true })).toBeVisible();
  await edit.press("Enter"); await page.getByLabel("Add a comment (optional)", { exact: true }).fill("Updated after using it.");
  await page.getByRole("button", { name: "Save", exact: true }).press("Enter"); await expect(page.getByRole("heading", { name: "Your review", exact: true })).toBeVisible(); await expect(page.getByText("Updated after using it.", { exact: true })).toBeVisible();
  await settle(page); await expectNoA11yViolations(page);
});
test("offline preserves the review draft and reconnect enables posting; error retries preserve the same draft", async ({ page, context }) => {
  await page.goto(`${preview}/dev/components/review-card?state=stars-picked`);
  await page.getByLabel("Add a comment (optional)", { exact: true }).fill("Keep this review draft."); await context.setOffline(true);
  const post = page.getByRole("button", { name: "Post review", exact: true }); await expect(post).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByLabel("Add a comment (optional)", { exact: true })).toHaveValue("Keep this review draft."); await context.setOffline(false); await expect(post).not.toHaveAttribute("aria-disabled", "true");
  await post.click(); await expect(page.getByRole("heading", { name: "Your review", exact: true })).toBeVisible(); await expect(page.getByText("Keep this review draft.", { exact: true })).toBeVisible();
  await page.goto(`${preview}/dev/components/review-card?state=error`); await page.getByLabel("Add a comment (optional)", { exact: true }).fill("Try this review again.");
  await page.getByRole("button", { name: "Try again", exact: true }).click(); await expect(page.getByLabel("Add a comment (optional)", { exact: true })).toHaveValue("Try this review again.");
  await page.getByRole("button", { name: "Try again", exact: true }).click(); await expect(page.getByRole("heading", { name: "Your review", exact: true })).toBeVisible(); await expect(page.getByText("Try this review again.", { exact: true })).toBeVisible();
});

test("an expired edit can return to the fixed review without offering Edit again", async ({ page }) => {
  await page.goto(`${preview}/dev/components/review-card?state=locked`);
  await expect(page.getByText("This review can’t be changed now.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your review", exact: true })).toBeVisible();
  await expect(page.getByText("Great work, thank you.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
  await settle(page); await expectNoA11yViolations(page);
});

const app = process.env.REVIEW_CARD_E2E_APP_URL, database = process.env.REVIEW_CARD_E2E_DATABASE_URL;
test.describe("real customer review posting and editing", () => {
  test.skip(!app || !database, "requires an isolated local app and throwaway database");
  test.describe.configure({ mode: "serial" });
  let db: pg.Client, auth: Awaited<ReturnType<typeof startAuthStub>>;
  const secret = randomUUID(), customer = { id: randomUUID(), email: `${randomUUID()}@example.test` }, worker = randomUUID();
  test.beforeAll(async () => {
    const target = new URL(database!), host = new URL(app!);
    if (target.hostname !== "127.0.0.1" || target.pathname !== "/lane_a_130" || target.search || host.hostname !== "127.0.0.1") throw new Error("Dedicated local Lane A fixtures required");
    auth = await startAuthStub(secret, 54511); db = new pg.Client({ connectionString: database }); await db.connect();
    for (const [id, email, role, name] of [[customer.id, customer.email, "CUSTOMER", "Sarah"], [worker, `${worker}@example.test`, "TRADIE", "Jack"]]) {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [id, email]);
      await db.query("INSERT INTO profiles(id,email,role,first_name,email_verified_at,updated_at) VALUES($1,$2,$3,$4,now(),now())", [id, email, role, name]);
    }
  });
  test.afterAll(async () => { await db?.end(); if (auth) await new Promise<void>(resolve => auth.close(() => resolve())); });
  async function fixture() {
    const job = randomUUID();
    await db.query("INSERT INTO jobs(id,customer_id,worker_id,category,title,description,address_line1,suburb,city,any_time,status,price_cents,updated_at) VALUES($1,$2,$3,'OTHER','Review journey','Move the couch upstairs.','1 Example Street','Windsor','Invercargill',true,'COMPLETED',37200,now())", [job, customer.id, worker]);
    return job;
  }
  test("posts and edits through actual guarded actions, persists once, and preserves My jobs and Back", async ({ page, context }) => {
    await context.addCookies(await sessionCookies(customer, secret, app!, "http://127.0.0.1:54511"));
    const job = await fixture(), href = `${app}/jobs/${job}?from=%2Fdashboard%3Fq%3Dreview`, notifications = Number((await db.query("SELECT count(*) FROM notifications WHERE user_id=$1", [customer.id])).rows[0].count);
    await page.goto(href); await expect(page.getByRole("heading", { name: "How was Jack?", exact: true })).toBeVisible();
    await page.getByRole("radio", { name: "1 star, Poor", exact: true }).focus(); await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowRight");
    await page.getByRole("checkbox", { name: "Tidy", exact: true }).check(); await page.getByLabel("Add a comment (optional)", { exact: true }).fill("The repair is working well.");
    await page.getByRole("button", { name: "Post review", exact: true }).press("Enter");
    await expect(page.getByRole("heading", { name: "Your review", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
    await expect(page.getByText("The repair is working well.", { exact: true })).toBeVisible();
    const posted = (await db.query("SELECT id,rating,tags,comment,editable_until FROM reviews WHERE job_id=$1", [job])).rows;
    expect(posted).toHaveLength(1); expect(posted[0]).toMatchObject({ rating: 4, tags: ["Tidy"], comment: "The repair is working well." });
    await page.reload(); await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByLabel("Add a comment (optional)", { exact: true }).fill("Updated after using the repair."); await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Your review", exact: true })).toBeVisible();
    await expect(page.getByText("Updated after using the repair.", { exact: true })).toBeVisible();
    expect((await db.query("SELECT id,rating,comment,editable_until FROM reviews WHERE job_id=$1", [job])).rows).toEqual([{ id: posted[0].id, rating: 4, comment: "Updated after using the repair.", editable_until: posted[0].editable_until }]);
    for (const action of ["review.posted", "review.edited"]) expect(Number((await db.query("SELECT count(*) FROM audit_log WHERE record_id=$1 AND action=$2", [posted[0].id, action])).rows[0].count)).toBe(1);
    expect(Number((await db.query("SELECT count(*) FROM notifications WHERE user_id=$1", [customer.id])).rows[0].count)).toBe(notifications);
    await page.reload(); await expect(page.getByText("Updated after using the repair.", { exact: true })).toBeVisible(); await settle(page); await expectNoA11yViolations(page);
    await page.getByRole("main").getByRole("link", { name: "My jobs", exact: true }).click(); await expect(page).toHaveURL(`${app}/dashboard?q=review`); await page.goBack();
    await expect(page).toHaveURL(href); await expect(page.getByText("Updated after using the repair.", { exact: true })).toBeVisible();
  });
  test("a review already fixed by the database remains visible without Edit", async ({ page, context }) => {
    await context.addCookies(await sessionCookies(customer, secret, app!, "http://127.0.0.1:54511"));
    const job = await fixture();
    await db.query("INSERT INTO reviews(job_id,reviewer_id,worker_id,rating,tags,comment,created_at) VALUES($1,$2,$3,5,ARRAY['On time'],'An older review.',now()-interval '8 days')", [job, customer.id, worker]);
    await page.goto(`${app}/jobs/${job}`); await expect(page.getByText("An older review.", { exact: true })).toBeVisible(); await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
    await settle(page); await expectNoA11yViolations(page);
  });
});
