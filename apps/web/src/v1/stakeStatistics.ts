import v1Abis_ProtocolFeeVault from './generated/contracts/legacy/ProtocolFeeVault.ts';
import { decodeEventLog, formatUnits, toEventSelector, type Hex } from 'viem';

import type { MarketReadModel, TokenDetailFee } from './generated/read-api.ts';

export type Context = { chainId: number; apiBase: string; market: MarketReadModel; decimals: number; feeVault: Hex; poolManager?: Hex };
type Stats = { volume: string; fees: Map<string, bigint> | null; distribution: readonly TokenDetailFee[] | null; totalStakedRaw?: string | null };
type Cache = { requestedAt: number; volumeAt: number; feeAt: number; value: Stats };
const cache = new Map<string, Cache>();
const pending = new Map<string, Promise<Stats>>();

export function sumAllocatedFees(logs: readonly { topics: Hex[]; data: Hex }[], marketId: Hex): Map<string, bigint> {
  const totals = new Map<string, bigint>();
  for (const row of feeRows(logs, marketId)) totals.set(row.asset, (totals.get(row.asset) ?? 0n) + BigInt(row.amountRaw));
  return totals;
}
function feeRows(logs: readonly { topics: Hex[]; data: Hex }[], id: Hex): TokenDetailFee[] {
  const out = new Map<string, TokenDetailFee>();
  const signatures = ['CurveFeesSwept(bytes32,uint32,address,uint64,bytes32,uint256,uint256,uint256)', 'FeeBucketsCredited(bytes32,uint32,address,bytes32,uint256,uint256,uint256,uint256)', 'HolderFeesAccrued(bytes32,uint32,address,uint256)'].map(toEventSelector);
  for (const log of logs) {
    if (!signatures.includes(log.topics[0]!)) continue;
    const event = decodeEventLog({ abi: v1Abis_ProtocolFeeVault, topics: log.topics as [Hex, ...Hex[]], data: log.data });
    if (!('marketId' in event.args) || event.args.marketId.toLowerCase() !== id.toLowerCase()) throw Error('Wrong fee market');
    const add = (recipient: TokenDetailFee['recipient'], asset: Hex, amount: bigint) => {
      const key = `${recipient}:${asset.toLowerCase()}`;
      const old = out.get(key);
      out.set(key, { recipient, asset: asset.toLowerCase() as Hex, amountRaw: (BigInt(old?.amountRaw ?? '0') + amount).toString() });
    };
    if (event.eventName === 'CurveFeesSwept') { add('creator', event.args.quoteAsset, event.args.creatorAmount); add('platform', event.args.quoteAsset, event.args.platformAmount); }
    else if (event.eventName === 'FeeBucketsCredited') { add('creator', event.args.feeAsset, event.args.creatorAmount); add('stakers', event.args.feeAsset, event.args.stakerAmount); add('platform', event.args.feeAsset, event.args.platformAmount); }
    else if (event.eventName === 'HolderFeesAccrued') add('holders', event.args.feeAsset, event.args.amount);
  }
  return [...out.values()];
}
function validRaw(value: unknown): value is string { return typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value); }
function parseResponse(raw: any, context: Context) {
  const marketId = context.market.marketId.toLowerCase();
  if (raw?.chainId !== context.chainId || raw.displayOnly !== true || raw.marketId?.toLowerCase() !== marketId || !Number.isSafeInteger(raw.observedAt) || !Number.isSafeInteger(raw.volumeAt) || raw.observedAt < 0 || raw.volumeAt < 0 || typeof raw.feeCoverage !== 'boolean' || !Array.isArray(raw.feeDistribution) || !(raw.volumeRaw === null || validRaw(raw.volumeRaw)) || !(raw.totalStakedRaw === undefined || raw.totalStakedRaw === null || validRaw(raw.totalStakedRaw))) throw Error('Invalid market statistics response');
  const fees = new Map<string, bigint>();
  const distribution:TokenDetailFee[]=[];
  for (const row of raw.feeDistribution) {
    if (!['creator', 'stakers', 'platform', 'holders'].includes(row.recipient) || !/^0x[0-9a-f]{40}$/i.test(row.asset) || !validRaw(row.amountRaw)) throw Error('Invalid fee distribution');
    const asset=row.asset.toLowerCase();
    fees.set(asset, (fees.get(asset) ?? 0n) + BigInt(row.amountRaw));
    distribution.push({recipient:row.recipient,asset,amountRaw:row.amountRaw});
  }
  const covered=raw.feeCoverage;
  return { volume: raw.volumeRaw === null ? '' : formatUnits(BigInt(raw.volumeRaw), context.decimals), fees: covered ? fees : null, distribution:covered?distribution:null, totalStakedRaw:raw.totalStakedRaw, observedAt: raw.observedAt, volumeAt: raw.volumeAt };
}
async function read(context: Context): Promise<Stats> {
  const response = await fetch(new URL(`/v1/market-display-statistics?marketId=${context.market.marketId}`, context.apiBase), { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw Error('Statistics unavailable');
  const parsed = parseResponse(await response.json(), context);
  const value = { volume: parsed.volume, fees: parsed.fees, distribution:parsed.distribution, totalStakedRaw:parsed.totalStakedRaw };
  cache.set(`${context.chainId}:${context.apiBase}:${context.market.marketId}`, { requestedAt: Date.now(), volumeAt: parsed.volumeAt, feeAt: parsed.observedAt, value });
  return value;
}
export async function explorerStakeStatistics(context: Context, force = false): Promise<Stats> {
  const key = `${context.chainId}:${context.apiBase}:${context.market.marketId}`;
  const saved = cache.get(key);
  if (!force && saved && Date.now() - saved.requestedAt < 1_000) return saved.value;
  const active = pending.get(key); if (active) return active;
  const request = read(context); pending.set(key, request); try { return await request; } finally { pending.delete(key); }
}
export async function explorerFeeDistribution(context: Context): Promise<readonly TokenDetailFee[]> {
  const stats = await explorerStakeStatistics(context);
  if (!stats.distribution) throw Error('Fee statistics unavailable');
  return stats.distribution;
}
