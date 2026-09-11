import assert from 'node:assert/strict';
import test from 'node:test';
import { ALCHEMY_EVM_COMPUTE_UNIT_SCHEDULE, alchemyNominalComputeUnits } from '../../packages/alchemy/src/index.ts';

test('Alchemy CU schedule covers every RPC method used by the serverless backend', () => {
  assert.equal(ALCHEMY_EVM_COMPUTE_UNIT_SCHEDULE.asOf, '2026-09-11');
  assert.deepEqual(
    Object.fromEntries(['eth_chainId', 'eth_getBlockByNumber', 'eth_getLogs', 'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_call', 'eth_getCode']
      .map((method) => [method, alchemyNominalComputeUnits(method)])),
    { eth_chainId: 0, eth_getBlockByNumber: 20, eth_getLogs: 60, eth_getTransactionReceipt: 20, eth_getTransactionByHash: 20, eth_call: 26, eth_getCode: 20 },
  );
  assert.equal(alchemyNominalComputeUnits('unsupported_method'), null);
});
