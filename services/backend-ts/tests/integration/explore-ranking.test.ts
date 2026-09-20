import {publishMarketCapRanking} from '../../packages/display-price/src/ranking.ts';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import test from 'node:test';
import { createReadApiApp } from '../../apps/read-api/src/index.ts';
import { readFileSync } from 'node:fs';
import { applyCoreMigration, createDatabasePool, migrationManifest, migrationSql } from '../../packages/db/src/index.ts';
import { encodeCursor, readPublishedMarketPage, PublicationChangedError } from '../../packages/read-store/src/index.ts';

const url=process.env.TG_TEST_DATABASE_URL;
const h=(n:number)=>`0x${n.toString(16).padStart(64,'0')}` as `0x${string}`;
const a=(n:number)=>`0x${n.toString(16).padStart(40,'0')}`;
test('legacy market ranking API reads unified confirmed-display ranks with stable cursors',async t=>{
 if(!url){t.skip('TG_TEST_DATABASE_URL required');return;}
 const schemaName=`tg_explore_${randomBytes(5).toString('hex')}`,s=`"${schemaName}"`;
 const {pool}=createDatabasePool(url),deployment={environment:'test' as const,chainId:46630 as const,deploymentDigest:h(999),activationBlock:1n},id=['test',46630,h(999)];
 try{
  await applyCoreMigration(pool,schemaName);
  await pool.query(`INSERT INTO ${s}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES($1,$2,$3,$4,0,$4,$4)`,[...id,h(1)]);
  await pool.query(`INSERT INTO ${s}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,finalized,source_timestamp) VALUES($1,$2,$3,10,$4,$5,true,now()),($1,$2,$3,11,$6,$4,false,now())`,[...id,h(10),h(9),h(11)]);
  const revision=`10:${h(10)}`;
  await pool.query(`INSERT INTO ${s}.publications(environment,chain_id,deployment_digest,scope,revision,block_number,block_hash,generation,payload_digest,payload) VALUES($1,$2,$3,'markets',$4,10,$5,1,$5,'{}')`,[...id,revision,h(10)]);
  await pool.query(`INSERT INTO ${s}.publication_pointers(environment,chain_id,deployment_digest,scope,revision) VALUES($1,$2,$3,'markets',$4)`,[...id,revision]);
  await pool.query(`INSERT INTO ${s}.projection_checkpoints(environment,chain_id,deployment_digest,scope,algorithm_version,next_block,generation,last_revision) VALUES($1,$2,$3,'analytics','test',11,1,$4)`,[...id,revision]);
  for(let n=1;n<=6;n++){
   // No prefilled metrics/lastBuy: match the production market projector shape.
   const payload={marketId:h(n),memeToken:a(n),quoteAsset:a(99),assetUid:h(n%2),launchPhase:n>4?1:0,identity:{name:`Token ${n}`,symbol:`T${n}`,deployedAt:String(n)},display:{priceQuote:n===6?null:n===1?'1.25':String(n),totalSupplyRaw:'100000000000000000000',blockNumber:'10',blockHash:h(10)}};
   await pool.query(`INSERT INTO ${s}.projection_records(environment,chain_id,deployment_digest,scope,revision,identity,sort_key,payload_digest,payload) VALUES($1,$2,$3,'markets',$4,$5::text,$5::text,$5::text,$6)`,[...id,revision,h(n),payload]);
   const metrics={status:n===6?'unavailable':'available',reason:n===6?'valuation_inputs_unavailable':'historical_usd_coverage_unavailable',volume24hUsd:null,marketCapUsd:n===6?null:String(n*200),quoteUsdMidpoint:n===6?null:'2',windowFromTimestamp:'0',asOfTimestamp:'10',usdPriceAsOf:null,usdPriceSource:null,volumeBasis:'EXTERNAL_EXECUTIONS_CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE',marketCapBasis:'TOTAL_SUPPLY_X_FINALIZED_SPOT_X_QUOTE_USD'};
   const card={...payload,metrics};
   await pool.query(`INSERT INTO ${s}.confirmed_display_markets(environment,chain_id,deployment_digest,market_id,block_number,block_hash,payload) VALUES($1,$2,$3,$4,10,$5,$6)`,[...id,h(n),h(10),{market:card}]);
  }
  await pool.query(`INSERT INTO ${s}.confirmed_display_cursor(environment,chain_id,deployment_digest,block_number,block_hash,base_number,block_timestamp) VALUES($1,$2,$3,10,$4,10,10)`,[...id,h(10)]);
  const now=new Date();
  assert.equal((await publishMarketCapRanking(pool,deployment,schemaName,now)).published,true);
  assert.equal((await publishMarketCapRanking(pool,deployment,schemaName,now)).published,false);
  const query=(filter:Parameters<typeof readPublishedMarketPage>[0]['filter'],cursor?:string)=>readPublishedMarketPage({pool,deployment,schemaName,secret:'explore-test-cursor-secret-32-bytes',filter,limit:2,...(cursor?{cursor}:{})});
  const first=await query({sort:'marketCapUsd_desc'}),second=await query({sort:'marketCapUsd_desc'},first.nextCursor!);
  assert.deepEqual(first.items.map((x:any)=>x.marketId),[h(5),h(4)]);
  assert.equal(Number((first.items[0] as any).metrics.marketCapUsd),1000);
  const metricSchema=JSON.parse(readFileSync(new URL('../../openapi/v1.json',import.meta.url),'utf8')).components.schemas.MarketMetricsReadModel;
  for(const key of metricSchema.required)assert.ok(key in (first.items[0] as any).metrics,`Missing metric contract field: ${key}`);
  const api=createReadApiApp({pool,deployment,env:{TG_READ_DATABASE_URL:url,TG_CURSOR_SECRET:'explore-test-cursor-secret-32-bytes',TG_DATABASE_SCHEMA:schemaName}});
  const response=await api.request(`/v1/markets?sort=marketCapUsd_desc&revision=${encodeURIComponent(revision)}`);
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.deepEqual(second.items.map((x:any)=>x.marketId),[h(3),h(2)]);
  const third=await query({sort:'marketCapUsd_desc'},second.nextCursor!);
  assert.deepEqual(third.items.map((x:any)=>x.marketId),[h(1),h(6)]);
  assert.equal((third.items[1] as any).metrics.marketCapUsd,null);
  for(const phase of [0,1] as const){const page=await query({sort:'marketCapUsd_desc',launchPhase:phase,assetUid:h(1)});assert.ok(page.items.length);for(const x of page.items as any[])assert.equal(x.assetUid,h(1));}
  assert.deepEqual((await query({search:'Token 3',sort:'marketCapUsd_desc'})).items.map((x:any)=>x.marketId),[h(3)]);
  // Same-block buys must sort by transaction then log position, not market ID.
  for(const [market,tx,log,block,side] of [[1,2,1,10,'buy'],[2,2,2,10,'buy'],[3,1,9,10,'buy'],[4,99,1,11,'buy'],[5,9,9,10,'sell']] as const){
   await pool.query(`INSERT INTO ${s}.market_trades(environment,chain_id,deployment_digest,market_id,block_hash,transaction_hash,log_index,occurred_at,classification,base_raw,quote_raw,payload) VALUES($1,$2,$3,$4,$5,$6,$7,now(),'unclassified',1,1,$8)`,[...id,h(market),h(block),h(100+market),log,{side,timestamp:'10',source:{blockNumber:String(block),transactionIndex:String(tx)}}]);
  }
  // Replay and an older event cannot displace a project's latest buy.
  await pool.query(`INSERT INTO ${s}.market_trades SELECT * FROM ${s}.market_trades ON CONFLICT DO NOTHING`);
  await pool.query(`INSERT INTO ${s}.market_trades(environment,chain_id,deployment_digest,market_id,block_hash,transaction_hash,log_index,occurred_at,classification,base_raw,quote_raw,payload) VALUES($1,$2,$3,$4,$5,$6,0,now(),'unclassified',1,1,$7)`,[...id,h(2),h(10),h(555),{side:'buy',timestamp:'9',source:{blockNumber:'10',transactionIndex:'0'}}]);
  const buys=await query({sort:'recentBuy_desc'});
  assert.deepEqual(buys.items.map((x:any)=>x.marketId),[h(2),h(1)]);
  assert.deepEqual((await query({sort:'recentBuy_desc'},buys.nextCursor!)).items.map((x:any)=>x.marketId),[h(3)]);
  // Live card metric changes do not mutate the saved rank metrics or its legacy cursor.
  await pool.query(`UPDATE ${s}.confirmed_display_markets SET payload=jsonb_set(payload,'{market,metrics,marketCapUsd}','"2000"') WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4`,[...id,h(1)]);
  assert.deepEqual((await query({sort:'marketCapUsd_desc'},first.nextCursor!)).items.map((x:any)=>x.marketId),[h(3),h(2)]);
  assert.equal(Number(((await query({sort:'marketCapUsd_desc'})).items[0] as any).metrics.marketCapUsd),1000);
  await publishMarketCapRanking(pool,deployment,schemaName,new Date(now.getTime()+21*60000));
  assert.equal(Number(((await query({sort:'marketCapUsd_desc'})).items[0] as any).metrics.marketCapUsd),2000);
  assert.equal(((await query({sort:'marketCapUsd_desc'})).items[0] as any).marketId,h(1));
  assert.equal(Number(((await query({sort:'marketCapUsd_desc'},first.nextCursor!)).items[0] as any).metrics.marketCapUsd),600);
  // Finalization and rollback update only affected projects; old buy cursors stay valid.
  await pool.query(`UPDATE ${s}.chain_blocks SET finalized=true WHERE hash=$1`,[h(11)]);
  assert.equal(((await query({sort:'recentBuy_desc'})).items[0] as any).marketId,h(4));
  assert.deepEqual((await query({sort:'recentBuy_desc'},buys.nextCursor!)).items.map((x:any)=>x.marketId),[h(3)]);
  await pool.query(`UPDATE ${s}.chain_blocks SET canonical=false WHERE hash=$1`,[h(11)]);
  assert.equal(((await query({sort:'recentBuy_desc'})).items[0] as any).marketId,h(2));
  await pool.query(`UPDATE ${s}.market_trades SET classification='internal_reward_conversion' WHERE market_id=$1`,[h(2)]);
  assert.equal(((await query({sort:'recentBuy_desc'})).items[0] as any).marketId,h(1));
  await pool.query(`DELETE FROM ${s}.market_trades WHERE market_id=$1`,[h(1)]);
  assert.equal(((await query({sort:'recentBuy_desc'})).items[0] as any).marketId,h(3));
  const missing=await query({sort:'marketCapUsd_desc',marketId:h(6)});assert.equal((missing.items[0] as any).metrics.marketCapUsd,null);
  // Ranked reads also support the production temporal storage path and use current phases.
  const nextRevision=`12:${h(12)}`;
  await pool.query(`INSERT INTO ${s}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized,source_timestamp) VALUES($1,$2,$3,12,$4,$5,true,true,now())`,[...id,h(12),h(10)]);
  await pool.query(`INSERT INTO ${s}.publications(environment,chain_id,deployment_digest,scope,revision,block_number,block_hash,generation,payload_digest,payload) VALUES($1,$2,$3,'markets',$4,12,$5,1,$5,'{"storage":"market-versions-v1"}')`,[...id,nextRevision,h(12)]);
  await pool.query(`INSERT INTO ${s}.market_record_versions(environment,chain_id,deployment_digest,generation,identity,valid_from,sort_key,payload_digest,payload) SELECT environment,chain_id,deployment_digest,1,identity,12,sort_key,payload_digest,CASE WHEN identity=$5 THEN jsonb_set(payload,'{launchPhase}','1') ELSE payload END FROM ${s}.projection_records WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='markets' AND revision=$4`,[...id,revision,h(3)]);
  await pool.query(`UPDATE ${s}.publication_pointers SET revision=$4 WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='markets'`,[...id,nextRevision]);
  assert.equal((await query({sort:'recentBuy_desc',launchPhase:0})).items.length,0);
  assert.equal(((await query({sort:'recentBuy_desc',launchPhase:1})).items[0] as any).marketId,h(3));
  const oldRankingPage=await query({sort:'marketCapUsd_desc'},first.nextCursor!);
  assert.equal((oldRankingPage.items[0] as any).launchPhase,1);
  assert.equal(oldRankingPage.sync.revision,nextRevision);
  const beforeFailure=Number((await pool.query(`SELECT count(*) FROM ${s}.explore_cap_snapshots`)).rows[0].count);
  await pool.query(`UPDATE ${s}.confirmed_display_markets SET payload=jsonb_set(payload,'{market,metrics,marketCapUsd}','"invalid"') WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4`,[...id,h(2)]);
  await assert.rejects(publishMarketCapRanking(pool,deployment,schemaName,new Date(now.getTime()+63*60000)));
  assert.equal(Number((await pool.query(`SELECT count(*) FROM ${s}.explore_cap_snapshots`)).rows[0].count),beforeFailure);
  assert.deepEqual((await query({sort:'marketCapUsd_desc'},first.nextCursor!)).items.map((x:any)=>x.marketId),[h(3),h(2)]);
  await pool.query(`UPDATE ${s}.confirmed_display_markets SET payload=jsonb_set(payload,'{market,metrics,marketCapUsd}','"400"') WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4`,[...id,h(2)]);
  await pool.query(`UPDATE ${s}.explore_cap_snapshots SET created_at=now()-interval '3 hours' WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3`,id);
  assert.equal((await publishMarketCapRanking(pool,deployment,schemaName,new Date(now.getTime()+63*60000))).published,true);
  await assert.rejects(query({sort:'marketCapUsd_desc'},first.nextCursor!),PublicationChangedError);


 }finally{await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);await pool.end();}
});

