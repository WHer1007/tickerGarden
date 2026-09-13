import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeFunctionData,keccak256,toHex,type Hex} from 'viem';
import {currentV4Abis} from '../src/v1/generated/abis.ts';
import {parseHolderSnapshots,snapshotLeaf,snapshotRoot,remainingSnapshotAssets,buildSnapshotClaim,type SnapshotIdentity} from '../src/v1/features/holderSnapshots.ts';
const id:SnapshotIdentity={chainId:46630,distributor:`0x${'11'.repeat(20)}`,marketId:`0x${'22'.repeat(32)}`,account:`0x${'33'.repeat(20)}`,quote:`0x${'00'.repeat(20)}`,meme:`0x${'44'.repeat(20)}`};
function fixture() {
 const r={round:1n,quoteAmount:7n,memeAmount:9n};
 return {schema:'TICKERGARDEN_HOLDER_WALLET_SNAPSHOTS_V1',...id,displayOnly:true,finality:'finalized',sourceBlockNumber:'100',sourceBlockHash:`0x${'55'.repeat(32)}`,status:'ready',nextCursor:null,rounds:[{round:'1',snapshotBlock:'90',root:snapshotLeaf(id,r),quoteAmount:'7',memeAmount:'9',claimedAssets:0,proof:[]}]};
}
test('wallet proof binds chain, distributor, market, account, round and both assets',()=>{
 const p=parseHolderSnapshots(fixture(),id),r=p.rounds[0]!;assert.equal(remainingSnapshotAssets(r),3);
 const request=buildSnapshotClaim(id,r,2);const decoded=request;
 assert.equal(decoded.functionName,'claimSnapshot');assert.deepEqual(decoded.args,[id.marketId,1n,7n,9n,2,[]]);
 for(const changed of [{chainId:4663},{distributor:`0x${'66'.repeat(20)}`},{marketId:`0x${'66'.repeat(32)}`},{account:`0x${'66'.repeat(20)}`}])assert.throws(()=>parseHolderSnapshots(fixture(),{...id,...changed} as SnapshotIdentity));
 for(const field of ['round','quoteAmount','memeAmount'] as const){const f=fixture();f.rounds[0]![field]='2';assert.throws(()=>parseHolderSnapshots(f,id));}
});
test('partial claims keep the other original asset available and reject repeated claims',()=>{
 const f=fixture();f.rounds[0]!.claimedAssets=1;const r=parseHolderSnapshots(f,id).rounds[0]!;
 assert.equal(remainingSnapshotAssets(r),2);assert.doesNotThrow(()=>buildSnapshotClaim(id,r,2));assert.throws(()=>buildSnapshotClaim(id,r,1));assert.throws(()=>buildSnapshotClaim(id,r,3));
});
test('strict integers, finality, source identity, duplicates and future snapshots fail closed',()=>{
 for(const modify of [(f:any)=>f.rounds[0].quoteAmount='1e18',(f:any)=>f.rounds[0].round='18446744073709551616',(f:any)=>f.rounds[0].snapshotBlock='100',(f:any)=>f.rounds.push(f.rounds[0]),(f:any)=>f.finality='head',(f:any)=>f.status='unknown',(f:any)=>f.rounds[0].claimedAssets=4,(f:any)=>f.sourceBlockHash='0x0']){const f=fixture();modify(f);assert.throws(()=>parseHolderSnapshots(f,id));}
});
test('publisher disabled does not remove already-published claims; unavailable is not zero',()=>{
 const f=fixture();f.status='publisher_unconfigured';assert.equal(remainingSnapshotAssets(parseHolderSnapshots(f,id).rounds[0]!),3);
 assert.throws(()=>parseHolderSnapshots({error:'unavailable'},id));
});
test('sorted proofs match regardless of sibling side and do not accept a changed sibling',()=>{
 const f=fixture(),r=f.rounds[0]!,sibling=keccak256(toHex('second wallet'));r.proof=[sibling] as never[];r.root=snapshotRoot(r.root,[sibling]);
 assert.equal(parseHolderSnapshots(f,id).rounds.length,1);r.proof=[keccak256(toHex('changed'))] as never[];assert.throws(()=>parseHolderSnapshots(f,id));
});

