import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { startAuthStub, sessionCookies } from "../../scripts/screenshots/auth-stub";
import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const preview = process.env.PRICE_READY_PREVIEW_URL || process.env.POSTED_PREVIEW_E2E_URL || "http://127.0.0.1:3101";
const states = ["ready", "other-trade", "repriced", "paying", "pay-error", "offline", "decline", "decline-saving", "decline-error", "loading", "empty", "error"];
test("price-ready previews remain guarded in the normal production app", async ({ request, baseURL }) => {
  expect((await request.get(`${baseURL}/dev/components/price-ready`)).status()).toBe(404);
});
for (const viewport of VIEWPORTS) test(`price-ready states fit ${viewport.width}px with accessible controls`, async ({ page }) => {
  test.setTimeout(180_000); await page.setViewportSize(viewport);
  for (const state of states) await test.step(state, async () => {
    expect((await page.goto(`${preview}/dev/components/price-ready?state=${state}`))?.status()).toBe(200);
    if (state === "loading") await expect(page.getByRole("status", { name: "Loading job", exact: true })).toBeVisible();
    else if (state === "error") await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
    else if (state.startsWith("decline")) {
      const dialog = page.getByRole("dialog", { name: "No worries.", exact: true });
      await expect(dialog).toBeVisible();
      for (const reason of ["Too expensive", "Changed my mind", "Found someone else", "Something else"]) await expect(dialog.getByRole("radio", { name: reason, exact: true })).toBeVisible();
      if (state === "decline-saving") await expect(dialog.getByRole("button", { name: /No thanks/ })).toHaveAttribute("aria-busy", "true");
      if (state === "decline-error") await expect(dialog.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
    } else {
      await expect(page.getByRole("heading", { name: "Price ready", exact: true })).toBeVisible();
      const electrician = page.getByText("Licensed electrician · CoC included", { exact: true });
      if (state === "other-trade") await expect(electrician).toHaveCount(0); else await expect(electrician).toBeVisible();
      if (state === "repriced") await expect(page.locator("del")).toHaveText("$420.00");
      if (state === "paying") await expect(page.getByRole("button", { name: /Accept & pay/ })).toHaveAttribute("aria-busy", "true");
      if (state === "offline") for (const label of ["Accept & pay", "No thanks"]) await expect(page.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-disabled", "true");
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expectNoA11yViolations(page);
    if ([390, 1440].includes(viewport.width)) await page.screenshot({ path: test.info().outputPath(`${state}-${viewport.width}.png`), fullPage: true });
  });
});

test("payment errors stay inline and Try again preserves the price and page", async ({ page }) => {
  await page.goto(`${preview}/dev/components/price-ready`);
  await page.getByRole("button", { name: "Accept & pay", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Payments aren’t switched on yet. Nothing has been charged." })).toBeVisible();
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page).toHaveURL(`${preview}/dev/components/price-ready`);
  await expect(page.getByRole("heading", { name: "Price ready", exact: true })).toBeVisible();
  await expectNoA11yViolations(page);
});

test("keyboard dialog has optional exclusive reasons, Go back and Esc restore the trigger", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${preview}/dev/components/price-ready`);
  await page.getByRole("heading", { name: "Price ready", exact: true }).click();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Accept & pay", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  const trigger = page.getByRole("button", { name: "No thanks", exact: true });
  await expect(trigger).toBeFocused(); await trigger.press("Enter");
  const dialog = page.getByRole("dialog", { name: "No worries.", exact: true });
  await expect(dialog.getByRole("heading", { name: "No worries.", exact: true })).toBeFocused();
  await expect(dialog.locator('input:checked')).toHaveCount(0);
  await dialog.getByRole("radio", { name: "Too expensive", exact: true }).check();
  await dialog.getByRole("radio", { name: "Changed my mind", exact: true }).check();
  await expect(dialog.locator('input:checked')).toHaveCount(1);
  await context.setOffline(true);
  await expect(dialog.getByRole("button", { name: "No thanks", exact: true })).toHaveAttribute("aria-disabled", "true");
  await context.setOffline(false);
  await expect(dialog.getByRole("radio", { name: "Changed my mind", exact: true })).toBeChecked();
  await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible(); await expect(trigger).toBeFocused();
  await trigger.press("Enter"); await dialog.getByRole("button", { name: "Go back", exact: true }).press("Enter");
  await expect(dialog).not.toBeVisible(); await expect(trigger).toBeFocused();
  await trigger.press("Enter"); await dialog.getByRole("button", { name: "No thanks", exact: true }).press("Enter");
  await expect(page.getByRole("heading", { name: "Cancelled", exact: true })).toBeVisible();
  await expectNoA11yViolations(page);
});

const app = process.env.PRICE_READY_E2E_APP_URL, database = process.env.PRICE_READY_E2E_DATABASE_URL;
test.describe("real price-ready customer journey", () => {
  test.skip(!app || !database, "requires an isolated local app and throwaway database");
  test.describe.configure({ mode: "serial" });
  let db: pg.Client, auth: Awaited<ReturnType<typeof startAuthStub>>;
  const secret = randomUUID(), user = { id: randomUUID(), email: `${randomUUID()}@example.test` };
  test.beforeAll(async () => {
    const target = new URL(database!), host = new URL(app!);
    if (target.hostname !== "127.0.0.1" || target.pathname !== "/lane_a_125" || target.search || host.hostname !== "127.0.0.1") throw Error("Dedicated local Lane A fixtures required");
    auth = await startAuthStub(secret, 54510); db = new pg.Client({ connectionString: database }); await db.connect();
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [user.id, user.email]);
    await db.query("INSERT INTO profiles(id,email,role,first_name,email_verified_at,updated_at) VALUES($1,$2,'CUSTOMER','Sarah',now(),now())", [user.id, user.email]);
  });
  test.afterAll(async () => { await db?.end(); if (auth) await new Promise<void>(resolve => auth.close(() => resolve())); });
  const createJob = async () => {
    const id = randomUUID();
    await db.query("INSERT INTO jobs(id,customer_id,category,title,description,address_line1,suburb,city,any_time,status,price_cents,updated_at) VALUES($1,$2,'ELECTRICAL','Price ready journey','Replace the outdoor plug.','1 Example Street','Windsor','Invercargill',true,'PRICED',37200,now())", [id, user.id]);
    return id;
  };
  test("Accept & pay calls the action, opens this job's checkout and Back returns to its job", async ({ page, context }) => {
    await context.addCookies(await sessionCookies(user, secret, app!, "http://127.0.0.1:54510"));
    const id = await createJob(); await page.goto(`${app}/jobs/${id}`);
    await page.getByRole("button", { name: "Accept & pay", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/pay/[a-f0-9-]+$`));
    const paymentId = new URL(page.url()).pathname.split("/").at(-1);
    expect((await db.query("SELECT job_id,status,amount_cents FROM payments WHERE id=$1", [paymentId])).rows[0]).toEqual({ job_id: id, status: "PENDING", amount_cents: 37200 });
    await expect(page.getByText("Price ready journey", { exact: true })).toBeVisible();
    await expectNoA11yViolations(page);
    await page.getByRole("link", { name: "Back to job", exact: true }).click(); await expect(page).toHaveURL(`${app}/jobs/${id}`);
    await expect(page.getByRole("button", { name: "Accept & pay", exact: true })).toBeVisible();
  });
  test("No thanks commits the optional reason and refreshed cancellation, and preserves the return path", async ({ page, context }) => {
    await context.addCookies(await sessionCookies(user, secret, app!, "http://127.0.0.1:54510"));
    const id = await createJob(); await page.goto(`${app}/jobs/${id}?from=%2Fdashboard%3Fq%3Djourney`);
    await page.getByRole("button", { name: "No thanks", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "No worries.", exact: true });
    await dialog.getByRole("radio", { name: "Too expensive", exact: true }).check();
    await dialog.getByRole("button", { name: "No thanks", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Cancelled", exact: true })).toBeVisible();
    expect((await db.query("SELECT status FROM jobs WHERE id=$1", [id])).rows[0].status).toBe("CANCELLED");
    expect((await db.query("SELECT reason FROM audit_log WHERE record_id=$1 AND action='job.cancelled'", [id])).rows).toEqual([{ reason: "Too expensive" }]);
    await page.getByRole("main").getByRole("link", { name: "My jobs", exact: true }).click();
    await expect(page).toHaveURL(`${app}/dashboard?q=journey`);
  });
});
