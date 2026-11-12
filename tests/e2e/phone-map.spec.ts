import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";
import { SECURITY_PASSWORD, SECURITY_TRADIE, SECURITY_USER, startSecurityAuthStub } from "./support/security-auth-stub";
import { expect,test } from "@playwright/test";
import { PHONE_MAP_STATES } from "../../src/lib/phone-map";
import { expectNoA11yViolations } from "./support/a11y";
test.use({ hasTouch:true });
const preview=process.env.POSTED_PREVIEW_E2E_URL||"http://127.0.0.1:3101";
const route=(state:string,extra="")=>preview+"/dev/components/phone-map?state="+state+extra;
test("phone map previews remain private in production",async({request})=>{expect((await request.get("/dev/components/phone-map")).status()).toBe(404);});
for(const width of[320,390])test(`every phone map state at ${width}px`,async({page})=>{
 test.setTimeout(240_000);await page.setViewportSize({width,height:1000});
 for(const state of PHONE_MAP_STATES){await page.goto(route(state));const map=page.getByRole("region",{name:"Nearby jobs map",exact:true});await expect(map).toBeVisible();
  if(state==="available-off")await expect(page.getByRole("switch",{name:"Not available",exact:true})).not.toBeChecked();
  if(state==="paused"||state==="saving-available"||state==="offline")await expect(page.getByRole("switch")).toBeDisabled();
  if(state==="no-jobs-in-view")await expect(page.getByRole("heading",{name:"No jobs here. Zoom out.",exact:true})).toBeVisible();
  if(state==="map-unavailable")await expect(page.getByText("Map isn’t available right now.",{exact:true})).toBeVisible();
  if(state==="loading")await expect(page.getByRole("status",{name:"Loading your jobs",exact:true})).toBeVisible();
  if(state==="error")await expect(page.getByRole("button",{name:"Try again",exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),state).toBe(true);await expectNoA11yViolations(page);
 }
});
test("gallery preserves every preview including selected bounty chip and visible saving progress",async({page})=>{
 test.setTimeout(120_000);await page.setViewportSize({width:390,height:844});await page.goto(route("a-gallery"));
 const bounty=page.getByRole("region",{name:"chips-bounty nearby jobs map",exact:true});await expect(bounty.getByRole("list",{name:"chips-bounty map job kind",exact:true}).getByRole("button",{name:/^Bounty/})).toHaveAttribute("aria-pressed","true");
 await expect(page.getByRole("region",{name:"saving-available nearby jobs map",exact:true}).getByRole("status")).toHaveText("Saving availability…");
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expectNoA11yViolations(page);
});
for(const width of[768,1024,1440])test(`desktop map is preserved at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:1000});await page.goto(route("peek"));await expect(page.getByRole("region",{name:"Nearby jobs map",exact:true})).toBeHidden();
 await expect(page.getByRole("region",{name:"Map of jobs in view",exact:true})).toBeVisible();await expect(page.getByRole("list",{name:"Jobs in view",exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expectNoA11yViolations(page);
});
test("pin selection, horizontal cards, keyboard sheet and job/Back/List keep the map query",async({page})=>{
 await page.setViewportSize({width:390,height:1000});await page.goto(route("peek","&kind=bounty"));const cards=page.getByRole("region",{name:"Jobs near you",exact:true});
 await expect(cards.locator("a").first()).toHaveAttribute("data-bounty","true");const pin=page.locator('button[data-pin-kind="bounty"]').first();await pin.tap();
 const selected=cards.locator('a[data-selected="true"]');await expect(selected).toBeInViewport();await selected.focus();await page.keyboard.press("ArrowRight");await expect(cards.locator('a[data-selected="true"]')).toBeFocused();
 await page.getByRole("button",{name:"Show list",exact:true}).press("Enter");await expect(page.getByRole("button",{name:"Show map",exact:true})).toHaveAttribute("aria-expanded","true");
 await page.getByRole("button",{name:"Show map",exact:true}).press("Enter");await expect(page.getByRole("button",{name:"Show list",exact:true})).toHaveAttribute("aria-expanded","false");
 await cards.locator('a[data-selected="true"]').click();await expect(page.getByRole("heading",{level:1})).toBeVisible();await page.getByRole("main").getByRole("link",{name:"Back to jobs",exact:true}).click();await expect(page).toHaveURL(/state=peek&kind=bounty/);
 await page.getByRole("link",{name:"List",exact:true}).click();await expect(page).toHaveURL(/state=grid&kind=bounty/);await page.getByRole("link",{name:"Map",exact:true}).click();await expect(page).toHaveURL(/state=peek&kind=bounty/);
 await expectNoA11yViolations(page);
});
test("touch swipe centres its pin and dragging the handle opens the full list",async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto(route("peek"));const cards=page.getByRole("region",{name:"Jobs near you",exact:true});
 const before=await cards.locator('a[data-selected="true"]').getAttribute("data-card-id"),box=await cards.boundingBox();const cdp=await page.context().newCDPSession(page);
 await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:box!.x+box!.width-45,y:box!.y+box!.height/2}]});
 for(const offset of[85,125,165,205,245,285]){await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:box!.x+box!.width-offset,y:box!.y+box!.height/2}]});await page.waitForTimeout(40);}
 await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
 await expect(cards.locator('a[data-selected="true"]')).not.toHaveAttribute("data-card-id",before!);
 const pin=page.locator('button[data-pin-kind][aria-expanded="true"]'),map=page.getByRole("region",{name:"Map of nearby jobs",exact:true});await expect(pin).toBeVisible();
 await expect.poll(async()=>{const p=await pin.boundingBox(),m=await map.boundingBox();return Math.abs(p!.x+p!.width/2-(m!.x+m!.width/2));}).toBeLessThan(4);
 const handle=page.getByRole("button",{name:"Show list",exact:true}),h=await handle.boundingBox();
 await page.mouse.move(h!.x+h!.width/2,h!.y+h!.height/2);await page.mouse.down();await page.mouse.move(h!.x+h!.width/2,h!.y-100,{steps:8});await page.mouse.up();
 await expect(page.getByRole("button",{name:"Show map",exact:true})).toHaveAttribute("aria-expanded","true");await expectNoA11yViolations(page);
});
test("availability sends once, remains browseable off, and rolls back a failed save",async({page})=>{
 await page.setViewportSize({width:390,height:1000});await page.goto(route("peek"));const toggle=page.getByRole("switch",{name:"You’re available",exact:true});await toggle.click();
 await expect(page.getByRole("switch",{name:"Not available",exact:true})).not.toBeChecked();await expect(page.getByText("You won’t get job alerts.",{exact:true})).toBeVisible();await expect(page.getByRole("status",{name:"Availability calls"})).toHaveText("1");await expect(page.getByRole("region",{name:"Map of nearby jobs",exact:true})).toBeVisible();
 await page.goto(route("peek","&failSave=1"));await page.getByRole("switch",{name:"You’re available",exact:true}).click();await expect(page.getByRole("switch",{name:"You’re available",exact:true})).toBeChecked();await expect(page.getByText("Couldn’t save.",{exact:true})).toBeVisible();await expectNoA11yViolations(page);
});

const providerScript = `window.mapboxgl={supported:()=>true,Map:class{
 constructor(o){this.el=o.container;window.__phoneLiveMaps=(window.__phoneLiveMaps||0)+1;window.__phoneMapCreates=(window.__phoneMapCreates||0)+1;this.listeners={};this.b={west:168,south:-47,east:169,north:-46};this.z=10;window.__boardMapFixture=this;this.timer=setTimeout(()=>this.emit('load'),0);}
 on(n,f){(this.listeners[n]??=[]).push(f)} off(n,f){this.listeners[n]=(this.listeners[n]??[]).filter(x=>x!==f)} emit(n){for(const f of this.listeners[n]??[])f()}
 fitBounds([[w,s],[e,n]]){this.b={west:w,south:s,east:e,north:n};this.emit('move')}
 project([lng,lat]){return{x:(lng-this.b.west)/(this.b.east-this.b.west)*this.el.clientWidth,y:(this.b.north-lat)/(this.b.north-this.b.south)*this.el.clientHeight}}
 getBounds(){return{getNorth:()=>this.b.north,getSouth:()=>this.b.south,getEast:()=>this.b.east,getWest:()=>this.b.west}} getZoom(){return this.z}
 scale(f){const b=this.b,x=(b.east+b.west)/2,y=(b.north+b.south)/2,w=(b.east-b.west)*f/2,h=(b.north-b.south)*f/2;this.b={west:x-w,east:x+w,south:y-h,north:y+h};this.emit('move')}
 zoomIn(){this.z++;this.scale(.5)} zoomOut(){this.z--;this.scale(2)} flyTo({center:[x,y]}){const w=(this.b.east-this.b.west)/2,h=(this.b.north-this.b.south)/2;this.b={west:x-w,east:x+w,south:y-h,north:y+h};this.emit('move')}
 resize(){this.emit('resize')} remove(){window.__phoneLiveMaps--;clearTimeout(this.timer);this.listeners={};this.el.replaceChildren()}
}};`;
const app=process.env.PHONE_MAP_E2E_APP_URL,database=process.env.PHONE_MAP_E2E_DATABASE_URL;
test.describe("real phone map availability and job journey",()=>{
 test.skip(!app||!database,"Needs the isolated local lane_b_141 fixture app and Postgres.");test.describe.configure({mode:"serial",timeout:180_000});
 let db:pg.Client,auth:Awaited<ReturnType<typeof startSecurityAuthStub>>;const job=randomUUID(),office="14100000-0000-4000-8000-000000000099",title="Phone map fixture "+job.slice(0,8);
 const board="/jobs?trade=other&distance=5&when=flexible&sort=newest&view=all&layout=map";
 test.beforeAll(async()=>{
  const target=new URL(database!);if(target.hostname!=="127.0.0.1"||target.pathname!=="/lane_b_141"||new URL(app!).hostname!=="127.0.0.1")throw Error("Isolated local lane_b_141 fixture required");
  db=new pg.Client({connectionString:database});await db.connect();auth=await startSecurityAuthStub(54622);
  for(const[id,email,role]of[[SECURITY_TRADIE.id,SECURITY_TRADIE.email,"TRADIE"],[SECURITY_USER.id,SECURITY_USER.email,"CUSTOMER"],[office,"phone-office@example.test","ADMIN"]]){
   await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2) ON CONFLICT(id) DO NOTHING",[id,email]);await db.query("INSERT INTO profiles(id,email,role,first_name,email_verified_at,updated_at) VALUES($1,$2,$3,'Phone fixture',now(),now()) ON CONFLICT(id) DO UPDATE SET role=excluded.role,email_verified_at=now()",[id,email,role]);
  }
  await db.query("INSERT INTO worker_profiles(user_id,identity_checked_at,identity_checked_by_id,base_suburb,area_lat,area_lng,area_radius_km,available,updated_at) VALUES($1,now(),$2,'Invercargill',-46.4132,168.3538,5,true,now()) ON CONFLICT(user_id) DO UPDATE SET identity_checked_at=now(),identity_checked_by_id=$2,area_lat=-46.4132,area_lng=168.3538,area_radius_km=5,available=true,paused_at=NULL",[SECURITY_TRADIE.id,office]);
  await db.query("INSERT INTO jobs(id,customer_id,category,title,description,address_line1,suburb,city,lat,lng,approx_lat,approx_lng,any_time) VALUES($1,$2,'OTHER',$3,'Private fixture','Private phone street','Windsor','Invercargill',-46.4147,168.3538,-46.4132,168.3538,true)",[job,SECURITY_USER.id,title]);
  const pricing=new URL("../../src/server/pricing/price-job.ts",import.meta.url).href,client=new URL("../../src/server/database-client.ts",import.meta.url).href;
  await promisify(execFile)(process.execPath,["--conditions=react-server","--import","tsx","--input-type=module","-e",`import{createDatabaseClient}from ${JSON.stringify(client)};import{priceJob}from ${JSON.stringify(pricing)};const db=createDatabaseClient(process.env.PHONE_MAP_E2E_DATABASE_URL);try{const r=await priceJob(db,{jobId:process.env.PHONE_MAP_FIXTURE_ID,minutes:120,materialsCents:0});if(!r.ok)throw Error(r.error)}finally{await db.$disconnect()}`],{cwd:process.cwd(),env:{...process.env,PHONE_MAP_FIXTURE_ID:job}});
  await db.query("UPDATE jobs SET status='BOOKABLE' WHERE id=$1",[job]);
 });
 test.afterAll(async()=>{if(db)await db.query("DELETE FROM jobs WHERE id=$1",[job]);await auth?.close();await db?.end();});
 test("saved availability stays off after reload while the real map, job and Back remain usable",async({page})=>{
  await page.setViewportSize({width:390,height:1000});await page.route("https://api.mapbox.com/**",route=>route.fulfill({contentType:route.request().url().endsWith(".css")?"text/css":"application/javascript",body:route.request().url().endsWith(".css")?"":providerScript}));
  await page.goto(`${app}/login?next=${encodeURIComponent(board)}`);await page.getByLabel("Email",{exact:true}).fill(SECURITY_TRADIE.email);await page.getByLabel("Password",{exact:true}).fill(SECURITY_PASSWORD);await page.getByRole("button",{name:"Log in",exact:true}).click();await expect(page).toHaveURL(app+board);
  const phone=page.getByRole("region",{name:"Nearby jobs map",exact:true});await expect(phone).toBeVisible();await expect(phone.getByRole("switch",{name:"You’re available",exact:true})).toBeChecked();
  const liveMaps=()=>page.evaluate(()=>(window as unknown as {__phoneLiveMaps:number}).__phoneLiveMaps);
  const mapCreates=()=>page.evaluate(()=>(window as unknown as {__phoneMapCreates:number}).__phoneMapCreates);
  await expect.poll(liveMaps).toBe(1);expect(await page.evaluate(()=>(window as unknown as {__phoneMapCreates:number}).__phoneMapCreates)).toBe(1);
  await page.setViewportSize({width:1024,height:1000});await expect(phone).toBeHidden();await expect.poll(liveMaps).toBe(1);await expect(page.getByRole("region",{name:"Map of jobs in view",exact:true})).toBeVisible();await expect.poll(mapCreates).toBe(2);await expect.poll(liveMaps).toBe(1);
  await page.setViewportSize({width:390,height:1000});await expect(phone).toBeVisible();await expect.poll(mapCreates).toBe(3);await expect.poll(liveMaps).toBe(1);
  const auditBefore=Number((await db.query("SELECT count(*) FROM audit_log WHERE actor_id=$1 AND action='worker.availability_changed'",[SECURITY_TRADIE.id])).rows[0].count);
  await phone.getByRole("switch",{name:"You’re available",exact:true}).tap();await expect(phone.getByRole("switch",{name:"Not available",exact:true})).not.toBeChecked();
  await expect.poll(async()=>Boolean((await db.query("SELECT available FROM worker_profiles WHERE user_id=$1",[SECURITY_TRADIE.id])).rows[0].available)).toBe(false);
  expect(Number((await db.query("SELECT count(*) FROM audit_log WHERE actor_id=$1 AND action='worker.availability_changed'",[SECURITY_TRADIE.id])).rows[0].count)).toBe(auditBefore+1);
  await page.reload();await expect(phone.getByRole("switch",{name:"Not available",exact:true})).not.toBeChecked();await expect(phone.getByText("You won’t get job alerts.",{exact:true})).toBeVisible();
  for(const width of[320,390,768,1024,1440]){
   await page.setViewportSize({width,height:1000});await page.goto(app+board);await expect.poll(liveMaps).toBe(1);expect(await page.evaluate(()=>(window as unknown as {__phoneMapCreates:number}).__phoneMapCreates)).toBe(1);
   if(width<768){
    const pin=phone.locator('button[data-pin-kind="claim"]');await pin.focus();await pin.press("Enter");const card=phone.locator(`a[data-card-id="${job}"]`);await expect(card).toBeFocused();await card.press("Enter");
   }else{
    const pin=page.locator('button[data-pin-kind="claim"]');await page.getByRole("tab",{name:"Map",exact:true}).focus();for(let step=0;step<80&&!await pin.evaluate(element=>element===document.activeElement);step++)await page.keyboard.press("Tab");await expect(pin).toBeFocused();await pin.press("Enter");const link=page.locator("article[data-card-kind]").getByRole("link",{name:title,exact:true});await expect(link).toBeFocused();await link.press("Enter");
   }
   await expect(page.getByRole("heading",{name:title,exact:true})).toBeVisible();await page.getByRole("main").getByRole("link",{name:"Back to jobs",exact:true}).click();await expect(page).toHaveURL(app+board);
   await expect(page.getByRole("link",{name:width<1024?"All jobs":"Find work",exact:true})).toHaveAttribute("aria-current","page");
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expectNoA11yViolations(page);
   if(width<768){await expect(phone.getByRole("switch",{name:"Not available",exact:true})).not.toBeChecked();await phone.getByRole("link",{name:"List",exact:true}).click();}
   else await page.getByRole("tab",{name:"Grid",exact:true}).click();
   await expect(page).toHaveURL(app+board.replace("&layout=map",""));await expect(page.getByLabel("Sort by",{exact:true})).toHaveValue("newest");await expect(page.getByRole("link",{name:title,exact:true})).toBeVisible();
  }
  const noMap=process.env.PHONE_MAP_E2E_NO_MAP_URL;
  if(noMap){
   await page.setViewportSize({width:390,height:1000});await page.goto(noMap+board);await expect(phone.getByText("Map isn’t available right now.",{exact:true})).toBeVisible();await phone.locator(`a[data-card-id="${job}"]`).click();await expect(page.getByRole("heading",{name:title,exact:true})).toBeVisible();await page.getByRole("main").getByRole("link",{name:"Back to jobs",exact:true}).click();await expect(page).toHaveURL(noMap+board);await expectNoA11yViolations(page);
  }
  await page.setViewportSize({width:390,height:1000});await db.query("UPDATE worker_profiles SET paused_at=now() WHERE user_id=$1",[SECURITY_TRADIE.id]);
  try{await page.goto(app+board);await expect(phone.getByRole("switch",{name:"Not available",exact:true})).toBeDisabled();}finally{await db.query("UPDATE worker_profiles SET paused_at=NULL WHERE user_id=$1",[SECURITY_TRADIE.id]);}

 });
});
