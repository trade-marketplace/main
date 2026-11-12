import {expect,test} from "@playwright/test";
import {expectNoA11yViolations} from "./support/a11y";
import {VIEWPORTS} from "./support/viewports";

const preview=process.env.POSTED_PREVIEW_E2E_URL||"http://127.0.0.1:3101";
for(const viewport of VIEWPORTS)test(`mixed quote history stays plain and accessible at ${viewport.width}px`,async({page})=>{
 await page.setViewportSize(viewport);await page.goto(preview+"/dev/components/my-work?state=quotes-mixed");
 await expect(page.getByRole("tab",{name:"Quotes (5)",exact:true})).toHaveAttribute("aria-selected","true");
 const table=page.getByRole("table",{name:"My quotes",exact:true});await expect(table).toBeVisible();
 for(const title of["New socket","Kitchen tap"]){
  const row=table.getByRole("row").filter({hasText:title});await expect(row).toBeVisible();await expect(row.getByRole("link")).toHaveCount(0);
  await expect(row.locator('a,button,input,select,textarea,[tabindex]:not([tabindex="-1"])')).toHaveCount(0);
  const colors=()=>row.evaluate(element=>[element,...element.querySelectorAll("td")].map(item=>getComputedStyle(item).backgroundColor));
  await page.mouse.move(0,0);const before=await colors();await row.hover();await expect.poll(colors).toEqual(before);
  expect(await row.evaluate(element=>getComputedStyle(element).cursor)).not.toBe("pointer");const url=page.url();await row.click();expect(page.url()).toBe(url);
 }
 await expect(table.getByRole("row").filter({hasText:"New socket"})).toContainText("Priced");await expect(table.getByRole("row").filter({hasText:"Kitchen tap"})).toContainText("Not taken");
 await page.getByRole("tab",{name:"Quotes (5)",exact:true}).focus();const expected=["Outdoor lights","Sub wiring","Garden fence"],visited:string[]=[];
 for(let step=0;step<12&&visited.length<expected.length;step++){
  await page.keyboard.press("Tab");for(const title of["New socket","Kitchen tap"])expect(await table.getByRole("row").filter({hasText:title}).evaluate(element=>element.contains(document.activeElement))).toBe(false);
  const title=await page.evaluate(()=>document.activeElement?.textContent?.trim()??"");if(!expected.includes(title))continue;
  expect(title).toBe(expected[visited.length]);visited.push(title);const link=table.getByRole("link",{name:title,exact:true});await expect(link).toBeFocused();await expect(link).toHaveAttribute("href",/from=%2Fdashboard%3Ftab%3Dquotes$/);expect(await link.evaluate(element=>getComputedStyle(element).outlineStyle)).not.toBe("none");
 }
 expect(visited).toEqual(expected);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expectNoA11yViolations(page);
});
