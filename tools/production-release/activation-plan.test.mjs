import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {buildActivation} from './activation-plan.mjs';
import {keccak256, toBytes, artifact, decodeFunctionData} from './common.mjs';

const root = new URL('../../', import.meta.url);
const evidence = new URL('docs/reviews/evidence/production-release-2026-09-15/', root);
const runtime = JSON.parse(fs.readFileSync(new URL('runtime-plan.json', evidence), 'utf8'));
const observedCode = JSON.parse(fs.readFileSync(new URL('runtime-code.json', evidence), 'utf8'));

test('builds all approved asset registrations and ordered operator/bootstrap actions', () => {
  const plan = buildActivation(runtime, observedCode);
  assert.equal(plan.stakes.length, 194);
  assert.equal(plan.quoteConfigs.length, 196);
  assert.equal(plan.operations.length, 417);
  assert.equal(plan.transactions.length, 15);
  const operationById = new Map(plan.operations.map((operation) => [operation.id, operation]));
  assert.deepEqual(plan.transactions.flatMap((tx) => tx.operationIds), plan.operations.map((operation) => operation.id));
  assert.deepEqual(plan.transactions.slice(0, 7).map((tx) => tx.operationIds.length), [33, 32, 32, 32, 32, 32, 2]);
  assert.deepEqual(plan.transactions.slice(7, 14).map((tx) => tx.operationIds.length), [32, 32, 32, 32, 32, 32, 4]);
  assert.equal(plan.transactions[14].operationIds.length, 26);
  const publisher = plan.operations.findIndex((op) => op.id === 'initialize-holder-publisher');
  const keeper = plan.operations.findIndex((op) => op.id === 'initialize-compound-keeper');
  const roleBinding = plan.operations.findIndex((op) => op.phase === 'PROTOCOL_SELECTORS');
  assert.ok(publisher >= 0 && keeper >= 0 && roleBinding > publisher && roleBinding > keeper);
  assert.equal(plan.operations.at(-1)?.phase, 'RENOUNCE_DEPLOYER');
  assert.equal(plan.transactions.at(-1)?.operationIds.at(-1), plan.operations.at(-1)?.id);
  assert.ok(plan.transactions.at(-1)?.operationIds.includes('register-template'));
  assert.ok(plan.transactions.at(-1)?.operationIds.includes('initialize-holder-publisher'));
  const publisherSelector = keccak256(toBytes('setSnapshotPublisher(address)')).slice(0, 10);
  assert.ok(plan.access.actions.some((action) => action.phase === 'PROTOCOL_SELECTORS' && action.data.includes(publisherSelector.slice(2))));

  const accessAbi = artifact('AccessManager').abi;
  for (const batch of plan.transactions) {
    const outer = decodeFunctionData({abi: accessAbi, data: batch.data});
    assert.equal(outer.functionName, 'multicall');
    assert.equal(outer.args[0].length,batch.operationIds.length);
    for (const [index,callData] of outer.args[0].entries()) {
      const decoded = callData.slice(0, 10) === '0x' + keccak256(toBytes('execute(address,bytes)')).slice(2, 10)
        ? decodeFunctionData({abi: accessAbi, data: callData}).args
        : [batch.to, callData];
      const match = operationById.get(batch.operationIds[index]);
      assert.ok(match, `unknown call in ${batch.id}`);
      assert.equal(match.to.toLowerCase(),String(decoded[0]).toLowerCase());
      assert.equal(match.data.toLowerCase(),String(decoded[1]).toLowerCase());
    }
  }
});

function cloneRuntime() {
  return structuredClone(runtime);
}

for (const [name, edit] of [
  ['chain id', (value) => { value.configuration.chainId = 46630; }],
  ['on-chain keeper disabled', (value) => { value.configuration.lpCompounding.onchainEnabledAtLaunch = false; }],
  ['scheduler enabled', (value) => { value.configuration.lpCompounding.schedulerEnabled = true; }],
  ['operator mismatch', (value) => { value.configuration.lpCompounding.keeperAtLaunch = '0x1111111111111111111111111111111111111111'; }],
]) {
  test(`rejects tampered ${name}`, () => {
    const value = cloneRuntime();
    edit(value);
    assert.throws(() => buildActivation(value, observedCode));
  });
}
