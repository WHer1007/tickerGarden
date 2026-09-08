import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDisabledReason, type CreateAvailability } from '../src/v1/createAvailability.ts';

const available = (overrides: Partial<CreateAvailability> = {}): CreateAvailability => ({
  submitting: false, imageReading: false, runtimeReady: true, runtimeReason: '',
  walletConnected: true, busy: false, pendingQuote: false, metadataReady: true,
  buyMode: false, fundingReady: false, insufficientEth: false, ...overrides,
});

test('complete valid create is enabled', () => assert.equal(createDisabledReason(available()), null));
test('missing fields and unavailable prerequisites explain the first blocker', () => {
  assert.equal(createDisabledReason(available({invalidField: 'token name'})), 'Complete or correct token name to continue.');
  assert.equal(createDisabledReason(available({walletConnected: false})), 'Connect your wallet to continue.');
  assert.equal(createDisabledReason(available({runtimeReady: false, runtimeReason: 'This runtime is outdated.'})), 'This runtime is outdated.');
  assert.equal(createDisabledReason(available({pendingQuote: true})), 'Choose an activated paired asset.');
});
test('developer buy requires preview and sufficient ETH', () => {
  assert.equal(createDisabledReason(available({buyMode: true, fundingReady: false})), 'Developer buy preview is unavailable. Check the preview message, or clear Developer buy to launch without buying.');
  assert.equal(createDisabledReason(available({buyMode: true, fundingReady: true, insufficientEth: true})), 'Insufficient ETH for the developer buy, launch fee and gas.');
});
test('create mode does not depend on optional buy funding', () => assert.equal(createDisabledReason(available({fundingReady: false, insufficientEth: true})), null));
test('submission and image loading take priority over other states', () => {
  assert.equal(createDisabledReason(available({submitting: true, imageReading: true, runtimeReady: false})), 'Waiting for the launch transaction…');
  assert.equal(createDisabledReason(available({imageReading: true, runtimeReady: false})), 'Wait for the token image to finish loading.');
});
