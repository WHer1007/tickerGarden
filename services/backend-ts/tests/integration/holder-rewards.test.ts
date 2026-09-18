import {indexHolderDataset} from '../../packages/chain/src/holder-proof-index.ts';
import {transaction} from '../../packages/db/src/index.ts';
import {encodeCursor} from '../../packages/read-store/src/index.ts';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import test from 'node:test';
import { applyCoreMigration, createDatabasePool } from '../../packages/db/src/index.ts';
import { readHolderSnapshots } from '../../packages/read-store/src/holder-snapshots.ts';
import { buildSnapshot, type SnapshotInput } from '../../packages/chain/src/holder-snapshot.ts';
import type { Address, Hex } from 'viem';

const url = process.env.TG_TEST_DATABASE_URL ?? process.env.TG_MIGRATION_DATABASE_URL ?? process.env.TG_DATABASE_URL;
const h=(c:string)=>`0x${c.repeat(64)}` as Hex, a=(c:string)=>`0x${c.repeat(40)}` as Address;
const deployment={environment:'test' as const,chainId:46630 as const,deploymentDigest:h('d'),activationBlock:0n};
const distributor=a('d'), token=a('e'), quote=a('f'), marketId=h('1'), account=a('1');
const baseInput:SnapshotInput={chainId:46630,deploymentDigest:h('d'),distributor,marketId,token,quote,round:'1',snapshotBlock:'90',snapshotBlockHash:h('9'),registeredBlock:'1',lastSnapshotBlock:'0',totalSupply:'10',quoteAvailable:'10',memeAvailable:'0',burnMemeFees:false,exclusions:[a('0'),distributor,token],balances:[{account,balance:'10'}]};

