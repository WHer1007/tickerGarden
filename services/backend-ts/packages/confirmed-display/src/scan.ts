import type {PoolClient} from 'pg';
import {parseLog,type DeploymentIdentity,type RpcTransport} from '../../chain/src/index.ts';
import {creationFromEvent,type MarketCreation} from '../../market-projector/src/index.ts';
import {decodeF72Event,fixedF72Sources,eventTopicsForModules,type DecodedProtocolEvent} from '../../events/src/index.ts';
import {displayLogs} from './logs.ts';
import {displayIdentity,displaySchema} from './worker.ts';

type Batch={from_block:string;to_block:string;block_hash:`0x${string}`;payload:{creations:MarketCreation[];logs:Record<string,unknown>[]}};
/** One durable scoped scan covers multiple 200-block reducer batches. Relay is
 * notification-only with RECOVERY_OWNER=display, so this is the sole gap scanner.
 * A WS hint never substitutes for verified range coverage. */
export async function readDisplayScan(client:PoolClient,d:DeploymentIdentity,rpc:RpcTransport,from:bigint,to:bigint,head:bigint,schemaName?:string){
 const s=displaySchema(schemaName),id=displayIdentity(d);
 let batch=(await client.query<Batch>(`SELECT from_block::text,to_block::text,block_hash,payload FROM ${s}.display_log_scan WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3`,id)).rows[0];
 if(!batch||BigInt(batch.from_block)>from||BigInt(batch.to_block)<to||BigInt(batch.to_block)>head||(await rpc.block(BigInt(batch.to_block))).hash!==batch.block_hash){
  // 2,000 blocks amortizes the full project filter scan tenfold during catch-up.
  // Provider size limits are still split by displayLogs, never widened in scope.
  const end=from+1999n<head?from+1999n:head,anchor=await rpc.block(end);
  const directory=(await client.query<{payload:MarketCreation}>(`SELECT d.payload FROM ${s}.market_creation_directory d JOIN ${s}.chain_blocks b ON b.environment=d.environment AND b.chain_id=d.chain_id AND b.deployment_digest=d.deployment_digest AND b.hash=d.block_hash WHERE d.environment=$1 AND d.chain_id=$2 AND d.deployment_digest=$3 AND b.canonical AND b.finalized UNION ALL SELECT payload->'creation' payload FROM ${s}.confirmed_display_markets WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3`,id)).rows;
  const creations=new Map(directory.filter(r=>BigInt(r.payload.source.blockNumber)<from).map(r=>[r.payload.marketId,r.payload]));
  const fixed=fixedF72Sources(),factory=fixed.find(source=>source.module==='TickerGardenFactoryV1')!;
  const factoryLogs=await rpc.logs({fromBlock:from,toBlock:end,addresses:[factory.address],topics:[eventTopicsForModules([factory.module])]});
  for(const log of factoryLogs){const e=decodeF72Event('TickerGardenFactoryV1',log);if(e?.eventName==='MarketCreated'){const c=creationFromEvent(e.args,log,d.chainId);creations.set(c.marketId,c);}}
  const modules=moduleMap([...creations.values()]);modules.delete(factory.address);
  const raw=await displayLogs(rpc,modules,from,end);
  const factoryRaw=factoryLogs.map(l=>({...l,blockNumber:`0x${l.blockNumber.toString(16)}`,transactionIndex:`0x${l.transactionIndex.toString(16)}`,logIndex:`0x${l.logIndex.toString(16)}`}));
  const logs=[...factoryRaw,...raw];
  for(const raw of logs){const l=parseLog(raw);if(l.removed||l.blockNumber<from||l.blockNumber>end)throw Error('Display scan range mismatch');}
  if((await rpc.block(end)).hash!==anchor.hash)throw Error('Display scan reorganized');
  batch={from_block:from.toString(),to_block:end.toString(),block_hash:anchor.hash,payload:{creations:[...creations.values()],logs}};
  await client.query(`INSERT INTO ${s}.display_log_scan(environment,chain_id,deployment_digest,from_block,to_block,block_hash,payload) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(environment,chain_id,deployment_digest) DO UPDATE SET from_block=excluded.from_block,to_block=excluded.to_block,block_hash=excluded.block_hash,payload=excluded.payload`,[...id,batch.from_block,batch.to_block,batch.block_hash,JSON.stringify(batch.payload)]);
 }
 const creations=new Map(batch.payload.creations.filter(c=>BigInt(c.source.blockNumber)<=to).map(c=>[c.marketId,c]));
 return {creations,modules:moduleMap([...creations.values()]),logs:batch.payload.logs.map(parseLog).filter(l=>l.blockNumber>=from&&l.blockNumber<=to)};
}
function moduleMap(creations:readonly MarketCreation[]){
 const modules=new Map<string,DecodedProtocolEvent['module']>(fixedF72Sources().map(s=>[s.address,s.module as DecodedProtocolEvent['module']]));
 for(const c of creations){modules.set(c.memeToken,'TickerMemeTokenV1');modules.set(c.curve,'TickerGardenCurve');if(!/^0x0{40}$/.test(c.gauge))modules.set(c.gauge,'MemeStockGauge');}
 return modules;
}
