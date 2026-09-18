import type {PoolClient} from 'pg';
import type {DeploymentIdentity,RpcTransport} from '../../chain/src/index.ts';
import {changeChannel,regions} from './changes.ts';
/** Also catches reorgs above the display cursor, before a recent launch is indexed. */
export async function validateRecentDisplay(client:PoolClient,d:DeploymentIdentity,rpc:Pick<RpcTransport,'block'>,head:bigint,schemaName='tickergarden_serverless'){
 if(!/^[a-z][a-z0-9_]{0,62}$/.test(schemaName))throw Error('invalid schema');
 const s=`"${schemaName}"`,id=[d.environment,d.chainId,d.deploymentDigest];
 const rows=(await client.query<{block_number:string;block_hash:string}>(`SELECT r.block_number::text,r.block_hash FROM ${s}.recent_markets r
 WHERE r.environment=$1 AND r.chain_id=$2 AND r.deployment_digest=$3 AND r.canonical AND r.expires_at>now()
 AND (r.display_checked_at IS NULL OR r.display_checked_at<now()-interval '5 seconds')
 AND NOT EXISTS(SELECT 1 FROM ${s}.confirmed_display_markets m JOIN ${s}.confirmed_display_cursor c USING(environment,chain_id,deployment_digest) WHERE m.environment=r.environment AND m.chain_id=r.chain_id AND m.deployment_digest=r.deployment_digest AND m.market_id=r.market_id AND m.block_number<=c.block_number)
 GROUP BY r.block_number,r.block_hash ORDER BY min(r.display_checked_at) NULLS FIRST,r.block_number LIMIT 32`,id)).rows;
 for(const row of rows){
  const canonical=BigInt(row.block_number)<=head&&(await rpc.block(BigInt(row.block_number))).hash===row.block_hash;
  // Status and hint commit together; readers cannot observe a deletion without its hint.
  await client.query('BEGIN');
  try{
   const affected=await client.query<{market_id:string}>(`UPDATE ${s}.recent_markets SET canonical=$6,display_checked_at=now() WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND block_number=$4 AND block_hash=$5 AND canonical RETURNING market_id`,[...id,row.block_number,row.block_hash,canonical]);
   if(!canonical)for(const m of affected.rows)await client.query('SELECT pg_notify($1,$2)',[changeChannel(d,schemaName),JSON.stringify({marketId:m.market_id,regions,revision:`reorg:recent:${row.block_hash}`})]);
   await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e;}
 }
}
