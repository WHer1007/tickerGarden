import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import test from 'node:test';
import type {Pool} from 'pg';
import {applyCoreMigration,createDatabasePool} from '../../packages/db/src/index.ts';
import {readSnapshotUpdates} from '../../packages/read-store/src/index.ts';

test('updates reads one publication snapshot while another connection publishes a new revision',async t=>{
 const connectionString=process.env.TG_MIGRATION_DATABASE_URL??process.env.TG_DATABASE_URL;
 if(!connectionString)return t.skip('local integration database required');
 const {pool}=createDatabasePool(connectionString,{max:3});
 const name='tg_updates_'+randomBytes(6).toString('hex'),s=`"${name}"`;
 const hash=(n:number):`0x${string}`=>`0x${n.toString(16).padStart(64,'0')}`;
 const d={environment:'test' as const,chainId:46630 as const,deploymentDigest:hash(1),activationBlock:1n};
 const scopes=['markets','configs','positions','accounts'];
 try{
  await applyCoreMigration(pool,name);
  await pool.query(`INSERT INTO ${s}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES('test',46630,$1,$2,1,$3,$4)`,[d.deploymentDigest,hash(0),hash(2),hash(9)]);
  const publish=async(n:number)=>{
   await pool.query(`INSERT INTO ${s}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized) VALUES('test',46630,$1,$2,$3,$4,true,true)`,[d.deploymentDigest,n,hash(n+1),hash(n)]);
   for(const scope of scopes){
    await pool.query(`INSERT INTO ${s}.publications(environment,chain_id,deployment_digest,scope,revision,block_number,block_hash,generation,payload_digest,payload) VALUES('test',46630,$1,$2,$3,$4,$5,0,$6,'{}')`,[d.deploymentDigest,scope,`${n}:${hash(n+1)}`,n,hash(n+1),hash(9)]);
    await pool.query(`INSERT INTO ${s}.publication_pointers(environment,chain_id,deployment_digest,scope,revision) VALUES('test',46630,$1,$2,$3) ON CONFLICT(environment,chain_id,deployment_digest,scope) DO UPDATE SET revision=excluded.revision`,[d.deploymentDigest,scope,`${n}:${hash(n+1)}`]);
   }
  };
  await publish(1);
  const client=await pool.connect(),query=client.query.bind(client);let switched=false;
  client.query=(async(...args:unknown[])=>{
   const result=await (query as Function)(...args);
   if(String(args[0]).includes('SELECT pointer.scope')&&!switched){switched=true;await publish(2);}
   return result;
  }) as typeof client.query;
  const wrapper={connect:async()=>client} as unknown as Pool;
  let result;
  try{result=await readSnapshotUpdates({pool:wrapper,deployment:d,schemaName:name});}
  finally{client.query=query;}
  assert.equal(switched,true);
  assert.equal(result.sync.revision,`1:${hash(2)}`);
  assert.equal(result.sync.status,'synced');
  const next=await readSnapshotUpdates({pool,deployment:d,schemaName:name,since:result.sync.revision});
  assert.equal(next.sync.revision,`2:${hash(3)}`);
  assert.equal(next.mode,'changed');
 }finally{await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);await pool.end();}
});
