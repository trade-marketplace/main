import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { sessionCookies, startAuthStub } from "../../scripts/screenshots/auth-stub";
import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const preview = process.env.POSTED_PREVIEW_E2E_URL || "http://127.0.0.1:3101";
for (const viewport of VIEWPORTS) test(`calendar links for both roles at ${viewport.width}px`, async ({ page }) => {
  await page.setViewportSize(viewport);
  for (const [screen, empty] of [["customer-confirmed", "confirmed"], ["worker-workspace", "not-booked"]]) {
    const url = `${preview}/dev/components/${screen}?state=`;
    await page.goto(url + "booked");
    const link = page.getByRole("link", { name: "Add to calendar", exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", /^\/jobs\/[^/]+\/calendar\.ics$/);
    await link.focus();
    await expect(link).toBeFocused();
    await expectNoA11yViolations(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.goto(url + empty);
    await expect(link).toHaveCount(0);
  }
});

const app = process.env.CALENDAR_E2E_APP_URL;
const database = process.env.CALENDAR_E2E_DATABASE_URL;
test("the two participants download their booked event by keyboard", async ({ page, context }) => {
  test.skip(!app || !database, "Requires an isolated localhost app and calendar database.");
  const target = new URL(database!);
  if (target.hostname !== "127.0.0.1" || target.pathname !== "/lane_a_524" || target.search || new URL(app!).hostname !== "127.0.0.1") {
    throw Error("Dedicated local calendar fixtures required");
  }
  const secret = randomUUID(), port = 54524;
  const auth = await startAuthStub(secret, port);
  const db = new pg.Client({ connectionString: database });
  const customer = { id: randomUUID(), email: `${randomUUID()}@example.test` };
  const tradie = { id: randomUUID(), email: `${randomUUID()}@example.test` };
  try {
    await db.connect();
    for (const [user, role] of [[customer, "CUSTOMER"], [tradie, "TRADIE"]] as const) {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [user.id, user.email]);
      await db.query("INSERT INTO profiles(id,email,role,first_name,last_name,email_verified_at,updated_at) VALUES($1,$2,$3,'Sam','Test',now(),now())", [user.id, user.email, role]);
    }
    const id = randomUUID();
    const { rows } = await db.query(`INSERT INTO jobs(id,customer_id,worker_id,status,price_cents,category,title,description,address_line1,suburb,city,any_time,booked_date,booked_time)
      VALUES($1,$2,$3,'ASSIGNED',18300,'PLUMBING','Fix tap','Fixture','12 Example Street','Windsor','Invercargill',true,'2026-11-24','MORNING') RETURNING job_number`, [id, customer.id, tradie.id]);
    for (const user of [customer, tradie]) {
      await context.clearCookies();
      await context.addCookies(await sessionCookies(user, secret, app!, `http://127.0.0.1:${port}`));
      await page.goto(`${app}/jobs/${id}`);
      const link = page.getByRole("link", { name: "Add to calendar", exact: true });
      await expect(link).toBeVisible();
      const pending = page.waitForEvent("download");
      await link.press("Enter");
      const download = await pending;
      expect(download.suggestedFilename()).toBe(`TM-${rows[0].job_number}.ics`);
      const contents = await readFile((await download.path())!, "utf8");
      expect(contents).toContain(`UID:job-${id}@trademarketplace.nz`);
      expect(contents).toContain("SUMMARY:Trade Marketplace: Fix tap");
      expect(contents).toContain("DTSTART:20261123T190000Z");
    }
  } finally {
    await db.end();
    await new Promise<void>(resolve => auth.close(() => resolve()));
  }
});
