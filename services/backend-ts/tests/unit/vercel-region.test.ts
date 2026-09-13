import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error The deployment CLI gate is an independent native JS script.
import { assertSingaporeFunctions } from '../../scripts/check-vercel-region.mjs';
test('region gate verifies every deployed function, ignoring the build region', () => {
  assert.equal(assertSingaporeFunctions('status ● Ready\nBuild machine cle1\n├── λ index (1.93MB) [sin1]\n└── λ api/index (1.93MB) [sin1]'), 2);
  for (const output of [
    'status ● Ready\nλ index [iad1]',
    'status ● Ready\nλ index [sin1]\nλ api/index [iad1]',
    'status ● Ready\nλ index [sin1, iad1]',
    'status ● Ready\nλ index',
    'status ● Ready\nSandbox Region sin1',
    'status Building\nλ index [sin1]',
  ]) assert.throws(() => assertSingaporeFunctions(output));
});
