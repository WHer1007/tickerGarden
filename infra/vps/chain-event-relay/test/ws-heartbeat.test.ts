import test from 'node:test';
import assert from 'node:assert/strict';
import { startWsHeartbeat } from '../src/ws-heartbeat.ts';

test('heartbeat closes an unresponsive connection after its bounded timeout', async (context) => {
  context.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  let closeCount = 0;
  let resolveRequest!: () => void;
  const stop = startWsHeartbeat({
    request: () => new Promise<void>((resolve) => { resolveRequest = resolve; }),
    close: () => { closeCount++; }, intervalMs: 5, timeoutMs: 15,
  });
  await context.mock.timers.tick(5);
  await context.mock.timers.tick(15);
  resolveRequest(); // A late response after timeout must not revive the connection.
  await Promise.resolve();
  stop();
  assert.equal(closeCount, 1);
});

test('heartbeat does not overlap requests and closes on RPC failure', async (context) => {
  context.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  let requests = 0;
  let closeCount = 0;
  let rejectRequest!: (error: Error) => void;
  const stop = startWsHeartbeat({
    request: () => { requests++; return new Promise((_, reject) => { rejectRequest = reject; }); },
    close: () => { closeCount++; }, intervalMs: 5, timeoutMs: 100,
  });
  await context.mock.timers.tick(20);
  assert.equal(requests, 1);
  rejectRequest(new Error('RPC failed'));
  await Promise.resolve();
  stop();
  assert.equal(closeCount, 1);
});

test('stopping heartbeat clears pending work without closing a healthy socket', async (context) => {
  context.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  let requests = 0;
  let closeCount = 0;
  const stop = startWsHeartbeat({ request: async () => { requests++; }, close: () => { closeCount++; }, intervalMs: 20, timeoutMs: 100 });
  await context.mock.timers.tick(20);
  stop();
  await context.mock.timers.tick(100);
  assert.equal(requests, 1);
  assert.equal(closeCount, 0);
});

test('local RPC budget exhaustion skips a probe without disconnecting a healthy WS',async context=>{
 context.mock.timers.enable({apis:['setInterval','setTimeout']});let requests=0,closed=0;
 const stop=startWsHeartbeat({request:async()=>{requests++;throw Object.assign(Error('busy'),{name:'RpcBudgetBusy'});},close:()=>closed++,intervalMs:10,timeoutMs:20});
 await context.mock.timers.tick(10);await Promise.resolve();await context.mock.timers.tick(10);await Promise.resolve();
 stop();assert.equal(closed,0);assert.equal(requests,2);
});
