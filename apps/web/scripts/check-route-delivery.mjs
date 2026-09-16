// Built-site checks with external traffic blocked; never connects a wallet.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {legacyRedirects} from '../security/legacy-redirects.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const port=4189,base=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['security/serve.mjs'],{cwd:root,env:{...process.env,PORT:String(port),HOST:'127.0.0.1'},stdio:'pipe'});
let browser;
try{
 for(let i=0;i<60;i++){try{await fetch(base);break;}catch{await new Promise(r=>setTimeout(r,100));}}
 for(const [from,to]of Object.entries(legacyRedirects)){const r=await fetch(base+from+'?probe=1',{redirect:'manual'});assert.equal(r.status,308);assert.equal(r.headers.get('location'),to+'?probe=1');}
 browser=await chromium.launch({executablePath:process.env.TG_BROWSER_EXECUTABLE??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const context=await browser.newContext();await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
 const page=await context.newPage();const requests=[];page.on('request',r=>requests.push(new URL(r.url()).pathname));
 await page.goto(base);await page.locator('.home-hero').waitFor();
 assert.ok(!requests.some(p=>/\/assets\/(app|chain)-/.test(p)), 'home must not load financial runtime');
 assert.equal(await page.locator('meta[name="theme-color"]').getAttribute('content'),'#f8f7f4');
 await page.locator('.home-button.primary').click();await page.locator('.explore-page').waitFor();
 await page.locator('footer a[href="/docs#docs-risks"]').click();await page.locator('#docs-risks').waitFor();
 await page.waitForFunction(()=>{const r=document.querySelector('#docs-risks')?.getBoundingClientRect();return r&&r.top>=0&&r.top<innerHeight;});
 assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'),'https://tickergarden.com/docs');
 const manifest=JSON.parse(fs.readFileSync(root+'dist/.vite/manifest.json','utf8'));
 const stats=manifest['src/controllers/stats.ts'].file;
 await page.route(`**/${stats}`,r=>r.abort());
 await page.locator('header nav a[href="/stats"]').click();await page.locator('[data-route-retry]').waitFor();
 assert.match(await page.locator('[role="alert"]').innerText(),/check your wallet history/);
 await page.unroute(`**/${stats}`);await page.locator('[data-route-retry]').click();await page.locator('.stats-page').waitFor();
 for(const path of ['docs','privacy','terms']){const html=await (await fetch(base+'/'+path)).text();assert.equal((html.match(/name="description"/g)||[]).length,1);assert.ok(html.includes(`https://tickergarden.com/${path}`));}
 console.log('PASS: legacy redirects, lightweight home, Docs anchor, lazy-load failure/retry, prerender metadata');
}catch(error){throw error;}finally{await browser?.close();server.kill();}
