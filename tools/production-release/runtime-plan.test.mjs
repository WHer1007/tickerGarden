import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {decodeAbiParameters, encodeAbiParameters} from './common.mjs';
import {EXPORT_TYPES, verifyAndBuildRuntime} from './runtime-plan.mjs';

const root = new URL('../../', import.meta.url);
const exportFile = new URL('docs/reviews/evidence/production-release-2026-09-15/runtime-export.json', root);
const planFile = new URL('docs/reviews/evidence/production-release-2026-09-15/runtime-plan.json', root);
const exported = JSON.parse(fs.readFileSync(exportFile, 'utf8'));
const expected = JSON.parse(fs.readFileSync(planFile, 'utf8'));
const encoded = exported.returns.encoded.value;
const nonce = expected.transactions[0].nonce;

function mutate(mutator) {
  const decoded = decodeAbiParameters(EXPORT_TYPES, encoded);
  mutator(decoded[0], decoded[1], decoded[2]);
  return encodeAbiParameters(EXPORT_TYPES, decoded);
}

function verify(value) {
  return verifyAndBuildRuntime(value, expected.configuration, expected.releaseId, nonce);
}

test('current exported runtime plan remains valid', () => {
  const result = verify(encoded);
  assert.equal(result.chainId, 4663);
  assert.equal(result.transactions.length, 19);
});

test('rejects tampered production configuration and nonce inputs', () => {
  const configuration = structuredClone(expected.configuration);
  configuration.chainId = 46630;
  assert.throws(() => verifyAndBuildRuntime(encoded, configuration, expected.releaseId, nonce));
  const initialAdmin = structuredClone(expected.configuration);
  initialAdmin.addresses.initialAdmin = '0x1111111111111111111111111111111111111111';
  assert.throws(() => verifyAndBuildRuntime(encoded, initialAdmin, expected.releaseId, nonce));
  assert.throws(() => verifyAndBuildRuntime(encoded, expected.configuration, expected.releaseId, -1));
  assert.throws(() => verifyAndBuildRuntime(encoded, expected.configuration, expected.releaseId, Number.NaN));
});

for (const [name, edit] of [
  ['deployer', (context) => { context.deployer = '0x0000000000000000000000000000000000000001'; }],
  ['release id', (context) => { context.releaseId = '0x' + '11'.repeat(32); }],
  ['CREATE2 orchestrator address', (context) => { context.orchestrator = '0x0000000000000000000000000000000000000001'; }],
  ['ordinary component initcode', (_context, _plan, payload) => { payload.ordinaryInitCodes[0] = '0x6000'; }],
  ['constructor parameter', (_context, _plan, payload) => { payload.factoryInitCode = payload.factoryInitCode.slice(0, -2) + (payload.factoryInitCode.endsWith('00') ? '01' : '00'); }],
  ['hook permission mask', (_context, plan) => { plan.hook = '0x0000000000000000000000000000000000002045'; }],
  ['full payload hash', (_context, plan) => { plan.payloadHash = '0x' + '22'.repeat(32); }],
  ['component count', (_context, _plan, payload) => { payload.ordinaryInitCodes.pop(); }],
]) {
  test(`rejects tampered ${name}`, () => {
    assert.throws(() => verify(mutate(edit)));
  });
}
