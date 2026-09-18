import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {decodeFunctionData,encodeAbiParameters,encodeEventTopics,encodeFunctionResult,type Abi,type Address,type Hex} from 'viem';
import {applyCoreMigration,createDatabasePool} from '../../packages/db/src/index.ts';
import {CURRENT_RELEASE_ID,CURRENT_ACTIVATION_BLOCK} from '../../packages/events/src/index.ts';
import {snapshotAbis} from '../../packages/events/src/f72-abis.generated.ts';
import {buildSnapshot,proofRoot,snapshotLeaf,type SnapshotInput} from '../../packages/chain/src/holder-snapshot.ts';
import {advanceSnapshotLedger} from '../../packages/chain-worker/src/holder-snapshot-ledger.ts';
import {snapshotPreparationContext,snapshotDistributor} from '../../packages/chain-worker/src/holder-snapshots.ts';
import {advanceShardedTree} from '../../packages/chain-worker/src/holder-sharded-snapshot.ts';
import {inspectHolderArchive,repairHolderArchive} from '../../packages/chain-worker/src/holder-archive.ts';
import {FakeRpc,h,a,height} from '../fixtures/snapshot-rpc.ts';

const url=process.env.TG_TEST_DATABASE_URL??process.env.TG_MIGRATION_DATABASE_URL;
const deployment={environment:'test' as const,chainId:46630 as const,deploymentDigest:CURRENT_RELEASE_ID,activationBlock:CURRENT_ACTIVATION_BLOCK};
const schemaName=`tg_holder_sharded_${randomBytes(6).toString('hex')}`,schema=`"${schemaName}"`;

class BalanceRpc extends FakeRpc {
  balances=new Map<Address,bigint>([[a(11),1n],[a(12),2n],[a(13),3n]]);
  balanceCalls:Address[]=[];
  override async callAt(target:Address,data:Hex,block:bigint):Promise<Hex>{
    let decoded;try{decoded=decodeFunctionData({abi:snapshotAbis.TickerMemeTokenV1 as Abi,data});}catch{return super.callAt(target,data,block);}
    if(decoded.functionName==='balanceOf'){
      const account=String(decoded.args?.[0]).toLowerCase() as Address;this.balanceCalls.push(account);
      return encodeFunctionResult({abi:snapshotAbis.TickerMemeTokenV1 as Abi,functionName:'balanceOf',result:this.balances.get(account)??0n});
    }
    return super.callAt(target,data,block);
  }
}

