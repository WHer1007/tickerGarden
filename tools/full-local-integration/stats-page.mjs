import {publishProtocolStatistics} from '../../services/backend-ts/packages/statistics-store/src/snapshot.ts';
import {publishMarketCapRanking} from '../../services/backend-ts/packages/display-price/src/ranking.ts';
// Real Hono/PostgreSQL Explore integration with isolated synthetic market data.
// Requires a dedicated loopback test database. Never seeds a hosted environment.
import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {createServer as createViteServer} from '../../apps/web/node_modules/vite/dist/node/index.js';
import {chromium} from '../../apps/web/node_modules/playwright-core/index.mjs';
import {applyCoreMigration,createDatabasePool} from '../../services/backend-ts/packages/db/src/index.ts';
import {createReadApiApp} from '../../services/backend-ts/apps/read-api/src/index.ts';
import {CURRENT_RELEASE_ID,f72EventCatalog} from '../../services/backend-ts/packages/events/src/index.ts';
import {f72BootstrapConfigs} from '../../services/backend-ts/packages/config-projector/src/f72-bootstrap.generated.ts';
const db=process.env.TG_TEST_DATABASE_URL;assert.ok(db&&['127.0.0.1','localhost'].includes(new URL(db).hostname),'Dedicated loopback TG_TEST_DATABASE_URL required');
const schemaName=`tg_stats_browser_${randomBytes(4).toString('hex')}`,s=`"${schemaName}"`,{pool}=createDatabasePool(db);
const h=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),a=n=>'0x'+BigInt(n).toString(16).padStart(40,'0');
const hash=h(900000),revision=`4:${hash}`,now=Math.floor(Date.now()/1000);
const deployment={environment:'test',chainId:46630,deploymentDigest:CURRENT_RELEASE_ID,activationBlock:1n},id=['test',46630,CURRENT_RELEASE_ID];
const quote=f72BootstrapConfigs.find(x=>x.kind==='quote'&&x.values.quoteAsset===a(0)),baseline=f72BootstrapConfigs.find(x=>x.kind==='baseline');
const stock={kind:'asset',id:h(42),status:1,values:{stockToken:a(42),tokenDecimals:18,tokenSymbol:'AAA',userStockVault:a(43),minimumAllocation:'500000000000000000'}};
const stock2={...stock,id:h(44),values:{...stock.values,stockToken:a(44),tokenSymbol:'BBB'}};
assert.ok(quote&&baseline);
const record=i=>{const graduate=i>80;return {marketId:h(i),assetUid:i%2?stock.id:stock2.id,memeToken:a(100000+i),curve:a(200000+i),gauge:i===119?a(0):a(300000+i),quoteAsset:a(0),quoteAssetConfigId:quote.id,tickerGardenBaselineId:baseline.id,sourceVersion:graduate?2:1,launchPhase:graduate?1:0,creator:a(400000+i%100),creatorFeesToHolders:i%2===0,stakingEnabled:i%3!==0,burnMemeFees:i%4===0,lpFeePips:[0,1000,2000,3000][i%4],curveProgress:{realQuoteReserve:(BigInt(quote.values.graduationThreshold)/2n).toString(),sellableTokens:'700000000000000000000000000',reservedTokens:'300000000000000000000000000',accruedCurveFees:'1000000000000000',readyToGraduate:false},poolId:graduate?h(500000+i):null,poolKey:graduate?{currency0:a(0),currency1:a(100000+i),fee:[0,1000,2000,3000][i%4],tickSpacing:60,hooks:f72EventCatalog.TickerGardenMemeHook.address}:null,canonicalRoute:{router:a(700001),quoter:a(700002),hook:f72EventCatalog.TickerGardenMemeHook.address,launchLocker:a(600000+i),graduationExecutor:a(700003),curveTradingEnabled:!graduate,poolTradingEnabled:graduate,sourceVersion:graduate?2:1,launchPhase:graduate?1:0},source:{chainId:46630,blockNumber:'1',blockHash:h(899997),transactionHash:h(800000+i),transactionIndex:i,logIndex:0},identity:{name:`Local Market ${String(i).padStart(5,'0')}`,symbol:`L${i}`,metadataURI:'',deployedAt:String(now-7200+i%3600),blockNumber:'4',blockHash:hash,runtimeCodeHash:h(77)},display:{priceQuote:String(i),totalSupplyRaw:'1000000000000000000000000000',totalStakedRaw:'1000000000000000000',activeStakeRaw:'1000000000000000000',creatorTaxBps:i%4*100,asOfTimestamp:String(now),blockNumber:'4',blockHash:hash}}};
let http,vite,browser;const report={scope:'local synthetic rows; real PostgreSQL and Hono; no chain writes',checks:[]};
try{
 await applyCoreMigration(pool,schemaName);
 await pool.query(`INSERT INTO ${s}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES($1,$2,$3,$4,1,$5,$6)`,[...id,h(1),h(899997),h(2)]);
 for(let b=1;b<=4;b++)await pool.query(`INSERT INTO ${s}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized,source_timestamp) VALUES($1,$2,$3,$4,$5,$6,true,true,to_timestamp($7))`,[...id,b,h(899996+b),h(899995+b),[now-172800,now-86401,now-3600,now][b-1]]);
 await pool.query(`INSERT INTO ${s}.covered_ranges(environment,chain_id,deployment_digest,from_block,to_block,generation,filter_digest,complete,verified_at) VALUES($1,$2,$3,1,4,0,$4,true,now())`,[...id,h(3)]);
 await pool.query(`INSERT INTO ${s}.ingestion_checkpoints(environment,chain_id,deployment_digest,stream,next_block,last_block_hash,generation) VALUES($1,$2,$3,'frontend-events',5,$4,0)`,[...id,hash]);
 for(const scope of ['markets','configs','positions','accounts']){await pool.query(`INSERT INTO ${s}.publications(environment,chain_id,deployment_digest,scope,revision,block_number,block_hash,generation,payload_digest,payload) VALUES($1,$2,$3,$4,$5,4,$6,0,$7,'{}')`,[...id,scope,revision,hash,h(9)]);await pool.query(`INSERT INTO ${s}.publication_pointers VALUES($1,$2,$3,$4,$5,now())`,[...id,scope,revision])}
 for(const c of [...f72BootstrapConfigs.filter(x=>x.kind!=='asset'),{...stock,source:quote.source},{...stock2,source:quote.source}])await pool.query(`INSERT INTO ${s}.projection_records(environment,chain_id,deployment_digest,scope,revision,identity,sort_key,payload_digest,payload) VALUES($1,$2,$3,'configs',$4,$5,$5,$6,$7)`,[...id,revision,`${c.kind}:${c.id}`,h(4),c]);
 await pool.query(`INSERT INTO ${s}.projection_checkpoints(environment,chain_id,deployment_digest,scope,algorithm_version,next_block,generation,last_revision) VALUES($1,$2,$3,'analytics','f72-analytics-v1',5,0,$4)`,[...id,revision]);
 for(let i=1;i<=120;i++){
  const row=record(i);
  await pool.query(`INSERT INTO ${s}.projection_records(environment,chain_id,deployment_digest,scope,revision,identity,sort_key,payload_digest,payload) VALUES($1,$2,$3,'markets',$4,$5,$5,$6,$7)`,[...id,revision,row.marketId,h(99),row]);
  const trade={feeRaw:'1',taxRaw:'0',feeAsset:a(0),feeStatus:'event_reported',side:'buy',timestamp:String(now-1),source:{transactionIndex:String(i),logIndex:'0',blockNumber:'4'},price:{numerator:String(i),denominator:'1'}};
  await pool.query(`INSERT INTO ${s}.market_trades(environment,chain_id,deployment_digest,market_id,block_hash,transaction_hash,log_index,occurred_at,classification,base_raw,quote_raw,payload) VALUES($1,$2,$3,$4,$5,$6,0,to_timestamp($7),'unclassified',1,1,$8)`,[...id,row.marketId,hash,h(100000+i),now-1,trade]);
 }
 const price={assetUid:h(0),token:a(0),symbol:'ETH',chainId:46630,source:'coinbase_spot',status:'available',reason:'available',unit:'USD_PER_WHOLE_TOKEN',bidUsd:'2',askUsd:'2',asOf:new Date().toISOString(),expiresAt:new Date(Date.now()+600000).toISOString(),retrievedAt:new Date().toISOString(),multiplier:'1'};
 await pool.query(`INSERT INTO ${s}.price_references(environment,chain_id,deployment_digest,asset,source,status,as_of,expires_at,payload) VALUES($1,$2,$3,$4,'coinbase_spot','available',$5,$6,$7)`,[...id,a(0),price.asOf,price.expiresAt,price]);
 await publishProtocolStatistics(pool,deployment,schemaName);
 await pool.query(`INSERT INTO ${s}.projection_checkpoints(environment,chain_id,deployment_digest,scope,algorithm_version,next_block,generation,last_revision) VALUES($1,$2,$3,'history','history-incremental-v2',5,0,$4)`,[...id,revision]);
 await pool.query(`INSERT INTO ${s}.aggregate_records(environment,chain_id,deployment_digest,scope,identity,block_hash,complete,payload) VALUES($1,$2,$3,'creator-market',$4,$5,true,$6)`,[...id,`${a(400020)}:${h(120)}`,hash,{marketId:h(120),memeToken:a(100120),creator:a(400020),creationBlockNumber:'1'}]);
 const app=createReadApiApp({pool,deployment,env:{NODE_ENV:'test',TG_READ_DATABASE_URL:db,TG_CURSOR_SECRET:'local-explore-cursor-secret-32-characters',TG_DATABASE_SCHEMA:schemaName,TG_ALLOWED_ORIGINS:'http://127.0.0.1:18772'}});
 http=createServer(async(req,res)=>{try{const response=await app.request('http://127.0.0.1'+req.url,{method:req.method,headers:req.headers});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch{res.writeHead(500).end();}});
 await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));const api=`http://127.0.0.1:${http.address().port}`;
 for(const key of Object.keys(process.env))if(key.startsWith('VITE_'))delete process.env[key];
 vite=await createViteServer({configFile:false,envDir:false,plugins:[{name:'stats-regression',enforce:'pre',transform(code,id){if(id.endsWith('/src/app.ts'))return code+';window.__statsTest={prices:()=>applyStatsSnapshot()};';}}],root:new URL('../../apps/web',import.meta.url).pathname,define:{'import.meta.env.VITE_V1_CHAIN_ID':JSON.stringify('46630'),'import.meta.env.VITE_V1_READ_API_URL':JSON.stringify(api)},server:{host:'127.0.0.1',port:18772,strictPort:true}});await vite.listen();
 browser=await chromium.launch({executablePath:process.env.TG_BROWSER_EXECUTABLE??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});

 for(const mobile of [false,true]){
  const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:1000}}),errors=[];let requests=0,fail=false;
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/v1/protocol-statistics'))requests++;});
  await page.route('**/v1/protocol-statistics',route=>fail?route.fulfill({status:503,contentType:'application/json',body:'{}'}):route.continue());
  await page.goto('http://127.0.0.1:18772/stats');
  await page.waitForFunction(()=>document.querySelector('[data-stat-launches]')?.textContent==='120',null,{polling:100});
  assert.equal(await page.locator('[data-stat-bloomed]').innerText(),'40');
  await page.waitForFunction(()=>document.querySelector('[data-stat-volume]')?.textContent!=='-',null,{polling:100});assert.notEqual(await page.locator('[data-stat-fee-revenue]').innerText(),'-');
  assert.equal(await page.locator('[data-stat-staking-wallets]').innerText(),'0');
  const search=page.locator('.stats-stock-search');await search.fill('AAA');await search.focus();
  const before=requests;await page.evaluate(()=>window.__statsTest.prices());assert.equal(requests,before,'price updates do not fetch stats');assert.equal(await search.inputValue(),'AAA');assert.equal(await search.evaluate(e=>e===document.activeElement),true);
  fail=true;await page.locator('[data-stats-refresh]').click();await page.waitForFunction(()=>document.querySelector('[data-stat-launches]')?.textContent==='-',null,{polling:100});
  assert.equal(await page.locator('[data-stat-stock-value]').innerText(),'-');assert.ok((await page.locator('.stats-stock-list').innerText()).includes('-'));
  fail=false;await page.locator('[data-stats-refresh]').click();await page.waitForFunction(()=>document.querySelector('[data-stat-launches]')?.textContent==='120',null,{polling:100});assert.equal(await search.inputValue(),'AAA');
  await search.fill('');await page.locator('.stats-stock-toggle').click();assert.equal(await page.locator('.stats-stock-list .stats-fee-row').count(),2);
  await page.screenshot({path:`outputs/stats-${mobile?'mobile':'desktop'}.png`,fullPage:true});
  assert.deepEqual(errors,[]);report.checks.push({mobile,snapshot:true,noPriceRefetch:true,preservedSearch:true,failureClearsRows:true,retryRecovery:true,expand:true});await page.close();
 }
 console.log(JSON.stringify(report));
}finally{await browser?.close();await vite?.close();if(http)await new Promise(r=>http.close(r));await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);await pool.end();writeFileSync(new URL('../../outputs/stats-browser.json',import.meta.url),JSON.stringify(report,null,2));}
