import type { Pool } from 'pg';
import { hexQuantity, RpcTransport, type DeploymentIdentity, type RpcBlock } from '../../chain/src/index.ts';

type Hash = `0x${string}`;
interface Receipt { readonly blockNumber: bigint; readonly blockHash: Hash; readonly transactionIndex: bigint; readonly execution: 'succeeded' | 'reverted' }

export async function observeTransaction(input: { readonly pool: Pool; readonly deployment: DeploymentIdentity; readonly transactionHash: Hash;
  readonly primary: RpcTransport; readonly secondary: RpcTransport; readonly schemaName?: string }) {
  if (!/^0x[0-9a-f]{64}$/.test(input.transactionHash)) throw new Error('invalid transaction hash');
  const schema = identifier(input.schemaName ?? 'tickergarden_serverless');
  const [journal, finalized, head, secondaryHead, first, second, primaryTx, secondaryTx, orphaned] = await Promise.all([
    chainTip(input.pool, schema, input.deployment, false), chainTip(input.pool, schema, input.deployment, true), input.primary.latestBlock(), input.secondary.latestBlock(),
    input.primary.call<Record<string, unknown> | null>('eth_getTransactionReceipt', [input.transactionHash]),
    input.secondary.call<Record<string, unknown> | null>('eth_getTransactionReceipt', [input.transactionHash]),
    input.primary.call<Record<string, unknown> | null>('eth_getTransactionByHash', [input.transactionHash]),
    input.secondary.call<Record<string, unknown> | null>('eth_getTransactionByHash', [input.transactionHash]),
    input.pool.query<{ block_number: string; block_hash: Hash; payload: Record<string, unknown> }>(`SELECT b.number AS block_number,r.block_hash,r.payload
      FROM ${schema}.transaction_receipts r JOIN ${schema}.chain_blocks b ON b.environment=r.environment AND b.chain_id=r.chain_id
        AND b.deployment_digest=r.deployment_digest AND b.hash=r.block_hash
      WHERE r.environment=$1 AND r.chain_id=$2 AND r.deployment_digest=$3 AND r.transaction_hash=$4 AND NOT r.canonical ORDER BY b.number DESC LIMIT 128`,
      [...deploymentIdentity(input.deployment), input.transactionHash]),
  ]);
  if (head.number < journal.block.number || secondaryHead.number < journal.block.number) throw new Error('RPC head is behind indexed journal');
  const receipt = parseReceipt(first, input.transactionHash); const otherReceipt = parseReceipt(second, input.transactionHash);
  if (receiptKey(receipt) !== receiptKey(otherReceipt)) throw new Error('RPC providers disagree on transaction receipt');
  const pending = transactionPending(primaryTx, input.transactionHash); const otherPending = transactionPending(secondaryTx, input.transactionHash);
  if (pending !== otherPending) throw new Error('RPC providers disagree on pending transaction');
  const orphanedReceipts = orphaned.rows.map((row) => ({ blockNumber: row.block_number, blockHash: row.block_hash,
    transactionIndex: String(row.payload.transactionIndex ?? '0'), execution: row.payload.execution === 'reverted' ? 'reverted' as const : 'succeeded' as const }));
  const canonical = receipt ? await canonicalReceipt(input.pool, schema, input.deployment, receipt) : false;
  const state = receipt ? (canonical && receipt.blockNumber <= finalized.block.number ? 'finalized' : 'confirmed') : pending ? 'pending' : orphanedReceipts.length ? 'reorged' : 'unknown';
  const confirmations = receipt && head.number >= receipt.blockNumber ? head.number - receipt.blockNumber + 1n : 0n;
  return {
    chainId: input.deployment.chainId, transactionHash: input.transactionHash, state, confirmations: confirmations.toString(),
    receipt: receipt ? receiptJson(receipt) : null, orphanedReceipts,
    headNumber: head.number.toString(), headHash: head.hash, finalizedNumber: finalized.block.number.toString(), finalizedHash: finalized.block.hash,
    source: 'indexed_journal_and_rpc' as const, indexedFrom: input.deployment.activationBlock.toString(), journalHeadNumber: journal.block.number.toString(),
    journalHeadHash: journal.block.hash, journalObservedAt: journal.observedAt.toISOString(), rpcObservedAt: new Date().toISOString(), displayOnly: true as const,
  };
}

async function chainTip(pool: Pool, schema: string, deployment: DeploymentIdentity, finalized: boolean): Promise<{ block: RpcBlock; observedAt: Date }> {
  const row = (await pool.query<{ number: string; hash: Hash; parent_hash: Hash; source_timestamp: Date | null; observed_at: Date }>(
    `SELECT number,hash,parent_hash,source_timestamp,observed_at FROM ${schema}.chain_blocks WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3
      AND canonical ${finalized ? 'AND finalized' : ''} ORDER BY number DESC LIMIT 1`, deploymentIdentity(deployment))).rows[0];
  if (!row) throw new Error('transaction journal is unavailable');
  return { block: { number: BigInt(row.number), hash: row.hash, parentHash: row.parent_hash, timestamp: BigInt(Math.floor((row.source_timestamp ?? row.observed_at).getTime() / 1000)) }, observedAt: row.observed_at };
}
function parseReceipt(value: Record<string, unknown> | null, expected: Hash): Receipt | null {
  if (value === null) return null;
  if (value.transactionHash !== expected || typeof value.blockNumber !== 'string' || typeof value.blockHash !== 'string' || !/^0x[0-9a-f]{64}$/.test(value.blockHash)
    || typeof value.transactionIndex !== 'string' || (value.status !== '0x0' && value.status !== '0x1')) throw new Error('invalid RPC receipt');
  return { blockNumber: hexQuantity(value.blockNumber), blockHash: value.blockHash as Hash, transactionIndex: hexQuantity(value.transactionIndex), execution: value.status === '0x1' ? 'succeeded' : 'reverted' };
}
function transactionPending(value: Record<string, unknown> | null, expected: Hash): boolean {
  if (value === null) return false; if (value.hash !== expected) throw new Error('invalid RPC transaction');
  return value.blockHash === null;
}
function receiptKey(value: Receipt | null): string { return value ? `${value.blockNumber}:${value.blockHash}:${value.transactionIndex}:${value.execution}` : 'null' }
function receiptJson(value: Receipt) { return { blockNumber: value.blockNumber.toString(), blockHash: value.blockHash, transactionIndex: value.transactionIndex.toString(), execution: value.execution } }
async function canonicalReceipt(pool: Pool, schema: string, deployment: DeploymentIdentity, receipt: Receipt): Promise<boolean> {
  const result = await pool.query(`SELECT 1 FROM ${schema}.chain_blocks WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND number=$4 AND hash=$5 AND canonical`,
    [...deploymentIdentity(deployment), receipt.blockNumber.toString(), receipt.blockHash]); return Boolean(result.rowCount);
}
function deploymentIdentity(deployment: DeploymentIdentity): [string, number, string] { return [deployment.environment, deployment.chainId, deployment.deploymentDigest] }
function identifier(value: string): string { if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error('invalid database schema name'); return `"${value}"` }
