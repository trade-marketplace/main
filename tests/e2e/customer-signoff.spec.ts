import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createServer, request as httpRequest, type RequestListener, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import pg from "pg";
import sharp from "sharp";
import { startAuthStub, sessionCookies } from "../../scripts/screenshots/auth-stub";
import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const preview = process.env.CUSTOMER_SIGNOFF_PREVIEW_URL || process.env.POSTED_PREVIEW_E2E_URL || "http://127.0.0.1:3101";
const states = ["electrical", "photos", "rated", "hours-left", "paused", "saving", "error", "offline", "files-unavailable", "sorted", "auto-completed", "loading", "empty", "load-error", "certificate-photo", "recovery"];
// Chromium's full new-headless browser supports inline PDF tabs; the old headless shell downloads them.
test.use({ reducedMotion: "reduce", channel: "chromium" });
test("sign-off previews and fixture certificate remain guarded on the normal app", async ({ request, baseURL }) => {
  for (const path of ["/dev/components/customer-signoff", "/dev/components/customer-signoff/certificate"]) expect((await request.get(`${baseURL}${path}`)).status()).toBe(404);
});
for (const viewport of VIEWPORTS) test(`sign-off states fit ${viewport.width}px and pass axe`, async ({ page }) => {
  test.setTimeout(240_000); await page.setViewportSize(viewport);
  for (const state of states) await test.step(state, async () => {
    expect((await page.goto(`${preview}/dev/components/customer-signoff?state=${state}`))?.status()).toBe(200);
    if (state === "loading") await expect(page.getByRole("status", { name: "Loading job", exact: true })).toBeVisible();
    else if (state === "auto-completed") await expect(page.getByText("We marked this done automatically.", { exact: true })).toBeVisible();
    else if (state === "sorted") { await expect(page.getByRole("status").filter({ hasText: "Sorted." })).toBeVisible(); await expect(page.locator(".tm-flash")).toHaveAttribute("data-playing", "false"); }
    else if (state === "load-error") await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
    else if (state !== "recovery") {
      await expect(page.getByRole("heading", { name: "Please check", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: /^Yes, all sorted/ })).toBeVisible();
      if (state === "rated") await expect(page.getByRole("textbox", { name: "Add a comment (optional)", exact: true })).toBeVisible();
      else await expect(page.getByRole("textbox", { name: "Add a comment (optional)", exact: true })).toHaveCount(0);
      if (state === "hours-left") await expect(page.getByText("46h left", { exact: true })).toBeVisible();
      if (state === "paused") { await expect(page.getByText("Auto-release is paused while your report is open.", { exact: true })).toBeVisible(); await expect(page.getByText("No reply in 48 hours and we’ll mark it done.", { exact: true })).toHaveCount(0); }
      if (state === "offline" || state === "empty") await expect(page.getByRole("button", { name: "Yes, all sorted", exact: true })).toHaveAttribute("aria-disabled", "true");
      if (state === "files-unavailable") await expect(page.getByText("Can’t load the files.", { exact: true })).toBeVisible();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expectNoA11yViolations(page);
    if ([390, 1440].includes(viewport.width)) await page.screenshot({ path: test.info().outputPath(`${state}-${viewport.width}.png`), fullPage: true });
  });
});
test("stars use arrow keys, tags allow multiple choices, finished photos use the viewer and CoC opens a PDF tab", async ({ page, context }) => {
  await page.goto(`${preview}/dev/components/customer-signoff?state=electrical`);
  await expect(page.getByRole("textbox", { name: "Add a comment (optional)", exact: true })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "On time", exact: true })).toBeDisabled();
  const first = page.getByRole("radio", { name: "1 star, Poor", exact: true }); await first.focus(); await first.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "2 stars, Not great", exact: true })).toBeChecked();
  await page.getByRole("textbox", { name: "Add a comment (optional)", exact: true }).fill("Thanks, all sorted.");
  await page.getByRole("checkbox", { name: "On time", exact: true }).check(); await page.getByRole("checkbox", { name: "Tidy", exact: true }).check();
  await page.getByRole("button", { name: "Open photo 1 of 2: Finished work · 1", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible(); await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toHaveCount(0);
  const popup = context.waitForEvent("page"); await page.getByRole("link", { name: /View Certificate of Compliance/ }).click(); const certificate = await popup;
  await expect(certificate).toHaveURL(/\/dev\/components\/customer-signoff\/certificate/); await certificate.close();
  const file = await page.request.get(`${preview}/dev/components/customer-signoff/certificate`); expect(file.headers()["content-type"]).toBe("application/pdf"); expect((await file.body()).subarray(0, 5).toString()).toBe("%PDF-");
  await expectNoA11yViolations(page);
  await page.goto(`${preview}/dev/components/customer-signoff?state=error`);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sorted.", exact: true })).toBeVisible();
});

