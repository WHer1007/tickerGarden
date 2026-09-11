import type { Pool } from 'pg';
import type { DeploymentIdentity, RpcLog, RpcTransport } from '../../chain/src/index.ts';
import { consensusBlock } from '../../chain/src/index.ts';
import { decodeF72Event, fixedF72Sources } from '../../events/src/index.ts';
import { publishProjection, type Json, type ProjectionRecord } from '../../projection/src/index.ts';
import { f72BootstrapConfigs } from './f72-bootstrap.generated.ts';

type Kind = 'asset' | 'quote' | 'baseline' | 'template';
type Config = { kind: Kind; id: `0x${string}`; status: number; values: Record<string, Json>; source: Source };
type Source = { chainId: 46630; blockNumber: string; blockHash: `0x${string}`; transactionHash: `0x${string}`; transactionIndex: number; logIndex: number };
const MODULE_KIND = {
  OfficialStockRegistryV1: 'asset', ApprovedQuoteRegistry: 'quote', TickerGardenBaselineRegistry: 'baseline', LaunchTemplateRegistry: 'template',
} as const;
const MODULE_ADDRESS = Object.fromEntries(Object.keys(MODULE_KIND).map((module) => [
  fixedF72Sources().find((source) => source.module === module)!.address, module,
]));
const ADDED_ID = {
  AssetRegistered: 'assetUid', QuoteAssetConfigAdded: 'configId', TickerGardenBaselineAdded: 'tickerGardenBaselineId', LaunchTemplateAdded: 'launchTemplateId',
} as const;
const STATUS_ID = {
  AssetStatusChanged: 'assetUid', QuoteAssetStatusChanged: 'configId', TickerGardenBaselineStatusChanged: 'tickerGardenBaselineId', LaunchTemplateStatusChanged: 'launchTemplateId',
} as const;

export async function projectF72Configs(input: {
  readonly pool: Pool; readonly deployment: DeploymentIdentity; readonly blockNumber: bigint; readonly blockHash: `0x${string}`;
  readonly generation: bigint; readonly primary: RpcTransport; readonly secondary: RpcTransport; readonly schemaName?: string;
}): Promise<{ revision: string; duplicate: boolean; records: number }> {
  const configs = new Map<string, Config>();
  for (const raw of f72BootstrapConfigs) {
    const config = validateConfig(raw);
    if (BigInt(config.source.blockNumber) > input.blockNumber) continue;
    configs.set(`${config.kind}:${config.id}`, config);
  }
  await verifySourceBlocks([...configs.values()], input.primary, input.secondary);
  const schema = identifier(input.schemaName ?? 'tickergarden_serverless');
  const logs = await input.pool.query<{ payload: Record<string, unknown> }>(
    `SELECT l.payload FROM ${schema}.chain_logs l JOIN ${schema}.chain_blocks b
       ON b.environment=l.environment AND b.chain_id=l.chain_id AND b.deployment_digest=l.deployment_digest AND b.hash=l.block_hash
     WHERE l.environment=$1 AND l.chain_id=$2 AND l.deployment_digest=$3 AND l.address=ANY($4::text[])
       AND l.canonical AND b.canonical AND b.finalized AND b.number<=$5 ORDER BY b.number,l.transaction_index,l.log_index`,
    [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, Object.keys(MODULE_ADDRESS), input.blockNumber.toString()],
  );
  for (const row of logs.rows) applyConfigEvent(configs, parseStoredLog(row.payload));
  const records: ProjectionRecord[] = [...configs.values()].map((config) => ({
    identity: `${config.kind}:${config.id}`, sortKey: `${config.kind}:${config.id}`, payload: config as unknown as Json,
  }));
  return publishProjection({
    pool: input.pool, deployment: input.deployment, scope: 'configs', algorithmVersion: 'f72-configs-v1', blockNumber: input.blockNumber,
    blockHash: input.blockHash, generation: input.generation, records, ...(input.schemaName ? { schemaName: input.schemaName } : {}),
  });
}

export async function verifyF72BootstrapSourceBlocks(primary: RpcTransport, secondary: RpcTransport): Promise<number> {
  const configs = f72BootstrapConfigs.map(validateConfig);
  await verifySourceBlocks(configs, primary, secondary);
  return new Set(configs.map((config) => config.source.blockNumber)).size;
}

async function verifySourceBlocks(configs: readonly Config[], primary: RpcTransport, secondary: RpcTransport): Promise<void> {
  const unique = new Map(configs.map((config) => [config.source.blockNumber, config.source.blockHash]));
  for (const [number, expected] of unique) {
    const block = await consensusBlock(primary, secondary, BigInt(number));
    if (block.hash !== expected) throw new Error('bootstrap config source block mismatch');
  }
}

