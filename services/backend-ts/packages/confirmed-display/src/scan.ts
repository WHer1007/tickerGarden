import {withRpcTier} from '../../rpc-control/src/runtime.ts';
import type {PoolClient} from 'pg';
import {parseLog,type DeploymentIdentity,type RpcTransport,type RpcLog,type RpcBlock} from '../../chain/src/index.ts';
import {creationFromEvent,type MarketCreation} from '../../market-projector/src/index.ts';
import {decodeF72Event,fixedF72Sources,eventTopic,eventTopicsForModules,type DecodedProtocolEvent} from '../../events/src/index.ts';
import {displayLogs} from './logs.ts';
import {displayIdentity,displaySchema} from './worker.ts';

type Batch={from_block:string;to_block:string;block_hash:`0x${string}`;payload:{creations:MarketCreation[];logs:Record<string,unknown>[]}};
/** One durable scoped scan covers multiple 200-block reducer batches. With RECOVERY_OWNER=display, this is the sole gap scanner; WS inbox events
 * independently update speculative display state.
 * A WS hint never substitutes for verified range coverage. */
export async function readDisplayScan(client:PoolClient,d:DeploymentIdentity,rpc:RpcTransport,from:bigint,to:bigint,head:bigint,schemaName?:string){
 return withRpcTier('background',()=>readDisplayScanAtBudget(client,d,rpc,from,to,head,schemaName));
}
async function readDisplayScanAtBudget(client:PoolClient,d:DeploymentIdentity,rpc:RpcTransport,from:bigint,to:bigint,head:bigint,schemaName?:string){
 const s=displaySchema(schemaName),id=displayIdentity(d);
 let batch=(await client.query<Batch>(`SELECT from_block::text,to_block::text,block_hash,payload FROM ${s}.display_log_scan WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3`,id)).rows[0];
 let verifiedBlock:RpcBlock|undefined;
 if(!batch||BigInt(batch.from_block)>from||BigInt(batch.to_block)<to||BigInt(batch.to_block)>head||(verifiedBlock=await rpc.block(BigInt(batch.to_block))).hash!==batch.block_hash){
  // 2,000 blocks amortizes the full project filter scan tenfold during catch-up.
  // Provider size limits are still split by displayLogs, never widened in scope.
  const end=from+1999n<head?from+1999n:head,anchor=await rpc.block(end);
  const creations=await readDisplayDirectory(client,d,from,schemaName);
  const fixed=fixedF72Sources(),factory=fixed.find(source=>source.module==='TickerGardenFactoryV1')!;
  const factoryLogs=await rpc.logs({fromBlock:from,toBlock:end,addresses:[factory.address],topics:[eventTopicsForModules([...fixed.filter(s=>s.module!=='UniswapV4PoolManager').map(s=>s.module),'TickerMemeTokenV1','TickerGardenCurve'])]});
  discoverDisplayCreations(creations,factoryLogs,d.chainId);
  const modules=moduleMap([...creations.values()]);modules.delete(factory.address);
  const raw=await displayLogs(rpc,modules,from,end,true);
  const factoryRaw=factoryLogs.map(l=>({...l,blockNumber:`0x${l.blockNumber.toString(16)}`,transactionIndex:`0x${l.transactionIndex.toString(16)}`,logIndex:`0x${l.logIndex.toString(16)}`}));
  const ordinary=[...factoryRaw,...raw];
  const poolIds=await displayPoolIds(client,d,moduleMap([...creations.values()]),ordinary.map(parseLog),schemaName);
  const manager=fixed.find(s=>s.module==='UniswapV4PoolManager')!;
  const poolLogs:RpcLog[]=[];
  for(let i=0;i<poolIds.length;i+=256)poolLogs.push(...await rpc.logs({fromBlock:from,toBlock:end,addresses:[manager.address],topics:[eventTopic('UniswapV4PoolManager','Swap'),poolIds.slice(i,i+256)]}));
  const logs=[...ordinary,...poolLogs.map(l=>({...l,blockNumber:`0x${l.blockNumber.toString(16)}`,transactionIndex:`0x${l.transactionIndex.toString(16)}`,logIndex:`0x${l.logIndex.toString(16)}`}))];
  for(const raw of logs){const l=parseLog(raw);if(l.removed||l.blockNumber<from||l.blockNumber>end)throw Error('Display scan range mismatch');}
  if((verifiedBlock=await rpc.block(end)).hash!==anchor.hash)throw Error('Display scan reorganized');
  batch={from_block:from.toString(),to_block:end.toString(),block_hash:anchor.hash,payload:{creations:[...creations.values()],logs}};
  await client.query(`INSERT INTO ${s}.display_log_scan(environment,chain_id,deployment_digest,from_block,to_block,block_hash,payload) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(environment,chain_id,deployment_digest) DO UPDATE SET from_block=excluded.from_block,to_block=excluded.to_block,block_hash=excluded.block_hash,payload=excluded.payload`,[...id,batch.from_block,batch.to_block,batch.block_hash,JSON.stringify(batch.payload)]);
 }
 const creations=new Map(batch.payload.creations.filter(c=>BigInt(c.source.blockNumber)<=to).map(c=>[c.marketId,c]));
 return {creations,modules:moduleMap([...creations.values()]),blocks:new Map<bigint,RpcBlock>(verifiedBlock?[[verifiedBlock.number,verifiedBlock]]:[]),logs:batch.payload.logs.map(parseLog).filter(l=>l.blockNumber>=from&&l.blockNumber<=to)};
}
export function moduleMap(creations:readonly MarketCreation[]){
 const modules=new Map<string,DecodedProtocolEvent['module']>(fixedF72Sources().map(s=>[s.address,s.module as DecodedProtocolEvent['module']]));
 for(const c of creations){modules.set(c.memeToken,'TickerMemeTokenV1');modules.set(c.curve,'TickerGardenCurve');if(!/^0x0{40}$/.test(c.gauge))modules.set(c.gauge,'MemeStockGauge');}
 return modules;
}

