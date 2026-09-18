import {createHash} from 'node:crypto';
import {verifySnapshotArtifact,type SnapshotArtifact} from '../../chain/src/holder-artifact.ts';
import {canonicalSnapshotJson} from '../../chain/src/holder-snapshot.ts';
import {advanceSnapshotLedger,workKey,ledgerWhere,type LedgerOptions} from './holder-snapshot-ledger.ts';
import {CURRENT_CHAIN_ID} from '../../runtime-deployment/src/index.ts';
import {compactSnapshotDataset} from '../../chain/src/holder-snapshot.ts';
import {indexHolderDataset} from '../../chain/src/holder-proof-index.ts';
import { ProjectionPending } from '../../projection/src/index.ts';
import type { Pool } from 'pg';
import { toHex, encodeFunctionData, decodeFunctionResult, type Abi, type Address, type Hex } from 'viem';
import { transaction } from '../../db/src/index.ts';
import { consensusBlock, deserializeRpcLog, type DeploymentIdentity, type RpcTransport } from '../../chain/src/index.ts';
import { SNAPSHOT_MODE, buildSnapshot, type SnapshotDataset } from '../../chain/src/holder-snapshot.ts';
import { CURRENT_RELEASE_ID, decodeF72Event, fixedF72Sources } from '../../events/src/index.ts';
import { snapshotAbis } from '../../events/src/f72-abis.generated.ts';

export interface SnapshotOptions { pool: Pool; deployment: DeploymentIdentity; primary: RpcTransport; secondary: RpcTransport; schemaName?: string }
export function snapshotSchema(name='tickergarden_serverless') { if(!/^[a-z][a-z0-9_]{0,62}$/.test(name))throw Error('invalid schema');return `"${name}"`; }
export function snapshotIdentity(d:DeploymentIdentity) { return [d.environment,d.chainId,d.deploymentDigest]; }
export const snapshotDistributor = () => fixedF72Sources().find(s=>s.module==='HolderRewardsDistributorV1')!.address as Address;
const abi=snapshotAbis.HolderRewardsDistributorV1 as Abi;
export async function snapshotRead(o:SnapshotOptions, block:bigint,target:Address, contractAbi:Abi,fn:string,args:readonly unknown[]=[]) {
 const data=encodeFunctionData({abi:contractAbi,functionName:fn,args});
 const [a,b]=await Promise.all([o.primary.callAt(target,data,block),o.secondary.callAt(target,data,block)]);
 if(a!==b)throw Error(`snapshot RPC disagreement: ${fn}`);
 return decodeFunctionResult({abi:contractAbi,functionName:fn,data:a});
}
const json = <T>(v:unknown):T => JSON.parse(JSON.stringify(v,(_,v)=>typeof v==='bigint'?v.toString():v));
async function verifySnapshotContext(o:SnapshotOptions,block:bigint) {
 if(o.deployment.chainId!==CURRENT_CHAIN_ID||o.deployment.deploymentDigest!==CURRENT_RELEASE_ID)throw Error('unsupported snapshot deployment');
 const source=fixedF72Sources().find(s=>s.module==='HolderRewardsDistributorV1')!;
 for(const rpc of [o.primary,o.secondary]) {
  if(BigInt(await rpc.call<string>('eth_chainId',[]))!==BigInt(o.deployment.chainId))throw Error('snapshot RPC chain mismatch');
  if(await rpc.codeHash(source.address,block)!==source.runtimeCodeHash)throw Error('snapshot distributor code drift');
 }
}
export interface SnapshotMarket { token:Address;quote:Address;vault:Address;registeredBlock:string;lastRound:string;lastSnapshotBlock:string;unallocatedQuote:string;unallocatedMeme:string;burnMemeFees:boolean;publisher:Address;exclusions:Address[] }

