import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {privateKeyToAccount} from '../../apps/web/node_modules/viem/_esm/accounts/index.js';
import {ApprovedAssets} from './rpc-approved-assets.mjs';

test('ApprovedAssets permits only an exact reviewed transaction', async () => {
  const account = privateKeyToAccount('0x' + '11'.repeat(32));
  const other = privateKeyToAccount('0x' + '22'.repeat(32));
  const to = '0x' + '33'.repeat(20);
  const data = '0x1234';
  const txs = Array.from({length: 10}, (_, nonce) => ({nonce, to, data}));
  const plan = {chainId: 46630, deployer: account.address, expiresAtUnix: Math.floor(Date.now() / 1000) + 3600, limits: {perTransactionMaximumWei: '1000000000000000000'}, transactions: txs, stocks: Array.from({length: 5}, (_, i) => ({symbol: `S${i}`})), releaseId: '0x' + '44'.repeat(32)};
  const raw = JSON.stringify(plan);
  const audit = {status: 'APPROVED_FOR_CANONICAL_TEST_ASSET_ACTIVATION', releaseId: plan.releaseId, planSha256: '0x' + createHash('sha256').update(raw).digest('hex')};
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-approved-assets-'));
  try {
    const planPath = path.join(dir, 'plan.json'), auditPath = path.join(dir, 'audit.json');
    fs.writeFileSync(planPath, raw); fs.writeFileSync(auditPath, JSON.stringify(audit));
    const gate = new ApprovedAssets(planPath, auditPath);
    const base = {chainId: 46630, type: 'legacy', to, data, value: 0n, nonce: 0, gas: 21000n, gasPrice: 10000000n};
    assert.equal(await gate.permits('eth_sendRawTransaction', [await account.signTransaction(base)]), true);
    for (const [patch, signer] of [[{chainId: 1}, account], [{}, other], [{to: '0x' + '55'.repeat(20)}, account], [{data: '0x1235'}, account], [{nonce: 10}, account], [{value: 1n}, account], [{gas: 1000000000n, gasPrice: 2000000000n}, account]]) {
      const signed = await signer.signTransaction({...base, ...patch});
      await assert.rejects(() => gate.permits('eth_sendRawTransaction', [signed]));
    }
    const expired = {...plan, expiresAtUnix: Math.floor(Date.now() / 1000) - 1};
    fs.writeFileSync(planPath, JSON.stringify(expired));
    const expiredAudit = {...audit, planSha256: '0x' + createHash('sha256').update(JSON.stringify(expired)).digest('hex')};
    fs.writeFileSync(auditPath, JSON.stringify(expiredAudit));
    const expiredGate = new ApprovedAssets(planPath, auditPath);
    const expiredSigned = await account.signTransaction(base);
    assert.equal(await expiredGate.permits('eth_sendRawTransaction', [expiredSigned]), false);
    fs.writeFileSync(auditPath, JSON.stringify({...audit, planSha256: '0x' + '00'.repeat(32)}));
    assert.throws(() => new ApprovedAssets(planPath, auditPath));
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});
