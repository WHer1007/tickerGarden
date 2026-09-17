import test from 'node:test';
import assert from 'node:assert/strict';
import {changedRegions,changeChannel,regions} from '../../packages/confirmed-display/src/changes.ts';
import type {DisplayState} from '../../packages/confirmed-display/src/state.ts';
const state={market:{display:{totalStakedRaw:'1',activeStakeRaw:'0',priceQuote:'1',blockNumber:'1'}},trades:[],balances:{},fees:[],supply:'100'} as unknown as DisplayState;
test('notifications distinguish regions and ignore source stamps',()=>{
 assert.deepEqual(changedRegions(null,state),[...regions]);
 assert.deepEqual(changedRegions(state,{...state,market:{...state.market,display:{...state.market.display!,blockNumber:'2'}}}),[]);
 assert.ok(changedRegions(state,{...state,market:{...state.market,display:{...state.market.display!,activeStakeRaw:'1'}}}).includes('staking'));
 assert.deepEqual(changedRegions(state,{...state,balances:{'a':'2'}}),['holders','statistics']);
});
test('notification channels isolate deployments and schemas',()=>{
 const d={environment:'test',chainId:46630,deploymentDigest:'0xa',activationBlock:1n} as const;
 assert.notEqual(changeChannel(d),changeChannel({...d,environment:'production'}));
 assert.notEqual(changeChannel(d,'local'),changeChannel(d,'test'));
 assert.match(changeChannel(d),/^tg_display_[0-9a-f]{32}$/);
});
