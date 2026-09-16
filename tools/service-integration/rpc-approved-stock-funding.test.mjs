import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {privateKeyToAccount} from '../../apps/web/node_modules/viem/_esm/accounts/index.js';
import {ApprovedStockFunding} from './rpc-approved-stock-funding.mjs';

test('ApprovedStockFunding permits only the exact ten transaction funding plan', async () => {
  const account = privateKeyToAccount('0x' + '11'.repeat(32));
  const other = privateKeyToAccount('0x' + '22'.repeat(32));
  const to = '0x' + '33'.repeat(20);
  const transactions = Array.from({length: 10}, (_, nonce) => ({nonce, to, data: `0x${(0x1200 + nonce).toString(16)}`, value: '1000000000000000'}));
  const plan = {chainId: 46630, scope: 'FIVE_STOCK_GRADUATION_FUNDING', sender: account.address, deadline: Math.floor(Date.now() / 1000) + 3600, transactions};
  const raw = JSON.stringify(plan);
  const digest = createHash('sha256').update(raw).digest('hex');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-stock-funding-'));
  try {
    const file = path.join(dir, 'funding.json'); fs.writeFileSync(file, raw);
    const gate = new ApprovedStockFunding(file, digest);
    const base = {chainId: 46630, type: 'legacy', to, data: transactions[0].data, value: 1000000000000000n, nonce: 0, gas: 21000n, gasPrice: 10000000n};
    assert.equal(await gate.permits('eth_sendRawTransaction', [await account.signTransaction(base)]), true);
    for (const [patch, signer] of [[{chainId: 1}, account], [{}, other], [{nonce: 10}, account], [{to: '0x' + '44'.repeat(20)}, account], [{data: '0xdeadbeef'}, account], [{value: 0n}, account], [{gas: 1000000000n, gasPrice: 10000000n}, account]]) {
      const signed = await signer.signTransaction({...base, ...patch});
      await assert.rejects(() => gate.permits('eth_sendRawTransaction', [signed]));
    }
    const expiredPlan = {...plan, deadline: Math.floor(Date.now() / 1000) - 1};
    const expiredRaw = JSON.stringify(expiredPlan); fs.writeFileSync(file, expiredRaw);
    const expiredGate = new ApprovedStockFunding(file, createHash('sha256').update(expiredRaw).digest('hex'));
    const expiredSigned = await account.signTransaction(base);
    await assert.rejects(() => expiredGate.permits('eth_sendRawTransaction', [expiredSigned]));
    assert.throws(() => new ApprovedStockFunding(file, '0'.repeat(64)));
    const oversized = {...plan, transactions: transactions.map(t => ({...t, value: '20000000000000000'}))};
    const oversizedRaw = JSON.stringify(oversized); fs.writeFileSync(file, oversizedRaw);
    assert.throws(() => new ApprovedStockFunding(file, createHash('sha256').update(oversizedRaw).digest('hex')));
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});
