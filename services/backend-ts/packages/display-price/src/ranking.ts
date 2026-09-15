import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { DeploymentIdentity } from '../../chain/src/index.ts';
import { latestPrices, preferredPrices } from './read.ts';

export const CAP_INTERVAL_MS=20*60*1000;
export async function publishMarketCapRanking(pool:Pool,deployment:DeploymentIdentity,schemaName='tickergarden_serverless',now=new Date()) {
 if(!/^[a-z][a-z0-9_]{0,62}$/.test(schemaName))throw Error('invalid schema');
 const s=`"${schemaName}"`,id=[deployment.environment,deployment.chainId,deployment.deploymentDigest];
 const scheduled=new Date(Math.floor(now.getTime()/CAP_INTERVAL_MS)*CAP_INTERVAL_MS);
 const client=await pool.connect();
 try {
  await client.query('BEGIN');
  await client.query("SET LOCAL statement_timeout='30s'");
  await client.query("SET LOCAL idle_in_transaction_session_timeout='30s'");
  if(!(await client.query<{locked:boolean}>('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) locked',[`market-cap:${schemaName}:${id.join(':')}`])).rows[0]?.locked){await client.query('ROLLBACK');return {published:false,reason:'busy'};}
  const existing=(await client.query(`SELECT 1 FROM ${s}.market_cap_snapshots r JOIN ${s}.chain_blocks b ON b.environment=r.environment AND b.chain_id=r.chain_id AND b.deployment_digest=r.deployment_digest AND b.hash=r.block_hash WHERE r.environment=$1 AND r.chain_id=$2 AND r.deployment_digest=$3 AND r.scheduled_at>=$4 AND b.canonical AND b.finalized LIMIT 1`,[...id,scheduled])).rowCount;
  if(existing){await client.query('COMMIT');return {published:false,reason:'current'};}
  const publication=(await client.query<{revision:string;block_hash:string;as_of:string}>(`SELECT p.revision,p.block_hash,extract(epoch FROM b.source_timestamp)::bigint::text as_of FROM ${s}.publication_pointers ptr JOIN ${s}.publications p USING(environment,chain_id,deployment_digest,scope,revision) JOIN ${s}.chain_blocks b ON b.environment=p.environment AND b.chain_id=p.chain_id AND b.deployment_digest=p.deployment_digest AND b.hash=p.block_hash WHERE p.environment=$1 AND p.chain_id=$2 AND p.deployment_digest=$3 AND p.scope='markets' AND b.canonical AND b.finalized FOR SHARE OF b`,id)).rows[0];
  if(!publication){await client.query('ROLLBACK');return {published:false,reason:'publication_pending'};}
  // One price read per scheduled build. Readers never calculate a global ranking.
  const prices=[...preferredPrices(await latestPrices(client,deployment,now,schemaName),now).values()].filter(p=>p.status==='available'&&p.bidUsd&&p.askUsd).map(p=>({asset:p.token,bid:p.bidUsd!,ask:p.askUsd!,as_of:p.asOf,source:p.source}));
  const version=randomUUID();
  await client.query(`INSERT INTO ${s}.market_cap_snapshots(environment,chain_id,deployment_digest,version,scheduled_at,created_at,revision,block_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[...id,version,scheduled,now,publication.revision,publication.block_hash]);
  const result=await client.query(`WITH prices AS (SELECT * FROM jsonb_to_recordset($6::jsonb) p(asset text,bid numeric,ask numeric,as_of text,source text)), values AS (
   SELECT r.identity,r.payload->>'assetUid' asset_uid,p.as_of,p.source,(p.bid+p.ask)/2 midpoint,
   CASE WHEN (r.payload->'display'->>'priceQuote') ~ '^(0|[1-9][0-9]*)(\\.[0-9]+)?$' AND (r.payload->'display'->>'totalSupplyRaw') ~ '^[0-9]+$' AND p.bid IS NOT NULL
    THEN (r.payload->'display'->>'totalSupplyRaw')::numeric/1000000000000000000::numeric*(r.payload->'display'->>'priceQuote')::numeric*(p.bid+p.ask)/2 ELSE NULL END cap
   FROM ${s}.projection_read_records r LEFT JOIN prices p ON p.asset=r.payload->>'quoteAsset' WHERE r.environment=$1 AND r.chain_id=$2 AND r.deployment_digest=$3 AND r.scope='markets' AND r.revision=$5
  ) INSERT INTO ${s}.market_cap_ranks(environment,chain_id,deployment_digest,version,market_id,rank,asset_uid,metrics)
   SELECT $1,$2,$3,$4,identity,row_number() OVER(ORDER BY cap DESC NULLS LAST,identity),asset_uid,
   jsonb_build_object('marketCapUsd',cap::text,'quoteUsdMidpoint',midpoint::text,'status',CASE WHEN cap IS NULL THEN 'unavailable' ELSE 'available' END,
    'reason',CASE WHEN cap IS NULL THEN 'valuation_inputs_unavailable' ELSE 'historical_usd_coverage_unavailable' END,'volume24hUsd',NULL,
    'windowFromTimestamp',greatest($7::bigint-86400,0)::text,'asOfTimestamp',$7::text,'usdPriceAsOf',as_of,'usdPriceSource',source,
    'volumeBasis','EXTERNAL_EXECUTIONS_CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE','marketCapBasis','TOTAL_SUPPLY_X_FINALIZED_SPOT_X_QUOTE_USD') FROM values`,
   [...id,version,publication.revision,JSON.stringify(prices),publication.as_of??'0']);
  // Retain old versions for stable pagination, with bounded storage.
  await client.query(`DELETE FROM ${s}.market_cap_snapshots WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND created_at<$4`,[...id,new Date(now.getTime()-2*60*60*1000)]);
  await client.query('COMMIT');return {published:true,version,markets:result.rowCount??0};
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
