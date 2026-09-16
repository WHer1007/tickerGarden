import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {encodeEventTopics,encodeAbiParameters,getAbiItem} from 'viem';
import {applyCoreMigration,createDatabasePool} from '../../packages/db/src/index.ts';
import {createChainProcessor} from '../../packages/chain-worker/src/index.ts';
import {snapshotDistributor} from '../../packages/chain-worker/src/holder-snapshots.ts';
import {CURRENT_RELEASE_ID,CURRENT_ACTIVATION_BLOCK} from '../../packages/events/src/index.ts';
import {snapshotAbis} from '../../packages/events/src/f72-abis.generated.ts';
import {FakeRpc,h,a,height} from '../fixtures/snapshot-rpc.ts';
import type {Lease} from '../../packages/jobs/src/index.ts';
const url=process.env.TG_TEST_DATABASE_URL;
class ContinuationRpc extends FakeRpc {
 reads=0;
 override async block(n:bigint){if(n===0n)return{number:0n,hash:'0x829a42e6d68c872aafcef3abb2123fe371138fc415dd8b44381bbbf23049dd32' as const,parentHash:h(0),timestamp:0n};return super.block(n);}
 override async callAt(...args:Parameters<FakeRpc['callAt']>){this.reads++;return super.callAt(...args);}
}
test('chain processor durably continues 129 Holder markets, skips completed scopes, and ignores obsolete work',{timeout:60000},async ctx=>{
 if(!url){ctx.skip('local PostgreSQL required');return;}
 const schemaName='tg_continue_'+randomBytes(6).toString('hex'),s=`"${schemaName}"`,{pool}=createDatabasePool(url);
 const id=['test',46630,CURRENT_RELEASE_ID],primary=new ContinuationRpc(),secondary=new ContinuationRpc();
 const lease:Lease={id:'local',operationId:'local',queue:'chain',kind:'chain-backfill',payload:{headBlock:height.toString(),headHash:h(3)},payloadDigest:h(1),generation:'0',fencing:'1',attempt:1,maxAttempts:16,leaseExpiresAt:new Date(Date.now()+60000)};
 try{
  await applyCoreMigration(pool,schemaName);
  await pool.query(`INSERT INTO ${s}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES($1,$2,$3,$4,$5,$6,$7)`,[...id,h(1),CURRENT_ACTIVATION_BLOCK.toString(),h(2),h(3)]);
  await pool.query(`INSERT INTO ${s}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized) VALUES($1,$2,$3,$4,$5,$6,true,true)`,[...id,height.toString(),h(3),h(2)]);
  await pool.query(`INSERT INTO ${s}.ingestion_checkpoints(environment,chain_id,deployment_digest,stream,next_block,last_block_hash,generation) VALUES($1,$2,$3,'frontend-events',$4,$5,0)`,[...id,(height+1n).toString(),h(3)]);
  for(const scope of ['markets','configs','accounts','positions','history','analytics'])await pool.query(`INSERT INTO ${s}.projection_checkpoints(environment,chain_id,deployment_digest,scope,algorithm_version,next_block,generation) VALUES($1,$2,$3,$4,'test',$5,0)`,[...id,scope,(height+1n).toString()]);
  for(let i=1;i<=129;i++){
   const args={marketId:h(i),token:a(2),quote:a(0),vault:a(8)};
   const event=getAbiItem({abi:snapshotAbis.HolderRewardsDistributorV1,name:'HolderSnapshotMarketRegistered'});
   const topics=encodeEventTopics({abi:snapshotAbis.HolderRewardsDistributorV1,eventName:'HolderSnapshotMarketRegistered',args});
   const fields=event.inputs.filter(x=>!x.indexed);
   const data=encodeAbiParameters(fields,fields.map(x=>args[x.name as keyof typeof args]));
   const log={address:snapshotDistributor(),blockNumber:height.toString(),blockHash:h(3),transactionHash:h(1000+i),transactionIndex:'0',logIndex:'0',topics,data,removed:false};
   await pool.query(`INSERT INTO ${s}.chain_logs(environment,chain_id,deployment_digest,block_hash,transaction_hash,transaction_index,log_index,address,topic0,payload) VALUES($1,$2,$3,$4,$5,0,0,$6,$7,$8)`,[...id,h(3),log.transactionHash,log.address,topics[0],log]);
  }
  const processor=createChainProcessor({pool,primary,secondary,schemaName,finalityDelayBlocks:0n,finalityDelaySeconds:0n});
  await processor(lease);
  assert.equal(Number((await pool.query(`SELECT count(*) FROM ${s}.projection_observations`)).rows[0].count),128);
  assert.equal(Number((await pool.query(`SELECT count(*) FROM ${s}.holder_reward_markets`)).rows[0].count),0,'incomplete candidate is not exposed');
  const jobs=(await pool.query(`SELECT kind,payload FROM ${s}.jobs WHERE kind='projection-continuation'`)).rows;
  assert.equal(jobs.length,1);
  const continuation={...lease,kind:jobs[0].kind,payload:jobs[0].payload};
  const before=primary.reads;
  await processor(continuation);
  assert.equal(primary.reads-before,4,'only global mode/publisher and final market state/exclusions read');
  assert.equal(Number((await pool.query(`SELECT count(*) FROM ${s}.holder_reward_markets`)).rows[0].count),129);
  assert.equal(Number((await pool.query(`SELECT count(*) FROM ${s}.projection_observations`)).rows[0].count),0);
  assert.equal(await processor(continuation),'projection:already-complete-or-obsolete');
  await pool.query(`INSERT INTO ${s}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized) VALUES($1,$2,$3,$4,$5,$6,true,true)`,[...id,(height-1n).toString(),h(4),h(2)]);
  primary.orphan=secondary.orphan=true;
  const rewind=JSON.parse(await processor(continuation));
  assert.equal(rewind.reorg,true);assert.equal(rewind.generation,'1');
  assert.equal(rewind.ancestor,(height-1n).toString());
  assert.equal((await pool.query(`SELECT canonical FROM ${s}.chain_blocks WHERE hash=$1`,[h(3)])).rows[0].canonical,false);
  assert.equal(await processor(continuation),'projection:already-complete-or-obsolete');
 }finally{await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);await pool.end();}
});

