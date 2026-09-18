import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeFunctionData,keccak256,toHex,type Hex} from 'viem';
import {currentV4Abis} from '../src/v1/generated/abis.ts';
import {parseHolderSnapshots,snapshotLeaf,snapshotRoot,remainingSnapshotAssets,holderSnapshotStatus,buildSnapshotClaim,fetchHolderSnapshotsPage,mergeHolderSnapshotPages,type SnapshotIdentity} from '../src/v1/features/holderSnapshots.ts';
const id:SnapshotIdentity={chainId:46630,distributor:`0x${'11'.repeat(20)}`,marketId:`0x${'22'.repeat(32)}`,account:`0x${'33'.repeat(20)}`,quote:`0x${'00'.repeat(20)}`,meme:`0x${'44'.repeat(20)}`};
function fixture(): any {
 const r={round:1n,quoteAmount:7n,memeAmount:9n};
 return {schema:'TICKERGARDEN_HOLDER_WALLET_SNAPSHOTS_V1',...id,displayOnly:true,finality:'finalized',sourceBlockNumber:'100',sourceBlockHash:`0x${'55'.repeat(32)}`,publicationRevision:'rev-1',complete:true,unavailableRounds:[],status:'ready',nextCursor:null,rounds:[{round:'1',snapshotBlock:'90',root:snapshotLeaf(id,r),quoteAmount:'7',memeAmount:'9',claimedAssets:0,proof:[]}]};
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
test('claim status appears only when it helps the holder decide what to do',()=>{
 const available=parseHolderSnapshots(fixture(),id).rounds[0]!;
 assert.deepEqual(holderSnapshotStatus('ready',available,true),{message:'',tone:'neutral'});
 assert.deepEqual(holderSnapshotStatus('ready',{...available,claimedAssets:3},true),{message:'Rewards from this distribution have already been claimed.',tone:'neutral'});
 assert.deepEqual(holderSnapshotStatus('ready',undefined,true),{message:'No rewards available for this wallet.',tone:'neutral'});
 assert.deepEqual(holderSnapshotStatus('ready',available,false),{message:'Claiming is temporarily unavailable.',tone:'error'});
});
test('strict integers, finality, source identity, duplicates and future snapshots fail closed',()=>{
 for(const modify of [(f:any)=>f.rounds[0].quoteAmount='1e18',(f:any)=>f.rounds[0].round='18446744073709551616',(f:any)=>f.rounds[0].snapshotBlock='100',(f:any)=>f.rounds.push(f.rounds[0]),(f:any)=>f.finality='head',(f:any)=>f.status='unknown',(f:any)=>f.rounds[0].claimedAssets=4,(f:any)=>f.sourceBlockHash='0x0']){const f=fixture();modify(f);assert.throws(()=>parseHolderSnapshots(f,id));}
});

test('round pages require distinct descending round numbers and expose incomplete rounds',()=>{
 const f=fixture();f.rounds.unshift({...f.rounds[0]!,round:'2',snapshotBlock:'91',root:snapshotLeaf(id,{round:2n,quoteAmount:7n,memeAmount:9n})});
 assert.doesNotThrow(()=>parseHolderSnapshots(f,id));
 f.rounds.reverse();assert.throws(()=>parseHolderSnapshots(f,id),/Invalid snapshot entitlement/);
 const partial=fixture();partial.complete=false;partial.unavailableRounds=['4','3'];
 const page=parseHolderSnapshots(partial,id);assert.equal(page.complete,false);assert.deepEqual(page.unavailableRounds,['4','3']);
});

test('legacy snapshot schema defaults completeness only when all new fields are absent',()=>{
 const f=fixture();delete f.publicationRevision;delete f.complete;delete f.unavailableRounds;
 const page=parseHolderSnapshots(f,id);assert.equal(page.complete,true);assert.deepEqual(page.unavailableRounds,[]);assert.equal(page.publicationRevision,'100:'+f.sourceBlockHash);
 f.complete=true;assert.throws(()=>parseHolderSnapshots(f,id),/Incomplete snapshot pagination metadata/);
});

test('expired pagination cursor restarts once at the first page',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async input=>{calls++;const url=new URL(String(input));if(url.searchParams.has('cursor'))return new Response('',{status:409});return new Response(JSON.stringify(fixture()),{status:200,headers:{'content-type':'application/json'}});};
 try{const result=await fetchHolderSnapshotsPage('https://read.example',id,new AbortController().signal,'stale');assert.equal(result.recoveredCursor,true);assert.equal(result.page.rounds[0]!.round,1n);assert.equal(calls,2);}
 finally{globalThis.fetch=original;}
});

test('cursor recovery does not mask unrelated fetch failures',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response('',{status:503});
 try{await assert.rejects(fetchHolderSnapshotsPage('https://read.example',id,new AbortController().signal,'stale'),/unavailable/);}
 finally{globalThis.fetch=original;}
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

test('new Holder loading is API-only and preempts legacy RPC paths; only the Holder dialog pauses its refresh',async()=>{
 const {readFileSync}=await import('node:fs');const app=readFileSync(new URL('../src/app.ts',import.meta.url),'utf8');
 const load=app.slice(app.indexOf('async function loadSnapshotReward('),app.indexOf('async function executeSnapshotClaim('));
 assert.ok(load.includes('fetchHolderSnapshots'));assert.ok(!load.includes('publicClient.'));
 const refresh=app.slice(app.indexOf('async function refreshTreasuryReward('),app.indexOf('function rewardActionButton('));
 assert.ok(refresh.indexOf('loadSnapshotReward')<refresh.indexOf('getRewardMarketDetail'));
 assert.match(app,/rewardChoicePending \|\| document.hidden \|\| !isRewardsPage/);
 assert.doesNotMatch(app,/hasActiveOperations\(\) \|\| rewardChoicePending/);
 assert.match(load,/publicationRevision/);assert.match(load,/recoveredCursor/);assert.doesNotMatch(load,/sourceBlock!==prior\.page\.sourceBlock|sourceHash!==prior\.page\.sourceHash/);
 assert.match(load,/generation===treasuryLoadGeneration/);assert.match(load,/wallet\?\.account===account/);assert.match(load,/value===market\.marketId/);
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

test('older page merge keeps descending order and prior partial status across advancing claim observations',()=>{
 const first=fixture(),older=fixture();first.rounds[0].round='2';first.rounds[0].root=snapshotLeaf(id,{round:2n,quoteAmount:7n,memeAmount:9n});first.complete=false;first.unavailableRounds=['3'];
 older.sourceBlockNumber='101';older.sourceBlockHash=`0x${'66'.repeat(32)}`;
 const a=parseHolderSnapshots(first,id),b=parseHolderSnapshots(older,id),merged=mergeHolderSnapshotPages(a,b);
 assert.deepEqual(merged.rounds.map(r=>r.round),[2n,1n]);assert.equal(merged.complete,false);assert.deepEqual(merged.unavailableRounds,['3']);
 assert.throws(()=>mergeHolderSnapshotPages(a,a),/overlap/);
 assert.throws(()=>mergeHolderSnapshotPages(a,{...b,publicationRevision:'new'}),/publication changed/);
 assert.throws(()=>mergeHolderSnapshotPages(a,{...b,identity:{...id,account:`0x${'77'.repeat(20)}`}}),/identity changed/);
});
