import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createInvalidatedRead, InvalidatedReadClearedError} from '../src/ui/invalidated-read.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

function nextTurn() {
  return new Promise<void>(resolve => setImmediate(resolve));
}

test('same-key reads coalesce and invalidation waits for a fresh result', async () => {
  const reads = createInvalidatedRead<string, string>();
  const first = deferred<string>();
  const followup = deferred<string>();
  let calls = 0;
  const loader = () => (++calls === 1 ? first.promise : followup.promise);
  const a = reads.read('token', loader);
  const b = reads.read('token', loader);
  await Promise.resolve();
  assert.equal(calls, 1);
  reads.invalidate('token');
  first.resolve('stale');
  await nextTurn();
  assert.equal(calls, 2);
  followup.resolve('fresh');
  assert.deepEqual(await Promise.all([a, b]), ['fresh', 'fresh']);
});

test('a burst of invalidations during a load collapses to one follow-up', async () => {
  const reads = createInvalidatedRead<string, number>();
  const first = deferred<number>();
  const second = deferred<number>();
  let calls = 0;
  const request = reads.read('x', () => (++calls === 1 ? first.promise : second.promise));
  await Promise.resolve();
  reads.invalidate('x');
  reads.invalidate('x');
  reads.invalidate('x');
  first.resolve(1);
  await nextTurn();
  assert.equal(calls, 2);
  second.resolve(2);
  assert.equal(await request, 2);
  assert.equal(calls, 2);
});

test('invalidation is scoped to its key', async () => {
  const reads = createInvalidatedRead<string, string>();
  const x1 = deferred<string>();
  const x2 = deferred<string>();
  const y = deferred<string>();
  let xCalls = 0;
  let yCalls = 0;
  const x = reads.read('x', () => (++xCalls === 1 ? x1.promise : x2.promise));
  const yRead = reads.read('y', () => { yCalls++; return y.promise; });
  await Promise.resolve();
  reads.invalidate('x');
  x1.resolve('old x');
  y.resolve('y');
  await nextTurn();
  assert.equal(yCalls, 1);
  assert.equal(xCalls, 2);
  x2.resolve('new x');
  assert.deepEqual(await Promise.all([x, yRead]), ['new x', 'y']);
});

test('current-generation failures propagate and a later read can retry', async () => {
  const reads = createInvalidatedRead<string, string>();
  const failure = new Error('offline');
  let calls = 0;
  await assert.rejects(reads.read('x', () => {
    calls++;
    return Promise.reject(failure);
  }), failure);
  assert.equal(await reads.read('x', () => {
    calls++;
    return Promise.resolve('recovered');
  }), 'recovered');
  assert.equal(calls, 2);
});

test('clear cancels old callers and a reselected key uses only its new request', async () => {
  const reads = createInvalidatedRead<string, string>();
  const stale = deferred<string>();
  let oldCalls = 0;
  const oldRead = reads.read('x', () => { oldCalls++; return stale.promise; });
  await Promise.resolve();
  reads.clear();
  await assert.rejects(oldRead, InvalidatedReadClearedError);

  let newCalls = 0;
  const newRead = reads.read('x', () => { newCalls++; return Promise.resolve('new'); });
  assert.equal(await newRead, 'new');
  stale.resolve('stale');
  await Promise.resolve();
  assert.equal(oldCalls, 1);
  assert.equal(newCalls, 1);
  assert.equal(await reads.read('x', () => Promise.resolve('unexpected')), 'unexpected');
});
