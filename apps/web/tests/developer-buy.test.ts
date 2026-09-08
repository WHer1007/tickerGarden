import assert from 'node:assert/strict';
import test from 'node:test';

import { DeveloperBuyBalanceCache, developerBuyNotice } from '../src/create/developer-buy.ts';

test('coalesces concurrent reads for the same account and asset key', async () => {
  let calls = 0;
  const cache = new DeveloperBuyBalanceCache(() => 1_000);
  const reader = async () => { calls += 1; await Promise.resolve(); return 7n; };
  const [first, second] = await Promise.all([cache.read('account-a:asset-x', reader), cache.read('account-a:asset-x', reader)]);
  assert.equal(first, 7n);
  assert.equal(second, 7n);
  assert.equal(calls, 1);
});

test('keeps different account and asset keys independent', async () => {
  const seen: string[] = [];
  const cache = new DeveloperBuyBalanceCache(() => 1_000);
  const read = (key: string, value: bigint) => cache.read(key, async () => { seen.push(key); return value; });
  assert.equal(await read('account-a:asset-x', 1n), 1n);
  assert.equal(await read('account-b:asset-x', 2n), 2n);
  assert.equal(await read('account-a:asset-y', 3n), 3n);
  assert.deepEqual(seen, ['account-a:asset-x', 'account-b:asset-x', 'account-a:asset-y']);
});

test('refreshes a cached read after the 30 second expiry', async () => {
  let now = 1_000;
  let calls = 0;
  const cache = new DeveloperBuyBalanceCache(() => now);
  const reader = async () => BigInt(++calls);
  assert.equal(await cache.read('key', reader), 1n);
  now = 30_999;
  assert.equal(await cache.read('key', reader), 1n);
  now = 31_000;
  assert.equal(await cache.read('key', reader), 2n);
  assert.equal(calls, 2);
});

test('caches a failed read as null, then retries after expiry', async () => {
  let now = 1_000;
  let calls = 0;
  const cache = new DeveloperBuyBalanceCache(() => now);
  const reader = async () => { calls += 1; if (calls === 1) throw new Error('unavailable'); return 9n; };
  assert.equal(await cache.read('key', reader), null);
  assert.equal(await cache.read('key', reader), null);
  assert.equal(calls, 1);
  now = 31_000;
  assert.equal(await cache.read('key', reader), 9n);
  assert.equal(calls, 2);
});

test('preserves a zero balance as zero', async () => {
  const cache = new DeveloperBuyBalanceCache(() => 1_000);
  assert.equal(await cache.read('zero', async () => 0n), 0n);
});

test('developer buy notice is empty when balance is sufficient or equal', () => {
  const input = { amount: 10n, balance: 10n, symbol: 'USDC', displayAmount: '10', native: false, autoBuy: true };
  assert.equal(developerBuyNotice(input), '');
  assert.equal(developerBuyNotice({ ...input, balance: 11n }), '');
});

test('native deficit explains that automatic purchase is unavailable', () => {
  const notice = developerBuyNotice({ amount: 2n, balance: 1n, symbol: 'ETH', displayAmount: '2', native: true, autoBuy: true });
  assert.match(notice, /Insufficient ETH/);
  assert.match(notice, /Add ETH/);
  assert.doesNotMatch(notice, /we’ll use ETH/);
});

test('token deficit without a route is unavailable', () => {
  const notice = developerBuyNotice({ amount: 10n, balance: 1n, symbol: 'USDC', displayAmount: '10', native: false, autoBuy: false });
  assert.match(notice, /Insufficient USDC/);
  assert.match(notice, /Automatic purchase is unavailable/);
});

test('token deficit with a route states the full ETH funded purchase', () => {
  const notice = developerBuyNotice({ amount: 10n, balance: 1n, symbol: 'USDC', displayAmount: '10.00', native: false, autoBuy: true });
  assert.match(notice, /use ETH to buy the full 10\.00 USDC/);
  assert.match(notice, /launch fee and gas/);
});