/** Rebuild event-derived round/claim state atomically, including on reorg. Datasets remain immutable. */
export async function projectHolderRewards(o:SnapshotOptions & {blockNumber:bigint;blockHash:Hex;generation:bigint}) {
 const schema=snapshotSchema(o.schemaName), id=snapshotIdentity(o.deployment), distributor=snapshotDistributor();
 const prior=(await o.pool.query<{next_block:string;generation:string}>(`SELECT next_block,generation FROM ${schema}.projection_checkpoints WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='holder-rewards'`,id)).rows[0];
 const incremental=prior&&BigInt(prior.generation)===o.generation&&BigInt(prior.next_block)<=o.blockNumber+1n;
 const from=incremental?BigInt(prior.next_block):o.deployment.activationBlock;
 const requested=o.blockNumber;
 // Bound each commit by complete blocks. One unusually busy block is staged in pages and
 // committed with set-based SQL, never materialized in application memory.
 if(from<=requested){
  const edge=(await o.pool.query<{number:string;hash:Hex}>(`SELECT b.number::text,b.hash FROM ${schema}.chain_logs l JOIN ${schema}.chain_blocks b ON b.environment=l.environment AND b.chain_id=l.chain_id AND b.deployment_digest=l.deployment_digest AND b.hash=l.block_hash WHERE l.environment=$1 AND l.chain_id=$2 AND l.deployment_digest=$3 AND l.address=$4 AND l.canonical AND b.canonical AND b.finalized AND b.number BETWEEN $5 AND $6 ORDER BY b.number,l.transaction_index,l.log_index LIMIT 1 OFFSET 1000`,[...id,distributor,from.toString(),requested.toString()])).rows[0];
  if(edge){const before=(await o.pool.query<{number:string;hash:Hex}>(`SELECT number::text,hash FROM ${schema}.chain_blocks WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND number>=$4 AND number<$5 AND canonical AND finalized ORDER BY number::bigint DESC LIMIT 1`,[...id,String(from),edge.number])).rows[0];const anchor=before??edge;o={...o,blockNumber:BigInt(anchor.number),blockHash:anchor.hash};}
 }
 const stageArgs=[...id,o.blockHash,o.generation.toString()];
 type WorkEvent={eventName:string;args:Record<string,unknown>;log:{blockNumber:string;blockHash:string}};
 type Work={from_block:string;event_count:number;market_count:number;scan_complete:boolean;after_block:string;after_tx:string;after_log:string};
 let work:Work|undefined;
 if(from<=o.blockNumber){
  await transaction(o.pool,async client=>{
   await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`holder-work:${stageArgs.join(':')}`]);
   work=(await client.query<Work>(`SELECT * FROM ${schema}.holder_work_candidates WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND block_hash=$4 AND generation=$5`,stageArgs)).rows[0];
   if(work&&BigInt(work.from_block)!==from)throw Error('holder work checkpoint conflict');
   if(!work){await client.query(`INSERT INTO ${schema}.holder_work_candidates(environment,chain_id,deployment_digest,block_hash,generation,from_block,event_count,market_count,scan_complete) VALUES($1,$2,$3,$4,$5,$6,0,0,false)`,[...stageArgs,String(from)]);work={from_block:String(from),event_count:0,market_count:0,scan_complete:false,after_block:'-1',after_tx:'-1',after_log:'-1'};}
   if(work.scan_complete)return;
   const rows=(await client.query<{payload:Record<string,unknown>;number:string;tx:string;log:string}>(`SELECT l.payload,b.number::text,l.transaction_index::text tx,l.log_index::text log FROM ${schema}.chain_logs l JOIN ${schema}.chain_blocks b ON b.environment=l.environment AND b.chain_id=l.chain_id AND b.deployment_digest=l.deployment_digest AND b.hash=l.block_hash WHERE l.environment=$1 AND l.chain_id=$2 AND l.deployment_digest=$3 AND l.address=$4 AND l.canonical AND b.canonical AND b.finalized AND b.number BETWEEN $5 AND $6 AND (b.number,l.transaction_index,l.log_index)>($7,$8,$9) ORDER BY b.number,l.transaction_index,l.log_index LIMIT 500`,[...id,distributor,String(from),String(o.blockNumber),work.after_block,work.after_tx,work.after_log])).rows;
   const decoded=json<WorkEvent[]>(rows.map(r=>{const e=decodeF72Event('HolderRewardsDistributorV1',deserializeRpcLog(r.payload));if(!e)throw Error('unknown holder event');return e;}));
   const ids=[...new Set(decoded.filter(e=>typeof e.args.marketId==='string').map(e=>String(e.args.marketId)))];
   if(decoded.length)await client.query(`INSERT INTO ${schema}.holder_work_events SELECT $1,$2,$3,$4,$5,r.ordinal,r.payload FROM jsonb_to_recordset($6::jsonb) r(ordinal integer,payload jsonb)`,[...stageArgs,JSON.stringify(decoded.map((payload,i)=>({ordinal:work!.event_count+i,payload})))]);
   const markets=ids.length?await client.query(`INSERT INTO ${schema}.holder_market_work SELECT $1,$2,$3,$4,$5,unnest($6::text[]) ON CONFLICT DO NOTHING`,[...stageArgs,ids]):{rowCount:0};
   const last=rows.at(-1);Object.assign(work,{event_count:work.event_count+decoded.length,market_count:work.market_count+(markets.rowCount??0),scan_complete:rows.length<500,after_block:last?.number??work.after_block,after_tx:last?.tx??work.after_tx,after_log:last?.log??work.after_log});
   await client.query(`UPDATE ${schema}.holder_work_candidates SET event_count=$6,market_count=$7,scan_complete=$8,after_block=$9,after_tx=$10,after_log=$11 WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND block_hash=$4 AND generation=$5`,[...stageArgs,work.event_count,work.market_count,work.scan_complete,work.after_block,work.after_tx,work.after_log]);
  });
  if(!work!.scan_complete)throw new ProjectionPending(`holder-rewards:${o.blockNumber}:scan`,requested,work!.event_count);
 }
 const marketIds=work?(await o.pool.query<{market_id:string}>(`SELECT w.market_id FROM ${schema}.holder_market_work w WHERE w.environment=$1 AND w.chain_id=$2 AND w.deployment_digest=$3 AND w.block_hash=$4 AND w.generation=$5 AND NOT EXISTS(SELECT 1 FROM ${schema}.projection_observations s WHERE s.environment=w.environment AND s.chain_id=w.chain_id AND s.deployment_digest=w.deployment_digest AND s.scope='holder-rewards' AND s.block_hash=w.block_hash AND s.generation=w.generation AND s.algorithm_version='holder-incremental-v3' AND s.identity=w.market_id) ORDER BY w.market_id LIMIT 129`,stageArgs)).rows.map(r=>r.market_id):[];
 const states=new Map<string,SnapshotMarket>();
 let publisher:Address|undefined;
 if(marketIds.length){
  const mode=await snapshotRead(o,o.blockNumber,distributor,abi,'rewardMode');if(mode!==SNAPSHOT_MODE)throw Error('wrong holder reward mode');
  publisher=String(await snapshotRead(o,o.blockNumber,distributor,abi,'snapshotPublisher')).toLowerCase() as Address;
  const pending=marketIds.filter(marketId=>!states.has(marketId));
  for(let offset=0;offset<Math.min(pending.length,128);offset+=8){
   await Promise.all(pending.slice(offset,Math.min(offset+8,128)).map(async marketId=>{
   const state=json<SnapshotMarket>(await snapshotRead(o,o.blockNumber,distributor,abi,'marketState',[marketId]));
   const exclusions=(await snapshotRead(o,o.blockNumber,distributor,abi,'feeSharingExcludedAccounts',[marketId]) as Address[]).map(a=>a.toLowerCase() as Address);
   states.set(marketId,{...state,token:state.token.toLowerCase() as Address,quote:state.quote.toLowerCase() as Address,vault:state.vault.toLowerCase() as Address,publisher:publisher!,exclusions});
   }));
   const batch=pending.slice(offset,Math.min(offset+8,128)).map(identity=>({identity,payload:states.get(identity)}));
   if((await consensusBlock(o.primary,o.secondary,o.blockNumber)).hash!==o.blockHash)throw Error('holder observation anchor changed');
   const persisted=await o.pool.query(`INSERT INTO ${schema}.projection_observations AS current(environment,chain_id,deployment_digest,scope,block_number,block_hash,generation,algorithm_version,identity,payload)
    SELECT $1,$2,$3,'holder-rewards',$6,$4,$5,'holder-incremental-v3',r.identity,r.payload FROM jsonb_to_recordset($7::jsonb) AS r(identity text,payload jsonb) ON CONFLICT(environment,chain_id,deployment_digest,scope,block_hash,generation,algorithm_version,identity) DO UPDATE SET payload=current.payload WHERE current.payload=EXCLUDED.payload RETURNING identity`,[...stageArgs,o.blockNumber.toString(),JSON.stringify(batch)]);
   if(persisted.rowCount!==batch.length)throw Error('conflicting Holder observation at finalized anchor');
  }
  if(pending.length>128){const done=(await o.pool.query<{n:string}>(`SELECT count(*)::text n FROM ${schema}.projection_observations WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='holder-rewards' AND block_hash=$4 AND generation=$5 AND algorithm_version='holder-incremental-v3'`,stageArgs)).rows[0];throw new ProjectionPending(`holder-rewards:${o.blockNumber}:markets`,requested,Number(done?.n));}
 }
 if(work){
  const counts=(await o.pool.query<{events:string;markets:string;publisher_changed:boolean}>(`SELECT (SELECT count(*) FROM ${schema}.holder_work_events WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND block_hash=$4 AND generation=$5)::text events,(SELECT count(*) FROM ${schema}.projection_observations WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='holder-rewards' AND block_hash=$4 AND generation=$5 AND algorithm_version='holder-incremental-v3')::text markets,EXISTS(SELECT 1 FROM ${schema}.holder_work_events WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND block_hash=$4 AND generation=$5 AND payload->>'eventName'='SnapshotPublisherChanged') publisher_changed`,stageArgs)).rows[0]!;
  if(Number(counts.events)!==work.event_count||Number(counts.markets)!==work.market_count)throw Error('holder work coverage mismatch');
  if(counts.publisher_changed&&!publisher)publisher=String(await snapshotRead(o,o.blockNumber,distributor,abi,'snapshotPublisher')).toLowerCase() as Address;
 }
 if((await consensusBlock(o.primary,o.secondary,o.blockNumber)).hash!==o.blockHash)throw Error('holder anchor changed');
 await transaction(o.pool,async client=>{
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${id.join(':')}:holder-rewards`]);
  const anchor=await client.query(`SELECT 1 FROM ${schema}.chain_blocks WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND number=$4 AND hash=$5 AND canonical AND finalized FOR SHARE`,[...id,o.blockNumber.toString(),o.blockHash]);if(!anchor.rowCount)throw Error('holder anchor unavailable');
  const generation=await client.query(`SELECT 1 FROM ${schema}.ingestion_checkpoints WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND stream='frontend-events' AND generation=$4 FOR SHARE`,[...id,o.generation.toString()]);if(!generation.rowCount)throw Error('holder ingestion generation changed');
  const previous=await client.query<{next_block:string;generation:string}>(`SELECT next_block,generation FROM ${schema}.projection_checkpoints WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='holder-rewards'`,id);
  if(previous.rows[0]&&BigInt(previous.rows[0].generation)>o.generation)throw Error('holder generation changed');
  if(previous.rows[0]&&BigInt(previous.rows[0].generation)===o.generation&&BigInt(previous.rows[0].next_block)>o.blockNumber+1n)throw Error('holder projection advanced');
  if(incremental&&previous.rows[0]?.next_block!==prior.next_block)throw Error('holder checkpoint advanced during observation');
  if(!incremental)for(const table of ['holder_reward_claims','holder_reward_rounds','holder_reward_markets'])await client.query(`DELETE FROM ${schema}.${table} WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3`,id);
  if(work)await client.query(`INSERT INTO ${schema}.holder_reward_markets SELECT $1,$2,$3,identity,$6,$7,$4,$5,payload FROM ${schema}.projection_observations WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='holder-rewards' AND block_hash=$4 AND generation=$5 AND algorithm_version='holder-incremental-v3' ON CONFLICT(environment,chain_id,deployment_digest,market_id) DO UPDATE SET block_number=EXCLUDED.block_number,block_hash=EXCLUDED.block_hash,generation=EXCLUDED.generation,payload=EXCLUDED.payload`,[...stageArgs,distributor,String(o.blockNumber)]);
  if(publisher)await client.query(`UPDATE ${schema}.holder_reward_markets SET payload=jsonb_set(payload,'{publisher}',to_jsonb($4::text)) WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND payload->>'publisher' IS DISTINCT FROM $4`,[...id,publisher]);
  if(work){
   await client.query(`INSERT INTO ${schema}.holder_reward_rounds SELECT $1,$2,$3,payload->'args'->>'marketId',(payload->'args'->>'round')::numeric,(payload->'log'->>'blockNumber')::bigint,payload->'log'->>'blockHash',payload->'args'->>'root',payload->'args'->>'dataHash',(payload->'args'->>'snapshotBlock')::bigint,payload->'args'->>'snapshotBlockHash',(payload->'args'->>'quoteBudget')::numeric,(payload->'args'->>'memeBudget')::numeric FROM ${schema}.holder_work_events WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND block_hash=$4 AND generation=$5 AND payload->>'eventName'='HolderSnapshotPublished' ORDER BY ordinal`,stageArgs);
   await client.query(`INSERT INTO ${schema}.holder_reward_claims SELECT $1,$2,$3,payload->'args'->>'marketId',(payload->'args'->>'round')::numeric,lower(payload->'args'->>'account'),bit_or((payload->'args'->>'assets')::integer) FROM ${schema}.holder_work_events WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND block_hash=$4 AND generation=$5 AND payload->>'eventName'='HolderSnapshotClaimed' GROUP BY payload->'args'->>'marketId',payload->'args'->>'round',lower(payload->'args'->>'account') ON CONFLICT(environment,chain_id,deployment_digest,market_id,round,account) DO UPDATE SET assets=${schema}.holder_reward_claims.assets | EXCLUDED.assets`,stageArgs);
  }
  await client.query(`INSERT INTO ${schema}.projection_checkpoints(environment,chain_id,deployment_digest,scope,algorithm_version,next_block,generation) VALUES($1,$2,$3,'holder-rewards','holder-incremental-v3',$4,$5) ON CONFLICT(environment,chain_id,deployment_digest,scope) DO UPDATE SET next_block=EXCLUDED.next_block,generation=EXCLUDED.generation,algorithm_version=EXCLUDED.algorithm_version`,[...id,(o.blockNumber+1n).toString(),o.generation.toString()]);
  for(const table of ['holder_work_events','holder_market_work','holder_work_candidates'])await client.query(`DELETE FROM ${schema}.${table} WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND block_hash=$4 AND generation=$5`,stageArgs);
 });
 if(o.blockNumber<requested)throw new ProjectionPending(`holder-rewards:${o.blockNumber}:committed`,requested,work?.event_count??0);
 return {markets:work?.market_count??0,events:work?.event_count??0};
}

/** Explicit operator-selected finalized block. No schedule and no transaction submission. */
export async function snapshotPreparationContext(o:SnapshotOptions & {marketId:Hex;blockNumber:bigint}):Promise<LedgerOptions> {
 const schema=snapshotSchema(o.schemaName), id=snapshotIdentity(o.deployment), distributor=snapshotDistributor();
 const anchor=await consensusBlock(o.primary,o.secondary,o.blockNumber);
 await verifySnapshotContext(o,o.blockNumber);
 const captured=await transaction(o.pool,async client=>{
  await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const block=await client.query(`SELECT 1 FROM ${schema}.chain_blocks WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND number=$4 AND hash=$5 AND canonical AND finalized`,[...id,o.blockNumber.toString(),anchor.hash]);if(!block.rowCount)throw Error('snapshot block not finalized by indexer');
  const checkpoint=(await client.query<{generation:string;next_block:string}>(`SELECT generation,next_block FROM ${schema}.ingestion_checkpoints WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND stream='frontend-events'`,id)).rows[0];if(!checkpoint||BigInt(checkpoint.next_block)<=o.blockNumber)throw Error('snapshot history incomplete');
  const ranges=await client.query<{from_block:string;to_block:string}>(`SELECT from_block,to_block FROM ${schema}.covered_ranges WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND generation=$4 AND complete AND from_block<=$5 ORDER BY from_block,to_block`,[...id,checkpoint.generation,o.blockNumber.toString()]);
  let next=o.deployment.activationBlock;for(const r of ranges.rows){if(BigInt(r.from_block)>next)break;if(BigInt(r.to_block)>=next)next=BigInt(r.to_block)+1n;}if(next<=o.blockNumber)throw Error('snapshot history gap');
  return {generation:checkpoint.generation};
 });
 if(await snapshotRead(o,o.blockNumber,distributor,abi,'rewardMode')!==SNAPSHOT_MODE)throw Error('wrong snapshot mode');
 const state=json<SnapshotMarket>(await snapshotRead(o,o.blockNumber,distributor,abi,'marketState',[o.marketId]));
 const token=state.token.toLowerCase() as Address;
 const exclusions=(await snapshotRead(o,o.blockNumber,distributor,abi,'feeSharingExcludedAccounts',[o.marketId]) as Address[]).map(a=>a.toLowerCase() as Address);
 const totalSupply=String(await snapshotRead(o,o.blockNumber,token,snapshotAbis.TickerMemeTokenV1 as Abi,'totalSupply'));
 return {...o,generation:BigInt(captured.generation),context:{chainId:o.deployment.chainId,deploymentDigest:o.deployment.deploymentDigest,distributor,marketId:o.marketId,token,quote:state.quote.toLowerCase() as Address,round:(BigInt(state.lastRound)+1n).toString(),snapshotBlock:o.blockNumber.toString(),snapshotBlockHash:anchor.hash,registeredBlock:state.registeredBlock,lastSnapshotBlock:state.lastSnapshotBlock,totalSupply,quoteAvailable:state.unallocatedQuote,memeAvailable:state.unallocatedMeme,burnMemeFees:state.burnMemeFees,exclusions}};
}
/** Compatibility exporter. New CLI prepares a sharded V2 manifest. */
export async function prepareHolderSnapshot(o:SnapshotOptions & {marketId:Hex;blockNumber:bigint}):Promise<SnapshotDataset> {
 const work=await snapshotPreparationContext(o),schema=snapshotSchema(o.schemaName),id=snapshotIdentity(o.deployment);
 while(!await advanceSnapshotLedger(work)) { /* Durable bounded units, safe to interrupt and resume. */ }
 const positive=(await o.pool.query<{account:Address;balance:string}>(`SELECT account,balance::text FROM ${schema}.holder_snapshot_balances WHERE ${ledgerWhere} AND balance>0 ORDER BY account`,workKey(work))).rows;
 const dataset=buildSnapshot({...work.context,balances:positive});
 const anchor={hash:work.context.snapshotBlockHash},captured={generation:work.generation.toString()};
 if((await consensusBlock(o.primary,o.secondary,o.blockNumber)).hash!==anchor.hash)throw Error('snapshot anchor changed during preparation');
 await transaction(o.pool,async client=>{
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${id.join(':')}:holder-rewards`]);
  const valid=await client.query(`SELECT 1 FROM ${schema}.chain_blocks b JOIN ${schema}.ingestion_checkpoints c USING(environment,chain_id,deployment_digest) WHERE b.environment=$1 AND b.chain_id=$2 AND b.deployment_digest=$3 AND b.hash=$4 AND b.canonical AND b.finalized AND c.stream='frontend-events' AND c.generation=$5 FOR SHARE`,[...id,anchor.hash,captured.generation]);if(!valid.rowCount)throw Error('snapshot generation changed');
  await client.query(`INSERT INTO ${schema}.holder_reward_datasets(environment,chain_id,deployment_digest,market_id,round,data_hash,snapshot_block,snapshot_block_hash,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,[...id,o.marketId,dataset.input.round,dataset.dataHash,dataset.input.snapshotBlock,anchor.hash,compactSnapshotDataset(dataset)]);
  await indexHolderDataset(client,o.schemaName??'tickergarden_serverless',o.deployment.environment,dataset);
  const existing=(await client.query<{data_hash:string}>(`SELECT data_hash FROM ${schema}.holder_reward_datasets WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4 AND round=$5 AND data_hash=$6`,[...id,o.marketId,dataset.input.round,dataset.dataHash])).rows[0];
  if(existing?.data_hash!==dataset.dataHash)throw Error('snapshot dataset persistence conflict');
 });
 return dataset;
}

/** Revalidate a persisted artifact using configured RPC policy, then simulate the exact publish call. */
export async function previewSnapshotPublication(o:SnapshotOptions,dataset:SnapshotArtifact) {
 verifySnapshotArtifact(dataset);
 if(dataset.input.chainId!==o.deployment.chainId||dataset.input.deploymentDigest!==o.deployment.deploymentDigest||dataset.input.distributor!==snapshotDistributor())throw Error('snapshot deployment mismatch');
 const schema=snapshotSchema(o.schemaName),identity=[...snapshotIdentity(o.deployment),dataset.input.marketId,dataset.input.round,dataset.dataHash];
 const digest=createHash('sha256').update(canonicalSnapshotJson(dataset)).digest('hex');
 const persisted=await o.pool.query<{generation:string;evidence:boolean}>(`SELECT c.generation::text, EXISTS(SELECT 1 FROM ${schema}.holder_snapshot_evidence e WHERE e.environment=d.environment AND e.chain_id=d.chain_id AND e.deployment_digest=d.deployment_digest AND e.market_id=d.market_id AND e.round=d.round AND e.data_hash=d.data_hash AND e.generation=c.generation AND e.block_hash=d.snapshot_block_hash AND e.artifact_digest=$7) evidence FROM ${schema}.holder_reward_datasets d JOIN ${schema}.chain_blocks b ON b.environment=d.environment AND b.chain_id=d.chain_id AND b.deployment_digest=d.deployment_digest AND b.hash=d.snapshot_block_hash JOIN ${schema}.ingestion_checkpoints c ON c.environment=d.environment AND c.chain_id=d.chain_id AND c.deployment_digest=d.deployment_digest AND c.stream='frontend-events' WHERE d.environment=$1 AND d.chain_id=$2 AND d.deployment_digest=$3 AND d.market_id=$4 AND d.round=$5 AND d.data_hash=$6 AND b.canonical AND b.finalized AND d.verified_header IS NOT NULL AND (d.payload=$8::jsonb OR d.payload=$9::jsonb)`,[...identity,digest,dataset,dataset.schema==='TICKERGARDEN_HOLDER_DATASET_V1'?compactSnapshotDataset(dataset):dataset]);
 if(!persisted.rowCount)throw Error('snapshot artifact not durably retained at finalized anchor');
 const evidence=persisted.rows[0]!;
 const snapshotHeight=BigInt(dataset.input.snapshotBlock);
 await verifySnapshotContext(o,snapshotHeight);
 if(!evidence.evidence){
 const historical=json<SnapshotMarket>(await snapshotRead(o,snapshotHeight,snapshotDistributor(),abi,'marketState',[dataset.input.marketId]));
 for(const [field,expected] of Object.entries({token:dataset.input.token,quote:dataset.input.quote,registeredBlock:dataset.input.registeredBlock,lastSnapshotBlock:dataset.input.lastSnapshotBlock,unallocatedQuote:dataset.input.quoteAvailable,unallocatedMeme:dataset.input.memeAvailable,burnMemeFees:dataset.input.burnMemeFees}))if(String(historical[field as keyof SnapshotMarket]).toLowerCase()!==String(expected).toLowerCase())throw Error('snapshot historical market mismatch');
 if(BigInt(historical.lastRound)+1n!==BigInt(dataset.input.round))throw Error('snapshot historical round mismatch');
 const exclusions=(await snapshotRead(o,snapshotHeight,snapshotDistributor(),abi,'feeSharingExcludedAccounts',[dataset.input.marketId]) as Address[]).map(a=>a.toLowerCase()).sort();
 if(JSON.stringify(exclusions)!==JSON.stringify([...dataset.input.exclusions].sort()))throw Error('snapshot historical exclusions mismatch');
 const tokenAbi=snapshotAbis.TickerMemeTokenV1 as Abi;
 if(String(await snapshotRead(o,snapshotHeight,dataset.input.token,tokenAbi,'totalSupply'))!==dataset.input.totalSupply)throw Error('snapshot historical supply mismatch');
 if(dataset.schema!=='TICKERGARDEN_HOLDER_DATASET_V1')throw Error('snapshot manifest verification evidence unavailable');
 for(let i=0;i<dataset.input.balances.length;i+=8)await Promise.all(dataset.input.balances.slice(i,i+8).map(async row=>{if(String(await snapshotRead(o,snapshotHeight,dataset.input.token,tokenAbi,'balanceOf',[row.account]))!==row.balance)throw Error('snapshot historical holder mismatch');}));
 if((await consensusBlock(o.primary,o.secondary,snapshotHeight)).hash!==dataset.input.snapshotBlockHash)throw Error('snapshot block orphaned');
 await o.pool.query(`INSERT INTO ${schema}.holder_snapshot_evidence(environment,chain_id,deployment_digest,market_id,round,data_hash,generation,block_hash,artifact_digest) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9 WHERE EXISTS(SELECT 1 FROM ${schema}.ingestion_checkpoints WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND stream='frontend-events' AND generation=$7) ON CONFLICT DO NOTHING`,[...identity,evidence.generation,dataset.input.snapshotBlockHash,digest]);
 }
 const heights=await Promise.all([o.primary.call<{number:Hex}>('eth_getBlockByNumber',['latest',false]),o.secondary.call<{number:Hex}>('eth_getBlockByNumber',['latest',false])]);
 const height=BigInt(heights[0].number)<BigInt(heights[1].number)?BigInt(heights[0].number):BigInt(heights[1].number);
 const head=await consensusBlock(o.primary,o.secondary,height);
 await verifySnapshotContext(o,height);
 if((await consensusBlock(o.primary,o.secondary,BigInt(dataset.input.snapshotBlock))).hash!==dataset.input.snapshotBlockHash)throw Error('snapshot block orphaned');
 const stillCurrent=await o.pool.query(`SELECT 1 FROM ${schema}.ingestion_checkpoints WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND stream='frontend-events' AND generation=$4`,[...snapshotIdentity(o.deployment),evidence.generation]);if(!stillCurrent.rowCount)throw Error('snapshot verification generation changed');
 const state=json<SnapshotMarket>(await snapshotRead(o,height,snapshotDistributor(),abi,'marketState',[dataset.input.marketId]));
 const existing=json<{root:Hex;dataHash:Hex;snapshotBlock:string;snapshotBlockHash:Hex;quoteBudget:string;memeBudget:string}>(await snapshotRead(o,height,snapshotDistributor(),abi,'roundState',[dataset.input.marketId,BigInt(dataset.input.round)]));
 if(!/^0x0+$/.test(existing.root)){if(existing.root!==dataset.root||existing.dataHash!==dataset.dataHash||existing.snapshotBlock!==dataset.input.snapshotBlock||existing.snapshotBlockHash!==dataset.input.snapshotBlockHash||existing.quoteBudget!==dataset.quoteBudget||existing.memeBudget!==dataset.memeBudget)throw Error('published round conflicts with dataset');return {status:'already_published' as const,headBlock:height.toString(),headHash:head.hash};}
 if(BigInt(state.lastRound)+1n!==BigInt(dataset.input.round)||BigInt(state.lastSnapshotBlock)>=BigInt(dataset.input.snapshotBlock)||BigInt(state.unallocatedQuote)<BigInt(dataset.quoteBudget)||BigInt(state.unallocatedMeme)<BigInt(dataset.memeBudget))throw Error('snapshot state or budget changed');
 const publisher=String(await snapshotRead(o,height,snapshotDistributor(),abi,'snapshotPublisher')).toLowerCase() as Address;
 if(/^0x0+$/.test(publisher))return {status:'publisher_unconfigured' as const,headBlock:height.toString(),headHash:head.hash};
 const publication={marketId:dataset.input.marketId,round:BigInt(dataset.input.round),snapshotBlock:BigInt(dataset.input.snapshotBlock),snapshotBlockHash:dataset.input.snapshotBlockHash,root:dataset.root,dataHash:dataset.dataHash,quoteBudget:BigInt(dataset.quoteBudget),memeBudget:BigInt(dataset.memeBudget)};
 const data=encodeFunctionData({abi,functionName:'publishSnapshots',args:[[publication]]});
 await Promise.all([o.primary,o.secondary].map(r=>r.call('eth_call',[{from:publisher,to:snapshotDistributor(),data},toHex(height)])));
 if((await consensusBlock(o.primary,o.secondary,height)).hash!==head.hash)throw Error('publication preview head changed');
 return {status:'simulated_not_broadcast' as const,from:publisher,to:snapshotDistributor(),data,headBlock:height.toString(),headHash:head.hash,dataHash:dataset.dataHash};
}

/** Funding is permissionless but this helper only simulates and returns calldata. */
export async function previewHolderFunding(o:SnapshotOptions,marketIds:Hex[],sender:Address,assets:1|2|3=3,gasPerAsset=500000n) {
 if(!marketIds.length||marketIds.length>32||new Set(marketIds).size!==marketIds.length||marketIds.some(x=>!/^0x[0-9a-f]{64}$/.test(x))||!/^0x[0-9a-f]{40}$/.test(sender)||gasPerAsset<100000n||gasPerAsset>2000000n||![1,2,3].includes(assets))throw Error('invalid holder funding batch');
 const heights=await Promise.all([o.primary,o.secondary].map(r=>r.call<{number:Hex}>('eth_getBlockByNumber',['latest',false])));
 const height=BigInt(heights[0]!.number)<BigInt(heights[1]!.number)?BigInt(heights[0]!.number):BigInt(heights[1]!.number);
 await verifySnapshotContext(o,height);const anchor=await consensusBlock(o.primary,o.secondary,height);
 const vault=fixedF72Sources().find(s=>s.module==='ProtocolFeeVault')!;
 for(const rpc of [o.primary,o.secondary])if(await rpc.codeHash(vault.address,height)!==vault.runtimeCodeHash)throw Error('funding vault code drift');
 for(const market of marketIds){const state=json<SnapshotMarket>(await snapshotRead(o,height,snapshotDistributor(),abi,'marketState',[market]));if(state.vault.toLowerCase()!==vault.address)throw Error('funding vault binding mismatch');}
 const fundingAbi=snapshotAbis.ProtocolFeeVault as Abi,data=encodeFunctionData({abi:fundingAbi,functionName:'fundHolderRewardsBatch',args:[marketIds,assets,gasPerAsset]});
 const results=await Promise.all([o.primary,o.secondary].map(r=>r.call<Hex>('eth_call',[{from:sender,to:vault.address,data},toHex(height)])));
 if(results[0]!==results[1])throw Error('funding simulation disagreement');
 if((await consensusBlock(o.primary,o.secondary,height)).hash!==anchor.hash)throw Error('funding preview head changed');
 return {status:'simulated_not_broadcast',from:sender,to:vault.address,data,headBlock:height.toString(),headHash:anchor.hash,
  continuation:json<unknown>(decodeFunctionResult({abi:fundingAbi,functionName:'fundHolderRewardsBatch',data:results[0]!})),
  note:'Simulation completion does not mean each asset funded. Inspect HolderFundingResult receipts and refreshed market budgets after submission.'};
}
