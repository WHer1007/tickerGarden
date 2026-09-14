import type { Pool } from 'pg';
import { decodeFunctionResult, encodeFunctionData, type Abi, type Address, type Hex } from 'viem';
import type { DeploymentIdentity, RpcLog, RpcTransport } from '../../chain/src/index.ts';
import { f72BootstrapConfigs } from '../../config-projector/src/f72-bootstrap.generated.ts';
import { decodeF72Event, f72ReadAbis, fixedF72Sources, type DecodedProtocolEvent } from '../../events/src/index.ts';
import { publishProjection, type Json, type ProjectionRecord } from '../../projection/src/index.ts';

type SourceBlock = { readonly chainId: 4663 | 46630; readonly blockNumber: string; readonly blockHash: Hex; readonly transactionHash: Hex; readonly transactionIndex: number; readonly logIndex: number };
type Account = { readonly user: Address; readonly assetUid: Hex; readonly vault: Address; deposited: bigint; allocated: bigint; source: SourceBlock };
type Allocation = { readonly user: Address; readonly assetUid: Hex; readonly marketId: Hex; amount: bigint; source: SourceBlock };
type Market = { readonly marketId: Hex; readonly assetUid: Hex; readonly gauge: Address; readonly quoteAsset: Address; readonly memeToken: Address; readonly stakingEnabled: boolean };
type Transport = Pick<RpcTransport, 'callAt'>;

const ZERO_ADDRESS = `0x${'0'.repeat(40)}` as Address;
const VAULT = fixedAddress('UserStockVault');
const ALLOCATION_MANAGER = fixedAddress('AllocationManager');

