import test from 'node:test';
import assert from 'node:assert/strict';
import { RPC_METHOD_CU, RollingCuLimiter, rpcMethodCost } from './rpc-cu-budget.mjs';

test('allows only the conservative known RPC methods at 500 CU', () => {
  assert.deepEqual(Object.values(RPC_METHOD_CU), Array(17).fill(500));
  for (const method of Object.keys(RPC_METHOD_CU)) assert.equal(rpcMethodCost(method), 500);
  assert.equal(rpcMethodCost('eth_sign'), undefined);
});

test('serializes concurrent callers and waits for the rolling boundary', async () => {
  let now = 0;
  const sleeps = [];
  const limiter = new RollingCuLimiter({ maxCu: 1_000, now: () => now, sleep: async ms => { sleeps.push(ms); now += ms; } });
  const order = [];
  const calls = [1, 2, 3].map((_, i) => limiter.acquire(500).then(() => order.push(i)));
  await Promise.all(calls);
  assert.deepEqual(order, [0, 1, 2]);
  assert.deepEqual(sleeps, [1_000]);
});

test('uses a sliding boundary and admits exactly when the oldest charge expires', async () => {
  let now = 0;
  let wake;
  const limiter = new RollingCuLimiter({ maxCu: 1_000, now: () => now, sleep: ms => new Promise(resolve => { wake = () => { now += ms; resolve(); }; }) });
  await limiter.acquire(500);
  await limiter.acquire(500);
  const pending = limiter.acquire(500);
  await Promise.resolve();
  assert.equal(typeof wake, 'function');
  wake();
  await pending;
  assert.equal(now, 1_000);
});

test('rejects invalid, fractional, and oversized costs without charging', async () => {
  const limiter = new RollingCuLimiter();
  for (const cost of [0, -1, 1.5, NaN, Infinity, 10_001]) {
    await assert.rejects(limiter.acquire(cost), RangeError);
  }
  await limiter.acquire(10_000);
});
