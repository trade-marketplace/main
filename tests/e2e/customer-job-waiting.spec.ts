import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";
import { startAuthStub, sessionCookies } from "../../scripts/screenshots/auth-stub";

const preview = process.env.POSTED_PREVIEW_E2E_URL || "http://127.0.0.1:3101";
test("getting-price preview remains guarded on the normal production app", async ({ request }) => {
  expect((await request.get("http://127.0.0.1:3100/dev/components/customer-job-waiting")).status()).toBe(404);
});
const states = ["ready", "delayed", "edit", "cancel", "empty", "loading", "load-error", "offline", "error", "success", "changed", "saving", "invalid", "cancel-error", "recovery-gallery"];
for (const viewport of VIEWPORTS) test(`getting-price states fit ${viewport.width}px`, async ({ page }) => {
  test.setTimeout(180_000); await page.setViewportSize(viewport);
  for (const state of states) await test.step(state, async () => {
    const response = await page.goto(`${preview}/dev/components/customer-job-waiting?state=${state}`);
    expect(response?.status()).toBe(200);
    if (state === "recovery-gallery") { await expect(page.getByRole("heading", { name: "Getting your price · recovery states", exact: true })).toBeVisible(); await expect(page.getByText("Couldn’t cancel the job.", { exact: true })).toBeVisible(); await expect(page.getByText("Couldn’t save.", { exact: true })).toBeVisible(); }
    else if (state === "loading") await expect(page.getByRole("status", { name: "Loading job", exact: true })).toBeVisible();
    else if (state === "load-error") await expect(page.getByRole("heading", { name: "Couldn’t load the job.", exact: true })).toBeVisible();
    else if (["edit", "cancel", "error", "changed", "saving", "invalid", "cancel-error"].includes(state)) await expect(page.getByRole(state.startsWith("cancel") ? "alertdialog" : "dialog", { name: state.startsWith("cancel") ? "Cancel this job?" : "Edit job", exact: true })).toBeVisible();
    else await expect(page.getByRole("heading", { name: "Sub wiring", exact: true })).toBeVisible();
    if (state === "delayed") await expect(page.getByText("Taking a little longer than usual", { exact: true })).toBeVisible();
    if (state === "saving") await expect(page.getByRole("button", { name: /Save changes.*loading/ })).toHaveAttribute("aria-busy", "true");
    if (state === "changed") await expect(page.getByRole("button", { name: "Save changes", exact: true })).toHaveAttribute("aria-disabled", "true");
    if (state === "invalid") await expect(page.getByLabel("Describe the job", { exact: true })).toHaveAttribute("aria-invalid", "true");
    if (state === "offline") { await expect(page.getByRole("button", { name: "Edit job", exact: true })).toHaveAttribute("aria-disabled", "true"); await expect(page.getByText("You’re offline.", { exact: true })).toBeVisible(); }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expectNoA11yViolations(page);
    if ([390, 1440].includes(viewport.width)) await page.screenshot({ path: `/tmp/123-${state}-${viewport.width}.png`, fullPage: true });
  });
});

