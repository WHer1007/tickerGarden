import type {Pool} from 'pg';
import type {DeploymentIdentity} from '../../chain/src/index.ts';
import {transaction} from '../../db/src/index.ts';
import {PublicationUnavailableError} from '../../read-store/src/index.ts';
import {buildProtocolStatistics} from './index.ts';
const interval=20*60_000;
function table(name:string){if(!/^[a-z][a-z0-9_]{0,62}$/.test(name))throw Error('invalid schema');return `"${name}"`;}
/** A GET is a single indexed snapshot read, never a population aggregation. */
export async function readProtocolStatistics(input:{pool:Pool;deployment:DeploymentIdentity;schemaName?:string}){
 const s=table(input.schemaName??'tickergarden_serverless'),d=input.deployment;
 const row=(await input.pool.query<{payload:Awaited<ReturnType<typeof buildProtocolStatistics>>&{generatedAt:number;nextRefreshAt:number}}>(`SELECT r.payload FROM ${s}.protocol_statistics_snapshots r JOIN ${s}.ingestion_checkpoints i ON i.environment=r.environment AND i.chain_id=r.chain_id AND i.deployment_digest=r.deployment_digest AND i.stream='frontend-events' AND i.generation=r.generation JOIN ${s}.chain_blocks b ON b.environment=r.environment AND b.chain_id=r.chain_id AND b.deployment_digest=r.deployment_digest AND b.hash=r.block_hash LEFT JOIN ${s}.chain_blocks p ON p.environment=r.environment AND p.chain_id=r.chain_id AND p.deployment_digest=r.deployment_digest AND p.hash=r.staking_block_hash WHERE r.environment=$1 AND r.chain_id=$2 AND r.deployment_digest=$3 AND b.canonical AND b.finalized AND (r.staking_block_hash IS NULL OR (p.canonical AND p.finalized)) AND r.generated_at>now()-interval '25 minutes'`,[d.environment,d.chainId,d.deploymentDigest])).rows[0];
 if(!row)throw new PublicationUnavailableError('statistics snapshot pending');return row.payload;
}
export async function publishProtocolStatistics(pool:Pool,deployment:DeploymentIdentity,schemaName='tickergarden_serverless',now=new Date()){
 const s=table(schemaName),id=[deployment.environment,deployment.chainId,deployment.deploymentDigest];
 return transaction(pool,async client=>{
  await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await client.query("SET LOCAL statement_timeout='30s'");
  if(!(await client.query<{locked:boolean}>('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) locked',[`protocol-stats:${schemaName}:${id.join(':')}`])).rows[0]?.locked)return {published:false,reason:'busy'};
  const existing=(await client.query(`SELECT 1 FROM ${s}.protocol_statistics_snapshots r JOIN ${s}.ingestion_checkpoints i ON i.environment=r.environment AND i.chain_id=r.chain_id AND i.deployment_digest=r.deployment_digest AND i.stream='frontend-events' AND i.generation=r.generation JOIN ${s}.chain_blocks b ON b.environment=r.environment AND b.chain_id=r.chain_id AND b.deployment_digest=r.deployment_digest AND b.hash=r.block_hash LEFT JOIN ${s}.chain_blocks p ON p.environment=r.environment AND p.chain_id=r.chain_id AND p.deployment_digest=r.deployment_digest AND p.hash=r.staking_block_hash WHERE r.environment=$1 AND r.chain_id=$2 AND r.deployment_digest=$3 AND r.generated_at>$4 AND b.source_timestamp>$4 AND b.canonical AND b.finalized AND (r.staking_block_hash IS NULL OR (p.canonical AND p.finalized))`,[...id,new Date(now.getTime()-interval)])).rowCount;
  if(existing)return {published:false,reason:'current'};
  const generation=(await client.query<{generation:string}>(`SELECT generation::text FROM ${s}.ingestion_checkpoints WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND stream='frontend-events'`,id)).rows[0]?.generation;
  if(generation===undefined)throw new PublicationUnavailableError('statistics ingestion pending');
  const payload=await buildProtocolStatistics({pool:{query:client.query.bind(client)} as unknown as Pool,deployment,schemaName});
  const checkpoint=(await client.query(`SELECT 1 FROM ${s}.projection_checkpoints WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='analytics' AND generation=$4`,[...id,generation])).rowCount;
  if(!checkpoint)throw new PublicationUnavailableError('statistics generation pending');
  const result={...payload,generatedAt:Math.floor(now.getTime()/1000),nextRefreshAt:Math.floor((now.getTime()+interval)/1000)};
  await client.query(`INSERT INTO ${s}.protocol_statistics_snapshots VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(environment,chain_id,deployment_digest) DO UPDATE SET generation=excluded.generation,block_hash=excluded.block_hash,staking_block_hash=excluded.staking_block_hash,generated_at=excluded.generated_at,payload=excluded.payload`,[...id,generation,payload.sourceBlockHash,payload.stakingBlockHash,now,result]);
  return {published:true,markets:payload.marketCount};
 });
}
