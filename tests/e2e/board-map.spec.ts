import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";
import { expect, test, type Page } from "@playwright/test";
import { BOARD_MAP_STATES } from "../../src/lib/board-map";
import { expectNoA11yViolations } from "./support/a11y";
import { SECURITY_PASSWORD, SECURITY_TRADIE, SECURITY_USER, startSecurityAuthStub } from "./support/security-auth-stub";
import { VIEWPORTS } from "./support/viewports";

const preview = process.env.POSTED_PREVIEW_E2E_URL || "http://127.0.0.1:3101";
const app = process.env.BOARD_MAP_E2E_APP_URL, noMapApp = process.env.BOARD_MAP_E2E_NO_MAP_URL, database = process.env.BOARD_MAP_E2E_DATABASE_URL;
const demo = (state: string) => `${preview}/dev/components/board-map?state=${state}`;
test("board map examples remain guarded on production", async ({ request }) => { expect((await request.get("/dev/components/board-map")).status()).toBe(404); });
for (const viewport of VIEWPORTS) test(`all board map states at ${viewport.width}px`, async ({ page }) => {
  test.setTimeout(240_000); await page.setViewportSize(viewport);
  for (const state of [...BOARD_MAP_STATES, "gallery"]) {
    const response = await page.goto(demo(state)); expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: state === "gallery" ? "Map states" : "Jobs near you", exact: true })).toBeVisible();
    if (state === "empty") await expect(page.getByRole("heading", { name: "No jobs match that.", exact: true })).toBeVisible();
    if (state === "nothing-in-view") await expect(page.getByRole("heading", { name: "No jobs here. Zoom out.", exact: true })).toBeVisible();
    if (state === "no-location") await expect(page.getByText("Showing your work area.", { exact: true })).toBeVisible();
    if (state === "legend-closed") await expect(page.getByRole("button", { name: "Close map legend", exact: true })).toHaveCount(0);
    if (state === "map-unavailable") { await expect(page.getByText("Map isn’t available right now.", { exact: true })).toBeVisible(); await expect(page.getByRole("region", { name: "Map of jobs in view", exact: true })).toHaveCount(0); }
    if (state === "pin-open" || state === "bounty-open") { await expect(page.locator(`article[data-card-kind="${state === "pin-open" ? "claim" : "bounty"}"]`)).toBeVisible(); await expect(page.getByText("Pin examples. See each job for its offer and time left.", { exact: true })).toHaveCount(0); }
    if (state === "row-hover") await expect(page.getByRole("list", { name: "Jobs in view", exact: true }).locator('[data-hot="true"]')).not.toHaveCount(0);
    if (state === "clustered") await expect(page.locator('button[data-pin-kind="cluster"]')).not.toHaveCount(0);
    if (state === "chips-estimate") await expect(page.getByRole("list", { name: "Map job kind", exact: true }).getByRole("button", { name: /^Estimate/ })).toHaveAttribute("aria-pressed", "true");
    if (state === "error") await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
    if (state === "offline") await expect(page.getByText("You’re offline.", { exact: true })).toBeVisible();
    if (state === "loading") await expect(page.getByRole("status").filter({ hasText: "Loading your jobs" })).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), state).toBe(true);
    await expectNoA11yViolations(page);
    if (state === "pin-open" || state === "bounty-open") {
      const card = page.locator("article[data-card-kind]"); await card.getByRole("button", { name: /^Close / }).click({ timeout: 10_000 }); await expect(card).toHaveCount(0);
      await page.getByRole("button", { name: "Zoom in", exact: true }).click(); await page.getByRole("button", { name: "Zoom out", exact: true }).click();
    }
    if (state === "ready") {
      const examples = page.getByText("Pin examples. See each job for its offer and time left.", { exact: true });
      const legendClose = page.getByRole("button", { name: "Close map legend", exact: true });
      await expect(examples).toBeVisible();
      const mapBox = await page.getByRole("region", { name: "Map of jobs in view", exact: true }).boundingBox(), closeBox = await legendClose.boundingBox(), noteBox = await examples.boundingBox();
      if (viewport.width < 360) expect(closeBox!.y).toBeGreaterThan(mapBox!.y + mapBox!.height);
      else expect(noteBox!.y + noteBox!.height).toBeLessThanOrEqual(mapBox!.y + mapBox!.height);
      await legendClose.click({ timeout: 10_000 }); await expect(examples).toHaveCount(0);
      await page.getByRole("button", { name: "Zoom in", exact: true }).click(); await page.getByRole("button", { name: "Zoom out", exact: true }).click();
      await page.getByRole("list", { name: "Jobs in view", exact: true }).getByRole("button").first().click();
      const selected = page.locator("article[data-card-kind]"); await expect(selected).toBeVisible(); await expect(examples).toHaveCount(0);
      await selected.getByRole("button", { name: /^Close / }).click(); await expect(selected).toHaveCount(0);
      await page.evaluate(() => { for (const key of Object.keys(localStorage)) if (key.startsWith("tm:map-legend:")) localStorage.removeItem(key); });
    }
  }
});

