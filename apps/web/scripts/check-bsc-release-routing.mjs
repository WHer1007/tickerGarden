// Local cross-repository acceptance; no live RPC, credentials, wallets, or production mutations.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';
import {launchNotificationTarget,notifyLaunchDatabase} from '../src/v1/pendingMarket.ts';
import {EVM_GATEWAY_ORIGIN} from '../src/v1/evmTransport.ts';

const [gatewayRoot,output]=process.argv.slice(2);
if(!gatewayRoot||!output||!path.isAbsolute(gatewayRoot)||!path.isAbsolute(output))throw Error('Usage: node check-bsc-release-routing.mjs <absolute gateway source directory> <absolute evidence directory>');
const {createProductionGateway,parseProductionConfig}=await import(pathToFileURL(path.join(gatewayRoot,'src/vercel.mjs')).href);
fs.mkdirSync(output,{recursive:true});
const config={environment:'production',defaultChainId:4663,allowedOrigins:[],chains:{
 4663:{readApi:'https://read.rh.example/',content:'https://content.rh.example/',pipeline:'https://pipeline.rh.example/'},
 56:{readApi:'https://read.bsc.example/',content:'https://content.bsc.example/',pipeline:'https://pipeline.bsc.example/'},
}};
const upstream=[];
const hash='0x'+'a'.repeat(64),marketId='0x'+'b'.repeat(64);
const adapter=createProductionGateway(parseProductionConfig(JSON.stringify(config)),{'https://pipeline.bsc.example':{'x-tg-candidate-token':'test-only','x-vercel-protection-bypass':'test-only'}},{fetcher:async(url,init)=>{
 upstream.push({url:String(url),chainId:init.headers.get('x-chain-id'),hash:JSON.parse(await init.body.text()).transactionHash,privateAccess:init.headers.get('x-tg-candidate-token')==='test-only'});
 return Response.json({status:'confirmed',marketId});
}});
const clientEnvironment={VITE_BSC_PIPELINE_URL:EVM_GATEWAY_ORIGIN,VITE_V1_PIPELINE_URL:EVM_GATEWAY_ORIGIN};
for(const chainId of [56,4663,56])assert.equal(await notifyLaunchDatabase(hash,launchNotificationTarget(clientEnvironment,chainId),async(url,init)=>adapter(new Request(url,init))),true);
assert.deepEqual(upstream.map(x=>x.url),['https://pipeline.bsc.example/v1/launches','https://pipeline.rh.example/v1/launches','https://pipeline.bsc.example/v1/launches']);
assert.deepEqual(upstream.map(x=>x.privateAccess),[true,false,true]);
assert.ok(upstream.every(x=>x.hash===hash));

for(const key of Object.keys(process.env))if(key.startsWith('VITE_'))delete process.env[key];
const root=fileURLToPath(new URL('../',import.meta.url));
const server=await createServer({root,configFile:false,envDir:false,define:{'import.meta.env.VITE_BSC_USER_WRITES':JSON.stringify('approved')},server:{host:'127.0.0.1',port:0}});
let browser;
const checks=[];
try{
 await server.listen();const port=server.httpServer.address().port;
 browser=await chromium.launch({executablePath:process.env.TG_BROWSER_EXECUTABLE??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{const url=new URL(route.request().url());return url.hostname==='127.0.0.1'&&url.port===String(port)?route.continue():route.abort();});
  await page.goto(`http://127.0.0.1:${port}/create?chain=bsc`);
  const trigger=page.locator('[data-shell-header] [data-network-trigger]');await trigger.waitFor();
  assert.equal(await page.locator('[data-page-network]').count(),0);assert.equal(await page.locator('[data-shell-header] .wallet-icon').count(),1);
  await trigger.click();await page.locator('[data-network-panel]:visible').waitFor();
  assert.equal(await page.locator('[data-network="solana"]').isDisabled(),true);
  assert.equal(await page.locator('[data-network="bsc"]').getAttribute('aria-checked'),'true');
  assert.equal(await page.locator('[data-network="bsc"]').innerText(),'BNB Chain');
  assert.equal(await page.locator('[data-preview-launch-fee]').innerText(),'0.0005 BNB');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:path.join(output,`header-bsc-${width}.png`)});
  await page.keyboard.press('Escape');assert.equal(await trigger.getAttribute('aria-expanded'),'false');
  await trigger.click();await page.locator('[data-network="rh"]').click();await page.waitForURL('**/create?chain=rh');
  await page.locator('[data-network-trigger]').waitFor();await page.locator('[data-network-trigger]').click();
  assert.equal(await page.locator('[data-network="rh"]').getAttribute('aria-checked'),'true');
  assert.equal(await page.locator('[data-network-trigger] img').evaluate(e=>getComputedStyle(e).borderRadius),'50%');
  assert.equal(await page.locator('[data-preview-launch-fee]').innerText(),'0.0005 ETH');
  await page.screenshot({path:path.join(output,`header-rh-${width}.png`)});
  await page.keyboard.press('Escape');
  // Exercise the same switch guard without a real wallet or transaction.
  await page.evaluate(async()=>{const {bindNetworkSwitcher}=await import('/src/ui/network-switcher.ts');const fixture=document.createElement('div');fixture.id='guard-fixture';fixture.innerHTML='<button data-network-trigger>switch</button><div data-network-panel hidden><button data-network="rh" aria-checked="true">RH</button><button data-network="bsc" aria-checked="false">BSC</button></div>';document.body.append(fixture);bindNetworkSwitcher(fixture,()=>false);});
  const before=page.url();await page.locator('#guard-fixture [data-network-trigger]').click();await page.locator('#guard-fixture [data-network="bsc"]').click();assert.equal(page.url(),before);
  assert.deepEqual(errors,[]);checks.push({width,headerSwitcher:true,iconWallet:true,solanaDisabled:true,bscWritesLabel:true,roundRobinhoodIcon:true,switchGuard:true,noPageErrors:true});await page.close();
 }
 fs.writeFileSync(path.join(output,'acceptance.json'),JSON.stringify({status:'PASSED_LOCAL_ACCEPTANCE',liveNetwork:false,realWallet:false,upstream,browser:checks},null,2));
 console.log('PASS: frontend notification → gateway → isolated mock Pipelines; desktop/mobile selected header and network switching');
}finally{await browser?.close();await server.close();}
