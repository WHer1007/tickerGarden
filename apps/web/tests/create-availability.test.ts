import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDisabledReason, createDisabledLevel, createReady, type CreateAvailability } from '../src/v1/createAvailability.ts';

const available = (overrides: Partial<CreateAvailability> = {}): CreateAvailability => ({
  submitting: false, imageReading: false, imageReady: true, runtimeReady: true, runtimeReason: '',
  walletConnected: true, busy: false, pendingQuote: false, metadataReady: true,
  buyMode: false, fundingReady: false, insufficientEth: false, ...overrides,
});

test('complete valid create is enabled', () => assert.equal(createDisabledReason(available()), null));
test('missing fields and unavailable prerequisites explain the first blocker', () => {
  assert.equal(createDisabledReason(available({invalidField: 'token name'})), 'Check token name.');
  assert.equal(createDisabledReason(available({walletConnected: false})), 'Connect your wallet.');
  assert.equal(createDisabledReason(available({runtimeReady: false, runtimeReason: 'This runtime is outdated.'})), 'This runtime is outdated.');
  assert.equal(createDisabledReason(available({pendingQuote: true})), 'Select an active paired asset.');
});
test('developer buy requires preview and sufficient ETH', () => {
  assert.equal(createDisabledReason(available({buyMode: true, fundingReady: false})), 'Buy preview failed. Retry or remove Developer buy.');
  assert.equal(createDisabledReason(available({buyMode: true, fundingReady: true, insufficientEth: true})), 'Insufficient ETH');
});
test('create mode does not depend on optional buy funding', () => assert.equal(createDisabledReason(available({fundingReady: false, insufficientEth: false})), null));
test('submission and image loading take priority over other states', () => {
  assert.equal(createDisabledReason(available({submitting: true, imageReading: true, runtimeReady: false})), 'Launching…');
  assert.equal(createDisabledReason(available({imageReading: true, runtimeReady: false})), 'Loading image…');
});

test('notice levels distinguish normal progress from launch blockers',()=>{
  assert.equal(createDisabledLevel(available()),'info');
  assert.equal(createDisabledLevel(available({submitting:true,runtimeReady:false})),'info');
  assert.equal(createDisabledLevel(available({imageReading:true})),'info');
  assert.equal(createDisabledLevel(available({busy:true})),'info');
  for(const state of [{walletConnected:false},{runtimeReady:false},{invalidField:'Name'},{pendingQuote:true},{metadataReady:false},{buyMode:true,fundingReady:false},{buyMode:true,fundingReady:true,insufficientEth:true}])assert.equal(createDisabledLevel(available(state)),'error');
});

test('known insufficient ETH blocks launch even without a developer buy',()=>{
  const state=available({buyMode:false,fundingReady:true,insufficientEth:true});
  assert.equal(createDisabledReason(state),'Insufficient ETH');
  assert.equal(createDisabledLevel(state),'error');
  assert.equal(createReady(state,true),false);
});
test('successful preview cannot show ready alongside a launch blocker',()=>{
  const state=available({fundingReady:true});
  assert.equal(createReady(state,true),true);
  assert.equal(createReady(state,false),false);
  assert.equal(createReady(state,true,true),false);
  for(const override of [{submitting:true},{imageReading:true},{walletConnected:false},{runtimeReady:false},{busy:true},{pendingQuote:true},{invalidField:'Name'},{metadataReady:false},{fundingReady:false},{insufficientEth:true}]){
    assert.equal(createReady({...state,...override},true),false,JSON.stringify(override));
  }
});

test('a missing or failed image blocks publishing and the ready state',()=>{
 const state=available({imageReady:false,fundingReady:true});
 assert.equal(createDisabledReason(state),'Add a token image.');
 assert.equal(createDisabledLevel(state),'error');
 assert.equal(createReady(state,true),false);
});
