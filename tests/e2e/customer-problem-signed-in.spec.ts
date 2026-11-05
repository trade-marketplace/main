import { expect, test, type Page } from "@playwright/test";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import pg from "pg";
import sharp from "sharp";
import { SECURITY_PASSWORD, SECURITY_TRADIE, SECURITY_USER, startSecurityAuthStub } from "./support/security-auth-stub";
import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const app = process.env.CUSTOMER_PROBLEM_E2E_APP_URL, database = process.env.CUSTOMER_PROBLEM_E2E_DATABASE_URL;
test.describe("signed-in customer problem report", () => {
  test.skip(!app || !database, "Needs an isolated localhost app/Auth/Storage and dedicated database.");
  test.describe.configure({ mode: "serial" });
  let auth: Awaited<ReturnType<typeof startSecurityAuthStub>>, storage: ReturnType<typeof createServer>, db: pg.Client;
  const objects = new Map<string, Buffer>();
  const officeId = randomUUID(), foreignId = randomUUID(), foreignJob = randomUUID();
  test.beforeAll(async () => {
    const target = new URL(database!);
    if (!["127.0.0.1", "localhost"].includes(target.hostname) || target.pathname !== "/issue182" || target.search || target.hash || !["127.0.0.1", "localhost"].includes(new URL(app!).hostname)) throw new Error("Report e2e requires isolated localhost issue182.");
    auth = await startSecurityAuthStub(54400);
    // External Auth/Storage are local provider doubles. Browser→server actions→Prisma and upload validation run for real.
    storage = createServer(async (request, response) => {
      try {
        const path = new URL(request.url!, "http://127.0.0.1:54401").pathname;
        const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk)); const bytes = Buffer.concat(chunks);
        if (path.startsWith("/auth/v1/")) {
          const upstream = await fetch(`http://127.0.0.1:54400${request.url}`, { method: request.method, headers: { "content-type": "application/json", authorization: request.headers.authorization ?? "" }, ...(bytes.length ? { body: bytes } : {}) });
          response.writeHead(upstream.status, { "content-type": "application/json" }); response.end(await upstream.text()); return;
        }
        const send = (status: number, body: unknown) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(body)); };
        if (path.startsWith("/storage/v1/object/sign/") && request.method === "POST") { send(200, { signedURL: `${path.replace("/storage/v1", "")}?token=local-fixture` }); return; }
        const object = decodeURIComponent(path.replace(/^\/storage\/v1\/object\/(?:sign\/)?/, ""));
        if (request.method === "POST" && path.startsWith("/storage/v1/object/")) { objects.set(object, bytes); send(200, { Key: object }); return; }
        if (request.method === "HEAD") { response.writeHead(objects.has(object) ? 200 : 404); response.end(); return; }
        if (request.method === "GET" && objects.has(object)) { response.writeHead(200, { "content-type": "image/webp" }); response.end(objects.get(object)); return; }
        send(404, { message: "Fixture object not found" });
      } catch { response.writeHead(500); response.end(); }
    });
    await new Promise<void>(resolve => storage.listen(54401, "127.0.0.1", resolve));
    db = new pg.Client({ connectionString: database }); await db.connect();
    for (const person of [{ ...SECURITY_USER, role: "CUSTOMER" }, { ...SECURITY_TRADIE, role: "TRADIE" }, { id: officeId, email: `${officeId}@example.test`, role: "ADMIN" }, { id: foreignId, email: `${foreignId}@example.test`, role: "CUSTOMER" }]) {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2) ON CONFLICT(id) DO NOTHING", [person.id, person.email]);
      await db.query("INSERT INTO profiles(id,email,role,first_name,email_verified_at) VALUES($1,$2,$3,'Report fixture',now()) ON CONFLICT(id) DO UPDATE SET role=EXCLUDED.role", [person.id, person.email, person.role]);
    }
    await db.query("INSERT INTO jobs(id,customer_id,category,title,description,address_line1,suburb,city,status) VALUES($1,$2,'OTHER','Foreign report job','Private foreign details','1 Fixture Street','Windsor','Invercargill','REVIEW')", [foreignJob, foreignId]);
    await db.query("INSERT INTO jobs(customer_id,worker_id,category,title,description,address_line1,suburb,city,status,price_cents) SELECT $1,$2,'OTHER','Switch history '||n,'Completed history fixture','1 Fixture Street','Windsor','Invercargill','COMPLETED',12000 FROM generate_series(1,26) AS n", [SECURITY_USER.id, SECURITY_TRADIE.id]);
  });
  test.afterAll(async () => { await auth?.close(); if (storage) await new Promise<void>(resolve => storage.close(() => resolve())); await db?.end(); });
  async function login(page: Page, email: string, next: string) {
    await page.goto(`${app}/login?next=${encodeURIComponent(next)}`); await page.getByLabel("Email", { exact: true }).fill(email); await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD);
    await page.getByRole("button", { name: "Log in", exact: true }).click(); await expect(page).toHaveURL(`${app}${next}`);
  }
  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px customer reports with a private photo, reloads Sent and follows Back with list context`, async ({ page }) => {
      test.setTimeout(120000); await page.setViewportSize(viewport);
      const jobId = randomUUID();
      await db.query("INSERT INTO jobs(id,customer_id,worker_id,category,title,description,address_line1,suburb,city,status,price_cents) VALUES($1,$2,$3,'OTHER','Replace a broken light switch','Switch is loose','1 Fixture Street','Windsor','Invercargill','SUBMITTED',12000)", [jobId, SECURITY_USER.id, SECURITY_TRADIE.id]);
      const returnTo = "/dashboard?tab=done&q=switch&page=2", jobHref = `/jobs/${jobId}?from=${encodeURIComponent(returnTo)}`;
      await login(page, SECURITY_USER.email, jobHref);
      await page.getByRole("link", { name: "Report a problem", exact: true }).click(); await expect(page.getByRole("heading", { name: "Report a problem", exact: true })).toBeVisible();
      await page.getByLabel("Topic", { exact: true }).fill("Exposed wires"); await page.getByLabel("Details", { exact: true }).fill(`Private report at ${viewport.width}px. There are exposed wires.`);
      await page.getByRole("checkbox", { name: "Urgent / safety" }).check();
      const png = await sharp({ create: { width: 24, height: 24, channels: 3, background: { r: 20, g: 80, b: 30 } } }).png().toBuffer();
      await page.locator('input[type="file"]').setInputFiles({ name: "switch.png", mimeType: "image/png", buffer: png });
      await expect(page.getByText("Uploaded", { exact: true })).toBeVisible();
      await expectNoA11yViolations(page);
      await page.getByRole("button", { name: "Send report", exact: true }).focus(); await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/problem\?report=[0-9a-f-]{36}&from=/);
      await expect(page.getByRole("heading", { name: "Sent.", exact: true })).toBeVisible(); await expect(page.getByText(/Auto-release is paused/)).toBeVisible();
      const reportId = new URL(page.url()).searchParams.get("report")!;
      await page.reload(); await expect(page.getByRole("heading", { name: "Sent.", exact: true })).toBeVisible();
      const row = (await db.query("SELECT p.status,p.urgent,t.job_participants,m.body,(SELECT count(*) FROM problem_report_photos WHERE report_id=p.id) AS photos FROM problem_reports p JOIN support_threads t ON t.problem_report_id=p.id JOIN support_messages m ON m.thread_id=t.id WHERE p.id=$1", [reportId])).rows[0];
      expect(row).toMatchObject({ status: "OPEN", urgent: true, job_participants: false, photos: "1" }); expect(row.body).toContain("Urgent / safety");
      await page.getByRole("link", { name: "Back to job", exact: true }).click(); await expect(page).toHaveURL(`${app}${jobHref}`);
      await page.getByRole("navigation", { name: /^Back ·/ }).getByRole("link", { name: "My jobs", exact: true }).click(); await expect(page).toHaveURL(`${app}${returnTo}`);
      await page.goto(`${app}/jobs/${foreignJob}/problem`); await expect(page.getByRole("heading", { name: "Wrong address.", exact: true })).toBeVisible();
    });
  }
  test("office follows the urgent Problems row to the existing job messages and private photo; worker cannot read the report", async ({ browser }) => {
    test.setTimeout(120000);
    const jobId = randomUUID();
    await db.query("INSERT INTO jobs(id,customer_id,worker_id,category,title,description,address_line1,suburb,city,status,price_cents) VALUES($1,$2,$3,'OTHER','Office handoff fixture','Switch is loose','1 Fixture Street','Windsor','Invercargill','SUBMITTED',12000)", [jobId, SECURITY_USER.id, SECURITY_TRADIE.id]);
    const customerContext = await browser.newContext(), customer = await customerContext.newPage();
    try {
      await login(customer, SECURITY_USER.email, `/jobs/${jobId}/problem`);
      await customer.getByLabel("Topic", { exact: true }).fill("Exposed wires"); await customer.getByLabel("Details", { exact: true }).fill("Private report at office handoff. There are exposed wires.");
      await customer.getByRole("checkbox", { name: "Urgent / safety" }).check();
      const png = await sharp({ create: { width: 24, height: 24, channels: 3, background: { r: 20, g: 80, b: 30 } } }).png().toBuffer();
      await customer.locator('input[type="file"]').setInputFiles({ name: "office-switch.png", mimeType: "image/png", buffer: png });
      await expect(customer.getByText("Uploaded", { exact: true })).toBeVisible(); await customer.getByRole("button", { name: "Send report", exact: true }).click();
      await expect(customer.getByRole("heading", { name: "Sent.", exact: true })).toBeVisible();
    } finally { await customerContext.close(); }
    const report = (await db.query("SELECT p.id,p.job_id,t.id AS thread_id FROM problem_reports p JOIN support_threads t ON t.problem_report_id=p.id WHERE p.job_id=$1", [jobId])).rows[0];
    const workerContext = await browser.newContext(), worker = await workerContext.newPage();
    try {
      await login(worker, SECURITY_TRADIE.email, "/messages");
      await worker.goto(`${app}/messages/${report.thread_id}`); await expect(worker.getByRole("heading", { name: "Wrong address.", exact: true })).toBeVisible();
      await expect(worker.locator("body")).not.toContainText("Private report at");
    } finally { await workerContext.close(); }
    // Reuse a fixture Auth identity as office after the worker privacy check; the server always rereads profiles.role.
    await db.query("UPDATE profiles SET role='ADMIN' WHERE id=$1", [SECURITY_TRADIE.id]);
    await db.query("UPDATE notifications SET user_id=$1 WHERE type='problem_report.created' AND user_id=$2", [SECURITY_TRADIE.id, officeId]);
    const officeContext = await browser.newContext(), office = await officeContext.newPage();
    try {
      await login(office, SECURITY_TRADIE.email, "/admin");
      const row = office.getByRole("row").filter({ hasText: "Office handoff fixture" }).filter({ hasText: "Urgent · Exposed wires" });
      await expect(row).toBeVisible(); await row.getByRole("link", { name: "Office handoff fixture", exact: true }).click(); await expect(office).toHaveURL(new RegExp(`/admin/jobs/${report.job_id}$`));
      await expect(office.getByText(/Urgent \/ safety/).first()).toBeVisible();
      const photo = office.getByRole("img", { name: /Message photo/ }).first(); await expect(photo).toBeVisible();
      await expect.poll(() => photo.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    } finally { await officeContext.close(); await db.query("UPDATE profiles SET role='TRADIE' WHERE id=$1", [SECURITY_TRADIE.id]); }
  });
});