test('durable sharded holder snapshots resume, match the reference tree, verify affected balances, and fence generations',{timeout:120000},async ctx=>{
 if(!url){ctx.skip('TG_TEST_DATABASE_URL or TG_MIGRATION_DATABASE_URL is required');return;}
 const db=createDatabasePool(url,{max:2}),primary=new BalanceRpc(),secondary=new BalanceRpc(),id=['test',46630,CURRENT_RELEASE_ID];
 const options={pool:db.pool,deployment,primary,secondary,schemaName};
 const distributor=snapshotDistributor(),token=a(2),marketId=h(2),quote=a(0),excluded=[a(0),distributor,token];
 const insertTransfer=async(blockHash:Hex,block:bigint,index:number,from:Address,to:Address,value:bigint)=>{
  const topics=encodeEventTopics({abi:snapshotAbis.TickerMemeTokenV1,eventName:'Transfer',args:{from,to}});
  const data=encodeAbiParameters([{type:'uint256'}],[value]);
  const payload={address:token,blockHash,blockNumber:block.toString(),transactionHash:h(50+index),transactionIndex:'0',logIndex:String(index),topics,data,removed:false};
  await db.pool.query(`INSERT INTO ${schema}.chain_logs(environment,chain_id,deployment_digest,block_hash,transaction_hash,transaction_index,log_index,address,topic0,payload) VALUES($1,$2,$3,$4,$5,0,$6,$7,$8,$9)`,[...id,blockHash,h(50+index),index,token,topics[0],payload]);
 };
 try{
  await applyCoreMigration(db.pool,schemaName);
  await db.pool.query(`INSERT INTO ${schema}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES($1,$2,$3,$4,$5,$6,$7)`,[...id,h(1),CURRENT_ACTIVATION_BLOCK.toString(),h(2),h(3)]);
  await db.pool.query(`INSERT INTO ${schema}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized) VALUES($1,$2,$3,$4,$5,$6,true,true),($1,$2,$3,$7,$8,$5,true,true)`,[...id,height.toString(),h(3),h(2),(height+1n).toString(),h(4)]);
  await db.pool.query(`INSERT INTO ${schema}.ingestion_checkpoints(environment,chain_id,deployment_digest,stream,next_block,generation) VALUES($1,$2,$3,'frontend-events',$4,1)`,[...id,(height+2n).toString()]);
  await db.pool.query(`INSERT INTO ${schema}.covered_ranges(environment,chain_id,deployment_digest,from_block,to_block,generation,filter_digest,complete,verified_at) VALUES($1,$2,$3,$4,$5,1,$6,true,now())`,[...id,CURRENT_ACTIVATION_BLOCK.toString(),(height+1n).toString(),h(5)]);
  // One mint followed by two transfers produces three independently checked holders.
  await insertTransfer(h(3),height,0,a(0),a(11),6n);
  await insertTransfer(h(3),height,1,a(11),a(12),2n);
  await insertTransfer(h(3),height,2,a(11),a(13),3n);

  const first=await snapshotPreparationContext({...options,marketId,blockNumber:height});
  assert.equal(await advanceSnapshotLedger(first,1),false,'the first bounded page should leave durable work pending');
  const firstState=(await db.pool.query(`SELECT phase FROM ${schema}.holder_snapshot_work`)).rows[0]?.phase;
  assert.ok(firstState,'interrupted work was persisted');
  let ready=false;for(let n=0;n<40&&!ready;n++)ready=await advanceSnapshotLedger(first,1);
  assert.equal(ready,true,'resumed bounded pages should finish balance verification');
  let manifest=null;
  for(let n=0;n<100&&!manifest;n++)manifest=await advanceShardedTree(first,1);
  assert.ok(manifest,'sharded tree and proof pages should complete');
  const input:SnapshotInput={...first.context,balances:[{account:a(11),balance:'1'},{account:a(12),balance:'2'},{account:a(13),balance:'3'}]};
  const expected=buildSnapshot(input);
  assert.equal(manifest.root,expected.root);
  assert.equal(manifest.quoteBudget,expected.quoteBudget);
  const proofs=(await db.pool.query<{account:string;payload:{quoteAmount:string;memeAmount:string;proof:Hex[]}}>(`SELECT account,payload FROM ${schema}.holder_reward_wallet_proofs WHERE market_id=$1 ORDER BY account`,[marketId])).rows;
  assert.equal(proofs.length,expected.entries.length);
  for(const row of proofs){const entry=expected.entries.find(e=>e.account===row.account);assert.ok(entry);assert.deepEqual(row.payload,{quoteAmount:entry.quoteAmount,memeAmount:entry.memeAmount,proof:entry.proof});}
  const corruptAccount=proofs[0]!.account;
  await db.pool.query(`UPDATE ${schema}.holder_reward_wallet_proofs SET payload=jsonb_set(payload,'{proof,0}',to_jsonb($7::text),false) WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4 AND round=$5 AND data_hash=$6 AND account=$8`,[...id,marketId,'1',manifest.dataHash,h(88),corruptAccount]);
  const damaged=await inspectHolderArchive(options,manifest);
  assert.equal(damaged.status,'needs_repair');assert.ok(damaged.issues.includes(`proof_corrupt:${corruptAccount}`));
  assert.deepEqual(await repairHolderArchive(options,manifest),{status:'index_repaired',dataHash:manifest.dataHash});
  assert.equal((await inspectHolderArchive(options,manifest)).status,'page_verified');

  // Snapshot two copies the prior verified ledger; one transfer marks only its two endpoints for RPC reconciliation.
  primary.balanceCalls=[];secondary.balanceCalls=[];
  primary.balances.set(a(12),1n);secondary.balances.set(a(12),1n);
  primary.balances.set(a(13),4n);secondary.balances.set(a(13),4n);
  await insertTransfer(h(4),height+1n,3,a(12),a(13),1n);
  const second=await snapshotPreparationContext({...options,marketId,blockNumber:height+1n});
  let secondReady=false;for(let n=0;n<40&&!secondReady;n++)secondReady=await advanceSnapshotLedger(second,1);
  assert.equal(secondReady,true);
  assert.deepEqual([...new Set(primary.balanceCalls)].sort(),[a(12),a(13)].sort());
  assert.deepEqual([...new Set(secondary.balanceCalls)].sort(),[a(12),a(13)].sort());
  const balanceState=(await db.pool.query<{account:string;verified:boolean}>(`SELECT account,verified FROM ${schema}.holder_snapshot_balances WHERE block_hash=$1 ORDER BY account`,[h(4)])).rows;
  assert.deepEqual(balanceState,[{account:a(11),verified:true},{account:a(12),verified:true},{account:a(13),verified:true}]);

  await db.pool.query(`UPDATE ${schema}.ingestion_checkpoints SET generation=2 WHERE stream='frontend-events'`);
  await assert.rejects(()=>advanceSnapshotLedger(second,1),/snapshot generation or anchor changed/);
 }finally{await db.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(()=>undefined);await db.pool.end();}
});