import {projectF72Principal} from '../../packages/principal-projector/src/index.ts';
import {ProjectionPending} from '../../packages/projection/src/index.ts';
test('principal-only continuation resumes without any market observation rows',async ctx=>{
 if(!url){ctx.skip('local PostgreSQL required');return;}
 const schemaName='tg_principal_resume_'+randomBytes(5).toString('hex'),s=`"${schemaName}"`,{pool}=createDatabasePool(url);
 const id=['test',46630,CURRENT_RELEASE_ID],primary=new ContinuationRpc(),secondary=new ContinuationRpc();
 const deployment={environment:'test' as const,chainId:46630 as const,deploymentDigest:CURRENT_RELEASE_ID,activationBlock:CURRENT_ACTIVATION_BLOCK};
 try{
  await applyCoreMigration(pool,schemaName);
  await pool.query(`INSERT INTO ${s}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES($1,$2,$3,$4,$5,$6,$7)`,[...id,h(1),CURRENT_ACTIVATION_BLOCK.toString(),h(2),h(3)]);
  await pool.query(`INSERT INTO ${s}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized) VALUES($1,$2,$3,$4,$5,$6,true,true)`,[...id,height.toString(),h(3),h(2)]);
  await pool.query(`INSERT INTO ${s}.ingestion_checkpoints(environment,chain_id,deployment_digest,stream,next_block,last_block_hash,generation) VALUES($1,$2,$3,'frontend-events',$4,$5,0)`,[...id,(height+1n).toString(),h(3)]);
  await pool.query(`INSERT INTO ${s}.covered_ranges(environment,chain_id,deployment_digest,from_block,to_block,generation,filter_digest,complete,verified_at) VALUES($1,$2,$3,$4,$5,0,$6,true,now())`,[...id,CURRENT_ACTIVATION_BLOCK.toString(),height.toString(),h(4)]);
  const revision=`${height}:${h(3)}`;
  await pool.query(`INSERT INTO ${s}.publications(environment,chain_id,deployment_digest,scope,revision,block_number,block_hash,generation,payload_digest,payload) VALUES($1,$2,$3,'markets',$4,$5,$6,0,$7,'{}')`,[...id,revision,height.toString(),h(3),h(5)]);
  await pool.query(`INSERT INTO ${s}.publication_pointers(environment,chain_id,deployment_digest,scope,revision) VALUES($1,$2,$3,'markets',$4)`,[...id,revision]);
  for(const scope of ['markets','configs','history','analytics'])await pool.query(`INSERT INTO ${s}.projection_checkpoints(environment,chain_id,deployment_digest,scope,algorithm_version,next_block,generation) VALUES($1,$2,$3,$4,'fixture',$5,0)`,[...id,scope,(height+1n).toString()]);
  await assert.rejects(projectF72Principal({pool,deployment,blockNumber:height,blockHash:h(3),generation:0n,primary,secondary,schemaName,maxPages:1}),ProjectionPending);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM ${s}.projection_observations`)).rows[0].n,0);
  const processor=createChainProcessor({pool,primary,secondary,schemaName,finalityDelayBlocks:0n,finalityDelaySeconds:0n});
  const lease:Lease={id:'resume',operationId:'resume',queue:'chain',kind:'projection-continuation',payload:{headBlock:height.toString(),headHash:h(3)},payloadDigest:h(1),generation:'0',fencing:'1',attempt:1,maxAttempts:16,leaseExpiresAt:new Date(Date.now()+60000)};
  assert.equal(await processor(lease),`projection:${height}`);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM ${s}.publication_pointers WHERE scope IN ('accounts','positions') AND revision=$1`,[revision])).rows[0].n,2);
 }finally{await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);await pool.end();}
});
