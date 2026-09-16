import {indexHolderDataset} from '../../packages/chain/src/holder-proof-index.ts';
import {transaction} from '../../packages/db/src/index.ts';
import {encodeCursor} from '../../packages/read-store/src/index.ts';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import test from 'node:test';
import { applyCoreMigration, createDatabasePool } from '../../packages/db/src/index.ts';
import { readHolderSnapshots } from '../../packages/read-store/src/holder-snapshots.ts';
import { buildSnapshot,compactSnapshotDataset, type SnapshotInput } from '../../packages/chain/src/holder-snapshot.ts';
import type { Address, Hex } from 'viem';

const url = process.env.TG_TEST_DATABASE_URL ?? process.env.TG_MIGRATION_DATABASE_URL ?? process.env.TG_DATABASE_URL;
const h=(c:string)=>`0x${c.repeat(64)}` as Hex, a=(c:string)=>`0x${c.repeat(40)}` as Address;
const deployment={environment:'test' as const,chainId:46630 as const,deploymentDigest:h('d'),activationBlock:0n};
const distributor=a('d'), token=a('e'), quote=a('f'), marketId=h('1'), account=a('1');
const baseInput:SnapshotInput={chainId:46630,deploymentDigest:h('d'),distributor,marketId,token,quote,round:'1',snapshotBlock:'90',snapshotBlockHash:h('9'),registeredBlock:'1',lastSnapshotBlock:'0',totalSupply:'10',quoteAvailable:'10',memeAvailable:'0',burnMemeFees:false,exclusions:[a('0'),distributor,token],balances:[{account,balance:'10'}]};


test('indexed proofs support more than 10000 holders without reading full datasets',{timeout:120000},async context=>{
 if(!url){context.skip('database required');return;}
 const schemaName=`tg_holder_scale_${process.pid}_${randomBytes(4).toString('hex')}`, schema=`"${schemaName}"`, db=createDatabasePool(url,{max:1});
 try { await applyCoreMigration(db.pool,schemaName);
  await db.pool.query(`INSERT INTO ${schema}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES('test',$1,$2,$3,0,$4,$5)`,[deployment.chainId,h('d'),h('a'),h('b'),h('c')]);
  await db.pool.query(`INSERT INTO ${schema}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized) VALUES('test',$1,$2,100,$3,$4,true,true)`,[deployment.chainId,h('d'),h('b'),h('a')]);
  await db.pool.query(`INSERT INTO ${schema}.ingestion_checkpoints(environment,chain_id,deployment_digest,stream,next_block,generation) VALUES('test',$1,$2,'frontend-events',101,7)`,[deployment.chainId,h('d')]);
  await db.pool.query(`INSERT INTO ${schema}.holder_reward_markets(environment,chain_id,deployment_digest,market_id,distributor,block_number,block_hash,generation,payload) VALUES('test',$1,$2,$3,$4,100,$5,7,$6)`,[deployment.chainId,h('d'),marketId,distributor,h('b'),JSON.stringify({token,quote,publisher:a('c'),lastRound:'1',unallocatedQuote:'0',unallocatedMeme:'0'})]);

  const holders=10001, balances=Array.from({length:holders},(_,i)=>({account:('0x'+(i+1).toString(16).padStart(40,'0')) as Address,balance:'1'}));
  const ds=buildSnapshot({...baseInput,totalSupply:String(holders),quoteAvailable:String(holders),balances});
  await db.pool.query(`INSERT INTO ${schema}.holder_reward_rounds VALUES('test',$1,$2,$3,1,100,$4,$5,$6,90,$7,$8,0)`,[deployment.chainId,h('d'),marketId,h('b'),ds.root,ds.dataHash,h('9'),ds.quoteBudget]);
  await db.pool.query(`INSERT INTO ${schema}.holder_reward_datasets(environment,chain_id,deployment_digest,market_id,round,data_hash,snapshot_block,snapshot_block_hash,payload) VALUES('test',$1,$2,$3,1,$4,90,$5,$6)`,[deployment.chainId,h('d'),marketId,ds.dataHash,h('9'),compactSnapshotDataset(ds)]);
  const {backfillHolderProofIndexes}=await import('../../packages/chain/src/holder-proof-index.ts');
  assert.equal(await backfillHolderProofIndexes(db.pool,deployment,schemaName),1);
  assert.equal(await backfillHolderProofIndexes(db.pool,deployment,schemaName),0);
  assert.equal((await db.pool.query(`SELECT count(*)::int n FROM ${schema}.holder_reward_wallet_proofs`)).rows[0].n,holders);
  const start=performance.now();
  for(const owner of [balances[0]!.account,balances.at(-1)!.account]){
   const page=await readHolderSnapshots({pool:db.pool,deployment,distributor,marketId,account:owner,secret:'s'.repeat(32),schemaName});
   assert.equal(page.rounds[0]!.quoteAmount,'1');assert.ok(JSON.stringify(page).length<3000);
  }
  context.diagnostic(JSON.stringify({holders,twoWalletReadsMs:performance.now()-start,compactBytes:Buffer.byteLength(JSON.stringify(compactSnapshotDataset(ds))),fullBytes:Buffer.byteLength(JSON.stringify(ds))}));
 }finally{await db.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await db.pool.end();}
});
