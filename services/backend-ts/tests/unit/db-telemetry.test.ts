import assert from 'node:assert/strict';
import test from 'node:test';
import { createDatabaseTelemetry } from '../../packages/db/src/telemetry.ts';

test('database timing tracks thresholds, errors and task summaries', async () => {
  let now = 100;
  const events: Array<{ service: string; level: string; event: string; fields: Record<string, unknown> }> = [];
  const telemetry = createDatabaseTelemetry({ clock: () => now, emit: (event) => events.push(event) });
  await telemetry.withDatabaseTask('read-api', 'load', async () => {
    now += 11; telemetry.recordDatabaseTiming('connection', 200);
    now += 13; telemetry.recordDatabaseTiming('sql', 500, undefined, 'query_1');
    telemetry.recordDatabaseTiming('sql', 8, { code: '57014', message: 'secret SQL and params' }, 'query_2');
    telemetry.recordDatabaseTiming('connection', 3, new Error('connection timeout for secret-host'));
    now += 17;
  });
  assert.deepEqual(telemetry.databaseTimingSnapshot(), {
    connectionCount: 2, queryCount: 2, slowQueryCount: 1, sqlTimeoutCount: 1,
    connectionTimeoutCount: 1, taskCount: 1, taskFailedCount: 0,
    connectionWaitMs: 203, sqlMs: 508, taskMs: 41,
  });
  assert.deepEqual(events.map((item) => item.event), [
    'database_slow_connection', 'database_slow_query', 'database_query_timeout',
    'database_connection_timeout', 'database_task',
  ]);
  const summary = events.at(-1)!;
  assert.equal(summary.service, 'read-api');
  assert.deepEqual(summary.fields, {
    task: 'load', taskMs: 41, connectionWaitMs: 203, sqlMs: 508,
    queryCount: 2, slowQueryCount: 1, sqlTimeoutCount: 1, connectionTimeoutCount: 1, outcome: 'succeeded',
  });
  assert.equal(JSON.stringify(events).includes('secret'), false);
});

test('concurrent async tasks keep task-local measurements isolated', async () => {
  const events: Array<{ event: string; fields: Record<string, unknown> }> = [];
  const telemetry = createDatabaseTelemetry({ clock:()=>0, emit: (event) => events.push(event) });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const first = telemetry.withDatabaseTask('api-a', 'first', async () => {
    telemetry.recordDatabaseTiming('sql', 12); await gate; telemetry.recordDatabaseTiming('sql', 3);
  });
  const second = telemetry.withDatabaseTask('api-b', 'second', async () => {
    telemetry.recordDatabaseTiming('sql', 7); telemetry.recordDatabaseTiming('connection', 2);
  });
  await second; release(); await first;
  const tasks = events.filter((event) => event.event === 'database_task');
  assert.deepEqual(tasks.map(({ fields }) => ({ task: fields.task, queryCount: fields.queryCount, sqlMs: fields.sqlMs })), [
    { task: 'second', queryCount: 1, sqlMs: 7 }, { task: 'first', queryCount: 2, sqlMs: 15 },
  ]);
  assert.equal(telemetry.databaseTimingSnapshot().queryCount, 3);
});

test('nested tasks aggregate only to the innermost task and preserve rejection identity', async () => {
  const events: Array<{ event: string; fields: Record<string, unknown> }> = [];
  const telemetry = createDatabaseTelemetry({ clock:()=>0, emit: (event) => events.push(event) });
  const failure = new Error('caller-visible failure');
  await assert.rejects(telemetry.withDatabaseTask('svc', 'outer', async () => {
    await telemetry.withDatabaseTask('svc', 'inner', async () => {
      telemetry.recordDatabaseTiming('sql', 1); throw failure;
    });
  }), (error) => error === failure);
  const tasks = events.filter((event) => event.event === 'database_task');
  assert.deepEqual(tasks.map(({ fields }) => [fields.task, fields.queryCount, fields.outcome]), [
    ['inner', 1, 'failed'], ['outer', 0, 'failed'],
  ]);
  assert.deepEqual(telemetry.databaseTimingSnapshot(), {
    connectionCount: 0, queryCount: 1, slowQueryCount: 0, sqlTimeoutCount: 0,
    connectionTimeoutCount: 0, taskCount: 2, taskFailedCount: 2, connectionWaitMs: 0, sqlMs: 1, taskMs: 0,
  });
});

test('telemetry observer exceptions do not change database task results', async () => {
  const telemetry = createDatabaseTelemetry({ emit: () => { throw new Error('observer failure'); } });
  const value = await telemetry.withDatabaseTask('svc', 'ok', async () => {
    telemetry.recordDatabaseTiming('sql', 600); return 42;
  });
  assert.equal(value, 42);
});

test('SQL timeout counters exclude explicit cancellation and NOWAIT conflicts',()=>{
 const telemetry=createDatabaseTelemetry({emit:()=>{}});
 telemetry.recordDatabaseTiming('sql',1,{code:'57014',message:'canceling statement due to user request'});
 telemetry.recordDatabaseTiming('sql',1,{code:'55P03',message:'could not obtain lock on row'});
 assert.equal(telemetry.databaseTimingSnapshot().sqlTimeoutCount,0);
 telemetry.recordDatabaseTiming('sql',1,{code:'55P03',message:'canceling statement due to lock timeout'});
 telemetry.recordDatabaseTiming('sql',1,{message:'Query read timeout'});
 assert.equal(telemetry.databaseTimingSnapshot().sqlTimeoutCount,2);
});

test('connection diagnostics distinguish driver acquisition failures without logging secrets',()=>{
 const events:Array<{event:string;fields:Record<string,unknown>}>=[];const t=createDatabaseTelemetry({emit:e=>events.push(e)});
 t.recordDatabaseTiming('connection',5001,new Error('Connection terminated due to connection timeout'),undefined,{poolTotal:1,poolIdle:0,poolWaiting:2});
 t.recordDatabaseTiming('connection',5001,new Error('timeout exceeded when trying to connect'),undefined,{poolTotal:4,poolIdle:0,poolWaiting:1});
 assert.equal(events[0]!.fields.failureStage,'new_connection');assert.equal(events[1]!.fields.failureStage,'pool_wait');assert.equal(events[0]!.fields.poolWaiting,2);assert.equal(events[0]!.fields.phase,'connection');assert.equal('message' in events[0]!.fields,false);
});
