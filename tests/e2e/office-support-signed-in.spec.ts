import { randomBytes, randomUUID } from "node:crypto";
import type { Server } from "node:http";
import pg from "pg";
import { expect, test, type Page } from "@playwright/test";
import { sessionCookies, startAuthStub } from "../../scripts/screenshots/auth-stub";
import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const app = process.env.OFFICE_SUPPORT_E2E_APP_URL, database = process.env.OFFICE_SUPPORT_E2E_DATABASE_URL;
const authPort = 54404;
test.describe("office support against signed-in routes and PostgreSQL", () => {
  test.skip(!app || !database, "Requires disposable localhost issue183 database and Auth/app build");
  test.describe.configure({ mode: "serial" });
  let db: pg.Client, auth: Server, secret: string;
  const office = { id: randomUUID(), email: "office183@example.test" }, customer = { id: randomUUID(), email: "sarah183@example.test" }, worker = { id: randomUUID(), email: "jack183@example.test" };
  const job = randomUUID(), privateThread = randomUUID(), sharedThread = randomUUID(), closed = randomUUID(), history = randomUUID();
  const firstMessage = randomUUID(), historyIds = Array.from({ length: 120 }, () => randomUUID());
  const runtime = new WeakMap<Page, string[]>();
  test.beforeEach(async ({ page }) => { const errors: string[] = []; runtime.set(page, errors); page.on("pageerror", error => errors.push(error.message)); });
  test.afterEach(async ({ page }) => { expect(runtime.get(page), "No browser runtime errors").toEqual([]); });
  test.beforeAll(async () => {
    if (!["localhost", "127.0.0.1"].includes(new URL(app!).hostname) || !["localhost", "127.0.0.1"].includes(new URL(database!).hostname) || new URL(database!).pathname !== "/issue183") throw new Error("Isolated localhost issue183 database required");
    secret = randomBytes(32).toString("hex"); auth = await startAuthStub(secret, authPort);
    db = new pg.Client({ connectionString: database }); await db.connect();
    for (const person of [{ ...office, role: "ADMIN", name: "Matt" }, { ...customer, role: "CUSTOMER", name: "Sarah" }, { ...worker, role: "TRADIE", name: "Jack" }]) {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [person.id, person.email]);
      await db.query("INSERT INTO profiles(id,email,role,first_name,last_name,email_verified_at) VALUES($1,$2,$3,$4,'Support fixture',now())", [person.id, person.email, person.role, person.name]);
    }
    await db.query("INSERT INTO worker_profiles(user_id) VALUES($1)", [worker.id]);
    await db.query("INSERT INTO jobs(id,customer_id,worker_id,category,title,description,address_line1,suburb,city,status,price_cents) VALUES($1,$2,$3,'OTHER','Support183 door repair','Fix a latch','1 Private Fixture Street','Windsor','Invercargill','ASSIGNED',12000)", [job, customer.id, worker.id]);
    for (let index = 0; index < 27; index++) await db.query("INSERT INTO support_threads(user_id,subject) VALUES($1,$2)", [customer.id, `Support183 pagination ${index}`]);
    for (const [id, subject, shared] of [[privateThread, "Support183 help with account", false], [sharedThread, "Support183 job question", true]] as const) await db.query("INSERT INTO support_threads(id,user_id,job_id,job_participants,subject) VALUES($1,$2,$3,$4,$5)", [id, customer.id, job, shared, subject]);
    await db.query("INSERT INTO support_threads(id,user_id,subject,status,closed_at) VALUES($1,$2,'Support183 closed','CLOSED',now())", [closed, customer.id]);
    await db.query("INSERT INTO support_threads(id,user_id,subject) VALUES($1,$2,'Support183 history')", [history, customer.id]);
    await db.query("INSERT INTO support_messages(id,thread_id,author_id,body) VALUES($1,$2,$3,'Please help with my account.')", [firstMessage, privateThread, customer.id]);
    await db.query("INSERT INTO support_message_photos(message_id,path) VALUES($1,$2)", [firstMessage, `support/${job}/${customer.id}/${randomUUID().replaceAll("-", "")}.webp`]);
    await db.query("INSERT INTO support_messages(thread_id,author_id,from_office,internal,body) VALUES($1,$2,true,true,'INTERNAL_BROWSER_CANARY_183')", [privateThread, office.id]);
    await db.query("INSERT INTO support_messages(thread_id,author_id,body) VALUES($1,$2,'Shared job question for the office.')", [sharedThread, customer.id]);
    await db.query("INSERT INTO support_messages(id,thread_id,author_id,body,created_at) SELECT x.id,$2,$3,'History entry '||(x.n-1),now()+(x.n-1)*interval '1 second' FROM unnest($1::uuid[]) WITH ORDINALITY AS x(id,n)", [historyIds, history, customer.id]);
  });
  test.afterAll(async () => {
    await db?.query("DELETE FROM support_threads WHERE user_id=$1", [customer.id]);
    await db?.query("DELETE FROM jobs WHERE id=$1", [job]);
    await db?.query("DELETE FROM profiles WHERE id=ANY($1::uuid[])", [[office.id, customer.id, worker.id]]);
    await db?.query("DELETE FROM auth.users WHERE id=ANY($1::uuid[])", [[office.id, customer.id, worker.id]]);
    await db?.end(); await new Promise<void>(resolve => auth?.close(() => resolve()));
  });
  async function signIn(page: Page, person = office) {
    await page.context().clearCookies();
    await page.context().addCookies(await sessionCookies(person, secret, app!, `http://127.0.0.1:${authPort}`));
  }
  test("search, Next/Previous, office reply → owner notification → reply → Help Back preserve the same private thread", async ({ page, browser }) => {
    test.setTimeout(120_000); await signIn(page);
    await page.goto(`${app}/admin/support?q=Support183&status=all`);
    await page.getByRole("button", { name: "Next page", exact: true }).click(); await expect(page).toHaveURL(/page=2/);
    await page.getByRole("button", { name: "Previous page", exact: true }).click(); await expect(page).not.toHaveURL(/page=2/);
    const search = page.getByRole("searchbox", { name: "Search threads", exact: true });
    await search.fill("Support183 help with account"); await search.press("Enter");
    await page.getByRole("link", { name: "Support183 help with account", exact: true }).press("Enter");
    await expect(page.getByRole("heading", { level: 1, name: "Support183 help with account", exact: true })).toBeVisible();
    await expect(page.getByRole("log")).toContainText("Please help with my account.");
    await expect(page.getByText("Photo unavailable", { exact: true })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("INTERNAL_BROWSER_CANARY_183");
    await page.getByRole("link", { name: "View job", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Support183 door repair" })).toBeVisible();
    await page.getByRole("navigation", { name: "Breadcrumb", exact: true }).getByRole("link", { name: "Support", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Support183 help with account", exact: true })).toBeVisible();
    const input = page.getByRole("textbox", { name: "Message", exact: true });
    await input.fill("Office183 reply to the account owner."); await input.press("Enter");
    await expect(input).toHaveValue(""); await expect(page.getByRole("log")).toContainText("Office183 reply to the account owner.");
    await expect(input).toBeFocused(); await page.reload(); await expect(page.getByRole("log")).toContainText("Office183 reply to the account owner.");
    expect((await db.query("SELECT count(*) FROM support_messages WHERE thread_id=$1 AND body=$2", [privateThread, "Office183 reply to the account owner."])).rows[0].count).toBe("1");
    const outgoing = (await db.query("SELECT user_id FROM notifications WHERE type='message.received' AND payload->>'supportThreadId'=$1", [privateThread])).rows;
    expect(outgoing.map(row => row.user_id)).toContain(customer.id); expect(outgoing.map(row => row.user_id)).not.toContain(worker.id);
    await page.getByRole("link", { name: "Support inbox", exact: true }).click();
    await expect(search).toHaveValue("Support183 help with account"); await expect(page.getByRole("combobox", { name: "Status", exact: true })).toHaveValue("all");
    const ownerContext = await browser.newContext({ viewport: { width: 390, height: 844 } }), owner = await ownerContext.newPage(), ownerErrors: string[] = [];
    owner.on("pageerror", error => ownerErrors.push(error.message));
    try {
      await signIn(owner, customer); await owner.goto(`${app}/notifications`);
      await owner.getByRole("button", { name: /^Notifications/ }).click();
      const menu = owner.getByRole("menu", { name: "Notifications", exact: true });
      await menu.getByRole("menuitem").filter({ hasText: "New message" }).first().click();
      await expect(owner).toHaveURL(`${app}/support/${privateThread}`); await expect(menu).toHaveCount(0);
      await expect(owner.getByRole("log")).toContainText("Office183 reply to the account owner.");
      await expect(owner.locator("body")).not.toContainText("INTERNAL_BROWSER_CANARY_183");
      const ownerInput = owner.getByRole("textbox", { name: "Message", exact: true });
      await ownerInput.fill("Owner183 reply on the same private thread."); await ownerInput.press("Enter"); await expect(ownerInput).toHaveValue("");
      await expect(owner.getByRole("log")).toContainText("Owner183 reply on the same private thread."); await expect(ownerInput).toBeFocused();
      await expectNoA11yViolations(owner); await owner.getByRole("link", { name: "Back", exact: true }).click();
      await expect(owner).toHaveURL(`${app}/help`); await expect(owner.getByRole("heading", { level: 1 })).toBeVisible();
      await page.goto(`${app}/admin/support/${privateThread}`); await expect(page.getByRole("log")).toContainText("Owner183 reply on the same private thread.");
      expect((await db.query("SELECT count(*) FROM support_threads WHERE id=$1", [privateThread])).rows[0].count).toBe("1");
      expect(ownerErrors).toEqual([]);
    } finally { await ownerContext.close(); }
  });
  test("shared job entry uses existing Message both and the destination's visible Back returns to the filtered inbox", async ({ page }) => {
    test.setTimeout(120_000); await signIn(page); await page.goto(`${app}/admin/support?status=all&q=Support183+job+question`);
    await page.getByRole("link", { name: "Support183 job question", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Support183 door repair" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Messages", exact: true })).toBeInViewport();
    await page.getByRole("button", { name: "Message both", exact: true }).click();
    const dialog = page.getByRole("alertdialog", { name: "Message both", exact: true });
    await dialog.getByRole("textbox", { name: "Message", exact: true }).fill("Office183 shared job reply.");
    await dialog.getByRole("button", { name: "Send message", exact: true }).click(); await expect(dialog).toBeHidden();
    await expect(page.getByText("Office183 shared job reply.", { exact: true })).toBeVisible();
    await page.getByRole("navigation", { name: "Breadcrumb", exact: true }).getByRole("link", { name: "Support inbox", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Support inbox", exact: true })).toBeVisible();
    await expect(page.getByRole("searchbox", { name: "Search threads", exact: true })).toHaveValue("Support183 job question");
    expect((await db.query("SELECT thread_id FROM support_messages WHERE body='Office183 shared job reply.'")).rows.map(row => row.thread_id)).toEqual([sharedThread]);
  });
  test("every width fits with axe; offline draft never queues or sends, and survives reload before manual retry", async ({ page, context }) => {
    test.setTimeout(180_000); await signIn(page);
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport); await page.goto(`${app}/admin/support`); await expectNoA11yViolations(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      await page.goto(`${app}/admin/support/${privateThread}`); await expectNoA11yViolations(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    }
    const input = page.getByRole("textbox", { name: "Message", exact: true });
    await context.setOffline(true); await input.fill("Office183 retained offline draft"); await input.press("Enter");
    await expect(page.getByRole("button", { name: "Send message", exact: true })).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByText("Not sent yet.", { exact: true })).toHaveCount(0);
    await context.setOffline(false); await expect(input).toHaveValue("Office183 retained offline draft"); await page.reload();
    await expect(input).toHaveValue("Office183 retained offline draft");
    expect((await db.query("SELECT count(*) FROM support_messages WHERE body='Office183 retained offline draft'")).rows[0].count).toBe("0");
    await input.press("Enter"); await expect(input).toHaveValue(""); await expect(page.getByRole("log")).toContainText("Office183 retained offline draft");
    expect((await db.query("SELECT count(*) FROM support_messages WHERE body='Office183 retained offline draft'")).rows[0].count).toBe("1");
  });
  test("Earlier does not mark undisplayed latest messages read; Latest and closed threads have the correct controls", async ({ page }) => {
    await signIn(page); await page.goto(`${app}/admin/support/${history}?before=${historyIds[70]}`);
    await expect(page.getByRole("log")).toContainText("History entry 69"); await expect(page.getByRole("log")).not.toContainText("History entry 119");
    await expect.poll(async () => (await db.query("SELECT read_at < (SELECT created_at FROM support_messages WHERE id=$2) AS earlier FROM support_thread_reads WHERE thread_id=$1 AND user_id=$3", [history, historyIds[119], office.id])).rows[0]?.earlier).toBe(true);
    await page.getByRole("link", { name: "Latest", exact: true }).click(); await expect(page.getByRole("log")).toContainText("History entry 119");
    // Prisma's public dates and receipts use JavaScript millisecond precision; raw SQL fixtures keep microseconds.
    await expect.poll(async () => (await db.query("SELECT read_at >= (SELECT date_trunc('milliseconds',created_at) FROM support_messages WHERE id=$2) AS latest FROM support_thread_reads WHERE thread_id=$1 AND user_id=$3", [history, historyIds[119], office.id])).rows[0]?.latest).toBe(true);
    await page.goto(`${app}/admin/support/${closed}`); await expect(page.getByText("This thread is closed.", { exact: true })).toBeVisible(); await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveCount(0);
  });
  test("a lost send response keeps its draft and stable request key across reload, so retry saves one reply", async ({ page }) => {
    await signIn(page); await page.goto(`${app}/admin/support/${privateThread}`);
    const input = page.getByRole("textbox", { name: "Message", exact: true }), body = "Office183 lost-response retry";
    let lost = false;
    await page.route(`**/admin/support/${privateThread}`, async route => {
      if (!lost && route.request().method() === "POST" && route.request().headers()["next-action"] && route.request().postData()?.includes(body)) {
        // Let the real server commit, then lose only its response. No production hook or mocked command.
        lost = true; const committed = await route.fetch(); await committed.body(); await route.abort("connectionreset");
      } else await route.continue();
    });
    await input.fill(body); await input.press("Enter");
    await expect(page.getByText("Your message wasn’t sent. Try again.", { exact: true })).toBeVisible();
    expect(lost).toBe(true); await page.unroute(`**/admin/support/${privateThread}`); await page.reload();
    await expect(input).toHaveValue(body); await input.press("Enter"); await expect(input).toHaveValue("");
    expect((await db.query("SELECT count(*) FROM support_messages WHERE thread_id=$1 AND body=$2", [privateThread, body])).rows[0].count).toBe("1");
  });
  test("ordinary roles and a revoked office role receive no inbox or private message data", async ({ page }) => {
    for (const person of [customer, worker]) {
      await signIn(page, person); const response = await page.goto(`${app}/admin/support/${privateThread}`);
      expect(page.url()).not.toContain("/admin/support"); expect(await response!.text()).not.toContain("Please help with my account.");
    }
    await signIn(page, worker);
    const privateDenied = await page.goto(`${app}/support/${privateThread}`);
    await expect(page.getByRole("heading", { name: "Wrong address.", exact: true })).toBeVisible();
    expect(await privateDenied!.text()).not.toContain("Please help with my account.");
    await signIn(page); await db.query("UPDATE profiles SET role='CUSTOMER' WHERE id=$1", [office.id]);
    const denied = await page.goto(`${app}/admin/support`); expect(page.url()).not.toContain("/admin/support"); expect(await denied!.text()).not.toContain("Support183 help with account");
    await db.query("UPDATE profiles SET role='ADMIN' WHERE id=$1", [office.id]);
  });
});
