import {hydrateDisplayHistory} from './history.ts';
import {formatUnits,parseUnits} from 'viem';
import type {Pool} from 'pg';
import type {DeploymentIdentity} from '../../chain/src/index.ts';
import type {MarketReadModel,TokenDetailResponse} from '../../../openapi/generated/v1-client.ts';
import {batchPrices,createPriceBatch,type PriceBatch} from '../../display-price/src/batch.ts';
import {withDatabaseTask} from '../../db/src/telemetry.ts';
import {publicMarketContent} from './content.ts';
import {displayIdentity,displaySchema} from './worker.ts';
import {materializeDisplay,displayUsd,exploreMetrics,type DisplayState} from './state.ts';
import {changeChannel,type DisplayRegion} from './changes.ts';

/** Ignore coverage timestamps: notify only regions with a changed visible value. */
export function maintenanceRegions(before:DisplayState,after:DisplayState):DisplayRegion[]{
 const changed=(a:unknown,b:unknown)=>JSON.stringify(a)!==JSON.stringify(b);
 const result:DisplayRegion[]=[];
 if(changed(before.market.content,after.market.content))result.push('market');
 const stats=(state:DisplayState)=>{const s=state.detailViews?.['1H'].statistics;return s?{price:s.price,priceUsd:s.priceUsd,marketCapUsd:s.marketCapUsd,volume24h:s.volume24h}:null;};
 if(changed(stats(before),stats(after)))result.push('statistics');
 if(['1H','12H','1D'].some(p=>changed(before.detailViews?.[p as '1H']?.chart,after.detailViews?.[p as '1H']?.chart)))result.push('chart');
 if(changed(before.detailViews?.['1H'].trades,after.detailViews?.['1H'].trades))result.push('trades');
 return result;
}

