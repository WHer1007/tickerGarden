import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadAdmission } from '../../apps/read-api/src/read-admission.ts';
import type { Pool } from 'pg';
import { analyticsReadKey, createReadApiApp } from '../../apps/read-api/src/index.ts';

const deployment = { environment: 'test' as const, chainId: 46630 as const, deploymentDigest: '0x' + 'a'.repeat(64) as `0x${string}`, activationBlock: 1n };
function request(query: Record<string, string>, headers: Record<string, string> = {}) {
  return { req: { query: () => query, header: (name: string) => headers[name] } } as never;
}

test('analytics route keys isolate revision, query parameters, and user identity', () => {
  const market = '0x' + 'b'.repeat(64);
  const base = analyticsReadKey('detail', request({ period: '1D', revision: '1:0x' + 'c'.repeat(64) }, { authorization: 'Bearer one' }), deployment, market);
  assert.equal(base.includes('Bearer one'), false);
  assert.notEqual(base, analyticsReadKey('detail', request({ period: '1D', revision: '2:0x' + 'd'.repeat(64) }, { authorization: 'Bearer one' }), deployment, market));
  assert.notEqual(base, analyticsReadKey('detail', request({ period: '1H', revision: '1:0x' + 'c'.repeat(64) }, { authorization: 'Bearer one' }), deployment, market));
  assert.notEqual(base, analyticsReadKey('detail', request({ period: '1D', revision: '1:0x' + 'c'.repeat(64) }, { authorization: 'Bearer two' }), deployment, market));
  assert.equal(base, analyticsReadKey('detail', request({ revision: '1:0x' + 'c'.repeat(64), period: '1D' }, { authorization: 'Bearer one' }), deployment, market));
});

test('read admission coalesces pending work, bounds distinct reads and resumes after failure', async () => {
  const read = createReadAdmission({concurrency: 1, maxPending: 1, unavailable: () => new Error('busy')});
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const calls: string[] = [];
  const first = read('a', async () => { calls.push('a'); await gate; throw new Error('database'); });
  const duplicate = read('a', async () => 99);
  assert.equal(first, duplicate);
  const second = read('b', async () => { calls.push('b'); return 2; });
  assert.equal(second, read('b', async () => 88));
  await assert.rejects(read('c', async () => 3), /busy/);
  assert.deepEqual(calls, ['a']);
  const failed = assert.rejects(first, /database/);
  finish(); await failed;
  assert.equal(await second, 2);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await read('a', async () => 4), 4);
  assert.deepEqual(calls, ['a', 'b']);
});


test('analytics HTTP routes share pending database reads, isolate users, and retry failures', async () => {
  for (const suffix of ['trades?from=0&to=60', 'candles?interval=1m&from=0&to=60', 'holders', 'detail']) {
    let connects = 0;
    let release!: () => void;
    let gate = new Promise<void>(resolve => { release = resolve; });
    const pool = { connect: async () => {
      connects++;
      await gate;
      return { query: async () => ({ rows: [] }), release() {} };
    } } as unknown as Pool;
    const app = createReadApiApp({ pool, deployment, env: {
      NODE_ENV: 'test', TG_READ_DATABASE_URL: 'postgres://unused',
      TG_CURSOR_SECRET: 'read-api-test-secret-that-is-at-least-32-bytes',
    } });
    const path = `/v1/markets/0x${'b'.repeat(64)}/${suffix}`;
    const pending = [app.request(path), app.request(path)];
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(connects, 1, suffix);
    release();
    for (const response of await Promise.all(pending)) assert.equal(response.status, 503);
    await app.request(path);
    assert.equal(connects, 2, 'failed read must be retried');
    gate = new Promise<void>(resolve => { release = resolve; });
    const isolated = ['one', 'two'].map(user => app.request(path, { headers: { authorization: `Bearer ${user}` } }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(connects, 4, 'different users must not share a pending read');
    release();
    await Promise.all(isolated);
  }
});
