import assert from 'node:assert/strict';
import test from 'node:test';
import {randomBytes} from 'node:crypto';
import {applyCoreMigration,createDatabasePool} from '../../packages/db/src/index.ts';
import {readLaunchReadiness} from '../../packages/confirmed-display/src/read.ts';
import {refreshDisplayPreparation,maintenanceRegions} from '../../packages/confirmed-display/src/maintenance.ts';
import {materializeDisplay,emptyDisplayState} from '../../packages/confirmed-display/src/state.ts';
import {runtimeConfigs} from '../../packages/runtime-deployment/src/index.ts';
import {readMarketDisplayStatistics} from '../../packages/statistics-store/src/index.ts';
import type {MarketReadModel} from '../../openapi/generated/v1-client.ts';
import type {MarketCreation} from '../../packages/market-projector/src/index.ts';
const h=(c:string)=>`0x${c.repeat(64)}` as `0x${string}`,a=(c:string)=>`0x${c.repeat(40)}` as `0x${string}`;
const url='postgresql:///postgres?host=/tmp';
test('durable preparation repairs shared USD values and exposes DB-only ready/stake reads; reorg removes readiness',async()=>{
 const schemaName=`tg_preparation_${process.pid}_${randomBytes(4).toString('hex')}`,s=`"${schemaName}"`,pool=createDatabasePool(url,{max:2}).pool;
 const d={environment:'test' as const,chainId:46630 as const,deploymentDigest:h('a'),activationBlock:1n},id=[d.environment,d.chainId,d.deploymentDigest];
 const quote=runtimeConfigs.find(c=>c.kind==='quote'&&c.values.quoteAsset===a('0'))!,baseline=runtimeConfigs.find(c=>c.kind==='baseline')!,supply=String(baseline.values.supply);
 const now=Math.floor(Date.now()/1000),block={number:10n,hash:h('b'),parentHash:h('c'),timestamp:BigInt(now)};
 const market={marketId:h('1'),memeToken:a('2'),curve:a('3'),gauge:a('0'),quoteAsset:a('0'),quoteAssetConfigId:quote.id,tickerGardenBaselineId:baseline.id,poolId:null,poolKey:null,source:{chainId:46630,blockNumber:'10'},identity:{deployedAt:String(now)},content:{description:'',imageURI:null,website:null,x:null},display:{totalSupplyRaw:supply,totalStakedRaw:'123',priceQuote:'0.01'}} as unknown as MarketReadModel;
 const state=materializeDisplay({...emptyDisplayState({...market,source:{blockNumber:'10'}} as unknown as MarketCreation,market,block),supply,balances:{[a('3')]:supply},latestTrade:null,latestBuy:null});
 try{
  await applyCoreMigration(pool,schemaName);
  await pool.query(`INSERT INTO ${s}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES($1,$2,$3,$4,1,$4,$4)`,[...id,h('b')]);
  await pool.query(`INSERT INTO ${s}.recent_markets(environment,chain_id,deployment_digest,market_id,transaction_hash,block_number,block_hash,payload,initial_detail) VALUES($1,$2,$3,$4,$5,10,$6,$7,$8)`,[...id,market.marketId,h('f'),block.hash,JSON.stringify(market),JSON.stringify(state.detailViews!['1H'])]);
  assert.equal((await readLaunchReadiness(pool,d,market.marketId,schemaName)).ready,false);
  const price={chainId:46630,token:a('0'),status:'available',source:'coinbase_spot',bidUsd:'2',askUsd:'2',asOf:new Date().toISOString(),expiresAt:new Date(Date.now()+300000).toISOString()};
  await pool.query(`INSERT INTO ${s}.price_references(environment,chain_id,deployment_digest,asset,source,status,value,as_of,expires_at,payload) VALUES($1,$2,$3,$4,'coinbase_spot','available','2',now(),now()+interval '5 minutes',$5)`,[...id,a('0'),price]);
  assert.equal((await refreshDisplayPreparation({pool,deployment:d,schemaName})).failed,0);
  assert.equal((await readLaunchReadiness(pool,d,market.marketId,schemaName)).ready,true,'recent launch repairs without waiting for finality');
  let stats=await readMarketDisplayStatistics({pool,deployment:d,marketId:market.marketId,schemaName});assert.equal(stats.totalStakedRaw,'123');assert.equal(stats.volumeRaw,'0');
  await pool.query(`UPDATE ${s}.recent_markets SET canonical=false`);
  assert.equal((await readLaunchReadiness(pool,d,market.marketId,schemaName)).ready,false);
  await pool.query(`INSERT INTO ${s}.confirmed_display_cursor VALUES($1,$2,$3,10,$4,10,$5)`,[...id,block.hash,now]);
  await pool.query(`INSERT INTO ${s}.confirmed_display_markets(environment,chain_id,deployment_digest,market_id,block_number,block_hash,payload) VALUES($1,$2,$3,$4,10,$5,$6)`,[...id,market.marketId,block.hash,JSON.stringify(state)]);
  await pool.query(`UPDATE ${s}.confirmed_display_markets SET refresh_due_at=now()`);
  const result=await refreshDisplayPreparation({pool,deployment:d,schemaName});assert.equal(result.failed,0);assert.equal(result.processed,1);
  assert.equal((await readLaunchReadiness(pool,d,market.marketId,schemaName)).ready,true);
  const repaired=(await pool.query(`SELECT ${s}.display_state(m) payload,launch_missing,refresh_due_at>now() scheduled FROM ${s}.confirmed_display_markets m`)).rows[0];
  assert.deepEqual(repaired.launch_missing,[]);assert.equal(repaired.scheduled,true);assert.equal(repaired.payload.detailViews['1H'].statistics.priceUsd,'0.02');
  assert.deepEqual(maintenanceRegions(repaired.payload,repaired.payload),[],'no notification for unchanged views');
  stats=await readMarketDisplayStatistics({pool,deployment:d,marketId:market.marketId,schemaName});assert.equal(stats.totalStakedRaw,'123');
  await pool.query(`UPDATE ${s}.confirmed_display_markets SET refresh_due_at=now()`);
  let raced=false;
  const concurrent={query:async(sql:string,args?:unknown[])=>{
   if(!raced&&sql.startsWith('WITH locked_head')){raced=true;await pool.query(`UPDATE ${s}.confirmed_display_markets SET payload=jsonb_set(payload,'{market,display,totalStakedRaw}','"456"')`);}
   return pool.query(sql,args);
  }} as unknown as Pick<typeof pool,'query'>;
  assert.equal((await refreshDisplayPreparation({pool:concurrent,deployment:d,schemaName})).failed,0);
  assert.equal((await readMarketDisplayStatistics({pool,deployment:d,marketId:market.marketId,schemaName})).totalStakedRaw,'456','stale preparation cannot overwrite an event arriving after its read');
  // A saved future market cannot pass the cursor gate following a rewind.
  await pool.query(`UPDATE ${s}.confirmed_display_cursor SET block_number=9`);
  assert.equal((await readLaunchReadiness(pool,d,market.marketId,schemaName)).ready,false);
 }finally{await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);await pool.end();}
});

