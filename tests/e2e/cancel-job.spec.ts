import { randomUUID } from "node:crypto";
import pg from "pg";
import { startAuthStub, sessionCookies } from "../../scripts/screenshots/auth-stub";
import { expect, test, type Page } from "@playwright/test";
import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

test.use({ trace: "on-first-retry" });
const preview = process.env.CANCEL_JOB_PREVIEW_URL || process.env.POSTED_PREVIEW_E2E_URL || "http://127.0.0.1:3101";
const states = ["free", "paid", "paid-unclaimed", "on-the-way", "reason-error", "saving", "error", "changed", "requested", "offline", "loading", "empty"];
async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().filter(animation => { const end = animation.effect?.getComputedTiming().endTime; return typeof end === "number" && end > 0 && end <= 1000; }).map(animation => animation.finished.catch(() => {})));
  });
}
test("cancel previews remain guarded in production", async ({ request, baseURL }) => expect((await request.get(`${baseURL}/dev/components/cancel-job`)).status()).toBe(404));
for (const viewport of VIEWPORTS) test(`cancel states fit ${viewport.width}px and pass axe`, async ({ page }) => {
  test.setTimeout(180_000); await page.setViewportSize(viewport);
  for (const state of states) await test.step(state, async () => {
    expect((await page.goto(`${preview}/dev/components/cancel-job?state=${state}`))?.status()).toBe(200);
    if (!["requested", "loading", "empty"].includes(state)) {
      const dialog = page.getByRole("alertdialog", { name: "Cancel this job?", exact: true });
      await expect(dialog).toBeVisible();
      if (state === "free") { await expect(dialog.getByText("It’s free to cancel.", { exact: true })).toBeVisible(); await expect(dialog.getByLabel("Reason")).toHaveCount(0); }
      else await expect(dialog.getByLabel("Reason", { exact: true })).toBeVisible();
      if (state === "paid-unclaimed") await expect(dialog.getByText("You’ve already paid, so we’ll check before refunding. We’ll reply within 1 working day.", { exact: true })).toBeVisible();
      if (["changed", "offline"].includes(state)) await expect(dialog.getByRole("button", { name: "Request to cancel", exact: true })).toHaveAttribute("aria-disabled", "true");
      await expect(dialog.getByText("Jack is already on the way. A call-out fee may apply.", { exact: true })).toHaveCount(state === "on-the-way" ? 1 : 0);
    } else if (state === "requested") { await expect(page.getByText("Cancel requested. We’ll reply within 1 working day.", { exact: true })).toBeVisible(); await expect(page.getByRole("button", { name: "Cancel job", exact: true })).toHaveCount(0); }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await settle(page); await expectNoA11yViolations(page);
    if (process.env.CANCEL_JOB_SCREENSHOTS === "1" && [390, 1440].includes(viewport.width)) await page.screenshot({ path: test.info().outputPath(`${state}-${viewport.width}.png`), fullPage: true });
  });
});
test("keyboard opens, validates, keeps the job, requests with a reason, and follows My jobs and Back", async ({ page }) => {
  await page.goto(`${preview}/dev/components/cancel-job?state=closed`);
  const trigger = page.getByRole("button", { name: "Cancel job", exact: true });
  await trigger.focus(); await trigger.press("Enter");
  const dialog = page.getByRole("alertdialog", { name: "Cancel this job?", exact: true });
  await expect(dialog.getByRole("heading", { name: "Cancel this job?", exact: true })).toBeFocused();
  for (let index = 0; index < 5; index++) { await page.keyboard.press("Tab"); expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true); }
  await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible(); await expect(trigger).toBeFocused();
  await trigger.press("Enter"); await dialog.getByRole("button", { name: "Keep job", exact: true }).press("Enter");
  await expect(dialog).not.toBeVisible(); await expect(trigger).toBeFocused();
  await page.goto(`${preview}/dev/components/cancel-job?state=paid`);
  await page.getByRole("button", { name: "Request to cancel", exact: true }).press("Enter");
  const reason = page.getByLabel("Reason", { exact: true }); await expect(reason).toBeFocused();
  await expect(page.getByText("Tell us why.")).toBeVisible();
  await reason.fill("The work is no longer needed."); await page.keyboard.press("Tab"); await page.keyboard.press("Tab");
  await page.getByRole("button", { name: "Request to cancel", exact: true }).press("Enter");
  await expect(page.getByText("Cancel requested. We’ll reply within 1 working day.", { exact: true })).toBeVisible();
  await settle(page); await expectNoA11yViolations(page);
  await page.getByRole("main").getByRole("link", { name: "My jobs", exact: true }).click();
  await expect(page).toHaveURL(`${preview}/dev/components/cancel-job?state=closed`); await page.goBack();
  await expect(page).toHaveURL(`${preview}/dev/components/cancel-job?state=paid`);
});
test("free cancel is immediate and an error can retry without losing the reason", async ({ page }) => {
  await page.goto(`${preview}/dev/components/cancel-job?state=free`);
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel job", exact: true }).click();
  await expect(page.getByText("This job was cancelled.", { exact: true })).toBeVisible();
  await page.goto(`${preview}/dev/components/cancel-job?state=error`);
  const reason = page.getByLabel("Reason", { exact: true });
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(reason).toHaveValue("The work is no longer needed.");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByText("Cancel requested. We’ll reply within 1 working day.", { exact: true })).toBeVisible();
});
test("offline preserves the reason and reconnect enables a single request", async ({ page, context }) => {
  await page.goto(`${preview}/dev/components/cancel-job?state=paid`);
  const reason = page.getByLabel("Reason", { exact: true }), send = page.getByRole("button", { name: "Request to cancel", exact: true });
  await reason.fill("The work is no longer needed."); await context.setOffline(true);
  await expect(page.getByText("You’re offline.", { exact: true }).last()).toBeVisible(); await expect(send).toHaveAttribute("aria-disabled", "true");
  await expect(reason).toHaveValue("The work is no longer needed."); await context.setOffline(false);
  await expect(send).not.toHaveAttribute("aria-disabled", "true"); await expect(reason).toHaveValue("The work is no longer needed.");
  await send.click(); await expect(page.getByText("Cancel requested. We’ll reply within 1 working day.", { exact: true })).toBeVisible();
});