test("keyboard pins, row/pin highlight, preview job/Back and Grid retain filters", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto(`${demo("ready")}&kind=ready&trade=other&distance=10&sort=earn`);
  const rows = page.getByRole("list", { name: "Jobs in view", exact: true });
  const row = rows.getByRole("button").first(); await row.hover(); await expect(page.locator('[data-map-pin] .is-hot')).not.toHaveCount(0);
  const pin = page.locator('[data-map-pin] button').first(), label = await pin.getAttribute("aria-label");
  await pin.hover(); await expect(rows.getByRole("button", { name: label!, exact: true })).toHaveAttribute("data-hot", "true");
  await pin.focus(); await page.keyboard.press("Enter");
  const card = page.locator("article[data-card-kind]"); await expect(card).toBeVisible();
  const title = card.getByRole("link"); await expect(title).toBeFocused();
  await page.keyboard.press("Escape"); await expect(card).toHaveCount(0); await expect(pin).toBeFocused();
  expect(await pin.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe("none");
  await pin.press("Enter"); await card.getByRole("link").press("Enter");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "Back to jobs", exact: true }).click();
  await expect(page).toHaveURL(/kind=ready.*trade=other.*distance=10.*sort=earn.*view=map/);
  await page.getByRole("tab", { name: "Grid", exact: true }).press("Enter"); await expect(page).toHaveURL(/layout=grid/);
  await expect(page.getByRole("tab", { name: /^Ready to claim/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Sort by", { exact: true })).toHaveValue("earn");
  await page.goto(`${demo("chips-estimate")}&kind=all`);
  await page.getByRole("list", { name: "Jobs in view", exact: true }).getByRole("button").first().press("Enter");
  await page.locator("article[data-card-kind]").getByRole("link").press("Enter"); await page.getByRole("link", { name: "Back to jobs", exact: true }).click();
  await expect(page).toHaveURL(/state=chips-estimate.*kind=all/);
  await expect(page.getByRole("list", { name: "Map job kind", exact: true }).getByRole("button", { name: /^All/ })).toHaveAttribute("aria-pressed", "true");
});
test("chips, pan, zoom, empty recovery, provider fallback, retries and legend memory work", async ({ page, context }) => {
  test.setTimeout(90_000);
  await page.goto(demo("ready"));
  const chips = page.getByRole("list", { name: "Map job kind", exact: true });
  await chips.getByRole("button", { name: /^Estimate/ }).press("Enter"); await expect(page).toHaveURL(/kind=estimate/);
  await expect(page.getByRole("list", { name: "Jobs in view", exact: true })).not.toContainText("Earn");
  await chips.getByRole("button", { name: /^All/ }).click(); await expect(page).not.toHaveURL(/kind=estimate/);
  const before = await page.getByRole("list", { name: "Jobs in view", exact: true }).getByRole("button").count(), url = page.url();
  const map = page.getByRole("region", { name: "Move map with arrow keys", exact: true }); await map.focus(); await page.keyboard.press("ArrowRight");
  await expect.poll(() => page.getByRole("list", { name: "Jobs in view", exact: true }).getByRole("button").count()).toBeLessThan(before); await expect(page).toHaveURL(url);
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  await page.goto(demo("nothing-in-view")); await page.getByRole("button", { name: "Zoom out", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "No jobs here. Zoom out.", exact: true })).toHaveCount(0);
  await page.goto(demo("ready")); await page.getByRole("button", { name: "Close map legend", exact: true }).press("Enter"); await page.reload();
  await expect(page.getByRole("button", { name: "Close map legend", exact: true })).toHaveCount(0);
  await context.addInitScript(() => { const read = Storage.prototype.getItem, write = Storage.prototype.setItem;
    Storage.prototype.getItem = function(key) { if (key.startsWith("tm:map-legend:")) throw Error("Storage denied"); return read.call(this, key); };
    Storage.prototype.setItem = function(key, value) { if (key.startsWith("tm:map-legend:")) throw Error("Storage denied"); return write.call(this, key, value); };
  });
  await page.reload(); await page.getByRole("button", { name: "Close map legend", exact: true }).click();
  await expect(page.getByRole("button", { name: "Close map legend", exact: true })).toHaveCount(0);
  await page.goto(demo("error")); await page.getByRole("button", { name: "Try again", exact: true }).click(); await expect(page.getByRole("heading", { name: /\d+ jobs in view/ })).toBeVisible();
  await page.goto(demo("map-unavailable")); await page.getByRole("list", { name: "Jobs in view", exact: true }).getByRole("link").first().click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible(); await page.getByRole("link", { name: "Back to jobs", exact: true }).click(); await expect(page).toHaveURL(/state=map-unavailable/);
});

