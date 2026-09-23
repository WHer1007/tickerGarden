import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import test from 'node:test';
import {applyCoreMigration,createDatabasePool,migrationManifest,migrationSql} from '../../packages/db/src/index.ts';
import {readConfirmedDetail} from '../../packages/confirmed-display/src/read.ts';
import {packDisplayState,unpackDisplayState,type DisplayState} from '../../packages/confirmed-display/src/state.ts';

const connectionString=process.env.TG_TEST_DISPLAY_DATABASE_URL??process.env.TG_TEST_DATABASE_URL??'postgresql:///postgres?host=/tmp';
const hash=(c:string):`0x${string}`=>`0x${c.repeat(64)}`;
const address=(c:string):`0x${string}`=>`0x${c.repeat(40)}`;
const clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v)) as T;

test('0031 stores shared detail fields and charts independently and reconstructs DB-only reads',{timeout:60000},async t=>{
 const schemaName=`tg_display_sections_${process.pid}_${randomBytes(4).toString('hex')}`,s=`"${schemaName}"`,pool=createDatabasePool(connectionString,{max:2}).pool;
 const deployment={environment:'test' as const,chainId:46630 as const,deploymentDigest:hash('a'),activationBlock:1n},marketId=hash('b');
 const id=[deployment.environment,deployment.chainId,deployment.deploymentDigest];
 const detail=(period:'1H'|'12H'|'1D',chartTag:string,price:string)=>({
  version:1,chainId:46630,displayOnly:true,marketId,memeToken:address('c'),quoteAsset:address('d'),quoteDecimals:18,period,
  statistics:{price,priceUsd:'2',marketCapUsd:'20',volume24h:'3'},chart:{interval:period,marker:chartTag,points:[{time:1,price:chartTag}]},
  trades:[{id:'trade-common'}],holders:{totalSupplyRaw:'100',circulatingSupplyRaw:'100',count:1,basis:'CHAIN_TOTAL_SUPPLY_V1',items:[]},fees:[{recipient:'creator',asset:address('d'),amountRaw:'4'}],
  sources:{statistics:{asOf:1},chart:{asOf:1},trades:{asOf:1},holders:{asOf:1},fees:{asOf:1}},reasons:{},
 });
 const views={ '1H':detail('1H','chart-hour','1'),'12H':detail('12H','chart-twelve','1'),'1D':detail('1D','chart-day','1') };
 const state={market:{marketId,memeToken:address('c'),quoteAsset:address('d'),quoteAssetConfigId:hash('e'),identity:{name:'Test',symbol:'TST'},content:null as null|{description:string},display:{priceQuote:'1'},launchPhase:1},balances:{[address('f')]:'100'},exclusions:[],detailViews:views,marker:'complete-state'};
 const detailState=(period:'1H'|'12H'|'1D')=>views[period];
 try{
  await applyCoreMigration(pool,schemaName);
  await pool.query(`INSERT INTO ${s}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES('test',46630,$1,$2,1,$3,$4)`,[deployment.deploymentDigest,hash('9'),hash('8'),hash('7')]);
  await pool.query(`INSERT INTO ${s}.confirmed_display_cursor(environment,chain_id,deployment_digest,block_number,block_hash,base_number,block_timestamp) VALUES($1,$2,$3,10,$4,10,1800000010)`,[...id,hash('8')]);
  await pool.query(`INSERT INTO ${s}.confirmed_display_markets(environment,chain_id,deployment_digest,market_id,block_number,block_hash,payload) VALUES($1,$2,$3,$4,10,$5,$6)`,[...id,marketId,hash('8'),state]);
  const stored=(await pool.query(`SELECT payload,launch_missing FROM ${s}.confirmed_display_markets WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4`,[...id,marketId])).rows[0];
  assert.equal(Object.hasOwn(stored.payload,'detailViews'),false,'whole nested detail is removed from the primary state row');
  assert.deepEqual((await pool.query(`SELECT section FROM ${s}.confirmed_display_sections WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4 ORDER BY section`,[...id,marketId])).rows.map(r=>r.section),['12H','1D','1H','common']);
  assert.deepEqual(stored.launch_missing,['content'],'split persistence keeps launch readiness');
  const packed=packDisplayState(state as unknown as DisplayState);
  assert.equal(Object.hasOwn(packed,'detailViews'),false,'undo snapshot omits repeated per-period common fields');
  assert.deepEqual(unpackDisplayState(packed),state,'pack and unpack preserve common fields and every period chart');

  const queryLog:string[]=[];
  const dbOnly={query:(sql:string,args?:unknown[])=>{queryLog.push(sql);return pool.query(sql,args);}} as unknown as Pick<typeof pool,'query'>;
  for(const period of ['1H','12H','1D'] as const){
   assert.deepEqual(await readConfirmedDetail(dbOnly,deployment,marketId,period,schemaName),detailState(period));
  }
  assert.equal(queryLog.length,3);assert.ok(queryLog.every(sql=>/^\s*SELECT\b/i.test(sql)),'detail reads are database-only SELECTs');
  assert.deepEqual(await readConfirmedDetail(dbOnly,deployment,marketId,'12H',schemaName,'activity'),{
   ...detailState('12H'),statistics:null,chart:null,holders:null,sources:{trades:{asOf:1},fees:{asOf:1}},reasons:{},trades:[{id:'trade-common'}],fees:[{recipient:'creator',asset:address('d'),amountRaw:'4'}],
  });

  const xmins=async()=>Object.fromEntries((await pool.query(`SELECT section,xmin::text FROM ${s}.confirmed_display_sections WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4`,[...id,marketId])).rows.map(r=>[r.section,r.xmin]));
  const beforeChart=await xmins(),chartOnly=clone(state);chartOnly.detailViews['12H'].chart={interval:'12H',marker:'chart-twelve-updated',points:[{time:2,price:'new'}]};
  await pool.query(`UPDATE ${s}.confirmed_display_markets SET payload=$5 WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4`,[...id,marketId,JSON.stringify(chartOnly)]);
  const afterChart=await xmins();
  assert.notEqual(afterChart['12H'],beforeChart['12H'],'changed chart receives a new tuple');
  assert.equal(afterChart.common,beforeChart.common,'chart edit does not rewrite shared common fields');
  assert.equal(afterChart['1H'],beforeChart['1H']);assert.equal(afterChart['1D'],beforeChart['1D']);
  assert.deepEqual((await pool.query(`SELECT launch_missing FROM ${s}.confirmed_display_markets WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4`,[...id,marketId])).rows[0].launch_missing,['content'],'chart edit preserves readiness');

  const beforePrice=await xmins(),priceChange=clone(chartOnly);priceChange.detailViews['1H'].statistics.price='2';priceChange.detailViews['12H'].statistics.price='2';priceChange.detailViews['1D'].statistics.price='2';
  await pool.query(`UPDATE ${s}.confirmed_display_markets SET payload=$5 WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4`,[...id,marketId,JSON.stringify(priceChange)]);
  const afterPrice=await xmins();
  assert.notEqual(afterPrice.common,beforePrice.common,'common price changes replace the shared row');
  assert.equal(afterPrice['1H'],beforePrice['1H'],'common price change leaves the 1H chart tuple intact');
  assert.equal(afterPrice['12H'],beforePrice['12H'],'common price change leaves the 12H chart tuple intact');
  assert.equal(afterPrice['1D'],beforePrice['1D'],'common price change leaves the 1D chart tuple intact');
  assert.deepEqual((await pool.query(`SELECT launch_missing FROM ${s}.confirmed_display_markets WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4`,[...id,marketId])).rows[0].launch_missing,['content'],'common update preserves readiness');

  const beforeUpsert=await xmins(),readyPayload=clone(priceChange);delete (readyPayload as any).detailViews;readyPayload.market.content={description:'ready'};
  await pool.query(`INSERT INTO ${s}.confirmed_display_markets(environment,chain_id,deployment_digest,market_id,block_number,block_hash,payload) VALUES($1,$2,$3,$4,10,$5,$6) ON CONFLICT(environment,chain_id,deployment_digest,market_id) DO UPDATE SET payload=excluded.payload`,[...id,marketId,hash('8'),JSON.stringify(readyPayload)]);
  assert.deepEqual((await pool.query(`SELECT launch_missing FROM ${s}.confirmed_display_markets WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4`,[...id,marketId])).rows[0].launch_missing,[],'detail-free upsert derives readiness from the current common fields and 1H chart');
  assert.deepEqual(await xmins(),beforeUpsert,'detail-free upsert leaves all persisted sections unchanged');
  const stillMissing=clone(readyPayload);stillMissing.market.content=null;
  await pool.query(`INSERT INTO ${s}.confirmed_display_markets(environment,chain_id,deployment_digest,market_id,block_number,block_hash,payload) VALUES($1,$2,$3,$4,10,$5,$6) ON CONFLICT(environment,chain_id,deployment_digest,market_id) DO UPDATE SET payload=excluded.payload`,[...id,marketId,hash('8'),JSON.stringify(stillMissing)]);
  assert.deepEqual((await pool.query(`SELECT launch_missing FROM ${s}.confirmed_display_markets WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4`,[...id,marketId])).rows[0].launch_missing,['content'],'readiness can change again without rewriting sections');

  const saved=(await pool.query(`SELECT ${s}.display_state(m) payload FROM ${s}.confirmed_display_markets m WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4`,[...id,marketId])).rows[0].payload;
  const failedCandidate=clone(saved);failedCandidate.detailViews['1H'].chart.marker='aborted-reorg';
  const undoPacked=packDisplayState(saved as DisplayState);
  assert.deepEqual(unpackDisplayState(undoPacked),saved,'packed reorg journal reconstructs common data and charts');
  await pool.query('BEGIN');
  try{
   await pool.query(`UPDATE ${s}.confirmed_display_markets SET payload=$5 WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4`,[...id,marketId,JSON.stringify(failedCandidate)]);
   await pool.query(`UPDATE ${s}.confirmed_display_markets SET payload=$5 WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4`,[...id,marketId,JSON.stringify(unpackDisplayState(undoPacked))]);
   await pool.query('COMMIT');
  }catch(error){await pool.query('ROLLBACK');throw error;}
  assert.deepEqual((await readConfirmedDetail(dbOnly,deployment,marketId,'1H',schemaName)),priceChange.detailViews['1H'],'transaction rollback restores common and chart storage atomically');
  assert.deepEqual((await pool.query(`SELECT launch_missing FROM ${s}.confirmed_display_markets WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4`,[...id,marketId])).rows[0].launch_missing,['content']);
  t.diagnostic('confirmed detail reconstructed from four persisted sections; row xmin checks show section-local writes');
 }finally{await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`).catch(()=>undefined);await pool.end();}
});

test('0031 migrates pre-existing populated market rows into common and chart sections',{timeout:60000},async()=>{
 const schemaName=`tg_display_sections_upgrade_${process.pid}_${randomBytes(4).toString('hex')}`,s=`"${schemaName}"`,pool=createDatabasePool(connectionString,{max:1}).pool;
 const deployment={environment:'test' as const,chainId:46630 as const,deploymentDigest:hash('1'),activationBlock:1n},marketId=hash('2');
 const detail=(period:'1H'|'12H'|'1D',marker:string)=>({version:1,chainId:46630,displayOnly:true,marketId,memeToken:address('3'),quoteAsset:address('4'),quoteDecimals:18,period,
  statistics:{price:'1',priceUsd:'2',marketCapUsd:'20',volume24h:'3'},chart:{period,marker},trades:[],holders:{totalSupplyRaw:'100',circulatingSupplyRaw:'100',count:0,basis:'CHAIN_TOTAL_SUPPLY_V1',items:[]},fees:[],sources:{statistics:{asOf:1},chart:{asOf:1},trades:{asOf:1},holders:{asOf:1},fees:{asOf:1}},reasons:{}});
 const legacy={market:{marketId,memeToken:address('3'),quoteAsset:address('4'),quoteAssetConfigId:hash('5'),identity:{name:'Legacy',symbol:'OLD'},content:null as null|{description:string},display:{priceQuote:'1'}},balances:{[address('6')]:'90'},detailViews:{'1H':detail('1H','old-hour'),'12H':detail('12H','old-12h'),'1D':detail('1D','old-day')},marker:'legacy'};
 const id=[deployment.environment,deployment.chainId,deployment.deploymentDigest];
 try{
  for(const migration of migrationManifest().filter(m=>m.version<'0031_display_sections')){
   await pool.query(migrationSql(schemaName,migration.version));
   await pool.query(`UPDATE ${s}.schema_migrations SET digest=$1 WHERE version=$2`,[migration.digest,migration.version]);
  }
  await pool.query(`INSERT INTO ${s}.confirmed_display_cursor(environment,chain_id,deployment_digest,block_number,block_hash,base_number,block_timestamp) VALUES($1,$2,$3,10,$4,10,1800000010)`,[...id,hash('7')]);
  await pool.query(`INSERT INTO ${s}.confirmed_display_markets(environment,chain_id,deployment_digest,market_id,block_number,block_hash,payload) VALUES($1,$2,$3,$4,10,$5,$6)`,[...id,marketId,hash('7'),legacy]);
  const before=(await pool.query(`SELECT launch_missing FROM ${s}.confirmed_display_markets WHERE market_id=$1`,[marketId])).rows[0].launch_missing;
  assert.equal(await applyCoreMigration(pool,schemaName),true);
  const main=(await pool.query(`SELECT payload,launch_missing FROM ${s}.confirmed_display_markets WHERE market_id=$1`,[marketId])).rows[0];
  assert.equal(Object.hasOwn(main.payload,'detailViews'),false,'upgrade removes legacy nested views from the main row');
  assert.deepEqual(main.launch_missing,before,'upgrade preserves the existing readiness result');
  assert.equal(Number((await pool.query(`SELECT count(*) FROM ${s}.confirmed_display_sections WHERE market_id=$1`,[marketId])).rows[0].count),4);
  assert.deepEqual((await pool.query(`SELECT ${s}.display_state(m) state FROM ${s}.confirmed_display_markets m WHERE market_id=$1`,[marketId])).rows[0].state,legacy,'upgrade reconstructs the complete legacy state');
  assert.equal(await applyCoreMigration(pool,schemaName),false);
 }finally{await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`).catch(()=>undefined);await pool.end();}
});
