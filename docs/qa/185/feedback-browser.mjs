import { chromium, expect } from '@playwright/test';
import { Client } from 'pg';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
const databaseURL=process.env.HELP_TEST_DATABASE_URL;
if(!databaseURL || !['127.0.0.1','localhost'].includes(new URL(databaseURL).hostname)) throw new Error('Use only the disposable localhost test database.');
const origin=process.env.HELP_QA_ORIGIN || 'http://127.0.0.1:3185';
const db=new Client({connectionString:databaseURL});await db.connect();
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try {
 const context=await browser.newContext();const page=await context.newPage();
 await page.goto(origin+'/help/when-do-i-pay');await page.locator('[data-help-ready=true]').waitFor();
 await page.getByRole('button',{name:'No',exact:true}).click();let key;
 await expect.poll(async()=>{
  const cookie=(await context.cookies()).find(c=>c.name==='trade-help-voter');if(!cookie)return 0;
  expect(cookie.httpOnly).toBe(true);expect(cookie.sameSite).toBe('Lax');
  key=createHash('sha256').update(cookie.value).digest('hex');
  return Number((await db.query('select count(*) from help_article_feedback where voter_key=$1',[key])).rows[0].count);
 }).toBe(1);
 await page.getByRole('textbox',{name:'What were you looking for?'}).fill('My invoice');await page.getByRole('button',{name:'Send feedback'}).click();
 await expect(page.getByRole('status').filter({hasText:'Thanks for your feedback.'})).toBeVisible();
 expect((await db.query('select helpful,looking_for from help_article_feedback where voter_key=$1',[key])).rows).toEqual([{helpful:false,looking_for:'My invoice'}]);
 await page.reload();await page.locator('[data-help-ready=true]').waitFor();await page.getByRole('button',{name:'Yes',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'Thanks for your feedback.'})).toBeVisible();
 expect((await db.query('select helpful,looking_for from help_article_feedback where voter_key=$1',[key])).rows).toEqual([{helpful:true,looking_for:null}]);
 const missing=await page.goto(origin+'/help/not-a-real-article');expect(missing.status()).toBe(404);
 await expect(page.getByRole('banner')).toHaveCount(1);await expect(page.getByRole('main')).toHaveCount(1);await expect(page.getByRole('contentinfo')).toHaveCount(1);
 await page.getByRole('main').getByRole('link',{name:'Help centre',exact:true}).click();await expect(page).toHaveURL(origin+'/help');
 const report={source:process.env.HELP_SOURCE_SHA || 'unrecorded',realBrowser:true,database:'disposable localhost PostgreSQL 17',checks:['No is recorded immediately','Optional note persists through the server action','Success is shown only after saving','HttpOnly/SameSite cookie survives reload','Changing a vote updates one row and clears the old note','Missing article returns HTTP 404 with one shell','404 Help centre action returns to Help'],passed:7};
 await fs.writeFile('docs/qa/185/feedback-browser.json',JSON.stringify(report,null,2)+'\n');console.log(report);
} finally {await browser.close();await db.end();}
