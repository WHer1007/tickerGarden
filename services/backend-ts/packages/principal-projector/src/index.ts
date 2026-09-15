import { decodeFunctionResult, encodeFunctionData, type Abi, type Address, type Hex } from 'viem';
import type { RpcLog, RpcTransport } from '../../chain/src/index.ts';
import { f72ReadAbis, fixedF72Sources, type DecodedProtocolEvent } from '../../events/src/index.ts';
import { type Json, type ProjectionRecord } from '../../projection/src/index.ts';

type SourceBlock = { readonly chainId: 4663 | 46630; readonly blockNumber: string; readonly blockHash: Hex; readonly transactionHash: Hex; readonly transactionIndex: number; readonly logIndex: number };
export type Account = { readonly user: Address; readonly assetUid: Hex; readonly vault: Address; deposited: bigint; allocated: bigint; source: SourceBlock };
export type Allocation = { readonly user: Address; readonly assetUid: Hex; readonly marketId: Hex; amount: bigint; source: SourceBlock };
export type Market = { readonly marketId: Hex; readonly assetUid: Hex; readonly gauge: Address; readonly quoteAsset: Address; readonly memeToken: Address; readonly stakingEnabled: boolean };
type Transport = Pick<RpcTransport, 'callAt'>;

const ZERO_ADDRESS = `0x${'0'.repeat(40)}` as Address;
const ALLOCATION_MANAGER = fixedAddress('AllocationManager');

export { projectF72Principal } from './incremental.ts';

export async function verifyAccount(input: {primary:Transport;secondary:Transport;blockNumber:bigint}, account: Account):Promise<ProjectionRecord> {
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
}

export async function verifyPosition(input: {primary:Transport;secondary:Transport;blockNumber:bigint}, allocation:Allocation,
 loadMarket:(id:string)=>Promise<Market|undefined>,loadAccount:(user:string,assetUid:string)=>Promise<Account|undefined>):Promise<ProjectionRecord|null>{
    const market = await loadMarket(allocation.marketId);
    const account = await loadAccount(allocation.user, allocation.assetUid);
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
}

export function replayPrincipal(events: readonly DecodedProtocolEvent[], chainId: 4663 | 46630, assetVaults: ReadonlyMap<string, Address>, seed?: {accounts:Map<string,Account>;allocations:Map<string,Allocation>}) {
  const accounts = seed?.accounts ?? new Map<string, Account>(); const allocations = seed?.allocations ?? new Map<string, Allocation>();
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
  if(!seed) for (const [key, account] of accounts) if ((sums.get(key) ?? 0n) !== account.allocated) throw new Error('allocation components do not equal account allocated total');
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
export function parseStoredLog(value: Record<string, unknown>): RpcLog { return { address: address(value.address, 'log address'), blockHash: hash(value.blockHash, 'blockHash'),
  blockNumber: bigint(value.blockNumber, 'blockNumber'), transactionHash: hash(value.transactionHash, 'transactionHash'), transactionIndex: bigint(value.transactionIndex, 'transactionIndex'),
  logIndex: bigint(value.logIndex, 'logIndex'), data: hex(value.data, 'data'), topics: array(value.topics, 'topics').map((item) => hash(item, 'topic')), removed: value.removed === true }; }
export function validatePrincipalMarket(value: Market): Market {
  const stakingEnabled = boolean(value.stakingEnabled, 'stakingEnabled');
  const gauge = address(value.gauge, 'gauge');
  if (stakingEnabled && gauge === ZERO_ADDRESS) throw new Error('gauge is zero');
  return { marketId: hash(value.marketId, 'marketId'), assetUid: hash(value.assetUid, 'assetUid'), gauge,
    quoteAsset: address(value.quoteAsset, 'quoteAsset'), memeToken: nonzeroAddress(value.memeToken, 'memeToken'), stakingEnabled };
}
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
