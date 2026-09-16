import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { RpcTransport } from '../../packages/chain/src/index.ts';
import { observeTransaction } from '../../packages/transaction-observer/src/index.ts';

const hash = (character: string): `0x${string}` => `0x${character.repeat(64)}`;
const txHash = hash('9');
const deployment = { environment: 'test' as const, chainId: 46630 as const, deploymentDigest: hash('8'), activationBlock: 4n };

test('TS-11 transaction observer distinguishes finalized, pending, unknown and reorged without implying retry', async () => {
  const finalized = await observeTransaction({ pool: pool([]), deployment, transactionHash: txHash,
    primary: rpc({ receiptBlock: 10n, pending: false }), secondary: rpc({ receiptBlock: 10n, pending: false }) });
  assert.deepEqual({ state: finalized.state, confirmations: finalized.confirmations, execution: finalized.receipt?.execution },
    { state: 'finalized', confirmations: '3', execution: 'succeeded' });

  const pending = await observeTransaction({ pool: pool([]), deployment, transactionHash: txHash,
    primary: rpc({ receiptBlock: null, pending: true }), secondary: rpc({ receiptBlock: null, pending: true }) });
  assert.equal(pending.state, 'pending'); assert.equal(pending.confirmations, '0'); assert.equal(pending.receipt, null);

  const unknown = await observeTransaction({ pool: pool([]), deployment, transactionHash: txHash,
    primary: rpc({ receiptBlock: null, pending: false }), secondary: rpc({ receiptBlock: null, pending: false }) });
  assert.equal(unknown.state, 'unknown');

  const reorged = await observeTransaction({ pool: pool([{ block_number: '9', block_hash: hash('7'), payload: { transactionIndex: '1', execution: 'reverted' } }]),
    deployment, transactionHash: txHash, primary: rpc({ receiptBlock: null, pending: false }), secondary: rpc({ receiptBlock: null, pending: false }) });
  assert.equal(reorged.state, 'reorged'); assert.equal(reorged.orphanedReceipts[0]?.execution, 'reverted');
});

function pool(orphaned: unknown[]): Pool {
  return { query: async (sql: string) => {
    if (sql.includes('transaction_receipts')) return { rows: orphaned, rowCount: orphaned.length };
    if (sql.includes('AND finalized')) return { rows: [{ number: '10', hash: hash('a'), parent_hash: hash('b'), source_timestamp: new Date('2026-01-01T00:00:10Z'), observed_at: new Date('2026-01-01T00:00:11Z') }], rowCount: 1 };
    if (sql.includes('ORDER BY number DESC')) return { rows: [{ number: '11', hash: hash('b'), parent_hash: hash('a'), source_timestamp: new Date('2026-01-01T00:00:11Z'), observed_at: new Date('2026-01-01T00:00:12Z') }], rowCount: 1 };
    if (sql.includes('AND canonical')) return { rows: [{}], rowCount: 1 };
    throw new Error(`unexpected SQL: ${sql}`);
  } } as unknown as Pool;
}

function rpc(state: { receiptBlock: bigint | null; pending: boolean }): RpcTransport {
  return new RpcTransport({ url: 'https://rpc.example', fetch: async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { id: number; method: string };
    let result: unknown;
    if (request.method === 'eth_getBlockByNumber') result = { number: '0xc', hash: hash('c'), parentHash: hash('b'), timestamp: '0x64' };
    else if (request.method === 'eth_getTransactionReceipt') result = state.receiptBlock === null ? null : { transactionHash: txHash,
      blockNumber: `0x${state.receiptBlock.toString(16)}`, blockHash: hash('a'), transactionIndex: '0x1', status: '0x1' };
    else if (request.method === 'eth_getTransactionByHash') result = state.pending ? { hash: txHash, blockHash: null } : null;
    else throw new Error('unexpected method');
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), { headers: { 'content-type': 'application/json' } });
  } });
}
