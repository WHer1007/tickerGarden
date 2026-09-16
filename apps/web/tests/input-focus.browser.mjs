import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE??'playwright');
const browser=await chromium.launch({headless:true,channel:'chrome'});
try{
 const page=await browser.newPage();
 // Check the real page templates/CSS without starting wallet, indexer or RPC work.
 await page.route('**/src/app.ts',route=>route.abort());
 await page.goto('http://127.0.0.1:5178/',{waitUntil:'networkidle'});
 let count=0;
 for(const name of ['home','markets','create','trade','staking','rewards','stats','docs']){
  const result=await page.evaluate(async name=>{
   const template=(await import(`/src/pages/${name}.ts`)).default;
   document.querySelector('[data-route-outlet]').innerHTML=template.html;
   const inputs=[...document.querySelectorAll('input,textarea,select')];const failures=[];
   for(const input of inputs){
    input.disabled=false;input.removeAttribute('aria-invalid');
    for(let parent=input;parent;parent=parent.parentElement){parent.hidden=false;if(parent instanceof HTMLDialogElement&&!parent.open)parent.showModal();}
    input.focus();
    const style=getComputedStyle(input);
    if(style.outlineStyle!=='none'||style.boxShadow!=='none')failures.push({input:input.outerHTML.slice(0,150),outline:style.outline,shadow:style.boxShadow});
    for(let parent=input.parentElement;parent&&parent!==document.body;parent=parent.parentElement){
     const style=getComputedStyle(parent);
     if(style.outlineStyle!=='none'&&parseFloat(style.outlineWidth)>0)failures.push({wrapper:parent.className,outline:style.outline});
    }
    input.blur();
   }
   return {count:inputs.length,failures};
  },name);
  assert.deepEqual(result.failures,[],`${name} input focus rings`);count+=result.count;
 }
 console.log(`Verified ${count} inputs, textareas and selects across 8 page templates, including dialog controls and focus-within wrappers.`);
 // Reproduce the specificity bug explicitly, including tabindex and dynamic recovery inputs.
 await page.evaluate(()=>{document.querySelector('[data-route-outlet]').innerHTML='<div class="runtime-recovery"><input tabindex="0"></div>';});
 const input=page.locator('.runtime-recovery input');await input.focus();
 assert.equal(await input.evaluate(el=>getComputedStyle(el).outlineStyle),'none');
 await input.evaluate(el=>el.setAttribute('aria-invalid','true'));
 assert.equal(await input.evaluate(el=>getComputedStyle(el).outlineColor),'rgb(180, 35, 24)');
 console.log('Dynamic inputs have no focus ring; red validation indicators remain intact.');
}finally{await browser.close();}
