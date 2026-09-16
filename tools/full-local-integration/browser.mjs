// Real local browser + real local Read API backed by the 11001-market PostgreSQL fixture.
import {chromium} from '../../apps/web/node_modules/playwright-core/index.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const evidence=new URL(process.env.TG_CAPACITY_EVIDENCE_DIR??'../../docs/reviews/evidence/full-local-integration-2026-09-13/',import.meta.url),m=JSON.parse(readFileSync(new URL(process.env.TG_CAPACITY_API_META??'local-api.json',evidence)));
const origin='http://127.0.0.1:18771';
const report={scope:'real Chromium + local Hono API/PostgreSQL; synthetic market read model; no live wallet writes',routes:[],checks:[],errors:[],blockedExternal:[]};
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{for(const mobile of [false,true]){const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile});
 await context.route('**/*',route=>{const u=new URL(route.request().url());if(['127.0.0.1','localhost'].includes(u.hostname)||['data:','blob:'].includes(u.protocol))return route.continue();report.blockedExternal.push(u.origin);return route.abort()});
 await context.addInitScript(()=>{window.__perf={longTasks:[],lcp:0};new PerformanceObserver(l=>window.__perf.longTasks.push(...l.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});new PerformanceObserver(l=>{window.__perf.lcp=l.getEntries().at(-1)?.startTime??0}).observe({type:'largest-contentful-paint',buffered:true})});
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));let calls=[];page.on('response',async r=>{if(r.url().startsWith(m.origin)){calls.push({path:r.url().slice(m.origin.length),status:r.status()})}});
 for(const [name,path,selector]of [['home','/','.home-main'],['explore','/explore','.explore-page'],['trade',`/trade?marketId=${m.marketId}`,'.trade-live'],['pool',`/trade?marketId=${m.graduatedMarketId}`,'.trade-live'],['create','/create','[data-create-form]'],['stake','/stake','.staking-page'],['claim','/claim','.claim-page'],['stats','/stats','.stats-page'],['docs','/docs','body']]){
  calls=[];const t=Date.now();await page.goto(origin+path,{waitUntil:'domcontentloaded',timeout:90000});await page.locator(selector).waitFor({timeout:20000});await page.waitForTimeout(3500);
  const data=await page.evaluate(()=>({title:document.title,text:document.body.innerText.slice(0,14000),cards:document.querySelectorAll('[data-runtime-market]').length,domNodes:document.querySelectorAll('*').length,overflow:document.documentElement.scrollWidth>innerWidth+1,perf:window.__perf,memory:performance.memory?.usedJSHeapSize,resources:performance.getEntriesByType('resource').map(x=>({name:new URL(x.name).pathname,bytes:x.transferSize,duration:x.duration}))}));
  report.routes.push({name,mobile,elapsedMs:Date.now()-t,...data,requests:[...calls]});await page.screenshot({path:new URL(`browser-${mobile?'mobile':'desktop'}-${name}.png`,evidence).pathname,fullPage:false});
  if(name==='explore'){
   report.checks.push({name:`${mobile?'mobile':'desktop'} populated explore`,pass:data.cards>0,cards:data.cards});
   const next=page.locator('[data-stage-next="0"]');if(await next.count()){const before=await page.locator('[data-stage-grid="0"] [data-runtime-market]').first().getAttribute('data-runtime-market');await next.click();await page.waitForFunction(previous=>document.querySelector('[data-stage-grid="0"] [data-runtime-market]')?.getAttribute('data-runtime-market')!==previous,before,{timeout:15000});report.checks.push({name:'explore next page changes visible market',mobile,pass:before!==await page.locator('[data-stage-grid="0"] [data-runtime-market]').first().getAttribute('data-runtime-market')})}
  }
  if(name==='trade'){
   const tabs=page.locator('button').filter({hasText:/^1H$/});if(await tabs.count()){calls=[];await tabs.first().click();await page.waitForTimeout(1000);await page.locator('button').filter({hasText:/^12H$/}).first().click();await page.waitForTimeout(1200);report.checks.push({name:'chart range updates are scoped',mobile,requests:[...calls],pass:calls.some(x=>x.path.includes('/candles?')&&x.path.includes('interval=5m'))&&!calls.some(x=>/^\/v1\/(markets\?|config|protocol-statistics)/.test(x.path))})}
  }
 }
 await context.close()}
 report.blockedExternal=[...new Set(report.blockedExternal)];report.status=report.errors.length||report.checks.some(x=>!x.pass)?'issues_found':'passed';
}catch(e){report.fatal=e.stack;report.status='failed';process.exitCode=1}finally{await browser.close();writeFileSync(new URL('browser.json',evidence),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks,errors:report.errors,fatal:report.fatal}))}
