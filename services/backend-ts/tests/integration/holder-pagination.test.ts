import {indexHolderDataset} from '../../packages/chain/src/holder-proof-index.ts';
import {transaction,applyCoreMigration,createDatabasePool} from '../../packages/db/src/index.ts';
import {readHolderSnapshots} from '../../packages/read-store/src/holder-snapshots.ts';
import {buildSnapshot,type SnapshotInput} from '../../packages/chain/src/holder-snapshot.ts';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import test from 'node:test';
import type {Address,Hex} from 'viem';

const url=process.env.TG_TEST_DATABASE_URL??process.env.TG_MIGRATION_DATABASE_URL??process.env.TG_DATABASE_URL;
const h=(c:string)=>`0x${c.repeat(64)}` as Hex,a=(c:string)=>`0x${c.repeat(40)}` as Address;
const deployment={environment:'test' as const,chainId:46630 as const,deploymentDigest:h('d'),activationBlock:0n};
const distributor=a('d'),token=a('e'),quote=a('f'),marketId=h('1'),account=a('1'),other=a('2');
const secret='p'.repeat(32);

test('holder wallet pagination is newest-first and bound to publication commitments',{timeout:60_000},async context=>{
 if(!url){context.skip('TG_TEST_DATABASE_URL (or TG_MIGRATION_DATABASE_URL/TG_DATABASE_URL) is required');return;}
 const schemaName=`tg_holder_page_${process.pid}_${randomBytes(4).toString('hex')}`,schema=`"${schemaName}"`,db=createDatabasePool(url,{max:1});
 try{
  await applyCoreMigration(db.pool,schemaName);
  await db.pool.query(`INSERT INTO ${schema}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES('test',$1,$2,$3,0,$4,$5)`,[deployment.chainId,h('d'),h('a'),h('b'),h('c')]);
  await db.pool.query(`INSERT INTO ${schema}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized) VALUES('test',$1,$2,100,$3,$4,true,true)`,[deployment.chainId,h('d'),h('b'),h('a')]);
  await db.pool.query(`INSERT INTO ${schema}.ingestion_checkpoints(environment,chain_id,deployment_digest,stream,next_block,generation) VALUES('test',$1,$2,'frontend-events',101,7)`,[deployment.chainId,h('d')]);
  await db.pool.query(`INSERT INTO ${schema}.holder_reward_markets(environment,chain_id,deployment_digest,market_id,distributor,block_number,block_hash,generation,payload) VALUES('test',$1,$2,$3,$4,100,$5,7,$6)`,[deployment.chainId,h('d'),marketId,distributor,h('b'),JSON.stringify({token,quote,publisher:a('c'),lastRound:'22',unallocatedQuote:'0',unallocatedMeme:'0'})]);
  const mkInput=(round:number):SnapshotInput=>({chainId:46630,deploymentDigest:h('d'),distributor,marketId,token,quote,round:String(round),snapshotBlock:String(90+round),snapshotBlockHash:`0x${round.toString(16).padStart(64,'0')}` as Hex,registeredBlock:'1',lastSnapshotBlock:String(89+round),totalSupply:'10',quoteAvailable:'10',memeAvailable:'0',burnMemeFees:false,exclusions:[a('0'),distributor,token],balances:[{account,balance:'10'}]});
  const publish=async(round:number,includeAccount=true)=>{
   const ds=buildSnapshot(mkInput(round));
   await db.pool.query(`INSERT INTO ${schema}.holder_reward_rounds(environment,chain_id,deployment_digest,market_id,round,block_number,block_hash,root,data_hash,snapshot_block,snapshot_block_hash,quote_budget,meme_budget) VALUES('test',$1,$2,$3,$4,100,$5,$6,$7,$8,$9,$10,0)`,[deployment.chainId,h('d'),marketId,round,h('b'),ds.root,ds.dataHash,ds.input.snapshotBlock,ds.input.snapshotBlockHash,ds.quoteBudget]);
   await db.pool.query(`INSERT INTO ${schema}.holder_reward_datasets(environment,chain_id,deployment_digest,market_id,round,data_hash,snapshot_block,snapshot_block_hash,payload) VALUES('test',$1,$2,$3,$4,$5,$6,$7,$8)`,[deployment.chainId,h('d'),marketId,round,ds.dataHash,ds.input.snapshotBlock,ds.input.snapshotBlockHash,JSON.stringify(ds)]);
   await transaction(db.pool,client=>indexHolderDataset(client,schemaName,'test',ds));
   if(!includeAccount)await db.pool.query(`DELETE FROM ${schema}.holder_reward_wallet_proofs WHERE environment='test' AND chain_id=$1 AND deployment_digest=$2 AND market_id=$3 AND round=$4 AND account=$5`,[deployment.chainId,h('d'),marketId,round,account]);
  };
  // 22 committed rounds, but this wallet is entitled only in round 21.
  for(let n=1;n<=22;n++)await publish(n,n===21);
  let page=await readHolderSnapshots({pool:db.pool,deployment,distributor,marketId,account,secret,schemaName});
  assert.deepEqual(page.rounds.map(r=>r.round),['21']); assert.equal(page.complete,true); assert.deepEqual(page.unavailableRounds,[]);
  // Add entitled rounds for this wallet to exercise the ten-row cursor boundary.
  // The existing wallet has proof only in round 21; publish real wallet proofs in ten later rounds.
  for(let n=11;n<=22;n++)if(n!==21){const ds=buildSnapshot(mkInput(n));await db.pool.query(`INSERT INTO ${schema}.holder_reward_wallet_proofs(environment,chain_id,deployment_digest,market_id,round,data_hash,account,payload) VALUES('test',$1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,[deployment.chainId,h('d'),marketId,n,ds.dataHash,account,JSON.stringify({quoteAmount:'10',memeAmount:'0',proof:ds.entries[0]!.proof})]);}
  page=await readHolderSnapshots({pool:db.pool,deployment,distributor,marketId,account,secret,schemaName});
  assert.deepEqual(page.rounds.map(r=>r.round),['22','21','20','19','18','17','16','15','14','13']); assert.ok(page.nextCursor);
  await db.pool.query(`DELETE FROM ${schema}.holder_reward_datasets WHERE environment='test' AND chain_id=$1 AND deployment_digest=$2 AND market_id=$3 AND round=22`,[deployment.chainId,h('d'),marketId]);
  const ds22=buildSnapshot(mkInput(22));
  let isolated=await readHolderSnapshots({pool:db.pool,deployment,distributor,marketId,account,secret,schemaName});
  assert.equal(isolated.complete,false); assert.deepEqual(isolated.unavailableRounds,[]); assert.deepEqual(isolated.rounds.map(r=>r.round),['21','20','19','18','17','16','15','14','13','12']);
  await db.pool.query(`INSERT INTO ${schema}.holder_reward_datasets(environment,chain_id,deployment_digest,market_id,round,data_hash,snapshot_block,snapshot_block_hash,payload) VALUES('test',$1,$2,$3,22,$4,$5,$6,$7)`,[deployment.chainId,h('d'),marketId,ds22.dataHash,ds22.input.snapshotBlock,ds22.input.snapshotBlockHash,JSON.stringify(ds22)]);
  await transaction(db.pool,client=>indexHolderDataset(client,schemaName,'test',ds22));
  await db.pool.query(`UPDATE ${schema}.holder_reward_wallet_proofs SET payload=jsonb_set(payload,'{quoteAmount}','"9"') WHERE environment='test' AND chain_id=$1 AND deployment_digest=$2 AND market_id=$3 AND round=22 AND account=$4`,[deployment.chainId,h('d'),marketId,account]);
  isolated=await readHolderSnapshots({pool:db.pool,deployment,distributor,marketId,account,secret,schemaName});
  assert.equal(isolated.complete,false); assert.deepEqual(isolated.unavailableRounds,['22']); assert.deepEqual(isolated.rounds.map(r=>r.round)[0],'21');
  await db.pool.query(`UPDATE ${schema}.holder_reward_wallet_proofs SET payload=jsonb_set(payload,'{quoteAmount}','"10"') WHERE environment='test' AND chain_id=$1 AND deployment_digest=$2 AND market_id=$3 AND round=22 AND account=$4`,[deployment.chainId,h('d'),marketId,account]);
  const restored=await readHolderSnapshots({pool:db.pool,deployment,distributor,marketId,account,secret,schemaName});
  assert.equal(restored.complete,true); assert.deepEqual(restored.unavailableRounds,[]);
  const firstRevision=page.publicationRevision,cursor=page.nextCursor!;
  // Claims are live observations; a different wallet's claim must not stale this wallet cursor.
  await db.pool.query(`INSERT INTO ${schema}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized) VALUES('test',$1,$2,101,$3,$4,true,true)`,[deployment.chainId,h('d'),h('5'),h('b')]);
  await db.pool.query(`INSERT INTO ${schema}.holder_reward_claims(environment,chain_id,deployment_digest,market_id,round,account,assets) VALUES('test',$1,$2,$3,22,$4,1)`,[deployment.chainId,h('d'),marketId,other]);
  await db.pool.query(`UPDATE ${schema}.holder_reward_markets SET block_number=101,block_hash=$1 WHERE environment='test' AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4`,[h('5'),deployment.chainId,h('d'),marketId]);
  let second=await readHolderSnapshots({pool:db.pool,deployment,distributor,marketId,account,secret,schemaName,cursor});
  assert.deepEqual(second.rounds.map(r=>r.round),['12','11']); assert.equal(second.publicationRevision,firstRevision);
  await db.pool.query(`UPDATE ${schema}.holder_reward_markets SET payload=jsonb_set(payload,'{lastRound}','"23"'::jsonb)`);
  await publish(23);
  await assert.rejects(()=>readHolderSnapshots({pool:db.pool,deployment,distributor,marketId,account,secret,schemaName,cursor}),/revision|cursor/i);
  await db.pool.query(`UPDATE ${schema}.holder_reward_markets SET generation=8`);
  await db.pool.query(`UPDATE ${schema}.ingestion_checkpoints SET generation=8`);
  await assert.rejects(()=>readHolderSnapshots({pool:db.pool,deployment,distributor,marketId,account,secret,schemaName,cursor}),/revision|cursor/i);
  await db.pool.query(`UPDATE ${schema}.holder_reward_markets SET generation=7`);
  await db.pool.query(`UPDATE ${schema}.ingestion_checkpoints SET generation=7`);
  // Restore a stable source that includes the newly published round.
  const fresh=await readHolderSnapshots({pool:db.pool,deployment,distributor,marketId,account,secret,schemaName}); assert.deepEqual(fresh.rounds.map(r=>r.round),['23','22','21','20','19','18','17','16','15','14']); assert.deepEqual(fresh.unavailableRounds,[]);
  const foreign=await readHolderSnapshots({pool:db.pool,deployment,distributor,marketId,account:other,secret,schemaName});
  await assert.rejects(()=>readHolderSnapshots({pool:db.pool,deployment,distributor,marketId,account:other,secret,schemaName,cursor}),/cursor|filter/i);
  assert.deepEqual(foreign.rounds,[]);
 }finally{await db.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(()=>undefined);await db.pool.end();}
});
