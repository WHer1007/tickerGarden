import assert from 'node:assert/strict';
import test from 'node:test';
import {sweepBudget,sweepOnce,type SweepJournal,type SweepPolicy} from '../../packages/chain-worker/src/creator-sweep.ts';

const signer=`0x${'1'.repeat(40)}` as const;
const policy: SweepPolicy={chainId:4663,releaseId:'release-a',maxTxGasWei:100n,dailyGasWei:250n,minByAsset:{},finality:'finalized',delaySeconds:60};
const journal=():SweepJournal=>({chainId:4663,releaseId:'release-a',signer,day:'2026-09-18',reserved:'0',cursor:'0',pending:null});

const rpc={
  async call<T>(method:string):Promise<T>{
    if(method==='eth_chainId')return '0x1238' as T;
    throw new Error(`Unexpected RPC method ${method}`);
  },
  async finalizedBlock(){throw new Error('Unexpected finalized block request');},
} as any;

test('sweepBudget accepts a positive transaction within both caps',()=>{
  assert.equal(sweepBudget(policy,100n,100n),undefined);
  assert.equal(sweepBudget(policy,150n,100n),undefined);
});

test('sweepBudget rejects zero, negative, per-transaction overage, and daily overage',()=>{
  for(const [reserved,cost] of [[0n,0n],[0n,101n],[151n,100n]] as const){
    assert.throws(()=>sweepBudget(policy,reserved,cost),/Creator sweep gas budget exceeded/);
  }
});

test('sweepOnce stops on an RPC chain mismatch before reading, signing, or saving',async()=>{
  const j=journal();let signed=0,saved=0;
  const account={address:signer,async signTransaction(){signed++;throw new Error('must not sign');}} as any;
  await assert.rejects(sweepOnce({rpc,policy,journal:j,account,candidate:{marketId:`0x${'2'.repeat(64)}`,quoteAsset:`0x${'3'.repeat(40)}`},save:async()=>{saved++;}}),/Creator sweep chain mismatch/);
  assert.equal(signed,0);
  assert.equal(saved,0);
  assert.equal(j.pending,null);
});

test('sweepOnce rejects a policy and journal mismatch before any RPC or signature',async()=>{
  let calls=0,signed=0;
  const noRpc={...rpc,async call<T>(method:string):Promise<T>{calls++;throw new Error(`Unexpected RPC method ${method}`);}};
  const account={address:signer,async signTransaction(){signed++;throw new Error('must not sign');}} as any;
  const j=journal();j.releaseId='old-release';
  await assert.rejects(sweepOnce({rpc:noRpc as any,policy,journal:j,account,candidate:{marketId:`0x${'2'.repeat(64)}`,quoteAsset:`0x${'3'.repeat(40)}`},save:async()=>{}}),/Invalid Creator sweep policy/);
  assert.equal(calls,0);
  assert.equal(signed,0);
});

import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {privateKeyToAccount} from 'viem/accounts';
import {encodeFunctionData,keccak256} from 'viem';
import {sweepAbi,verifySweepIntent} from '../../packages/chain-worker/src/creator-sweep.ts';
import {withSignerLane} from '../../packages/chain-worker/src/signer-coordination.ts';

const privateKey=`0x${'11'.repeat(32)}` as const;
const local=privateKeyToAccount(privateKey);
const curve=`0x${'4'.repeat(40)}` as const;
const quote=`0x${'3'.repeat(40)}` as const;
const marketId=`0x${'2'.repeat(64)}` as const;
const record={config:{curve,quoteAsset:quote},runtime:{launchPhase:0}} as any;
const signedIntent=async(overrides:Record<string,unknown>={})=>{
  const raw=await local.signTransaction({chainId:4663,type:'legacy',to:curve,data:encodeFunctionData({abi:sweepAbi,functionName:'sweepCurveFees'}),value:0n,gas:10n,gasPrice:2n,nonce:7,...overrides} as any);
  return {raw,hash:keccak256(raw),market:marketId,curve,quote,nonce:7};
};
const intentPolicy={...policy,maxTxGasWei:100n};
const intentJournal=async(pending:any)=>({...journal(),signer:local.address,pending});

test('verifySweepIntent accepts an intact locally signed sweep intent',async()=>{
  const j=await intentJournal(await signedIntent());
  await assert.doesNotReject(()=>verifySweepIntent(intentPolicy,j,record));
});

test('verifySweepIntent rejects altered hash, recipient, value, calldata, nonce, chain, signer, registry curve, and gas cap',async()=>{
  const cases:[string,()=>Promise<any>,(j:SweepJournal,r:any)=>void][]=[
    ['hash',async()=>{const p=await signedIntent();return {...p,hash:`0x${'a'.repeat(64)}`};},()=>{}],
    ['recipient',async()=>signedIntent({to:`0x${'5'.repeat(40)}`}),()=>{}],
    ['amount',async()=>signedIntent({value:1n}),()=>{}],
    ['calldata',async()=>signedIntent({data:'0x12345678'}),()=>{}],
    ['nonce',async()=>signedIntent({nonce:8}),()=>{}],
    ['chain',async()=>signedIntent({chainId:1}),()=>{}],
    ['signer',async()=>signedIntent(),j=>{j.signer=`0x${'9'.repeat(40)}`;}],
    ['registry curve',async()=>signedIntent(),(_j,r)=>{r.config.curve=`0x${'5'.repeat(40)}`;}],
    ['gas cap',async()=>signedIntent({gas:100n,gasPrice:2n}),()=>{}],
  ];
  for(const [name,make,alter] of cases){
    const j=await intentJournal(await make()),r={config:{...record.config},runtime:record.runtime};
    alter(j,r);
    await assert.rejects(verifySweepIntent(intentPolicy,j,r),Error,name);
  }
});

test('withSignerLane blocks creator and locker while holder has an unresolved shared-signer intent',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'creator-sweep-lane-'));
  try{
    await withSignerLane(dir,4663,signer,'holder',async()=>({status:'pending'}),()=>true);
    for(const owner of ['creator','locker'] as const){
      await assert.rejects(withSignerLane(dir,4663,signer,owner,async()=>({status:'unexpected'}),()=>false),/unresolved intent in another service/);
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});
