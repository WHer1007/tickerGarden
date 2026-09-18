import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {Pool} from 'pg';
import {encodeAbiParameters,encodeEventTopics,encodeFunctionData,keccak256,parseAbiParameters,parseTransaction,toHex,type Abi,type Hex} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {FakeRpc,fixture,height,h} from '../fixtures/snapshot-rpc.ts';
import {CURRENT_RELEASE_ID,CURRENT_ACTIVATION_BLOCK} from '../../packages/events/src/index.ts';
import {snapshotAbis} from '../../packages/events/src/f72-abis.generated.ts';
import {publishSnapshotOnce,reconcilePublication,type PublicationDependencies,type PublicationJournal} from '../../packages/chain-worker/src/holder-publication.ts';
import {withPublicationJournal,publicationStatus} from '../../packages/chain-worker/src/holder-publication-journal.ts';
import {safePublicationError} from '../../scripts/holder-publication-cli.ts';
import {PublicationRpcTransport} from '../../packages/chain-worker/src/holder-publication-rpc.ts';
import {RpcTransport} from '../../packages/chain/src/index.ts';
import {buildSnapshot,type SnapshotDataset} from '../../packages/chain/src/holder-snapshot.ts';
import type {SnapshotArtifact} from '../../packages/chain/src/holder-artifact.ts';

const account=privateKeyToAccount(`0x${'1'.padStart(64,'0')}`),ds=fixture();
const signer={address:account.address,sign:account.signTransaction};
const publicationData=(dataset:SnapshotArtifact)=>encodeFunctionData({abi:snapshotAbis.HolderRewardsDistributorV1 as Abi,functionName:'publishSnapshots',args:[[{marketId:dataset.input.marketId,round:BigInt(dataset.input.round),snapshotBlock:BigInt(dataset.input.snapshotBlock),snapshotBlockHash:dataset.input.snapshotBlockHash,root:dataset.root,dataHash:dataset.dataHash,quoteBudget:BigInt(dataset.quoteBudget),memeBudget:BigInt(dataset.memeBudget)}]]});
function receipt(hash:Hex,datasets:readonly SnapshotArtifact[]=[ds]){return {transactionHash:hash,blockHash:h(4),blockNumber:toHex(height+999n),status:'0x1',gasUsed:'0x10000',effectiveGasPrice:'0x2',logs:datasets.map(dataset=>({
 address:dataset.input.distributor,topics:encodeEventTopics({abi:snapshotAbis.HolderRewardsDistributorV1 as Abi,eventName:'HolderSnapshotPublished',args:{marketId:dataset.input.marketId,round:BigInt(dataset.input.round)}}),
 data:encodeAbiParameters(parseAbiParameters('uint64,bytes32,bytes32,bytes32,uint256,uint256'),[BigInt(dataset.input.snapshotBlock),dataset.input.snapshotBlockHash,dataset.root,dataset.dataHash,BigInt(dataset.quoteBudget),BigInt(dataset.memeBudget)]),
}))};}
class PublisherRpc extends FakeRpc {
 sent:Hex[]=[];receipt:ReturnType<typeof receipt>|null=null;nonce=0;pendingNonce:number|undefined;accept:((raw:Hex)=>void)|undefined;uncertain=false;price='0x2';headTime=100000n;finalizedUnavailable=false;onSimulation:(()=>void)|undefined;onEstimate:(()=>void)|undefined;
 constructor(){super();this.publisher=account.address;}
 override async block(number:bigint){return {...await super.block(number),timestamp:number===height+1000n?this.headTime:100000n};}
 override async call<T>(method:string,params:readonly unknown[]):Promise<T>{
  if(method==='eth_getTransactionCount')return toHex(params[1]==='pending'?(this.pendingNonce??this.nonce):this.nonce) as T;
  if(method==='eth_getBlockByNumber'&&params[0]==='finalized')return (this.finalizedUnavailable?null:{number:toHex(height+1000n),hash:h(4),parentHash:h(1),timestamp:'0x186a0'}) as T;
  if(method==='eth_estimateGas'){this.onEstimate?.();return '0x30000' as T;}
  if(method==='eth_gasPrice')return this.price as T;
  if(method==='eth_getBalance')return '0xffffffffff' as T;
  if(method==='eth_getTransactionReceipt')return this.receipt as T;
  if(method==='eth_sendRawTransaction'){const raw=params[0] as Hex;this.sent.push(raw);this.accept?.(raw);if(this.uncertain)throw Error('secret RPC url/raw transport failure');return keccak256(raw) as T;}
  if(method==='eth_call')this.onSimulation?.();
  return super.call(method,params);
 }
}
function setup(){
 const primary=new PublisherRpc(),secondary=new PublisherRpc();let saved:PublicationJournal|null=null;let saves=0;
 const journal:PublicationJournal={chainId:46630,releaseId:CURRENT_RELEASE_ID,publisher:account.address,pending:null};
 const d:PublicationDependencies={options:{pool:{query:async()=>({rowCount:1,rows:[{generation:'0',evidence:false}]})} as unknown as Pool,deployment:{environment:'test',chainId:46630,deploymentDigest:CURRENT_RELEASE_ID,activationBlock:CURRENT_ACTIVATION_BLOCK},primary,secondary},policy:{publisher:account.address,maxGasWei:10000000n,confirmations:2,finalitySeconds:0,intentMaxAgeSeconds:300},journal,
 save:async j=>{saved=structuredClone(j);saves++;}};
 const accept=(raw:Hex)=>{assert.equal(saved?.pending?.raw,raw,'must persist before broadcasting');for(const rpc of [primary,secondary]){rpc.receipt=receipt(keccak256(raw));rpc.root=ds.root;rpc.dataHash=ds.dataHash;rpc.nonce=1;}};
 primary.accept=accept;
 return {d,primary,secondary,accept,get saved(){return saved;},get saves(){return saves;}};
}

