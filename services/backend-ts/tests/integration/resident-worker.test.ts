import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { applyCoreMigration, createDatabasePool, transaction } from '../../packages/db/src/index.ts';
import { claimJobByOperation, claimJobs, claimOutbox, completeJob, enqueueReliableMessage, setQueueExecutionMode, sha256 } from '../../packages/jobs/src/index.ts';
import { createWorkerState, runResidentWorker } from '../../packages/chain-worker/src/resident.ts';

const url = process.env.TG_TEST_DATABASE_URL ?? 'postgresql://127.0.0.1:54329/tickergarden';

test('resident worker enforces mode, leases, fencing, shutdown, and schema ownership', { timeout: 60_000 }, async (ctx) => {
  if (!process.env.TG_TEST_DATABASE_URL) { ctx.skip('TG_TEST_DATABASE_URL is required for the local PostgreSQL integration test'); return; }
  const schemaName = `tg_resident_${randomBytes(6).toString('hex')}`;
  const schema = `"${schemaName}"`;
  const db = createDatabasePool(url, { max: 2 });
  const control = createDatabasePool(url, { max: 1 });
  const secondControl = createDatabasePool(url, { max: 1 });
  const message = (n: number, attempts = 2) => ({ queue: 'chain' as const, externalId: `ext-${n}`, operationId: `op-${n}`, kind: 'test-job', rawBody: JSON.stringify({ n }), payload: { n }, destinationKey: 'chain-worker', maxAttempts: attempts, generation: 0n });
  try {
    await applyCoreMigration(db.pool, schemaName);
    await assert.rejects(runResidentWorker({ pool: db.pool, controlPool: control.pool, owner: 'before', generation: 0n, schemaName, signal: AbortSignal.timeout(20), state: createWorkerState(), process: async () => 'x', fatal: () => {}, pollMs: 10, maxJobs: 1 }), /resident mode and generation/);
    await enqueueReliableMessage(db.pool, message(1), schemaName);
    await enqueueReliableMessage(db.pool, message(2), schemaName);
    assert.equal((await enqueueReliableMessage(db.pool, message(1), schemaName)).duplicate, true);
    await setQueueExecutionMode(db.pool, 'resident', 0n, schemaName);
    assert.equal(await claimJobByOperation(db.pool, 'chain', 'op-1', 'qstash', 20_000, schemaName), null);
    assert.equal((await claimOutbox(db.pool, 'chain', 'qstash', 2, 20_000, schemaName)).length, 0);
    const state = createWorkerState(); const processed: string[] = [];
    await runResidentWorker({ pool: db.pool, controlPool: control.pool, owner: 'resident-a', generation: 0n, schemaName, signal: new AbortController().signal, state, process: async (lease) => { processed.push(lease.operationId); if (lease.operationId === 'op-2') throw Error('expected failure'); return lease.operationId; }, fatal: () => {}, pollMs: 10, maxJobs: 2 });
    assert.deepEqual(processed, ['op-1', 'op-2']); assert.equal(state.succeeded, 1); assert.equal(state.retried, 1);
    const rows = await db.pool.query(`SELECT j.operation_id,j.state,o.state AS outbox_state FROM ${schema}.jobs j JOIN ${schema}.outbox_messages o USING(operation_id) ORDER BY j.operation_id`);
    assert.deepEqual(rows.rows, [{ operation_id: 'op-1', state: 'succeeded', outbox_state: 'sent' }, { operation_id: 'op-2', state: 'retry', outbox_state: 'sent' }]);

    await db.pool.query(`UPDATE ${schema}.jobs SET state='leased',lease_owner='held',lease_expires_at=now()+interval '1 minute' WHERE operation_id='op-2'`);
    await assert.rejects(setQueueExecutionMode(db.pool, 'qstash', 0n, schemaName), /drained leases/);
    await db.pool.query(`UPDATE ${schema}.jobs SET state='retry',lease_owner=NULL,lease_expires_at=NULL,next_attempt_at=now() WHERE operation_id='op-2'`);
    const stopped = new AbortController(); stopped.abort(); const stoppedState = createWorkerState();
    await setQueueExecutionMode(db.pool, 'resident', 0n, schemaName);
    await runResidentWorker({ pool: db.pool, controlPool: control.pool, owner: 'stopped', generation: 0n, schemaName, signal: stopped.signal, state: stoppedState, process: async () => 'unexpected', fatal: () => {}, pollMs: 10 });
    assert.equal(stoppedState.succeeded, 0);

    await db.pool.query(`UPDATE ${schema}.jobs SET next_attempt_at=now()+interval '1 hour' WHERE operation_id='op-2'`);
    const expiring = await enqueueReliableMessage(db.pool, { ...message(3, 1), externalId: 'ext-3', operationId: 'op-3' }, schemaName);
    const oldLease = (await claimJobs(db.pool, 'chain', 'old-owner', 1, 1_000, schemaName, 0n, 'resident'))[0]!;
    await db.pool.query(`UPDATE ${schema}.jobs SET lease_expires_at=now()-interval '1 second' WHERE id=$1`, [oldLease.id]);
    assert.equal(await completeJob(db.pool, oldLease, 'old-owner', sha256('old'), schemaName), false);
    const expiredState = createWorkerState(); let expiredProcessed = 0;
    const expiredAbort = new AbortController(); const expiredRun = runResidentWorker({ pool: db.pool, controlPool: control.pool, owner: 'resident-expired', generation: 0n, schemaName, signal: expiredAbort.signal, state: expiredState, process: async () => { expiredProcessed++; return 'unexpected'; }, fatal: () => {}, pollMs: 10 });
    await new Promise(r => setTimeout(r, 50)); expiredAbort.abort(); await expiredRun;
    assert.equal(expiredProcessed, 0);
    assert.equal((await db.pool.query(`SELECT state FROM ${schema}.jobs WHERE id=$1`, [expiring.jobId])).rows[0].state, 'dead');

    await setQueueExecutionMode(db.pool, 'resident', 0n, schemaName);
    await assert.rejects(transaction(db.pool, async client => { await client.query(`UPDATE ${schema}.queue_generations SET execution_mode='qstash' WHERE queue='chain'`); throw Error('mode rollback'); }), /mode rollback/);
    await setQueueExecutionMode(db.pool, 'qstash', 0n, schemaName);
    await db.pool.query(`UPDATE ${schema}.jobs SET next_attempt_at=now() WHERE operation_id='op-2'`);
    const recovered = await claimJobByOperation(db.pool, 'chain', 'op-2', 'qstash-after-rollback', 20_000, schemaName);
    assert.ok(recovered);
    assert.equal(await claimJobByOperation(db.pool, 'chain', 'op-2', 'resident-after-rollback', 20_000, schemaName), null);
    await db.pool.query(`UPDATE ${schema}.jobs SET state='retry',lease_owner=NULL,lease_expires_at=NULL,next_attempt_at=now() WHERE operation_id='op-2'`);
    await setQueueExecutionMode(db.pool, 'resident', 0n, schemaName);
    await assert.rejects(runResidentWorker({ pool: db.pool, controlPool: control.pool, owner: 'wrong-generation', generation: 1n, schemaName, signal: AbortSignal.timeout(20), state: createWorkerState(), process: async () => 'x', fatal: () => {}, pollMs: 10 }), /resident mode and generation|stale/);

    await setQueueExecutionMode(db.pool, 'resident', 0n, schemaName);
    const gate = new Promise<void>(resolve => setTimeout(resolve, 10)); let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const firstState = createWorkerState();
    const first = runResidentWorker({ pool: db.pool, controlPool: control.pool, owner: 'owner-1', generation: 0n, schemaName, signal: new AbortController().signal, state: firstState, process: async () => { await gate; await blocked; return 'done'; }, fatal: () => {}, pollMs: 10, maxJobs: 1 });
    for (let i = 0; i < 100 && !firstState.ready; i++) await new Promise(r => setTimeout(r, 10));
    try { await assert.rejects(runResidentWorker({ pool: db.pool, controlPool: secondControl.pool, owner: 'owner-2', generation: 0n, schemaName, signal: AbortSignal.timeout(100), state: createWorkerState(), process: async () => 'x', fatal: () => {}, pollMs: 10 }), /another resident worker/); }
    finally { release(); await first; }
  } finally { await db.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined); await db.pool.end(); await control.pool.end(); await secondControl.pool.end(); }
});

