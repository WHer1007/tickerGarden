import assert from 'node:assert/strict';
import { test } from 'node:test';
import { approvedQuoteMinimum, gasReserve, quotedMinimum, spendableNative } from '../src/v1/tradeProtection.ts';

test('quotedMinimum accepts the exact quoted output as the floor', () => {
  assert.equal(quotedMinimum(123n), 123n);
  assert.throws(() => quotedMinimum(0n), /Amount too small/);
});

test('approvedQuoteMinimum keeps the accepted floor and rejects a lower fresh quote', () => {
  assert.equal(approvedQuoteMinimum({ minimum: 100n }, { output: 100n }), 100n);
  assert.equal(approvedQuoteMinimum({ minimum: 100n }, { output: 125n }), 100n);
  assert.throws(() => approvedQuoteMinimum({ minimum: 100n }, { output: 99n }), /updated quote/);
});

test('gasReserve rounds the 20 percent reserve upward', () => {
  assert.equal(gasReserve(100n, 3n), 360n);
  assert.equal(gasReserve(1n, 1n), 2n);
  assert.throws(() => gasReserve(0n, 1n), /fee could not be estimated/);
});

test('spendableNative never spends the gas reserve', () => {
  assert.equal(spendableNative(1_000n, 360n), 640n);
  assert.equal(spendableNative(360n, 360n), 0n);
  assert.equal(spendableNative(100n, 360n), 0n);
});
