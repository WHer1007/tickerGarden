import {test} from 'node:test';
import assert from 'node:assert/strict';
import {tradeStatusLabel} from '../src/ui/trade-transaction-status.ts';
const context={side:'buy' as const,symbol:'BLOOM',inputSymbol:'TSLA'};
test('generic transaction stages retain approval identity',()=>{
 assert.equal(tradeStatusLabel('pending',true,context),'Approval Pending · TSLA');
 assert.equal(tradeStatusLabel('confirmed',true,context),'Approval Confirmed · TSLA');
 assert.equal(tradeStatusLabel('failed',true,context),'Approval Failed · TSLA');
});
test('buy and sell show traded token independently of approval asset',()=>{
 assert.equal(tradeStatusLabel('confirmed',false,context),'Buy Confirmed · BLOOM');
 assert.equal(tradeStatusLabel('submitted',false,{...context,side:'sell'}),'Sell Submitted · BLOOM');
});
