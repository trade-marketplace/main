import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
const pass = process.argv[2] || 'pass-1';
const out = `output/playwright/issue-180/${pass}`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/Users/matthewlarsen/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' });
const page = await browser.newPage({ reducedMotion: 'reduce' });
const counts = [];
const states = ['default','unread','read','empty','loading','error','offline','saving','expired','many','page-2','long'];
for (const width of [1440,390]) {
 const height = width === 390 ? 844 : 900;
 await page.setViewportSize({width,height});
 for (const mode of ['customer','trade']) for (const state of states) {
  const params = new URLSearchParams({ mode, state: state === 'unread' ? 'default' : state === 'page-2' ? 'many' : state });
  if(state === 'unread') params.set('filter','unread');
  if(state === 'page-2') params.set('page','2');
  await page.goto(`http://127.0.0.1:3180/dev/components/notifications-page?${params}`);
  await page.getByRole('heading',{name:'Notifications',exact:true}).waitFor();
  await page.evaluate(()=>document.fonts.ready);
  await page.addStyleTag({content:'nextjs-portal { display:none; }'});
  if(state === 'loading') await page.locator('.tm-skel').first().waitFor({state:'visible'}).then(()=>page.waitForFunction(()=>getComputedStyle(document.querySelector('.tm-skel')).opacity==='1'));
  if(state === 'saving' || state === 'expired') {
   await page.getByRole('button',{name:'Mark all read',exact:true}).click();
   if(state === 'expired') await page.getByRole('dialog').waitFor();
  }
  await page.screenshot({path:`${out}/${mode}-${state}-${width}.png`});
  const words = await page.evaluate(()=>{
   const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
   const words=[];
   while(walker.nextNode()) { const n=walker.currentNode;const el=n.parentElement;if(!el || el.closest('[aria-hidden=true],.material-symbols-rounded,nextjs-portal,[role=status]')) continue;const c=getComputedStyle(el);if(c.display==='none'||c.visibility==='hidden'||c.opacity==='0'||c.fontFamily.includes('Material Symbols')) continue; const r=document.createRange();r.selectNodeContents(n);const b=r.getBoundingClientRect();if(b.width<=1||b.height<=1)continue;const t=n.textContent.trim();if(t) words.push(t); }
   const logos=[...document.querySelectorAll('[role=img][aria-label="Trade Marketplace"]')].filter(el=>el.getBoundingClientRect().width>1);
   words.push(...logos.map(()=> 'Trade Marketplace'));
   return words.join(' ');
  });
  counts.push({mode,state,width,words:words.split(/\s+/).filter(Boolean).length,text:words});
 }
}
await writeFile(`${out}/word-counts.json`,JSON.stringify(counts,null,2));
await browser.close();
console.log(`${pass}: captured ${counts.length} state/role/size views`);
