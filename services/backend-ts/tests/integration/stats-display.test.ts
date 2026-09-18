import assert from 'node:assert/strict';
import test from 'node:test';
import {randomBytes} from 'node:crypto';
import {toEventSelector} from 'viem';
import {changeChannel} from '../../packages/confirmed-display/src/changes.ts';
import {applyCoreMigration,createDatabasePool} from '../../packages/db/src/index.ts';
import {applyStatsEvents,publishStatsDisplay,readStatsDisplay,undoStatsEvents,seedStats} from '../../packages/confirmed-display/src/stats.ts';
import {runtimeConfigs} from '../../packages/runtime-deployment/src/index.ts';
import {fixedF72Sources} from '../../packages/events/src/index.ts';
import {createReadApiApp} from '../../apps/read-api/src/index.ts';
import type {DisplayState} from '../../packages/confirmed-display/src/state.ts';
import type {EventObservation} from '../../packages/analytics/src/index.ts';
import type {RpcBlock} from '../../packages/chain/src/index.ts';
const url=process.env.TG_MIGRATION_DATABASE_URL;
const h=(n:number)=>`0x${n.toString(16).padStart(64,'0')}` as `0x${string}`;
const a=(n:number)=>`0x${n.toString(16).padStart(40,'0')}` as `0x${string}`;
const unit=10n**18n;
test('Stats shared-event projection: incremental totals, rollback, windows, prices and DB-only scoped reads',{timeout:120000},async t=>{
 if(!url){t.skip('Local PostgreSQL required');return;}
 const schemaName=`tg_stats_${process.pid}_${randomBytes(4).toString('hex')}`,s=`"${schemaName}"`;
 const handle=createDatabasePool(url,{max:3}),db=handle.pool;
 const d={environment:'test' as const,chainId:46630 as const,deploymentDigest:h(999),activationBlock:1n},id=[d.environment,d.chainId,d.deploymentDigest];
 const catalog=runtimeConfigs as unknown as Array<any>,length=catalog.length;
 const baseline=catalog.find(c=>c.kind==='baseline')!,quote=catalog.find(c=>c.kind==='quote'&&c.values.quoteAsset===a(0))!;
 const asset=h(888),asset2=h(889),token=a(555),usd=a(556),account=a(777);
 catalog.push({kind:'asset',id:asset,values:{stockToken:token,tokenDecimals:18,tokenSymbol:'TEST'}},{kind:'asset',id:asset2,values:{stockToken:usd,tokenDecimals:18,tokenSymbol:'USDG'}},{kind:'quote',id:h(887),values:{quoteAsset:usd,quoteDecimals:18,symbol:'USDG'}});
 const now=new Date(),at=Math.floor(now.getTime()/1000),block=(n:number,ts=at):RpcBlock=>({number:BigInt(n),hash:h(n),parentHash:h(n-1),timestamp:BigInt(ts)});
 const state=(n:number,phase=0):DisplayState=>({market:{marketId:h(n),memeToken:a(n),curve:a(n+100),gauge:a(0),quoteAsset:a(0),quoteAssetConfigId:quote.id,tickerGardenBaselineId:baseline.id,source:{chainId:46630},identity:{deployedAt:String(at)},launchPhase:phase,display:{priceQuote:'0.5'}},blockNumber:'10',blockHash:h(10)} as unknown as DisplayState);
 const save=async(st:DisplayState)=>db.query(`INSERT INTO ${s}.confirmed_display_markets VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(environment,chain_id,deployment_digest,market_id) DO UPDATE SET payload=excluded.payload`,[...id,st.market.marketId,st.blockNumber,st.blockHash,JSON.stringify(st)]);
 const emitter=(module:string)=>fixedF72Sources().find(s=>s.module===module)!.address;
 const event=(name:string,args:Record<string,unknown>,index:number,n=11,ts=at):EventObservation=>({timestamp:BigInt(ts),event:{module:name.startsWith('Allocation')?'UserStockVault':name==='CurveBuy'?'TickerGardenCurve':'ProtocolFeeVault',eventName:name,args,log:{address:name.startsWith('Allocation')?emitter('UserStockVault'):name==='CurveBuy'?a(101):emitter('ProtocolFeeVault'),blockNumber:BigInt(n),blockHash:h(n),transactionHash:h(n+10000),transactionIndex:0n,logIndex:BigInt(index),data:'0x',topics:name.startsWith('Allocation')?[toEventSelector(`${name}(bytes32,address,bytes32,uint256,uint256,uint256)`)]:[],removed:false}}});
 const price=async(tokenAddress:string,value:string,time=now)=>{const expiry=new Date(time.getTime()+3600000);const p={chainId:46630,token:tokenAddress,status:'available',source:'robinhood_rest',bidUsd:value,askUsd:value,asOf:time.toISOString(),expiresAt:expiry.toISOString(),retrievedAt:time.toISOString()};await db.query(`INSERT INTO ${s}.price_references(environment,chain_id,deployment_digest,asset,source,status,value,as_of,expires_at,payload) VALUES($1,$2,$3,$4,'robinhood_rest','available',$5,$6,$7,$8)`,[...id,tokenAddress,value,time,expiry,p]);};
 const buy=event('CurveBuy',{buyer:account,recipient:account,quoteIn:2n*unit,tokensOut:unit,fee:unit/10n,tax:0n},0);
 const stake=event('AllocationLocked',{assetUid:asset,user:account,marketId:h(1),amount:3n*unit,userMarketAllocation:3n*unit,userTotalAllocated:3n*unit},1);
 const credit=event('CurveFeesSwept',{marketId:h(1),quoteAsset:a(0),creatorAmount:unit/10n,platformAmount:unit/10n},2);
 try{
  await applyCoreMigration(db,schemaName);
  await assert.rejects(readStatsDisplay({pool:db,deployment:d,schemaName}),/pending/);
  await db.query(`INSERT INTO ${s}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES($1,$2,$3,$4,1,$4,$4)`,[...id,h(9)]);
  await seedStats(db,d,block(10),schemaName);
  await price(a(0),'10');await price(token,'4');
  await publishStatsDisplay(db,d,block(10),schemaName,now);
  assert.equal((await readStatsDisplay({pool:db,deployment:d,schemaName})).sections.overview.volumeUsd,'0');
  await save(state(1));await save(state(2,1));
  const undo=await applyStatsEvents(db,d,[buy,stake,credit],[state(1)],schemaName);
  await applyStatsEvents(db,d,[buy,stake,credit],[state(1)],schemaName);
  const regions=await publishStatsDisplay(db,d,block(11),schemaName,now);
  assert.deepEqual(regions,['overview','allocations','stocks']);
  let view=await readStatsDisplay({pool:db,deployment:d,schemaName});
  assert.equal(view.sections.overview.volumeUsd,'19');assert.equal(view.sections.overview.feeRevenueUsd,'1');
  assert.equal(view.sections.overview.launches24h,2);assert.equal(view.sections.overview.bloomedMarkets,1);
  assert.equal(view.sections.overview.stakingValueUsd,'12');assert.equal(view.sections.overview.stakingWallets,1);
  assert.equal(view.sections.allocations.creator,'1');assert.equal(view.sections.allocations.platform,'1');
  assert.equal((await db.query(`SELECT sum(amount)::text n FROM ${s}.stats_display_buckets WHERE kind='volume'`)).rows[0].n,String(19n*unit/10n));
  assert.deepEqual(await publishStatsDisplay(db,d,block(11),schemaName,now),[],'unchanged data sends no region invalidation');
  const second=event('AllocationLocked',{assetUid:asset2,user:account,marketId:h(2),amount:unit,userMarketAllocation:unit,userTotalAllocated:unit},3,12);
  await applyStatsEvents(db,d,[second],[],schemaName);await publishStatsDisplay(db,d,block(12),schemaName,now);
  view=await readStatsDisplay({pool:db,deployment:d,schemaName});assert.equal(view.sections.overview.stakingWallets,1,'same wallet across assets counted once');assert.equal(view.sections.overview.stakingValueUsd,'13','USDG fixed at one without a quote');
  await price(token,'5',new Date(now.getTime()+1000));
  assert.deepEqual(await publishStatsDisplay(db,d,block(12),schemaName,new Date(now.getTime()+1000)),['overview','stocks'],'stock price changes do not invalidate fee allocations');
  const scoped=await readStatsDisplay({pool:db,deployment:d,schemaName},'stocks');assert.deepEqual(Object.keys(scoped.sections),['stocks']);
  const app=createReadApiApp({pool:db,deployment:d,env:{NODE_ENV:'test',TG_READ_DATABASE_URL:url,TG_DATABASE_SCHEMA:schemaName,TG_CURSOR_SECRET:'stats-audit-cursor-secret-at-least-32-chars'}});
  const response=await app.request('/v1/stats/display?section=overview');assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(Object.keys((await response.json() as any).sections),['overview']);assert.equal((await app.request('/v1/stats/display?section=bad')).status,400);
  const abort=new AbortController(),stream=await app.request(new Request('http://localhost/v1/stats/events',{signal:abort.signal})),reader=stream.body!.getReader();
  try{
   assert.match(new TextDecoder().decode((await reader.read()).value),/event: ready/);
   await db.query('SELECT pg_notify($1,$2)',[changeChannel(d,schemaName),JSON.stringify({marketId:h(1),regions:['chart']})]);
   await db.query('SELECT pg_notify($1,$2)',[changeChannel(d,schemaName),JSON.stringify({statsRegions:['stocks'],revision:'test'})]);
   const notice=new TextDecoder().decode((await reader.read()).value);assert.match(notice,/event: change/);assert.match(notice,/statsRegions/);assert.doesNotMatch(notice,/marketId/);
  }finally{abort.abort();await reader.cancel();}
  await db.query(`UPDATE ${s}.stats_display_snapshots SET generated_at=now()-interval '7 days'`);
  assert.equal((await app.request('/v1/stats/display')).status,200,'DB payload age does not block reads');
  await undoStatsEvents(db,d,'10',{...undo,[`${asset2}:${account}`]:null},schemaName);
  await db.query(`DELETE FROM ${s}.confirmed_display_markets WHERE market_id=$1`,[h(2)]);
  await publishStatsDisplay(db,d,block(10),schemaName,now);
  view=await readStatsDisplay({pool:db,deployment:d,schemaName});assert.equal(view.sections.overview.volumeUsd,'0');assert.equal(view.sections.overview.stakingWallets,0);assert.equal(view.sections.overview.stakingValueUsd,'0');assert.equal(view.sections.overview.bloomedMarkets,0);assert.equal(view.sections.allocations.creator,'0');
  await applyStatsEvents(db,d,[buy,stake,credit],[state(1)],schemaName);
  await publishStatsDisplay(db,d,block(20,at+86401),schemaName,now);
  view=await readStatsDisplay({pool:db,deployment:d,schemaName});assert.equal(view.sections.overview.volumeUsd,'0');assert.equal(view.sections.overview.feeRevenueUsd,'0');assert.equal(view.sections.overview.launches24h,0);assert.equal(view.sections.overview.stakingWallets,1,'rolling expiry does not expire principal');
  await publishStatsDisplay(db,d,block(20,at+86400),schemaName,now);view=await readStatsDisplay({pool:db,deployment:d,schemaName});assert.equal(view.sections.overview.volumeUsd,'19','exact boundary included, partial minute is not counted twice');
  // Missing pricing affects valuation only, never raw positions/counts or unrelated USDG.
  await db.query(`DELETE FROM ${s}.price_references WHERE asset=$1`,[token]);await publishStatsDisplay(db,d,block(20),schemaName,now);view=await readStatsDisplay({pool:db,deployment:d,schemaName});assert.equal(view.sections.overview.stakingValueUsd,null);assert.equal(view.sections.overview.stakingWallets,1);assert.equal(view.sections.stocks.find(s=>s.id===asset)?.amountRaw,String(3n*unit));assert.equal(view.sections.overview.volumeUsd,'19');
  // 20k markets never enter response bodies; count contributions and indexed launch timestamps suffice.
  await db.query(`INSERT INTO ${s}.confirmed_display_markets SELECT $1,$2,$3,'0x'||lpad(to_hex(n),64,'0'),10,$4,jsonb_build_object('market',jsonb_build_object('identity',jsonb_build_object('deployedAt',$5::text),'launchPhase',1,'memeToken','0x'||lpad(to_hex(n),40,'0'))) FROM generate_series(1000,20999)n`,[...id,h(10),String(at)]);
  const start=performance.now();await publishStatsDisplay(db,d,block(20),schemaName,now);const elapsed=performance.now()-start;
  view=await readStatsDisplay({pool:db,deployment:d,schemaName});assert.equal(view.sections.overview.bloomedMarkets,20000);assert.equal(view.sections.overview.launches24h,20001);assert.ok(JSON.stringify(view).length<10000);
  t.diagnostic(`20,001 market snapshot rebuild ${elapsed.toFixed(1)}ms; ${JSON.stringify(view).length} byte payload`);
 }finally{catalog.splice(length);await db.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);await db.end();}
});