export async function projectF72Principal(input: {
  readonly pool: Pool; readonly deployment: DeploymentIdentity; readonly blockNumber: bigint; readonly blockHash: Hex;
  readonly generation: bigint; readonly primary: Transport; readonly secondary: Transport; readonly schemaName?: string;
}): Promise<{ readonly accounts: number; readonly positions: number }> {
  const schema = identifier(input.schemaName ?? 'tickergarden_serverless');
  const revision = `${input.blockNumber}:${input.blockHash}`;
  const marketRows = await input.pool.query<{ payload: Market }>(
    `SELECT r.payload FROM ${schema}.projection_read_records r JOIN ${schema}.publication_pointers p USING(environment,chain_id,deployment_digest,scope,revision)
     WHERE r.environment=$1 AND r.chain_id=$2 AND r.deployment_digest=$3 AND r.scope='markets' AND r.revision=$4 ORDER BY r.identity`,
    [...identity(input.deployment), revision],
  );
  const markets = new Map<string, Market>();
  for (const row of marketRows.rows) {
    const market = validatePrincipalMarket(row.payload);
    if (markets.has(market.marketId)) throw new Error('duplicate principal market');
    markets.set(market.marketId, market);
  }
  const assetVaults = new Map<string, Address>();
  for (const config of f72BootstrapConfigs) if (config.kind === 'asset') {
    const vault = address(config.values.userStockVault, 'asset vault');
    if (vault !== VAULT) throw new Error('f72 asset vault binding changed');
    assetVaults.set(config.id, vault);
  }
  const logRows = await input.pool.query<{ payload: Record<string, unknown> }>(
    `SELECT l.payload FROM ${schema}.chain_logs l JOIN ${schema}.chain_blocks b ON b.environment=l.environment AND b.chain_id=l.chain_id AND b.deployment_digest=l.deployment_digest AND b.hash=l.block_hash
     JOIN ${schema}.contract_sources s ON s.environment=l.environment AND s.chain_id=l.chain_id AND s.deployment_digest=l.deployment_digest AND s.address=l.address
     WHERE l.environment=$1 AND l.chain_id=$2 AND l.deployment_digest=$3 AND s.module='UserStockVault' AND l.canonical AND b.canonical AND b.finalized AND b.number<=$4
     ORDER BY b.number,l.transaction_index,l.log_index`,
    [...identity(input.deployment), input.blockNumber.toString()],
  );
  if (logRows.rows.length > 1_000_000) throw new Error('principal replay exceeds release bound');
  const { accounts, allocations } = replayPrincipal(logRows.rows.map((row) => {
    const log = parseStoredLog(row.payload);
    const decoded = decodeF72Event('UserStockVault', log);
    if (!decoded) throw new Error('stored Vault log cannot be decoded with frozen f72 ABI');
    return decoded;
  }), input.deployment.chainId, assetVaults);
  if (accounts.size > 10_000 || allocations.size > 10_000) throw new Error('principal publication exceeds release bound');

  const accountRecords = await mapBounded([...accounts.values()].sort(accountSort), 8, async (account): Promise<ProjectionRecord> => {
    const [deposited, allocated, free] = await Promise.all([
      consensusRead(input, account.vault, f72ReadAbis.UserStockVault as Abi, 'deposited', [account.assetUid, account.user]),
      consensusRead(input, account.vault, f72ReadAbis.UserStockVault as Abi, 'allocated', [account.assetUid, account.user]),
      consensusRead(input, account.vault, f72ReadAbis.UserStockVault as Abi, 'freeBalanceOf', [account.assetUid, account.user]),
    ]);
    if (scalar(deposited) !== account.deposited || scalar(allocated) !== account.allocated || scalar(free) !== account.deposited - account.allocated) {
      throw new Error('Vault getter and principal ledger disagree');
    }
    const payload = { user: account.user, assetUid: account.assetUid, vault: account.vault, deposited: account.deposited.toString(),
      allocated: account.allocated.toString(), free: (account.deposited - account.allocated).toString(), source: account.source } satisfies Json;
    return { identity: `${account.user}:${account.assetUid}`, sortKey: `${account.user}:${account.assetUid}`, payload };
  });

  const positionRecords = (await mapBounded([...allocations.values()].sort(allocationSort), 8, async (allocation): Promise<ProjectionRecord | null> => {
    const market = markets.get(allocation.marketId);
    const account = accounts.get(`${allocation.assetUid}:${allocation.user}`);
    if (!market || market.assetUid !== allocation.assetUid || !account) throw new Error('allocation has no canonical market or account');
    if (!market.stakingEnabled) { if (allocation.amount !== 0n) throw new Error('staking-disabled market retains an allocation'); return null; }
    const [vaultAmount, rawPosition, rawSettlement] = await Promise.all([
      consensusRead(input, account.vault, f72ReadAbis.UserStockVault as Abi, 'allocation', [allocation.assetUid, allocation.user, allocation.marketId]),
      consensusRead(input, market.gauge, f72ReadAbis.MemeStockGauge as Abi, 'positionOf', [allocation.user]),
      consensusRead(input, ALLOCATION_MANAGER, f72ReadAbis.AllocationManager as Abi, 'rageQuitSettlementPending', [allocation.marketId, allocation.user]),
    ]);
    if (scalar(vaultAmount) !== allocation.amount) throw new Error('Vault allocation getter and ledger disagree');
    const position = object(rawPosition, 'Gauge position');
    const settlement = tuple(rawSettlement, 'rage quit settlement');
    const settlementPending = boolean(settlement[0], 'rage quit pending');
    const settlementPrincipal = bigint(settlement[1], 'rage quit principal');
    if (settlementPending) return null;
    if (settlementPrincipal !== 0n) throw new Error('completed position retains rage quit settlement principal');
    const rawActive = bigint(position.activeAmount, 'active amount');
    const rawPending = bigint(position.pendingAmount, 'pending amount');
    const generation = bigint(position.pendingGeneration, 'pending generation');
    const unlock = bigint(position.unlockAt, 'unlock timestamp');
    const quoteClaimable = bigint(position.quoteClaimable, 'quote claimable');
    const memeClaimable = bigint(position.memeClaimable, 'meme claimable');
    if (rawActive + rawPending !== allocation.amount) throw new Error('Vault and Gauge allocation ledgers disagree');
    let snapshot: Record<string, unknown> | null = null;
    if (rawPending > 0n) {
      if (generation === 0n) throw new Error('pending Gauge principal has no generation');
      snapshot = object(await consensusRead(input, market.gauge, f72ReadAbis.MemeStockGauge as Abi, 'activationSnapshot', [generation]), 'activation snapshot');
    }
    const normalized = normalizeGaugePrincipal(rawActive, rawPending, generation, unlock, snapshot);
    if (allocation.amount === 0n && quoteClaimable === 0n && memeClaimable === 0n) return null;
    if (allocation.amount > 0n && unlock === 0n) throw new Error('allocated Gauge position has no unlock timestamp');
    const payload = { user: allocation.user, assetUid: allocation.assetUid, marketId: allocation.marketId,
      free: (account.deposited - account.allocated).toString(), allocated: allocation.amount.toString(), pending: normalized.pending, active: normalized.active,
      activationAt: normalized.activationAt, unlockAt: normalized.unlockAt, claimable: [
        { kind: 'quote', asset: market.quoteAsset, amount: quoteClaimable.toString() },
        { kind: 'meme', asset: market.memeToken, amount: memeClaimable.toString() },
      ], source: allocation.source } satisfies Json;
    return { identity: `${allocation.user}:${allocation.assetUid}:${allocation.marketId}`,
      sortKey: `${allocation.user}:${allocation.assetUid}:${allocation.marketId}`, payload };
  })).filter((record): record is ProjectionRecord => record !== null);

  await publishProjection({ pool: input.pool, deployment: input.deployment, scope: 'accounts', algorithmVersion: 'f72-principal-v1',
    blockNumber: input.blockNumber, blockHash: input.blockHash, generation: input.generation, records: accountRecords,
    ...(input.schemaName ? { schemaName: input.schemaName } : {}) });
  await publishProjection({ pool: input.pool, deployment: input.deployment, scope: 'positions', algorithmVersion: 'f72-positions-v1',
    blockNumber: input.blockNumber, blockHash: input.blockHash, generation: input.generation, records: positionRecords,
    ...(input.schemaName ? { schemaName: input.schemaName } : {}) });
  return { accounts: accountRecords.length, positions: positionRecords.length };
}

