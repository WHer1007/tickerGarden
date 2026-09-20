import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createDatabasePool, applyCoreMigration, permissionsSql } from '../../packages/db/src/index.ts';
import { enqueueReliableMessage, MessageConflictError } from '../../packages/jobs/src/index.ts';
import { retainQueueHistory, runScheduledQueueRetention } from '../../packages/jobs/src/retention.ts';

const url = process.env.TG_TEST_DATABASE_URL;
const kinds = ['chain-log-trigger', 'chain-backfill', 'projection-continuation'] as const;

test('queue retention scrubs only old successful chain payloads and preserves dedupe history', { timeout: 120_000 }, async context => {
  if (!url) { context.skip('local PostgreSQL required'); return; }
  const schemaName = `tg_queue_retention_${process.pid}_${randomBytes(4).toString('hex')}`;
  const schema = `"${schemaName}"`;
  const pipelineRole = `tg_retention_pipeline_${process.pid}_${randomBytes(3).toString('hex')}`;
  const contentRole = `tg_retention_content_${process.pid}_${randomBytes(3).toString('hex')}`;
  const { pool } = createDatabasePool(url, { max: 2 });
  let rolesCreated = false;
  try {
    try { await applyCoreMigration(pool, schemaName); }
    catch (error) {
      if (!['ECONNREFUSED', 'ENOENT', '28P01', '28000'].includes(String((error as { code?: string }).code))) throw error;
      context.skip('local PostgreSQL unavailable for queue retention integration test'); return;
    }

    const add = async (name: string, options: { queue?: 'chain' | 'content'; kind?: string; rawBody?: string } = {}) => {
      const rawBody = options.rawBody ?? JSON.stringify({ name });
      const result = await enqueueReliableMessage(pool, {
        queue: options.queue ?? 'chain', externalId: `ext-${name}`, operationId: `op-${name}`,
        kind: options.kind ?? 'chain-log-trigger', rawBody, payload: { name, retained: true },
        destinationKey: 'chain-worker', generation: 0n,
      }, schemaName);
      await pool.query(`UPDATE ${schema}.jobs SET state='succeeded',updated_at=now()-interval '45 days' WHERE id=$1`, [result.jobId]);
      await pool.query(`UPDATE ${schema}.outbox_messages SET state='sent',provider_message_id=$2,updated_at=now()-interval '45 days' WHERE id=$1`, [result.outboxId, `provider-${name}`]);
      await pool.query(`UPDATE ${schema}.inbox_messages SET state='processed',received_at=now()-interval '45 days',processed_at=now()-interval '45 days' WHERE id=$1`, [result.inboxId]);
      await pool.query(`INSERT INTO ${schema}.job_attempts(job_id,queue,fencing,attempt,outcome,started_at,finished_at) VALUES($1,$2,1,1,'leased',now()-interval '46 days',now()-interval '46 days'),($1,$2,1,1,'succeeded',now()-interval '46 days',now()-interval '46 days')`, [result.jobId, options.queue ?? 'chain']);
      return result;
    };

    const eligible = await Promise.all(kinds.map((kind, index) => add(`eligible-${index}`, { kind })));
    const preservePending = await add('pending');
    await pool.query(`UPDATE ${schema}.jobs SET state='pending',updated_at=now()-interval '45 days' WHERE id=$1`, [preservePending.jobId]);
    const preserveRetry = await add('retry');
    await pool.query(`UPDATE ${schema}.jobs SET state='retry',updated_at=now()-interval '45 days' WHERE id=$1`, [preserveRetry.jobId]);
    const preserveDead = await add('dead');
    await pool.query(`UPDATE ${schema}.jobs SET state='dead',updated_at=now()-interval '45 days' WHERE id=$1`, [preserveDead.jobId]);
    const preserveUnknown = await add('unknown-kind', { kind: 'future-chain-kind' });
    const preserveContent = await add('content-queue', { queue: 'content' });
    const preserveOutbox = await add('unsent-outbox');
    await pool.query(`UPDATE ${schema}.outbox_messages SET state='retry',updated_at=now()-interval '45 days' WHERE id=$1`, [preserveOutbox.outboxId]);

    // Any same-digest noneligible job protects every corresponding inbox body.
    const sharedRaw = '{"shared":"digest"}';
    const digestEligible = await add('shared-eligible', { rawBody: sharedRaw });
    const digestPending = await add('shared-pending', { rawBody: sharedRaw });
    await pool.query(`UPDATE ${schema}.jobs SET state='pending',updated_at=now()-interval '45 days' WHERE id=$1`, [digestPending.jobId]);
    await pool.query(`UPDATE ${schema}.jobs SET attempt=5,result_digest=$2 WHERE id=ANY($1::bigint[])`, [eligible.map(row => row.jobId), `0x${'a'.repeat(64)}`]);

    // One old successful job exercises 90-day attempt cleanup. Retry/dead/error attempts survive.
    await pool.query(`UPDATE ${schema}.jobs SET updated_at=now()-interval '100 days' WHERE id=$1`, [eligible[0]!.jobId]);
    await pool.query(`UPDATE ${schema}.inbox_messages SET received_at=now()-interval '100 days' WHERE id=(SELECT id FROM ${schema}.inbox_messages WHERE external_id=$1)`, ['ext-eligible-0']);
    await pool.query(`INSERT INTO ${schema}.job_attempts(job_id,queue,fencing,attempt,outcome,error_code,started_at,finished_at)
      VALUES($1,'chain',2,2,'retry','worker_error',now()-interval '99 days',now()-interval '99 days'),
            ($1,'chain',3,3,'dead','worker_error',now()-interval '98 days',now()-interval '98 days'),
            ($1,'chain',4,4,'succeeded','unexpected_error',now()-interval '97 days',now()-interval '97 days')`, [eligible[0]!.jobId]);

    const first = await retainQueueHistory(pool, schemaName, 2);
    assert.equal(first.acquired, true);
    assert.ok(first.jobsPayloadsCleared <= 2 && first.outboxPayloadsCleared <= 2 && first.inboxBodiesCleared <= 2 && first.attemptsDeleted <= 2);
    const second = await retainQueueHistory(pool, schemaName, 200);
    assert.equal(second.acquired, true);

    for (const row of eligible) {
      const stored = (await pool.query(`SELECT j.payload,j.payload_digest,j.state,j.attempt,j.result_digest,o.payload outbox_payload,o.provider_message_id,i.raw_body,i.payload_digest inbox_digest
        FROM ${schema}.jobs j JOIN ${schema}.outbox_messages o USING(operation_id)
        JOIN ${schema}.inbox_messages i ON i.queue=j.queue AND i.payload_digest=j.payload_digest WHERE j.id=$1`, [row.jobId])).rows[0];
      assert.deepEqual(stored.payload, {});
      assert.deepEqual(stored.outbox_payload, {});
      assert.equal(stored.raw_body, '');
      assert.equal(stored.state, 'succeeded');
      assert.equal(stored.payload_digest, stored.inbox_digest);
      assert.equal(stored.provider_message_id, `provider-eligible-${eligible.indexOf(row)}`);
      assert.equal(stored.attempt, 5);
      assert.equal(stored.result_digest, `0x${'a'.repeat(64)}`);
    }
    const oldAttemptRows = await pool.query(`SELECT outcome,error_code FROM ${schema}.job_attempts WHERE job_id=$1 ORDER BY outcome`, [eligible[0]!.jobId]);
    assert.deepEqual(oldAttemptRows.rows, [
      { outcome: 'dead', error_code: 'worker_error' },
      { outcome: 'retry', error_code: 'worker_error' },
      { outcome: 'succeeded', error_code: 'unexpected_error' },
    ]);

    for (const [name, row] of [['pending', preservePending], ['retry', preserveRetry], ['dead', preserveDead], ['unknown-kind', preserveUnknown], ['content-queue', preserveContent], ['unsent-outbox', preserveOutbox], ['shared-pending', digestPending]] as const) {
      const stored = (await pool.query(`SELECT j.payload,o.payload outbox_payload,i.raw_body FROM ${schema}.jobs j
        JOIN ${schema}.outbox_messages o USING(operation_id) JOIN ${schema}.inbox_messages i ON i.queue=j.queue AND i.external_id=$2 WHERE j.id=$1`, [row.jobId, `ext-${name}`])).rows[0];
      assert.ok(stored?.payload && Object.keys(stored.payload).length > 0);
      assert.ok(stored?.outbox_payload && Object.keys(stored.outbox_payload).length > 0);
      assert.notEqual(stored?.raw_body, '');
    }
    const sharedInbox = await pool.query(`SELECT raw_body FROM ${schema}.inbox_messages WHERE external_id IN ('ext-shared-eligible','ext-shared-pending') ORDER BY external_id`);
    assert.deepEqual(sharedInbox.rows.map(row => row.raw_body), [sharedRaw, sharedRaw]);

    const duplicate = await enqueueReliableMessage(pool, {
      queue: 'chain', externalId: 'ext-eligible-0', operationId: 'op-eligible-0', kind: kinds[0],
      rawBody: JSON.stringify({ name: 'eligible-0' }), payload: { name: 'eligible-0', retained: true }, destinationKey: 'chain-worker', generation: 0n,
    }, schemaName);
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.jobId, eligible[0]!.jobId);
    await assert.rejects(enqueueReliableMessage(pool, {
      queue: 'chain', externalId: 'ext-eligible-0', operationId: 'op-eligible-0', kind: kinds[0],
      rawBody: '{"name":"altered"}', payload: { name: 'eligible-0' }, destinationKey: 'chain-worker', generation: 0n,
    }, schemaName), MessageConflictError);

    const lockClient = await pool.connect();
    try {
      await lockClient.query('BEGIN');
      await lockClient.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`queue-retention:${schemaName}`]);
      const busy = await retainQueueHistory(pool, schemaName);
      assert.equal(busy.acquired, false);
    } finally { await lockClient.query('ROLLBACK'); lockClient.release(); }

    await assert.rejects(retainQueueHistory(pool, schemaName, 0), /between 1 and 200/);
    await assert.rejects(retainQueueHistory(pool, 'Invalid-Schema'), /invalid database schema/);

    // A scheduled batch with remaining work asks the existing scheduler to retry in about one minute.
    await pool.query(`INSERT INTO ${schema}.jobs(operation_id,queue,kind,payload_digest,payload,state,updated_at)
      SELECT 'backlog-'||n,'chain','chain-backfill',$1,jsonb_build_object('n',n),'succeeded',now()-interval '45 days' FROM generate_series(1,201) n`, [`0x${'b'.repeat(64)}`]);
    await pool.query(`INSERT INTO ${schema}.outbox_messages(operation_id,queue,destination_key,payload_digest,payload,state,provider_message_id,created_at)
      SELECT 'backlog-'||n,'chain','chain-worker',$1,jsonb_build_object('n',n),'sent','provider-'||n,now()-interval '45 days' FROM generate_series(1,201) n`, [`0x${'c'.repeat(64)}`]);
    const backlog = await runScheduledQueueRetention(pool, schemaName);
    assert.equal(backlog?.jobsPayloadsCleared, 200);
    assert.equal(backlog?.outboxPayloadsCleared, 200);
    const soon = (await pool.query(`SELECT next_run_at FROM ${schema}.maintenance_runs WHERE name='queue-retention'`)).rows[0].next_run_at as Date;
    assert.ok(soon.getTime() > Date.now() + 40_000 && soon.getTime() < Date.now() + 80_000, 'backlog schedules another pass in about one minute');
    assert.equal(await runScheduledQueueRetention(pool, schemaName), null, 'backlog lease throttles an immediate repeat');

    // A failed pass keeps its original five-minute claim, so a minute scheduler cannot hammer it.
    await pool.query(`UPDATE ${schema}.maintenance_runs SET next_run_at=now() WHERE name='queue-retention'`);
    await pool.query(`CREATE FUNCTION ${schema}.fail_retention_update() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF OLD.operation_id='backlog-201' AND NEW.payload='{}'::jsonb THEN RAISE EXCEPTION 'retention fixture failure'; END IF; RETURN NEW; END $$`);
    await pool.query(`CREATE TRIGGER fail_retention_update BEFORE UPDATE OF payload ON ${schema}.jobs FOR EACH ROW EXECUTE FUNCTION ${schema}.fail_retention_update()`);
    await assert.rejects(runScheduledQueueRetention(pool, schemaName), /retention fixture failure/);
    const lease = (await pool.query(`SELECT next_run_at FROM ${schema}.maintenance_runs WHERE name='queue-retention'`)).rows[0].next_run_at as Date;
    assert.ok(lease.getTime() > Date.now() + 4 * 60_000, 'failed invocation retains its five-minute claim');
    assert.equal(await runScheduledQueueRetention(pool, schemaName), null, 'failed invocation cannot be reclaimed each minute');
    await pool.query(`DROP TRIGGER fail_retention_update ON ${schema}.jobs`);
    await pool.query(`DROP FUNCTION ${schema}.fail_retention_update()`);
    await pool.query(`UPDATE ${schema}.maintenance_runs SET next_run_at=now() WHERE name='queue-retention'`);
    assert.equal((await runScheduledQueueRetention(pool, schemaName))?.jobsPayloadsCleared, 1);

    // The real pipeline role has chain-only RLS and the grants needed by the scrubber.
    await pool.query(`CREATE ROLE "${pipelineRole}" NOLOGIN`);
    await pool.query(`CREATE ROLE "${contentRole}" NOLOGIN`);
    rolesCreated = true;
    await pool.query(permissionsSql(schemaName, { pipeline: pipelineRole, content: contentRole, readApi: pipelineRole }));
    const roleChain = await add('role-chain');
    const roleContent = await add('role-content', { queue: 'content', kind: 'chain-backfill' });
    const roleClient = await pool.connect();
    try {
      await roleClient.query(`SET ROLE "${pipelineRole}"`);
      const scopedPool = { connect: async () => ({ query: roleClient.query.bind(roleClient), release: () => {} }) } as unknown as typeof pool;
      const roleResult = await retainQueueHistory(scopedPool, schemaName);
      assert.equal(roleResult.jobsPayloadsCleared, 1);
    } finally {
      await roleClient.query('RESET ROLE');
      roleClient.release();
    }
    assert.deepEqual((await pool.query(`SELECT payload FROM ${schema}.jobs WHERE id=$1`, [roleChain.jobId])).rows[0].payload, {});
    assert.ok(Object.keys((await pool.query(`SELECT payload FROM ${schema}.jobs WHERE id=$1`, [roleContent.jobId])).rows[0].payload).length > 0, 'pipeline role RLS leaves content jobs untouched');
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    if (rolesCreated) { await pool.query(`DROP ROLE "${pipelineRole}"`); await pool.query(`DROP ROLE "${contentRole}"`); }
    await pool.end();
  }
});
