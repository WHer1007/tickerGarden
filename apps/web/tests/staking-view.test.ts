import assert from 'node:assert/strict';import test from 'node:test';
import {allocatedFeeTotals,validateStakePositions,stakeHistoryEvent,stakeAfter} from '../src/v1/stakingView.ts';
import type {TokenDetailFee,UserActivityRecord,UserPositionReadModel} from '../src/v1/generated/read-api.ts';
const address=('0x'+'1'.repeat(40)) as `0x${string}`,market=('0x'+'2'.repeat(64)) as `0x${string}`,asset=('0x'+'3'.repeat(64)) as `0x${string}`;
test('fees remain asset separated and unavailable does not become zero',()=>{assert.equal(allocatedFeeTotals(null),null);const rows=[{asset:address,amountRaw:'9007199254740993000',recipient:'creator'},{asset:address,amountRaw:'3',recipient:'holders'},{asset:'0x'+'4'.repeat(40),amountRaw:'5',recipient:'stakers'}] as TokenDetailFee[];const sums=allocatedFeeTotals(rows)!;assert.equal(sums.size,2);assert.equal(sums.get(address),9007199254740993003n);});
test('stake history requires position owner and known event signature',()=>{const e={signature:'AllocationReleased(bytes32,address,bytes32,uint256,uint256,uint256)',arguments:{user:address,marketId:market,assetUid:asset,userMarketAllocation:'0'}} as unknown as UserActivityRecord;assert.equal(stakeHistoryEvent(e,address)?.exited,true);assert.equal(stakeHistoryEvent(e,'0x'+'5'.repeat(40)),null);assert.equal(stakeHistoryEvent({...e,signature:'Transfer(address,address,uint256)'},address),null);});
test('position display rejects another account and inconsistent amounts',()=>{const p={user:address,marketId:market,assetUid:asset,allocated:'12',active:'10',pending:'2',source:{chainId:46630}} as UserPositionReadModel;assert.equal(validateStakePositions([p],address,46630).length,1);assert.throws(()=>validateStakePositions([{...p,allocated:'15'}],address,46630));assert.throws(()=>validateStakePositions([p],'0x'+'4'.repeat(40),46630));assert.equal(stakeAfter(25n,10n),35n);assert.equal(stakeAfter(25n,null),null);});
test('position display rejects duplicate markets and malformed raw amounts',()=>{
  const p={user:address,marketId:market,assetUid:asset,allocated:'12',active:'10',pending:'2',source:{chainId:46630}} as UserPositionReadModel;
  assert.throws(()=>validateStakePositions([p,p],address,46630));
  assert.throws(()=>validateStakePositions([{...p,active:'1e1'}],address,46630));
  assert.throws(()=>validateStakePositions([p],address,4663));
});
