import {initializeEventCoverage,resetEventCoverage,planDisplayEvents,readDisplayEvents,saveAppliedEvents,commitEventCoverage} from './inbox.ts';
import {hydrateDisplayHistory} from './history.ts';
import {readDisplayScan,discoverDisplayCreations,moduleMap,displayPoolIds} from './scan.ts';
import {applyStatsEvents,undoStatsEvents,seedStats,publishStatsDisplay,type StatsUndo} from './stats.ts';
import {validateRecentDisplay} from './recent-validation.ts';
import {publishExploreRanking} from './explore-ranking.ts';
import {publicMarketContent} from './content.ts';
import {latestPrices,preferredPrices} from '../../display-price/src/read.ts';
import {changeChannel,changedRegions,regions} from './changes.ts';
import type {Pool,PoolClient} from 'pg';
import {formatUnits,parseUnits} from 'viem';
import {parseLog,type DeploymentIdentity,type RpcTransport,type RpcBlock} from '../../chain/src/index.ts';
import {decodeF72Event} from '../../events/src/index.ts';
import {observeF72Market,nextMarketActivation,type MarketCreation} from '../../market-projector/src/index.ts';
import type {MarketReadModel,TokenDetailTrade} from '../../../openapi/generated/v1-client.ts';
import type {EventObservation,TradeActivity} from '../../analytics/src/index.ts';
import {applyDisplayEvents,emptyDisplayState,materializeDisplay,type DisplayState} from './state.ts';
export interface DisplayWorkerInput {pool:Pool;deployment:DeploymentIdentity;rpc:RpcTransport;schemaName?:string;eventDriven?:boolean;forceRecovery?:boolean}
export function displaySchema(name='tickergarden_serverless'){if(!/^[a-z][a-z0-9_]{0,62}$/.test(name))throw Error('Invalid display schema');return `"${name}"`;}
export const displayIdentity=(d:DeploymentIdentity)=>[d.environment,d.chainId,d.deploymentDigest];
type Cursor={block_number:string;block_hash:`0x${string}`;base_number:string;block_timestamp:string};
/** Independent worker: no settlement queue, publication or reward tables are written. */
export async function advanceConfirmedDisplay(input:DisplayWorkerInput):Promise<string>{
 const {pool,deployment:d,rpc}=input,schema=displaySchema(input.schemaName),id=displayIdentity(d),client=await pool.connect();
 let prices:ReturnType<typeof preferredPrices>|undefined;
 const materialize=async(state:DisplayState,head?:{number:string;hash:`0x${string}`;timestamp:number})=>{
  state=await hydrateDisplayHistory(client,d,state,input.schemaName);
  if(!prices){const now=new Date();prices=preferredPrices(await latestPrices(client,d,now,input.schemaName),now);}
  const price=prices.get(state.market.quoteAsset);
  const quoteUsd=price?.status==='available'&&price.bidUsd&&price.askUsd?formatUnits((parseUnits(price.bidUsd,36)+parseUnits(price.askUsd,36))/2n,36):null;
  const content=state.market.content??await publicMarketContent(client,state.market,input.schemaName);
  return materializeDisplay({...state,quoteUsd,quoteUsdAsOf:price?.asOf??null,quoteUsdSource:price?.source??null,market:{...state.market,content}},head);
 };
 const lock=`confirmed-display:${id.join(':')}`;let locked=false;
 try{
  locked=Boolean((await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked',[lock])).rows[0]?.locked);if(!locked)return 'busy';
  if(await rpc.chainId()!==BigInt(d.chainId))throw Error('Display chain mismatch');
  const base=(await client.query<Cursor>(`SELECT b.number::text block_number,b.hash block_hash,b.number::text base_number,extract(epoch from b.source_timestamp)::bigint::text block_timestamp FROM ${schema}.projection_checkpoints c JOIN ${schema}.chain_blocks b ON b.environment=c.environment AND b.chain_id=c.chain_id AND b.deployment_digest=c.deployment_digest AND b.number=c.next_block-1 WHERE c.environment=$1 AND c.chain_id=$2 AND c.deployment_digest=$3 AND c.scope='analytics' AND b.canonical AND b.finalized`,id)).rows[0];
  if(!base)return 'waiting:initial-history';
  const finalized=await rpc.finalizedBlock();
  if(BigInt(base.block_number)>finalized.number)return 'waiting:verified-baseline';
  await client.query(`INSERT INTO ${schema}.confirmed_display_cursor(environment,chain_id,deployment_digest,block_number,block_hash,base_number,block_timestamp) VALUES($1,$2,$3,$4,$5,$4,$6) ON CONFLICT DO NOTHING`,[...id,base.block_number,base.block_hash,base.block_timestamp]);
  let cursor=(await client.query<Cursor>(`SELECT * FROM ${schema}.confirmed_display_cursor WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3`,id)).rows[0]!;
  const statsHead=(await client.query<{block_number:string;block_hash:string;generated_at:Date}>(`SELECT block_number::text,block_hash,generated_at FROM ${schema}.stats_display_snapshots WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3`,id)).rows[0];
  const eventCoverage=input.eventDriven?await initializeEventCoverage(client,d,cursor,input.schemaName):undefined;
  if(BigInt(base.block_number)>BigInt(cursor.block_number)||(eventCoverage&&BigInt(eventCoverage.block_number)<BigInt(base.block_number))||(!statsHead&&cursor.block_number!==base.block_number)){
   if((await rpc.block(BigInt(base.block_number))).hash!==base.block_hash)throw Error('Display baseline not canonical');
   await client.query('BEGIN');try{
    await client.query(`DELETE FROM ${schema}.confirmed_display_markets WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3`,id);
    await client.query(`DELETE FROM ${schema}.confirmed_display_journal WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3`,id);
    await client.query(`UPDATE ${schema}.confirmed_display_cursor SET block_number=$4,base_number=$4,block_hash=$5,block_timestamp=$6,updated_at=now() WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3`,[...id,base.block_number,base.block_hash,base.block_timestamp]);if(input.eventDriven){await resetEventCoverage(client,d,base,input.schemaName);await commitEventCoverage(client,d,BigInt(base.block_number),base.block_hash,true,input.schemaName);}await client.query('COMMIT');cursor=base;if(!statsHead)return 'initialized:rebase';
   }catch(e){await client.query('ROLLBACK');throw e;}
  }
  // Seed quiet, pre-existing markets before moving the shared display cursor.
  // This is bounded and resumable; no user request triggers indexing or RPC.
  const missing=(await client.query<{payload:MarketCreation}>(`SELECT d.payload FROM ${schema}.market_creation_directory d JOIN ${schema}.chain_blocks b ON b.environment=d.environment AND b.chain_id=d.chain_id AND b.deployment_digest=d.deployment_digest AND b.hash=d.block_hash WHERE d.environment=$1 AND d.chain_id=$2 AND d.deployment_digest=$3 AND b.canonical AND b.finalized AND b.number<=$4 AND NOT EXISTS(SELECT 1 FROM ${schema}.confirmed_display_markets m WHERE m.environment=d.environment AND m.chain_id=d.chain_id AND m.deployment_digest=d.deployment_digest AND m.market_id=d.market_id) ORDER BY d.market_id LIMIT 100`,[...id,base.block_number])).rows;
  if(missing.length){
   // Older workers skipped quiet markets. Rewind only display state to a verified
   // baseline, then replay the tail once for all markets (never settlement data).
   if(cursor.block_number!==base.block_number){
    await client.query('BEGIN');try{
     await client.query(`DELETE FROM ${schema}.confirmed_display_markets WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3`,id);
     await client.query(`DELETE FROM ${schema}.confirmed_display_journal WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3`,id);
     await client.query(`UPDATE ${schema}.confirmed_display_cursor SET block_number=$4,base_number=$4,block_hash=$5,block_timestamp=$6,updated_at=now() WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3`,[...id,base.block_number,base.block_hash,base.block_timestamp]);
     if(input.eventDriven){await resetEventCoverage(client,d,base,input.schemaName);await commitEventCoverage(client,d,BigInt(base.block_number),base.block_hash,true,input.schemaName);}
     await client.query('COMMIT');
    }catch(e){await client.query('ROLLBACK');throw e;}
    return 'initialized:rebase';
   }
   const block=await rpc.block(BigInt(base.block_number));if(block.hash!==base.block_hash)throw Error('Display initialization baseline not canonical');
   await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');try{
    for(const row of missing){
     const market=(await client.query<{payload:MarketReadModel}>(`SELECT payload FROM ${schema}.projection_read_records WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='markets' AND identity=$4 AND revision=$5`,[...id,row.payload.marketId,`${base.block_number}:${base.block_hash}`])).rows[0]?.payload;
     if(!market?.display)throw Error('Display initialization waits for market baseline');
     const state=await seedState(input,client,row.payload,market,base,block);
     if(state.supply!==market.display.totalSupplyRaw)throw Error('Display baseline supply mismatch');
     state.nextRefreshAt=(await client.query<{next_at:string}>(`SELECT next_at::text FROM ${schema}.market_time_refresh WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4`,[...id,row.payload.marketId])).rows[0]?.next_at??null;
     await saveState(client,schema,id,await materialize(state));
    }
    await client.query('COMMIT');
   }catch(e){await client.query('ROLLBACK');throw e;}
   return `initialized:${missing.length}`;
  }
  if(!statsHead||statsHead.block_number!==cursor.block_number||statsHead.block_hash!==cursor.block_hash){
   if(cursor.block_number!==base.block_number)throw Error('Stats display cursor mismatch');
   await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');try{
    const block=await rpc.block(BigInt(cursor.block_number));if(block.hash!==cursor.block_hash)throw Error('Stats baseline changed');
    await seedStats(client,d,block,input.schemaName);
    await publishStatsDisplay(client,d,block,input.schemaName);
    await client.query('COMMIT');
   }catch(e){await client.query('ROLLBACK');throw e;}
  }
  // Undo newest batches until the stored head is canonical. Each undo and cursor
  // move is atomic, so readers never see half of a reorg correction.
  const observedHead=await rpc.latestBlock();
  let canonicalCursor=BigInt(cursor.block_number)<=observedHead.number&&(await rpc.block(BigInt(cursor.block_number))).hash===cursor.block_hash;
  const eventPlan=input.eventDriven?(canonicalCursor?await planDisplayEvents(client,d,rpc,cursor,input.forceRecovery,input.schemaName):{scan:true}):undefined;
  while((eventPlan?.replayFrom!==undefined&&BigInt(cursor.block_number)>=eventPlan.replayFrom)||!canonicalCursor){
   const entry=(await client.query<{previous_number:string;previous_hash:`0x${string}`;previous_timestamp:string;undo:Record<string,DisplayState|null>;stats_undo:StatsUndo}> (`SELECT * FROM ${schema}.confirmed_display_journal WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND block_number=$4`,[...id,cursor.block_number])).rows[0];
   if(!entry)throw Error('Display reorg crosses verified baseline; finalized history must recover first');
   const recent=(await client.query<{block_number:string;block_hash:string}>(`SELECT DISTINCT block_number::text,block_hash FROM ${schema}.recent_markets WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND canonical AND block_number>$4 AND block_number<=$5`,[...id,entry.previous_number,cursor.block_number])).rows;
   const orphanHashes:string[]=[];for(const row of recent){if(BigInt(row.block_number)>observedHead.number||(await rpc.block(BigInt(row.block_number))).hash!==row.block_hash)orphanHashes.push(row.block_hash);}
   await client.query('BEGIN');try{
    if(orphanHashes.length)await client.query(`UPDATE ${schema}.recent_markets SET canonical=false WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND block_hash=ANY($4::text[])`,[...id,orphanHashes]);
    for(const market of Object.keys(entry.undo))await client.query('SELECT pg_notify($1,$2)',[changeChannel(d,input.schemaName),JSON.stringify({marketId:market,regions,revision:`reorg:${entry.previous_hash}`})]);
    for(const [market,state]of Object.entries(entry.undo)){if(state)await saveState(client,schema,id,state);else await client.query(`DELETE FROM ${schema}.confirmed_display_markets WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4`,[...id,market]);}
    await undoStatsEvents(client,d,entry.previous_number,entry.stats_undo,input.schemaName);
    if(input.eventDriven)await resetEventCoverage(client,d,{block_number:entry.previous_number,block_hash:entry.previous_hash},input.schemaName);
    await client.query(`DELETE FROM ${schema}.confirmed_display_journal WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND block_number=$4`,[...id,cursor.block_number]);
    await client.query(`UPDATE ${schema}.confirmed_display_cursor SET block_number=$4,block_hash=$5,block_timestamp=$6,updated_at=now() WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3`,[...id,entry.previous_number,entry.previous_hash,entry.previous_timestamp]);await publishStatsDisplay(client,d,{number:BigInt(entry.previous_number),hash:entry.previous_hash,timestamp:BigInt(entry.previous_timestamp),parentHash:entry.previous_hash},input.schemaName);await client.query('COMMIT');
   }catch(e){await client.query('ROLLBACK');throw e;}
   cursor={...cursor,block_number:entry.previous_number,block_hash:entry.previous_hash,block_timestamp:entry.previous_timestamp};
   canonicalCursor=BigInt(cursor.block_number)<=observedHead.number&&(await rpc.block(BigInt(cursor.block_number))).hash===cursor.block_hash;
  }
  if(eventPlan?.repairOnly)return 'catchup:coverage';
  await validateRecentDisplay(client,d,rpc,observedHead.number,input.schemaName);
  await publishExploreRanking(client,d,input.schemaName);
  if(!statsHead||Date.now()-new Date(statsHead.generated_at).getTime()>=60_000){
   await client.query('BEGIN');try{await publishStatsDisplay(client,d,{number:BigInt(cursor.block_number),hash:cursor.block_hash,parentHash:cursor.block_hash,timestamp:BigInt(cursor.block_timestamp)},input.schemaName);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}
  }
  const head=observedHead,from=BigInt(cursor.block_number)+1n;
  if(from>head.number){await client.query(`UPDATE ${schema}.confirmed_display_cursor SET updated_at=now() WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3`,id);return 'current';}
  let to=from+199n<head.number?from+199n:head.number;
  let scanned=!input.eventDriven||eventPlan?.scan===true;
  let batch=scanned?await readDisplayScan(client,d,rpc,from,to,head.number,input.schemaName):await readDisplayEvents(client,d,rpc,from,head.number,input.schemaName);
  if(!batch){scanned=true;batch=await readDisplayScan(client,d,rpc,from,to,head.number,input.schemaName);}
  if(!scanned){
   if(!batch.logs.length)return 'current';
   to=batch.logs.reduce((n,l)=>l.blockNumber>n?l.blockNumber:n,from);
  }
  const anchor=await rpc.block(to);
  const {creations,logs}=batch;
  let modules=batch.modules;
  if(logs.some(l=>l.removed||l.blockNumber<from||l.blockNumber>to))throw Error('Display log range mismatch');
  const hashes=[...new Set(logs.map(l=>l.transactionHash))];const observations:EventObservation[]=[];
  const appliedLogs:ReturnType<typeof parseLog>[]=[],receiptBatches:ReturnType<typeof parseLog>[][]=[],receiptBlocks=new Map<bigint,RpcBlock>();
  for(const hash of hashes){
   const receipt=await rpc.call<Record<string,unknown>|null>('eth_getTransactionReceipt',[hash]);
   if(!receipt||receipt.status!=='0x1'||receipt.transactionHash!==hash||!Array.isArray(receipt.logs))throw Error('Confirmed receipt unavailable');
   const receiptLogs=receipt.logs.map(parseLog),expected=logs.filter(l=>l.transactionHash===hash);
   for(const l of expected)if(!receiptLogs.some(r=>r.logIndex===l.logIndex&&r.blockHash===l.blockHash&&r.blockNumber===l.blockNumber&&r.transactionIndex===l.transactionIndex&&r.address===l.address&&r.data===l.data&&JSON.stringify(r.topics)===JSON.stringify(l.topics)))throw Error('Display log/receipt mismatch');
   if(receipt.blockHash!==expected[0]!.blockHash||typeof receipt.blockNumber!=='string'||BigInt(receipt.blockNumber)!==expected[0]!.blockNumber)throw Error('Display receipt block mismatch');
   const n=expected[0]!.blockNumber;if(!receiptBlocks.has(n))receiptBlocks.set(n,await rpc.block(n));
   const block=receiptBlocks.get(n)!;
   for(const l of receiptLogs)if(l.removed||l.blockHash!==block.hash||l.blockNumber!==block.number||l.transactionHash!==hash)throw Error('Display receipt is not canonical');
   discoverDisplayCreations(creations,receiptLogs,d.chainId);
   appliedLogs.push(...expected);
   receiptBatches.push(receiptLogs);
  }
  modules=moduleMap([...creations.values()]);
  const allReceiptLogs=receiptBatches.flat();
  const poolIds=new Set(await displayPoolIds(client,d,modules,allReceiptLogs,input.schemaName));
  for(const receiptLogs of receiptBatches){
   for(const l of receiptLogs){
    const module=modules.get(l.address);if(!module)continue;
    if(module==='UniswapV4PoolManager'&&!poolIds.has(l.topics[1] as `0x${string}`))continue;
    const e=decodeF72Event(module,l);if(!e)continue;
    if(!receiptBlocks.has(l.blockNumber))receiptBlocks.set(l.blockNumber,await rpc.block(l.blockNumber));
    const block=receiptBlocks.get(l.blockNumber)!;if(block.hash!==l.blockHash)throw Error('Display receipt reorganized');
    appliedLogs.push(l);observations.push({event:e,timestamp:block.timestamp});
   }
  }
  observations.sort((a,b)=>Number(a.event.log.blockNumber-b.event.log.blockNumber)||Number(a.event.log.transactionIndex-b.event.log.transactionIndex)||Number(a.event.log.logIndex-b.event.log.logIndex));
  const changed=new Map<string,MarketCreation>();
  for(const c of creations.values())if(observations.some(o=>[c.memeToken,c.curve,c.gauge].includes(o.event.log.address)||o.event.args.marketId===c.marketId))changed.set(c.marketId,c);
  // PoolManager Swap uses poolId rather than marketId. Match only known pools.
  if(observations.some(o=>o.event.module==='UniswapV4PoolManager')){
   const rows=await client.query<{market_id:string;pool_id:string}>(`SELECT market_id,payload->'market'->>'poolId' pool_id FROM ${schema}.confirmed_display_markets WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 UNION SELECT identity market_id,payload->>'poolId' pool_id FROM ${schema}.projection_read_records WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='markets' AND revision=$4`,[...id,`${base.block_number}:${base.block_hash}`]);
   for(const r of rows.rows)if(observations.some(o=>o.event.args.id===r.pool_id)&&creations.has(r.market_id as `0x${string}`))changed.set(r.market_id,creations.get(r.market_id as `0x${string}`)!);
  }
  const due=(await client.query<{market_id:string}>(`SELECT market_id FROM ${schema}.confirmed_display_markets WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND (payload->>'nextRefreshAt')::bigint<=$4 UNION SELECT t.market_id FROM ${schema}.market_time_refresh t WHERE t.environment=$1 AND t.chain_id=$2 AND t.deployment_digest=$3 AND t.next_at<=$4 AND NOT EXISTS(SELECT 1 FROM ${schema}.confirmed_display_markets m WHERE m.environment=t.environment AND m.chain_id=t.chain_id AND m.deployment_digest=t.deployment_digest AND m.market_id=t.market_id)`,[...id,anchor.timestamp.toString()])).rows;
  for(const row of due){const c=creations.get(row.market_id as `0x${string}`);if(c)changed.set(row.market_id,c);}
  const undo:Record<string,DisplayState|null>={},next:DisplayState[]=[];
  for(const c of changed.values()){
   const prior=(await client.query<{payload:DisplayState}>(`SELECT payload FROM ${schema}.confirmed_display_markets WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4`,[...id,c.marketId])).rows[0]?.payload;
   undo[c.marketId]=prior??null;
   const market=await observeF72Market({creation:c,blockNumber:to,blockHash:anchor.hash,blockTimestamp:anchor.timestamp,primary:rpc,secondary:rpc,...(prior?{previous:prior.market}:{})}) as unknown as MarketReadModel;
   if(!market.display)throw Error('Confirmed market display state unavailable');
   const initial=prior??(BigInt(c.source.blockNumber)>=from?emptyDisplayState(c,market,anchor):await seedState(input,client,c,market,cursor));
   const state=applyDisplayEvents(initial,market,observations,anchor);
   state.nextRefreshAt=await nextMarketActivation({creation:c,blockNumber:to,blockHash:anchor.hash,blockTimestamp:anchor.timestamp,primary:rpc,secondary:rpc},market as unknown as Parameters<typeof nextMarketActivation>[1]);
   next.push(state);
  }
  if((await rpc.block(to)).hash!==anchor.hash||(await rpc.block(BigInt(cursor.block_number))).hash!==cursor.block_hash)throw Error('Display chain changed during observation');
  await client.query('BEGIN');try{
   for(const state of next){await saveState(client,schema,id,await materialize(state));const affected=changedRegions(undo[state.market.marketId]??null,state);if(affected.length)await client.query('SELECT pg_notify($1,$2)',[changeChannel(d,input.schemaName),JSON.stringify({marketId:state.market.marketId,regions:affected,revision:`${to}:${anchor.hash}`})]);}
   if(input.eventDriven){await saveAppliedEvents(client,d,appliedLogs,input.schemaName);if(scanned)await commitEventCoverage(client,d,to,anchor.hash,to===head.number,input.schemaName,from);}
   const statsUndo=await applyStatsEvents(client,d,observations,next,input.schemaName);
   if(observations.length)await publishStatsDisplay(client,d,anchor,input.schemaName);
   else await client.query(`UPDATE ${schema}.stats_display_snapshots SET block_number=$4,block_hash=$5 WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3`,[...id,to.toString(),anchor.hash]);
   await client.query(`INSERT INTO ${schema}.confirmed_display_journal(environment,chain_id,deployment_digest,block_number,block_hash,previous_number,previous_hash,previous_timestamp,undo,stats_undo) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[...id,to.toString(),anchor.hash,cursor.block_number,cursor.block_hash,cursor.block_timestamp,JSON.stringify(undo),JSON.stringify(statsUndo)]);
   await client.query(`UPDATE ${schema}.confirmed_display_cursor SET block_number=$4,block_hash=$5,block_timestamp=$6,updated_at=now() WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3`,[...id,to.toString(),anchor.hash,anchor.timestamp.toString()]);
   await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e;}
  // Once chain-finalized, an undo entry is no longer needed for the display tail.
  const safePrune=input.eventDriven?BigInt((await client.query<{block_number:string}>(`SELECT block_number::text FROM ${schema}.display_event_coverage WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3`,id)).rows[0]!.block_number):finalized.number;
  const prune=safePrune<finalized.number?safePrune:finalized.number;
  await client.query(`DELETE FROM ${schema}.confirmed_display_journal WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND block_number<=$4`,[...id,prune.toString()]);
  if(input.eventDriven)for(const table of ['display_event_inbox','display_event_applied'])await client.query(`DELETE FROM ${schema}.${table} WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND block_number<=$4`,[...id,prune.toString()]);
  if(!statsHead||Date.now()-new Date(statsHead.generated_at).getTime()>=60_000){
   await client.query(`DELETE FROM ${schema}.stats_display_flows WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND block_number<=$4 AND occurred_at<$5`,[...id,finalized.number.toString(),Number(finalized.timestamp)-2*86400]);
   await client.query(`DELETE FROM ${schema}.stats_display_buckets WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND minute<$4 AND amount=0`,[...id,Number(finalized.timestamp)-2*86400]);
  }
  return `${scanned&&to<head.number?'catchup':'confirmed'}:${to}:${changed.size}`;
 }finally{if(locked)await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[lock]).catch(()=>{});client.release();}
}
async function saveState(client:PoolClient,schema:string,id:unknown[],state:DisplayState){await client.query(`INSERT INTO ${schema}.confirmed_display_markets(environment,chain_id,deployment_digest,market_id,block_number,block_hash,payload) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(environment,chain_id,deployment_digest,market_id) DO UPDATE SET block_number=excluded.block_number,block_hash=excluded.block_hash,payload=excluded.payload`,[...id,state.market.marketId,state.blockNumber,state.blockHash,JSON.stringify(state)]);}
async function seedState(input:DisplayWorkerInput,client:PoolClient,creation:MarketCreation,market:MarketReadModel,cursor:Cursor,baselineBlock?:RpcBlock):Promise<DisplayState>{
 const schema=displaySchema(input.schemaName),id=displayIdentity(input.deployment);
 // A market must be seeded from the exact cursor baseline, never today's mutable
 // holder balances. If settlement has advanced meanwhile, retry/rebase explicitly.
 const current=(await client.query<{next_block:string}>(`SELECT next_block FROM ${schema}.projection_checkpoints WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='analytics'`,id)).rows[0];
 if(!current||BigInt(current.next_block)-1n!==BigInt(cursor.block_number))throw Error('Display baseline changed before market initialization');
 const block=baselineBlock??await input.rpc.block(BigInt(cursor.block_number)),state=emptyDisplayState(creation,market,block);
 const balances=await client.query<{account:string;balance_raw:string;excluded:boolean}>(`SELECT account,balance_raw::text,excluded FROM ${schema}.holder_balances WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4`,[...id,creation.marketId]);
 state.balances=Object.fromEntries(balances.rows.map(r=>[r.account,r.balance_raw]));state.exclusions=[...new Set([...state.exclusions,...balances.rows.filter(r=>r.excluded).map(r=>r.account)])];state.supply=balances.rows.reduce((n,r)=>n+BigInt(r.balance_raw),0n).toString();
 const history=await client.query<{payload:TradeActivity}>(`SELECT t.payload FROM ${schema}.market_trades t JOIN ${schema}.chain_blocks b ON b.environment=t.environment AND b.chain_id=t.chain_id AND b.deployment_digest=t.deployment_digest AND b.hash=t.block_hash WHERE t.environment=$1 AND t.chain_id=$2 AND t.deployment_digest=$3 AND t.market_id=$4 AND b.canonical AND b.finalized AND b.number<=$5 AND t.occurred_at>=to_timestamp($6) ORDER BY b.number DESC,(t.payload->'source'->>'transactionIndex')::bigint DESC,t.log_index DESC`,[...id,creation.marketId,cursor.block_number,Number(block.timestamp)-86400]);
 state.trades=history.rows.map(({payload:t})=>displayTrade(t));
 state.fees=(await client.query<DisplayState['fees'][number]>(`SELECT recipient,asset,amount_raw::text "amountRaw" FROM ${schema}.detail_fee_totals WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4`,[...id,creation.marketId])).rows;state.historyFrom=Number(block.timestamp)-86400;
 const after=(await client.query<{next_block:string}>(`SELECT next_block FROM ${schema}.projection_checkpoints WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='analytics'`,id)).rows[0];if(after?.next_block!==current.next_block)throw Error('Display seed changed during read');return state;
}

function displayTrade(t:TradeActivity):TokenDetailTrade{return {timestamp:Number(t.timestamp),side:t.side,price:formatUnits(BigInt(t.price.numerator)*10n**36n/BigInt(t.price.denominator),36),memeRaw:t.memeRaw,quoteRaw:t.quoteRaw,actor:t.actor,txHash:t.source.transactionHash,eventKey:t.source.eventKey,classification:t.classification};}
