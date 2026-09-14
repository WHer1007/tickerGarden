import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import type { DeploymentIdentity } from '../../../packages/chain/src/index.ts';
import { transaction } from '../../../packages/db/src/index.ts';
import { PublicationUnavailableError } from '../../../packages/read-store/src/index.ts';

/** Canonical/generation-checked, transaction-invalidated cache shared across API instances. */
export async function sharedStatistics<T>(input:{pool:Pool;deployment:DeploymentIdentity;schemaName?:string},key:string,build:(pool:Pool)=>Promise<T>):Promise<T>{
 const name=input.schemaName??'tickergarden_serverless';if(!/^[a-z][a-z0-9_]{0,62}$/.test(name))throw Error('invalid schema');const schema=`"${name}"`,id=[input.deployment.environment,input.deployment.chainId,input.deployment.deploymentDigest];
 return transaction(input.pool,async client=>{
  const fingerprint=async()=>{
   const r=(await client.query<{version:string;generation:string;revision:string}>(`SELECT coalesce(v.version,0)::text version,i.generation::text generation,c.last_revision revision FROM ${schema}.projection_checkpoints c JOIN ${schema}.ingestion_checkpoints i ON i.environment=c.environment AND i.chain_id=c.chain_id AND i.deployment_digest=c.deployment_digest AND i.stream='frontend-events' JOIN ${schema}.chain_blocks b ON b.environment=c.environment AND b.chain_id=c.chain_id AND b.deployment_digest=c.deployment_digest AND b.number=c.next_block-1 AND c.last_revision=b.number::text||':'||b.hash LEFT JOIN ${schema}.statistics_cache_versions v ON v.environment=c.environment AND v.chain_id=c.chain_id AND v.deployment_digest=c.deployment_digest WHERE c.environment=$1 AND c.chain_id=$2 AND c.deployment_digest=$3 AND c.scope='analytics' AND b.canonical AND b.finalized AND i.generation=c.generation`,id)).rows[0];
   if(!r)throw new PublicationUnavailableError('statistics cache anchor unavailable');return JSON.stringify(r);
  };
  const version=await fingerprint(),cacheKey=createHash('sha256').update(JSON.stringify(['statistics-v1',key,version])).digest('hex');
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`statistics:${id.join(':')}:${cacheKey}`]);
  if(await fingerprint()!==version)throw new PublicationUnavailableError('statistics changed while waiting');
  const saved=(await client.query<{payload:T}>(`SELECT payload FROM ${schema}.statistics_result_cache WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND cache_key=$4 AND expires_at>now()`,[...id,cacheKey])).rows[0];
  if(saved){if(await fingerprint()!==version)throw new PublicationUnavailableError('statistics changed during cache read');return saved.payload;}
  // Existing statistics functions use query only. One borrowed connection avoids
  // pool starvation when several instances share a small connection pool.
  const scoped={query:client.query.bind(client)} as unknown as Pool;
  // Global aggregates scan a population. Prevent cold-table cardinality guesses
  // from turning that join into a quadratic nested-loop scan.
  await client.query('SET LOCAL enable_nestloop=off');
  const result=await build(scoped);
  if(await fingerprint()!==version)throw new PublicationUnavailableError('statistics changed during computation');
  const encoded=JSON.stringify(result);
  if(Buffer.byteLength(encoded)<=4_000_000){
   await client.query(`INSERT INTO ${schema}.statistics_result_cache SELECT $1,$2,$3,$4,$5::jsonb,now()+interval '15 seconds' WHERE octet_length($5::jsonb::text)<=4194304 ON CONFLICT(environment,chain_id,deployment_digest,cache_key) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at`,[...id,cacheKey,encoded]);
   await client.query(`DELETE FROM ${schema}.statistics_result_cache WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND (expires_at<=now() OR cache_key IN (SELECT cache_key FROM ${schema}.statistics_result_cache WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 ORDER BY expires_at DESC,cache_key OFFSET 128))`,id);
  }
  return result;
 }).catch(error=>{if(error?.code==='55P03'||error?.code==='57014')throw new PublicationUnavailableError('statistics computation is busy');throw error;});
}
