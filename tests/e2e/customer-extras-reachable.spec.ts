import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";
import { startAuthStub, sessionCookies } from "../../scripts/screenshots/auth-stub";

const app = process.env.CUSTOMER_EXTRAS_REACHABLE_APP_URL, database = process.env.CUSTOMER_EXTRAS_REACHABLE_DATABASE_URL;
test.describe("older customer extra work stays reachable", () => {
  test.skip(!app || !database, "requires an isolated local app and throwaway database");
  test.describe.configure({ mode: "serial" });
  let db: pg.Client, auth: Awaited<ReturnType<typeof startAuthStub>>;
  const secret = randomUUID(), user = { id: randomUUID(), email: `${randomUUID()}@example.test` }, worker = randomUUID();
  test.beforeAll(async () => {
    const target = new URL(database!), host = new URL(app!);
    if (target.hostname !== "127.0.0.1" || target.pathname !== "/lane_a_549" || target.search || host.hostname !== "127.0.0.1") throw new Error("Dedicated local Lane A fixtures required");
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
    await db.query("UPDATE variations SET created_at='2026-11-01T00:00:00Z' WHERE id=$1", [extra]);
    // Historical decided requests reproduce the reader bug without inventing a paid approval.
    for (let index = 0; index < 6; index++) {
      const id = randomUUID();
      await db.query("INSERT INTO variations(id,job_id,requested_by_id,description,requested_minutes,created_at) VALUES($1,$2,$3,'Previously declined request',30,$4)", [id, job, worker, new Date(Date.UTC(2026, 10, 12, index))]);
      await db.query("UPDATE variations SET status='PRICED',revision=1,minutes=30,materials_cents=0,worker_gross_cents=3500,holiday_pay_cents=280,on_cost_cents=700,margin_cents=600,gst_cents=762,price_cents=5842 WHERE id=$1", [id]);
      await db.query("UPDATE variations SET status='DECLINED' WHERE id=$1", [id]);
    }
    return { job, extra };
  }
  test("the old priced request opens once, remains keyboard reachable, and uses real checkout and decline", async ({ page, context }) => {
    test.setTimeout(120_000);
    await context.addCookies(await sessionCookies(user, secret, app!, "http://127.0.0.1:54511"));
    const { job, extra } = await fixture();
    const href = `${app}/jobs/${job}?from=%2Fdashboard%3Fq%3Dextra`;
    await page.goto(href);
    const dialog = page.getByRole("dialog", { name: "Jack found extra work", exact: true });
    await expect(dialog.getByRole("heading", { name: "Jack found extra work", exact: true })).toBeFocused();
    await expect(dialog.getByText("Replace the cracked second switch.", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await page.reload();
    const trigger = page.getByRole("button", { name: "Have a look", exact: true });
    await expect(trigger).toBeVisible(); await expect(dialog).not.toBeVisible();
    await expect(page.getByRole("heading", { name: "Extra work declined.", exact: true })).toHaveCount(4);
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await trigger.focus(); await trigger.press("Enter");
      await expect(dialog.getByRole("heading", { name: "Jack found extra work", exact: true })).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page).toHaveTitle(/.+/);
      await page.evaluate(() => document.fonts.ready);
      await expectNoA11yViolations(page);
      await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
    }
    await trigger.press("Enter");
    await dialog.getByRole("button", { name: "Approve & pay $58.42", exact: true }).click();
    await expect(page).toHaveURL(new RegExp("/pay/[a-f0-9-]+$"));
    const paymentId = new URL(page.url()).pathname.split("/").at(-1);
    expect((await db.query("SELECT kind,status,amount_cents,variation_id FROM payments WHERE id=$1", [paymentId])).rows[0]).toEqual({ kind: "VARIATION", status: "PENDING", amount_cents: 5842, variation_id: extra });
    expect((await db.query("SELECT status FROM variations WHERE id=$1", [extra])).rows[0].status).toBe("PRICED");
    await page.getByRole("link", { name: "Back to job", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/jobs/${job}`));
    await trigger.focus(); await trigger.press("Enter");
    await dialog.getByRole("button", { name: "Decline", exact: true }).press("Enter");
    const confirmation = page.getByRole("dialog", { name: "Decline the extra work?", exact: true });
    await confirmation.getByRole("button", { name: "Decline", exact: true }).press("Enter");
    await expect(dialog).not.toBeVisible(); await expect(trigger).toHaveCount(0);
    expect((await db.query("SELECT status FROM variations WHERE id=$1", [extra])).rows[0].status).toBe("DECLINED");
    expect(Number((await db.query("SELECT count(*) FROM notifications WHERE user_id=$1 AND type='variation.declined' AND payload->>'variationId'=$2", [worker, extra])).rows[0].count)).toBe(1);
    // Existing checkout returns to the bare job URL, whose normal breadcrumb is Home.
    await page.getByRole("main").getByRole("link", { name: "Home", exact: true }).click();
    await expect(page).toHaveURL(`${app}/`);
  });
});
