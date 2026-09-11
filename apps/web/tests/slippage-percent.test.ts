import assert from 'node:assert/strict';
import test from 'node:test';
import {slippagePercentToBps} from '../src/v1/slippage.ts';
import {minimumAfterSlippage} from '../src/runtime/model.ts';
test('percentage inputs preserve exact slippage and minimum received',()=>{
 for(const [percent,bps] of [['0',0],['0.5',50],['0.29',29],['0.01',1],['1',100],['50',5000]] as const)assert.equal(slippagePercentToBps(percent),bps);
 assert.equal(minimumAfterSlippage(10000n,slippagePercentToBps('0.5')),9950n);
});
test('rejects unsupported precision and values outside the previous limit',()=>{
 for(const value of ['', '-1','50.01','100','0.001','1e1','NaN'])assert.throws(()=>slippagePercentToBps(value));
});
