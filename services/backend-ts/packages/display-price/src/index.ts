import type { Pool } from 'pg';
import type { DeploymentIdentity } from '../../chain/src/index.ts';
import { f72BootstrapConfigs } from '../../config-projector/src/f72-bootstrap.generated.ts';
import { robinhoodTestnetStockRoutes } from './testnet-routes.ts';

type Address = `0x${string}`; type Hex32 = `0x${string}`;
export interface PriceTarget { readonly chainId: 4663 | 46630; readonly token: Address; readonly assetUid: Hex32; readonly symbol: string }
export interface PriceReference extends PriceTarget { readonly source: 'robinhood_rest' | 'coinbase_spot' | 'testnet_pool_spot'; readonly unit: 'USD_PER_WHOLE_TOKEN'; readonly status: 'available' | 'stale' | 'unavailable'; readonly reason?: string; readonly bidUsd: string | null; readonly askUsd: string | null; readonly multiplier: string | null; readonly asOf: string | null; readonly expiresAt: string | null; readonly retrievedAt: string; readonly rawBidUsd?: string; readonly rawAskUsd?: string }
const API = 'https://api.robinhood.com/rhj';
const DECIMAL = /^(0|[1-9][0-9]{0,59})(\.[0-9]{1,18})?$/;

export function f72PriceTargets(): PriceTarget[] {
  return f72BootstrapConfigs.filter((item) => item.kind === 'asset').map((item) => ({ chainId: 46630 as const,
    token: String(item.values.stockToken).toLowerCase() as Address, assetUid: item.id as Hex32, symbol: String(item.values.tokenSymbol) }))
    .sort((left, right) => left.assetUid.localeCompare(right.assetUid));
}

export function multiplyDecimal(left: string, right: string): string {
  if (!DECIMAL.test(left) || !DECIMAL.test(right)) throw new Error('invalid display price decimal');
  const parse = (value: string) => { const [whole, fraction = ''] = value.split('.'); return { value: BigInt(whole! + fraction), scale: fraction.length }; };
  const a = parse(left); const b = parse(right); const scale = a.scale + b.scale; let raw = (a.value * b.value).toString();
  if (!scale) return raw; raw = raw.padStart(scale + 1, '0');
  return `${raw.slice(0, -scale)}.${raw.slice(-scale)}`.replace(/0+$/, '').replace(/\.$/, '');
}