test('0022 upgrades populated 0021 tables without changing existing display payloads',async()=>{
 const {migrationManifest,migrationSql,coreMigrationDigest}=await import('../../packages/db/src/index.ts');
 const schemaName=`tg_prepare_upgrade_${process.pid}_${randomBytes(4).toString('hex')}`,s=`"${schemaName}"`,pool=createDatabasePool(url,{max:1}).pool;
 try{
  for(const migration of migrationManifest().filter(m=>m.version<'0022_display_preparation')){
   await pool.query(migrationSql(schemaName,migration.version));
   await pool.query(`UPDATE ${s}.schema_migrations SET digest=$1 WHERE version=$2`,[coreMigrationDigest(migration.version),migration.version]);
  }
  const payload={market:{marketId:h('1'),identity:{deployedAt:'1'},launchPhase:0},balances:{[a('3')]:'100'}};
  await pool.query(`INSERT INTO ${s}.confirmed_display_markets(environment,chain_id,deployment_digest,market_id,block_number,block_hash,payload) VALUES('test',46630,$1,$2,10,$3,$4)`,[h('a'),h('1'),h('b'),payload]);
  assert.equal(await applyCoreMigration(pool,schemaName),true);
  const saved=(await pool.query(`SELECT payload,launch_missing,refresh_due_at<=now() due FROM ${s}.confirmed_display_markets`)).rows[0];
  assert.deepEqual(saved.payload,payload);assert.ok(saved.launch_missing.includes('content'));assert.ok(saved.launch_missing.includes('priceUsd'));assert.equal(saved.due,true);
  assert.equal(await applyCoreMigration(pool,schemaName),false);
 }finally{await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);await pool.end();}
});
