import { randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { sessionCookies, startAuthStub } from "../../scripts/screenshots/auth-stub";
import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const app = "http://127.0.0.1:3156";
const stub = "http://127.0.0.1:54576";
const database = process.env.OFFICE_NOTIFICATIONS_E2E_DATABASE_URL;

test.describe("office notification journey", () => {
  test.skip(!database, "Requires a disposable local database and app at 3156 with local Auth at 54576");
  test.describe.configure({ mode: "serial" });
  const secret = randomBytes(32).toString("hex");
  const office = { id: randomUUID(), email: "office-" + randomUUID() + "@example.test" };
  const customer = { id: randomUUID(), email: "customer-" + randomUUID() + "@example.test" };
  const job = randomUUID();
  let auth: Awaited<ReturnType<typeof startAuthStub>>;
  let db: pg.Client;

  test.beforeAll(async () => {
    const url = new URL(database!);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/lane_c_office_inbox") throw Error("Disposable local office notification database required");
    auth = await startAuthStub(secret, 54576);
    db = new pg.Client({ connectionString: database }); await db.connect();
    for (const [person, role] of [[office, "ADMIN"], [customer, "CUSTOMER"]] as const) {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [person.id, person.email]);
      await db.query("INSERT INTO profiles(id,email,role,first_name,email_verified_at,updated_at) VALUES($1,$2,$3,'Demo',now(),now())", [person.id, person.email, role]);
    }
    await db.query("INSERT INTO jobs(id,customer_id,category,title,description,address_line1,suburb,city) VALUES($1,$2,'OTHER','Office inbox fixture','Repair','1 Fixture Street','Windsor','Invercargill')", [job, customer.id]);
  });
  test.afterAll(async () => { auth?.closeAllConnections(); auth?.close(); await db?.end(); });

  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: bell → inbox → office job → Back`, async ({ page, context }) => {
      await db.query("INSERT INTO notifications(user_id,type,payload) VALUES($1,'variation.requested',$2)", [office.id, { jobId: job, jobTitle: "Office inbox fixture" }]);
      await context.addCookies(await sessionCookies(office, secret, app, stub));
      await page.setViewportSize(viewport);
      await page.goto(app + "/admin/jobs");
      await page.getByRole("link", { name: "Notifications, 1 unread" }).press("Enter");
      await expect(page).toHaveURL(app + "/admin/notifications");
      await expectNoA11yViolations(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.getByRole("button", { name: /Extra work requested.*Unread/ }).first().click();
      await expect(page).toHaveURL(app + "/admin/jobs/" + job);
      await expect(page.getByRole("heading", { name: /Office inbox fixture/ })).toBeVisible();
      await page.goBack();
      await expect(page).toHaveURL(app + "/admin/notifications");
      await expect(page.getByRole("link", { name: "Notifications", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: /Mark all read/ })).toHaveCount(0);
    });
  }
});

for (const viewport of VIEWPORTS) {
  test(`${viewport.width}px: office inbox states remain accessible and fit the viewport`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    const states = {
      ready: page.getByRole("button", { name: /Extra work requested/ }),
      loading: page.getByText("Loading notifications", { exact: true }),
      empty: page.getByRole("heading", { name: "No notifications" }),
      error: page.getByRole("heading", { name: "Notifications unavailable" }),
      offline: page.getByText("You're offline.", { exact: true }),
    };
    for (const [state, expected] of Object.entries(states)) {
      await page.goto(process.env.POSTED_PREVIEW_E2E_URL + "/dev/components/office-notifications?state=" + state);
      await expect(page.getByRole("heading", { level: 1, name: "Notifications" })).toBeVisible();
      await expect(expected).toBeVisible();
      await expectNoA11yViolations(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  });
}
