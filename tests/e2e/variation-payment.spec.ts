import { randomUUID } from "node:crypto";
import pg from "pg";
import Stripe from "stripe";
import { expect, test } from "@playwright/test";
import { expectNoA11yViolations } from "./support/a11y";
import { SECURITY_PASSWORD, SECURITY_TRADIE, SECURITY_USER, startSecurityAuthStub } from "./support/security-auth-stub";

const dev = process.env.E2E_DEV_BASE_URL;
const app = process.env.VARIATION_E2E_APP_URL, database = process.env.VARIATION_E2E_DATABASE_URL;
const states = ["variation", "variation-succeeded", "variation-approved", "variation-checking", "variation-review", "booked"];
test("extra-work checkout previews are guarded in production", async ({ page }) => {
  test.skip(Boolean(dev));
  expect((await page.goto("/dev/components/pay?state=variation-review"))?.status()).toBe(404);
});
test.describe("extra-work payment previews", () => {
  test.skip(!dev, "Needs a guarded local component server.");
  for (const width of [320, 390, 768, 1024, 1440]) test(`${width}px: checkout and every completion outcome fit and pass axe`, async ({ page }) => {
    test.setTimeout(180_000); await page.setViewportSize({ width, height: 900 });
    for (const state of states) {
      await page.goto(`${dev}/dev/components/pay?state=${state}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), state).toBe(true);
      if (state.startsWith("variation")) await expect(page.getByText(/You’re booked|finding someone local|Taking you to your booking/)).toHaveCount(0);
      if (state === "variation") {
        const pay = page.getByRole("button", { name: "Approve & pay $148.00", exact: true });
        await pay.scrollIntoViewIfNeeded(); await pay.focus(); await expect(pay).toBeFocused();
        await expect(page.getByText("The switchboard’s second circuit is overloaded and needs a new breaker.", { exact: true })).toBeVisible();
      }
      await expectNoA11yViolations(page);
    }
  });
});
test.describe("owned variation checkout and verified webhook completion", () => {
  test.skip(!app || !database, "Needs the disposable variation app/database and local Auth double.");
  test.describe.configure({ mode: "serial" });
  let auth: Awaited<ReturnType<typeof startSecurityAuthStub>>, db: pg.Client;
  const webhookSecret = "whsec_disposable_variation_checkout";
  test.beforeAll(async () => {
    const target = new URL(database!);
    if (target.hostname !== "127.0.0.1" || target.pathname !== "/issue158" || new URL(app!).hostname !== "127.0.0.1") throw new Error("Variation e2e requires the disposable issue158 database/app.");
    auth = await startSecurityAuthStub(Number(process.env.VARIATION_E2E_AUTH_PORT ?? 54358));
    db = new pg.Client({ connectionString: database }); await db.connect();
    for (const [user, role] of [[SECURITY_USER, "CUSTOMER"], [SECURITY_TRADIE, "TRADIE"]] as const) {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2) ON CONFLICT(id) DO NOTHING", [user.id, user.email]);
      await db.query("INSERT INTO profiles(id,email,role,first_name,email_verified_at,updated_at) VALUES($1,$2,$3,'Checkout Fixture',now(),now()) ON CONFLICT(id) DO UPDATE SET role=excluded.role", [user.id, user.email, role]);
    }
  });
  test.afterAll(async () => { await auth?.close(); await db?.end(); });
  for (const late of [false, true]) test(late ? "a late paid variation truthfully remains for office review" : "customer sees extra work then verified approval, never a new booking", async ({ page }) => {
    test.setTimeout(90_000); await page.setViewportSize({ width: 390, height: 900 });
    const jobId = randomUUID(), variationId = randomUUID(), paymentId = randomUUID(), intentId = `pi_fixture_${randomUUID().replaceAll("-", "")}`;
    await db.query("INSERT INTO jobs(id,customer_id,worker_id,category,title,description,address_line1,suburb,city,status,price_cents) VALUES($1,$2,$3,'OTHER','Fixture job','Existing assigned work','1 Fixture Street','Windsor','Invercargill','ASSIGNED',6371)", [jobId, SECURITY_USER.id, SECURITY_TRADIE.id]);
    await db.query("INSERT INTO variations(id,job_id,requested_by_id,description,requested_minutes) VALUES($1,$2,$3,'Replace the second cracked switch',30)", [variationId, jobId, SECURITY_TRADIE.id]);
    await db.query("UPDATE variations SET status='PRICED',revision=1,minutes=30,materials_cents=1000,worker_gross_cents=1900,holiday_pay_cents=152,on_cost_cents=257,margin_cents=662,gst_cents=596,price_cents=4567 WHERE id=$1", [variationId]);
    await db.query("INSERT INTO payments(id,job_id,variation_id,variation_revision,kind,status,amount_cents,idempotency_key,provider_payment_id) VALUES($1,$2,$3,1,'VARIATION','PENDING',4567,$4,$5)", [paymentId, jobId, variationId, `fixture-${paymentId}`, intentId]);
    // Hosted card entry is verified separately. This journey exercises our real role/checkout/webhook/result
    // boundaries with a signed local event, without any Stripe network request or account keys.
    await page.route("https://*.stripe.com/**", route => route.abort());
    await page.route("**/pay/**", route => route.request().method() === "POST" && route.request().headers()["next-action"] ? route.abort() : route.continue());
    await page.goto(`${app}/login?next=${encodeURIComponent(`/pay/${paymentId}`)}`);
    await page.getByLabel("Email", { exact: true }).fill(SECURITY_USER.email); await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Extra work", exact: true })).toBeVisible();
    await expect(page.getByText("Replace the second cracked switch", { exact: true })).toBeVisible();
    await expect(page.getByText("$45.67", { exact: true })).toBeVisible();
    if (late) await db.query("UPDATE jobs SET status='CANCELLED' WHERE id=$1", [jobId]);
    const event = { id: `evt_${paymentId}`, type: "payment_intent.succeeded", livemode: false, data: { object: { id: intentId, status: "succeeded", amount: 4567, currency: "nzd", livemode: false, metadata: { paymentId, jobId, kind: "VARIATION" } } } };
    const payload = JSON.stringify(event), signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
    const response = await page.request.post(`${app}/api/stripe/webhook`, { data: payload, headers: { "content-type": "application/json", "stripe-signature": signature } });
    expect(response.status()).toBe(200);
    await page.goto(`${app}/pay/${paymentId}/done`);
    await expect(page.getByRole("heading", { name: late ? "Payment needs review" : "Extra work approved.", exact: true })).toBeVisible();
    await expect(page.getByText(/You’re booked|finding someone local/)).toHaveCount(0);
    if (late) await expect(page.getByText("The office is reviewing this payment. The extra work hasn’t been approved.", { exact: true })).toBeVisible();
    else await expect(page.getByText("We’ve told your tradie to go ahead with the extra work.", { exact: true })).toBeVisible();
    expect((await db.query("SELECT status FROM variations WHERE id=$1", [variationId])).rows[0].status).toBe(late ? "PRICED" : "APPROVED");
    await page.reload(); await expect(page.getByRole("heading", { name: late ? "Payment needs review" : "Extra work approved.", exact: true })).toBeVisible();
    await expectNoA11yViolations(page);
    const foreign = await page.request.get(`${app}/pay/${randomUUID()}/done`); expect(foreign.status()).toBe(404);
  });
});