export async function fetchPriceReferences(targets: readonly PriceTarget[], options: { readonly fetcher?: typeof fetch; readonly now?: Date; readonly maxAgeSeconds?: number } = {}): Promise<PriceReference[]> {
  if (!targets.length || targets.length > 64) throw new Error('invalid display price targets');
  const fetcher = options.fetcher ?? fetch; const retrieved = options.now ?? new Date(); const maxAge = options.maxAgeSeconds ?? 60;
  if (!Number.isSafeInteger(maxAge) || maxAge < 15 || maxAge > 300) throw new Error('invalid display price max age');
  const get = async (path: string) => { const response = await fetcher(`${API}${path}`, { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`upstream_${response.status}`); const text = await response.text(); if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw new Error('response_too_large'); return JSON.parse(text) as Record<string, unknown>; };
  let assets: unknown[]; let actions: unknown[]; let quotes: unknown[];
  try { [assets, actions, quotes] = await Promise.all([get('/assets').then((v) => array(v.assets)), get('/corporate-actions').then((v) => array(v.corpActions)), get('/prices').then((v) => array(v.quotes))]); }
  catch (error) { return targets.map((target) => unavailable(target, retrieved, error instanceof Error ? error.message : 'upstream_error')); }
  return targets.map((target) => {
    try {
      const asset = unique(assets, (row) => object(row) && (row.id === target.assetUid || row.tokenSymbol === target.symbol));
      if (asset.id !== target.assetUid || asset.tokenSymbol !== target.symbol || asset.status !== 'ASSET_STATUS_ACTIVE' || typeof asset.currentMultiplier !== 'string'
        || asset.pendingMultiplier !== '' || !matchesDeployment(asset.deployments, target)) throw new Error('asset_unavailable');
      if (actions.some((row) => object(row) && row.tokenSymbol === target.symbol && row.status !== 'CORPORATE_ACTION_STATUS_COMPLETED')) throw new Error('corporate_action_pending');
      const quote = unique(quotes, (row) => object(row) && row.tokenSymbol === target.symbol);
      if (quote.currency !== 'USD' || quote.isTradingHalt !== false || typeof quote.bid !== 'string' || typeof quote.ask !== 'string'
        || typeof quote.generatedAt !== 'string' || !matchesDeployment(quote.deployments, target)) throw new Error('quote_unavailable');
      const bid = multiplyDecimal(quote.bid, asset.currentMultiplier); const ask = multiplyDecimal(quote.ask, asset.currentMultiplier);
      if (compareDecimal(bid, ask) > 0 || !positive(bid) || !positive(ask) || !positive(asset.currentMultiplier)) throw new Error('invalid_price');
      const asOf = new Date(quote.generatedAt); if (!Number.isFinite(asOf.getTime()) || asOf > retrieved) throw new Error('invalid_timestamp');
      const expires = new Date(asOf.getTime() + maxAge * 1_000); if (expires <= retrieved) return { ...unavailable(target, retrieved, 'price_expired'), status: 'stale' as const, multiplier: asset.currentMultiplier, asOf: asOf.toISOString(), expiresAt: expires.toISOString() };
      return { ...target, source: 'robinhood_rest', unit: 'USD_PER_WHOLE_TOKEN', status: 'available', bidUsd: bid, askUsd: ask,
        multiplier: asset.currentMultiplier, asOf: asOf.toISOString(), expiresAt: expires.toISOString(), retrievedAt: retrieved.toISOString(), rawBidUsd:quote.bid, rawAskUsd:quote.ask };
    } catch (error) { return unavailable(target, retrieved, error instanceof Error ? error.message : 'invalid_response'); }
  });
}

interface TestnetPriceRpc {
  latestBlock(): Promise<{ readonly number: bigint }>;
  callAt(address: Address, data: `0x${string}`, blockNumber: bigint): Promise<`0x${string}`>;
}

const NATIVE_TOKEN = '0x0000000000000000000000000000000000000000' as const;
const NATIVE_ASSET_UID = `0x${'0'.repeat(64)}` as Hex32;
const TOKEN0_SELECTOR = '0x0dfe1681';
const TOKEN1_SELECTOR = '0xd21220a7';
const SLOT0_SELECTOR = '0x3850c7bd';

export async function fetchTestnetPriceReferences(
  targets: readonly PriceTarget[],
  options: { readonly rpc: TestnetPriceRpc; readonly fetcher?: typeof fetch; readonly now?: Date; readonly maxAgeSeconds?: number },
): Promise<PriceReference[]> {
  if (targets.length < 1 || targets.length > 64 || targets.some((target) => target.chainId !== 46630)) throw new Error('invalid testnet display price targets');
  const now = options.now ?? new Date(); const maxAge = options.maxAgeSeconds ?? 1_200;
  if (!Number.isSafeInteger(maxAge) || maxAge < 60 || maxAge > 1_200) throw new Error('invalid testnet display price max age');
  const nativeTarget: PriceTarget = { chainId: 46630, token: NATIVE_TOKEN, assetUid: NATIVE_ASSET_UID, symbol: 'ETH' };
  let ethUsd: string;
  try { ethUsd = await fetchNativeUsd(options.fetcher ?? fetch); }
  catch (error) {
    const reason = error instanceof Error ? error.message : 'native_price_unavailable';
    return [unavailableFrom(nativeTarget, now, 'coinbase_spot', reason), ...targets.map((target) => unavailableFrom(target, now, 'testnet_pool_spot', reason))];
  }
  const expiresAt = new Date(now.getTime() + maxAge * 1_000).toISOString();
  const native: PriceReference = { ...nativeTarget, source: 'coinbase_spot', unit: 'USD_PER_WHOLE_TOKEN', status: 'available', bidUsd: ethUsd, askUsd: ethUsd,
    multiplier: '1', asOf: now.toISOString(), expiresAt, retrievedAt: now.toISOString() };
  const head = await options.rpc.latestBlock();
  const routes = new Map<string, (typeof robinhoodTestnetStockRoutes)[number]>(robinhoodTestnetStockRoutes.map((route) => [route.tokenOut, route]));
  const stocks = await Promise.all(targets.map(async (target): Promise<PriceReference> => {
    try {
      const route = routes.get(target.token);
      if (!route || route.symbol !== target.symbol || route.decimals !== 18) throw new Error('route_unavailable');
      const [token0Raw, token1Raw, slot0Raw] = await Promise.all([
        options.rpc.callAt(route.pool, TOKEN0_SELECTOR, head.number),
        options.rpc.callAt(route.pool, TOKEN1_SELECTOR, head.number),
        options.rpc.callAt(route.pool, SLOT0_SELECTOR, head.number),
      ]);
      const token0 = abiAddress(token0Raw); const token1 = abiAddress(token1Raw);
      const expected = [route.tokenIn, route.tokenOut].sort();
      if (token0 !== expected[0] || token1 !== expected[1]) throw new Error('pool_identity_mismatch');
      if (!/^0x[0-9a-f]{448}$/.test(slot0Raw)) throw new Error('pool_price_unavailable');
      const sqrtPriceX96 = BigInt(`0x${slot0Raw.slice(2, 66)}`);
      if (sqrtPriceX96 <= 0n || sqrtPriceX96 >= 2n ** 160n) throw new Error('invalid_pool_price');
      let numerator = sqrtPriceX96 * sqrtPriceX96; let denominator = 2n ** 192n;
      if (route.tokenOut > route.tokenIn) [numerator, denominator] = [denominator, numerator];
      const amount = multiplyRationalDecimal(numerator, denominator, ethUsd, 18);
      if (!positive(amount)) throw new Error('invalid_pool_price');
      return { ...target, source: 'testnet_pool_spot', unit: 'USD_PER_WHOLE_TOKEN', status: 'available', bidUsd: amount, askUsd: amount,
        multiplier: '1', asOf: now.toISOString(), expiresAt, retrievedAt: now.toISOString() };
    } catch (error) { return unavailableFrom(target, now, 'testnet_pool_spot', error instanceof Error ? error.message : 'pool_price_unavailable'); }
  }));
  return [native, ...stocks];
}

export async function storePriceReferences(pool: Pool, deployment: DeploymentIdentity, references: readonly PriceReference[], schemaName = 'tickergarden_serverless'): Promise<void> {
  const schema = identifier(schemaName);
  for (const reference of references) {
    const asOf = reference.asOf ?? reference.retrievedAt; const expiresAt = reference.expiresAt ?? new Date(new Date(asOf).getTime() + 1_000).toISOString();
    const midpoint = reference.bidUsd && reference.askUsd ? midpointDecimal(reference.bidUsd, reference.askUsd) : null;
    await pool.query(`INSERT INTO ${schema}.price_references(environment,chain_id,deployment_digest,asset,source,status,value,as_of,expires_at,payload)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
    [deployment.environment, deployment.chainId, deployment.deploymentDigest, reference.token, reference.source, reference.status, midpoint, asOf, expiresAt, reference]);
  }
}

function unavailable(target: PriceTarget, now: Date, reason: string): PriceReference { return { ...target, source: 'robinhood_rest', unit: 'USD_PER_WHOLE_TOKEN', status: 'unavailable', reason, bidUsd: null, askUsd: null, multiplier: null, asOf: null, expiresAt: null, retrievedAt: now.toISOString() } }
function unavailableFrom(target: PriceTarget, now: Date, source: PriceReference['source'], reason: string): PriceReference { return { ...target, source, unit: 'USD_PER_WHOLE_TOKEN', status: 'unavailable', reason, bidUsd: null, askUsd: null, multiplier: null, asOf: null, expiresAt: null, retrievedAt: now.toISOString() } }
async function fetchNativeUsd(fetcher: typeof fetch): Promise<string> {
  const response = await fetcher('https://api.coinbase.com/v2/prices/ETH-USD/spot', { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`native_upstream_${response.status}`);
  const text = await response.text(); if (Buffer.byteLength(text) > 16_384) throw new Error('native_response_too_large');
  const body = JSON.parse(text) as { data?: { base?: unknown; currency?: unknown; amount?: unknown } };
  const amount = body.data?.amount;
  if (body.data?.base !== 'ETH' || body.data.currency !== 'USD' || typeof amount !== 'string' || !positive(amount)) throw new Error('native_response_invalid');
  return amount;
}
function abiAddress(value: string): Address { if (!/^0x0{24}[0-9a-f]{40}$/.test(value)) throw new Error('pool_identity_unavailable'); return `0x${value.slice(-40)}` as Address }
function multiplyRationalDecimal(numerator: bigint, denominator: bigint, decimal: string, precision: number): string {
  if (denominator <= 0n || !DECIMAL.test(decimal)) throw new Error('invalid_decimal_product');
  const [whole, fraction=''] = decimal.split('.'); const decimalRaw=BigInt(whole!+fraction); const decimalScale=10n**BigInt(fraction.length);
  const scale=10n**BigInt(precision); const value=numerator*decimalRaw*scale/(denominator*decimalScale);
  return `${value/scale}.${(value%scale).toString().padStart(precision,'0')}`.replace(/0+$/,'').replace(/\.$/,'');
}
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
function array(value: unknown): unknown[] { if (!Array.isArray(value) || value.length > 1024) throw new Error('invalid_response'); return value }
function unique(values: unknown[], predicate: (row: unknown) => boolean): Record<string, unknown> { const matches = values.filter(predicate); if (matches.length !== 1 || !object(matches[0])) throw new Error('identity_mismatch'); return matches[0] }
function matchesDeployment(value: unknown, target: PriceTarget): boolean { if (!Array.isArray(value)) return false; const matches = value.filter((row) => object(row) && row.chainId === target.chainId); return matches.length === 1 && String(matches[0]!.contractAddress).toLowerCase() === target.token }
function positive(value: string): boolean { return DECIMAL.test(value) && /[1-9]/.test(value) }
function compareDecimal(left: string, right: string): number { const [li, lf=''] = left.split('.'); const [ri, rf=''] = right.split('.'); const scale = Math.max(lf.length, rf.length); const a=BigInt(li!+lf.padEnd(scale,'0')); const b=BigInt(ri!+rf.padEnd(scale,'0')); return a < b ? -1 : a > b ? 1 : 0 }
function midpointDecimal(left: string, right: string): string { const scale = 18; const scaled=(value:string)=>{const [i,f='']=value.split('.');return BigInt(i!+f.padEnd(scale,'0').slice(0,scale));}; const value=(scaled(left)+scaled(right))/2n; return `${value/10n**18n}.${(value%10n**18n).toString().padStart(18,'0')}` }
function identifier(value: string): string { if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error('invalid database schema name'); return `"${value}"` }
