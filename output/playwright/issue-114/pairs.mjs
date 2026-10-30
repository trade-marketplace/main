import sharp from 'sharp';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const folder=fileURLToPath(new URL('.',import.meta.url));
async function pair(left,right,width,path) {
 const height=width===1440?900:844;
 const inputs=[];
 for(const [index,name] of [left,right].entries()) {
  const source=sharp(`${folder}${name}`);
  const size=await source.metadata();
  if(size.width!==width||size.height<height)throw new Error(`Unexpected viewport: ${name}`);
  inputs.push({input:await source.extract({left:0,top:0,width,height}).toBuffer(),left:index*width,top:0});
 }
 // Preserve original pixels; crop full-page baselines to equal viewports.
 await sharp({create:{width:width*2,height,channels:3,background:'white'}}).composite(inputs).png().toFile(`${folder}${path}`);
}
for(const width of [1440,390])for(const mode of ['customer','trade'])for(const state of ['default','empty','loading','error','offline','saving','saved','save-error','expired']) {
 await pair(`mockup-${width}.png`,`${mode}-${state}-${width}.png`,width,`pair-${mode}-${state}-${width}.png`);
}
for(const name of await readdir(folder)) {
 const match=name.match(/^security-(customer|trade)-(.+)-(1440|390)\.png$/);
 if(!match||name.endsWith('-full.png'))continue;
 const width=Number(match[3]);
 await pair(`mockup-${width}.png`,name,width,`pair-${name}`);
}
for(const width of [1440,390])for(const mode of ['customer','trade']) {
 await pair(`security-before-${mode}-${width}.png`,`security-${mode}-default-${width}.png`,width,`pair-security-regression-${mode}-${width}.png`);
}