export function replayPrincipal(events: readonly DecodedProtocolEvent[], chainId: 4663 | 46630, assetVaults: ReadonlyMap<string, Address>) {
  const accounts = new Map<string, Account>(); const allocations = new Map<string, Allocation>();
  for (const event of events) {
    if (event.module !== 'UserStockVault' || !['StockDeposited', 'StockWithdrawn', 'AllocationLocked', 'AllocationReleased'].includes(event.eventName)) continue;
    const assetUid = hash(event.args.assetUid, 'assetUid'); const user = address(event.args.user, 'user');
    if (user === ZERO_ADDRESS) throw new Error('zero principal user');
    const vault = assetVaults.get(assetUid); if (!vault || event.log.address !== vault) throw new Error('principal event asset/Vault binding mismatch');
    const amount = bigint(event.args.amount, 'principal amount'); if (amount === 0n) throw new Error('zero principal event amount');
    const key = `${assetUid}:${user}`; const source = sourceBlock(event.log, chainId);
    const account = accounts.get(key) ?? { user, assetUid, vault, deposited: 0n, allocated: 0n, source };
    if (event.eventName === 'StockDeposited') account.deposited += amount;
    else if (event.eventName === 'StockWithdrawn') account.deposited -= amount;
    else {
      const marketId = hash(event.args.marketId, 'marketId'); const allocationKey = `${assetUid}:${user}:${marketId}`;
      const allocation = allocations.get(allocationKey) ?? { user, assetUid, marketId, amount: 0n, source };
      allocation.amount += event.eventName === 'AllocationLocked' ? amount : -amount;
      account.allocated += event.eventName === 'AllocationLocked' ? amount : -amount;
      if (allocation.amount < 0n || allocation.amount !== bigint(event.args.userMarketAllocation, 'market allocation')
        || account.allocated !== bigint(event.args.userTotalAllocated, 'total allocation')) throw new Error('principal event checkpoint mismatch');
      allocation.source = source; allocations.set(allocationKey, allocation);
    }
    if (account.deposited < 0n || account.allocated < 0n || account.allocated > account.deposited) throw new Error('principal conservation violation');
    account.source = source; accounts.set(key, account);
  }
  const sums = new Map<string, bigint>();
  for (const allocation of allocations.values()) { const key = `${allocation.assetUid}:${allocation.user}`; sums.set(key, (sums.get(key) ?? 0n) + allocation.amount); }
  for (const [key, account] of accounts) if ((sums.get(key) ?? 0n) !== account.allocated) throw new Error('allocation components do not equal account allocated total');
  return { accounts, allocations };
}

export function normalizeGaugePrincipal(activeValue: bigint, pendingValue: bigint, generation: bigint, unlock: bigint, snapshot: Record<string, unknown> | null) {
  let active = bigint(activeValue, 'active amount'); let pending = bigint(pendingValue, 'pending amount');
  bigint(generation, 'pending generation'); bigint(unlock, 'unlock timestamp');
  if (active + pending > 0n && unlock === 0n) throw new Error('allocated Gauge position has no unlock timestamp');
  let activationAt: string | null = null;
  if (pending > 0n) {
    if (generation === 0n || !snapshot) throw new Error('pending Gauge principal has no activation snapshot');
    const processed = boolean(snapshot.processed, 'activation processed'); const refs = bigint(snapshot.refs, 'activation refs');
    bigint(snapshot.quoteAccumulator, 'quote accumulator'); bigint(snapshot.memeAccumulator, 'meme accumulator');
    if (processed) { if (refs === 0n) throw new Error('processed activation has no references'); active += pending; pending = 0n; }
    else activationAt = generation.toString();
  } else if (generation !== 0n) throw new Error('empty pending position retains a generation');
  return { active: active.toString(), pending: pending.toString(), activationAt, unlockAt: unlock === 0n ? null : unlock.toString() } as const;
}

