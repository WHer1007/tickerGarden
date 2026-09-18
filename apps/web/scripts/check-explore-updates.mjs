// Isolated real-app regression. No live API, RPC, wallet or external network.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';
for(const key of Object.keys(process.env))if(key.startsWith('VITE_'))delete process.env[key];
const api='https://explore.test.invalid';
const server=await createServer({configFile:false,envDir:false,root:fileURLToPath(new URL('../',import.meta.url)),define:{'import.meta.env.VITE_V1_READ_API_URL':JSON.stringify(api),'import.meta.env.VITE_V1_CHAIN_ID':'"46630"'},server:{host:'127.0.0.1',port:0}});
const h=n=>`0x${n.toString(16).padStart(64,'0')}`,a=n=>`0x${n.toString(16).padStart(40,'0')}`;
const sync={chainId:46630,status:'synced',finality:'head',blockNumber:'10',blockHash:h(10),headBlockNumber:'10',headBlockHash:h(10),revision:`10:${h(10)}`,lagBlocks:'0'};
const config={kind:'quote',id:h(100),values:{graduationThreshold:'1000',quoteAsset:a(0),quoteDecimals:18}};
const market=n=>({marketId:h(n),memeToken:a(n),quoteAsset:a(0),assetUid:h(999),quoteAssetConfigId:h(100),sourceVersion:1,launchPhase:0,curveProgress:{realQuoteReserve:'200'},source:{chainId:46630,blockNumber:'10',blockHash:h(10)},identity:{name:`Seed ${n}`,symbol:`S${n}`,deployedAt:'1000',metadataURI:''},content:{imageURI:null,description:'',website:null,x:null},metrics:{marketCapUsd:String(n*100),volume24hUsd:'20',asOfTimestamp:'1000'}});
let items=[market(1),market(2)],cardReads=[],listReads=0,browser;
try{
 await server.listen();const address=server.httpServer.address(),base=`http://127.0.0.1:${address.port}`;
 browser=await chromium.launch({executablePath:process.env.TG_BROWSER_EXECUTABLE??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const page=await browser.newPage();const failures=[],forbidden=[];
 page.on('pageerror',e=>failures.push(e.message));
 await page.addInitScript(()=>{
  window.__streams=[];
  window.EventSource=class extends EventTarget{constructor(url){super();this.url=String(url);window.__streams.push(this);setTimeout(()=>this.dispatchEvent(new MessageEvent('ready',{data:'{}'})),0);}close(){this.closed=true;}};
 });
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.origin===base)return route.continue();
  if(url.origin!==api){forbidden.push(url.origin+url.pathname);return route.abort();}
  const json=body=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  if(url.pathname==='/v1/explore/bootstrap')return json({displayOnly:true,configs:[config],sync});
  if(url.pathname==='/v1/explore'){listReads++;return json({items:items.filter(m=>String(m.launchPhase)===url.searchParams.get('launchPhase')),sync,nextCursor:null});}
  if(url.pathname==='/v1/explore/cards'){const ids=url.searchParams.get('markets').split(',');cardReads.push(ids);return json({chainId:46630,displayOnly:true,items:items.filter(m=>ids.includes(m.marketId))});}
  if(url.pathname==='/v1/statistics-prices'||url.pathname==='/v1/prices/references')return json({chainId:46630,displayOnly:true,prices:{},expiresAt:null,items:[]});
  forbidden.push(url.pathname);return route.fulfill({status:503,body:'disabled'});
 });
 await page.goto(base+'/explore');
 const card=id=>page.locator(`[data-runtime-market="${id}"]`);
 await card(h(2)).waitFor();await page.waitForTimeout(450);
 assert.match(await card(h(1)).locator('[data-market-cap]').innerText(),/100/);
 assert.equal(await card(h(1)).locator('progress').getAttribute('value'),'20');
 // A single market hint must not fetch unrelated cards or wait for new global sync.
 cardReads=[];const beforeLists=listReads;
 items[0]={...items[0],metrics:{...items[0].metrics,marketCapUsd:'321'},curveProgress:{realQuoteReserve:'750'}};
 await page.evaluate(id=>window.__streams.at(-1).dispatchEvent(new MessageEvent('change',{data:JSON.stringify({marketId:id,regions:['statistics'],revision:'11'})})),h(1));
 await page.waitForFunction(id=>document.querySelector(`[data-runtime-market="${id}"] [data-market-cap]`)?.textContent?.includes('321'),h(1));
 assert.equal(await card(h(1)).locator('progress').getAttribute('value'),'75');
 assert.ok(cardReads.length>0&&cardReads.every(ids=>ids.length===1&&ids[0]===h(1)),JSON.stringify(cardReads));assert.equal(listReads,beforeLists);
 // Creation enters the default list through hints, without changing sync/revision.
 items.unshift(market(3));
 await page.evaluate(id=>window.__streams.at(-1).dispatchEvent(new MessageEvent('change',{data:JSON.stringify({marketId:id,regions:['market','trades']})})),h(3));
 await card(h(3)).waitFor();
 // Reorg removes only the absent stored card.
 items=items.filter(m=>m.marketId!==h(1));
 await page.evaluate(id=>window.__streams.at(-1).dispatchEvent(new MessageEvent('change',{data:JSON.stringify({marketId:id,regions:['market','statistics']})})),h(1));
 await card(h(1)).waitFor({state:'detached'});assert.equal(await card(h(2)).count(),1);
 await page.evaluate(()=>window.dispatchEvent(new Event('offline')));
 assert.equal(await card(h(2)).count(),1,'offline retains loaded cards');
 await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 assert.deepEqual(forbidden,[]);assert.deepEqual(failures,[]);
 assert.equal(await page.evaluate(()=>window.__streams.filter(s=>!s.closed).length),1);
 console.log('PASS: Explore no health/RPC wait, old stored metrics retained, scoped event updates, Bloom progress, new creation and reorg removal; one stream.');
}finally{await browser?.close();await server.close();}