test("an offline edit keeps its draft and blocks writes until reconnected", async ({ page, context }) => {
  await page.goto(`${preview}/dev/components/customer-job-waiting`);
  await page.getByRole("button", { name: "Edit job", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit job", exact: true });
  await dialog.getByLabel("Job title", { exact: true }).fill("Keep this draft");
  await context.setOffline(true);
  await expect(dialog.getByText("You’re offline.", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save changes", exact: true })).toHaveAttribute("aria-disabled", "true");
  await expect(dialog.getByLabel("Job title", { exact: true })).toHaveValue("Keep this draft");
  await dialog.getByLabel("Job title", { exact: true }).press("Enter");
  await context.setOffline(false);
  await expect(dialog.getByRole("button", { name: "Save changes", exact: true })).not.toHaveAttribute("aria-disabled", "true");
  await expect(dialog.getByLabel("Job title", { exact: true })).toHaveValue("Keep this draft");
  await expect(page.getByRole("button", { name: "Send now", exact: true, includeHidden: true })).toHaveCount(0);
});

test("edit and free-cancel dialogs work by keyboard and restore focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${preview}/dev/components/customer-job-waiting`);
  const edit = page.getByRole("button", { name: "Edit job", exact: true });
  await edit.focus(); await edit.press("Enter");
  let dialog = page.getByRole("dialog", { name: "Edit job", exact: true });
  await expect(dialog).toBeVisible(); await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible(); await expect(edit).toBeFocused();
  await edit.press("Enter"); await dialog.getByLabel("Describe the job", { exact: true }).fill("short");
  await dialog.getByRole("button", { name: "Save changes", exact: true }).press("Enter");
  await expect(dialog.getByLabel("Describe the job", { exact: true })).toBeFocused(); await expect(dialog.getByLabel("Describe the job", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await dialog.getByLabel("Job title", { exact: true }).fill("Two switches");
  await dialog.getByLabel("Describe the job", { exact: true }).fill("Two switches need replacing.");
  await dialog.getByRole("button", { name: "Save changes", exact: true }).press("Enter");
  await expect(dialog).not.toBeVisible(); await expect(page.getByRole("heading", { name: "Two switches", exact: true })).toBeVisible(); await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  const cancel = page.getByRole("button", { name: "Cancel job", exact: true });
  await cancel.focus();
  expect(await cancel.evaluate(element => { const box = element.getBoundingClientRect(), hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2); return Boolean(hit && element.contains(hit)); })).toBe(true);
  await cancel.press("Enter"); dialog = page.getByRole("alertdialog", { name: "Cancel this job?", exact: true });
  await dialog.getByRole("button", { name: "Keep job", exact: true }).press("Enter"); await expect(dialog).not.toBeVisible(); await expect(cancel).toBeFocused();
  await cancel.press("Enter"); await dialog.getByRole("button", { name: "Cancel job", exact: true }).press("Enter");
  await expect(dialog).not.toBeVisible(); await expect(page.getByText("This job was cancelled.", { exact: true })).toBeVisible(); await expect(page.getByRole("heading", { name: "Cancelled", exact: true })).toBeFocused(); await expect(page.getByRole("button", { name: "Edit job", exact: true })).toHaveCount(0);
});

const app = process.env.CUSTOMER_WAITING_E2E_APP_URL, database = process.env.CUSTOMER_WAITING_E2E_DATABASE_URL;
test.describe("real owned waiting job", () => {
  test.skip(!app || !database, "requires an isolated localhost app and issue123 database");
  test.describe.configure({ mode: "serial" });
  let db: pg.Client, auth: Awaited<ReturnType<typeof startAuthStub>>;
  const secret = randomUUID(), user = { id: randomUUID(), email: `${randomUUID()}@example.test` };
  test.beforeAll(async () => {
    const target = new URL(database!), host = new URL(app!);
    if (target.hostname !== "127.0.0.1" || target.pathname !== "/issue123" || target.search || host.hostname !== "127.0.0.1") throw Error("Dedicated localhost issue123 fixtures required");
    auth = await startAuthStub(secret, 54332); db = new pg.Client({ connectionString: database }); await db.connect();
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [user.id, user.email]);
    await db.query("INSERT INTO profiles(id,email,role,first_name,email_verified_at,updated_at) VALUES($1,$2,'CUSTOMER','Sarah',now(),now())", [user.id, user.email]);
  });
  test.afterAll(async () => { await db?.end(); await new Promise<void>(resolve => auth?.close(() => resolve())); });
  test("owner edits details, returns to same filtered job, handles pricing race and cancels a second job for free", async ({ page, context }) => {
    test.setTimeout(90_000);
    await context.addCookies(await sessionCookies(user, secret, app!, "http://127.0.0.1:54332"));
    const create = async () => {
      const id = randomUUID(); await db.query("INSERT INTO jobs(id,customer_id,category,title,description,address_line1,suburb,city,any_time,created_at,updated_at) VALUES($1,$2,'OTHER','Move the couch','Move the couch upstairs.','1 Example Street','Windsor','Invercargill',true,now()-interval '25 hours',now())", [id, user.id]); return id;
    };
    const id = await create(), path = `/jobs/${id}?from=${encodeURIComponent("/dashboard?q=couch&page=2")}`;
    await page.goto(`${app}${path}`); await expect(page.getByText("Taking a little longer than usual", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Edit job", exact: true }).press("Enter");
    let dialog = page.getByRole("dialog", { name: "Edit job", exact: true });
    await dialog.getByLabel("Job title", { exact: true }).fill("Two couches");
    await dialog.getByLabel("Describe the job", { exact: true }).fill("Two couches need moving upstairs.");
    await dialog.getByRole("button", { name: "Save changes", exact: true }).press("Enter");
    await expect(dialog).not.toBeVisible(); await expect(page.getByRole("heading", { name: "Two couches", exact: true })).toBeVisible(); await expect(page).toHaveURL(`${app}${path}`);
    expect((await db.query("SELECT title,description FROM jobs WHERE id=$1", [id])).rows[0]).toEqual({ title: "Two couches", description: "Two couches need moving upstairs." });
    await page.getByRole("button", { name: "Edit job", exact: true }).press("Enter");
    await dialog.getByLabel("Job title", { exact: true }).fill("Draft opened before the reconnect");
    await db.query("UPDATE jobs SET title='Other device update' WHERE id=$1", [id]);
    await context.setOffline(true); await expect(dialog.getByText("You’re offline.", { exact: true })).toBeVisible();
    await context.setOffline(false);
    await expect(page.locator("h1")).toHaveText("Other device update");
    await expect(dialog.getByLabel("Job title", { exact: true })).toHaveValue("Draft opened before the reconnect");
    await dialog.getByRole("button", { name: "Save changes", exact: true }).press("Enter");
    await expect(dialog.getByText("Job updated", { exact: true })).toBeVisible();
    expect((await db.query("SELECT title FROM jobs WHERE id=$1", [id])).rows[0].title).toBe("Other device update");
    await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible();
    await page.getByRole("button", { name: "Edit job", exact: true }).press("Enter");
    await db.query("UPDATE jobs SET status='PRICED',price_cents=10000 WHERE id=$1", [id]);
    await dialog.getByLabel("Job title", { exact: true }).fill("Must not overwrite");
    await dialog.getByRole("button", { name: "Save changes", exact: true }).press("Enter");
    await expect(dialog.getByText("Job updated", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible(); await expect(page.locator('[data-status="PRICED"]')).toBeVisible();
    expect((await db.query("SELECT title FROM jobs WHERE id=$1", [id])).rows[0].title).toBe("Other device update");
    const cancelled = await create(); await page.goto(`${app}/jobs/${cancelled}?from=%2Fdashboard`);
    await page.getByRole("button", { name: "Cancel job", exact: true }).press("Enter");
    dialog = page.getByRole("alertdialog", { name: "Cancel this job?", exact: true }); await dialog.getByRole("button", { name: "Cancel job", exact: true }).press("Enter");
    await expect(page.getByText("This job was cancelled.", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Cancelled", exact: true })).toBeFocused();
    expect((await db.query("SELECT count(*)::int AS n FROM audit_log WHERE record_id=$1 AND action='job.cancelled'", [cancelled])).rows[0].n).toBe(1);
    await page.getByRole("main").getByRole("link", { name: "My jobs", exact: true }).press("Enter"); await expect(page).toHaveURL(`${app}/dashboard`); await expect(page.getByRole("heading", { name: "My jobs", exact: true })).toBeVisible();
  });
  test("a waiting page crosses 24h without a status or revision change", async ({ page, context }) => {
    await context.addCookies(await sessionCookies(user, secret, app!, "http://127.0.0.1:54332"));
    const id = randomUUID();
    await db.query("INSERT INTO jobs(id,customer_id,category,title,description,address_line1,suburb,city,any_time,created_at,updated_at) VALUES($1,$2,'OTHER','Still waiting','Move the couch upstairs.','1 Example Street','Windsor','Invercargill',true,now()-interval '23 hours 59 minutes',now())", [id, user.id]);
    await page.clock.install(); await page.goto(`${app}/jobs/${id}`);
    await expect(page.getByRole("heading", { name: "Still waiting", exact: true })).toBeVisible();
    await expect(page.getByText("Taking a little longer than usual", { exact: true })).toHaveCount(0);
    await page.clock.fastForward(120_000);
    await expect(page.getByText("Taking a little longer than usual", { exact: true })).toBeVisible();
  });
});
