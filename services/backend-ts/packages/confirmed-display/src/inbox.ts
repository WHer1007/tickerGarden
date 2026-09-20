import type {PoolClient} from 'pg';
import {parseLog,type DeploymentIdentity,type RpcTransport,type RpcLog} from '../../chain/src/index.ts';
import {readDisplayScan,readDisplayDirectory,moduleMap,discoverDisplayCreations} from './scan.ts';
import {displayIdentity,displaySchema} from './worker.ts';

type Cursor={block_number:string;block_hash:`0x${string}`};
export type EventPlan={scan:boolean;replayFrom?:bigint;repairOnly?:boolean};
export const RECOVERY_INTERVAL_MS=30000;
export async function initializeEventCoverage(client:PoolClient,d:DeploymentIdentity,cursor:Cursor,schemaName?:string){
 const s=displaySchema(schemaName),id=displayIdentity(d);
 await client.query(`INSERT INTO ${s}.display_event_coverage(environment,chain_id,deployment_digest,block_number,block_hash) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,[...id,cursor.block_number,cursor.block_hash]);
 return (await client.query<{block_number:string}>(`SELECT block_number::text FROM ${s}.display_event_coverage WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3`,id)).rows[0]!;
}
export async function resetEventCoverage(client:PoolClient,d:DeploymentIdentity,cursor:Cursor,schemaName?:string){
 const s=displaySchema(schemaName),id=displayIdentity(d);
 await client.query(`DELETE FROM ${s}.display_event_applied WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND block_number>$4`,[...id,cursor.block_number]);
 await client.query(`UPDATE ${s}.display_event_coverage SET block_number=least(block_number,$4),block_hash=CASE WHEN block_number>=$4 THEN $5 ELSE block_hash END,checked_at=to_timestamp(0) WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3`,[...id,cursor.block_number,cursor.block_hash]);
 await client.query(`DELETE FROM ${s}.display_log_scan WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3`,id);
}
// Recovery replays the whole unverified tail, not just the first missing block.
// Otherwise promoting the repaired suffix could incorrectly cover an older gap.
/** WS completeness is never assumed. Late transactions rewind the display journal;
 * independent range coverage detects notifications that never arrived at all. */
export async function planDisplayEvents(client:PoolClient,d:DeploymentIdentity,rpc:RpcTransport,cursor:Cursor,forceRecovery=false,schemaName?:string):Promise<EventPlan>{
 const s=displaySchema(schemaName),id=displayIdentity(d);
 const coverage=(await client.query<{block_number:string;checked_at:Date}>(`SELECT block_number::text,checked_at FROM ${s}.display_event_coverage WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3`,id)).rows[0]!;
 const due=forceRecovery||Date.now()-new Date(coverage.checked_at).getTime()>=RECOVERY_INTERVAL_MS;
 // Ignore events already covered by an authoritative range. Duplicate WS events
 // from a transaction expanded via its receipt are also already in applied.
 const late=(await client.query<{block_number:string;block_hash:`0x${string}`}>(`SELECT DISTINCT e.block_number,e.block_hash FROM ${s}.display_event_inbox e WHERE e.environment=$1 AND e.chain_id=$2 AND e.deployment_digest=$3 AND NOT e.removed AND e.block_number>$4 AND e.block_number<=$5 AND NOT EXISTS(SELECT 1 FROM ${s}.display_event_applied a WHERE a.environment=e.environment AND a.chain_id=e.chain_id AND a.deployment_digest=e.deployment_digest AND a.block_hash=e.block_hash AND a.transaction_hash=e.transaction_hash AND a.log_index=e.log_index) ORDER BY e.block_number LIMIT 200`,[...id,coverage.block_number,cursor.block_number])).rows;
 let replayFrom:bigint|undefined;
 for(const row of late){if((await rpc.block(BigInt(row.block_number))).hash===row.block_hash){const n=BigInt(row.block_number);if(replayFrom===undefined||n<replayFrom)replayFrom=n;}}
 if(replayFrom!==undefined)return {scan:true,replayFrom:BigInt(coverage.block_number)+1n};
 if(!due)return {scan:false};
 const from=BigInt(coverage.block_number)+1n,tip=BigInt(cursor.block_number);
 if(from>tip)return {scan:true};
 const end=from+1999n<tip?from+1999n:tip;
 const batch=await readDisplayScan(client,d,rpc,from,end,end,schemaName);
 const applied=(await client.query<{block_hash:string;transaction_hash:string;log_index:string}>(`SELECT block_hash,transaction_hash,log_index::text FROM ${s}.display_event_applied WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND block_number BETWEEN $4 AND $5`,[...id,from.toString(),end.toString()])).rows;
 const known=new Set(applied.map(r=>`${r.block_hash}:${r.transaction_hash}:${r.log_index}`));
 for(const log of batch.logs)if(!known.has(logKey(log))&&(replayFrom===undefined||log.blockNumber<replayFrom))replayFrom=log.blockNumber;
 if(replayFrom!==undefined)return {scan:true,replayFrom:BigInt(coverage.block_number)+1n};
 const block=await rpc.block(end);
 // readDisplayScan verified its ending hash; recheck cache anchor before claiming coverage.
 const saved=(await client.query<{block_hash:string}>(`SELECT block_hash FROM ${s}.display_log_scan WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3`,id)).rows[0];
 if(saved?.block_hash!==block.hash)throw Error('Display recovery range changed');
 await client.query(`UPDATE ${s}.display_event_coverage SET block_number=$4,block_hash=$5,checked_at=CASE WHEN $6 THEN now() ELSE checked_at END WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3`,[...id,end.toString(),block.hash,end===tip]);
 return {scan:end===tip,repairOnly:end<tip};
}
export async function readDisplayEvents(client:PoolClient,d:DeploymentIdentity,rpc:RpcTransport,from:bigint,to:bigint,schemaName?:string){
 const s=displaySchema(schemaName),id=displayIdentity(d);
 const rows=(await client.query<{payload:Record<string,unknown>}>(`SELECT payload FROM ${s}.display_event_inbox WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND NOT removed AND block_number BETWEEN $4 AND $5 ORDER BY block_number,log_index LIMIT 1000`,[...id,from.toString(),to.toString()])).rows;
 const logs:RpcLog[]=[],blocks=new Map<bigint,string>();
 for(const row of rows){const log=parseLog(row.payload);if(!blocks.has(log.blockNumber))blocks.set(log.blockNumber,(await rpc.block(log.blockNumber)).hash);if(blocks.get(log.blockNumber)===log.blockHash)logs.push(log);}
 // Never commit a partially selected block: a saturated inbox batch is recovered
 // using a bounded full scan, preserving transactions beyond this row limit.
 if(rows.length===1000)return null;
 const creations=await readDisplayDirectory(client,d,from,schemaName);
 discoverDisplayCreations(creations,logs,d.chainId);
 return {creations,modules:moduleMap([...creations.values()]),logs};
}
export async function saveAppliedEvents(client:PoolClient,d:DeploymentIdentity,logs:readonly RpcLog[],schemaName?:string){
 if(!logs.length)return;const s=displaySchema(schemaName),id=displayIdentity(d);
 await client.query(`INSERT INTO ${s}.display_event_applied(environment,chain_id,deployment_digest,block_number,block_hash,transaction_hash,log_index) SELECT $1,$2,$3,x.block_number,x.block_hash,x.transaction_hash,x.log_index FROM jsonb_to_recordset($4::jsonb) x(block_number bigint,block_hash text,transaction_hash text,log_index bigint) ON CONFLICT DO NOTHING`,[...id,JSON.stringify(logs.map(l=>({block_number:l.blockNumber.toString(),block_hash:l.blockHash,transaction_hash:l.transactionHash,log_index:l.logIndex.toString()})))]);
}
export async function commitEventCoverage(client:PoolClient,d:DeploymentIdentity,to:bigint,hash:string,caughtUp:boolean,schemaName?:string,from?:bigint){
 const result=await client.query(`UPDATE ${displaySchema(schemaName)}.display_event_coverage SET block_number=$4,block_hash=$5,checked_at=CASE WHEN $6 THEN now() ELSE to_timestamp(0) END WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND ($7::bigint IS NULL OR block_number>=$7::bigint-1)`,[...displayIdentity(d),to.toString(),hash,caughtUp,from?.toString()??null]);
 if(result.rowCount!==1)throw Error('Display coverage would skip an unverified gap');
}
const logKey=(l:RpcLog)=>`${l.blockHash}:${l.transactionHash}:${l.logIndex}`;
