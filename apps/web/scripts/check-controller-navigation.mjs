import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const base=process.argv[2]??'http://127.0.0.1:4188';
const browser=await chromium.launch({executablePath:process.env.TG_BROWSER_EXECUTABLE??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
 for(const target of ['create','trade']) {
  const context=await browser.newContext();const page=await context.newPage();const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  let release;const blocked=new Promise(resolve=>{release=resolve;});let started;
  const requested=new Promise(resolve=>{started=resolve;});
  await page.route(`**/assets/${target}-controller-*.js`,async route=>{started();await blocked;await route.continue();});
  await page.goto(base+'/explore');await page.locator('main').waitFor();
  const navigate=href=>page.evaluate(href=>{const a=document.createElement('a');a.href=href;document.body.append(a);a.click();a.remove();},href);
  await navigate('/'+target);await requested;
  await navigate('/stats');await page.waitForFunction(()=>document.body.dataset.page==='stats'&&!!document.querySelector('main'));
  release();await page.waitForTimeout(300);
  assert.equal(await page.evaluate(()=>document.body.dataset.page),'stats');
  assert.match(await page.title(),/Stats/i);
  await navigate('/'+target);await page.waitForFunction(target=>document.body.dataset.page===target&&!!document.querySelector('main'),target);
  assert.deepEqual(errors,[]);
  await context.close();
 }
 console.log('PASS: delayed Create/Trade loads cannot replace newer routes; revisiting mounts correctly');
} finally {await browser.close();}