const app = process.env.CUSTOMER_SIGNOFF_E2E_APP_URL, database = process.env.CUSTOMER_SIGNOFF_E2E_DATABASE_URL;
const runFixture = promisify(execFile);
test.describe("real customer sign-off journey", () => {
  test.skip(!app || !database, "requires isolated local app and lane_a_129 database");
  test.describe.configure({ mode: "serial" });
  let db: pg.Client, auth: Server, storage: Server;
  const secret = randomUUID(), customer = { id: randomUUID(), email: `${randomUUID()}@example.test` }, worker = { id: randomUUID(), email: `${randomUUID()}@example.test` };
  const objects = new Map<string, { bytes: Buffer; type: string }>(), tokens = new Map<string, string>();
  test.beforeAll(async () => {
    const target = new URL(database!), host = new URL(app!);
    if (target.hostname !== "127.0.0.1" || target.pathname !== "/lane_a_129" || target.search || host.hostname !== "127.0.0.1") throw Error("Dedicated local Lane A fixtures required");
    auth = await startAuthStub(secret, 54510);
    const original = auth.listeners("request")[0] as RequestListener; auth.removeListener("request", original);
    auth.on("request", (request, response) => {
      if (!request.url?.startsWith("/storage/")) return original(request, response);
      const proxy = httpRequest({ hostname: "127.0.0.1", port: 54511, path: request.url, method: request.method, headers: request.headers }, result => { response.writeHead(result.statusCode ?? 500, result.headers); result.pipe(response); });
      proxy.on("error", () => { response.writeHead(502); response.end(); }); request.pipe(proxy);
    });
    storage = createServer(async (request, response) => {
      const url = new URL(request.url!, "http://127.0.0.1:54511"), key = decodeURIComponent(url.pathname.replace(/^\/storage\/v1\/object\/sign\//, ""));
      if (request.method === "POST" && request.headers.apikey === "sb_secret_signoff_local_test_only" && objects.has(key)) {
        for await (const _chunk of request) { void _chunk; }
        const token = randomUUID(); tokens.set(token, key); response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ signedURL: `/object/sign/${key}?token=${token}` })); return;
      }
      if (request.method === "GET" && tokens.get(url.searchParams.get("token") ?? "") === key && objects.has(key)) { const object = objects.get(key)!; response.writeHead(200, { "content-type": object.type }); response.end(object.bytes); return; }
      response.writeHead(403, { "content-type": "application/json" }); response.end(JSON.stringify({ error: "not-allowed", message: "Private test file" }));
    });
    await new Promise<void>((resolve, reject) => { storage.once("error", reject); storage.listen(54511, "127.0.0.1", resolve); });
    db = new pg.Client({ connectionString: database }); await db.connect();
    for (const [person, role, first, last] of [[customer, "CUSTOMER", "Sarah", "Thompson"], [worker, "TRADIE", "Jack", "Wilson"]] as const) {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [person.id, person.email]);
      await db.query("INSERT INTO profiles(id,email,role,first_name,last_name,email_verified_at,updated_at) VALUES($1,$2,$3,$4,$5,now(),now())", [person.id, person.email, role, first, last]);
    }
  });
  test.afterAll(async () => { await db?.end(); for (const server of [auth, storage]) if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } });
  const create = async (imageCertificate = false) => {
    const result = await runFixture(process.execPath, ["--conditions=react-server", "--import", "tsx", "--input-type=module", "-e", `
      import { createDatabaseClient } from './src/server/database-client.ts';
      import { priceJob } from './src/server/pricing/price-job.ts';
      const target = new URL(process.env.CUSTOMER_SIGNOFF_E2E_DATABASE_URL);
      if (target.hostname !== '127.0.0.1' || target.pathname !== '/lane_a_129' || target.search) throw Error('Local Lane A fixtures only');
      const client = createDatabaseClient(target.href), [customerId, workerId, extension] = process.argv.slice(1);
      try {
        const job = await client.job.create({ data: { customerId, category: 'OTHER', title: 'Sign-off journey', description: 'Interior door needs hanging.', addressLine1: '1 Example Street', suburb: 'Windsor', city: 'Invercargill', status: 'REVIEW' } });
        const priced = await priceJob(client, { jobId: job.id, minutes: 60, materialsCents: 0 }); if (!priced.ok) throw Error('Fixture price unavailable');
        await client.job.update({ where: { id: job.id }, data: { status: 'ASSIGNED', workerId } });
        await client.jobMaterials.create({ data: { jobId: job.id, budgetCents: 0, spentCents: 0, spentAt: new Date() } });
        await client.completionEvidence.create({ data: { jobId: job.id, workerId, cocNumber: '2026-118734', cocPath: 'coc/' + workerId + '/signoff.' + extension, notes: 'Finished work. All safe.', declaration: 'I did this work and it is safe and complete.', declaredAt: new Date() } });
        await client.completionEvidencePhoto.create({ data: { jobId: job.id, path: 'evidence/' + job.id + '/finished.webp' } });
        await client.completionEvidence.update({ where: { jobId: job.id }, data: { submittedAt: new Date() } });
        await client.job.update({ where: { id: job.id }, data: { status: 'SUBMITTED' } });
        process.stdout.write(job.id);
      } finally { await client.$disconnect(); }
    `, customer.id, worker.id, imageCertificate ? "webp" : "pdf"], { cwd: process.cwd(), env: process.env });
    const id = result.stdout.trim(), pdf = await fetch(`${preview}/dev/components/customer-signoff/certificate`);
    const photo = await sharp(await readFile("public/images/examples/modules.jpg")).webp().toBuffer();
    objects.set(`documents/coc/${worker.id}/signoff.${imageCertificate ? "webp" : "pdf"}`, { bytes: imageCertificate ? photo : Buffer.from(await pdf.arrayBuffer()), type: imageCertificate ? "image/webp" : "application/pdf" });
    objects.set(`photos/evidence/${id}/finished.webp`, { bytes: photo, type: "image/webp" });
    return id;
  };
  test("keyboard rating and optional tags save with sign-off, celebrate once and end on the completed panel", async ({ page, context }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await context.addCookies(await sessionCookies(customer, secret, app!, "http://127.0.0.1:54510"));
    const id = await create(); await page.goto(`${app}/jobs/${id}?from=%2Fdashboard`);
    await expect(page.getByText("Finished work. All safe.", { exact: true })).toBeVisible();
    const first = page.getByRole("radio", { name: "1 star, Poor", exact: true }); await first.focus(); for (let index = 0; index < 4; index++) await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("radio", { name: "5 stars, Excellent", exact: true })).toBeChecked();
    await page.getByRole("checkbox", { name: "Tidy", exact: true }).check(); await page.getByRole("textbox", { name: "Add a comment (optional)", exact: true }).fill("Thanks, all sorted.");
    await page.getByRole("button", { name: "Yes, all sorted", exact: true }).press("Enter");
    await expect(page.locator(".tm-flash")).toHaveAttribute("data-playing", "true");
    await expect(page.getByRole("heading", { name: "Sorted.", exact: true })).toBeVisible();
    await expect(page.getByText("We marked this done automatically.", { exact: true })).toHaveCount(0);
    expect((await db.query("SELECT rating,tags,comment FROM reviews WHERE job_id=$1", [id])).rows).toEqual([{ rating: 5, tags: ["Tidy"], comment: "Thanks, all sorted." }]);
    expect((await db.query("SELECT status FROM payouts WHERE job_id=$1", [id])).rows).toEqual([{ status: "QUEUED" }]);
    await page.reload(); await expect(page.locator(".tm-flash")).toHaveCount(0); await expectNoA11yViolations(page);
  });
  test("the real report page and browser Back preserve context; a submitted report pauses auto-release", async ({ page, context }) => {
    await context.addCookies(await sessionCookies(customer, secret, app!, "http://127.0.0.1:54510"));
    const id = await create(), path = `/jobs/${id}?from=%2Fdashboard%3Fq%3Dsignoff%26page%3D2`;
    await page.goto(`${app}${path}`); await page.getByRole("link", { name: "Something’s not right", exact: true }).press("Enter");
    await expect(page).toHaveURL(`${app}/jobs/${id}/problem?from=${encodeURIComponent(path)}`); await expect(page.getByRole("heading", { name: "Report a problem", exact: true })).toBeVisible();
    await page.goBack(); await expect(page).toHaveURL(`${app}${path}`);
    await page.getByRole("link", { name: "Something’s not right", exact: true }).click();
    await page.getByRole("textbox", { name: "Topic", exact: true }).fill("Work not finished"); await page.getByRole("textbox", { name: "Details", exact: true }).fill("The door still catches on the frame.");
    await page.getByRole("button", { name: "Send report", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Sent.", exact: true })).toBeVisible(); await expect(page.getByText("Auto-release is paused while your report is open.", { exact: true })).toBeVisible();
    expect((await db.query("SELECT status FROM problem_reports WHERE job_id=$1", [id])).rows).toEqual([{ status: "OPEN" }]); expect((await db.query("SELECT count(*) FROM payouts WHERE job_id=$1", [id])).rows[0].count).toBe("0");
    await page.getByRole("link", { name: "Back to job", exact: true }).click(); await expect(page).toHaveURL(`${app}${path}`); await expect(page.getByText("Auto-release is paused while your report is open.", { exact: true })).toBeVisible();
    await expectNoA11yViolations(page);
  });
  test("the active sentence follows the real one-hour and 72-hour settings", async ({ page, context }) => {
    await context.addCookies(await sessionCookies(customer, secret, app!, "http://127.0.0.1:54510"));
    const id = await create(), previous = (await db.query("SELECT auto_release_hours FROM settings WHERE id=1")).rows[0].auto_release_hours;
    try {
      for (const hours of [1, 72]) {
        await db.query("UPDATE settings SET auto_release_hours=$1 WHERE id=1", [hours]);
        await page.goto(`${app}/jobs/${id}`);
        await expect(page.getByText(`No reply in ${hours} ${hours === 1 ? "hour" : "hours"} and we’ll mark it done.`, { exact: true })).toBeVisible();
        await expect(page.getByText("No reply in 48 hours and we’ll mark it done.", { exact: true })).toHaveCount(0);
      }
      await expectNoA11yViolations(page);
    } finally { await db.query("UPDATE settings SET auto_release_hours=$1 WHERE id=1", [previous]); }
  });
  for (const imageCertificate of [false, true]) test(`the owned signed ${imageCertificate ? "CoC image" : "PDF"} opens in a new tab`, async ({ page, context }) => {
    await context.addCookies(await sessionCookies(customer, secret, app!, "http://127.0.0.1:54510"));
    const id = await create(imageCertificate), key = `documents/coc/${worker.id}/signoff.pdf`, certificate = objects.get(key);
    if (!imageCertificate) objects.delete(key);
    await page.goto(`${app}/jobs/${id}`);
    if (!imageCertificate) {
      await expect(page.getByText("Can’t load the files.", { exact: true })).toBeVisible();
      await expect(page.getByText("Finished work. All safe.", { exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: /View Certificate of Compliance/ })).toHaveCount(0);
      objects.set(key, certificate!); await page.getByRole("button", { name: "Try again", exact: true }).click();
      await expect(page.getByText("Can’t load the files.", { exact: true })).toHaveCount(0);
    }
    await expect(page.getByText(`CoC 2026-118734 · ${imageCertificate ? "Photo" : "PDF"}`, { exact: true })).toBeVisible();
    const opened = context.waitForEvent("page"); await page.getByRole("link", { name: /View Certificate of Compliance/ }).click(); const file = await opened;
    await expect(file).toHaveURL(new RegExp(`/storage/v1/object/sign/documents/coc/${worker.id}/signoff\\.${imageCertificate ? "webp" : "pdf"}\\?token=`));
    const response = await page.request.get(file.url()); expect(response.status()).toBe(200); expect(response.headers()["content-type"]).toBe(imageCertificate ? "image/webp" : "application/pdf");
    if (imageCertificate) await expect.poll(() => file.locator("img").evaluate(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0)).toBe(true);
    await file.close();
  });
  test("sign-off without a rating saves no review and never flashes under reduced motion", async ({ page, context }) => {
    await context.addCookies(await sessionCookies(customer, secret, app!, "http://127.0.0.1:54510"));
    const id = await create(); await page.goto(`${app}/jobs/${id}`);
    await page.evaluate(() => {
      const state = window as unknown as { signoffFlashed: boolean }; state.signoffFlashed = false;
      new MutationObserver(() => { if (document.querySelector('.tm-flash[data-playing="true"]')) state.signoffFlashed = true; }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-playing"] });
    });
    await page.getByRole("button", { name: "Yes, all sorted", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Sorted.", exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { signoffFlashed: boolean }).signoffFlashed)).toBe(false);
    expect((await db.query("SELECT count(*) FROM reviews WHERE job_id=$1", [id])).rows[0].count).toBe("0");
    expect((await db.query("SELECT count(*) FROM payouts WHERE job_id=$1", [id])).rows[0].count).toBe("1");
  });
});
