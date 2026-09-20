import assert from 'node:assert/strict';
import test from 'node:test';
import type { PoolClient, QueryResult } from 'pg';
import { createDatabasePool } from '../../packages/db/src/pool.ts';
import { databaseTimingSnapshot, withDatabaseTask } from '../../packages/db/src/telemetry.ts';

const connectionString = process.env.TG_MIGRATION_DATABASE_URL;
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

test('database pool telemetry measures promise, callback and queued connection paths', { timeout: 15_000 }, async (context) => {
  if (!connectionString) { context.skip('TG_MIGRATION_DATABASE_URL is required for local PostgreSQL'); return; }
  const pool = createDatabasePool(connectionString, { max: 1, connectionTimeoutMillis: 750 }).pool;
  try {
    let before = databaseTimingSnapshot();
    await withDatabaseTask('db-telemetry-test', 'pool_query', async () => {
      const result = await pool.query<{ answer: number }>('SELECT 1::int AS answer');
      assert.equal(result.rows[0]?.answer, 1);
    });
    let after = databaseTimingSnapshot();
    assert.equal(after.connectionCount - before.connectionCount, 1, 'pool.query acquires one client');
    assert.equal(after.queryCount - before.queryCount, 1, 'pool.query records one SQL round trip');

    before = after;
    await withDatabaseTask('db-telemetry-test', 'client_query', async () => {
      const client = await pool.connect();
      try {
        const result = await client.query<{ answer: number }>('SELECT 2::int AS answer');
        assert.equal(result.rows[0]?.answer, 2);
      } finally { client.release(); }
    });
    after = databaseTimingSnapshot();
    assert.equal(after.connectionCount - before.connectionCount, 1, 'pool.connect records one acquisition');
    assert.equal(after.queryCount - before.queryCount, 1, 'client.query records one SQL round trip');

    await withDatabaseTask('db-telemetry-test', 'callback_overloads', async () => {
      const client = await new Promise<PoolClient>((resolve, reject) => {
        pool.connect((error, connected, release) => {
          if (error) { reject(error); return; }
          assert.ok(connected);
          assert.equal(typeof release, 'function');
          // Release the client on assertion failures too, so the test pool cannot hang.
          resolve(Object.assign(connected, { __testRelease: release }));
        });
      });
      const release = (client as PoolClient & { __testRelease: (error?: Error | boolean) => void }).__testRelease;
      try {
        const result = await new Promise<QueryResult<{ answer: number }>>((resolve, reject) => {
          client.query<{ answer: number }>('SELECT 3::int AS answer', (error, value) => {
            if (error) reject(error); else resolve(value!);
          });
        });
        assert.equal(result.rows[0]?.answer, 3);

        const observed = await new Promise<Error>((resolve, reject) => {
          client.query('SELECT 1 / 0', (error) => {
            if (error) resolve(error); else reject(new Error('expected callback query failure'));
          });
        });
        assert.equal((observed as Error & { code?: string }).code, '22012');
      } finally { release(); }
    });

    // Hold the only client long enough to separate pool wait from a quick SELECT.
    const held = await pool.connect();
    before = databaseTimingSnapshot();
    const queued = withDatabaseTask('db-telemetry-test', 'queued_connect', async () => {
      const client = await pool.connect();
      try { assert.equal((await client.query<{ answer: number }>('SELECT 4::int AS answer')).rows[0]?.answer, 4); }
      finally { client.release(); }
    });
    await pause(120);
    held.release();
    await queued;
    after = databaseTimingSnapshot();
    const waitMs = after.connectionWaitMs - before.connectionWaitMs;
    const sqlMs = after.sqlMs - before.sqlMs;
    assert.equal(after.connectionCount - before.connectionCount, 1);
    assert.equal(after.queryCount - before.queryCount, 1);
    assert.ok(waitMs >= 60, `expected measurable queue wait, got ${waitMs}ms`);
    assert.ok(sqlMs >= 0 && sqlMs < waitMs, `short SELECT SQL (${sqlMs}ms) should be below pool wait (${waitMs}ms)`);

    const blocked=await pool.connect();
    before=databaseTimingSnapshot();
    try{await assert.rejects(withDatabaseTask('db-telemetry-test','connection_timeout',()=>pool.connect()),/timeout/i);}
    finally{blocked.release();}
    after=databaseTimingSnapshot();
    assert.equal(after.connectionTimeoutCount-before.connectionTimeoutCount,1);
    assert.equal(after.queryCount-before.queryCount,0);

    before = databaseTimingSnapshot();
    let timeoutError: (Error & { code?: string }) | undefined;
    await withDatabaseTask('db-telemetry-test', 'statement_timeout', async () => {
      await pool.query('SET statement_timeout = 20');
      try {
        await pool.query('SELECT pg_sleep(0.1)');
      } catch (error) {
        timeoutError = error as Error & { code?: string };
        throw error;
      }
    }).catch((error: unknown) => {
      assert.equal(error, timeoutError, 'the PostgreSQL timeout error is preserved');
    });
    assert.equal(timeoutError?.code, '57014');
    after = databaseTimingSnapshot();
    assert.equal(after.sqlTimeoutCount - before.sqlTimeoutCount, 1);
    assert.equal(after.connectionTimeoutCount - before.connectionTimeoutCount, 0);
    assert.equal(after.queryCount - before.queryCount, 2, 'SET and timed-out SQL are counted');
    const recovered = await pool.query<{ answer: number }>('SET statement_timeout = 0');
    assert.equal(recovered.command, 'SET');
    assert.equal((await pool.query<{ answer: number }>('SELECT 5::int AS answer')).rows[0]?.answer, 5);
  } finally {
    await pool.end();
  }
});
