import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import sharp from "sharp";
import { SECURITY_PASSWORD, SECURITY_TRADIE, SECURITY_USER } from "./support/security-auth-stub";
import { startPhotoStorageStub } from "./support/photo-storage-stub";

const app = process.env.OFFICE_TRADIES_E2E_APP_URL, database = process.env.OFFICE_TRADIES_E2E_DATABASE_URL;
test.describe("real office licence and pause journeys", () => {
  test.skip(!app || !database, "Needs isolated localhost issue174 database and Auth fixture"); test.describe.configure({ mode: "serial" });
  let storage: Awaited<ReturnType<typeof startPhotoStorageStub>>, db: pg.Client;
  test.beforeAll(async () => {
    const target = new URL(database!);
    if (!["127.0.0.1", "localhost"].includes(target.hostname) || target.pathname !== "/issue174" || target.search || !["127.0.0.1", "localhost"].includes(new URL(app!).hostname)) throw new Error("Office tradies tests require localhost issue174 database and app");
    storage = await startPhotoStorageStub(Number(process.env.OFFICE_TRADIES_E2E_AUTH_PORT ?? 54408)); db = new pg.Client({ connectionString: database }); await db.connect();
    for (const person of [{ ...SECURITY_USER, role: "ADMIN", name: "Matt" }, { ...SECURITY_TRADIE, role: "TRADIE", name: "Jack" }]) {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2) ON CONFLICT(id) DO NOTHING", [person.id, person.email]);
      await db.query("INSERT INTO profiles(id,email,role,first_name,last_name,email_verified_at,phone,phone_verified_at,phone_verified_for) VALUES($1,$2,$3,$4,'Wilson',now(),'+64211234567',now(),'+64211234567') ON CONFLICT(id) DO UPDATE SET role=EXCLUDED.role,first_name=EXCLUDED.first_name,last_name='Wilson'", [person.id, person.email, person.role, person.name]);
    }
    await db.query("INSERT INTO worker_profiles(user_id,base_suburb,identity_checked_at,identity_checked_by_id) VALUES($1,'Invercargill',now(),$2) ON CONFLICT(user_id) DO UPDATE SET paused_at=NULL,paused_by_id=NULL", [SECURITY_TRADIE.id, SECURITY_USER.id]);
    await db.query("DELETE FROM worker_trades WHERE user_id=$1", [SECURITY_TRADIE.id]);
    for (const [trade, number] of [["ELECTRICAL", "E 220981"], ["GAS", "PGDB 44120"]]) {
      await db.query("INSERT INTO worker_trades(user_id,trade) VALUES($1,$2)", [SECURITY_TRADIE.id, trade]);
      await db.query("INSERT INTO licences(user_id,trade,number,expires_on,document_path) VALUES($1,$2,$3,'2027-03-31',$4)", [SECURITY_TRADIE.id, trade, number, `licences/${SECURITY_TRADIE.id}/${"a".repeat(32)}.webp`]);
    }
    storage.objects.set(`documents/licences/${SECURITY_TRADIE.id}/${"a".repeat(32)}.webp`, await sharp({ create: { width: 24, height: 24, channels: 3, background: { r: 255, g: 255, b: 255 } } }).webp().toBuffer());
  });
  test.afterAll(async () => { await storage?.close(); await db?.end(); });
  async function login(page: Page, email: string, next: string) {
    await page.goto(`${app}/login?next=${encodeURIComponent(next)}`); await page.getByLabel("Email", { exact: true }).fill(email); await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD); await page.getByRole("button", { name: "Log in", exact: true }).click(); await expect(page).toHaveURL(`${app}${next}`);
  }
  test("office approves one trade, rejects another with public reason, then pauses/unpauses with audit notes", async ({ page, browser, context }) => {
    test.setTimeout(240_000); await page.setViewportSize({ width: 390, height: 844 });
    let releaseGas!: () => void;
    const gasGate = new Promise<void>(resolve => { releaseGas = resolve; });
    await page.route("**/admin/tradies?**", async route => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("selected") === `${SECURITY_TRADIE.id}:GAS` && route.request().headers().rsc === "1") await gasGate;
      await route.continue();
    });
    try {
    await login(page, SECURITY_USER.email, "/admin/tradies");
    await page.getByRole("link", { name: "Review Jack Wilson, Electrical", exact: true }).click();
    const opened = page.waitForEvent("popup"); await page.getByRole("link", { name: "View licence", exact: true }).click(); const document = await opened; await document.waitForLoadState(); await expect.poll(() => document.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(24); await document.close();
    await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled(); await page.getByLabel("Note (saved with the decision)", { exact: true }).fill("Fixture174 checked the EWRB register");
    await context.setOffline(true); await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled(); await context.setOffline(false); await page.reload();
    await expect(page.getByLabel("Note (saved with the decision)", { exact: true })).toHaveValue("Fixture174 checked the EWRB register"); await page.getByRole("button", { name: "Approve", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Approve", exact: true }).click(); await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
    expect((await db.query("SELECT trade,status FROM licences WHERE user_id=$1 ORDER BY trade", [SECURITY_TRADIE.id])).rows).toEqual(expect.arrayContaining([{ trade: "ELECTRICAL", status: "VERIFIED" }, { trade: "GAS", status: "PENDING" }]));
    await page.getByRole("link", { name: "Back", exact: true }).click();
    const openingGas = page.getByRole("link", { name: "Review Jack Wilson, Gas fitting", exact: true }).click();
    try {
      await expect(page.getByRole("table", { name: "Tradies", exact: true })).toHaveAttribute("aria-busy", "true");
      await expect(page.getByLabel("Note (saved with the decision)", { exact: true })).toHaveCount(0);
    } finally { releaseGas(); await openingGas; }
    await page.getByLabel("Note (saved with the decision)", { exact: true }).fill("Fixture174 private decision note"); await page.getByRole("button", { name: "Reject…", exact: true }).click(); await page.getByLabel("Reason shown to the tradie", { exact: true }).fill("Fixture174 please upload a current card"); await page.getByRole("alertdialog").getByRole("button", { name: "Reject", exact: true }).click(); await expect(page.getByRole("region", { name: "Audit timeline", exact: true })).toContainText("Fixture174 private decision note");
    const workerContext = await browser.newContext(), worker = await workerContext.newPage();
    try {
      await login(worker, SECURITY_TRADIE.email, "/profile/trades"); await expect(worker.getByRole("main")).toContainText("Fixture174 please upload a current card"); await expect(worker.getByRole("main")).not.toContainText("Fixture174 private decision note");
      await worker.goto(`${app}/admin/tradies`); await expect(worker).toHaveURL(`${app}/jobs`);
      expect((await worker.request.get(`${app}/api/admin/tradies/document?userId=${SECURITY_TRADIE.id}&trade=GAS`)).status()).toBe(403);
    } finally { await workerContext.close(); }
    await page.getByRole("button", { name: "Pause", exact: true }).click(); await page.getByLabel("Reason", { exact: true }).fill("Fixture174 checking account concern"); await page.getByRole("alertdialog").getByRole("button", { name: "Pause", exact: true }).click(); await expect(page.getByRole("button", { name: "Unpause", exact: true })).toBeVisible();
    expect((await db.query("SELECT paused_at FROM worker_profiles WHERE user_id=$1", [SECURITY_TRADIE.id])).rows[0].paused_at).not.toBeNull();
    await page.getByRole("button", { name: "Unpause", exact: true }).click(); await page.getByLabel("Reason", { exact: true }).fill("Fixture174 concern resolved"); await page.getByRole("alertdialog").getByRole("button", { name: "Unpause", exact: true }).click(); await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
    const audit = (await db.query("SELECT action,reason FROM audit_log WHERE record_id=$1 AND action IN ('worker.paused','worker.unpaused')", [SECURITY_TRADIE.id])).rows; expect(audit).toEqual(expect.arrayContaining([{ action: "worker.paused", reason: "Fixture174 checking account concern" }, { action: "worker.unpaused", reason: "Fixture174 concern resolved" }]));
    await db.query("UPDATE profiles SET role='CUSTOMER' WHERE id=$1", [SECURITY_USER.id]); await page.reload(); await expect(page).toHaveURL(`${app}/`); await expect(page.locator("body")).not.toContainText("Fixture174 private decision note");
    } finally { releaseGas(); }
  });
});
