import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWalletSnapshot,validateWalletPublication} from './wallet-snapshot-preflight.mjs';
import {coverage,verifyAssetObservation,inspectAssetRisks} from './asset-risk-preflight.mjs';
import { keccak_256 } from '../../deployments/node_modules/@noble/hashes/sha3.js';
const a=n=>'0x'+n.toString(16).padStart(40,'0');
const h=n=>'0x'+n.toString(16).padStart(64,'0');
const reference=()=>({chainId:'4663',distributor:a(3),marketId:h(4),round:'1',lastRound:'0',
 snapshotBlock:'10',snapshotBlockHash:h(5),lastSnapshotBlock:'0',registeredBlock:'1',finalizedBlock:'12',
 quoteTarget:'100',memeTarget:'50',unallocatedQuote:'100',unallocatedMeme:'50',excluded:[a(9),a(10),a(11),a(12),a(13),a(14)],
 token:a(9),curve:a(10),poolManager:a(11),locker:a(12),vault:a(13),hook:a(14),totalSupply:'1003',
 balances:[{account:a(1),balance:'1'},{account:a(2),balance:'2'},{account:a(9),balance:'1000'}]});
const pair=(a,b)=>'0x'+Buffer.from(keccak_256(Buffer.from((a<b?a+b.slice(2):b+a.slice(2)).slice(2),'hex'))).toString('hex');
test('independent balances generate exact bounded leaves, dust remains unallocated, proofs resolve root',()=>{
 const r=reference(), out=buildWalletSnapshot(r);
 assert.equal(out.quoteBudget,'99');assert.equal(out.memeBudget,'49');
 assert.equal(out.claims.length,2);
 for(const row of out.claims) assert.equal(row.proof.reduce(pair,row.leaf),out.root);
 assert.deepEqual(validateWalletPublication(out,r),out);
});
test('wrong root, wrong deployment, altered amounts and reference balances fail comparison',()=>{
 const r=reference(), out=buildWalletSnapshot(r);
 for(const [key,value] of Object.entries({root:h(10),chainId:'1',quoteBudget:'100',dataHash:h(7),round:'2',distributor:a(8)}))
   assert.throws(()=>validateWalletPublication({...out,[key]:value},r));
 const changed=reference();changed.balances[0].balance='3';changed.totalSupply='1005';
 assert.throws(()=>validateWalletPublication(out,changed));
});
test('invalid duplicate, numeric precision, future snapshot, replay, unfunded and zero eligibility rejected',()=>{
 for(const mutate of [
 r=>r.balances.push({...r.balances[0]}),r=>r.balances[0].balance=1,
 r=>r.snapshotBlock='13',r=>r.lastRound='1',r=>r.unallocatedQuote='99',
 r=>r.balances=[{account:a(9),balance:'100'}],r=>r.snapshotBlockHash=h(0),r=>r.totalSupply='1004',r=>r.excluded=[]]) {
   const r=reference();mutate(r);assert.throws(()=>buildWalletSnapshot(r));
 }
});
test('data order independent; odd-width trees retain valid proofs',()=>{
 const r=reference();r.balances.push({account:a(7),balance:'2'});r.totalSupply='1005';
 const out=buildWalletSnapshot(r);r.balances.reverse();
 assert.deepEqual(buildWalletSnapshot(r),out);
 for(const row of out.claims) assert.equal(row.proof.reduce(pair,row.leaf),out.root);
});
test('proxy shell unchanged cannot hide changed implementation; unknown identity rejected',()=>{
 const expected={asset:a(1),kind:'erc1967',codeHash:h(1),decimals:'18',implementation:a(2),admin:a(3),beacon:a(0),implementationCodeHash:h(2)};
 verifyAssetObservation(expected,expected);
 assert.throws(()=>verifyAssetObservation(expected,{...expected,implementation:a(4)}));
 assert.throws(()=>verifyAssetObservation(expected,{...expected,implementationCodeHash:h(3)}));
 assert.throws(()=>verifyAssetObservation({...expected,kind:'unknown'},expected));
 assert.deepEqual(coverage('9','10'),{balance:'9',liability:'10',deficit:'1',surplus:'0'});
 assert.throws(()=>coverage(9,'10'));
});
test('reader rejects wrong chain or missing finalized block instead of returning healthy',async()=>{
 await assert.rejects(()=>inspectAssetRisks({chainId:'4663',assets:[],vaultAssets:[{vault:a(1),asset:a(0)}]},async()=> '0x1'),/Wrong chain/);
 await assert.rejects(()=>inspectAssetRisks({chainId:'4663',assets:[],vaultAssets:[{vault:a(1),asset:a(0)}]},async method=>method==='eth_chainId'?'0x1237':null),/Finalized/);
});

test('coverage reader pins all balance reads and rejects changed finalized block identity',async()=>{
 const reference={chainId:'4663',assets:[],vaultAssets:[{vault:a(1),asset:a(0)}]};
 let blocks=0; let reorg=false;
 const rpc=async(method,args)=>{
   if(method==='eth_chainId') return '0x1237';
   if(method==='eth_getBlockByNumber') { blocks++;return {number:'0x10',hash:reorg && blocks%2===0 ? h(2):h(1)}; }
   assert.equal(args.at(-1),'0x10');
   if(method==='eth_getBalance') return '0x09';
   if(method==='eth_call') return h(10);
   throw Error(method);
 };
 const out=await inspectAssetRisks(reference,rpc);
 assert.equal(out.status,'ASSET_DEFICIT');assert.equal(out.vaults[0].deficit,'1');
 reorg=true;
 await assert.rejects(()=>inspectAssetRisks(reference,rpc),/Pinned block changed/);
});

test('wallet leaf matches Solidity cross-language vector',()=>{
 const r=reference();r.distributor=a(0x1234);
 assert.equal(buildWalletSnapshot(r).claims.find(row=>row.account===a(1)).leaf,
  '0x5d928456ddf8e9fec94a65e0576a07ddeb03b66f6689594b2ffec4344e0484fc');
});
