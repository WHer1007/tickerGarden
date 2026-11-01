import type {PoolClient} from 'pg';
import {parseLog,type DeploymentIdentity,type RpcTransport,type RpcLog,type RpcBlock} from '../../chain/src/index.ts';
import {readDisplayDirectory,moduleMap,discoverDisplayCreations} from './scan.ts';
import {displayIdentity,displaySchema} from './worker.ts';

type Cursor={block_number:string;block_hash:`0x${string}`};
export type EventPlan={scan:boolean;replayFrom?:bigint;repairOnly?:boolean};

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
/** Late pushed events rewind the persisted journal. Missing pushes remain unknown;
 * a recovery hint never grants authority to discover them with a range scan. */
export async function planDisplayEvents(client:PoolClient,d:DeploymentIdentity,rpc:RpcTransport,cursor:Cursor,forceRecovery=false,schemaName?:string):Promise<EventPlan>{
 const s=displaySchema(schemaName),id=displayIdentity(d);
 const coverage=(await client.query<{block_number:string;checked_at:Date}>(`SELECT block_number::text,checked_at FROM ${s}.display_event_coverage WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3`,id)).rows[0]!;
 const late=(await client.query<{block_number:string;block_hash:`0x${string}`}>(`SELECT DISTINCT e.block_number,e.block_hash FROM ${s}.display_event_inbox e WHERE e.environment=$1 AND e.chain_id=$2 AND e.deployment_digest=$3 AND NOT e.removed AND e.block_number>$4 AND e.block_number<=$5 AND NOT EXISTS(SELECT 1 FROM ${s}.display_event_applied a WHERE a.environment=e.environment AND a.chain_id=e.chain_id AND a.deployment_digest=e.deployment_digest AND a.block_hash=e.block_hash AND a.transaction_hash=e.transaction_hash AND a.log_index=e.log_index) ORDER BY e.block_number LIMIT 200`,[...id,coverage.block_number,cursor.block_number])).rows;
 let replayFrom:bigint|undefined;
 const lateBlocks=new Map<bigint,RpcBlock>();
 for(const row of late){const n=BigInt(row.block_number);if(!lateBlocks.has(n))lateBlocks.set(n,await rpc.block(n));if(lateBlocks.get(n)!.hash===row.block_hash){const n=BigInt(row.block_number);if(replayFrom===undefined||n<replayFrom)replayFrom=n;}}
 if(replayFrom!==undefined)return {scan:false,replayFrom};
 return {scan:false};
}
export async function readDisplayEvents(client:PoolClient,d:DeploymentIdentity,rpc:RpcTransport,from:bigint,to:bigint,schemaName?:string){
 const s=displaySchema(schemaName),id=displayIdentity(d);
 const rows=(await client.query<{payload:Record<string,unknown>}>(`SELECT payload FROM ${s}.display_event_inbox WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND NOT removed AND block_number=(SELECT min(block_number) FROM ${s}.display_event_inbox WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND NOT removed AND block_number BETWEEN $4 AND $5) ORDER BY block_number,log_index LIMIT 10001`,[...id,from.toString(),to.toString()])).rows;
 if(rows.length===10001)return null;
 const logs:RpcLog[]=[],blocks=new Map<bigint,RpcBlock>();
 for(const row of rows){const log=parseLog(row.payload);if(!blocks.has(log.blockNumber))blocks.set(log.blockNumber,await rpc.block(log.blockNumber));if(blocks.get(log.blockNumber)!.hash===log.blockHash)logs.push(log);}
 // The whole pushed block fits the bound; no range coverage is inferred.
 const creations=await readDisplayDirectory(client,d,from,schemaName);
 discoverDisplayCreations(creations,logs,d.chainId);
 return {creations,modules:moduleMap([...creations.values()]),logs,blocks};
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
