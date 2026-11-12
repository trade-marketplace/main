import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { SECURITY_PASSWORD, SECURITY_TRADIE, SECURITY_USER, startSecurityAuthStub } from "./support/security-auth-stub";
import { expect, test } from "@playwright/test";
import { expectNoA11yViolations } from "./support/a11y";
const preview = process.env.POSTED_PREVIEW_E2E_URL || "http://127.0.0.1:3101";
const states = ["closed", "open", "uploading", "upload-error", "field-errors", "sending", "sent", "priced", "approved", "declined", "already-waiting", "try-later", "error", "offline", "loading", "empty", "gallery"];
test("extra work previews keep the production guard", async ({ page }) => { expect((await page.goto("/dev/components/request-extra-work?state=open"))?.status()).toBe(404); });
for (const width of [320, 390, 768, 1024, 1440]) test(`extra work states at ${width}px`, async ({ page }) => {
  test.setTimeout(180_000); await page.setViewportSize({ width, height: 1000 });
  for (const state of states) await test.step(state, async () => {
    expect((await page.goto(`${preview}/dev/components/request-extra-work?state=${state}`))?.status()).toBe(200);
    if (["open", "uploading", "upload-error", "field-errors", "sending", "try-later", "error", "offline"].includes(state)) await expect(page.getByRole("dialog", { name: "Extra work", exact: true })).toBeVisible();
    if (["sent", "priced", "already-waiting"].includes(state)) await expect(page.getByRole("button", { name: "Extra work", exact: true })).toHaveAttribute("aria-disabled", "true");
    if (state === "declined") await expect(page.getByRole("region", { name: "Extra work", exact: true })).toContainText("Sarah said no to the extra work. Finish the original job only.");
    if (state === "priced" || state === "approved") await expect(page.getByRole("region", { name: "Extra work", exact: true })).toContainText("Earn +$64.00");
    expect(await page.locator("main").innerText()).not.toMatch(/customer price|margin|You earn|materials field/i);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await expectNoA11yViolations(page);
    if (process.env.EXTRA_WORK_SCREENSHOTS_DIR && [390, 1440].includes(width)) await page.screenshot({ path: `${process.env.EXTRA_WORK_SCREENSHOTS_DIR}/${state}-${width}.png`, fullPage: true });
  });
});
test("keyboard opens, closes with Escape, restores focus and sends completed photos", async ({ page }) => {
  await page.goto(`${preview}/dev/components/request-extra-work?state=closed`);
  const trigger = page.getByRole("button", { name: "Extra work", exact: true }); await trigger.focus(); await trigger.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Extra work", exact: true }); await expect(dialog.getByRole("heading", { name: "Extra work", exact: true })).toBeFocused();
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
  await trigger.press("Enter"); await page.getByLabel("What needs doing?", { exact: false }).fill("short"); await page.getByLabel("Extra hours", { exact: false }).focus(); await expect(dialog.getByRole("paragraph").filter({ hasText: "Describe the extra work in 10 to 2000 characters." })).toBeVisible(); await page.getByLabel("What needs doing?", { exact: false }).fill("Replace the second cracked switch."); await page.getByLabel("Extra hours", { exact: false }).fill("0.5");
  const send = page.getByRole("button", { name: "Send for pricing", exact: true }); await expect(send).toHaveAttribute("aria-disabled", "true");
  await page.locator('input[type="file"]').setInputFiles({ name: "switch.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2s8AAAAASUVORK5CYII=", "base64") });
  await expect(send).not.toHaveAttribute("aria-disabled", "true"); await send.press("Enter");
  await expect(dialog).toHaveCount(0); await expect(page.getByRole("status").filter({ hasText: "Sent for pricing." })).toBeVisible();
  await expect(page.getByRole("region", { name: "Extra work", exact: true })).toContainText("Extra work sent. We’re pricing it.");
  await expect(trigger).toHaveAttribute("aria-disabled", "true"); await expectNoA11yViolations(page);
});
test("failed send keeps the same request key and payload until a successful retry", async ({ page }) => {
  await page.goto(`${preview}/dev/components/request-extra-work?state=error`);
  const retry = page.getByRole("button", { name: "Try again", exact: true }); await retry.press("Enter");
  await expect(page.getByLabel("What needs doing?", { exact: false })).toHaveValue("Replace the second cracked switch.");
  await retry.press("Enter"); await expect(page.getByRole("dialog")).toHaveCount(0); await expect(page.getByRole("region", { name: "Extra work", exact: true })).toContainText("Extra work sent.");
});
test("upload failure retries and pending extra work preserves the existing Finish restriction", async ({ page }) => {
  await page.goto(`${preview}/dev/components/request-extra-work?state=upload-error`); await page.getByRole("button", { name: "Retry Extra work photo", exact: true }).press("Enter");
  await expect(page.getByRole("button", { name: "Send for pricing", exact: true })).not.toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape"); await page.goto(`${preview}/dev/components/request-extra-work?state=already-waiting`);
  await expect(page.getByRole("button", { name: "Finish job", exact: true })).toHaveAttribute("aria-disabled", "true");
});


