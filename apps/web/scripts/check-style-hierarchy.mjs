// Isolated visual-state regression: no external network, real wallet, or transaction.
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';
for(const key of Object.keys(process.env))if(key.startsWith('VITE_'))delete process.env[key];
const server=await createServer({configFile:false,envDir:false,root:new URL('../',import.meta.url).pathname,server:{host:'127.0.0.1',port:0},plugins:[{name:'style-test-export',transform(code,id){if(id.endsWith('/src/app.ts'))return code+'\nexport {syncExploreStatus};';}}]});
await server.listen();const port=server.httpServer.address().port;
const browser=await chromium.launch({executablePath:process.env.TG_BROWSER_EXECUTABLE??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:900}});
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  for(const route of ['create','explore','stats','claim','stake']){
   await page.goto(`http://127.0.0.1:${port}/${route}`);await page.locator('main').waitFor();
   await page.waitForTimeout(150);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${route} horizontal overflow at ${width}`);
   if(route==='create'){
    assert.equal(await page.locator('.optional-token-details,.preview-settings,.mobile-summary-link').count(),0);
    await page.locator('#description').fill('Preserve my description');
    assert.equal(await page.locator('#description').isVisible(),true);
    assert.equal(await page.locator('.preview-list [data-preview-graduation]').count(),1);
    assert.equal(await page.locator('[data-preview-lp-fee]').isVisible(),true);
   }
   if(route==='claim'){
    assert.equal(await page.locator('[data-creator-epoch]').isVisible(),true);
    assert.equal(await page.locator('#rewards-panel-creator [data-rewards-connect]').isVisible(),true);
    assert.equal(await page.evaluate(()=>Boolean(document.querySelector('.claim-action').compareDocumentPosition(document.querySelector('[data-creator-epoch]')) & Node.DOCUMENT_POSITION_FOLLOWING)),true);
   }
   if(route==='stake'){
    await page.locator('[data-stake-portfolio-empty][data-state=connect]').waitFor();
    assert.equal(await page.locator('.stake-sidebar').isVisible(),true);
   }
   if(route==='stats'){
    assert.equal(await page.locator('.stats-heading [data-stats-refresh]').count(),0);
    assert.equal(await page.locator('[data-stats-refresh]').count(),0);
    assert.equal(await page.locator('.stat-card-primary').count(),0);
    assert.equal(await page.locator('[data-stat-fee-revenue]').count(),1);
   }
   if(route==='explore'){
    for(const state of ['loading','error','empty']){
     await page.evaluate(async state=>{document.querySelectorAll('[data-stage-grid]').forEach(grid=>grid.dataset.loadState=state);const app=await import('/src/app.ts');app.syncExploreStatus();},state);
     const status=await page.locator('[data-page-status]').innerText();
     assert.match(status,state==='loading'?/Loading/:state==='error'?/could not/:/No tokens/);
     assert.equal(await page.locator('[data-stage-empty]:visible').count(),0);
     assert.equal(await page.locator('[data-page-retry]:visible').count(),state==='error'?1:0);
    }
   }
  }
  await page.close();console.log(`PASS style hierarchy ${width}px`);
 }
}finally{await browser.close();await server.close();}