test('resident consumes a job longer than the HTTP callback budget without redelivery',{timeout:35000},async ctx=>{
 if(!process.env.TG_TEST_DATABASE_URL){ctx.skip('TG_TEST_DATABASE_URL required');return;}
 const schemaName=`tg_resident_long_${randomBytes(6).toString('hex')}`,schema=`"${schemaName}"`;
 const db=createDatabasePool(url,{max:2}),control=createDatabasePool(url,{max:1});
 try{
  await applyCoreMigration(db.pool,schemaName);
  await enqueueReliableMessage(db.pool,{queue:'chain',externalId:'long',operationId:'long',kind:'test-job',rawBody:'{}',payload:{},destinationKey:'chain-worker',maxAttempts:2,generation:0n},schemaName);
  await setQueueExecutionMode(db.pool,'resident',0n,schemaName);
  let executions=0;const state=createWorkerState(),started=Date.now();
  await runResidentWorker({pool:db.pool,controlPool:control.pool,owner:'long-worker',generation:0n,schemaName,signal:new AbortController().signal,state,maxJobs:1,fatal:e=>{throw e;},process:async()=>{executions++;await new Promise(r=>setTimeout(r,21000));assert.equal(await claimJobByOperation(db.pool,'chain','long','old-http',20000,schemaName),null);return 'done';}});
  assert.ok(Date.now()-started>=21000);assert.equal(executions,1);assert.equal(state.succeeded,1);
  assert.equal((await db.pool.query(`SELECT state FROM ${schema}.jobs WHERE operation_id='long'`)).rows[0].state,'succeeded');
 }finally{await db.pool.query(`DROP SCHEMA ${schema} CASCADE`);await db.pool.end();await control.pool.end();}
});