test('leaf agrees with the independent Solidity and offline builder vector',()=>{
 const a=(n:number)=>`0x${n.toString(16).padStart(40,'0')}` as `0x${string}`;
 assert.equal(snapshotLeaf({...id,chainId:4663,distributor:a(0x1234),account:a(1),marketId:`0x${'4'.padStart(64,'0')}`},{round:1n,quoteAmount:33n,memeAmount:16n}), '0x5d928456ddf8e9fec94a65e0576a07ddeb03b66f6689594b2ffec4344e0484fc');
});

test('snapshot write approval is separate from every legacy stream approval',async()=>{
 const {parseV1RuntimeConfig,SNAPSHOT_HOLDER_RELEASE_APPROVAL}=await import('../src/v1/runtimeConfig.ts');
 assert.equal(parseV1RuntimeConfig({VITE_CONTINUOUS_HOLDER_RELEASE_APPROVAL:'HOLDER_DUAL_ASSET_24H_V4:DEPLOYED_E2E_APPROVED'}).snapshotHolderWrites.available,false);
 assert.equal(parseV1RuntimeConfig({VITE_HOLDER_SNAPSHOT_RELEASE_APPROVAL:SNAPSHOT_HOLDER_RELEASE_APPROVAL}).snapshotHolderWrites.available,true);
});

test('new Holder loading is API-only and preempts legacy RPC paths; dialog pauses periodic refresh',async()=>{
 const {readFileSync}=await import('node:fs');const app=readFileSync(new URL('../src/app.ts',import.meta.url),'utf8');
 const load=app.slice(app.indexOf('async function loadSnapshotReward('),app.indexOf('async function executeSnapshotClaim('));
 assert.ok(load.includes('fetchHolderSnapshots'));assert.ok(!load.includes('publicClient.'));
 const refresh=app.slice(app.indexOf('async function refreshTreasuryReward('),app.indexOf('function rewardActionButton('));
 assert.ok(refresh.indexOf('loadSnapshotReward')<refresh.indexOf('getRewardMarketDetail'));
 assert.match(app,/busyOperation \|\| rewardChoicePending \|\| document.hidden/);
});

test('reviewed snapshot display routing rejects ambiguous and cross-chain releases',async()=>{
 const {snapshotReleaseForMarket}=await import('../src/v1/marketRelease.ts');
 const release={releaseId:'test',chainId:46630,holderRewardMode:'wallet-snapshot-v1' as const,factory:id.distributor,marketRegistry:id.distributor,hook:id.meme,feeVault:id.distributor,creatorRegistry:id.distributor,holderDistributor:id.distributor,launchRouter:id.distributor,allocationManager:id.distributor};
 assert.equal(snapshotReleaseForMarket([release],46630,id.meme)?.holderRewardMode,'wallet-snapshot-v1');
 assert.equal(snapshotReleaseForMarket([release],4663,id.meme),null);
 assert.equal(snapshotReleaseForMarket([{...release,holderRewardMode:undefined}],46630,id.meme),null);
 assert.throws(()=>snapshotReleaseForMarket([release,{...release,releaseId:'other'}],46630,id.meme));
});

test('burn markets reject Meme proofs at both read and transaction boundaries',()=>{
 const burnId={...id,burnMemeFees:true};
 assert.throws(()=>parseHolderSnapshots(fixture(),burnId),/Quote-only/);
 const r=parseHolderSnapshots(fixture(),id).rounds[0]!;
 assert.throws(()=>buildSnapshotClaim(burnId,r,1),/Quote-only/);
});