/** Separate durable queue from chain advancement. HTTP readers never call this. */
interface PreparationInput {pool:Pick<Pool,'query'>;deployment:DeploymentIdentity;schemaName?:string;limit?:number;priceBatch?:PriceBatch}
export async function refreshDisplayPreparation(input:PreparationInput){
 return withDatabaseTask('confirmed-display-worker','display.prepare',()=>prepare(input));
}
async function prepare(input:PreparationInput){
 const {pool,deployment:d}=input,s=displaySchema(input.schemaName),id=displayIdentity(d),limit=Math.max(1,Math.min(100,input.limit??25));
 let processed=0,failed=0;
 // New launches with missing content/valuation have priority, independent of the
 // finalized analytics cursor. These repairs use only persisted shared prices.
 const recent=(await pool.query<{market_id:string;payload:MarketReadModel;initial_detail:TokenDetailResponse}>(`SELECT r.market_id,r.payload,r.initial_detail FROM ${s}.recent_markets r WHERE r.environment=$1 AND r.chain_id=$2 AND r.deployment_digest=$3 AND r.canonical AND r.expires_at>now() AND cardinality(r.launch_missing)>0 AND r.refresh_due_at<=now() AND r.initial_detail IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ${s}.confirmed_display_markets m WHERE m.environment=r.environment AND m.chain_id=r.chain_id AND m.deployment_digest=r.deployment_digest AND m.market_id=r.market_id) ORDER BY r.refresh_due_at,r.market_id LIMIT $4`,[...id,limit])).rows;
 const rows=(await pool.query<{market_id:string;payload:DisplayState;head_number:string;head_hash:`0x${string}`;head_timestamp:string}>(`SELECT m.market_id,m.payload,c.block_number::text head_number,c.block_hash head_hash,c.block_timestamp::text head_timestamp FROM ((SELECT * FROM ${s}.confirmed_display_markets WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND refresh_due_at<=now() AND cardinality(launch_missing)>0 ORDER BY refresh_due_at,market_id LIMIT $4) UNION ALL (SELECT * FROM ${s}.confirmed_display_markets WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND refresh_due_at<=now() AND cardinality(launch_missing)=0 ORDER BY refresh_due_at,market_id LIMIT $4)) m JOIN ${s}.confirmed_display_cursor c USING(environment,chain_id,deployment_digest) WHERE m.block_number<=c.block_number`,[...id,limit])).rows;
 if(!recent.length&&!rows.length)return {processed:0,failed:0,more:false};
 const prices=await batchPrices(input.priceBatch??createPriceBatch(d,input.schemaName),pool);
 const priceFor=(market:MarketReadModel)=>{const price=prices.get(market.quoteAsset);return {price,usd:price?.status==='available'&&price.bidUsd&&price.askUsd?formatUnits((parseUnits(price.bidUsd,36)+parseUnits(price.askUsd,36))/2n,36):null};};
 for(const row of recent){
  try{
   const {price,usd}=priceFor(row.payload),detail=row.initial_detail,stat=detail.statistics;
   if(!stat||!detail.holders)throw Error('initial_detail_incomplete');
   const market={...row.payload,content:row.payload.content??await publicMarketContent(pool,row.payload,input.schemaName)};
   const statistics={...stat,...displayUsd(stat.price,detail.holders.totalSupplyRaw,usd)};
   const payload={...market,metrics:exploreMetrics(statistics,usd,detail.sources.statistics?.asOf??0,price?.asOf??null,price?.source??null)};
   const changed=await pool.query(`UPDATE ${s}.recent_markets SET payload=$6,initial_detail=$7,refresh_due_at=now()+interval '5 seconds',refresh_attempts=refresh_attempts+1,refresh_error=NULL WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4 AND canonical AND payload=$5::jsonb`,[...id,row.market_id,JSON.stringify(row.payload),JSON.stringify(payload),JSON.stringify({...detail,statistics})]);
   if(changed.rowCount&&(JSON.stringify(row.payload)!==JSON.stringify(payload)||JSON.stringify(detail.statistics)!==JSON.stringify(statistics)))await pool.query('SELECT pg_notify($1,$2)',[changeChannel(d,input.schemaName),JSON.stringify({marketId:row.market_id,regions:['market','statistics'],revision:`prepared:${Date.now()}`})]);
   processed++;
  }catch{failed++;await defer('recent_markets',row.market_id);}
 }

 for(const row of rows){
  try{
   const {price,usd}=priceFor(row.payload.market);
   const content=row.payload.market.content??await publicMarketContent(pool,row.payload.market,input.schemaName);
   const hydrated=await hydrateDisplayHistory(pool,d,row.payload,input.schemaName);
   const next=materializeDisplay({...hydrated,quoteUsd:usd,quoteUsdAsOf:price?.asOf??null,quoteUsdSource:price?.source??null,market:{...row.payload.market,content}}, {number:row.head_number,hash:row.head_hash,timestamp:Number(row.head_timestamp)},true);
   // Compare-and-swap prevents a maintenance response overwriting a new event or
   // reorg. The cursor predicate also rejects work prepared before a rewind.
   const updated=await pool.query(`WITH locked_head AS MATERIALIZED (SELECT block_number FROM ${s}.confirmed_display_cursor WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND block_number=$7 AND block_hash=$8 FOR SHARE NOWAIT) UPDATE ${s}.confirmed_display_markets m SET payload=$6::jsonb WHERE m.environment=$1 AND m.chain_id=$2 AND m.deployment_digest=$3 AND m.market_id=$4 AND m.payload=$5::jsonb AND EXISTS(SELECT 1 FROM locked_head)`,[...id,row.market_id,JSON.stringify(row.payload),JSON.stringify(next),row.head_number,row.head_hash]);
   const regions=maintenanceRegions(row.payload,next);
   if(updated.rowCount&&regions.length)await pool.query('SELECT pg_notify($1,$2)',[changeChannel(d,input.schemaName),JSON.stringify({marketId:row.market_id,regions,revision:`window:${row.head_hash}`})]);
   processed++;
  }catch{failed++;await defer('confirmed_display_markets',row.market_id);}
 }
 return {processed,failed,more:recent.length===limit||rows.length>=limit};
 async function defer(table:'recent_markets'|'confirmed_display_markets',market:string){await pool.query(`UPDATE ${s}.${table} SET refresh_attempts=refresh_attempts+1,refresh_error='display_preparation_retry',refresh_due_at=now()+interval '30 seconds' WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4`,[...id,market]);}
}