test('manual publish verifies dataset, persists exact signature, sends and confirms exact root; rerun is idempotent',async()=>{
 const x=setup();const result=await publishSnapshotOnce(x.d,ds,signer);
 assert.equal(result.status,'confirmed');assert.equal(x.primary.sent.length,1);assert.equal(x.saved?.pending,null);assert.equal(x.saved?.last?.dataHash,ds.dataHash);
 assert.equal((await publishSnapshotOnce(x.d,ds,signer)).status,'already_published');assert.equal(x.primary.sent.length,1);
});
function secondMarket():SnapshotDataset{return buildSnapshot({...ds.input,marketId:h(22)});}
test('two-market publication signs batch calldata and verifies every receipt event',async()=>{
 const x=setup(),other=secondMarket(),batch=[ds,other];let published=false;
 x.d.preview=async dataset=>published?{status:'already_published',headBlock:(height+1000n).toString(),headHash:h(4)}:{status:'simulated_not_broadcast',from:account.address,to:dataset.input.distributor,data:publicationData(dataset),headBlock:(height+1000n).toString(),headHash:h(4),dataHash:dataset.dataHash};
 x.primary.accept=raw=>{const hash=keccak256(raw);for(const rpc of [x.primary,x.secondary]){rpc.receipt=receipt(hash,batch);rpc.nonce=1;}published=true;};
 const result=await publishSnapshotOnce(x.d,batch,signer);
 assert.equal(result.status,'confirmed');assert.equal(x.primary.sent.length,1);
 const signed=parseTransaction(x.primary.sent[0]!);
 assert.equal(signed.data,publicationDataBatch(batch));
});
function publicationDataBatch(datasets:readonly SnapshotArtifact[]):Hex{return encodeFunctionData({abi:snapshotAbis.HolderRewardsDistributorV1 as Abi,functionName:'publishSnapshots',args:[datasets.map(dataset=>({marketId:dataset.input.marketId,round:BigInt(dataset.input.round),snapshotBlock:BigInt(dataset.input.snapshotBlock),snapshotBlockHash:dataset.input.snapshotBlockHash,root:dataset.root,dataHash:dataset.dataHash,quoteBudget:BigInt(dataset.quoteBudget),memeBudget:BigInt(dataset.memeBudget)}))]});}
test('mixed already-published and unpublished markets reject before signing',async()=>{
 const x=setup(),other=secondMarket(),batch=[ds,other];let signatures=0;
 x.d.preview=async dataset=>dataset.input.marketId===ds.input.marketId?{status:'already_published',headBlock:(height+1000n).toString(),headHash:h(4)}:{status:'simulated_not_broadcast',from:account.address,to:dataset.input.distributor,data:publicationData(dataset),headBlock:(height+1000n).toString(),headHash:h(4),dataHash:dataset.dataHash};
 await assert.rejects(()=>publishSnapshotOnce(x.d,batch,{...signer,sign:async tx=>{signatures++;return signer.sign(tx);}}),/partially published/);
 assert.equal(signatures,0);assert.equal(x.primary.sent.length,0);
});
test('finalized policy confirms at finalized head and stays pending when finality is unavailable',async()=>{
 const complete=setup();complete.d.policy.finalityMode='finalized';assert.equal((await publishSnapshotOnce(complete.d,ds,signer)).status,'confirmed');
 const unavailable=setup();unavailable.d.policy.finalityMode='finalized';unavailable.primary.finalizedUnavailable=unavailable.secondary.finalizedUnavailable=true;
 await assert.rejects(()=>publishSnapshotOnce(unavailable.d,ds,signer),/Finalized RPC block unavailable/);assert.ok(unavailable.d.journal.pending);assert.equal(unavailable.primary.sent.length,1);
 unavailable.primary.finalizedUnavailable=unavailable.secondary.finalizedUnavailable=false;assert.equal((await reconcilePublication(unavailable.d,ds)).status,'confirmed');
});
test('nonce refresh detects a nonce consumed after simulation and refuses to sign',async()=>{
 const x=setup();x.primary.onEstimate=()=>{x.primary.nonce=1;x.secondary.nonce=1;};let signatures=0;
 await assert.rejects(()=>publishSnapshotOnce(x.d,ds,{...signer,sign:async tx=>{signatures++;return signer.sign(tx);}}),/nonce changed before signing/);
 assert.equal(signatures,0);assert.equal(x.primary.sent.length,0);assert.equal(x.d.journal.pending,null);
});
test('uncertain accepted submission is recovered read-only without private signer or duplicate send',async()=>{
 const x=setup();x.primary.uncertain=true;
 await assert.rejects(()=>publishSnapshotOnce(x.d,ds,signer),/submission uncertain/);assert.ok(x.saved?.pending?.raw);
 x.d.journal=structuredClone(x.saved!);
 assert.equal((await reconcilePublication(x.d,ds)).status,'confirmed');assert.equal(x.primary.sent.length,1);
});
test('uncertain unaccepted submission retries only identical signed bytes',async()=>{
 const x=setup();x.primary.accept=undefined;x.primary.uncertain=true;
 await assert.rejects(()=>publishSnapshotOnce(x.d,ds,signer),/submission uncertain/);
 const raw=x.saved!.pending!.raw;x.d.journal=structuredClone(x.saved!);x.primary.uncertain=false;x.primary.accept=x.accept;
 assert.equal((await publishSnapshotOnce(x.d,ds,signer)).status,'confirmed');assert.deepEqual(x.primary.sent,[raw,raw]);
});
test('wrong signer, stale/conflicting dataset, chain drift, pending nonce and gas cap never send',async()=>{
 for(const mode of ['signer','dataset','chain','cap','pending']as const){const x=setup();if(mode==='chain')x.secondary.badChain=true;if(mode==='cap')x.primary.price='0xffffff';if(mode==='pending')x.primary.pendingNonce=1;
  const s=mode==='signer'?{...signer,address:`0x${'2'.repeat(40)}` as const}:signer;
  await assert.rejects(()=>publishSnapshotOnce(x.d,mode==='dataset'?{...ds,root:h(9)}:ds,s));assert.equal(x.primary.sent.length,0);assert.equal(x.d.journal.pending,null);
 }
});
test('disk failure before submission cannot broadcast',async()=>{
 const x=setup();x.d.save=async()=>{throw Error('disk unavailable');};await assert.rejects(()=>publishSnapshotOnce(x.d,ds,signer),/disk/);assert.equal(x.primary.sent.length,0);
});
test('confirmation depth, elapsed time, RPC disagreement and orphaned receipt do not mark published',async()=>{
 const x=setup();x.d.policy.confirmations=3;
 assert.equal((await publishSnapshotOnce(x.d,ds,signer)).status,'confirming');assert.ok(x.d.journal.pending);
 x.d.policy.confirmations=2;x.d.policy.finalitySeconds=600;
 assert.equal((await reconcilePublication(x.d,ds)).status,'confirming');
 x.primary.headTime=x.secondary.headTime=100600n;
 x.secondary.receipt={...x.secondary.receipt!,blockHash:h(8)};
 await assert.rejects(()=>reconcilePublication(x.d,ds),/disagreement/);assert.ok(x.d.journal.pending);
 x.primary.receipt={...x.primary.receipt!,blockHash:h(8)};
 await assert.rejects(()=>reconcilePublication(x.d,ds),/orphaned/);assert.ok(x.d.journal.pending);
});
test('mismatched publication event and reverted receipt are distinguished',async()=>{
 const x=setup();x.d.policy.confirmations=3;await publishSnapshotOnce(x.d,ds,signer);x.d.policy.confirmations=2;
 for(const rpc of [x.primary,x.secondary])rpc.receipt={...rpc.receipt!,logs:[]};
 await assert.rejects(()=>reconcilePublication(x.d,ds),/event count|exactly one/);assert.ok(x.d.journal.pending);
 for(const rpc of [x.primary,x.secondary])rpc.receipt={...rpc.receipt!,status:'0x0'};
 assert.equal((await reconcilePublication(x.d,ds)).status,'reverted');assert.equal(x.d.journal.pending,null);
});
test('expired intent, consumed nonce and modified signature cannot create replacements',async()=>{
 for(const mode of ['expired','nonce','tampered']as const){const x=setup();x.primary.accept=undefined;x.primary.uncertain=true;await assert.rejects(()=>publishSnapshotOnce(x.d,ds,signer));
  if(mode==='expired')x.primary.headTime=x.secondary.headTime=100301n;
  if(mode==='nonce')x.primary.nonce=x.secondary.nonce=1;
  if(mode==='tampered')x.d.journal.pending!.raw='0x1234';
  await assert.rejects(()=>publishSnapshotOnce(x.d,ds,signer));assert.equal(x.primary.sent.length,1);assert.ok(x.d.journal.pending);
 }
});
test('journal persists with private permissions, hides raw bytes, and rejects concurrent signer lock',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'tg-publication-'));fs.chmodSync(directory,0o700);
 const identity={chainId:46630,releaseId:CURRENT_RELEASE_ID,publisher:account.address};
 try{await withPublicationJournal(directory,identity,async(j,save)=>{
  await save(j);await assert.rejects(()=>withPublicationJournal(directory,identity,async()=>{}),/EEXIST/);
 });const file=path.join(directory,`46630-${account.address.toLowerCase()}.json`);assert.equal(fs.statSync(file).mode&0o077,0);
 const x=setup();x.primary.accept=undefined;x.primary.uncertain=true;await assert.rejects(()=>publishSnapshotOnce(x.d,ds,signer));assert.ok(!JSON.stringify(publicationStatus(x.d.journal)).includes(x.d.journal.pending!.raw));
 assert.ok(!safePublicationError(Error('secret-key https://rpc.example/private')).includes('secret-key'));
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('operator RPC supports explicit signing operations without opening the indexer transport',async()=>{
 let calls=0;const fetcher:typeof fetch=async(_input,init)=>{calls++;const req=JSON.parse(String(init?.body)) as {id:number;method:string};return new Response(JSON.stringify({jsonrpc:'2.0',id:req.id,result:req.method==='eth_sendRawTransaction'?h(7):'0x1'}));};
 const rpc=new PublicationRpcTransport({url:'http://127.0.0.1:1',fetch:fetcher});
 assert.equal(await rpc.call('eth_getTransactionCount',[account.address,'latest']),'0x1');
 assert.equal(await rpc.call('eth_sendRawTransaction',['0x1234']),h(7));assert.equal(calls,2);
 await assert.rejects(()=>rpc.call('eth_sendTransaction',[]),/not allowed/);
 await assert.rejects(()=>new RpcTransport({url:'http://127.0.0.1:1',fetch:fetcher}).call('eth_sendRawTransaction',[]),/not allowed/);
 assert.equal(calls,2);
});
test('operator RPC never retries a failed send or exposes provider secret payloads',async()=>{
 let calls=0;const rpc=new PublicationRpcTransport({url:'http://127.0.0.1:1',fetch:async()=>{calls++;throw Error('PRIVATE_URL_AND_RAW');}});
 await assert.rejects(()=>rpc.call('eth_sendRawTransaction',['0x1234']),e=>e instanceof Error&&e.message==='Publication RPC request failed');assert.equal(calls,1);
 const malformed=new PublicationRpcTransport({url:'http://127.0.0.1:1',fetch:async()=>new Response(JSON.stringify({id:1,result:123}))});
 await assert.rejects(()=>malformed.call('eth_gasPrice',[]),/request failed/);
});
