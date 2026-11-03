import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { SECURITY_PASSWORD, SECURITY_TRADIE, SECURITY_USER, startSecurityAuthStub } from "./support/security-auth-stub";

const app = process.env.PROBLEM_THREADS_E2E_APP_URL;
const database = process.env.PROBLEM_THREADS_E2E_DATABASE_URL;
const ownJob = "18100000-0000-4000-8000-000000000001", foreignJob = "18100000-0000-4000-8000-000000000002";
const foreignUser = "18100000-0000-4000-8000-000000000003", otherWorker = "18100000-0000-4000-8000-000000000004";
const foreignThread = "18100000-0000-4000-8000-000000000005";

test.describe("signed-in problem threads", () => {
  test.skip(!app || !database, "Needs an isolated localhost Auth provider and disposable database.");
  test.describe.configure({ mode: "serial" });
  let auth: Awaited<ReturnType<typeof startSecurityAuthStub>>, db: pg.Client;
  test.beforeAll(async () => {
    const target = new URL(database!);
    if (!["localhost", "127.0.0.1"].includes(target.hostname) || !/^\/(issue181|local_problem_threads)$/.test(target.pathname) || !["localhost", "127.0.0.1"].includes(new URL(app!).hostname)) throw new Error("Problem-thread e2e requires an isolated localhost app/database.");
    auth = await startSecurityAuthStub(Number(process.env.PROBLEM_THREADS_E2E_AUTH_PORT ?? 54381));
    db = new pg.Client({ connectionString: database }); await db.connect();
    for (const person of [{ ...SECURITY_USER, role: "CUSTOMER" }, { ...SECURITY_TRADIE, role: "TRADIE" }, { id: foreignUser, email: "foreign-181@example.test", role: "CUSTOMER" }, { id: otherWorker, email: "other-worker-181@example.test", role: "TRADIE" }]) {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2) ON CONFLICT(id) DO NOTHING", [person.id, person.email]);
      await db.query("INSERT INTO profiles(id,email,role,first_name,email_verified_at) VALUES($1,$2,$3,'Problem demo',now()) ON CONFLICT(id) DO NOTHING", [person.id, person.email, person.role]);
    }
    await db.query("DELETE FROM jobs WHERE id=ANY($1::uuid[])", [[ownJob, foreignJob]]);
    for (const [id, owner] of [[ownJob, SECURITY_USER.id], [foreignJob, foreignUser]]) await db.query("INSERT INTO jobs(id,customer_id,category,title,description,address_line1,suburb,city,status) VALUES($1,$2,'OTHER','Problem thread browser fixture','A job for the isolated problem-thread browser journey','1 Fixture Street','Windsor','Invercargill','REVIEW')", [id, owner]);
    await db.query("INSERT INTO support_threads(id,user_id,job_id,job_participants,subject) VALUES($1,$2,$3,true,'Foreign private request')", [foreignThread, foreignUser, foreignJob]);
    await db.query("INSERT INTO support_messages(thread_id,author_id,body) VALUES($1,$2,'Foreign private message')", [foreignThread, foreignUser]);
  });
  test.afterAll(async () => { await auth?.close(); await db?.end(); });

  async function login(page: Page, email: string, next: string) {
    await page.goto(`${app}/login?next=${encodeURIComponent(next)}`);
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(`${app}${next}`);
  }
  async function pointerSend(page: Page, label: string) {
    const button = page.getByRole("button", { name: label, exact: true });
    await button.scrollIntoViewIfNeeded();
    expect(await button.evaluate(element => { const r = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })).toBe(true);
    await button.click();
  }
  test("390px customer opens, sends and reloads; Contact returns; current worker can reply and loses access on reassignment", async ({ page, browser }) => {
    test.setTimeout(180_000); await page.setViewportSize({ width: 390, height: 844 });
    await login(page, SECURITY_USER.email, "/messages");
    await page.getByRole("button", { name: "Ask about a job", exact: true }).first().click();
    await page.getByLabel("Job", { exact: true }).selectOption(ownJob);
    await page.getByLabel("Subject", { exact: true }).fill("Problem with the job");
    const message = page.getByRole("textbox", { name: "Message", exact: true });
    await expect(message).toBeEnabled();
    const initial = "Please check fixture-private-message-181. Call +61 412 345 678 or email fixture-181@example.test.";
    await message.fill(initial); await pointerSend(page, "Send request");
    await expect(page).toHaveURL(/\/messages\/[0-9a-f-]{36}$/);
    const threadId = new URL(page.url()).pathname.split("/").at(-1)!;
    await expect(page.getByRole("log")).toContainText("hidden until the job is booked");
    await expect(page.getByRole("log")).not.toContainText("fixture-181@example.test");
    expect((await db.query("SELECT body FROM support_messages WHERE thread_id=$1", [threadId])).rows[0].body).toBe(initial);
    await message.fill("Second fixture-private-message-181"); await pointerSend(page, "Send");
    await expect(message).toHaveValue(""); await page.reload();
    await expect(page.getByRole("log")).toContainText("Second fixture-private-message-181");
    expect((await db.query("SELECT count(*) FROM support_messages WHERE thread_id=$1", [threadId])).rows[0].count).toBe("2");
    await page.goto(`${app}/contact?job=${ownJob}`); await page.getByRole("link", { name: "the job page", exact: true }).click();
    await expect(page).toHaveURL(`${app}/messages/${threadId}`); await expect(page.getByRole("log")).toContainText("Second fixture-private-message-181");
    // Next's loading boundary can start a 200 stream before notFound(); verify the denied UI and wire data.
    const denied = await page.goto(`${app}/messages/${foreignThread}`);
    await expect(page.getByRole("heading", { name: "Wrong address.", exact: true })).toBeVisible();
    expect(await denied!.text()).not.toContain("Foreign private message");
    await expect(page.locator("body")).not.toContainText("Foreign private message");

    await db.query("UPDATE jobs SET worker_id=$1,status='ASSIGNED',price_cents=12000 WHERE id=$2", [SECURITY_TRADIE.id, ownJob]);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } }); const worker = await context.newPage();
    try {
      await login(worker, SECURITY_TRADIE.email, `/messages/${threadId}`);
      await expect(worker.getByRole("log")).toContainText("fixture-181@example.test");
      await worker.getByRole("textbox", { name: "Message", exact: true }).fill("Worker fixture-private-message-181"); await pointerSend(worker, "Send");
      await expect(worker.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("");
      expect((await db.query("SELECT count(*) FROM support_messages WHERE thread_id=$1", [threadId])).rows[0].count).toBe("3");
      await db.query("UPDATE jobs SET worker_id=$1 WHERE id=$2", [otherWorker, ownJob]);
      const removed = await worker.reload();
      await expect(worker.getByRole("heading", { name: "Wrong address.", exact: true })).toBeVisible();
      expect(await removed!.text()).not.toContain("fixture-181@example.test");
      await expect(worker.locator("body")).not.toContainText("fixture-181@example.test");
    } finally { await context.close(); }
    expect(auth.events.some(event => event.path === "/auth/v1/user")).toBe(true);
  });
  test("older windows keep latest replies unread until Latest is actually opened", async ({ page }) => {
    test.setTimeout(180_000); await page.setViewportSize({ width: 390, height: 844 });
    await db.query("UPDATE jobs SET worker_id=$1 WHERE id=$2", [SECURITY_TRADIE.id, ownJob]);
    const threadId = (await db.query("SELECT id FROM support_threads WHERE job_id=$1 AND job_participants AND status='OPEN'", [ownJob])).rows[0].id;
    const ids = Array.from({ length: 151 }, () => randomUUID()); const start = new Date(Date.now() + 1000);
    await db.query("INSERT INTO support_messages(id,thread_id,author_id,body,created_at) SELECT x.id,$2,CASE WHEN (x.n-1)%2=0 THEN $3::uuid ELSE $4::uuid END,'History entry '||(x.n-1),$5::timestamptz+(x.n-1)*interval '1 second' FROM unnest($1::uuid[]) WITH ORDINALITY AS x(id,n)", [ids, threadId, SECURITY_USER.id, SECURITY_TRADIE.id, start]);
    await db.query("DELETE FROM support_thread_reads WHERE thread_id=$1 AND user_id=$2", [threadId, SECURITY_TRADIE.id]);
    await login(page, SECURITY_TRADIE.email, `/messages/${threadId}?before=${ids[100]}`);
    await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeEnabled(); await page.waitForLoadState("networkidle");
    await expect(page.getByRole("log").getByRole("article")).toHaveCount(50);
    await expect(page.getByRole("log")).not.toContainText("History entry 150");
    await expect(page.getByText("Sent", { exact: true })).toHaveCount(0);
    expect((await db.query("SELECT count(*) FROM support_thread_reads WHERE thread_id=$1 AND user_id=$2", [threadId, SECURITY_TRADIE.id])).rows[0].count).toBe("0");
    const history = page.getByRole("navigation", { name: "Message history", exact: true });
    await history.getByRole("link", { name: "Earlier", exact: true }).click(); await expect(page).toHaveURL(new RegExp(`before=${ids[50]}`));
    await history.getByRole("link", { name: "Latest", exact: true }).click(); await expect(page).toHaveURL(`${app}/messages/${threadId}`);
    await expect(page.getByRole("log")).toContainText("History entry 150");
    await expect.poll(async () => (await db.query("SELECT read_at FROM support_thread_reads WHERE thread_id=$1 AND user_id=$2", [threadId, SECURITY_TRADIE.id])).rows[0]?.read_at.toISOString()).toBe(new Date(start.getTime() + 150_000).toISOString());
  });
});