test.describe("actual assigned job and private staged photos", () => {
  const app = process.env.EXTRA_WORK_E2E_APP_URL, database = process.env.EXTRA_WORK_E2E_DATABASE_URL;
  test.skip(!app || !database, "Requires the dedicated localhost lane_b_160 app/database and local providers.");
  test.describe.configure({ mode: "serial", timeout: 120_000 });
  let db: pg.Client, auth: Awaited<ReturnType<typeof startSecurityAuthStub>>, provider: Server;
  const jobId = randomUUID(), objects = new Map<string, Buffer>();
  test.beforeAll(async () => {
    const url = new URL(database!);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/lane_b_160" || url.search || url.hash || new URL(app!).hostname !== "127.0.0.1") throw Error("Extra work fixture requires dedicated localhost lane_b_160 app/database.");
    auth = await startSecurityAuthStub(54620); db = new pg.Client({ connectionString: database }); await db.connect();
    provider = createServer(async (request, response) => {
      response.setHeader("Access-Control-Allow-Origin", "*"); response.setHeader("Access-Control-Allow-Headers", "*"); response.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
      const send = (status: number, value: unknown) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(value)); };
      try {
        if (request.method === "OPTIONS") { response.writeHead(204); response.end(); return; }
        const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk)); const body = Buffer.concat(chunks);
        const url = new URL(request.url!, "http://127.0.0.1:54621");
        if (url.pathname.startsWith("/auth/")) {
          const upstream = await fetch(`http://127.0.0.1:54620${request.url}`, { method: request.method, headers: request.headers as Record<string, string>, ...(body.length ? { body: new Uint8Array(body) } : {}) });
          response.writeHead(upstream.status, { "content-type": "application/json" }); response.end(await upstream.text()); return;
        }
        const signed = url.pathname.replace("/storage/v1/object/upload/sign/", "");
        if (url.pathname.startsWith("/storage/v1/object/upload/sign/")) {
          if (request.method === "POST") return send(200, { url: `/object/upload/sign/${signed}?token=fixture-token` });
          if (request.method === "PUT") {
            const form = await new Response(new Uint8Array(body), { headers: { "content-type": request.headers["content-type"]! } }).formData();
            const file = [...form.values()].find(value => typeof value !== "string"); if (!file) return send(400, {});
            objects.set(signed, Buffer.from(await file.arrayBuffer())); return send(200, { Key: signed });
          }
        }
        const path = url.pathname.replace("/storage/v1/object/", "");
        if (request.method === "GET" && objects.has(path)) { response.writeHead(200, { "content-type": "application/octet-stream" }); response.end(objects.get(path)); return; }
        if (request.method === "POST" && path.startsWith("photos/")) { objects.set(path, body); return send(200, { Key: path }); }
        if (request.method === "DELETE") { for (const item of JSON.parse(body.toString()).prefixes) objects.delete(`${path}/${item}`); return send(200, []); }
        return send(404, { message: "Outside the isolated provider" });
      } catch { return send(500, { message: "Local fixture failed" }); }
    });
    await new Promise<void>(resolve => provider.listen(54621, "127.0.0.1", resolve));
    for (const [id, email, role, firstName] of [[SECURITY_USER.id, SECURITY_USER.email, "CUSTOMER", "Sarah"], [SECURITY_TRADIE.id, SECURITY_TRADIE.email, "TRADIE", "Jack"]]) {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2) ON CONFLICT(id) DO NOTHING", [id, email]);
      await db.query("INSERT INTO profiles(id,email,role,first_name,last_name,phone,email_verified_at,updated_at) VALUES($1,$2,$3,$4,'Test','+64215550192',now(),now()) ON CONFLICT(id) DO UPDATE SET role=excluded.role,first_name=excluded.first_name,email_verified_at=now()", [id, email, role, firstName]);
    }
    await db.query("INSERT INTO jobs(id,customer_id,category,status,title,description,address_line1,suburb,city,any_time) VALUES($1,$2,'OTHER','REVIEW','Actual extra work','Move the table upstairs.','160 Private Street','Windsor','Invercargill',true)", [jobId, SECURITY_USER.id]);
    await promisify(execFile)(process.execPath, ["--conditions=react-server", "--import", "tsx", "--input-type=module", "-e", `import { createDatabaseClient } from './src/server/database-client.ts'; import { priceJob } from './src/server/pricing/price-job.ts'; const db = createDatabaseClient(process.env.EXTRA_WORK_E2E_DATABASE_URL); try { await priceJob(db, { jobId: '${jobId}', minutes: 60, materialsCents: 0 }); } finally { await db.$disconnect(); }`]);
    await db.query("UPDATE jobs SET status='ASSIGNED',worker_id=$2 WHERE id=$1", [jobId, SECURITY_TRADIE.id]);
  });
  test.afterAll(async () => { await new Promise<void>(resolve => provider ? provider.close(() => resolve()) : resolve()); await auth?.close(); await db?.end(); });
  test("real signed upload is processed, request persists after reload, and My work / Back returns", async ({ page }) => {
    await page.goto(`${app}/login?next=${encodeURIComponent(`/jobs/${jobId}`)}`); await page.getByLabel("Email", { exact: true }).fill(SECURITY_TRADIE.email); await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD); await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Actual extra work", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Extra work", exact: true }).press("Enter"); await page.getByLabel("What needs doing?", { exact: false }).fill("Move a second table upstairs."); await page.getByLabel("Extra hours", { exact: false }).fill("0.5");
    await page.locator('input[type="file"]').setInputFiles({ name: "extra.jpg", mimeType: "image/jpeg", buffer: readFileSync("public/images/examples/switch.jpg") });
    const send = page.getByRole("button", { name: "Send for pricing", exact: true }); await expect(send).not.toHaveAttribute("aria-disabled", "true"); await send.press("Enter"); await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Extra work", exact: true })).toContainText("Extra work sent. We’re pricing it.");
    const rows = (await db.query("SELECT id,status,request_key FROM variations WHERE job_id=$1", [jobId])).rows; expect(rows).toHaveLength(1); expect(rows[0].status).toBe("REQUESTED");
    const photos = (await db.query("SELECT path,ready FROM variation_photos WHERE variation_id=$1", [rows[0].id])).rows; expect(photos).toHaveLength(1); expect(photos[0].ready).toBe(true); expect(objects.get(`photos/${photos[0].path}`)?.subarray(0, 4).toString()).toBe("RIFF");
    expect([...objects.keys()].filter(key => key.startsWith("variation-uploads/"))).toHaveLength(0);
    await page.reload(); await expect(page.getByRole("region", { name: "Extra work", exact: true })).toContainText("Move a second table upstairs."); await expect(page.getByRole("button", { name: "Extra work", exact: true })).toHaveAttribute("aria-disabled", "true");
    await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "My work", exact: true }).press("Enter"); await expect(page).toHaveURL(/\/dashboard$/); await page.goBack(); await expect(page.getByRole("region", { name: "Extra work", exact: true })).toContainText("Extra work sent."); await expectNoA11yViolations(page);
  });
});
