import { expect, test } from "@playwright/test";
import { SIGNOFF_STATES } from "../../src/lib/office/signoff";
import { expectNoA11yViolations } from "./support/a11y";
const preview = process.env.OFFICE_SIGNOFF_PREVIEW_URL || process.env.POSTED_PREVIEW_E2E_URL || "http://127.0.0.1:3101";
test("office sign-off preview remains guarded in production", async ({ page }) => { expect((await page.goto("/dev/components/office-signoff?state=list"))?.status()).toBe(404); });
for (const width of [320,390,768,1024,1440]) test(`office sign-off states at ${width}px`, async ({ page }) => {
  test.setTimeout(180_000); await page.setViewportSize({ width, height: 1000 });
  for (const state of SIGNOFF_STATES) await test.step(state, async () => {
    expect((await page.goto(`${preview}/dev/components/office-signoff?state=${state}`))?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expectNoA11yViolations(page);
  });
  await page.goto(`${preview}/dev/components/finish-job?state=sent-back`);
  await expect(page.getByText("The office sent this back: Check the CoC number and send it again.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expectNoA11yViolations(page);
});
test("office opens evidence, flags by keyboard, and returns to the list", async ({ page }) => {
  await page.goto(`${preview}/dev/components/office-signoff?state=list`);
  await page.getByRole("link", { name: "TM-1005 · Sub wiring" }).press("Enter");
  await expect(page.getByRole("heading", { name: "Sub wiring", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Flag", exact: true }).press("Enter");
  await expect(page.getByRole("dialog", { name: "Send back to tradie" })).toBeVisible();
  await page.getByLabel("Note for the tradie").fill("Check the CoC number and send again.");
  await page.getByRole("button", { name: "Send back to tradie", exact: true }).press("Enter");
  await expect(page.getByRole("heading", { name: "Sign-off / CoC review" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Sent back to Jack Wilson." })).toBeVisible();
  await page.getByRole("link", { name: "TM-1005 · Sub wiring" }).click();
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Sign-off / CoC review" }).click();
  await expect(page.getByRole("link", { name: "TM-1005 · Sub wiring" })).toBeVisible();
});
test("flag validates its note, keeps it through offline, and dialog restores focus", async ({ page, context }) => {
  await page.goto(`${preview}/dev/components/office-signoff?state=review-electrical`);
  const flag = page.getByRole("button", { name: "Flag", exact: true }); await flag.click();
  await page.getByRole("button", { name: "Send back to tradie", exact: true }).click();
  await expect(page.getByText("Enter a note between 3 and 500 characters.")).toBeVisible();
  await page.getByLabel("Note for the tradie").fill("Fix the CoC."); await context.setOffline(true);
  await expect(page.getByRole("button", { name: "Send back to tradie", exact: true })).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByLabel("Note for the tradie")).toHaveValue("Fix the CoC."); await context.setOffline(false);
  await page.keyboard.press("Escape"); await expect(flag).toBeFocused();
  await flag.press("Enter"); await page.getByRole("button", { name: "Send back to tradie", exact: true }).press("Enter");
  await expect(page.getByRole("heading", { name: "Sign-off / CoC review" })).toBeVisible();
});

test("retrying a dismissed flag error reopens the note instead of approving", async ({ page }) => {
  await page.goto(`${preview}/dev/components/office-signoff?state=flag-error`);
  await page.getByRole("button", { name: "Not now", exact: true }).click();
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Send back to tradie" })).toBeVisible();
  await expect(page.getByText(/Checked by/)).toHaveCount(0);
});

test.describe("actual office flag and tradie resend", () => {
  const app = process.env.OFFICE_SIGNOFF_APP_URL, database = process.env.OFFICE_SIGNOFF_DATABASE_URL;
  test.skip(!app || !database, "Opt in with the isolated localhost office sign-off app and database.");
  test.describe.configure({ mode: "serial", timeout: 120_000 });
  test("office list → evidence → flag → list; assigned tradie sees note, saves and resends", async ({ browser }) => {
    const { randomBytes, randomUUID } = await import("node:crypto"), { execFile } = await import("node:child_process"), { promisify } = await import("node:util");
    const { default: pg } = await import("pg");
    const { startAuthStub, sessionCookies } = await import("../../scripts/screenshots/auth-stub");
    const url = new URL(database!), appUrl = new URL(app!);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/lane_c_173" || url.search || url.hash || appUrl.hostname !== "127.0.0.1") throw Error("Only the dedicated localhost lane_c_173 database/app is allowed.");
    const db = new pg.Client({ connectionString: database }), secret = randomBytes(32).toString("hex"), auth = await startAuthStub(secret, 54573);
    await db.connect();
    const office = { id: randomUUID(), email: `${randomUUID()}@office.example.test` }, tradie = { id: randomUUID(), email: `${randomUUID()}@tradie.example.test` }, customer = { id: randomUUID(), email: `${randomUUID()}@customer.example.test` }, job = randomUUID();
    const contexts: Awaited<ReturnType<typeof browser.newContext>>[] = [];
    try {
      for (const [person, role, first] of [[office, "ADMIN", "Matt"], [tradie, "TRADIE", "Jack"], [customer, "CUSTOMER", "Sarah"]] as const) {
        await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [person.id, person.email]);
        await db.query("INSERT INTO profiles(id,email,role,first_name,email_verified_at,updated_at) VALUES($1,$2,$3,$4,now(),now())", [person.id, person.email, role, first]);
      }
      await db.query("INSERT INTO jobs(id,customer_id,category,title,description,address_line1,suburb,city,any_time) VALUES($1,$2,'OTHER','Browser evidence review','Fix the outdoor plug.','173 Test Street','Windsor','Invercargill',true)", [job, customer.id]);
      await promisify(execFile)(process.execPath, ["--conditions=react-server", "--import", "tsx", "--input-type=module", "-e", `import {createDatabaseClient} from './src/server/database-client.ts'; import {priceJob} from './src/server/pricing/price-job.ts'; import {sendForSignOff} from './src/server/jobs/evidence.ts'; const db=createDatabaseClient(process.env.OFFICE_SIGNOFF_DATABASE_URL); try {await priceJob(db,{jobId:'${job}',minutes:120,materialsCents:0,pricedById:'${office.id}'}); await db.job.update({where:{id:'${job}'},data:{status:'ASSIGNED',workerId:'${tradie.id}'}}); await db.jobMaterials.create({data:{jobId:'${job}',budgetCents:0,spentCents:0,spentAt:new Date()}}); await db.tradeEvidenceRule.update({where:{trade:'OTHER'},data:{minPhotos:0}}); const r=await sendForSignOff(db,{userId:'${tradie.id}',role:'TRADIE'},'${job}',{cocNumber:'',notes:'Work finished.',spent:'0',declaration:true,reason:''}); if(r.status!=='sent')throw Error(JSON.stringify(r));} finally {await db.$disconnect();}`]);
      const number = (await db.query("SELECT job_number FROM jobs WHERE id=$1", [job])).rows[0].job_number;
      const officeContext = await browser.newContext(); contexts.push(officeContext);
      await officeContext.addCookies(await sessionCookies(office, secret, app!, "http://127.0.0.1:54573")); const page = await officeContext.newPage();
      await page.goto(`${app}/admin/signoff`); const row = page.getByRole("link", { name: `TM-${number} · Browser evidence review`, exact: true }); await expect(row).toBeVisible(); await row.press("Enter");
      await expect(page.getByRole("heading", { name: "Browser evidence review", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Flag", exact: true }).press("Enter"); await page.getByLabel("Note for the tradie").fill("Please correct the notes and resend.");
      await page.getByRole("button", { name: "Send back to tradie", exact: true }).press("Enter");
      await expect(page).toHaveURL(/\/admin\/signoff\?sent=/); await expect(page.getByText("Sent back to Jack.")).toBeVisible(); await expect(row).toHaveCount(0);
      const afterFlag = (await db.query("SELECT j.status,j.worker_id,e.submitted_at,e.office_check,e.check_note FROM jobs j JOIN completion_evidence e ON e.job_id=j.id WHERE j.id=$1", [job])).rows[0];
      expect(afterFlag).toMatchObject({ status: "ASSIGNED", worker_id: tradie.id, submitted_at: null, office_check: "FLAGGED", check_note: "Please correct the notes and resend." });
      expect((await db.query("SELECT count(*) FROM payouts WHERE job_id=$1", [job])).rows[0].count).toBe("0");
      const tradieContext = await browser.newContext(); contexts.push(tradieContext); await tradieContext.addCookies(await sessionCookies(tradie, secret, app!, "http://127.0.0.1:54573")); const workerPage = await tradieContext.newPage();
      await workerPage.goto(`${app}/jobs/${job}/complete`); await expect(workerPage.getByText("The office sent this back: Please correct the notes and resend.")).toBeVisible();
      await workerPage.getByLabel("Notes", { exact: true }).fill("Corrected notes from the actual worker."); await workerPage.getByRole("button", { name: "Save for later", exact: true }).click(); await expect(workerPage.getByText("Saved for later.", { exact: true })).toBeVisible();
      await workerPage.reload(); await expect(workerPage.getByLabel("Notes", { exact: true })).toHaveValue("Corrected notes from the actual worker.");
      await workerPage.getByRole("button", { name: "Send for sign-off", exact: true }).click(); await expect(workerPage.getByRole("heading", { name: "Sent for sign-off", exact: true })).toBeVisible();
      await expect(workerPage.getByText("The office sent this back: Please correct the notes and resend.")).toHaveCount(0);
      const afterSend = (await db.query("SELECT j.status,e.office_check,e.check_note,e.submitted_at FROM jobs j JOIN completion_evidence e ON e.job_id=j.id WHERE j.id=$1", [job])).rows[0]; expect(afterSend).toMatchObject({ status: "SUBMITTED", office_check: null, check_note: null }); expect(afterSend.submitted_at).not.toBeNull();
      await page.goto(`${app}/admin/signoff/${job}`); await expect(page.getByText("Corrected notes from the actual worker.", { exact: true })).toBeVisible(); await page.getByRole("button", { name: "Approve", exact: true }).click(); await expect(page.getByText(/Checked by/)).toBeVisible();
      expect((await db.query("SELECT status FROM jobs WHERE id=$1", [job])).rows[0].status).toBe("SUBMITTED");
      await expectNoA11yViolations(page); await expectNoA11yViolations(workerPage);
    } finally { await Promise.all(contexts.map(context => context.close())); await db.end(); await new Promise<void>((resolve, reject) => auth.close(error => error ? reject(error) : resolve())); }
  });
});