function applyConfigEvent(configs: Map<string, Config>, log: RpcLog): void {
  const module = MODULE_ADDRESS[log.address] as keyof typeof MODULE_KIND | undefined;
  if (!module) return;
  const decoded = decodeF72Event(module, log);
  if (!decoded) throw new Error('configuration log cannot be decoded with frozen f72 ABI');
  const addedField = ADDED_ID[decoded.eventName as keyof typeof ADDED_ID];
  const statusField = STATUS_ID[decoded.eventName as keyof typeof STATUS_ID];
  if (!addedField && !statusField) {
    if ((decoded.eventName === 'AssetMinimumAllocationChanged' || decoded.eventName === 'AssetImplementationAccepted')) {
      const id = hex32(decoded.args.assetUid, 'assetUid');
      const current = configs.get(`asset:${id}`);
      if (!current || log.blockNumber > BigInt(current.source.blockNumber)) throw new Error('bootstrap asset values are stale');
    }
    return;
  }
  const kind = MODULE_KIND[module];
  const id = hex32(decoded.args[addedField ?? statusField!], 'config id');
  const key = `${kind}:${id}`;
  const current = configs.get(key);
  if (!current) throw new Error(`unknown ${kind} config requires an authenticated state observer`);
  if (statusField) configs.set(key, { ...current, status: safeStatus(decoded.args.newStatus), source: source(log) });
}

function validateConfig(raw: unknown): Config {
  if (!raw || typeof raw !== 'object') throw new Error('bootstrap config is invalid');
  const value = raw as Record<string, unknown>;
  if (!['asset', 'quote', 'baseline', 'template'].includes(String(value.kind)) || !value.values || typeof value.values !== 'object') throw new Error('bootstrap config shape is invalid');
  const sourceValue = value.source as Record<string, unknown>;
  return { kind: value.kind as Kind, id: hex32(value.id, 'config id'), status: safeStatus(value.status),
    values: value.values as Record<string, Json>, source: {
      chainId: 46630, blockNumber: decimal(sourceValue.blockNumber, 'source block'), blockHash: hex32(sourceValue.blockHash, 'source block hash'),
      transactionHash: hex32(sourceValue.transactionHash, 'source transaction'), transactionIndex: safeIndex(sourceValue.transactionIndex), logIndex: safeIndex(sourceValue.logIndex),
    } };
}
function source(log: RpcLog): Source { return { chainId: 46630, blockNumber: log.blockNumber.toString(), blockHash: log.blockHash,
  transactionHash: log.transactionHash, transactionIndex: safeIndex(log.transactionIndex), logIndex: safeIndex(log.logIndex) }; }
function parseStoredLog(value: Record<string, unknown>): RpcLog { return { address: address(value.address), blockHash: hex32(value.blockHash, 'block hash'),
  blockNumber: BigInt(decimal(value.blockNumber, 'block number')), transactionHash: hex32(value.transactionHash, 'transaction hash'),
  transactionIndex: BigInt(decimal(value.transactionIndex, 'transaction index')), logIndex: BigInt(decimal(value.logIndex, 'log index')),
  data: hex(value.data), topics: array(value.topics).map((item) => hex32(item, 'topic')), removed: value.removed === true }; }
function safeStatus(value: unknown): number { const result = typeof value === 'bigint' ? Number(value) : value; if (!Number.isSafeInteger(result) || Number(result) < 0 || Number(result) > 255) throw new Error('config status is invalid'); return Number(result); }
function safeIndex(value: unknown): number { const number = typeof value === 'bigint' ? Number(value) : value; if (!Number.isSafeInteger(number) || Number(number) < 0) throw new Error('source index is invalid'); return Number(number); }
function decimal(value: unknown, label: string): string { const string = String(value); if (!/^(0|[1-9][0-9]*)$/.test(string)) throw new Error(`${label} is invalid`); return string; }
function address(value: unknown): `0x${string}` { const string = String(value).toLowerCase(); if (!/^0x[0-9a-f]{40}$/.test(string)) throw new Error('address is invalid'); return string as `0x${string}`; }
function hex32(value: unknown, label: string): `0x${string}` { const string = String(value).toLowerCase(); if (!/^0x[0-9a-f]{64}$/.test(string)) throw new Error(`${label} is invalid`); return string as `0x${string}`; }
function hex(value: unknown): `0x${string}` { const string = String(value).toLowerCase(); if (!/^0x(?:[0-9a-f]{2})*$/.test(string)) throw new Error('hex data is invalid'); return string as `0x${string}`; }
function array(value: unknown): unknown[] { if (!Array.isArray(value)) throw new Error('topics are invalid'); return value; }
function identifier(value: string): string { if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error('invalid database schema name'); return `"${value}"`; }
