import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { sessionCookies, startAuthStub } from "../../scripts/screenshots/auth-stub";
import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const preview = process.env.POSTED_PREVIEW_E2E_URL || "http://127.0.0.1:3101";
const states = ["full", "no-reviews", "no-photo", "photo-error", "other-trade", "long-bio", "paused", "loading", "error", "offline"];
test.use({ reducedMotion: "reduce" });

for (const viewport of VIEWPORTS) test(`public tradie states at ${viewport.width}px`, async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize(viewport);
  for (const state of states) await test.step(state, async () => {
    expect((await page.goto(`${preview}/dev/components/tradie-profile?state=${state}`))?.status()).toBe(200);
    if (state === "paused") await expect(page.getByRole("heading", { name: "Wrong address." })).toBeVisible();
    else if (state === "error") await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    else if (state === "loading") await expect(page.getByRole("status", { name: "Loading profile" })).toBeVisible();
    else {
      await expect(page.getByRole("heading", { name: "Jack W.", exact: true })).toBeVisible();
      if (state === "no-reviews") await expect(page.getByText("No reviews yet.")).toBeVisible();
      if (state === "no-photo" || state === "photo-error") await expect(page.getByText("JW", { exact: true })).toBeVisible();
      if (state === "other-trade") await expect(page.getByText("Licence checked")).toHaveCount(0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expectNoA11yViolations(page);
    if (viewport.width === 390 || viewport.width === 1440) {
      await page.screenshot({ path: test.info().outputPath(`profile-${state}-${viewport.width}.png`), fullPage: true });
    }
  });
});

test("malformed profile IDs return the site's 404", async ({ request }) => {
  const response = await request.get("/tradies/not-a-user-id");
  expect(response.status()).toBe(404);
  expect(await response.text()).toContain("Wrong address.");
});

const live = process.env.PUBLIC_PROFILE_E2E_APP_URL, database = process.env.PUBLIC_PROFILE_E2E_DATABASE_URL;
test("See profile from a confirmed job, Back, and a paused tradie's 404", async ({ page, context }) => {
  test.setTimeout(120_000);
  test.skip(!live || !database, "Requires the local authenticated app and disposable profile fixtures.");
  const target = new URL(database!);
  if (target.hostname !== "127.0.0.1" || target.pathname !== "/lane_a_246" || target.search || new URL(live!).hostname !== "127.0.0.1") throw Error("Local profile fixtures required");
  const db = new pg.Client({ connectionString: database }), secret = randomUUID(), job = randomUUID();
  const customer = { id: randomUUID(), email: `${randomUUID()}@example.test` };
  const tradie = { id: randomUUID(), email: `${randomUUID()}@example.test` };
  const auth = await startAuthStub(secret, 54246);
  try {
    await db.connect();
    for (const [person, role, name] of [[customer, "CUSTOMER", "Sarah"], [tradie, "TRADIE", "Jack"]] as const) {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [person.id, person.email]);
      await db.query("INSERT INTO profiles(id,email,role,first_name,last_name,email_verified_at,updated_at) VALUES($1,$2,$3,$4,'Wilson',now(),now())", [person.id, person.email, role, name]);
    }
    await db.query("INSERT INTO worker_profiles(user_id,verified_at,updated_at) VALUES($1,now(),now())", [tradie.id]);
    await db.query("INSERT INTO jobs(id,customer_id,worker_id,status,category,title,description,price_cents,address_line1,suburb,city,updated_at) VALUES($1,$2,$3,'ASSIGNED','OTHER','Moving day','Move the couch',10000,'1 Example Street','Windsor','Invercargill',now())", [job, customer.id, tradie.id]);
    await context.addCookies(await sessionCookies(customer, secret, live!, "http://127.0.0.1:54246"));
    const jobUrl = `${live}/jobs/${job}?from=%2Fdashboard`;
    await page.goto(jobUrl);
    const link = page.getByRole("link", { name: "See profile", exact: true });
    await link.focus();
    await link.press("Enter");
    await expect(page).toHaveURL(`${live}/tradies/${tradie.id}`);
    await expect(page.getByRole("heading", { name: "Jack W." })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await page.goBack();
    await expect(page).toHaveURL(jobUrl);
    await expect(link).toBeVisible();
    await db.query("UPDATE worker_profiles SET paused_at=now() WHERE user_id=$1", [tradie.id]);
    expect((await page.goto(`${live}/tradies/${tradie.id}`))?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Wrong address." })).toBeVisible();
  } finally {
    await db.end();
    await new Promise<void>(resolve => auth.close(() => resolve()));
  }
});
