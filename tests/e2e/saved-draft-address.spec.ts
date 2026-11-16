import { randomUUID } from "node:crypto";
import pg from "pg";
import { expect, test } from "@playwright/test";
import { startAuthStub, sessionCookies } from "../../scripts/screenshots/auth-stub";
import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";
const preview = process.env.SAVED_ADDRESS_PREVIEW_URL || process.env.POSTED_PREVIEW_E2E_URL || "http://127.0.0.1:3101";
const states = ["where-saved", "where-saved-other", "where-saved-typed", "where-no-saved", "where-saved-loading", "where-saved-error", "where-saved-load-error", "where-saved-offline", "where-saved-review", "where-saved-posted"];
test("saved address previews stay guarded in production", async ({ request, baseURL }) => expect((await request.get(`${baseURL}/dev/components/post-job?state=where-saved`)).status()).toBe(404));
for (const viewport of VIEWPORTS) test(`saved address states at ${viewport.width}px have no sideways scroll and pass axe`, async ({ page }) => {
  test.setTimeout(180000); await page.setViewportSize(viewport);
  for (const state of states) await test.step(state, async () => {
    expect((await page.goto(`${preview}/dev/components/post-job?state=${state}`))?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(state === "where-saved-review" ? "All good?" : state === "where-saved-posted" ? "Posted." : "Where and when?");
    if (state === "where-saved") await expect(page.getByRole("radio", { name: /Home/ })).toBeChecked();
    if (state === "where-saved-other" || state === "where-no-saved") await expect(page.getByRole("combobox", { name: "Address", exact: true })).toBeVisible();
    if (state === "where-saved-typed") await expect(page.getByRole("radio", { name: /Workshop/ })).toBeChecked();
    if (state === "where-no-saved") await expect(page.getByRole("radio")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(async () => { await document.fonts.ready; }); await expectNoA11yViolations(page);
    if (process.env.SAVED_ADDRESS_SCREENSHOTS === "1" && [390, 1440].includes(viewport.width)) await page.screenshot({ path: test.info().outputPath(`${state}-${viewport.width}.png`), fullPage: true });
  });
});
test("keyboard chooses a different saved address, Some­where else restores search, and retry/offline preserve the choice", async ({ page, context }) => {
  await page.goto(`${preview}/dev/components/post-job?state=where-saved`);
  const home = page.getByRole("radio", { name: /Home/ }), rental = page.getByRole("radio", { name: /Rental/ });
  await home.focus(); await home.press("ArrowDown"); await expect(rental).toBeChecked();
  await page.getByRole("button", { name: "Next", exact: true }).press("Enter"); await expect(page.getByRole("heading", { name: "All good?", exact: true })).toBeVisible(); await expect(page.getByRole("region", { name: "Where and when", exact: true })).toContainText("24 Example Street");
  await page.getByRole("main").getByRole("link", { name: "Back", exact: true }).click(); await expect(rental).toBeChecked();
  await rental.press("ArrowDown"); await page.getByRole("radio", { name: /Workshop/ }).press("ArrowDown"); await expect(page.getByRole("radio", { name: "Somewhere else", exact: true })).toBeChecked(); await expect(page.getByRole("combobox", { name: "Address", exact: true })).toBeVisible();
  await page.goto(`${preview}/dev/components/post-job?state=where-saved-error`); await page.getByRole("button", { name: "Try again", exact: true }).click(); await expect(page.getByText("Couldn’t use that address. Try again.", { exact: true })).toHaveCount(0);
  await context.setOffline(true); await expect(home).toBeDisabled(); await expect(page.getByRole("button", { name: "Next", exact: true })).toHaveAttribute("aria-disabled", "true"); await expect(home).toBeChecked(); await context.setOffline(false); await expectNoA11yViolations(page);
  await page.getByRole("button", { name: "Save & exit", exact: true }).click(); await expect(page).toHaveURL(`${preview}/`); await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
const app = process.env.SAVED_ADDRESS_E2E_APP_URL, database = process.env.SAVED_ADDRESS_E2E_DATABASE_URL;
test.describe("actual saved address wizard", () => {
  test.skip(!app || !database, "requires isolated local app/database and Auth stand-in"); test.describe.configure({ mode: "serial", timeout: 120000 });
  let db: pg.Client, auth: Awaited<ReturnType<typeof startAuthStub>>; const secret = randomUUID();
  test.beforeAll(async () => { const url = new URL(database!); if (url.hostname !== "127.0.0.1" || url.pathname !== "/lane_a_552" || url.search || new URL(app!).hostname !== "127.0.0.1") throw Error("Dedicated local saved-address fixtures required"); auth = await startAuthStub(secret, 54511); db = new pg.Client({ connectionString: database }); await db.connect(); });
  test.afterAll(async () => { await db?.end(); if (auth) { auth.closeAllConnections(); await new Promise<void>(resolve => auth.close(() => resolve())); } });
  async function start(page: import("@playwright/test").Page) {
    await page.goto(`${app}/jobs/new`); await page.getByRole("textbox", { name: /Describe the job/ }).fill("Move a sofa and assemble a garden bench."); await page.getByRole("button", { name: "Next", exact: true }).click(); await expect(page.getByRole("heading", { name: "Add some photos", exact: true })).toBeVisible(); await page.getByRole("button", { name: "Next", exact: true }).click(); await expect(page.getByRole("heading", { name: "Where and when?", exact: true })).toBeVisible();
  }
  test("id-only selection survives a lost reply, copies every field, follows Manage addresses and posts the independent job after deletion", async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const person = { id: randomUUID(), email: `${randomUUID()}@example.test` }, home = randomUUID(), rental = randomUUID();
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [person.id, person.email]); await db.query("INSERT INTO profiles(id,email,role,first_name,email_verified_at,updated_at) VALUES($1,$2,'CUSTOMER','Sarah',now(),now())", [person.id, person.email]);
    for (const [id, label, line, isDefault] of [[home, "Home", "12 Campbell St", true], [rental, "Rental", "24 Example Street", false]] as const) await db.query("INSERT INTO addresses(id,user_id,label,line1,line2,suburb,city,postcode,location_source,lat,lng,is_default) VALUES($1,$2,$3,$4,'Unit 2','Windsor','Invercargill','9810','SEARCH',-46.4132,168.3538,$5)", [id, person.id, label, line, isDefault]);
    await context.addCookies(await sessionCookies(person, secret, app!, "http://127.0.0.1:54511"));
    let drop = true; const requests: string[] = [];
    await page.route("**/jobs/new*", async route => { const body = route.request().postData() ?? ""; if (route.request().method() === "POST" && route.request().headers()["next-action"] && (body.includes(home) || body.includes(rental))) { requests.push(body); expect(body).not.toContain("Campbell"); expect(body).not.toContain("Example Street"); expect(body).not.toContain("168.3538"); if (body.includes(rental) && drop) { drop = false; await route.fetch(); await route.abort("failed"); return; } } await route.continue(); });
    await start(page); const homeRadio = page.getByRole("radio", { name: /Home/ }), rentalRadio = page.getByRole("radio", { name: /Rental/ }); await expect(homeRadio).toBeChecked(); await expect.poll(async () => (await db.query("SELECT data->>'addressLine1' AS line FROM job_drafts WHERE profile_id=$1", [person.id])).rows[0]?.line).toBe("12 Campbell St");
    await homeRadio.focus(); await homeRadio.press("ArrowDown"); await expect(page.getByText("Couldn’t use that address. Try again.", { exact: true })).toBeVisible(); await page.getByRole("button", { name: "Try again", exact: true }).click(); await expect(rentalRadio).toBeChecked(); expect(requests.filter(body => body.includes(rental))).toHaveLength(2);
    await page.getByRole("button", { name: "Any time", exact: true }).click(); await page.getByRole("button", { name: "Next", exact: true }).press("Enter"); await expect(page.getByRole("heading", { name: "All good?", exact: true })).toBeVisible(); await expect(page.getByRole("region", { name: "Where and when", exact: true })).toContainText("Unit 2, 24 Example Street, Windsor, Invercargill, 9810"); await expectNoA11yViolations(page);
    await page.getByRole("main").getByRole("link", { name: "Back", exact: true }).click(); await page.getByRole("link", { name: "Manage addresses", exact: true }).click(); await expect(page).toHaveURL(`${app}/profile/addresses`); await expect(page.getByRole("heading", { name: "Addresses", exact: true })).toBeVisible(); await page.getByRole("article", { name: "Rental", exact: true }).getByRole("button", { name: "Delete", exact: true }).click(); await page.getByRole("alertdialog", { name: "Delete this address?", exact: true }).getByRole("button", { name: "Delete", exact: true }).click(); await expect.poll(async () => Number((await db.query("SELECT count(*) AS n FROM addresses WHERE id=$1", [rental])).rows[0].n)).toBe(0);
    const snapshot = (await db.query("SELECT data FROM job_drafts WHERE profile_id=$1", [person.id])).rows[0].data; expect(snapshot).toMatchObject({ addressLine1: "24 Example Street", addressLine2: "Unit 2", suburb: "Windsor", city: "Invercargill", postcode: "9810", locationSource: "SEARCH", point: { lat: -46.4132, lng: 168.3538 } });
    await page.goBack(); await page.getByRole("button", { name: "Next", exact: true }).click(); await expect(page.getByRole("heading", { name: "All good?", exact: true })).toBeVisible(); await page.getByRole("button", { name: "Post it", exact: true }).click(); await expect(page.getByRole("heading", { name: "Posted.", exact: true })).toBeVisible();
    expect((await db.query("SELECT address_line1,address_line2,suburb,city,postcode,location_source,lat,lng FROM jobs WHERE customer_id=$1", [person.id])).rows).toEqual([{ address_line1: "24 Example Street", address_line2: "Unit 2", suburb: "Windsor", city: "Invercargill", postcode: "9810", location_source: "SEARCH", lat: -46.4132, lng: 168.3538 }]);
  });
  test("guests keep today's search/typed fallback and can reach Check & post without saved choices", async ({ page }) => {
    await start(page); await expect(page.getByRole("radio")).toHaveCount(0); await expect(page.getByRole("link", { name: "Manage addresses", exact: true })).toHaveCount(0); await page.getByRole("combobox", { name: "Address", exact: true }).fill("19 Test Street"); await page.getByRole("textbox", { name: "Suburb", exact: true }).fill("Windsor"); await page.getByRole("textbox", { name: "City", exact: true }).fill("Invercargill"); await page.getByRole("button", { name: "Any time", exact: true }).click(); await page.getByRole("button", { name: "Next", exact: true }).click(); await expect(page.getByRole("heading", { name: "All good?", exact: true })).toBeVisible(); await expectNoA11yViolations(page);
  });
});
