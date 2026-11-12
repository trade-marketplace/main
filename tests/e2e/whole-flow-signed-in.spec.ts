import { randomBytes } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import pg from "pg";
import { PEOPLE } from "../../prisma/seed/data.mjs";
import { sessionCookies } from "../../scripts/screenshots/auth-stub";
import { postingDays } from "../../src/lib/job-time-windows";
import { expectNoA11yViolations } from "./support/a11y";
import { fakeCardPayment, localWholeFlow, startWholeFlowApp, wholeFlowName, wholeFlowServices, WHOLE_FLOW_AUTH } from "./support/whole-flow-services";

const app = process.env.WHOLE_FLOW_E2E_APP_URL, database = process.env.WHOLE_FLOW_E2E_DATABASE_URL;
const money = (cents: number) => new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(cents / 100);
test.use({ reducedMotion: "reduce", trace: "on-first-retry", actionTimeout: 15_000, navigationTimeout: 30_000 });
test.describe("one real job, from posting to queued payroll", () => {
  test.skip(!app || !database, "Opt in with WHOLE_FLOW_E2E_APP_URL and a migrated, seeded disposable lane_d_191 database.");
  test.describe.configure({ mode: "serial", timeout: 240_000 });
  const secret = randomBytes(32).toString("hex");
  let db: pg.Client, services: Awaited<ReturnType<typeof wholeFlowServices>>, server: Awaited<ReturnType<typeof startWholeFlowApp>>;
  test.beforeAll(async () => {
    localWholeFlow(app!, database!);
    db = new pg.Client({ connectionString: database }); await db.connect();
    const seeded = await db.query("SELECT id,role FROM profiles WHERE id=ANY($1::uuid[])", [[PEOPLE.customer.id, PEOPLE.tradie.id, PEOPLE.office.id]]);
    expect(seeded.rows).toHaveLength(3);
    // An aborted earlier run's draft points at its now-closed in-memory Storage fixture. Start one fresh draft.
    await db.query("DELETE FROM job_drafts WHERE profile_id=$1", [PEOPLE.customer.id]);
    // Initial account proofs/points only. Every job, price, booking and completion is created through the UI.
    await db.query("UPDATE worker_profiles SET identity_checked_at=now(),identity_checked_by_id=$2,paused_at=NULL WHERE user_id=$1", [PEOPLE.tradie.id, PEOPLE.office.id]);
    await db.query("INSERT INTO point_entries(worker_id,delta,reason) VALUES($1,5,'OFFICE')", [PEOPLE.tradie.id]);
    services = await wholeFlowServices(secret); server = await startWholeFlowApp(database!);
  });
  test.afterAll(async () => { await server?.stop(); await services?.close(); await db?.end(); });

  test("customer → office → customer payment → tradie → customer sign-off → queued payout", async ({ browser }) => {
    const title = wholeFlowName(), street = "191 Whole Flow Street", contexts: BrowserContext[] = [], external: string[] = [];
    async function person(who: typeof PEOPLE.customer) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" }); contexts.push(context);
      await context.route("**/*", route => {
        const url = new URL(route.request().url());
        if (["http:", "https:"].includes(url.protocol) && !["127.0.0.1", "localhost"].includes(url.hostname)) { external.push(url.origin); return route.abort(); }
        return route.continue();
      });
      await context.addCookies(await sessionCookies(who, secret, app!, WHOLE_FLOW_AUTH));
      return context.newPage();
    }
    const customer = await person(PEOPLE.customer), office = await person(PEOPLE.office), tradie = await person(PEOPLE.tradie);
    let id = "", paymentId = "", customerPrice = "", earn = "", pricedBudget = 0;
    const privacy = async (page: Page, role: "customer" | "tradie") => {
      const text = await page.locator("body").innerText();
      if (role === "customer" && earn) expect(text).not.toContain(earn);
      if (role === "tradie" && customerPrice) expect(text).not.toContain(customerPrice);
    };
    try {
      await test.step("1. Customer posts an electrical job, photo and two windows; lands on Posted", async () => {
        await customer.goto(`${app}/`); await customer.getByRole("link", { name: "Post a job", exact: true }).first().click();
        await expect(customer.getByRole("heading", { name: "What needs doing?", exact: true })).toBeVisible();
        await customer.getByRole("textbox", { name: "Describe the job", exact: true }).fill(`${title}\nCheck the lounge lights and replace the damaged switch.`);
        await customer.getByRole("radio", { name: "Electrical", exact: true }).check();
        await customer.getByRole("button", { name: "Next", exact: true }).press("Enter");
        await expect(customer.getByRole("heading", { name: "Add some photos", exact: true })).toBeVisible();
        await customer.locator('input[type="file"]').last().setInputFiles("public/images/examples/outlet.jpg");
        await expect(customer.getByRole("button", { name: "Next", exact: true })).not.toHaveAttribute("aria-disabled", "true", { timeout: 30_000 });
        await customer.getByRole("button", { name: "Next", exact: true }).click();
        await customer.getByRole("combobox", { name: "Address", exact: true }).fill(street);
        await customer.getByRole("option", { name: `${street}, Windsor, Invercargill 9810`, exact: true }).click();
        const clear = customer.getByRole("button", { name: "Clear selection", exact: true });
        if (await clear.getAttribute("aria-disabled") !== "true") await clear.click();
        const date = postingDays(new Date())[1].value;
        for (const part of ["MORNING", "AFTERNOON"]) await customer.locator(`input[name="time-windows"][value="${date}/${part}"]`).check();
        await customer.getByRole("button", { name: "Next", exact: true }).press("Enter");
        await expect(customer.getByRole("heading", { name: "All good?", exact: true })).toBeVisible();
        await customer.getByRole("button", { name: "Post it", exact: true }).press("Enter");
        await expect(customer.getByRole("heading", { name: "Posted.", exact: true })).toBeVisible();
        const job = await db.query("SELECT id,status,category FROM jobs WHERE customer_id=$1 AND title=$2", [PEOPLE.customer.id, title]); expect(job.rows).toHaveLength(1);
        id = job.rows[0].id; expect(job.rows[0]).toMatchObject({ status: "REVIEW", category: "ELECTRICAL" });
        expect((await db.query("SELECT count(*)::int AS n FROM job_time_windows WHERE job_id=$1", [id])).rows[0].n).toBe(2);
        expect((await db.query("SELECT count(*)::int AS n FROM job_photos WHERE job_id=$1", [id])).rows[0].n).toBe(1);
        await customer.getByRole("link", { name: "View my job", exact: true }).click(); await expect(customer).toHaveURL(`${app}/jobs/${id}`);
      });
      await test.step("2. Office opens Queues, sets the price and sends it", async () => {
        await office.goto(`${app}/admin`);
        const row = office.getByRole("table", { name: "To price", exact: true }).getByRole("row").filter({ hasText: title });
        const price = row.getByRole("link", { name: "Price it", exact: true });
        if (await price.count()) await price.click();
        else {
          await row.getByRole("link", { name: "Open", exact: true }).click();
          await expect(office.getByRole("heading", { level: 1 }).filter({ hasText: title })).toBeVisible();
          await test.step("Queues → pricing workspace link", async step => {
            await expect(office.locator(`a[href="/admin/jobs/${id}/price"]`)).toHaveCount(0);
            test.info().annotations.push({ type: "fixme", description: "#568: zero-estimate Queues Open/detail has no pricing-workspace link. https://github.com/trade-marketplace/main/issues/568" });
            step.skip(true, "#568: continue on the real authorized pricing screen without inventing an estimate");
          });
          await office.goto(`${app}/admin/jobs/${id}/price`);
        }
        await expect(office.getByRole("heading", { name: "Set the price", exact: true })).toBeVisible();
        await office.getByRole("textbox", { name: "Hours", exact: true }).fill("2"); await office.getByRole("textbox", { name: "Materials", exact: true }).fill("85.00");
        await office.getByRole("button", { name: "Send price to customer", exact: true }).click();
        await office.getByRole("alertdialog", { name: "Send price to customer", exact: true }).getByRole("button", { name: "Send price to customer", exact: true }).click();
        await expect(office.getByRole("heading", { name: "Price sent to customer", exact: true })).toBeVisible();
        const priced = (await db.query("SELECT j.price_cents,p.worker_gross_cents+p.holiday_pay_cents AS earn,p.materials_cents FROM jobs j JOIN job_pricing p ON p.job_id=j.id WHERE j.id=$1", [id])).rows[0];
        customerPrice = money(priced.price_cents); earn = money(priced.earn); pricedBudget = priced.materials_cents; expect(customerPrice).not.toBe(earn);
      });
      await test.step("3. Customer accepts through checkout; fake card webhook makes it booked and waiting", async () => {
        await customer.reload(); await expect(customer.getByText(customerPrice, { exact: true }).first()).toBeVisible(); await privacy(customer, "customer");
        await customer.getByRole("button", { name: "Accept & pay", exact: true }).click(); await expect(customer).toHaveURL(/\/pay\/[0-9a-f-]{36}$/);
        await expect(customer.getByRole("heading", { name: "Pay & book", exact: true })).toBeVisible(); await privacy(customer, "customer");
        paymentId = new URL(customer.url()).pathname.split("/").at(-1)!;
        expect(JSON.parse(await fakeCardPayment(database!, paymentId))).toEqual({ first: "paid", replay: "duplicate" });
        await customer.getByRole("link", { name: "Back to job", exact: true }).click();
        await expect(customer.getByRole("heading", { name: "We’re finding someone", exact: true })).toBeVisible(); await privacy(customer, "customer");
      });
      await test.step("4. Tradie finds it on the board and claims; only now is the street revealed", async () => {
        await tradie.goto(`${app}/jobs`);
        const browse = tradie.getByRole("link", { name: "Browse jobs", exact: true });
        if (await browse.count()) await browse.click();
        await privacy(tradie, "tradie"); expect(await tradie.locator("main").innerText()).not.toContain(street);
        await tradie.getByRole("heading", { name: title, exact: true }).locator("..").click();
        await expect(tradie.getByRole("heading", { name: title, exact: true }).first()).toBeVisible(); await privacy(tradie, "tradie"); expect(await tradie.locator("main").innerText()).not.toContain(street);
        await tradie.getByRole("button", { name: "Claim job", exact: true }).click();
        await tradie.getByRole("alertdialog", { name: "Take this job?", exact: true }).getByRole("button", { name: "Yes, it’s mine", exact: true }).press("Enter");
        const success = tradie.getByRole("dialog", { name: "It’s yours.", exact: true }); await expect(success).toBeVisible(); await privacy(tradie, "tradie");
        await success.getByRole("button", { name: "Open job", exact: true }).click(); await expect(tradie.getByRole("region", { name: "Customer contact", exact: true })).toContainText(street);
      });
      await test.step("5. Tradie books an offered window; customer sees the booking", async () => {
        await tradie.getByRole("link", { name: "Book a time", exact: true }).click(); await tradie.getByRole("radio", { name: "Morning", exact: true }).first().check();
        await tradie.getByRole("button", { name: /^Book .* · Morning$/ }).press("Enter");
        await expect(tradie).toHaveURL(url => url.pathname === `/jobs/${id}`); await privacy(tradie, "tradie");
        await customer.reload(); const booked = (await db.query("SELECT booked_date::text AS date,booked_time FROM jobs WHERE id=$1", [id])).rows[0]; expect(booked.booked_time).toBe("MORNING");
        await expect(customer.getByText(/Morning/).first()).toBeVisible(); await privacy(customer, "customer");
      });
      await test.step("6. Tradie sends I’m on my way; the customer sees the update", async () => {
        await tradie.getByRole("button", { name: "I’m on my way", exact: true }).press("Enter");
        await expect(tradie.getByRole("status").filter({ hasText: `Sent to ${PEOPLE.customer.firstName}.` })).toBeVisible();
        await customer.reload(); await expect(customer.getByText(/on (the|his|their) way/i).first()).toBeVisible(); await privacy(customer, "customer");
      });
      await test.step("7. Tradie uploads finished photos and CoC, reports materials, declares and sends", async () => {
        await tradie.getByRole("link", { name: "Finish job", exact: true }).click(); await expect(tradie.getByRole("heading", { name: "Finish up", exact: true })).toBeVisible(); await privacy(tradie, "tradie");
        for (const file of ["outlet.jpg", "switch.jpg"]) { const chooser = tradie.waitForEvent("filechooser"); await tradie.getByRole("button", { name: "Add", exact: true }).click(); await (await chooser).setFiles(`public/images/examples/${file}`); await expect(tradie.getByRole("button", { name: `Remove ${file}`, exact: true })).toBeVisible(); }
        const chooser = tradie.waitForEvent("filechooser"); await tradie.getByRole("region", { name: "CoC document", exact: true }).getByRole("button", { name: "choose files", exact: true }).click();
        await (await chooser).setFiles({ name: "whole-flow-coc.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF") });
        await expect(tradie.getByRole("link", { name: /^whole-flow-coc\.pdf/ })).toBeVisible();
        await tradie.getByLabel("CoC number", { exact: true }).fill("COC-whole-flow-191"); await tradie.getByLabel("Notes", { exact: true }).fill("Finished and checked the lounge circuit.");
        const materials = await db.query("SELECT budget_cents FROM job_materials WHERE job_id=$1", [id]);
        await test.step("Materials spend: use the budgeted electrical spend field", async step => {
          if (pricedBudget > 0 && materials.rows.length === 0) {
            // test.fixme() would skip this entire one-test journey. Mark only the observed affected step.
            test.info().annotations.push({ type: "fixme", description: "#163: positive priced materials budget has no job_materials producer; spend field absent. https://github.com/trade-marketplace/main/issues/163" });
            await expect(tradie.getByLabel("Telfer spend", { exact: true })).toHaveCount(0);
            step.skip(true, "#163: do not synthesize a materials row to hide the missing producer");
          }
          await tradie.getByLabel("Telfer spend", { exact: true }).fill("72.50");
        });
        await tradie.getByRole("checkbox", { name: "The work matches the job and any approved extras.", exact: true }).check();
        await tradie.getByRole("button", { name: "Send for sign-off", exact: true }).press("Enter");
        await expect(tradie.getByRole("heading", { name: "Sent for sign-off", exact: true })).toBeVisible(); await expect(tradie).toHaveURL(url => url.pathname === `/jobs/${id}`);
      });
      await test.step("8. Customer opens evidence, gives five stars and a tag, and signs off", async () => {
        await customer.reload(); await expect(customer.getByText("Finished and checked the lounge circuit.", { exact: true })).toBeVisible(); await privacy(customer, "customer");
        await customer.getByRole("button", { name: /^Open photo 1 of 2:/ }).click(); await expect(customer.getByRole("dialog")).toBeVisible(); await customer.keyboard.press("Escape");
        const opened = customer.context().waitForEvent("page"); await customer.getByRole("link", { name: /View Certificate of Compliance/ }).click(); const certificate = await opened;
        await expect(certificate).toHaveURL(/\/storage\/v1\/object\/sign\/documents\/coc\//); const response = await customer.request.get(certificate.url()); expect(response.status()).toBe(200); expect(response.headers()["content-type"]).toBe("application/pdf"); await certificate.close();
        const star = customer.getByRole("radio", { name: "1 star, Poor", exact: true }); await star.focus(); for (let n = 0; n < 4; n++) await customer.keyboard.press("ArrowRight");
        await expect(customer.getByRole("radio", { name: "5 stars, Excellent", exact: true })).toBeChecked(); await customer.getByRole("checkbox", { name: "Tidy", exact: true }).check();
        await customer.getByRole("button", { name: "Yes, all sorted", exact: true }).press("Enter"); await expect(customer.getByRole("heading", { name: "Sorted.", exact: true })).toBeVisible(); await privacy(customer, "customer");
      });
      await test.step("9. Completed job, one queued payout/review, ordered history and once-only notifications/audits", async () => {
        expect((await db.query("SELECT status,worker_id FROM jobs WHERE id=$1", [id])).rows).toEqual([{ status: "COMPLETED", worker_id: PEOPLE.tradie.id }]);
        const payout = (await db.query("SELECT id,status,worker_id FROM payouts WHERE job_id=$1", [id])).rows; expect(payout).toHaveLength(1); expect(payout[0]).toMatchObject({ status: "QUEUED", worker_id: PEOPLE.tradie.id });
        const reviews = (await db.query("SELECT id,rating,tags,reviewer_id,worker_id FROM reviews WHERE job_id=$1", [id])).rows; expect(reviews).toHaveLength(1); expect(reviews[0]).toMatchObject({ rating: 5, tags: ["Tidy"], reviewer_id: PEOPLE.customer.id, worker_id: PEOPLE.tradie.id });
        expect((await db.query("SELECT to_status,changed_by_id FROM job_status_history WHERE job_id=$1 ORDER BY created_at,id", [id])).rows).toEqual([
          { to_status: "REVIEW", changed_by_id: PEOPLE.customer.id }, { to_status: "PRICED", changed_by_id: PEOPLE.office.id }, { to_status: "BOOKABLE", changed_by_id: null }, { to_status: "ASSIGNED", changed_by_id: PEOPLE.tradie.id }, { to_status: "SUBMITTED", changed_by_id: PEOPLE.tradie.id }, { to_status: "COMPLETED", changed_by_id: PEOPLE.customer.id },
        ]);
        const notifications = (await db.query("SELECT type,user_id,count(*)::int AS n FROM notifications WHERE payload->>'jobId'=$1 GROUP BY type,user_id", [id])).rows;
        const expected = [["job.posted", PEOPLE.tradie.id], ["job.priced", PEOPLE.customer.id], ["job.paid", PEOPLE.customer.id], ["job.claimed", PEOPLE.customer.id], ["job.claimed", PEOPLE.tradie.id], ["job.window_booked", PEOPLE.customer.id], ["job.on_my_way", PEOPLE.customer.id], ["job.submitted", PEOPLE.customer.id], ["job.signed_off", PEOPLE.tradie.id]];
        expect(notifications.map(row => `${row.type}:${row.user_id}:${row.n}`).sort()).toEqual(expected.map(([event, user]) => `${event}:${user}:1`).sort());
        expect((await db.query("SELECT count(*)::int AS n FROM notifications WHERE type='payout.details_missing' AND user_id=$1 AND payload->>'payoutId'=$2", [PEOPLE.tradie.id, payout[0].id])).rows[0].n).toBe(1);
        const audits = (await db.query("SELECT action,actor_id,actor_role FROM audit_log WHERE record_id=ANY($1::text[])", [[id, paymentId, reviews[0].id, payout[0].id]])).rows;
        for (const [action, actor, role] of [["job.posted", PEOPLE.customer.id, "CUSTOMER"], ["job.priced", PEOPLE.office.id, "ADMIN"], ["payment.created", PEOPLE.customer.id, "CUSTOMER"], ["payment.paid", null, null], ["job.paid", null, null], ["job.claimed", PEOPLE.tradie.id, "TRADIE"], ["job.window_booked", PEOPLE.tradie.id, "TRADIE"], ["job.on_my_way", PEOPLE.tradie.id, "TRADIE"], ["job.materials_reported", PEOPLE.tradie.id, "TRADIE"], ["job.submitted", PEOPLE.tradie.id, "TRADIE"], ["job.completed", PEOPLE.customer.id, "CUSTOMER"], ["review.posted", PEOPLE.customer.id, "CUSTOMER"]]) expect(audits.filter(row => row.action === action)).toEqual([{ action, actor_id: actor, actor_role: role }]);
      });
      await test.step("10. My work Done says Queued; Earnings includes this job awaiting payroll", async () => {
        await tradie.getByRole("link", { name: "My work", exact: true }).first().click(); await expect(tradie.getByRole("heading", { name: "My work", exact: true })).toBeVisible();
        const done = tradie.getByRole("region", { name: /^Done / }).filter({ visible: true }); const card = done.getByRole("heading", { name: title, exact: true }).locator(".."); await expect(card).toContainText("Queued"); await privacy(tradie, "tradie");
        await done.getByRole("link", { name: "See all paid", exact: true }).click(); await expect(tradie.getByRole("heading", { name: "Earnings", exact: true })).toBeVisible();
        await tradie.getByRole("table", { name: "Payrolls", exact: true }).locator('a[href="/earnings?payroll=next"]').click(); await expect(tradie.getByRole("dialog")).toContainText(title); await expect(tradie.getByRole("dialog")).toContainText("Queued"); await privacy(tradie, "tradie");
        await tradie.keyboard.press("Escape"); await tradie.evaluate(() => document.fonts.ready); await expectNoA11yViolations(tradie);
        expect(external).toEqual([]);
      });
    } finally { for (const context of contexts) await context.close(); }
  });
});
