import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('../../../',import.meta.url)));
await mkdir('outputs',{recursive:true});
const baseURL=process.argv[2]??'http://127.0.0.1:4173';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});const results=[];
for(const width of [390,1440])for(const route of ['/','/docs','/privacy','/explore','/stats','/create','/claim','/stake','/trade']){
 const context=await browser.newContext({viewport:{width,height:900}});const page=await context.newPage();const requests=[];const errors=[];page.on('request',r=>requests.push(r.url()));page.on('pageerror',e=>errors.push(e.message));
 await page.goto(baseURL+route);await page.waitForTimeout(500);
 assert.equal(await page.locator('main').count(),1,route);assert.deepEqual(errors,[],route);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,route+' overflow');
 if(['/docs','/privacy'].includes(route))assert.equal(requests.some(u=>/\/assets\/(app-|chain-)|\/v1\//.test(u)),false,'static route downloaded runtime');
 if(!['/create'].includes(route))assert.equal(requests.some(u=>u.includes('/assets/create-controller-')),false,route+' eagerly downloaded Create controller');
 if(route!=='/trade')assert.equal(requests.some(u=>u.includes('/assets/trade-controller-')),false,route+' eagerly downloaded Trade controller');
 if(route==='/create'||route==='/trade')assert.ok(requests.some(u=>u.includes(`/assets/${route.slice(1)}-controller-`)),route+' controller missing');
 const resources=await page.evaluate(()=>performance.getEntriesByType('resource').map(r=>({url:r.name,bytes:r.decodedBodySize})));
 const canvasBytes=await page.evaluate(()=>[...document.querySelectorAll('canvas')].reduce((a,c)=>a+c.width*c.height*4,0));
 if(route==='/'||route==='/docs')await page.screenshot({path:`outputs/frontend-opt-${width}-${route==='/'?'home':'docs'}.png`,fullPage:true});
 if(route==='/docs'){await page.locator('[data-docs-search]').fill('zzzznotfound');assert.equal(await page.locator('[data-docs-empty]').isVisible(),true);await page.locator('[data-docs-search]').fill('');await page.locator('[data-wallet]').click();await page.locator('.wallet-dialog').waitFor({state:'visible'});}
 results.push({route,width,resources,canvasBytes});await context.close();
}
await browser.close();await writeFile('outputs/frontend-opt-measurements.json',JSON.stringify(results,null,2));console.log('PASS: 18 route/viewport checks, controller request isolation, static request isolation, search, no overflow/errors');
