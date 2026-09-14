import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadAdmission } from '../../apps/read-api/src/read-admission.ts';

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
