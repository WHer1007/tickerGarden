import type {Pool} from 'pg';
import type {DeploymentIdentity} from '../../chain/src/index.ts';
import type {MarketReadModel,MarketDetailResponse,ConfigReadModel} from '../../../openapi/generated/v1-client.ts';
import {runtimeConfigs} from '../../runtime-deployment/src/index.ts';
import type {DisplayState} from './state.ts';
import type {TokenDetailResponse} from '../../../openapi/generated/v1-client.ts';
import {displayIdentity,displaySchema} from './worker.ts';
export async function readConfirmedState(pool:Pick<Pool,'query'>,d:DeploymentIdentity,marketId:string,schemaName?:string,section?:string){
 const schema=displaySchema(schemaName);
 const selected=new Set(section==='activity'?['trades','fees']:section?.split(',')??['holders','chart','trades','statistics','fees']);
 const omitted=['detailViews',...(!selected.has('holders')?['balances','exclusions']:[]),...(!['chart','trades','statistics'].some(k=>selected.has(k))?['trades']:[]),...(!selected.has('trades')?['recentTrades']:[]),...(!selected.has('fees')?['fees']:[])];
 const row=(await pool.query<{payload:DisplayState;head_number:string;head_hash:`0x${string}`;head_timestamp:string}>(`SELECT m.payload - $5::text[] payload,c.block_number::text head_number,c.block_hash head_hash,c.block_timestamp::text head_timestamp FROM ${schema}.confirmed_display_markets m JOIN ${schema}.confirmed_display_cursor c USING(environment,chain_id,deployment_digest) WHERE m.environment=$1 AND m.chain_id=$2 AND m.deployment_digest=$3 AND m.market_id=$4 AND m.block_number<=c.block_number`,[...displayIdentity(d),marketId,omitted])).rows[0];
 return row;
}
export async function readConfirmedDetail(pool:Pick<Pool,'query'>,d:DeploymentIdentity,marketId:string,period:'1H'|'12H'|'1D',schemaName?:string,section?:string){
 const schema=displaySchema(schemaName);
 const value=(await pool.query<{detail:TokenDetailResponse}>(`SELECT m.payload->'detailViews'->$5 detail FROM ${schema}.confirmed_display_markets m JOIN ${schema}.confirmed_display_cursor c USING(environment,chain_id,deployment_digest) WHERE m.environment=$1 AND m.chain_id=$2 AND m.deployment_digest=$3 AND m.market_id=$4 AND m.block_number<=c.block_number`,[...displayIdentity(d),marketId,period])).rows[0]?.detail;
 if(!value)return null;
 const selected=new Set(section==='activity'?['trades','fees']:section?.split(',')??['holders','chart','trades','statistics','fees']);
 return {...value,statistics:selected.has('statistics')?value.statistics:null,chart:selected.has('chart')?value.chart:null,holders:selected.has('holders')?value.holders:null,trades:selected.has('trades')?value.trades?.slice(0,30)??null:null,fees:selected.has('fees')?value.fees:null,sources:Object.fromEntries(Object.entries(value.sources).filter(([key])=>selected.has(key))),reasons:Object.fromEntries(Object.entries(value.reasons).filter(([key])=>selected.has(key)))};
}
export async function readMarketPageBootstrap(pool:Pool,d:DeploymentIdentity,marketId:string,schemaName?:string){
 const schema=displaySchema(schemaName),id=displayIdentity(d),live=await readConfirmedState(pool,d,marketId,schemaName,'market');
 let market:MarketReadModel|undefined=live?{...live.payload.market,confirmation:{status:'confirmed',blockNumber:live.head_number,blockHash:live.head_hash,observedAt:new Date().toISOString()},...(live.payload.market.display?{display:{...live.payload.market.display,asOfTimestamp:live.head_timestamp,blockNumber:live.head_number,blockHash:live.head_hash}}:{})}:undefined;
 if(!market){market=(await pool.query<{payload:MarketReadModel}>(`SELECT payload FROM ${schema}.recent_markets WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4 AND canonical AND expires_at>now() UNION ALL SELECT r.payload FROM ${schema}.projection_read_records r JOIN ${schema}.publication_pointers p USING(environment,chain_id,deployment_digest,scope,revision) WHERE r.environment=$1 AND r.chain_id=$2 AND r.deployment_digest=$3 AND r.scope='markets' AND r.identity=$4 LIMIT 1`,[...id,marketId])).rows[0]?.payload;}
 if(!market?.identity)return null;
 const number=live?.head_number??market.display?.blockNumber??market.identity.blockNumber,hash=live?.head_hash??market.display?.blockHash??market.identity.blockHash;
 const sync:MarketDetailResponse['sync']={chainId:d.chainId,status:'synced',finality:market.confirmation?'head':'finalized',blockNumber:number,blockHash:hash,headBlockNumber:number,headBlockHash:hash,lagBlocks:'0',revision:`${number}:${hash}`};
 return{displayOnly:true as const,market,sync,configs:runtimeConfigs as readonly ConfigReadModel[]};
}

/** Compact, persisted readiness only. No RPC, price fetch, indexing or repair in HTTP. */
export async function readLaunchReadiness(pool:Pick<Pool,'query'>,d:DeploymentIdentity,marketId:string,schemaName?:string){
 const s=displaySchema(schemaName);
 const row=(await pool.query<{token:string;missing:string[]}>(`SELECT token,missing FROM (
 SELECT m.payload->'market'->>'memeToken' token,m.launch_missing missing,0 priority FROM ${s}.confirmed_display_markets m
 JOIN ${s}.confirmed_display_cursor c USING(environment,chain_id,deployment_digest)
 WHERE m.environment=$1 AND m.chain_id=$2 AND m.deployment_digest=$3 AND m.market_id=$4 AND m.block_number<=c.block_number
 UNION ALL SELECT r.payload->>'memeToken',r.launch_missing,1 FROM ${s}.recent_markets r
 WHERE r.environment=$1 AND r.chain_id=$2 AND r.deployment_digest=$3 AND r.market_id=$4 AND r.canonical AND r.expires_at>now()
 AND r.block_number>coalesce((SELECT next_block-1 FROM ${s}.projection_checkpoints WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='analytics'),-1)
 ) x ORDER BY priority LIMIT 1`,[...displayIdentity(d),marketId])).rows[0];
 return {chainId:d.chainId,marketId,memeToken:row?.token??null,ready:Boolean(row&&row.missing.length===0)};
}
