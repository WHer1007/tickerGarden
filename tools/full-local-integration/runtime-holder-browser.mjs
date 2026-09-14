import {chromium} from '../../apps/web/node_modules/playwright-core/index.mjs';
import {writeFileSync,readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const dir=new URL(process.env.TG_CAPACITY_EVIDENCE_DIR??'../../docs/reviews/evidence/runtime-optimization-2026-09-14/',import.meta.url);
const meta=JSON.parse(readFileSync(new URL('current-api.json',dir)));
assert.equal(meta.origin,'http://127.0.0.1:18772');
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const errors=[],requests=[];let page;
try{
 page=await browser.newPage({viewport:{width:1000,height:800}});
 await page.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(!['127.0.0.1','localhost'].includes(url.hostname))return route.abort();
  return route.continue();
 });
 page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{if(request.url().startsWith(meta.origin))requests.push(request.url());});
 await page.goto('http://127.0.0.1:18771/tests/browser/runtime-holders.html');
 await page.evaluate(async origin=>{
  const {mountGlobalHolders}=await import('/src/v1/globalHoldersWidget.ts');
  window.widget=mountGlobalHolders(document.querySelector('#widget'),origin,46630,document.querySelector('#count'));
 },meta.origin);
 await page.waitForFunction(()=>document.querySelector('#widget [role="status"]')?.textContent?.includes('21500 markets'),{},{timeout:15000});
 assert.equal(await page.locator('#count').textContent(),'21601');
 assert.equal(requests.filter(url=>new URL(url).pathname==='/v1/stats/holders').length,1);
 await page.screenshot({path:new URL('holder-widget-desktop.png',dir).pathname});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:new URL('holder-widget-mobile.png',dir).pathname});
 await page.evaluate(()=>window.widget.stop());assert.equal(await page.locator('#count').textContent(),'-');
 assert.deepEqual(errors,[]);
 writeFileSync(new URL('holder-browser.json',dir),JSON.stringify({pass:true,marketCount:21500,holderCount:21601,requests,errors,checks:['real local API','21500-market frontend validation','one component request','stop clears stale summary','desktop and mobile captures']},null,2)+'\n');
}catch(error){writeFileSync(new URL('holder-browser-failure.json',dir),JSON.stringify({error:error.message,errors,requests,body:await page?.locator('body').innerText()},null,2));throw error;}finally{await browser.close();}
