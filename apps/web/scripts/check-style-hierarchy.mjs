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
    const optional=page.locator('.optional-token-details');assert.equal(await optional.getAttribute('open'),null);
    await optional.locator('summary').click();await page.locator('#description').fill('Preserve my description');await optional.locator('summary').click();await optional.locator('summary').click();assert.equal(await page.locator('#description').inputValue(),'Preserve my description');
    assert.equal(await page.locator('.preview-key-facts [data-preview-graduation]').count(),1);
    await page.locator('#website').fill('invalid-url');await optional.locator('summary').click();await page.locator('#website').evaluate(input=>input.checkValidity());assert.equal(await optional.getAttribute('open'),'');await page.locator('#website').fill('');
    if(width===390){await page.locator('.mobile-summary-link').click();assert.equal(new URL(page.url()).hash,'#create-summary');await page.waitForTimeout(250);assert.equal(await page.locator('#description').inputValue(),'Preserve my description');}
   }
   if(route==='claim'){
    assert.equal(await page.locator('[data-creator-epoch]').isVisible(),false);
    assert.equal(await page.locator('#rewards-panel-creator [data-rewards-connect]').isVisible(),true);
    // Check both layouts; actual wallet lifecycle is covered by app-routing-lifecycle.
    await page.locator('.claim-page').evaluate(node=>node.dataset.walletConnected='true');
    assert.equal(await page.locator('[data-creator-epoch]').isVisible(),true);
    assert.equal(await page.evaluate(()=>Boolean(document.querySelector('[data-creator-epoch]').compareDocumentPosition(document.querySelector('.claim-action')) & Node.DOCUMENT_POSITION_FOLLOWING)),true);
   }
   if(route==='stake'){await page.locator('[data-stake-portfolio-empty][data-state=connect]').waitFor();assert.equal(await page.locator('[data-stake-my-markets]').isVisible(),false);}
   if(route==='stats'){assert.equal(await page.locator('.stats-heading [data-stats-refresh]').count(),1);assert.equal(await page.locator('.stat-card-primary').count(),2);}
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
