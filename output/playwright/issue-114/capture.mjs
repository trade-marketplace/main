import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const folder=fileURLToPath(new URL('.',import.meta.url));
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const states=['default','empty','loading','error','offline','saving','saved','save-error','expired'];
const counts=[];
const securityCounts=[];
async function visibleWords(page) {
  return page.evaluate(()=>{
    const hidden=el=>{for(let p=el;p;p=p.parentElement){const s=getComputedStyle(p);if((p.tagName==='DETAILS'&&!p.open&&!el.closest('summary'))||s.display==='none'||s.visibility==='hidden'||s.opacity==='0'||s.clipPath==='inset(50%)'||s.clip!=='auto')return true;}return false;};
    const strings=[]; const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()){
      const n=walker.currentNode, p=n.parentElement;
      if(!p || ['SCRIPT','STYLE'].includes(p.tagName)||hidden(p)||getComputedStyle(p).fontFamily.includes('Material Symbols'))continue;
      const range=document.createRange();range.selectNodeContents(n); const box=range.getBoundingClientRect();
      if(box.bottom<=0||box.right<=0||box.width<2||box.height<2||!n.textContent.trim())continue;
      strings.push(n.textContent.trim());
    }
    for(const el of document.querySelectorAll('td[data-field]')){const s=getComputedStyle(el,'::before');if(s.content&&s.content!=='none'&&!hidden(el)) strings.push(s.content.replaceAll('"',''));}
    const text=strings.join(' '); return {count:(text.match(/[\p{L}\p{N}]+(?:[’'][\p{L}\p{N}]+)*/gu)||[]).length+2,text};
  });
}
for (const width of [1440,390]) {
 const height=width===1440?900:844;
 const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'});
 const page=await context.newPage();
 for(const mode of ['customer','trade']) for(const state of states) {
  await page.goto(`http://127.0.0.1:3314/dev/components/notification-preferences?state=${state}&mode=${mode}`);
  await page.getByRole('heading',{name:'Notifications',exact:true}).waitFor();
  await page.evaluate(()=>document.fonts.ready);
  if(state==='saved') await page.getByRole('button',{name:'Undo',exact:true}).waitFor();
  if(state==='saving') await page.getByRole('checkbox',{name:mode==='customer'?'Email: Your price is ready':'Email: New job',exact:true}).waitFor();
  if(state==='save-error') await page.getByText('Couldn’t save.',{exact:true}).first().waitFor();
  if(state==='expired') await page.getByText('Log in to save.',{exact:true}).first().waitFor();
  if(state==='loading') await page.locator('[aria-busy=true]').waitFor();
  const name=`${mode}-${state}-${width}`;
  await page.screenshot({path:`${folder}${name}.png`,animations:'disabled'});
  await page.screenshot({path:`${folder}${name}-full.png`,fullPage:true,animations:'disabled'});
  const words=await visibleWords(page);
  counts.push({mode,state,width,...words});
 }
 for(const mode of ['customer','trade']) for(const state of (mode==='customer'?['default','wrong','success','unavailable','loading','limited','invalid-link','pending-email','partial','expired','offline','pending','access-errors']:['default'])) {
  await page.goto(`http://127.0.0.1:3314/dev/components/security?state=${state}&mode=${mode}`);
  await page.getByRole('heading',{name:'Security',exact:true}).waitFor();
  await page.evaluate(()=>document.fonts.ready);
  const name=`security-${mode}-${state}-${width}`;
  await page.screenshot({path:`${folder}${name}.png`,animations:'disabled'});
  await page.screenshot({path:`${folder}${name}-full.png`,fullPage:true,animations:'disabled'});
  securityCounts.push({mode,state,width,...await visibleWords(page)});
 }
 await context.close();
}
await writeFile(`${folder}word-counts.json`,JSON.stringify(counts,null,2));
await writeFile(`${folder}security-word-counts.json`,JSON.stringify(securityCounts,null,2));
await browser.close();
