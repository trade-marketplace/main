import { expect, test, type Page } from "@playwright/test";
import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { startAuthStub, sessionCookies } from "../../scripts/screenshots/auth-stub";

// Preserve failed-retry traces without recording every successful state navigation in the CI budget.
test.use({ trace: "on-first-retry" });

const preview = process.env.EXTRA_WORK_PREVIEW_URL || process.env.POSTED_PREVIEW_E2E_URL || "http://127.0.0.1:3101";
const states = ["waiting-office", "priced-card", "dialog", "photo-open", "decline-confirm", "declining", "declined", "paying", "pay-error", "changed", "approved", "offline", "error", "loading", "empty"];
async function settleShortMotion(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    // Audit the painted state after entry/hover transitions, without waiting on timers or infinite skeletons.
    const transitions = document.getAnimations().filter(animation => {
      const end = animation.effect?.getComputedTiming().endTime;
      return typeof end === "number" && end > 0 && end <= 1000;
    });
    await Promise.all(transitions.map(animation => animation.finished.catch(() => {})));
  });
}
test("extra work previews stay guarded on the normal production app", async ({ request, baseURL }) => {
  expect((await request.get(`${baseURL}/dev/components/extra-work`)).status()).toBe(404);
});
for (const viewport of VIEWPORTS) test(`extra work states fit ${viewport.width}px and pass axe`, async ({ page }) => {
  test.setTimeout(180_000); await page.setViewportSize(viewport);
  for (const state of states) await test.step(state, async () => {
    expect((await page.goto(`${preview}/dev/components/extra-work?state=${state}`))?.status()).toBe(200);
    if (["dialog", "paying", "pay-error", "offline"].includes(state)) await expect(page.getByRole("dialog", { name: "Jack found extra work", exact: true })).toBeVisible();
    if (state === "photo-open") await expect(page.getByRole("dialog", { name: "Extra work photos", exact: true })).toBeVisible();
    if (state.startsWith("declin") && state !== "declined") await expect(page.getByRole("dialog", { name: "Decline the extra work?", exact: true })).toBeVisible();
    if (state === "declined") await expect(page.getByRole("heading", { name: "Extra work declined.", exact: true })).toBeVisible();
    if (state === "approved") await expect(page.getByRole("heading", { name: "Extra work approved · +$148.00", exact: true })).toBeVisible();
    if (state === "waiting-office") await expect(page.getByText("Jack asked for extra work. We’re pricing it.", { exact: true })).toBeVisible();
    if (state === "loading") await expect(page.getByRole("status", { name: "Loading extra work", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await settleShortMotion(page);
    await expectNoA11yViolations(page);
    if (process.env.EXTRA_WORK_SCREENSHOTS === "1" && [390, 1440].includes(viewport.width)) await page.screenshot({ path: test.info().outputPath(`${state}-${viewport.width}.png`), fullPage: true });
  });
});

test("keyboard dialog focuses its heading, closes back to Have a look, and confirms decline", async ({ page }) => {
  await page.goto(`${preview}/dev/components/extra-work?state=priced-card`);
  const trigger = page.getByRole("button", { name: "Have a look", exact: true });
  await trigger.focus(); await trigger.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Jack found extra work", exact: true });
  await expect(dialog.getByRole("heading", { name: "Jack found extra work", exact: true })).toBeFocused();
  await expect(dialog.getByText("Extra cost · fixed · incl. GST", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible(); await expect(trigger).toBeFocused();
  await trigger.press("Enter");
  await dialog.getByRole("button", { name: "Decline", exact: true }).press("Enter");
  const confirm = page.getByRole("dialog", { name: "Decline the extra work?", exact: true });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Go back", exact: true }).press("Enter");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Decline", exact: true }).press("Enter");
  await confirm.getByRole("button", { name: "Decline", exact: true }).press("Enter");
  await expect(page.getByRole("heading", { name: "Extra work declined.", exact: true })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Declined. Jack’s been told." })).toBeVisible();
  await settleShortMotion(page);
  await expectNoA11yViolations(page);
});
test("photo viewer closes back to the dialog and Approve opens checkout with Back", async ({ page }) => {
  await page.goto(`${preview}/dev/components/extra-work?state=dialog`);
  const dialog = page.getByRole("dialog", { name: "Jack found extra work", exact: true });
  const photo = dialog.getByRole("button", { name: "Open photo 1 of 2: Extra work · 1", exact: true });
  await photo.click();
  const viewer = page.getByRole("dialog", { name: "Extra work photos", exact: true });
  await expect(viewer).toBeVisible();
  for (let index = 0; index < 5; index++) { await page.keyboard.press("Tab"); expect(await viewer.evaluate(node => node.contains(document.activeElement))).toBe(true); }
  await page.keyboard.press("Escape"); await expect(viewer).not.toBeVisible(); await expect(photo).toBeFocused();
  await dialog.getByRole("button", { name: "Approve & pay $148.00", exact: true }).click();
  await expect(page).toHaveURL(`${preview}/dev/components/extra-work?state=checkout`);
  await page.getByRole("link", { name: "Back to job", exact: true }).click();
  await expect(page.getByRole("button", { name: "Have a look", exact: true })).toBeVisible();
});
test("payment error retries in place and offline protects the decision", async ({ page, context }) => {
  await page.goto(`${preview}/dev/components/extra-work?state=pay-error`);
  const dialog = page.getByRole("dialog", { name: "Jack found extra work", exact: true });
  await dialog.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(dialog.getByRole("alert").filter({ hasText: "Couldn’t start the payment. Try again." })).toBeVisible();
  await context.setOffline(true);
  await expect(dialog.getByRole("button", { name: "Approve & pay $148.00", exact: true })).toHaveAttribute("aria-disabled", "true");
  await context.setOffline(false);
  await expect(dialog.getByText("The switchboard’s second circuit is overloaded and needs a new breaker. It’s not safe to leave.", { exact: true })).toBeVisible();
});
test("a changed extra closes the old decision and asks the customer to look again", async ({ page }) => {
  await page.goto(`${preview}/dev/components/extra-work?state=changed`);
  await page.getByRole("button", { name: "Have a look", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Jack found extra work", exact: true });
  await dialog.getByRole("button", { name: "Approve & pay $148.00", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText("The extra work changed. Have another look.", { exact: true })).toBeVisible();
});

const app = process.env.EXTRA_WORK_E2E_APP_URL, database = process.env.EXTRA_WORK_E2E_DATABASE_URL;
test.describe("real customer extra work actions and checkout", () => {
  test.skip(!app || !database, "requires an isolated local app and throwaway database");
  test.describe.configure({ mode: "serial" });
  let db: pg.Client, auth: Awaited<ReturnType<typeof startAuthStub>>;
  const secret = randomUUID(), user = { id: randomUUID(), email: `${randomUUID()}@example.test` }, worker = randomUUID();
  test.beforeAll(async () => {
    const target = new URL(database!), host = new URL(app!);
    if (target.hostname !== "127.0.0.1" || target.pathname !== "/lane_a_159" || target.search || host.hostname !== "127.0.0.1") throw new Error("Dedicated local Lane A fixtures required");
    auth = await startAuthStub(secret, 54511); db = new pg.Client({ connectionString: database }); await db.connect();
    for (const [id, email, role, name] of [[user.id, user.email, "CUSTOMER", "Sarah"], [worker, `${worker}@example.test`, "TRADIE", "Jack"]]) {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [id, email]);
      await db.query("INSERT INTO profiles(id,email,role,first_name,email_verified_at,updated_at) VALUES($1,$2,$3,$4,now(),now())", [id, email, role, name]);
    }
  });
  test.afterAll(async () => { await db?.end(); if (auth) await new Promise<void>(resolve => auth.close(() => resolve())); });
  async function fixture() {
    const job = randomUUID(), extra = randomUUID();
    await db.query("INSERT INTO jobs(id,customer_id,worker_id,category,title,description,address_line1,suburb,city,any_time,status,price_cents,updated_at) VALUES($1,$2,$3,'OTHER','Extra work journey','Replace a switch.','1 Example Street','Windsor','Invercargill',true,'ASSIGNED',37200,now())", [job, user.id, worker]);
    // Legacy nullable request identities are explicitly supported by the existing variation rules.
    await db.query("INSERT INTO variations(id,job_id,requested_by_id,description,requested_minutes) VALUES($1,$2,$3,'Replace the cracked second switch.',30)", [extra, job, worker]);
    await db.query("UPDATE variations SET status='PRICED',revision=1,minutes=30,materials_cents=0,worker_gross_cents=3500,holiday_pay_cents=280,on_cost_cents=700,margin_cents=600,gst_cents=762,price_cents=5842 WHERE id=$1", [extra]);
    return { job, extra };
  }
  test("auto-opens once per revision, declines once, and keeps the My jobs return path", async ({ page, context }) => {
    await context.addCookies(await sessionCookies(user, secret, app!, "http://127.0.0.1:54511"));
    const { job, extra } = await fixture();
    const href = `${app}/jobs/${job}?from=%2Fdashboard%3Fq%3Dextra`;
    await page.goto(href);
    const dialog = page.getByRole("dialog", { name: "Jack found extra work", exact: true });
    await expect(dialog.getByRole("heading", { name: "Jack found extra work", exact: true })).toBeFocused();
    await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible();
    await page.reload(); await expect(page.getByRole("button", { name: "Have a look", exact: true })).toBeVisible(); await expect(dialog).not.toBeVisible();
    await db.query("UPDATE variations SET revision=revision+1 WHERE id=$1", [extra]);
    await page.reload(); await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Decline", exact: true }).click();
    await page.getByRole("dialog", { name: "Decline the extra work?", exact: true }).getByRole("button", { name: "Decline", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Extra work declined.", exact: true })).toBeVisible();
    expect((await db.query("SELECT status FROM variations WHERE id=$1", [extra])).rows[0].status).toBe("DECLINED");
    expect(Number((await db.query("SELECT count(*) FROM notifications WHERE user_id=$1 AND type='variation.declined' AND payload->>'variationId'=$2", [worker, extra])).rows[0].count)).toBe(1);
    await page.getByRole("main").getByRole("link", { name: "My jobs", exact: true }).click();
    await expect(page).toHaveURL(`${app}/dashboard?q=extra`);
  });
  test("Approve opens the existing checkout for the exact extra amount without marking it approved", async ({ page, context }) => {
    await context.addCookies(await sessionCookies(user, secret, app!, "http://127.0.0.1:54511"));
    const { job, extra } = await fixture(); await page.goto(`${app}/jobs/${job}`);
    const dialog = page.getByRole("dialog", { name: "Jack found extra work", exact: true });
    await dialog.getByRole("button", { name: "Approve & pay $58.42", exact: true }).click();
    await expect(page).toHaveURL(new RegExp("/pay/[a-f0-9-]+$"));
    const paymentId = new URL(page.url()).pathname.split("/").at(-1);
    expect((await db.query("SELECT kind,status,amount_cents,variation_id FROM payments WHERE id=$1", [paymentId])).rows[0]).toEqual({ kind: "VARIATION", status: "PENDING", amount_cents: 5842, variation_id: extra });
    expect((await db.query("SELECT status FROM variations WHERE id=$1", [extra])).rows[0].status).toBe("PRICED");
    await page.getByRole("link", { name: "Back to job", exact: true }).click();
    await expect(page).toHaveURL(`${app}/jobs/${job}`); await expect(page.getByRole("button", { name: "Have a look", exact: true })).toBeVisible();
  });
});
