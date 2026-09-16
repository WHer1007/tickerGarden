import assert from 'node:assert/strict';
import test from 'node:test';
import { tradingRoute, stakerClaimHelp, rewardTab } from '../src/v1/flowUx.ts';

test('phase and canonical flags must agree; no phantom graduation route', () => {
  assert.equal(tradingRoute(0,{curveTradingEnabled:true,poolTradingEnabled:false}),'curve');
  assert.equal(tradingRoute(1,{curveTradingEnabled:false,poolTradingEnabled:true}),'pool');
  assert.equal(tradingRoute(0,{curveTradingEnabled:false,poolTradingEnabled:true}),null);
  assert.equal(tradingRoute(1,{curveTradingEnabled:true,poolTradingEnabled:false}),null);
  assert.equal(tradingRoute(2,{curveTradingEnabled:true,poolTradingEnabled:true}),null);
});

test('staker help distinguishes locks, cleanup, conversion, empty and claimable', () => {
  const state={allocated:10n,unlockAt:200n,now:100n,settlementPrincipal:0n,quoteClaimable:3n,memeClaimable:0n};
  assert.match(stakerClaimHelp(state),/unlock/);
  assert.match(stakerClaimHelp({...state,settlementPrincipal:10n}),/cleanup/);
  assert.match(stakerClaimHelp({...state,now:200n}),/ready to claim/);
  assert.match(stakerClaimHelp({...state,allocated:0n}),/ready to claim/);
  assert.equal(stakerClaimHelp({...state,now:200n,quoteClaimable:0n,memeClaimable:1n}),'Created-token rewards are available to claim.');
  assert.match(stakerClaimHelp({...state,now:200n,quoteClaimable:0n}),/No rewards/);
});

test('reward page polling selects exactly one visible role', () => {
  for(const name of ['positions','staker','creator','treasury','activity'])assert.equal(rewardTab('#'+name),name);
  assert.equal(rewardTab('#untrusted'),'positions');
});
