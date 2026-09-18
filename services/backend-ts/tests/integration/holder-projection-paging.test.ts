import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {encodeEventTopics,encodeAbiParameters} from 'viem';
import {applyCoreMigration,createDatabasePool} from '../../packages/db/src/index.ts';
import {projectHolderRewards,snapshotDistributor} from '../../packages/chain-worker/src/holder-snapshots.ts';
import {ProjectionPending} from '../../packages/projection/src/index.ts';
import {CURRENT_RELEASE_ID,CURRENT_ACTIVATION_BLOCK} from '../../packages/events/src/index.ts';
import {snapshotAbis} from '../../packages/events/src/f72-abis.generated.ts';
import {FakeRpc,h,a,height} from '../fixtures/snapshot-rpc.ts';
const url=process.env.TG_TEST_DATABASE_URL;
test('busy sparse blocks stage in bounded pages, use distinct continuation identities, and commit only complete ranges',async t=>{
 if(!url){t.skip('local PostgreSQL required');return;}
 const schemaName='tg_holder_pages_'+randomBytes(5).toString('hex'),s=`"${schemaName}"`,{pool}=createDatabasePool(url),primary=new FakeRpc(),secondary=new FakeRpc();
 const deployment={environment:'test' as const,chainId:46630 as const,deploymentDigest:CURRENT_RELEASE_ID,activationBlock:CURRENT_ACTIVATION_BLOCK},id=['test',46630,CURRENT_RELEASE_ID];
 try{
  await applyCoreMigration(pool,schemaName);
  await pool.query(`INSERT INTO ${s}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES($1,$2,$3,$4,$5,$6,$7)`,[...id,h(1),String(CURRENT_ACTIVATION_BLOCK),h(2),h(3)]);
  await pool.query(`INSERT INTO ${s}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized) VALUES($1,$2,$3,$4,$5,$6,true,true),($1,$2,$3,$7,$8,$5,true,true)`,[...id,String(height),h(3),h(2),String(height+1000n),h(4)]);
  await pool.query(`INSERT INTO ${s}.ingestion_checkpoints(environment,chain_id,deployment_digest,stream,next_block,generation) VALUES($1,$2,$3,'frontend-events',$4,0)`,[...id,String(height+1001n)]);
  const event=snapshotAbis.HolderRewardsDistributorV1.find(e=>e.type==='event'&&e.name==='SnapshotPublisherChanged')!;
  assert.ok(event.type==='event');
  const fields=event.inputs.filter(e=>!e.indexed),values=Object.fromEntries(event.inputs.map(i=>[i.name,a(20)]));
  const topics=encodeEventTopics({abi:[event],eventName:'SnapshotPublisherChanged',args:values});
  const data=encodeAbiParameters(fields,fields.map(i=>values[i.name]));
  for(const [block,hash] of [[height,h(3)],[height+1000n,h(4)]] as const){
   const logs=Array.from({length:1001},(_,n)=>({index:n,log:{address:snapshotDistributor(),blockNumber:String(block),blockHash:hash,transactionHash:h(20),transactionIndex:'0',logIndex:String(n),topics,data,removed:false}}));
   await pool.query(`INSERT INTO ${s}.chain_logs(environment,chain_id,deployment_digest,block_hash,transaction_hash,transaction_index,log_index,address,topic0,payload) SELECT $1,$2,$3,$4,$5,0,r.index,$6,$7,r.log FROM jsonb_to_recordset($8) r(index integer,log jsonb)`,[...id,hash,h(20),snapshotDistributor(),topics[0],JSON.stringify(logs)]);
  }
  const o={pool,deployment,primary,secondary,schemaName,blockNumber:height+1000n,blockHash:h(4),generation:0n},keys=new Set<string>();let pages=0;
  for(;;){try{await projectHolderRewards(o);break;}catch(e){if(!(e instanceof ProjectionPending))throw e;const key=`${e.scope}:${e.completed}`;assert.ok(!keys.has(key),'each continuation must have a new durable queue identity');keys.add(key);pages++;assert.ok(pages<10);const staged=(await pool.query(`SELECT max(event_count)::int n FROM ${s}.holder_work_candidates`)).rows[0]?.n;if(staged===500)assert.equal((await pool.query(`SELECT count(*)::int n FROM ${s}.holder_work_events`)).rows[0].n,500);}}
  assert.equal(pages,5);assert.equal((await pool.query(`SELECT next_block::text FROM ${s}.projection_checkpoints WHERE scope='holder-rewards'`)).rows[0].next_block,String(height+1001n));
  assert.equal((await pool.query(`SELECT count(*)::int n FROM ${s}.holder_work_events`)).rows[0].n,0);
 }finally{await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);await pool.end();}
});