test('0032 preserves old ranking cursors while legacy snapshots cannot become the latest rank',{timeout:120_000},async t=>{
 if(!url){t.skip('TG_TEST_DATABASE_URL required');return;}
 const schemaName=`tg_rank_upgrade_${randomBytes(5).toString('hex')}`,s=`"${schemaName}"`,{pool}=createDatabasePool(url,{max:2});
 const deployment={environment:'test' as const,chainId:46630 as const,deploymentDigest:h(888),activationBlock:1n},id=['test',46630,h(888)],revision=`10:${h(10)}`;
 const secret='ranking-upgrade-cursor-secret-32-bytes';
 try{
  for(const migration of migrationManifest().filter(m=>m.version<'0032_unified_rankings')){
   await pool.query(migrationSql(schemaName,migration.version));
   await pool.query(`UPDATE ${s}.schema_migrations SET digest=$1 WHERE version=$2`,[migration.digest,migration.version]);
  }
  await pool.query(`INSERT INTO ${s}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES($1,$2,$3,$4,0,$4,$4)`,[...id,h(1)]);
  await pool.query(`INSERT INTO ${s}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized,source_timestamp) VALUES($1,$2,$3,10,$4,$5,true,true,now())`,[...id,h(10),h(9)]);
  await pool.query(`INSERT INTO ${s}.publications(environment,chain_id,deployment_digest,scope,revision,block_number,block_hash,generation,payload_digest,payload) VALUES($1,$2,$3,'markets',$4,10,$5,1,$5,'{}')`,[...id,revision,h(10)]);
  await pool.query(`INSERT INTO ${s}.publication_pointers(environment,chain_id,deployment_digest,scope,revision) VALUES($1,$2,$3,'markets',$4)`,[...id,revision]);
  await pool.query(`INSERT INTO ${s}.confirmed_display_cursor(environment,chain_id,deployment_digest,block_number,block_hash,base_number,block_timestamp) VALUES($1,$2,$3,10,$4,10,10)`,[...id,h(10)]);
  for(const n of [1,2,3,4]){
   const metrics={status:'available',reason:`fixture-${n}`,volume24hUsd:null,marketCapUsd:String(n*100),quoteUsdMidpoint:'2',windowFromTimestamp:'0',asOfTimestamp:'10',usdPriceAsOf:null,usdPriceSource:null,volumeBasis:'EXTERNAL_EXECUTIONS_CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE',marketCapBasis:'TOTAL_SUPPLY_X_FINALIZED_SPOT_X_QUOTE_USD'};
   const market={marketId:h(n),memeToken:a(n),quoteAsset:a(99),assetUid:h(n),launchPhase:0,identity:{name:`Upgrade ${n}`,symbol:`U${n}`,deployedAt:String(n)},display:{priceQuote:'1',totalSupplyRaw:'1000000000000000000'},metrics};
   await pool.query(`INSERT INTO ${s}.projection_records(environment,chain_id,deployment_digest,scope,revision,identity,sort_key,payload_digest,payload) VALUES($1,$2,$3,'markets',$4,$5,$6,$7,$8)`,[...id,revision,h(n),h(n),h(n),market]);
   await pool.query(`INSERT INTO ${s}.confirmed_display_markets(environment,chain_id,deployment_digest,market_id,block_number,block_hash,payload) VALUES($1,$2,$3,$4,10,$5,$6)`,[...id,h(n),h(10),{market}]);
  }
  const olderNewVersion='new-explore-version',legacyVersion='old-market-cap-version';
  const now=new Date();
  await pool.query(`INSERT INTO ${s}.explore_cap_snapshots(environment,chain_id,deployment_digest,version,scheduled_at,created_at) VALUES($1,$2,$3,$4,$5,$5)`,[...id,olderNewVersion,new Date(now.getTime()-60*60_000)]);
  await pool.query(`INSERT INTO ${s}.explore_cap_ranks(environment,chain_id,deployment_digest,version,market_id,rank) VALUES($1,$2,$3,$4,$5,1),($1,$2,$3,$4,$6,2)`,[...id,olderNewVersion,h(4),h(3)]);
  await pool.query(`INSERT INTO ${s}.market_cap_snapshots(environment,chain_id,deployment_digest,version,scheduled_at,created_at,revision,block_hash) VALUES($1,$2,$3,$4,$5,$5,$6,$7)`,[...id,legacyVersion,new Date(now.getTime()+60*60_000),revision,h(10)]);
  const legacyMetrics1={status:'available',reason:'legacy-one',marketCapUsd:'222',volume24hUsd:null,quoteUsdMidpoint:'2',windowFromTimestamp:'0',asOfTimestamp:'10',usdPriceAsOf:null,usdPriceSource:null,volumeBasis:'EXTERNAL_EXECUTIONS_CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE',marketCapBasis:'TOTAL_SUPPLY_X_FINALIZED_SPOT_X_QUOTE_USD'};
  const legacyMetrics2={...legacyMetrics1,reason:'legacy-two',marketCapUsd:'111'};
  await pool.query(`INSERT INTO ${s}.market_cap_ranks(environment,chain_id,deployment_digest,version,market_id,rank,asset_uid,metrics) VALUES($1,$2,$3,$4,$5,1,$6,$7),($1,$2,$3,$4,$8,2,$9,$10)`,[...id,legacyVersion,h(2),h(2),legacyMetrics1,h(1),h(1),legacyMetrics2]);

  assert.equal(await applyCoreMigration(pool,schemaName),true,'apply 0032 and remaining migrations to the populated pre-0032 schema');
  assert.equal(await applyCoreMigration(pool,schemaName),false,'completed upgrade is idempotent');
  const kinds=(await pool.query(`SELECT relname,relkind FROM pg_class WHERE oid IN ($1::regclass,$2::regclass) ORDER BY relname`,[`${schemaName}.market_cap_snapshots`,`${schemaName}.market_cap_ranks`])).rows;
  assert.deepEqual(kinds.map(row=>row.relkind),['v','v'],'legacy names are compatibility views over the unified tables');
  assert.deepEqual((await pool.query(`SELECT version,legacy FROM ${s}.explore_cap_snapshots WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 ORDER BY version`,id)).rows,
   [{version:olderNewVersion,legacy:false},{version:legacyVersion,legacy:true}]);
  assert.deepEqual((await pool.query(`SELECT market_id,rank,metrics->>'marketCapUsd' cap FROM ${s}.explore_cap_ranks WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND version=$4 ORDER BY rank`,[...id,legacyVersion])).rows,
   [{market_id:h(2),rank:'1',cap:'222'},{market_id:h(1),rank:'2',cap:'111'}],'copied cursor ranks keep their saved metrics');

  const filter={assetUid:null,marketId:null,memeToken:null,launchPhase:null,stakingEnabled:null,search:null,createdFrom:null,createdTo:null,sort:'marketCapUsd_desc'};
  const stable=(value:any):string=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?`[${value.map(stable).join(',')}]`:`{${Object.entries(value).sort(([left],[right])=>left.localeCompare(right)).map(([key,item])=>`${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  const filterDigest=createHash('sha256').update(stable({deployment:id,filter,version:2})).digest('hex');
  const legacyCursor=encodeCursor({scope:'explore-ranking',revision:legacyVersion,filterDigest,sortKey:'1',identity:h(2)},secret);
  const legacyPage=await readPublishedMarketPage({pool,deployment,schemaName,secret,filter:{sort:'marketCapUsd_desc'},limit:2,cursor:legacyCursor});
  assert.deepEqual(legacyPage.items.map((item:any)=>item.marketId),[h(1)],'old cursor resumes at its saved rank');
  assert.equal((legacyPage.items[0] as any).metrics.marketCapUsd,'111','old cursor returns its migrated saved metric');
  assert.equal(legacyPage.ranking?.version,legacyVersion);
  const latest=await readPublishedMarketPage({pool,deployment,schemaName,secret,filter:{sort:'marketCapUsd_desc'}});
  assert.equal(latest.ranking?.version,olderNewVersion,'future scheduled legacy version cannot take over latest display ranking');
  assert.deepEqual(latest.items.map((item:any)=>item.marketId),[h(4),h(3)]);
 }finally{await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`).catch(()=>undefined);await pool.end();}
});
