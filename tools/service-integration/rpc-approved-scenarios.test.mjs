import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {keccak256} from '../../apps/web/node_modules/viem/_esm/index.js';
import {privateKeyToAccount} from '../../apps/web/node_modules/viem/_esm/accounts/index.js';
import {ApprovedScenarios} from './rpc-approved-scenarios.mjs';

const account = privateKeyToAccount('0x' + '11'.repeat(32));
const other = privateKeyToAccount('0x' + '22'.repeat(32));

async function fixture({expiresAt = Math.floor(Date.now() / 1000) + 3600, transaction} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-approved-scenarios-'));
  const file = path.join(dir, 'capability.json');
  const tx = transaction ?? await account.signTransaction({
    chainId: 46630, type: 'legacy', to: '0x' + '33'.repeat(20), data: '0x1234',
    value: 1n, nonce: 0, gas: 21000n, gasPrice: 10000000n,
  });
  fs.writeFileSync(file, JSON.stringify({chainId: 46630, scope: 'AUTHORIZED_TESTNET_SCENARIOS', expiresAt,
    transactions: [{hash: keccak256(tx), from: account.address.toLowerCase()}], senders: [account.address.toLowerCase()]}, {mode: 0o600}));
  fs.chmodSync(file, 0o600);
  return {dir, file, tx};
}

test('permits an approved signed transaction and safe read methods', async () => {
  const f = await fixture();
  try {
    const gate = new ApprovedScenarios(f.file);
    assert.equal(await gate.permits('eth_sendRawTransaction', [f.tx]), true);
    assert.equal(await gate.permits('eth_blockNumber', []), true);
    assert.equal(await gate.permits('eth_getTransactionReceipt', [keccak256(f.tx)]), true);
    assert.equal(await gate.permits('eth_getTransactionCount', [account.address, 'pending']), true);
  } finally { fs.rmSync(f.dir, {recursive: true, force: true}); }
});

test('rejects wrong hash and sender', async () => {
  const f = await fixture();
  try {
    const gate = new ApprovedScenarios(f.file);
    assert.equal(await gate.permits('eth_sendRawTransaction', ['0x02']), false);
    const signed = await other.signTransaction({chainId: 46630, type: 'legacy', to: '0x' + '33'.repeat(20), value: 1n, nonce: 0, gas: 21000n, gasPrice: 10000000n});
    assert.equal(await gate.permits('eth_sendRawTransaction', [signed]), false);
  } finally { fs.rmSync(f.dir, {recursive: true, force: true}); }
});

test('rejects wrong chain and value or fee budgets', async () => {
  for (const patch of [{chainId: 1}, {value: 1000000000000000001n}, {gas: 2100000000000n}, {gasPrice: 1000000000000n}]) {
    const tx = await account.signTransaction({chainId: 46630, type: 'legacy', to: '0x' + '33'.repeat(20), value: 1n, nonce: 0, gas: 21000n, gasPrice: 10000000n, ...patch});
    const f = await fixture({transaction: tx});
    try { await assert.rejects(() => new ApprovedScenarios(f.file).permits('eth_sendRawTransaction', [tx]), /Scenario intent outside budget/); }
    finally { fs.rmSync(f.dir, {recursive: true, force: true}); }
  }
});

test('rejects expired and unsafe capability files', async () => {
  const expired = await fixture({expiresAt: Math.floor(Date.now() / 1000) - 1});
  try { assert.equal(await new ApprovedScenarios(expired.file).permits('eth_blockNumber', []), false); }
  finally { fs.rmSync(expired.dir, {recursive: true, force: true}); }
  const unsafe = await fixture();
  try { fs.chmodSync(unsafe.file, 0o644); assert.throws(() => new ApprovedScenarios(unsafe.file), /Unsafe scenario capability file/); }
  finally { fs.rmSync(unsafe.dir, {recursive: true, force: true}); }
});