test('Stats initialization pages over 10,000 allocation checkpoints and ignores noncanonical history',{timeout:120000},async t=>{
 if(!url){t.skip('Local PostgreSQL required');return;}
 const schemaName=`tg_stats_seed_${process.pid}_${randomBytes(4).toString('hex')}`,s=`"${schemaName}"`,handle=createDatabasePool(url,{max:2}),db=handle.pool;
 const d={environment:'test' as const,chainId:46630 as const,deploymentDigest:h(999),activationBlock:1n},id=[d.environment,d.chainId,d.deploymentDigest],at=1800000000;
 const b:RpcBlock={number:10n,hash:h(10),parentHash:h(9),timestamp:BigInt(at)},vault=fixedF72Sources().find(s=>s.module==='UserStockVault')!.address;
 try{
  await applyCoreMigration(db,schemaName);
  await db.query(`INSERT INTO ${s}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES($1,$2,$3,$4,1,$4,$4)`,[...id,h(1)]);
  await db.query(`INSERT INTO ${s}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,source_timestamp,canonical,finalized) VALUES($1,$2,$3,10,$4,$5,to_timestamp($6),true,true),($1,$2,$3,10,$7,$5,to_timestamp($6),false,true)`,[...id,h(10),h(9),at,h(11)]);
  const topic=toEventSelector('AllocationLocked(bytes32,address,bytes32,uint256,uint256,uint256)'),data='0x'+('1'.padStart(64,'0')).repeat(3);
  await db.query(`INSERT INTO ${s}.chain_logs(environment,chain_id,deployment_digest,block_hash,transaction_hash,transaction_index,log_index,address,topic0,payload,canonical)
    SELECT $1,$2,$3,$4::text,$5::text,0,n,$6::text,$7::text,jsonb_build_object('address',$6::text,'blockNumber','10','blockHash',$4::text,'transactionHash',$5::text,'transactionIndex','0','logIndex',n::text,'data',$8::text,'topics',jsonb_build_array($7::text,$9::text,'0x'||lpad(to_hex(n),64,'0'),$10::text),'removed',false),true FROM generate_series(1,10005)n`,[...id,h(10),h(100),vault,topic,data,h(888),h(555)]);
  // A later checkpoint on an orphan block must never override the canonical value.
  await db.query(`INSERT INTO ${s}.chain_logs(environment,chain_id,deployment_digest,block_hash,transaction_hash,transaction_index,log_index,address,topic0,payload,canonical) VALUES($1,$2,$3,$4,$5,1,0,$6,$7,$8,false)`,[...id,h(11),h(101),vault,topic,JSON.stringify({address:vault,blockNumber:'10',blockHash:h(11),transactionHash:h(101),transactionIndex:'1',logIndex:'0',data:'0x'+('9'.padStart(64,'0')).repeat(3),topics:[topic,h(888),h(1),h(555)],removed:false})]);
  const trade={source:{blockNumber:'10',eventKey:'seed-trade'},timestamp:String(at),classification:'unclassified',quoteAsset:a(0),quoteRaw:'100',feeRaw:'2',taxRaw:'1',feeAsset:a(0)};
  await db.query(`INSERT INTO ${s}.market_trades(environment,chain_id,deployment_digest,market_id,block_hash,transaction_hash,log_index,occurred_at,classification,base_raw,quote_raw,payload) VALUES($1,$2,$3,$4,$5,$6,0,to_timestamp($7),'unclassified',1,100,$8)`,[...id,h(555),h(10),h(100),at,trade]);
  await seedStats(db,d,b,schemaName);
  assert.equal((await db.query(`SELECT count(*)::int n,sum(amount)::text amount FROM ${s}.stats_display_positions`)).rows[0].n,10005);
  assert.equal((await db.query(`SELECT amount::text FROM ${s}.stats_display_stock_totals`)).rows[0].amount,'10005');
  assert.equal((await db.query(`SELECT sum(amount)::text amount FROM ${s}.stats_display_buckets WHERE kind='fee'`)).rows[0].amount,'3');
  assert.equal((await db.query(`SELECT amount::text FROM ${s}.stats_display_positions WHERE account=$1`,[a(1)])).rows[0].amount,'1');
  // Atomic initialization retry has no double counting.
  await seedStats(db,d,b,schemaName);
  assert.equal((await db.query(`SELECT amount::text FROM ${s}.stats_display_stock_totals`)).rows[0].amount,'10005');
  assert.equal((await db.query(`SELECT sum(amount)::text amount FROM ${s}.stats_display_buckets WHERE kind='volume'`)).rows[0].amount,'100');
 }finally{await db.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);await db.end();}
});
