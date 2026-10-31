// Run from the repository root against its built app. All captures wait for hydration, fonts and the named UI.
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import sharp from 'sharp';
const root='docs/qa/185';
const pass=process.env.HELP_QA_PASS || 'pass-1';
const origin=process.env.HELP_QA_ORIGIN || 'http://127.0.0.1:3185';
const directory=path.join(root,pass);await fs.mkdir(directory,{recursive:true});
await sharp(path.join(root,'mockup-1440.png')).extract({left:0,top:40,width:1440,height:960}).toFile(path.join(root,'reference-1440.png'));
await sharp(path.join(root,'mockup-390.png')).extract({left:0,top:44,width:390,height:800}).toFile(path.join(root,'reference-390.png'));
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const states=[['home','/help'],['search-results','/help?state=search-results'],['suggestions','/help?q=pay'],['no-results','/help?state=no-results'],['loading','/help?state=loading'],['error','/help?state=error'],['article','/help/when-do-i-pay'],['helpful-voted','/help/when-do-i-pay?state=helpful-voted'],['not-helpful','/help/when-do-i-pay?state=not-helpful'],['feedback-error','/help/when-do-i-pay?state=feedback-error']];
const counts=[];
for(const width of [1440,390]){
 const height=width===1440?960:800;
 const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
 for(const [state,route] of states){
  await page.goto(origin+route);await page.locator('[data-help-ready=true]').waitFor();
  await page.evaluate(()=>document.fonts.ready);
  // Hydration is confirmed by the search event handler, without changing the captured state.
  await page.getByRole('combobox').focus();if(state!=='suggestions'){await page.getByRole('combobox').press('Escape');await page.mouse.click(width-4,54);}
  await page.evaluate(()=>scrollTo(0,0));
  if(state==='no-results') await page.getByRole('heading',{name:'No articles found',exact:true}).waitFor();
  if(state==='loading') await page.locator('[aria-busy=true]').waitFor();
  if(state==='helpful-voted') await page.getByRole('status').filter({hasText:'Thanks for your feedback.'}).waitFor();
  if(state==='not-helpful') await page.getByLabel('What were you looking for?').waitFor();
  if(state==='feedback-error') await page.getByText('Couldn’t save your feedback. Try again.').first().waitFor();
  await page.screenshot({path:path.join(directory,`${state}-${width}.png`),animations:'disabled'});
  await page.screenshot({path:path.join(directory,`${state}-${width}-full.png`),fullPage:true,animations:'disabled'});
  const words=await page.evaluate(()=>{
   const words=[];const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node;
   while((node=walker.nextNode())){
    const parent=node.parentElement;if(!parent||parent.closest('[aria-hidden=true],[inert],script,style'))continue;
    let visible=true;for(let el=parent;el;el=el.parentElement){const css=getComputedStyle(el);if(css.display==='none'||css.visibility==='hidden'||Number(css.opacity)===0){visible=false;break;}}
    if(!visible)continue;const range=document.createRange();range.selectNode(node);const rect=range.getBoundingClientRect();if(rect.width<=1||rect.height<=1)continue;
    words.push(node.textContent.trim());
   }
   for(const input of document.querySelectorAll('input:not([type=hidden]),textarea')){
    const rect=input.getBoundingClientRect();if(rect.width<=1||rect.height<=1||input.closest('[inert],[hidden],[aria-hidden=true]'))continue;
    let visible=true;for(let el=input;el;el=el.parentElement){const css=getComputedStyle(el);if(css.display==='none'||css.visibility==='hidden'||Number(css.opacity)===0){visible=false;break;}}
    if(visible)words.push(input.value||input.getAttribute('placeholder')||'');
   }
   return {text:words.join(' ').replace(/\s+/g,' '),overflow:document.documentElement.scrollWidth-innerWidth};
  });
  counts.push({state,width,words:(words.text.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu)||[]).length,...words});
  await sharp({create:{width:width*2,height,channels:3,background:'white'}}).composite([{input:path.join(root,`reference-${width}.png`),left:0,top:0},{input:path.join(directory,`${state}-${width}.png`),left:width,top:0}]).png().toFile(path.join(directory,`pair-${state}-${width}.png`));
 }
 await page.close();
}
await fs.writeFile(path.join(directory,'word-counts.json'),JSON.stringify(counts,null,2)+'\n');
console.log(JSON.stringify(counts.map(({state,width,words,overflow})=>({state,width,words,overflow})),null,2));
await browser.close();
