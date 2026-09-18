import assert from 'node:assert/strict';
import test from 'node:test';
import {loadCreatorRewards, validateCreatorRewards} from '../src/v1/creatorRewards.ts';

const chainId=46630,marketId=`0x${'1'.repeat(64)}`,account=`0x${'2'.repeat(40)}`;
const currentBeneficiary=`0x${'3'.repeat(40)}`,pendingBeneficiary=`0x${'4'.repeat(40)}`;
const asset=`0x${'5'.repeat(40)}`,meme=`0x${'6'.repeat(40)}`;
const amounts=(credited='10',paid='2',burned='1',remaining='7')=>({credited,paid,burned,remaining});
const period=(epoch:number,beneficiary=account)=>({epoch,beneficiary,quote:amounts(),meme:amounts('0','0','0','0')});
const page=(overrides:Record<string,unknown>={})=>({
  chainId,displayOnly:true,marketId,account,
  market:{marketId,quoteAsset:asset,memeToken:meme},
  currentEpoch:3,currentBeneficiary,pendingBeneficiary:`0x${'0'.repeat(40)}`,
  pendingQuote:'0',curveFees:'0',periods:[period(3),period(1)],nextCursor:null,
  sourceBlockNumber:'123',sourceBlockHash:`0x${'a'.repeat(64)}`,...overrides,
});

test('Creator rewards validation rejects wallet, market and chain mismatches',()=>{
  assert.throws(()=>validateCreatorRewards(page(),chainId,marketId,`0x${'9'.repeat(40)}`),/Invalid Creator response/);
  assert.throws(()=>validateCreatorRewards(page(),1,marketId,account),/Invalid Creator response/);
  assert.throws(()=>validateCreatorRewards(page({marketId:`0x${'8'.repeat(64)}`}),chainId,marketId,account),/Invalid Creator response/);
  assert.throws(()=>validateCreatorRewards(page({market:{marketId:`0x${'8'.repeat(64)}`,quoteAsset:asset,memeToken:meme}}),chainId,marketId,account),/Invalid Creator response/);
});

test('Creator rewards validation rejects inconsistent and invalid ledger balances',()=>{
  assert.throws(()=>validateCreatorRewards(page({periods:[{...period(2),quote:amounts('2','0','0','1')}]}),chainId,marketId,account),/Invalid Creator balance/);
  assert.throws(()=>validateCreatorRewards(page({periods:[{...period(2),quote:amounts('2','3','0','0')}]}),chainId,marketId,account),/Invalid Creator balance/);
  assert.throws(()=>validateCreatorRewards(page({periods:[{...period(2),meme:amounts('01','0','0','1')}]}),chainId,marketId,account),/Invalid Creator balance/);
});

test('Creator rewards validation rejects duplicate and out-of-order periods',()=>{
  assert.throws(()=>validateCreatorRewards(page({periods:[period(2),period(2)]}),chainId,marketId,account),/Invalid Creator period/);
  assert.throws(()=>validateCreatorRewards(page({periods:[period(1),period(2)]}),chainId,marketId,account),/Invalid Creator period/);
});

test('a pending-only recipient validates with no prior Creator periods',()=>{
  const pendingOnly=page({account:pendingBeneficiary,currentBeneficiary:null,pendingBeneficiary,periods:[]});
  const result=validateCreatorRewards(pendingOnly,chainId,marketId,pendingBeneficiary);
  assert.deepEqual(result.periods,[]);
  assert.equal(result.pendingBeneficiary,pendingBeneficiary);
});

test('Creator rewards loader passes the selected epoch and pagination cursor',async()=>{
  const original=globalThis.fetch;let requested:URL|undefined,cache:string|undefined;
  globalThis.fetch=(async(input,init)=>{requested=new URL(String(input));cache=init?.cache;return new Response(JSON.stringify(page()),{status:200});}) as typeof fetch;
  try{
    await loadCreatorRewards('https://read.example/base',chainId,marketId,account,{epoch:2,cursor:'next-page'});
    assert.ok(requested);assert.equal(requested.pathname,'/v1/creator-rewards');
    assert.equal(requested.searchParams.get('marketId'),marketId);
    assert.equal(requested.searchParams.get('account'),account);
    assert.equal(requested.searchParams.get('epoch'),'2');
    assert.equal(requested.searchParams.get('cursor'),'next-page');
    assert.equal(cache,'no-store');
  }finally{globalThis.fetch=original;}
});

test('Creator rewards loader rejects HTTP failures',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=(async()=>new Response('unavailable',{status:503})) as typeof fetch;
  try{await assert.rejects(()=>loadCreatorRewards('https://read.example',chainId,marketId,account),/Creator rewards could not be loaded/);}
  finally{globalThis.fetch=original;}
});