async function consensusRead(input: { readonly primary: Transport; readonly secondary: Transport; readonly blockNumber: bigint }, target: Address, abi: Abi, functionName: string, args: readonly unknown[]) {
  const data = encodeFunctionData({ abi, functionName, args });
  const [left, right] = await Promise.all([input.primary.callAt(target, data, input.blockNumber), input.secondary.callAt(target, data, input.blockNumber)]);
  if (left !== right) throw new Error(`RPC providers disagree on ${functionName}`);
  return decodeFunctionResult({ abi, functionName, data: left });
}
function sourceBlock(log: RpcLog, chainId: 4663 | 46630): SourceBlock { return { chainId, blockNumber: log.blockNumber.toString(), blockHash: log.blockHash,
  transactionHash: log.transactionHash, transactionIndex: safeNumber(log.transactionIndex, 'transaction index'), logIndex: safeNumber(log.logIndex, 'log index') }; }
function parseStoredLog(value: Record<string, unknown>): RpcLog { return { address: address(value.address, 'log address'), blockHash: hash(value.blockHash, 'blockHash'),
  blockNumber: bigint(value.blockNumber, 'blockNumber'), transactionHash: hash(value.transactionHash, 'transactionHash'), transactionIndex: bigint(value.transactionIndex, 'transactionIndex'),
  logIndex: bigint(value.logIndex, 'logIndex'), data: hex(value.data, 'data'), topics: array(value.topics, 'topics').map((item) => hash(item, 'topic')), removed: value.removed === true }; }
function accountSort(a: Account, b: Account) { return a.user.localeCompare(b.user) || a.assetUid.localeCompare(b.assetUid); }
function allocationSort(a: Allocation, b: Allocation) { return a.user.localeCompare(b.user) || a.assetUid.localeCompare(b.assetUid) || a.marketId.localeCompare(b.marketId); }
export function validatePrincipalMarket(value: Market): Market {
  const stakingEnabled = boolean(value.stakingEnabled, 'stakingEnabled');
  const gauge = address(value.gauge, 'gauge');
  if (stakingEnabled && gauge === ZERO_ADDRESS) throw new Error('gauge is zero');
  return { marketId: hash(value.marketId, 'marketId'), assetUid: hash(value.assetUid, 'assetUid'), gauge,
    quoteAsset: address(value.quoteAsset, 'quoteAsset'), memeToken: nonzeroAddress(value.memeToken, 'memeToken'), stakingEnabled };
}
function identity(deployment: DeploymentIdentity): readonly unknown[] { return [deployment.environment, deployment.chainId, deployment.deploymentDigest]; }
function fixedAddress(module: string): Address { const source = fixedF72Sources().find((item) => item.module === module); if (!source) throw new Error(`missing fixed ${module} address`); return source.address as Address; }
function scalar(value: unknown): bigint { return bigint(value, 'contract scalar'); }
function object(value: unknown, label: string): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} is invalid`); return value as Record<string, unknown>; }
function tuple(value: unknown, label: string): readonly unknown[] { if (!Array.isArray(value)) throw new Error(`${label} is invalid`); return value; }
function bigint(value: unknown, label: string): bigint { const result = typeof value === 'bigint' ? value : typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) ? BigInt(value) : -1n;
  if (result < 0n || result >= 2n ** 256n) throw new Error(`${label} is invalid`); return result; }
function boolean(value: unknown, label: string): boolean { if (typeof value !== 'boolean') throw new Error(`${label} is invalid`); return value; }
function address(value: unknown, label: string): Address {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`${label} is invalid`);
  return value.toLowerCase() as Address;
}
function nonzeroAddress(value: unknown, label: string): Address { const result = address(value, label); if (result === ZERO_ADDRESS) throw new Error(`${label} is zero`); return result; }
function hash(value: unknown, label: string): Hex { if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/.test(value)) throw new Error(`${label} is invalid`); return value as Hex; }
function hex(value: unknown, label: string): Hex { if (typeof value !== 'string' || !/^0x(?:[0-9a-f]{2})*$/.test(value)) throw new Error(`${label} is invalid`); return value as Hex; }
function array(value: unknown, label: string): unknown[] { if (!Array.isArray(value)) throw new Error(`${label} is invalid`); return value; }
function safeNumber(value: bigint, label: string): number { const result = Number(value); if (!Number.isSafeInteger(result) || result < 0) throw new Error(`${label} exceeds safe range`); return result; }
function identifier(value: string): string { if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error('invalid database schema name'); return `"${value}"`; }
async function mapBounded<T, R>(items: readonly T[], concurrency: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => { while (cursor < items.length) { const index = cursor++; output[index] = await run(items[index]!); } }));
  return output;
}
