import type {PoolClient} from 'pg';
import {verifySnapshot,compactSnapshotDataset,type SnapshotDataset} from './holder-snapshot.ts';
/** Caller owns the transaction. Complete verification precedes atomic index publication. */
export async function indexHolderDataset(client:PoolClient,schemaName:string,environment:string,dataset:SnapshotDataset){
 if(!/^[a-z][a-z0-9_]{0,62}$/.test(schemaName))throw Error('invalid schema');
 const d=verifySnapshot(dataset),i=d.input,s=`"${schemaName}"`,id=[environment,i.chainId,i.deploymentDigest,i.marketId,i.round,d.dataHash];
 const row=await client.query(`SELECT 1 FROM ${s}.holder_reward_datasets WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4 AND round=$5 AND data_hash=$6 AND (payload=$7::jsonb OR payload=$8::jsonb) FOR UPDATE`,[...id,d,compactSnapshotDataset(d)]);
 if(!row.rowCount)throw Error('snapshot dataset changed before indexing');
 await client.query(`DELETE FROM ${s}.holder_reward_wallet_proofs WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4 AND round=$5 AND data_hash=$6`,id);
 for(let offset=0;offset<d.entries.length;offset+=500){
  await client.query(`INSERT INTO ${s}.holder_reward_wallet_proofs SELECT $1,$2,$3,$4,$5,$6,r.account,r.payload FROM jsonb_to_recordset($7::jsonb) r(account text,payload jsonb)`,[...id,JSON.stringify(d.entries.slice(offset,offset+500).map(({account,quoteAmount,memeAmount,proof})=>({account,payload:{quoteAmount,memeAmount,proof}})))]);
 }
 const {balances,exclusions,...input}=i;
 await client.query(`UPDATE ${s}.holder_reward_datasets SET verified_header=$7 WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4 AND round=$5 AND data_hash=$6`,[...id,{input,root:d.root,dataHash:d.dataHash,quoteBudget:d.quoteBudget,memeBudget:d.memeBudget}]);
}

/** Explicit upgrade/backfill; runtime GET never reconstructs full datasets. */
export async function backfillHolderProofIndexes(pool:import('pg').Pool,deployment:import('./index.ts').DeploymentIdentity,schemaName='tickergarden_serverless'){
 if(!/^[a-z][a-z0-9_]{0,62}$/.test(schemaName))throw Error('invalid schema');
 const {transaction}=await import('../../db/src/index.ts');
 const {buildSnapshot,canonicalSnapshotJson}=await import('./holder-snapshot.ts');
 let count=0;
 for(;;){
  const rows=await pool.query<{payload:SnapshotDataset}>(`SELECT payload FROM "${schemaName}".holder_reward_datasets WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND verified_header IS NULL ORDER BY market_id,round LIMIT 1`,[deployment.environment,deployment.chainId,deployment.deploymentDigest]);
  if(!rows.rows.length)return count;
  for(const row of rows.rows){const stored=row.payload;const ds=Array.isArray(stored.entries)?verifySnapshot(stored):buildSnapshot(stored.input);
   if(!Array.isArray(stored.entries)&&canonicalSnapshotJson(compactSnapshotDataset(ds))!==canonicalSnapshotJson(stored))throw Error('stored snapshot commitments corrupt');
   await transaction(pool,client=>indexHolderDataset(client,schemaName,deployment.environment,ds));count++;
  }
 }
}