test('holder rewards read path enforces publication identity, claims, and corruption fences',{timeout:30_000},async context=>{
 if(!url){context.skip('TG_TEST_DATABASE_URL (or TG_MIGRATION_DATABASE_URL/TG_DATABASE_URL) is required');return;}
 const schemaName=`tg_holder_${process.pid}_${randomBytes(4).toString('hex')}`, schema=`"${schemaName}"`, db=createDatabasePool(url,{max:1});
 try { await applyCoreMigration(db.pool,schemaName);
  await db.pool.query(`INSERT INTO ${schema}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES('test',$1,$2,$3,0,$4,$5)`,[deployment.chainId,h('d'),h('a'),h('b'),h('c')]);
  await db.pool.query(`INSERT INTO ${schema}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized) VALUES('test',$1,$2,100,$3,$4,true,true)`,[deployment.chainId,h('d'),h('b'),h('a')]);
  await db.pool.query(`INSERT INTO ${schema}.ingestion_checkpoints(environment,chain_id,deployment_digest,stream,next_block,generation) VALUES('test',$1,$2,'frontend-events',101,7)`,[deployment.chainId,h('d')]);
  await db.pool.query(`INSERT INTO ${schema}.holder_reward_markets(environment,chain_id,deployment_digest,market_id,distributor,block_number,block_hash,generation,payload) VALUES('test',$1,$2,$3,$4,100,$5,7,$6)`,[deployment.chainId,h('d'),marketId,distributor,h('b'),JSON.stringify({token,quote,publisher:a('0'),lastRound:'0',unallocatedQuote:'0',unallocatedMeme:'0'})]);
  const common=[deployment.chainId,h('d'),marketId];
  const secret='s'.repeat(32);
  let page=await readHolderSnapshots({pool:db.pool,deployment,distributor,marketId,account,secret,schemaName}); assert.equal(page.status,'publisher_unconfigured'); assert.deepEqual(page.rounds,[]);
  const cursor=encodeCursor({scope:'holder-snapshots-v2',revision:page.publicationRevision,filterDigest:createHash('sha256').update(JSON.stringify(['test',deployment.chainId,deployment.deploymentDigest,distributor,marketId,account])).digest('hex'),sortKey:'0',identity:'0'},secret);
  await assert.rejects(()=>readHolderSnapshots({pool:db.pool,deployment,distributor,marketId,account:a('2'),secret,schemaName,cursor}),/cursor|scope|filter/i);
  const ds=buildSnapshot(baseInput);
  await db.pool.query(`UPDATE ${schema}.holder_reward_markets SET payload=$1`,[JSON.stringify({token,quote,publisher:a('c'),lastRound:'1',unallocatedQuote:'0',unallocatedMeme:'0'})]);
  await db.pool.query(`INSERT INTO ${schema}.holder_reward_rounds(environment,chain_id,deployment_digest,market_id,round,block_number,block_hash,root,data_hash,snapshot_block,snapshot_block_hash,quote_budget,meme_budget) VALUES('test',$1,$2,$3,1,100,$4,$5,$6,90,$7,$8,0)`,[deployment.chainId,h('d'),marketId,h('b'),ds.root,ds.dataHash,h('9'),ds.quoteBudget]);
  await db.pool.query(`INSERT INTO ${schema}.holder_reward_datasets(environment,chain_id,deployment_digest,market_id,round,data_hash,snapshot_block,snapshot_block_hash,payload) VALUES('test',$1,$2,$3,1,$4,90,$5,$6)`,[deployment.chainId,h('d'),marketId,ds.dataHash,h('9'),JSON.stringify(ds)]);
  await transaction(db.pool,client=>indexHolderDataset(client,schemaName,'test',ds));
  await db.pool.query(`INSERT INTO ${schema}.holder_reward_claims(environment,chain_id,deployment_digest,market_id,round,account,assets) VALUES('test',$1,$2,$3,1,$4,1)`,[deployment.chainId,h('d'),marketId,account]);
  page=await readHolderSnapshots({pool:db.pool,deployment,distributor,marketId,account,secret,schemaName}); assert.equal(page.status,'ready'); assert.equal(page.rounds[0]!.claimedAssets,1); assert.deepEqual(page.rounds[0]!.proof,ds.entries[0]!.proof);
  await db.pool.query(`DELETE FROM ${schema}.holder_reward_datasets`);
  page=await readHolderSnapshots({pool:db.pool,deployment,distributor,marketId,account,secret,schemaName}); assert.equal(page.complete,false); assert.deepEqual(page.unavailableRounds,[]); assert.deepEqual(page.rounds,[]);
  await db.pool.query(`INSERT INTO ${schema}.holder_reward_datasets(environment,chain_id,deployment_digest,market_id,round,data_hash,snapshot_block,snapshot_block_hash,payload) VALUES('test',$1,$2,$3,1,$4,90,$5,$6)`,[deployment.chainId,h('d'),marketId,ds.dataHash,h('9'),JSON.stringify(ds)]);
  await transaction(db.pool,client=>indexHolderDataset(client,schemaName,'test',ds));
  await db.pool.query(`UPDATE ${schema}.chain_blocks SET canonical=false`);
  await assert.rejects(()=>readHolderSnapshots({pool:db.pool,deployment,distributor,marketId,account,secret:'x'.repeat(32),schemaName}),/unavailable/);
  await db.pool.query(`UPDATE ${schema}.chain_blocks SET canonical=true`);
  await db.pool.query(`UPDATE ${schema}.ingestion_checkpoints SET generation=8`);
  await assert.rejects(()=>readHolderSnapshots({pool:db.pool,deployment,distributor,marketId,account,secret:'x'.repeat(32),schemaName}),/unavailable/);
  await db.pool.query(`UPDATE ${schema}.ingestion_checkpoints SET generation=7`);
  await db.pool.query(`UPDATE ${schema}.holder_reward_datasets SET verified_header=NULL`);
  page=await readHolderSnapshots({pool:db.pool,deployment,distributor,marketId,account,secret,schemaName}); assert.equal(page.complete,false); assert.deepEqual(page.unavailableRounds,['1']); assert.deepEqual(page.rounds,[]);
 } finally { await db.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(()=>undefined); await db.pool.end(); }
});