const app = process.env.CANCEL_JOB_E2E_APP_URL, database = process.env.CANCEL_JOB_E2E_DATABASE_URL;
test.describe("real customer cancellation actions", () => {
  test.skip(!app || !database, "requires an isolated local app and throwaway database");
  test.describe.configure({ mode: "serial" });
  let db: pg.Client, auth: Awaited<ReturnType<typeof startAuthStub>>;
  const secret = randomUUID(), customer = { id: randomUUID(), email: `${randomUUID()}@example.test` }, worker = { id: randomUUID(), email: `${randomUUID()}@example.test` }, office = randomUUID();
  test.beforeAll(async () => {
    const target = new URL(database!), host = new URL(app!);
    if (target.hostname !== "127.0.0.1" || target.pathname !== "/lane_a_128" || target.search || host.hostname !== "127.0.0.1") throw new Error("Dedicated local Lane A fixtures required");
    auth = await startAuthStub(secret, 54511); db = new pg.Client({ connectionString: database }); await db.connect();
    for (const [id, email, role, name] of [[customer.id, customer.email, "CUSTOMER", "Sarah"], [worker.id, worker.email, "TRADIE", "Jack"], [office, `${office}@example.test`, "ADMIN", "Office"]]) {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [id, email]);
      await db.query("INSERT INTO profiles(id,email,role,first_name,email_verified_at,updated_at) VALUES($1,$2,$3,$4,now(),now())", [id, email, role, name]);
    }
  });
  test.afterAll(async () => { await db?.end(); if (auth) await new Promise<void>(resolve => auth.close(() => resolve())); });
  async function fixture(paid: boolean) {
    const job = randomUUID();
    await db.query("INSERT INTO jobs(id,customer_id,worker_id,category,title,description,address_line1,suburb,city,any_time,status,price_cents,updated_at) VALUES($1,$2,$3,'OTHER','Cancel job journey','Move the couch upstairs.','1 Example Street','Windsor','Invercargill',true,$4,$5,now())", [job, customer.id, paid ? worker.id : null, paid ? "ASSIGNED" : "REVIEW", paid ? 37200 : null]);
    if (paid) {
      await db.query("INSERT INTO payments(job_id,kind,status,amount_cents,paid_at,idempotency_key) VALUES($1,'JOB','PAID',37200,now(),$2)", [job, randomUUID()]);
      await db.query("INSERT INTO audit_log(actor_id,action,record_type,record_id) VALUES($1,'job.on_my_way','jobs',$2)", [worker.id, job]);
    }
    return job;
  }
  test("unpaid cancel is free, refreshes the real cancelled page and preserves My jobs and Back", async ({ page, context }) => {
    await context.addCookies(await sessionCookies(customer, secret, app!, "http://127.0.0.1:54511"));
    const job = await fixture(false), href = `${app}/jobs/${job}?from=%2Fdashboard%3Fq%3Dcancel`;
    await page.goto(href); await page.getByRole("button", { name: "Cancel job", exact: true }).click();
    const dialog = page.getByRole("alertdialog", { name: "Cancel this job?", exact: true });
    await expect(dialog.getByText("It’s free to cancel.", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel job", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Cancelled", exact: true })).toBeVisible();
    expect(Number((await db.query("SELECT count(*) FROM payments WHERE job_id=$1", [job])).rows[0].count)).toBe(0);
    await page.getByRole("main").getByRole("link", { name: "My jobs", exact: true }).click();
    await expect(page).toHaveURL(`${app}/dashboard?q=cancel`); await page.goBack();
    await expect(page).toHaveURL(href); await expect(page.getByRole("heading", { name: "Cancelled", exact: true })).toBeVisible();
  });
  test("paid request warns, requires a reason, notifies once, holds the tradie and preserves payment", async ({ page, context }) => {
    await context.addCookies(await sessionCookies(customer, secret, app!, "http://127.0.0.1:54511"));
    const job = await fixture(true), payments = (await db.query("SELECT * FROM payments WHERE job_id=$1", [job])).rows;
    await page.goto(`${app}/jobs/${job}`); await page.getByRole("button", { name: "Cancel job", exact: true }).click();
    const dialog = page.getByRole("alertdialog", { name: "Cancel this job?", exact: true });
    await expect(dialog.getByText("Jack is already on the way. A call-out fee may apply.", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Request to cancel", exact: true }).click(); await expect(page.getByLabel("Reason", { exact: true })).toBeFocused();
    await page.getByLabel("Reason", { exact: true }).fill("The work is no longer needed.");
    await dialog.getByRole("button", { name: "Request to cancel", exact: true }).press("Enter");
    await expect(page.getByRole("heading", { name: "Cancel requested", exact: true })).toBeVisible();
    await expect(page.getByText("Cancel requested. We’ll reply within 1 working day.", { exact: true })).toBeVisible();
    await page.reload(); await expect(page.getByRole("button", { name: "Cancel job", exact: true })).toHaveCount(0);
    expect((await db.query("SELECT * FROM payments WHERE job_id=$1", [job])).rows).toEqual(payments);
    for (const id of [worker.id, office]) expect(Number((await db.query("SELECT count(*) FROM notifications WHERE user_id=$1 AND type='job.cancel_requested' AND payload->>'jobId'=$2", [id, job])).rows[0].count)).toBe(1);
    expect((await db.query("SELECT reason FROM audit_log WHERE record_id=$1 AND action='job.cancel_requested'", [job])).rows).toEqual([{ reason: "The work is no longer needed." }]);
    await context.clearCookies(); await context.addCookies(await sessionCookies(worker, secret, app!, "http://127.0.0.1:54511"));
    await page.goto(`${app}/jobs/${job}`); await expect(page.getByText("On hold", { exact: true }).first()).toBeVisible();
  });
});
