// Dedicated local database only; synthetic records and trades, no RPC or chain writes.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {applyCoreMigration,createDatabasePool} from '../../services/backend-ts/packages/db/src/index.ts';
import {publishMarketCapRanking} from '../../services/backend-ts/packages/display-price/src/ranking.ts';
import {readPublishedMarketPage} from '../../services/backend-ts/packages/read-store/src/index.ts';
const url=process.env.TG_TEST_DATABASE_URL;assert.ok(url&&new URL(url).hostname==='127.0.0.1');
const {pool}=createDatabasePool(url,{max:8,options:'-c statement_timeout=120000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=120000'}),schemaName=process.env.TG_RANKING_RESUME_SCHEMA??('tg_ranking_scale_'+randomBytes(4).toString('hex')),s=`"${schemaName}"`;
const h=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),a=n=>'0x'+BigInt(n).toString(16).padStart(40,'0'),id=['test',46630,h(999)],deployment={environment:'test',chainId:46630,deploymentDigest:h(999),activationBlock:1n};
assert.match(schemaName,/^tg_ranking_scale_[a-f0-9]{8}$/);
const revision=`10:${h(10)}`,report={scope:'synthetic local PostgreSQL; not production capacity',stages:[]};
try{
 if(!process.env.TG_RANKING_RESUME_SCHEMA){
 await applyCoreMigration(pool,schemaName);
 await pool.query(`INSERT INTO ${s}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES($1,$2,$3,$4,1,$4,$4)`,[...id,h(1)]);
 await pool.query(`INSERT INTO ${s}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized,source_timestamp) VALUES($1,$2,$3,10,$4,$5,true,true,now())`,[...id,h(10),h(9)]);
 await pool.query(`INSERT INTO ${s}.publications(environment,chain_id,deployment_digest,scope,revision,block_number,block_hash,generation,payload_digest,payload) VALUES($1,$2,$3,'markets',$4,10,$5,0,$5,'{}')`,[...id,revision,h(10)]);
 await pool.query(`INSERT INTO ${s}.publication_pointers(environment,chain_id,deployment_digest,scope,revision) VALUES($1,$2,$3,'markets',$4)`,[...id,revision]);
 const now=new Date(),price={token:a(99),source:'coinbase_spot',status:'available',bidUsd:'2',askUsd:'2',asOf:now.toISOString(),expiresAt:new Date(+now+86400000).toISOString()};
 await pool.query(`INSERT INTO ${s}.price_references(environment,chain_id,deployment_digest,asset,source,status,as_of,expires_at,payload) VALUES($1,$2,$3,$4,'coinbase_spot','available',$5,$6,$7)`,[...id,a(99),price.asOf,price.expiresAt,price]);
 }
 const now=new Date();
 let previous=process.env.TG_RANKING_RESUME_SCHEMA?20000:0;
 for(const count of [20000,50000]){
  const recordsAt=performance.now();
  if(count>previous)await pool.query(`INSERT INTO ${s}.projection_records(environment,chain_id,deployment_digest,scope,revision,identity,sort_key,payload_digest,payload)
  SELECT $1,$2,$3,'markets',$4,'0x'||lpad(to_hex(n),64,'0'),'0x'||lpad(to_hex(n),64,'0'),$5::text,
  jsonb_build_object('marketId','0x'||lpad(to_hex(n),64,'0'),'assetUid','0x'||lpad(to_hex(n%194),64,'0'),'memeToken','0x'||lpad(to_hex(n),40,'0'),'quoteAsset',$6::text,'launchPhase',0,'sourceVersion',1,
   'identity',jsonb_build_object('name','Market '||n,'symbol','T'||n,'deployedAt',n::text),
   'display',jsonb_build_object('priceQuote',n::text,'totalSupplyRaw','100000000000000000000','blockNumber','10','blockHash',$5::text))
  FROM generate_series($7::int,$8::int) n`,[...id,revision,h(10),a(99),previous+1,count]);
  // Twenty finalized historical buys per project; triggers maintain the one-row head.
  for(let start=previous+1;start<=count;start+=1000){
   await pool.query(`INSERT INTO ${s}.market_trades(environment,chain_id,deployment_digest,market_id,block_hash,transaction_hash,log_index,occurred_at,classification,base_raw,quote_raw,payload)
   SELECT $1,$2,$3,'0x'||lpad(to_hex(n),64,'0'),$4,'0x'||lpad(to_hex(n*20+seq),64,'0'),0,now(),'unclassified',1,1,
   jsonb_build_object('side','buy','timestamp','10','source',jsonb_build_object('blockNumber','10','transactionIndex',(n*20+seq)::text)) FROM generate_series($5::int,$6::int) n CROSS JOIN generate_series(1,20) seq`,[...id,h(10),start,Math.min(start+999,count)]);
  }
  console.log(`Seeded ${count} projects / ${count*20} buys`);
  const seededMs=performance.now()-recordsAt;
  await pool.query(`ANALYZE ${s}.market_latest_buys`);await pool.query(`ANALYZE ${s}.projection_records`);
  const buildAt=performance.now();const built=await publishMarketCapRanking(pool,deployment,schemaName,new Date(+now+(count===50000?21*60000:0)));assert.ok(built.published?built.markets===count:built.reason==='current');const buildMs=performance.now()-buildAt;
  await pool.query(`ANALYZE ${s}.market_cap_ranks`);
  const request=(sort,extra={},cursor)=>readPublishedMarketPage({pool,deployment,schemaName,secret:'local-ranking-capacity-secret-32-bytes',filter:{sort,launchPhase:0,...extra},limit:40,...(cursor?{cursor}:{})});
  const measures=[];
  for(const sort of ['recentBuy_desc','marketCapUsd_desc']){
   let cursor;const seen=new Set();let page100;
   for(let page=1;page<=100;page++){const at=performance.now(),result=await request(sort,{},cursor);assert.equal(result.items.length,40);for(const item of result.items){assert.ok(!seen.has(item.marketId));seen.add(item.marketId);}if(page===1)assert.equal(result.items[0].marketId,h(count));cursor=result.nextCursor;if(page===100)page100=performance.now()-at;}
   const samples=[];for(let i=0;i<20;i++){const at=performance.now();await request(sort,{assetUid:h(17)});samples.push(performance.now()-at);}samples.sort((a,b)=>a-b);
   const search=await request(sort,{search:'Market 12345'});assert.equal(search.items[0].marketId,h(12345));
   const runs=[];for(const concurrency of [16,64]){const at=performance.now(),durations=[];await Promise.all(Array.from({length:concurrency},async()=>{const start=performance.now();await request(sort);durations.push(performance.now()-start);}));durations.sort((a,b)=>a-b);runs.push({concurrency,success:durations.length,wallMs:performance.now()-at,p95Ms:durations[Math.ceil(durations.length*.95)-1]});}
   measures.push({sort,page100Ms:page100,stockP95Ms:samples[18],concurrency:runs});
  }
  report.stages.push({projects:count,historicalBuys:count*20,seededMs,buildMs,measures});previous=count;console.log(JSON.stringify(report.stages.at(-1)));
 }
}finally{await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);await pool.end();writeFileSync(new URL('../../outputs/ranking-capacity.json',import.meta.url),JSON.stringify(report,null,2));}
