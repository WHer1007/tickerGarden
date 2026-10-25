import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createDatabasePool, applyCoreMigration } from '../../packages/db/src/index.ts';
import { retainQueueHistory } from '../../packages/jobs/src/retention.ts';
import type { Pool } from 'pg';

test('queue retention handles a populated history within the normal SQL deadline', { timeout: 120_000 }, async context => {
  const url = process.env.TG_TEST_DATABASE_URL;
  if (!url) { context.skip('local PostgreSQL required'); return; }
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname), 'scale fixture requires loopback PostgreSQL');
  const name = `tg_retention_scale_${randomBytes(6).toString('hex')}`;
  const s = `"${name}"`;
  const { pool } = createDatabasePool(url, { max: 2 });
  try {
    await applyCoreMigration(pool, name);
    // Scrubbed job/outbox bodies still retain identities; inboxes can lag behind.
    await pool.query(`INSERT INTO ${s}.jobs(operation_id,queue,kind,payload_digest,payload,state,updated_at)
      SELECT 'history-'||n,'chain','chain-backfill','0x'||lpad(to_hex(n),64,'0'),'{}','succeeded',now()-interval '100 days'
      FROM generate_series(1,30000) n`);
    await pool.query(`INSERT INTO ${s}.outbox_messages(operation_id,queue,destination_key,payload_digest,payload,state)
      SELECT operation_id,queue,'chain-worker',payload_digest,'{}','sent' FROM ${s}.jobs`);
    await pool.query(`INSERT INTO ${s}.inbox_messages(queue,external_id,payload_digest,raw_body,state,received_at)
      SELECT queue,operation_id,payload_digest,'retained body','processed',now()-interval '100 days' FROM ${s}.jobs`);
    await pool.query(`INSERT INTO ${s}.job_attempts(job_id,queue,fencing,attempt,outcome,started_at)
      SELECT id,queue,1,1,'succeeded',now()-interval '100 days' FROM ${s}.jobs`);
    for (const table of ['jobs', 'outbox_messages', 'inbox_messages', 'job_attempts']) await pool.query(`ANALYZE ${s}.${table}`);
    const started = performance.now();
    const statements: Array<{sql: string; values: unknown[] | undefined}> = [];
    const recordingPool = { connect: async () => {
      const client = await pool.connect();
      return { release: (destroy?: boolean) => client.release(destroy), query: async (sql: string, values?: unknown[]) => {
        if (sql.includes('WITH selected')) statements.push({sql, values});
        return client.query(sql, values);
      } };
    } } as unknown as Pool;
    const result = await retainQueueHistory(recordingPool, name);
    context.diagnostic(`30,000 histories, 200-row batch: ${Math.round(performance.now()-started)} ms`);
    assert.deepEqual(result, { acquired: true, jobsPayloadsCleared: 0, outboxPayloadsCleared: 0, inboxBodiesCleared: 200, attemptsDeleted: 200 });
    const inbox = statements.find(statement => statement.sql.includes('UPDATE '+s+'.inbox_messages'))!;
    const plan = await pool.query(`EXPLAIN (FORMAT JSON) ${inbox.sql}`, inbox.values);
    assert.match(JSON.stringify(plan.rows), /outbox_retention_unsent/, 'inbox eligibility probes must use the unsent lookup index on populated history');
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);
    await pool.end();
  }
});
