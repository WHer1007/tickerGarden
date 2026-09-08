import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createPublicClient, http, keccak256} from '../apps/web/node_modules/viem/_esm/index.js';
import {arbitrumSepolia} from '../apps/web/node_modules/viem/_esm/chains/index.js';

// Read-only audit of the already captured public edge run. This tool never signs or sends.
const dir = 'outputs/reviews/continuous-edge-public-2026-09-07';
const source = JSON.parse(fs.readFileSync(`${dir}/results.json`));
const candidate = JSON.parse(fs.readFileSync('outputs/reviews/arbitrum-continuous-preflight-2026-09-07/candidate.preview.json'));
const release = JSON.parse(fs.readFileSync(`deployments/releases/${candidate.releaseId}/arbitrum-sepolia-421614.v1.deployed.json`));
const roles = JSON.parse(fs.readFileSync(`${dir}/roles.json`)).roles;
const rpc = 'https://sepolia-rollup.arbitrum.io/rpc';
const c = createPublicClient({chain: arbitrumSepolia, transport: http(rpc)});
const serial = v => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? String(x) : x, 2) + '\n';
const chainId = await c.getChainId();
assert.equal(chainId, 421614, 'RPC chain');
assert.equal(source.chainId, chainId, 'source chain');
assert.equal(source.releaseId, release.releaseId, 'release');
assert.equal(source.transactions.length, 78, 'expected 78 source transactions');

const evidence = [];
for (const t of source.transactions) {
  assert.ok(t.hash && t.blockHash && t.blockNumber, `incomplete source row ${t.id}`);
  const [receipt, tx] = await Promise.all([c.getTransactionReceipt({hash: t.hash}), c.getTransaction({hash: t.hash})]);
  const block = await c.getBlock({blockNumber: receipt.blockNumber});
  assert.equal(receipt.blockHash, t.blockHash, `${t.id}: receipt block hash`);
  assert.equal(block.hash, receipt.blockHash, `${t.id}: canonical block`);
  assert.equal(receipt.blockNumber, BigInt(t.blockNumber), `${t.id}: block number`);
  assert.equal(keccak256(tx.input), t.inputHash, `${t.id}: input hash`);
  if (t.role && roles[t.role]) assert.equal(tx.from.toLowerCase(), roles[t.role].toLowerCase(), `${t.id}: sender`);
  if (t.to) assert.equal(tx.to?.toLowerCase(), t.to.toLowerCase(), `${t.id}: destination`);
  assert.equal(tx.value, BigInt(t.value), `${t.id}: value`);
  const expected = t.expectedStatus === 'reverted' || t.id === 'capacity-expected-revert' ? 'reverted' : 'success';
  assert.equal(receipt.status, expected, `${t.id}: status`);
  evidence.push({id: t.id, hash: t.hash, status: receipt.status, blockNumber: receipt.blockNumber,
    blockHash: receipt.blockHash, from: tx.from, to: tx.to, value: tx.value,
    gasUsed: receipt.gasUsed, effectiveGasPrice: receipt.effectiveGasPrice,
    gasCostWei: receipt.gasUsed * receipt.effectiveGasPrice});
}

// Preserve the runner's documented accounting assertions as observed evidence; this audit
// does not reclassify those assertions as independent ledger mathematics.
const checks = source.checks.map(x => ({id: x.id, status: x.status, detail: x.detail}));
assert.ok(checks.some(x => x.id === 'capacity-rollback' && x.status === 'PASS'), 'capacity rollback check');
assert.ok(evidence.some(x => x.id === 'capacity-expected-revert' && x.status === 'reverted'), 'expected revert receipt');

const blockNumber = evidence.reduce((n, x) => x.blockNumber > n ? x.blockNumber : n, 0n);
const block = await c.getBlock({blockNumber});
const report = {
  status: 'RECEIPTS_AND_DOCUMENTED_ACCOUNTING_EVIDENCE_VERIFIED',
  scope: 'Read-only receipt, transaction, canonical block, chain, and source-run accounting evidence; no independent ledger recomputation',
  chainId, releaseId: release.releaseId, verifiedAt: new Date().toISOString(),
  sourceTransactions: source.transactions.length, blockNumber, blockHash: block.hash,
  expectedRevert: evidence.find(x => x.id === 'capacity-expected-revert'),
  receipts: evidence, checks, accountingEvidence: {
    runnerChecks: checks.length,
    capacityRollback: source.checks.find(x => x.id === 'capacity-rollback')?.detail ?? null,
    capacitySnapshots: source.snapshots?.['capacity-before'] ?? null,
    note: 'Runner-recorded accounting checks and snapshots are reported as documented evidence, not independently recomputed here.'
  }
};
fs.writeFileSync(`${dir}/receipt-audit.json`, serial(report));
console.log(serial({status: report.status, transactions: evidence.length, expectedRevert: report.expectedRevert.id, blockNumber}));
