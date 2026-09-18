import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {DeploymentIdentity} from '../../chain/src/index.ts';
// Called with the display worker's existing connection and deployment lock.
export async function publishExploreRanking(client:PoolClient,d:DeploymentIdentity,schemaName='tickergarden_serverless',now=new Date()){
 if(!/^[a-z][a-z0-9_]{0,62}$/.test(schemaName))throw Error('invalid schema');
 const s=`"${schemaName}"`,id=[d.environment,d.chainId,d.deploymentDigest],scheduled=new Date(Math.floor(now.getTime()/1200000)*1200000);
 if((await client.query(`SELECT 1 FROM ${s}.explore_cap_snapshots WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scheduled_at>=$4 LIMIT 1`,[...id,scheduled])).rowCount)return false;
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
 try{
  const version=randomUUID();
  await client.query(`INSERT INTO ${s}.explore_cap_snapshots(environment,chain_id,deployment_digest,version,scheduled_at,created_at) VALUES($1,$2,$3,$4,$5,$6)`,[...id,version,scheduled,now]);
  await client.query(`INSERT INTO ${s}.explore_cap_ranks SELECT environment,chain_id,deployment_digest,$4,market_id,row_number() OVER(ORDER BY (payload->'metrics'->>'marketCapUsd')::numeric DESC NULLS LAST,market_id) FROM ${s}.explore_display_cards WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3`,[...id,version]);
  await client.query(`DELETE FROM ${s}.explore_cap_snapshots WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND created_at<$4`,[...id,new Date(now.getTime()-7200000)]);
  await client.query('COMMIT');return true;
 }catch(e){await client.query('ROLLBACK');throw e;}
}
