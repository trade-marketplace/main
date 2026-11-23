import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { sessionCookies, startAuthStub } from "../../scripts/screenshots/auth-stub";
import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const preview = process.env.POSTED_PREVIEW_E2E_URL || "http://127.0.0.1:3101";
const states = ["empty", "typing", "too-long", "saving", "saved", "not-public-yet", "error", "offline", "loading", "load-error"];
test.use({ reducedMotion: "reduce" });

for (const viewport of VIEWPORTS) test(`editor states at ${viewport.width}px`, async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize(viewport);
  for (const state of states) await test.step(state, async () => {
    expect((await page.goto(`${preview}/dev/components/public-profile-editor?state=${state}`))?.status()).toBe(200);
    if (state === "loading") await expect(page.getByRole("status", { name: "Loading public profile" })).toBeVisible();
    else if (state === "load-error") await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    else {
      await expect(page.getByRole("textbox", { name: "Bio" })).toBeVisible();
      if (state === "too-long") await expect(page.getByText("Keep your bio to 300 characters.")).toBeVisible();
      if (state === "not-public-yet") await expect(page.getByText("Your profile goes public once we’ve checked your details.")).toBeVisible();
      if (state === "saved") await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expectNoA11yViolations(page);
    if (state === "typing" && (viewport.width === 1440 || viewport.width === 390)) {
      await page.screenshot({ path: test.info().outputPath(`editor-${viewport.width}.png`), fullPage: true });
    }
  });
});

test("keyboard edits update the preview, save, and open the public card", async ({ page }) => {
  await page.goto(`${preview}/dev/components/public-profile-editor?state=empty`);
  await page.getByRole("textbox", { name: "Bio" }).fill("  I repair taps.  ");
  await expect(page.getByRole("region", { name: "Jack W." }).getByText("I repair taps.")).toBeVisible();
  await page.keyboard.press("Tab");
  const save = page.getByRole("button", { name: "Save bio" });
  await expect(save).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "See your public profile" }).press("Enter");
  await expect(page).toHaveURL(`${preview}/dev/components/tradie-profile?state=full`);
  await expect(page.getByRole("heading", { name: "Jack W.", level: 1 })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Public profile", exact: true })).toBeVisible();
});

const app = process.env.PUBLIC_BIO_E2E_APP_URL, database = process.env.PUBLIC_BIO_E2E_DATABASE_URL;
test("verified tradie saves a bio and reads it on their public profile", async ({ page, context }) => {
  test.setTimeout(90_000);
  test.skip(!app || !database, "Requires an isolated app and disposable local database.");
  const target = new URL(database!);
  if (target.hostname !== "127.0.0.1" || target.pathname !== "/lane_a_238" || target.search || new URL(app!).hostname !== "127.0.0.1") throw Error("Local editor fixtures required");
  const db = new pg.Client({ connectionString: database }), secret = randomUUID();
  const tradie = { id: randomUUID(), email: `${randomUUID()}@example.test` };
  const auth = await startAuthStub(secret, 54238);
  try {
    await db.connect();
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [tradie.id, tradie.email]);
    await db.query("INSERT INTO profiles(id,email,role,first_name,last_name,email_verified_at,updated_at) VALUES($1,$2,'TRADIE','Jack','Wilson',now(),now())", [tradie.id, tradie.email]);
    await db.query("INSERT INTO worker_profiles(user_id,verified_at,updated_at) VALUES($1,now(),now())", [tradie.id]);
    await context.addCookies(await sessionCookies(tradie, secret, app!, "http://127.0.0.1:54238"));
    await page.goto(`${app}/profile`);
    await page.getByRole("link", { name: "Public profile", exact: true }).click();
    await page.getByRole("textbox", { name: "Bio" }).fill("Local electrician.");
    await expect(page.getByRole("region", { name: "Jack W." }).getByText("Local electrician.")).toBeVisible();
    await page.getByRole("button", { name: "Save bio" }).press("Enter");
    await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "See your public profile" }).click();
    await expect(page).toHaveURL(`${app}/tradies/${tradie.id}`);
    await expect(page.getByText("Local electrician.", { exact: true })).toBeVisible();
    await page.goBack();
    await page.getByRole("link", { name: "Change photo" }).click();
    await expect(page).toHaveURL(`${app}/profile`);
    const customer = { id: randomUUID(), email: `${randomUUID()}@example.test` };
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [customer.id, customer.email]);
    await db.query("INSERT INTO profiles(id,email,role,first_name,email_verified_at,updated_at) VALUES($1,$2,'CUSTOMER','Sarah',now(),now())", [customer.id, customer.email]);
    await context.clearCookies();
    await context.addCookies(await sessionCookies(customer, secret, app!, "http://127.0.0.1:54238"));
    await page.goto(`${app}/profile/public`);
    await expect(page.getByRole("textbox", { name: "Bio" })).toHaveCount(0);
    await expect(page).not.toHaveURL(`${app}/profile/public`);
  } finally {
    await db.end();
    await new Promise<void>(resolve => auth.close(() => resolve()));
  }
});
