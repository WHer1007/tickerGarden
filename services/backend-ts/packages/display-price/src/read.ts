import type { Pool } from 'pg';
import type { DeploymentIdentity } from '../../chain/src/index.ts';
import type { Address } from '../../analytics/src/index.ts';
import type { PriceReference } from './index.ts';

export async function latestPrices(pool:Pick<Pool,'query'>,deployment:DeploymentIdentity,now:Date,schemaName?:string){
 const schema=identifier(schemaName??'tickergarden_serverless');
 // Seek distinct asset/source keys through the existing primary index. Only
 // unexpired candidates are ranked; otherwise read the latest row by its key.
 // Materializing each fresh set avoids scanning all history to satisfy LIMIT 1.
 return (await pool.query<{asset:Address;payload:PriceReference}>(`WITH RECURSIVE keys AS (
 (SELECT asset,source FROM ${schema}.price_references WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 ORDER BY asset,source LIMIT 1)
 UNION ALL SELECT next.asset,next.source FROM keys k CROSS JOIN LATERAL (SELECT asset,source FROM ${schema}.price_references WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND (asset,source)>(k.asset,k.source) ORDER BY asset,source LIMIT 1) next
) SELECT k.asset,coalesce(fresh.payload,last.payload) payload FROM keys k
LEFT JOIN LATERAL (
 WITH candidates AS MATERIALIZED (SELECT payload,as_of FROM ${schema}.price_references WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND asset=k.asset AND source=k.source AND status='available' AND expires_at>$4)
 SELECT payload FROM candidates ORDER BY as_of DESC LIMIT 1
) fresh ON true
LEFT JOIN LATERAL (SELECT payload FROM ${schema}.price_references WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND asset=k.asset AND source=k.source AND fresh.payload IS NULL ORDER BY as_of DESC LIMIT 1) last ON true ORDER BY k.asset,k.source`,[...identity(deployment),now])).rows;
}
export function preferredPrices(rows:readonly {asset:Address;payload:PriceReference}[],now:Date){const output=new Map<Address,PriceReference>();for(const row of rows){const candidate=publicPrice(viewPrice(row.payload,now));const current=output.get(row.asset);if(!current||priceRank(candidate)>priceRank(current))output.set(row.asset,candidate)}return output}
function priceRank(value:PriceReference){return value.status==='available'&&value.bidUsd&&value.askUsd?2:value.status==='stale'?1:0}
function viewPrice(value:PriceReference,now:Date):PriceReference{if(value.status==='available'&&value.expiresAt&&new Date(value.expiresAt)<=now)return{...value,status:'stale',reason:'price_expired',bidUsd:null,askUsd:null};return value}
function publicPrice(value:PriceReference):PriceReference{const{rawBidUsd:_rawBid,rawAskUsd:_rawAsk,...visible}=value;return visible}

function identity(d:DeploymentIdentity){return [d.environment,d.chainId,d.deploymentDigest];}
function identifier(value:string){if(!/^[a-z][a-z0-9_]{0,62}$/.test(value))throw Error('invalid schema');return `"${value}"`;}