test('synthetic 100001-holder ledger builds bounded sharded proofs beyond the legacy holder cap',{timeout:600000},async ctx=>{
 if(process.env.TG_HOLDER_CAPACITY_TEST!=='1'){ctx.skip('set TG_HOLDER_CAPACITY_TEST=1 to run the synthetic capacity regression');return;}
 if(!url){ctx.skip('TG_TEST_DATABASE_URL or TG_MIGRATION_DATABASE_URL is required');return;}
 const capacitySchemaName=`tg_holder_capacity_${randomBytes(6).toString('hex')}`,capacitySchema=`"${capacitySchemaName}"`;
 const db=createDatabasePool(url,{max:2}),primary=new BalanceRpc(),secondary=new BalanceRpc(),distributor=snapshotDistributor(),marketId=h(32),blockHash=h(33);
 const capacityDeployment={...deployment},capacityOptions={pool:db.pool,deployment:capacityDeployment,primary,secondary,schemaName:capacitySchemaName};
 const context={chainId:46630,deploymentDigest:CURRENT_RELEASE_ID,distributor,marketId,token:a(2),quote:a(0),round:'1',snapshotBlock:height.toString(),snapshotBlockHash:blockHash,registeredBlock:CURRENT_ACTIVATION_BLOCK.toString(),lastSnapshotBlock:'0',totalSupply:'100001',quoteAvailable:'100001',memeAvailable:'0',burnMemeFees:false,exclusions:[a(0),distributor,a(2)]};
 try{
  await applyCoreMigration(db.pool,capacitySchemaName);
  await db.pool.query(`INSERT INTO ${capacitySchema}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES($1,$2,$3,$4,$5,$6,$7)`,['test',46630,CURRENT_RELEASE_ID,h(1),CURRENT_ACTIVATION_BLOCK.toString(),h(2),h(3)]);
  await db.pool.query(`INSERT INTO ${capacitySchema}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized) VALUES($1,$2,$3,$4,$5,$6,true,true)`,['test',46630,CURRENT_RELEASE_ID,height.toString(),blockHash,h(2)]);
  await db.pool.query(`INSERT INTO ${capacitySchema}.ingestion_checkpoints(environment,chain_id,deployment_digest,stream,next_block,generation) VALUES($1,$2,$3,'frontend-events',$4,1)`,['test',46630,CURRENT_RELEASE_ID,(height+1n).toString()]);
  await db.pool.query(`INSERT INTO ${capacitySchema}.holder_snapshot_work(environment,chain_id,deployment_digest,market_id,block_hash,generation,block_number,context,phase,minted) VALUES($1,$2,$3,$4,$5,1,$6,$7,'balances-ready',true)`,['test',46630,CURRENT_RELEASE_ID,marketId,blockHash,height.toString(),JSON.stringify(context)]);
  const seeded=await db.pool.query(`INSERT INTO ${capacitySchema}.holder_snapshot_balances(environment,chain_id,deployment_digest,market_id,block_hash,generation,account,balance,verified) SELECT $1,$2,$3,$4,$5,1,'0x'||lpad(to_hex(n+1000000),40,'0'),1,true FROM generate_series(1,100001) n`,['test',46630,CURRENT_RELEASE_ID,marketId,blockHash]);
  assert.equal(seeded.rowCount,100001);
  const started=performance.now(),baseHeap=process.memoryUsage().heapUsed;let maxSampledHeap=baseHeap,manifest=null,steps=0;
  for(;steps<500&&!manifest;steps++){
   try{manifest=await advanceShardedTree({...capacityOptions,context,generation:1n},1000);}catch(error){
    const state=(await db.pool.query(`SELECT phase,tree_level,tree_cursor,verify_cursor,proof_cursor,manifest->>'entryCount' entry_count FROM ${capacitySchema}.holder_snapshot_work`)).rows[0];
    const nodes=(await db.pool.query(`SELECT level,min(ordinal)::text min,max(ordinal)::text max,count(*)::text n FROM ${capacitySchema}.holder_snapshot_nodes GROUP BY level ORDER BY level`)).rows;
    throw new Error(`capacity tree failed at step ${steps}; work=${JSON.stringify(state)} nodes=${JSON.stringify(nodes)}; ${String(error)}`);
   }
   maxSampledHeap=Math.max(maxSampledHeap,process.memoryUsage().heapUsed);
  }
  assert.ok(manifest,'100001 entries should finish within bounded tree/proof steps');
  assert.equal(manifest.entryCount,'100001');
  const identity=['test',46630,CURRENT_RELEASE_ID,marketId,'1',manifest.dataHash];
  const count=await db.pool.query<{n:string}>(`SELECT count(*)::text n FROM ${capacitySchema}.holder_reward_wallet_proofs WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4 AND round=$5 AND data_hash=$6`,identity);
  assert.equal(count.rows[0]?.n,'100001');
  const sample=await db.pool.query<{account:Address;payload:{quoteAmount:string;memeAmount:string;proof:Hex[]}}>(`SELECT account,payload FROM ${capacitySchema}.holder_reward_wallet_proofs WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4 AND round=$5 AND data_hash=$6 ORDER BY account LIMIT 1`,identity);
  const row=sample.rows[0];assert.ok(row);
  const leaf=snapshotLeaf(context.chainId,context.distributor,context.marketId,context.round,row.account,row.payload.quoteAmount,row.payload.memeAmount);
  assert.equal(row.payload.quoteAmount,'1');assert.equal(proofRoot(leaf,row.payload.proof),manifest.root);
  ctx.diagnostic(JSON.stringify({synthetic:true,holders:100001,steps,elapsedMs:Math.round(performance.now()-started),baseHeapBytes:baseHeap,maxSampledHeapBytes:maxSampledHeap,proofCount:count.rows[0]?.n}));
 }finally{await db.pool.query(`DROP SCHEMA IF EXISTS ${capacitySchema} CASCADE`).catch(()=>undefined);await db.pool.end();}
});
