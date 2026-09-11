import assert from 'node:assert/strict';import test from 'node:test';
import {allocatedFeeTotals,validateStakePositions,stakeHistoryEvent,stakeAfter} from '../src/v1/stakingView.ts';
import type {TokenDetailFee,UserActivityRecord,UserPositionReadModel} from '../src/v1/generated/read-api.ts';
const address=('0x'+'1'.repeat(40)) as `0x${string}`,market=('0x'+'2'.repeat(64)) as `0x${string}`,asset=('0x'+'3'.repeat(64)) as `0x${string}`;
const source={chainId:46630 as const,blockNumber:'10',blockHash:('0x'+'4'.repeat(64)) as `0x${string}`,transactionHash:('0x'+'5'.repeat(64)) as `0x${string}`,transactionIndex:1,logIndex:2};
const position={user:address,marketId:market,assetUid:asset,free:'3',allocated:'12',active:'10',pending:'2',activationAt:'7',unlockAt:'100',claimable:[{kind:'quote' as const,asset:address,amount:'4'},{kind:'meme' as const,asset:('0x'+'6'.repeat(40)) as `0x${string}`,amount:'5'}],source} satisfies UserPositionReadModel;
test('fees remain asset separated and unavailable does not become zero',()=>{assert.equal(allocatedFeeTotals(null),null);const rows=[{asset:address,amountRaw:'9007199254740993000',recipient:'creator'},{asset:address,amountRaw:'3',recipient:'holders'},{asset:'0x'+'4'.repeat(40),amountRaw:'5',recipient:'stakers'}] as TokenDetailFee[];const sums=allocatedFeeTotals(rows)!;assert.equal(sums.size,2);assert.equal(sums.get(address),9007199254740993003n);});
test('stake history requires position owner and known event signature',()=>{const e={signature:'AllocationReleased(bytes32,address,bytes32,uint256,uint256,uint256)',arguments:{user:address,marketId:market,assetUid:asset,userMarketAllocation:'0'}} as unknown as UserActivityRecord;assert.equal(stakeHistoryEvent(e,address)?.exited,true);assert.equal(stakeHistoryEvent(e,'0x'+'5'.repeat(40)),null);assert.equal(stakeHistoryEvent({...e,signature:'Transfer(address,address,uint256)'},address),null);});
test('position display rejects another account and inconsistent amounts',()=>{const p=position;assert.equal(validateStakePositions([p],address,46630).length,1);assert.throws(()=>validateStakePositions([{...p,allocated:'15'}],address,46630));assert.throws(()=>validateStakePositions([p],'0x'+'4'.repeat(40),46630));assert.equal(stakeAfter(25n,10n),35n);assert.equal(stakeAfter(25n,null),null);});
test('position pages reject a market already committed by an earlier page',()=>{assert.throws(()=>validateStakePositions([position],address,46630,new Set([market])),/identity mismatch/);});
test('position display rejects duplicate markets and malformed raw amounts',()=>{
  const p=position;
  assert.throws(()=>validateStakePositions([p,p],address,46630));
  assert.throws(()=>validateStakePositions([{...p,active:'1e1'}],address,46630));
  assert.throws(()=>validateStakePositions([p],address,4663));
});
test('position display validates free, claimable, timestamps and source against the page snapshot',()=>{
  assert.equal(validateStakePositions([position],address,46630,new Set(),{blockNumber:'10',blockHash:source.blockHash}).length,1);
  assert.throws(()=>validateStakePositions([{...position,free:'-1'}],address,46630),/amount invalid/);
  assert.throws(()=>validateStakePositions([{...position,activationAt:'1e3'}],address,46630),/timestamp invalid/);
  assert.throws(()=>validateStakePositions([{...position,claimable:[position.claimable[1],position.claimable[0]] as unknown as UserPositionReadModel['claimable']}],address,46630),/claimable unavailable/);
  assert.throws(()=>validateStakePositions([{...position,claimable:[{...position.claimable[0],amount:'-1'},position.claimable[1]]}],address,46630),/claimable invalid/);
  assert.throws(()=>validateStakePositions([{...position,source:{...source,transactionHash:'bad' as `0x${string}`}}],address,46630),/source invalid/);
  assert.throws(()=>validateStakePositions([position],address,46630,new Set(),{blockNumber:'9',blockHash:source.blockHash}),/exceeds snapshot/);
  assert.throws(()=>validateStakePositions([position],address,46630,new Set(),{blockNumber:'10',blockHash:('0x'+'7'.repeat(64)) as `0x${string}`}),/exceeds snapshot/);
});
