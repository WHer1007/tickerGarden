import {readHolderSnapshots} from '../../packages/read-store/src/holder-snapshots.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {encodeEventTopics,encodeAbiParameters,type Hex,type AbiEvent} from 'viem';
import {FakeRpc,h,a,height} from '../fixtures/snapshot-rpc.ts';
import {applyCoreMigration,createDatabasePool} from '../../packages/db/src/index.ts';
import {CURRENT_RELEASE_ID,CURRENT_ACTIVATION_BLOCK} from '../../packages/events/src/index.ts';
import {snapshotAbis} from '../../packages/events/src/f72-abis.generated.ts';
import {prepareHolderSnapshot,projectHolderRewards,previewSnapshotPublication,snapshotDistributor} from '../../packages/chain-worker/src/holder-snapshots.ts';
const url=process.env.TG_TEST_DATABASE_URL??process.env.TG_MIGRATION_DATABASE_URL;
test('snapshot worker replays retained transfers, reconciles RPC, persists idempotently, and fences incomplete history',{timeout:60000},async ctx=>{
 if(!url){ctx.skip('test database required');return;}
 const schemaName='tg_snapshot_worker_'+randomBytes(6).toString('hex'),schema=`"${schemaName}"`,db=createDatabasePool(url,{max:2});
 const deployment={environment:'test' as const,chainId:46630 as const,deploymentDigest:CURRENT_RELEASE_ID,activationBlock:CURRENT_ACTIVATION_BLOCK};
 const id=['test',46630,CURRENT_RELEASE_ID],primary=new FakeRpc(),secondary=new FakeRpc(),o={pool:db.pool,deployment,primary,secondary,schemaName};
 try{
  await applyCoreMigration(db.pool,schemaName);
  await db.pool.query(`INSERT INTO ${schema}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES($1,$2,$3,$4,$5,$6,$7)`,[...id,h(1),CURRENT_ACTIVATION_BLOCK.toString(),h(2),h(3)]);
  await db.pool.query(`INSERT INTO ${schema}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized) VALUES($1,$2,$3,$4,$5,$6,true,true)`,[...id,height.toString(),h(3),h(2)]);
  await db.pool.query(`INSERT INTO ${schema}.ingestion_checkpoints(environment,chain_id,deployment_digest,stream,next_block,generation) VALUES($1,$2,$3,'frontend-events',$4,1)`,[...id,(height+1n).toString()]);
  await db.pool.query(`INSERT INTO ${schema}.covered_ranges(environment,chain_id,deployment_digest,from_block,to_block,generation,filter_digest,complete,verified_at) VALUES($1,$2,$3,$4,$5,1,$6,true,now())`,[...id,CURRENT_ACTIVATION_BLOCK.toString(),height.toString(),h(1)]);
  const transfers=[[a(0),a(11),6n],[a(11),a(12),5n],[a(12),a(13),3n]] as const;
  for(const [index,[from,to,value]]of transfers.entries()){
   const topics=encodeEventTopics({abi:snapshotAbis.TickerMemeTokenV1,eventName:'Transfer',args:{from,to}});
   const data=encodeAbiParameters([{type:'uint256'}],[value]);
   const log={address:a(2),blockHash:h(3),blockNumber:height.toString(),transactionHash:h(10),transactionIndex:'0',logIndex:String(index),topics,data,removed:false};
   await db.pool.query(`INSERT INTO ${schema}.chain_logs(environment,chain_id,deployment_digest,block_hash,transaction_hash,transaction_index,log_index,address,topic0,payload) VALUES($1,$2,$3,$4,$5,0,$6,$7,$8,$9)`,[...id,h(3),h(10),index,a(2),topics[0],log]);
  }
  secondary.badBalance=true;await assert.rejects(()=>prepareHolderSnapshot({...o,marketId:h(2),blockNumber:height}),/disagreement/);secondary.badBalance=false;
  const ds=await prepareHolderSnapshot({...o,marketId:h(2),blockNumber:height});assert.equal(ds.entries.length,3);assert.equal(ds.quoteBudget,'99');
  assert.equal((await prepareHolderSnapshot({...o,marketId:h(2),blockNumber:height})).dataHash,ds.dataHash);
  assert.equal((await previewSnapshotPublication(o,ds)).status,'simulated_not_broadcast');
  secondary.badBalance=true;assert.equal((await prepareHolderSnapshot({...o,marketId:h(2),blockNumber:height})).dataHash,ds.dataHash,'verified immutable anchor reuses durable balances');secondary.badBalance=false;
  await db.pool.query(`UPDATE ${schema}.covered_ranges SET complete=false`);await assert.rejects(()=>prepareHolderSnapshot({...o,marketId:h(2),blockNumber:height}),/history gap/);
  await db.pool.query(`UPDATE ${schema}.covered_ranges SET complete=true`);
  // Even an empty reward event stream must persist a complete projector checkpoint.
  assert.deepEqual(await projectHolderRewards({...o,blockNumber:height,blockHash:h(3),generation:1n}),{markets:0,events:0});
  await assert.rejects(()=>projectHolderRewards({...o,blockNumber:height,blockHash:h(3),generation:0n}),/generation changed/);
  const tip=height+1000n;
  await db.pool.query(`INSERT INTO ${schema}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized) VALUES($1,$2,$3,$4,$5,$6,true,true)`,[...id,tip.toString(),h(4),h(3)]);
  async function event(name:string,index:number,at:bigint,hash:Hex,args:Record<string,unknown>){
   const e=snapshotAbis.HolderRewardsDistributorV1.find(e=>e.type==='event'&&e.name===name) as AbiEvent;
   const topics=encodeEventTopics({abi:[e],eventName:name,args});const fields=e.inputs.filter(i=>!i.indexed);
   const data=encodeAbiParameters(fields,fields.map(f=>args[f.name!]));
   const log={address:snapshotDistributor(),blockHash:hash,blockNumber:at.toString(),transactionHash:h(20),transactionIndex:'1',logIndex:String(index),topics,data,removed:false};
   await db.pool.query(`INSERT INTO ${schema}.chain_logs(environment,chain_id,deployment_digest,block_hash,transaction_hash,transaction_index,log_index,address,topic0,payload) VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,$9)`,[...id,hash,h(20),index,snapshotDistributor(),topics[0],log]);
  }
  await event('HolderSnapshotMarketRegistered',10,height,h(3),{marketId:h(2),token:a(2),quote:a(0),vault:a(8)});
  await event('HolderSnapshotPublished',11,tip,h(4),{marketId:h(2),round:1n,snapshotBlock:height,snapshotBlockHash:h(3),root:ds.root,dataHash:ds.dataHash,quoteBudget:99n,memeBudget:0n});
  await event('HolderSnapshotClaimed',12,tip,h(4),{marketId:h(2),round:1n,account:a(11),assets:1,quotePaid:16n,memePaid:0n});
  primary.lastRound=secondary.lastRound=1n;
  assert.deepEqual(await projectHolderRewards({...o,blockNumber:tip,blockHash:h(4),generation:1n}),{markets:1,events:2});
  const beforeRetry=await db.pool.query(`SELECT (SELECT count(*) FROM ${schema}.holder_reward_rounds)::int rounds,(SELECT count(*) FROM ${schema}.holder_reward_claims)::int claims`);
  assert.deepEqual(await projectHolderRewards({...o,blockNumber:tip,blockHash:h(4),generation:1n}),{markets:0,events:0});
  const afterRetry=await db.pool.query(`SELECT (SELECT count(*) FROM ${schema}.holder_reward_rounds)::int rounds,(SELECT count(*) FROM ${schema}.holder_reward_claims)::int claims`);
  assert.deepEqual(afterRetry.rows[0],beforeRetry.rows[0]);
  const page=await readHolderSnapshots({pool:db.pool,deployment,distributor:snapshotDistributor(),marketId:h(2),account:a(11),secret:'x'.repeat(32),schemaName});
  assert.equal(page.rounds[0]?.claimedAssets,1);assert.equal(page.rounds[0]?.quoteAmount,'16');
  // Canonical rewind invalidates on-chain observations but never deletes proof archives.
  await db.pool.query(`UPDATE ${schema}.chain_blocks SET canonical=false WHERE hash=$1`,[h(4)]);
  await db.pool.query(`UPDATE ${schema}.ingestion_checkpoints SET generation=2`);
  await projectHolderRewards({...o,blockNumber:height,blockHash:h(3),generation:2n});
  const rewound=await readHolderSnapshots({pool:db.pool,deployment,distributor:snapshotDistributor(),marketId:h(2),account:a(11),secret:'x'.repeat(32),schemaName});
  assert.deepEqual(rewound.rounds,[]);
  assert.equal((await db.pool.query(`SELECT count(*)::int n FROM ${schema}.holder_reward_datasets`)).rows[0].n,1);

 }finally{await db.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(()=>undefined);await db.pool.end();}
});