export async function readDisplayDirectory(client:PoolClient,d:DeploymentIdentity,from:bigint,schemaName?:string){
 const s=displaySchema(schemaName),id=displayIdentity(d);
 const rows=(await client.query<{payload:MarketCreation}>(`SELECT d.payload FROM ${s}.market_creation_directory d JOIN ${s}.chain_blocks b ON b.environment=d.environment AND b.chain_id=d.chain_id AND b.deployment_digest=d.deployment_digest AND b.hash=d.block_hash WHERE d.environment=$1 AND d.chain_id=$2 AND d.deployment_digest=$3 AND b.canonical AND b.finalized UNION ALL SELECT payload->'creation' payload FROM ${s}.confirmed_display_markets WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3`,id)).rows;
 return new Map(rows.filter(r=>BigInt(r.payload.source.blockNumber)<from).map(r=>[r.payload.marketId,r.payload]));
}
export function discoverDisplayCreations(creations:Map<`0x${string}`,MarketCreation>,logs:readonly RpcLog[],chainId:4663|46630){
 const factory=fixedF72Sources().find(s=>s.module==='TickerGardenFactoryV1')!;
 for(const log of logs){if(log.address!==factory.address)continue;const e=decodeF72Event('TickerGardenFactoryV1',log);if(e?.eventName==='MarketCreated'){const c=creationFromEvent(e.args,log,chainId);creations.set(c.marketId,c);}}
}
export async function displayPoolIds(client:PoolClient,d:DeploymentIdentity,modules:ReadonlyMap<string,DecodedProtocolEvent['module']>,logs:readonly RpcLog[],schemaName?:string){
 const s=displaySchema(schemaName);
 const rows=(await client.query<{pool_id:string}>(`SELECT payload->'market'->>'poolId' pool_id FROM ${s}.confirmed_display_markets WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 UNION SELECT r.payload->>'poolId' FROM ${s}.projection_read_records r JOIN ${s}.publication_pointers p USING(environment,chain_id,deployment_digest,scope,revision) WHERE r.environment=$1 AND r.chain_id=$2 AND r.deployment_digest=$3 AND r.scope='markets'`,displayIdentity(d))).rows;
 const ids=new Set(rows.map(r=>r.pool_id).filter((v):v is `0x${string}`=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v)&&!/^0x0{64}$/.test(v)));
 for(const log of logs){const module=modules.get(log.address);if(!module||!['MarketRegistryV1','TickerGardenMemeHook'].includes(module))continue;const event=decodeF72Event(module,log);const id=event?.args.poolId;if(typeof id==='string'&&/^0x[0-9a-f]{64}$/.test(id)&&!/^0x0{64}$/.test(id))ids.add(id as `0x${string}`);}
 return [...ids].sort();
}
