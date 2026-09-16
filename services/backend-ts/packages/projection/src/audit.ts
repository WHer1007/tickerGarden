import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import type { DeploymentIdentity } from '../../chain/src/index.ts';
import { transaction } from '../../db/src/index.ts';
import type { Json, ProjectionRecord } from './index.ts';
const stable=(v:any):string=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?`[${v.map(stable).join(',')}]`:`{${Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>`${JSON.stringify(k)}:${stable(x)}`).join(',')}}`;
const digest=(v:unknown)=>'0x'+createHash('sha256').update(stable(v)).digest('hex');
const normalized=(rows:Iterable<ProjectionRecord>)=>[...rows].sort((a,b)=>a.sortKey.localeCompare(b.sortKey)||a.identity.localeCompare(b.identity));
/** Offline full audit of the checkpoint plus at most 256 deltas. No writes or RPC. */
export async function auditMarketPublication(input:{pool:Pool;deployment:DeploymentIdentity;revision:string;schemaName?:string}){
 const name=input.schemaName??'tickergarden_serverless';if(!/^[a-z][a-z0-9_]{0,62}$/.test(name))throw Error('invalid schema');const schema=`"${name}"`,id=[input.deployment.environment,input.deployment.chainId,input.deployment.deploymentDigest];
 return transaction(input.pool,async client=>{
  await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  type Pub={revision:string;payload_digest:string;block_number:string;generation:string;payload:any};
  const chain:Pub[]=[];let revision=input.revision;const seen=new Set<string>();
  for(;;){
   if(seen.has(revision)||seen.size>256)throw Error('invalid or uncheckpointed delta lineage');seen.add(revision);
   const p=(await client.query<Pub>(`SELECT p.* FROM ${schema}.publications p JOIN ${schema}.chain_blocks b ON b.environment=p.environment AND b.chain_id=p.chain_id AND b.deployment_digest=p.deployment_digest AND b.hash=p.block_hash WHERE p.environment=$1 AND p.chain_id=$2 AND p.deployment_digest=$3 AND p.scope='markets' AND p.revision=$4 AND b.canonical AND b.finalized`,[...id,revision])).rows[0];
   if(!p||p.payload.storage!=='market-versions-v1')throw Error('audit publication unavailable');
   const child=chain.at(-1);if(child&&(child.payload.baseDigest!==p.payload_digest||child.generation!==p.generation||BigInt(child.block_number)<=BigInt(p.block_number)))throw Error('delta parent proof mismatch');
   chain.push(p);if(p.payload.commitment!=='base-delta-v1')break;
   if(digest(p.payload)!==p.payload_digest||!Array.isArray(p.payload.entries))throw Error('delta commitment mismatch');revision=p.payload.baseRevision;
  }
  const read=async(revision:string)=> (await client.query<{identity:string;sort_key:string;payload:Json}>(`SELECT identity,sort_key,payload FROM ${schema}.projection_read_records WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='markets' AND revision=$4`,[...id,revision])).rows.map(r=>({identity:r.identity,sortKey:r.sort_key,payload:r.payload}));
  const base=chain.pop()!,initial=await read(base.revision),state=new Map(initial.map(r=>[r.identity,r]));
  if(state.size!==base.payload.recordCount||digest(normalized(initial))!==base.payload_digest)throw Error('full checkpoint audit mismatch');
  for(const p of chain.reverse()){
   const changed=new Set<string>();
   for(const e of p.payload.entries){if(changed.has(e.identity))throw Error('duplicate delta identity');changed.add(e.identity);if(e.removed){if(!state.delete(e.identity))throw Error('delta removes missing identity');continue;}
    const row=(await client.query<{payload:Json;sort_key:string;payload_digest:string}>(`SELECT payload,sort_key,payload_digest FROM ${schema}.market_record_versions WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND generation=$4 AND identity=$5 AND valid_from<=$6 AND (valid_to IS NULL OR valid_to>$6)`,[...id,p.generation,e.identity,p.block_number])).rows;
    if(row.length!==1||row[0]!.sort_key!==e.sortKey||row[0]!.payload_digest!==e.payloadDigest||digest(row[0]!.payload)!==e.payloadDigest)throw Error('delta record audit mismatch');
    state.set(e.identity,{identity:e.identity,sortKey:e.sortKey,payload:row[0]!.payload});
   }
   if(state.size!==p.payload.recordCount)throw Error('delta population audit mismatch');
  }
  const current=await read(input.revision);
  if(current.length!==state.size||digest(normalized(current))!==digest(normalized(state.values())))throw Error('undeclared market version change');
  return{revision:input.revision,records:state.size,fullCheckpoint:base.revision,deltas:chain.length,verified:true as const};
 });
}
