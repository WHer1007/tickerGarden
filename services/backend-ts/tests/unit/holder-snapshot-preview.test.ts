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
function options(primary:FakeRpc,secondary:FakeRpc,retained=true){return {pool:{query:async()=>({rowCount:retained?1:0,rows:[]})} as unknown as Pool,deployment:{environment:'test' as const,chainId:46630 as const,deploymentDigest:CURRENT_RELEASE_ID,activationBlock:CURRENT_ACTIVATION_BLOCK},primary,secondary};}
test('snapshot preview independently checks retained artifact and historical funds/holders before simulation',async()=>{
 const p=new FakeRpc(),s=new FakeRpc(),d=fixture();const result=await previewSnapshotPublication(options(p,s),d);
 assert.equal(result.status,'simulated_not_broadcast');assert.equal(p.simulations,1);assert.equal(s.simulations,1);
 await assert.rejects(()=>previewSnapshotPublication(options(p,s,false),d),/durably retained/);
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
