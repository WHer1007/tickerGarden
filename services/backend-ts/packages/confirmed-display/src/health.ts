import type {Pool} from 'pg';
import type {DeploymentIdentity} from '../../chain/src/index.ts';
export type DisplayCoverage={status:'gap'|'unverified';synchronized:false;reason:string;updatedAt:string|null;recoveryOwner:'durable-inbox'};
const schema=(name:string)=>{if(!/^[a-z][a-z0-9_]{0,62}$/.test(name))throw Error('Invalid schema');return `"${name}"`;};
const identity=(d:DeploymentIdentity)=>[d.environment,d.chainId,d.deploymentDigest];
/** Event observations establish no complete range coverage. This query never calls RPC. */
export async function readDisplayCoverage(pool:Pick<Pool,'query'>,d:DeploymentIdentity,name:string):Promise<DisplayCoverage>{
 const row=(await pool.query<{status:'gap'|'unverified';reason:string;updated_at:Date|string}>(`SELECT status,reason,updated_at FROM ${schema(name)}.display_health WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3`,identity(d))).rows[0];
 return {status:row?.status??'unverified',synchronized:false,reason:row?.reason??'event-coverage-not-verified',updatedAt:row?new Date(row.updated_at).toISOString():null,recoveryOwner:'durable-inbox'};
}
/** Sticky across restart, duplication and later successful events; only explicit upstream repair can resolve a gap. */
export async function recordDisplayGap(pool:Pick<Pool,'query'>,d:DeploymentIdentity,name:string,reason:string){
 if(!/^[a-z][a-z0-9:-]{0,100}$/.test(reason))throw Error('Invalid coverage reason');
 await pool.query(`INSERT INTO ${schema(name)}.display_health AS current(environment,chain_id,deployment_digest,status,reason) VALUES($1,$2,$3,'gap',$4) ON CONFLICT(environment,chain_id,deployment_digest) DO UPDATE SET status='gap',reason=EXCLUDED.reason,updated_at=now() WHERE current.reason IS DISTINCT FROM EXCLUDED.reason`,[...identity(d),reason]);
}
export function healthSync<T extends {status:string;headBlockNumber:unknown;headBlockHash:unknown;lagBlocks:unknown}>(snapshot:T){
 return {...snapshot,status:snapshot.status==='unavailable'?'unavailable' as const:'lagging' as const,headBlockNumber:null,headBlockHash:null,lagBlocks:null};
}
