import test from 'node:test';
import assert from 'node:assert/strict';
import type {Pool} from 'pg';
import {decodeFunctionData,encodeFunctionResult,type Abi,type Address,type Hex} from 'viem';
import {RpcTransport,type RpcBlock} from '../../packages/chain/src/index.ts';
import {CURRENT_RELEASE_ID,CURRENT_ACTIVATION_BLOCK,fixedF72Sources} from '../../packages/events/src/index.ts';
import {snapshotAbis} from '../../packages/events/src/f72-abis.generated.ts';
import {buildSnapshot,SNAPSHOT_MODE} from '../../packages/chain/src/holder-snapshot.ts';
import {previewSnapshotPublication,snapshotDistributor} from '../../packages/chain-worker/src/holder-snapshots.ts';
import {FakeRpc,fixture,h,a,height} from '../fixtures/snapshot-rpc.ts';
function options(primary:FakeRpc,secondary:FakeRpc,retained=true){let evidence=false;return {pool:{query:async(sql:string)=>{if(sql.includes('INSERT INTO')&&sql.includes('holder_snapshot_evidence')){evidence=true;return {rowCount:1,rows:[]};}return {rowCount:retained?1:0,rows:retained?[{generation:'0',evidence}]:[]};}} as unknown as Pool,deployment:{environment:'test' as const,chainId:46630 as const,deploymentDigest:CURRENT_RELEASE_ID,activationBlock:CURRENT_ACTIVATION_BLOCK},primary,secondary};}
test('snapshot preview independently checks retained artifact and historical funds/holders before simulation',async()=>{
 const p=new FakeRpc(),s=new FakeRpc(),d=fixture(),o=options(p,s);const result=await previewSnapshotPublication(o,d);
 assert.equal(result.status,'simulated_not_broadcast');assert.equal(p.simulations,1);assert.equal(s.simulations,1);
 await assert.rejects(()=>previewSnapshotPublication(options(p,s,false),d),/durably retained/);
 const cachedBalances=p.balanceReads+s.balanceReads;assert.equal((await previewSnapshotPublication(o,d)).status,'simulated_not_broadcast');assert.equal(p.balanceReads+s.balanceReads,cachedBalances,'verified evidence skips historical holder rereads');
 s.badBalance=true;await assert.rejects(()=>previewSnapshotPublication(options(p,s),d),/disagreement/);s.badBalance=false;
 p.underfunded=s.underfunded=true;await assert.rejects(()=>previewSnapshotPublication(options(p,s),d),/budget changed/);
});
test('preview distinguishes unconfigured publisher and matching receipts, rejects conflicting rounds and reorgs',async()=>{
 const p=new FakeRpc(),s=new FakeRpc(),d=fixture();p.publisher=s.publisher=a(0);
 assert.equal((await previewSnapshotPublication(options(p,s),d)).status,'publisher_unconfigured');assert.equal(p.simulations,0);
 p.root=s.root=d.root;p.dataHash=s.dataHash=d.dataHash;assert.equal((await previewSnapshotPublication(options(p,s),d)).status,'already_published');
 p.root=s.root=h(7);await assert.rejects(()=>previewSnapshotPublication(options(p,s),d),/conflicts/);
 p.orphan=s.orphan=true;await assert.rejects(()=>previewSnapshotPublication(options(p,s),d),/orphaned/);
});

test('cached verification evidence cannot survive a generation change during preview',async()=>{
 const p=new FakeRpc(),s=new FakeRpc(),d=fixture(),o=options(p,s);
 const query=o.pool.query.bind(o.pool);
 o.pool.query=(async(sql:string,...args:unknown[])=>String(sql).startsWith('SELECT 1 FROM')?{rowCount:0,rows:[]}:query(sql,...args as [])) as typeof o.pool.query;
 await assert.rejects(()=>previewSnapshotPublication(o,d),/verification generation changed/);
 assert.equal(p.simulations,0);
});