// Only the provider is a stand-in. These journeys run the real route, reader, Auth, map kit and job page.
const providerScript = `window.mapboxgl={supported:()=>true,Map:class{
 constructor(o){this.el=o.container;this.listeners={};this.b={west:168,south:-47,east:169,north:-46};this.z=10;this.timer=setTimeout(()=>this.emit('load'),0);}
 on(n,f){(this.listeners[n]??=[]).push(f)} off(n,f){this.listeners[n]=(this.listeners[n]??[]).filter(x=>x!==f)} emit(n){for(const f of this.listeners[n]??[])f()}
 fitBounds([[w,s],[e,n]]){this.b={west:w,south:s,east:e,north:n};this.emit('move')}
 project([lng,lat]){return{x:(lng-this.b.west)/(this.b.east-this.b.west)*this.el.clientWidth,y:(this.b.north-lat)/(this.b.north-this.b.south)*this.el.clientHeight}}
 getBounds(){return{getNorth:()=>this.b.north,getSouth:()=>this.b.south,getEast:()=>this.b.east,getWest:()=>this.b.west}} getZoom(){return this.z}
 scale(f){const b=this.b,x=(b.east+b.west)/2,y=(b.north+b.south)/2,w=(b.east-b.west)*f/2,h=(b.north-b.south)*f/2;this.b={west:x-w,east:x+w,south:y-h,north:y+h};this.emit('move')}
 zoomIn(){this.z++;this.scale(.5)} zoomOut(){this.z--;this.scale(2)} flyTo({center:[x,y]}){const w=(this.b.east-this.b.west)/2,h=(this.b.north-this.b.south)/2;this.b={west:x-w,east:x+w,south:y-h,north:y+h};this.emit('move')}
 resize(){this.emit('resize')} remove(){clearTimeout(this.timer);this.listeners={};this.el.replaceChildren()}
}};`;
async function fakeProvider(page: Page, fail = false) {
  await page.route("https://api.mapbox.com/**", route => route.fulfill({ contentType: route.request().url().endsWith(".css") ? "text/css" : "application/javascript", body: route.request().url().endsWith(".css") ? "" : fail ? "window.mapboxgl={supported:()=>false};" : providerScript }));
}
test.describe("real board map journeys", () => {
  test.skip(!app || !database || !noMapApp, "Needs the disposable localhost lane_c_140 fixture app, database and no-token server.");
  test.describe.configure({ mode: "serial", timeout: 120_000 });
  let db: pg.Client, auth: Awaited<ReturnType<typeof startSecurityAuthStub>>;
  const office = "14000000-0000-4000-8000-000000000099", ids = { ready: randomUUID(), quote: randomUUID(), bounty: randomUUID() }, tag = randomUUID().slice(0, 8);
  const title = (kind: keyof typeof ids) => `Map ${kind} ${tag}`;
  const exact = { lat: -46.4147, lng: 168.3538 }, centre = { lat: -46.4132, lng: 168.3538 };
  const board = "/jobs?trade=other&distance=5&when=flexible&sort=newest&view=all&layout=map";
  test.beforeAll(async () => {
    const target = new URL(database!);
    if (!["127.0.0.1", "localhost"].includes(target.hostname) || target.pathname !== "/lane_c_140" || target.search || !["127.0.0.1", "localhost"].includes(new URL(app!).hostname)) throw Error("Disposable localhost lane_c_140 required");
    db = new pg.Client({ connectionString: database }); await db.connect(); auth = await startSecurityAuthStub(Number(process.env.BOARD_MAP_E2E_AUTH_PORT ?? 54530));
    for (const [id, email, role] of [[SECURITY_TRADIE.id, SECURITY_TRADIE.email, "TRADIE"], [SECURITY_USER.id, SECURITY_USER.email, "CUSTOMER"], [office, "map-office@example.test", "ADMIN"]]) {
      await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2) ON CONFLICT(id) DO NOTHING", [id, email]);
      await db.query("INSERT INTO profiles(id,email,role,first_name,email_verified_at,updated_at) VALUES($1,$2,$3,'Map fixture',now(),now()) ON CONFLICT(id) DO UPDATE SET role=excluded.role,email_verified_at=now()", [id, email, role]);
    }
    await db.query("INSERT INTO worker_profiles(user_id,identity_checked_at,identity_checked_by_id,base_suburb,area_lat,area_lng,area_radius_km,available,updated_at) VALUES($1,now(),$2,'Invercargill',$3,$4,5,false,now()) ON CONFLICT(user_id) DO UPDATE SET identity_checked_at=now(),identity_checked_by_id=$2,area_lat=$3,area_lng=$4,area_radius_km=5,paused_at=NULL", [SECURITY_TRADIE.id, office, centre.lat, centre.lng]);
    const points = { ready: centre, quote: { lat: centre.lat + .025, lng: centre.lng - .02 }, bounty: { lat: centre.lat + .015, lng: centre.lng + .045 } };
    for (const kind of ["ready", "quote", "bounty"] as const) {
      const point = points[kind];
      await db.query("INSERT INTO jobs(id,customer_id,category,title,description,address_line1,suburb,city,lat,lng,approx_lat,approx_lng,any_time) VALUES($1,$2,'OTHER',$3,'Private description','Private map street','Windsor','Invercargill',$4,$5,$6,$7,true)", [ids[kind], SECURITY_USER.id, title(kind), point.lat - .0015, point.lng, point.lat, point.lng]);
    }
    const priceModule = new URL("../../src/server/pricing/price-job.ts", import.meta.url).href, databaseModule = new URL("../../src/server/database-client.ts", import.meta.url).href;
    const code = `import {createDatabaseClient} from ${JSON.stringify(databaseModule)};import {priceJob} from ${JSON.stringify(priceModule)};const db=createDatabaseClient(process.env.BOARD_MAP_E2E_DATABASE_URL);try{for(const jobId of JSON.parse(process.env.BOARD_MAP_FIXTURE_IDS)){const r=await priceJob(db,{jobId,minutes:120,materialsCents:0});if(!r.ok)throw Error(r.error);}}finally{await db.$disconnect();}`;
    await promisify(execFile)(process.execPath, ["--conditions=react-server", "--import", "tsx", "--input-type=module", "-e", code], { cwd: process.cwd(), env: { ...process.env, BOARD_MAP_FIXTURE_IDS: JSON.stringify(Object.values(ids)) } });
    await db.query("UPDATE jobs SET status='BOOKABLE' WHERE id=$1", [ids.ready]); await db.query("UPDATE jobs SET status='QUOTE_BOUNTY' WHERE id=$1", [ids.bounty]);
    await db.query("UPDATE settings SET bounty_amount_cents=4500,bounty_expiry_hours=36 WHERE id=1");
  });
  test.afterAll(async () => { if (db) await db.query("DELETE FROM jobs WHERE id=ANY($1::uuid[])", [Object.values(ids)]); await auth?.close(); await db?.end(); });
  async function login(page: Page) {
    await page.goto(`${app}/login?next=${encodeURIComponent(board)}`); await page.getByLabel("Email", { exact: true }).fill(SECURITY_TRADIE.email); await page.getByLabel("Password", { exact: true }).fill(SECURITY_PASSWORD);
    await page.getByRole("button", { name: "Log in", exact: true }).click(); await expect(page).toHaveURL(`${app}${board}`); await expect(page.getByRole("heading", { name: "3 jobs in view", exact: true })).toBeVisible();
  }
  test("real map → keyboard pin → job → Back and Grid keep all filters at five widths", async ({ page }) => {
    await fakeProvider(page); await login(page);
    const response = await page.goto(`${app}${board}`), html = await response!.text();
    expect(html).not.toContain("Private map street"); expect(html).not.toContain('"priceCents"'); expect(html).not.toContain(String(exact.lat));
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport); await page.goto(`${app}${board}`);
      const pin = page.locator(`button[data-pin-kind="claim"]`).filter({ hasText: "$" }); await expect(pin).toHaveCount(1);
      await page.getByRole("tab", { name: "Map", exact: true }).focus();
      for (let step = 0; step < 80 && !await pin.evaluate(element => element === document.activeElement); step++) await page.keyboard.press("Tab");
      await expect(pin).toBeFocused(); await pin.press("Enter");
      const link = page.locator("article[data-card-kind]").getByRole("link", { name: title("ready"), exact: true }); await expect(link).toBeFocused(); await link.press("Enter");
      await expect(page.getByRole("heading", { name: title("ready"), exact: true })).toBeVisible();
      await page.getByRole("main").getByRole("link", { name: "Back to jobs", exact: true }).click(); await expect(page).toHaveURL(`${app}${board}`);
      await expect(page.getByRole("link", { name: viewport.width < 1024 ? "All jobs" : "Find work", exact: true })).toHaveAttribute("aria-current", "page");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await expectNoA11yViolations(page);
      await page.getByRole("tab", { name: "Grid", exact: true }).click(); await expect(page).toHaveURL(`${app}${board.replace("&layout=map", "")}`);
      await expect(page.getByLabel("Sort by", { exact: true })).toHaveValue("newest"); await expect(page.getByRole("link", { name: title("ready"), exact: true })).toBeVisible();
    }
  });
  test("real permission denial, configured bounty, no-token and provider error keep honest usable rows", async ({ page, context }) => {
    await context.grantPermissions([]); await fakeProvider(page); await login(page);
    await page.getByRole("button", { name: "Use my location", exact: true }).click(); await expect(page.getByText("Showing your work area.", { exact: true })).toBeVisible();
    await page.locator('button[data-pin-kind="bounty"]').click(); await expect(page.locator('article[data-card-kind="bounty"]')).toContainText("$45.00");
    await page.keyboard.press("Escape"); await expect(page.locator('article[data-card-kind="bounty"]')).toHaveCount(0);
    let requests = 0; await page.unroute("https://api.mapbox.com/**"); await page.route("https://api.mapbox.com/**", route => { requests++; return route.abort(); });
    await page.goto(`${noMapApp}${board}`); await expect(page.getByText("Map isn’t available right now.", { exact: true })).toBeVisible(); expect(requests).toBe(0);
    await page.getByRole("list", { name: "Jobs in view", exact: true }).getByRole("link").filter({ hasText: title("ready") }).click(); await expect(page.getByRole("heading", { name: title("ready"), exact: true })).toBeVisible();
    await page.getByRole("main").getByRole("link", { name: "Back to jobs", exact: true }).click(); await expect(page).toHaveURL(`${noMapApp}${board}`);
    await page.unroute("https://api.mapbox.com/**"); await fakeProvider(page, true); await page.goto(`${app}${board}`);
    await expect(page.getByText("Map isn’t available right now.", { exact: true })).toBeVisible(); await expect(page.getByRole("list", { name: "Jobs in view", exact: true }).getByRole("link")).toHaveCount(3);
    await expectNoA11yViolations(page);
  });
});
