import type { Pool } from 'pg';
import type { DeploymentIdentity } from '../../chain/src/index.ts';
import type { Address } from '../../analytics/src/index.ts';
import type { PriceReference } from './index.ts';

export async function latestPrices(pool:Pool,deployment:DeploymentIdentity,now:Date,schemaName?:string){const schema=identifier(schemaName??'tickergarden_serverless');return (await pool.query<{asset:Address;payload:PriceReference}>(`SELECT DISTINCT ON (asset,source) asset,payload FROM ${schema}.price_references WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 ORDER BY asset,source,(status='available' AND expires_at>$4) DESC,as_of DESC`,[...identity(deployment),now])).rows}
export function preferredPrices(rows:readonly {asset:Address;payload:PriceReference}[],now:Date){const output=new Map<Address,PriceReference>();for(const row of rows){const candidate=publicPrice(viewPrice(row.payload,now));const current=output.get(row.asset);if(!current||priceRank(candidate)>priceRank(current))output.set(row.asset,candidate)}return output}
function priceRank(value:PriceReference){return value.status==='available'&&value.bidUsd&&value.askUsd?2:value.status==='stale'?1:0}
function viewPrice(value:PriceReference,now:Date):PriceReference{if(value.status==='available'&&value.expiresAt&&new Date(value.expiresAt)<=now)return{...value,status:'stale',reason:'price_expired',bidUsd:null,askUsd:null};return value}
function publicPrice(value:PriceReference):PriceReference{const{rawBidUsd:_rawBid,rawAskUsd:_rawAsk,...visible}=value;return visible}

function identity(d:DeploymentIdentity){return [d.environment,d.chainId,d.deploymentDigest];}
function identifier(value:string){if(!/^[a-z][a-z0-9_]{0,62}$/.test(value))throw Error('invalid schema');return `"${value}"`;}
