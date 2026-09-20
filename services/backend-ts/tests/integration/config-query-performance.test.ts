import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import test from 'node:test';
import type {Pool} from 'pg';
import {applyCoreMigration,createDatabasePool} from '../../packages/db/src/index.ts';
import {publishStatsDisplay,readStatsDisplay} from '../../packages/confirmed-display/src/stats.ts';
import {runtimeConfigs} from '../../packages/runtime-deployment/src/index.ts';
import {readPublishedConfigPage} from '../../packages/read-store/src/index.ts';

const connectionString=process.env.TG_TEST_DATABASE_URL??process.env.TG_MIGRATION_DATABASE_URL??process.env.TG_DATABASE_URL;
const hash=(n:number):`0x${string}`=>`0x${n.toString(16).padStart(64,'0')}`;
const address=(n:number)=>`0x${n.toString(16).padStart(40,'0')}`;
const identifier=(value:string)=>`"${value}"`;
const secret='config-query-performance-cursor-secret';

test('config readers stay on shared sets with many publication anchors',{timeout:120000},async t=>{
 if(!connectionString){t.skip('local PostgreSQL required');return;}
 const schemaName=`tg_config_perf_${process.pid}_${randomBytes(4).toString('hex')}`,s=identifier(schemaName);
 const pool=createDatabasePool(connectionString,{max:2}).pool;
 const deployment={environment:'test' as const,chainId:46630 as const,deploymentDigest:hash(900001),activationBlock:1n};
 const ids=[deployment.environment,deployment.chainId,deployment.deploymentDigest];
 const captured:{stats?:string;page?:string;statsPlan?:unknown;pagePlan?:unknown}={};
 const instrumented=new Proxy(pool,{get(target,key){
  if(key==='query')return async(text:string,values?:readonly unknown[])=>{
   const sql=String(text);
   if(sql.includes('SELECT r.identity,r.sort_key,c.payload')&&sql.includes('config_set_records')){
    captured.page=sql;
    const explained=await target.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`,values as unknown[]|undefined);
    captured.pagePlan=explained.rows[0]?.['QUERY PLAN'];
   }else if(sql.includes('SELECT c.payload FROM')&&sql.includes('config_set_records')){
    captured.stats=sql;
    const explained=await target.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`,values as unknown[]|undefined);
    captured.statsPlan=explained.rows[0]?.['QUERY PLAN'];
   }
   return target.query(text as string,values as unknown[]|undefined);
  };
  const value=Reflect.get(target,key,target);
  return typeof value==='function'?value.bind(target):value;
 }}) as unknown as Pool;
 try{
  await applyCoreMigration(pool,schemaName);
  await pool.query(`INSERT INTO ${s}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES($1,$2,$3,$4,1,$4,$4)`,[...ids,hash(1)]);
  await pool.query(`INSERT INTO ${s}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,source_timestamp,canonical,finalized)
   SELECT $1,$2,$3,n,'0x'||lpad(to_hex(n),64,'0'),CASE WHEN n=1 THEN $4 ELSE '0x'||lpad(to_hex(n-1),64,'0') END,to_timestamp(1800000000+n),true,true FROM generate_series(1,1000)n`,[...ids,hash(0)]);
  await pool.query(`INSERT INTO ${s}.publications(environment,chain_id,deployment_digest,scope,revision,block_number,block_hash,generation,payload_digest,payload)
   SELECT $1,$2,$3,'configs',n::text||':'||('0x'||lpad(to_hex(n),64,'0')),n,'0x'||lpad(to_hex(n),64,'0'),0,$4,jsonb_build_object('recordCount',392,'algorithmVersion','query-perf-fixture') FROM generate_series(1,1000)n`,[...ids,hash(8)]);
  const set=(await pool.query<{id:string}>(`INSERT INTO ${s}.config_sets(payload_digest) VALUES($1) RETURNING id::text`,[hash(2)])).rows[0]!.id;
  const contentIdRows=await pool.query<{id:string}>(`INSERT INTO ${s}.config_contents(payload_digest,payload)
   SELECT '0x'||lpad(to_hex(n),64,'0'),jsonb_build_object('kind','asset','id','0x'||lpad(to_hex(n),64,'0'),'status',1,
    'values',jsonb_build_object('stockToken','0x'||lpad(to_hex(n),40,'0'),'tokenDecimals',18,'tokenSymbol','ASSET'||n))
   FROM generate_series(1,392)n RETURNING id::text`);
  assert.equal(contentIdRows.rows.length,392);
  await pool.query(`INSERT INTO ${s}.config_set_records(set_id,identity,sort_key,content_id)
   SELECT $1,'asset:'||'0x'||lpad(to_hex(n),64,'0'),'asset:'||'0x'||lpad(to_hex(n),64,'0'),n FROM generate_series(1,392)n`,[set]);
  await pool.query(`INSERT INTO ${s}.config_publication_sets(environment,chain_id,deployment_digest,scope,revision,set_id)
   SELECT $1,$2,$3,'configs',n::text||':'||('0x'||lpad(to_hex(n),64,'0')),$4 FROM generate_series(1,1000)n`,[...ids,set]);
  await pool.query(`INSERT INTO ${s}.publication_pointers(environment,chain_id,deployment_digest,scope,revision) VALUES($1,$2,$3,'configs',$4)`,[...ids,`1000:${hash(1000)}`]);

  for(const table of ['config_contents','config_sets','config_set_records','config_publication_sets','publication_pointers','publications','chain_blocks'])await pool.query(`ANALYZE ${s}.${table}`);

  // The stats publisher's first call exercises its missing-pointer fallback to
  // runtime configs; then it reads the current shared set after anchors exist.
  // Here the pointer is already present, so explicitly remove it for one pass.
  await pool.query(`DELETE FROM ${s}.publication_pointers WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='configs'`,ids);
  const block={number:1000n,hash:hash(1000) as `0x${string}`,parentHash:hash(999) as `0x${string}`,timestamp:1800001000n};
  await publishStatsDisplay(instrumented as never,deployment,block,schemaName,new Date(1800001000000));
  const fallback=await readStatsDisplay({pool,deployment,schemaName});
  assert.equal(fallback.sections.stocks.length,runtimeConfigs.filter(config=>config.kind==='asset').length,'stats publication uses runtime config fallback when pointer is absent');
  await pool.query(`INSERT INTO ${s}.publication_pointers(environment,chain_id,deployment_digest,scope,revision) VALUES($1,$2,$3,'configs',$4)`,[...ids,`1000:${hash(1000)}`]);
  await publishStatsDisplay(instrumented as never,deployment,block,schemaName,new Date(1800001001000));
  assert.match(captured.stats??' /missing stats config query/',/config_set_records/);
  assert.match(captured.stats??'',/config_publication_sets/);
  assert.doesNotMatch(captured.stats??'',/projection_read_records|projection_records/);
  const currentStats=await readStatsDisplay({pool,deployment,schemaName});
  assert.ok(currentStats.sections.stocks.some(stock=>stock.id===hash(392)),'stats publisher reads the current 392-record shared set');

  const readAll=async(revision?:string)=>{
   const items:unknown[]=[];let cursor:string|undefined;
   do{
    const page=await readPublishedConfigPage({pool:instrumented,deployment,kind:'asset',...(revision?{revision}:{}),secret,schemaName,limit:100,...(cursor?{cursor}:{})});
    items.push(...page.items);cursor=page.nextCursor??undefined;
   }while(cursor);
   return items;
  };
  assert.equal((await readAll()).length,392,'latest pointer resolves all shared set records');
  assert.equal((await readAll(`1:${hash(1)}`)).length,392,'explicit old revision resolves the same immutable set');
  assert.match(captured.page??'',/config_set_records/);
  assert.doesNotMatch(captured.page??'',/projection_read_records|projection_records/);
  const pagePlan=JSON.stringify(captured.pagePlan),statsPlan=JSON.stringify(captured.statsPlan);
  assert.doesNotMatch(pagePlan,/projection_records|projection_read_records/,'optimized page plan does not scan the former projection union');
  assert.doesNotMatch(statsPlan,/projection_records|projection_read_records/,'Stats plan does not scan the former projection union');
  const summarize=(plan:unknown)=>{
   const nodes:Record<string,unknown>[]=[];
   const visit=(value:unknown)=>{if(!value||typeof value!=='object')return;const row=value as Record<string,unknown>;
    if(row['Node Type'])nodes.push(Object.fromEntries(['Node Type','Relation Name','Index Name','Actual Rows','Actual Loops','Rows Removed by Filter','Actual Total Time','Shared Hit Blocks','Shared Read Blocks','Temp Read Blocks','Temp Written Blocks'].filter(key=>row[key]!==undefined).map(key=>[key,row[key]])));
    if(Array.isArray(row['Plans']))for(const child of row['Plans'])visit(child);
   };
   if(Array.isArray(plan))for(const item of plan)visit((item as Record<string,unknown>)['Plan']);
   return nodes;
  };
  for(const nodes of [summarize(captured.pagePlan),summarize(captured.statsPlan)])for(const node of nodes){
   if(['config_publication_sets','chain_blocks'].includes(String(node['Relation Name']))){
    assert.ok(Number(node['Actual Rows']??0)+Number(node['Rows Removed by Filter']??0)<=1,'resolve one publication/block, never scan historical anchors');
    assert.ok(Number(node['Actual Loops']??0)<=1,'canonical block and set lookup run once per query, not once per config');
   }
  }
  t.diagnostic(`392 configs; 1000 publication anchors share one set; page plan nodes=${JSON.stringify(summarize(captured.pagePlan))}; stats config plan nodes=${JSON.stringify(summarize(captured.statsPlan))}`);
  await pool.query(`UPDATE ${s}.chain_blocks SET canonical=false,finalized=false WHERE number=1`);
  await assert.rejects(readPublishedConfigPage({pool,deployment,kind:'asset',revision:`1:${hash(1)}`,secret,schemaName}),/requested publication is unavailable/,'explicit config reads still require a canonical finalized anchor');
  await pool.query(`DELETE FROM ${s}.publication_pointers WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='configs'`,ids);
  await assert.rejects(readPublishedConfigPage({pool,deployment,kind:'asset',secret,schemaName}),/publication is unavailable/,'read API remains fail-closed without a current pointer');
 }finally{
  await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`).catch(()=>undefined);
  await pool.end();
 }
});
