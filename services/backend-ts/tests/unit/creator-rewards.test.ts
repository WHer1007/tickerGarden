import assert from 'node:assert/strict';
import test from 'node:test';
import {changeCreatorBalance, pendingCreatorQuote, ZERO_CREATOR, type CreatorBalance, type CreatorState} from '../../packages/history-projector/src/creator-rewards.ts';

const market=(creatorFeesToHolders:boolean)=>({
  marketId:`0x${'1'.repeat(64)}`,memeToken:`0x${'2'.repeat(40)}`,quoteAsset:`0x${'3'.repeat(40)}`,
  creator:`0x${'4'.repeat(40)}`,creatorFeesToHolders,
});
const state=(curveFees:string,curveTax:string,creatorFeesToHolders=false):CreatorState=>({
  marketId:market(creatorFeesToHolders).marketId,currentEpoch:1,pendingBeneficiary:ZERO_CREATOR,
  curveFees,curveTax,market:market(creatorFeesToHolders),
});
const balance=(credited='0',paid='0',burned='0'):CreatorBalance=>({
  marketId:market(false).marketId,epoch:1,beneficiary:market(false).creator,asset:market(false).quoteAsset,
  credited,paid,burned,remaining:(BigInt(credited)-BigInt(paid)-BigInt(burned)).toString(),
});

test('pending Curve Creator Quote takes the exact floored 70/30 base split and all Creator tax',()=>{
  const pending=pendingCreatorQuote(state('110','9'));
  assert.equal(pending,80n); // base 101: 30 to Platform and 71 to Creator, plus 9 tax.
});

test('Holder share is half of Creator base only, with integer rounding down',()=>{
  const pending=pendingCreatorQuote(state('110','9',true));
  assert.equal(pending,45n); // floor(71 / 2) goes to Holders; all 9 tax stays with Creator.
});

test('pending Curve Creator Quote handles zero and very large bigint amounts exactly',()=>{
  assert.equal(pendingCreatorQuote(state('0','0')),0n);
  const base=(1n<<200n)+101n,tax=(1n<<180n)+9n;
  assert.equal(pendingCreatorQuote(state((base+tax).toString(),tax.toString())),base-base*3000n/10000n+tax);
});

test('pending Curve Creator Quote rejects tax greater than accumulated fees',()=>{
  assert.throws(()=>pendingCreatorQuote(state('4','5')),/Creator tax exceeds curve fees/);
});

test('Creator balance conserves credit across paid and burned amounts',()=>{
  const credited=changeCreatorBalance(balance(),'credited',100n);
  assert.equal(credited.remaining,'100');
  const paid=changeCreatorBalance(credited,'paid',35n);
  assert.equal(paid.remaining,'65');
  const burned=changeCreatorBalance(paid,'burned',20n);
  assert.equal(burned.remaining,'45');
  assert.equal(BigInt(burned.credited),BigInt(burned.paid)+BigInt(burned.burned)+BigInt(burned.remaining));
});

test('Creator balance supports large bigint movements without precision loss',()=>{
  const amount=1n<<220n;
  const credited=changeCreatorBalance(balance(),'credited',amount);
  const paid=changeCreatorBalance(credited,'paid',amount/3n);
  assert.equal(paid.remaining,(amount-amount/3n).toString());
});

test('Creator balance rejects negative movements and paid or burned double-consumption underflow',()=>{
  const credited=changeCreatorBalance(balance(),'credited',10n);
  assert.throws(()=>changeCreatorBalance(credited,'paid',11n),/Creator reward ledger underflow/);
  const paid=changeCreatorBalance(credited,'paid',6n);
  assert.throws(()=>changeCreatorBalance(paid,'paid',5n),/Creator reward ledger underflow/);
  const burned=changeCreatorBalance(paid,'burned',4n);
  assert.throws(()=>changeCreatorBalance(burned,'burned',1n),/Creator reward ledger underflow/);
  assert.throws(()=>changeCreatorBalance(credited,'burned',-1n),/Negative Creator movement/);
});
