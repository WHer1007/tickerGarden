import assert from 'node:assert/strict';
import { test } from 'node:test';
import { developerBuyMode, graduationAmount, graduationEconomics } from '../src/create/economics.ts';

test('native 4.2 ETH is net curve funding, with canonical integer partition rounding', () => {
  const result = graduationEconomics(1_000_000_000n * 10n ** 18n, 168n * 10n ** 16n, 42n * 10n ** 17n);
  assert.equal(result.reserved, 285714285714285714285714285n);
  assert.equal(result.requiredNet, 4200000000000000001n);
  assert.equal(graduationAmount(result.threshold, 18).display, '4.2');
  assert.equal(graduationAmount(result.requiredNet, 18).exact, '4.200000000000000001');
});
test('exact division uses ceiling, not unconditional plus one', () => {
  assert.equal(graduationEconomics(1000n, 20n, 80n).requiredNet, 80n);
});
test('paired units support six and eighteen decimals without floating point', () => {
  assert.equal(graduationAmount(4200000000n, 6).display, '4200');
  assert.equal(graduationAmount(4200000000000000000n, 18).display, '4.2');
  assert.equal(graduationAmount(1000000000001n, 18).display, '≈ 0.000001');
  assert.throws(() => graduationAmount(0n, 18));
  assert.throws(() => graduationAmount(1n, 19));
  assert.throws(() => graduationEconomics(1n, 1n, 1n));
});
test('developer buy derives launch action and rejects malformed amounts', () => {
  for (const amount of ['', '0', '0.00']) assert.equal(developerBuyMode(amount), 'create');
  for (const amount of ['1', '0.0001']) assert.equal(developerBuyMode(amount), 'create-buy');
  for (const amount of ['-1', '1e3', 'NaN', '.1', '01']) assert.throws(() => developerBuyMode(amount));
});
