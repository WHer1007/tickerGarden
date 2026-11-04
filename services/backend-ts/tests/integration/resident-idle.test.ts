import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { applyCoreMigration, createDatabasePool } from '../../packages/db/src/index.ts';
import { advanceQueueGeneration, claimJobs, completeJob, enqueueReliableMessage, setQueueExecutionMode, sha256 } from '../../packages/jobs/src/index.ts';
import { createWorkerState, runResidentWorker } from '../../packages/chain-worker/src/resident.ts';

async function fixture(ctx: TestContext) {
  const url = process.env.TG_TEST_DATABASE_URL;
  if (!url) { ctx.skip('TG_TEST_DATABASE_URL is required'); return; }
  const schemaName = `tg_resident_idle_${randomBytes(6).toString('hex')}`;
  const pool = createDatabasePool(url, { max: 2 }).pool;
  const controlPool = createDatabasePool(url, { max: 1 }).pool;
  const signal = AbortSignal.timeout(10_000);
  const state = createWorkerState();
  await applyCoreMigration(pool, schemaName);
  await setQueueExecutionMode(pool, 'resident', 0n, schemaName);
  ctx.after(async () => {
    await pool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
    await Promise.all([pool.end(), controlPool.end()]);
  });
  const enqueue = (id: string) => enqueueReliableMessage(pool, {
    queue: 'chain', externalId: id, operationId: id, kind: 'test-job', rawBody: '{}', payload: {},
    destinationKey: 'chain-worker', maxAttempts: 2, generation: 0n,
  }, schemaName);
  const input = { pool, controlPool, schemaName, owner: 'idle-test', generation: 0n, signal, state, pollMs: 10, fatal: (e: Error) => { throw e; } };
  return { url, pool, schemaName, enqueue, input };
}

async function until(predicate: () => boolean) {
  for (let i = 0; i < 500; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw Error('worker did not reach expected state');
}

// Interleave a real database change after a snapshot has been read, before the
// worker sees it. This verifies the hint cannot replace the write-path fences.
function afterSnapshot(ctx: TestContext, pool: Pool, after: () => Promise<void>) {
  const query = pool.query;
  let called = false;
  ctx.mock.method(pool, 'query', function (this: Pool, ...args: unknown[]) {
    const result = Reflect.apply(query, this, args);
    if (!called && typeof args[0] === 'string' && args[0].includes(' AS due,')) {
      called = true;
      return result.then(async (rows: unknown) => { await after(); return rows; });
    }
    return result;
  });
}

test('idle resident uses read-only transactions and sees a mode switch without processing', { timeout: 15_000 }, async ctx => {
  const f = await fixture(ctx); if (!f) return;
  // PostgreSQL rejects SELECT FOR SHARE/UPDATE and all writes on this pool.
  const readOnly = createDatabasePool(f.url, { max: 1, options: '-c default_transaction_read_only=on -c statement_timeout=5000' }).pool;
  const stop = new AbortController(); let processed = 0;
  const run = runResidentWorker({ ...f.input, pool: readOnly, signal: stop.signal, process: async () => { processed++; return ''; } });
  try {
    await until(() => f.input.state.lastPollAt > 0);
    const firstPoll = f.input.state.lastPollAt;
    await until(() => f.input.state.lastPollAt > firstPoll + 30);
    assert.equal(f.input.state.ready, true);
    await setQueueExecutionMode(f.pool, 'qstash', 0n, f.schemaName);
    await run;
    assert.equal(processed, 0);
    assert.equal(f.input.state.ready, false);
  } finally { stop.abort(); await run; await readOnly.end(); }
});

test('job arriving after an empty snapshot is consumed once on the next poll', { timeout: 15_000 }, async ctx => {
  const f = await fixture(ctx); if (!f) return;
  afterSnapshot(ctx, f.pool, async () => { await f.enqueue('late'); });
  const seen: string[] = [];
  await runResidentWorker({ ...f.input, maxJobs: 1, process: async lease => { seen.push(lease.operationId); assert.equal(lease.attempt, 1); return 'ok'; } });
  assert.deepEqual(seen, ['late']);
  assert.equal(f.input.state.succeeded, 1);
  const rows = await f.pool.query(`SELECT j.state,o.state outbox_state FROM "${f.schemaName}".jobs j JOIN "${f.schemaName}".outbox_messages o USING(operation_id)`);
  assert.deepEqual(rows.rows, [{ state: 'succeeded', outbox_state: 'sent' }]);
});

test('expired retryable lease is recovered and the previous owner remains fenced', { timeout: 15_000 }, async ctx => {
  const f = await fixture(ctx); if (!f) return;
  await f.enqueue('expired');
  const old = (await claimJobs(f.pool, 'chain', 'old', 1, 1000, f.schemaName, 0n, 'resident'))[0]!;
  await f.pool.query(`UPDATE "${f.schemaName}".jobs SET lease_expires_at=now()-interval '1 second' WHERE id=$1`, [old.id]);
  let processed = 0;
  await runResidentWorker({ ...f.input, maxJobs: 1, process: async lease => {
    processed++; assert.equal(lease.attempt, 2); assert.ok(BigInt(lease.fencing) > BigInt(old.fencing));
    assert.equal(await completeJob(f.pool, old, 'old', sha256('stale'), f.schemaName), false);
    return 'recovered';
  } });
  assert.equal(processed, 1); assert.equal(f.input.state.succeeded, 1);
});

test('positive work hint cannot bypass a concurrent mode switch', { timeout: 15_000 }, async ctx => {
  const f = await fixture(ctx); if (!f) return;
  await f.enqueue('due');
  afterSnapshot(ctx, f.pool, () => setQueueExecutionMode(f.pool, 'qstash', 0n, f.schemaName));
  let processed = 0;
  await runResidentWorker({ ...f.input, process: async () => { processed++; return ''; } });
  assert.equal(processed, 0);
  const row = (await f.pool.query(`SELECT state,attempt FROM "${f.schemaName}".jobs`)).rows[0];
  assert.deepEqual(row, { state: 'pending', attempt: 0 });
});

test('idle resident exits on generation advance and after cancellation of a snapshot', { timeout: 15_000 }, async ctx => {
  const f = await fixture(ctx); if (!f) return;
  afterSnapshot(ctx, f.pool, () => advanceQueueGeneration(f.pool, 'chain', 0n, 1n, f.schemaName));
  let processed = 0;
  await runResidentWorker({ ...f.input, process: async () => { processed++; return ''; } });
  assert.equal(processed, 0); assert.equal(f.input.state.ready, false);
  ctx.mock.restoreAll();
  const stop = new AbortController();
  afterSnapshot(ctx, f.pool, async () => { stop.abort(); });
  await runResidentWorker({ ...f.input, generation: 1n, state: createWorkerState(), signal: stop.signal, process: async () => { processed++; return ''; } });
  assert.equal(processed, 0);
});
