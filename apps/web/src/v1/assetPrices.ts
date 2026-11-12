import { TickerGardenV1Client, type DisplayPriceReference, type DisplayPriceResponse } from './readApi.ts';
import { bscStakingAssets } from '../chains/bsc/generated.ts';

const ADDRESS = /^0x[0-9a-f]{40}$/;
const DECIMAL = /^(0|[1-9][0-9]{0,119})(\.[0-9]{1,36})?$/;
const MAX_PRICE_REFERENCES = 256;

export type AssetPrice = Readonly<{
  token: `0x${string}`;
  assetUid: `0x${string}`;
  symbol: string;
  source: DisplayPriceReference['source'] | 'binance_spot';
  status: DisplayPriceReference['status'];
  bidUsd: string | null;
  askUsd: string | null;
  midpointUsd: string | null;
  asOf: number | null;
  expiresAt: number | null;
}>;

export type AssetPriceSnapshot = Readonly<{
  chainId: number;
  updatedAt: number | null;
  prices: Readonly<Record<string, AssetPrice>>;
}>;

type Listener = (snapshot: AssetPriceSnapshot) => void;

function midpoint(left: string, right: string): string {
  const scale = Math.max((left.split('.')[1] ?? '').length, (right.split('.')[1] ?? '').length);
  const read = (value: string) => { const [whole, fraction = ''] = value.split('.'); return BigInt(whole! + fraction.padEnd(scale, '0')); };
  const sum = read(left) + read(right); const denominator = 2n * 10n ** BigInt(scale);
  const precision = 36n; const scaled = sum * 10n ** precision / denominator;
  return `${scaled / 10n ** precision}.${(scaled % 10n ** precision).toString().padStart(Number(precision), '0')}`.replace(/\.?0+$/, '') || '0';
}

function compareDecimal(left: string, right: string): number {
  const [leftWhole, leftFraction = ''] = left.split('.'); const [rightWhole, rightFraction = ''] = right.split('.');
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const a = BigInt(leftWhole! + leftFraction.padEnd(scale, '0')); const b = BigInt(rightWhole! + rightFraction.padEnd(scale, '0'));
  return a < b ? -1 : a > b ? 1 : 0;
}

type PriceInput = Omit<DisplayPriceReference, 'chainId' | 'source'> & {
  chainId: number; source: AssetPrice['source']; decimals?: number; valuationUnit?: string;
  uiBidUsd?: string; uiAskUsd?: string;
};
const ZERO_TOKEN = `0x${'0'.repeat(40)}`, ZERO_UID = `0x${'0'.repeat(64)}`;
const BSC_STABLES: Readonly<Record<string, string>> = {
  USDT: '0x55d398326f99059ff775485246999027b3197955', USDC: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',
};
function decimalProduct(left: string, right: string): string {
  const [a, af = ''] = left.split('.'), [b, bf = ''] = right.split('.');
  const scale = af.length + bf.length, digits = (BigInt(a! + af) * BigInt(b! + bf)).toString().padStart(scale + 1, '0');
  return scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/\.?0+$/, '') : digits;
}
function validBscIdentity(value: PriceInput): boolean {
  if (value.decimals !== 18) return false;
  if (value.source === 'fixed_usd') return value.token === BSC_STABLES[value.symbol] && value.assetUid === ZERO_UID;
  if (value.source !== 'binance_spot') return false;
  if (value.symbol === 'BNB') return value.token === ZERO_TOKEN && value.assetUid === ZERO_UID;
  return bscStakingAssets.some(asset => asset.tokenAddress === value.token && asset.assetUid === value.assetUid && asset.symbol === value.symbol);
}
function parseReference(raw: unknown, chainId: number, now: number): AssetPrice | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as PriceInput;
  const token = String(value.token).toLowerCase();
  if (chainId === 56 && !validBscIdentity(value)) return null;
  if (chainId !== 56 && value.source === 'binance_spot') return null;
  if (value.source === 'fixed_usd' && ((chainId !== 56 && value.symbol !== 'USDG') || value.bidUsd !== '1' || value.askUsd !== '1' || value.multiplier !== '1')) return null;
  if (value.token !== token || value.chainId !== chainId || !ADDRESS.test(token) || !/^0x[0-9a-f]{64}$/.test(value.assetUid)
    || !/^[A-Z][A-Z0-9.\-]{0,15}$/.test(value.symbol) || value.unit !== 'USD_PER_WHOLE_TOKEN'
    || !['robinhood_rest', 'coinbase_spot', 'testnet_pool_spot', 'fixed_usd', 'binance_spot'].includes(value.source)
    || !['available', 'stale', 'unavailable'].includes(value.status)) return null;
  if (value.status !== 'available') {
    const asOf = value.asOf ? Date.parse(value.asOf) : null; const expiresAt = value.expiresAt ? Date.parse(value.expiresAt) : null;
    if ((asOf !== null && !Number.isFinite(asOf)) || (expiresAt !== null && !Number.isFinite(expiresAt))) return null;
    return Object.freeze({ token: token as `0x${string}`, assetUid: value.assetUid, symbol: value.symbol,
      source: value.source, status: value.status, bidUsd: null, askUsd: null, midpointUsd: null, asOf, expiresAt });
  }
  if (!value.bidUsd || !value.askUsd || !value.multiplier || !DECIMAL.test(value.bidUsd) || !DECIMAL.test(value.askUsd)
    || !DECIMAL.test(value.multiplier) || !/[1-9]/.test(value.bidUsd) || !/[1-9]/.test(value.askUsd) || !/[1-9]/.test(value.multiplier)
    || compareDecimal(value.bidUsd, value.askUsd) > 0 || !value.asOf || !value.expiresAt) return null;
  const asOf = Date.parse(value.asOf); const expiresAt = Date.parse(value.expiresAt); const retrievedAt = Date.parse(value.retrievedAt);
  if (![asOf, expiresAt, retrievedAt].every(Number.isFinite)) return null;
  if (chainId === 56) {
    if (value.valuationUnit !== 'RAW_TOKEN' || expiresAt <= asOf || expiresAt - asOf > 60_000 || asOf > now + 5_000 || retrievedAt > now + 5_000) return null;
    if (value.source === 'binance_spot' && token !== ZERO_TOKEN) {
      if (!value.uiBidUsd || !value.uiAskUsd || !DECIMAL.test(value.uiBidUsd) || !DECIMAL.test(value.uiAskUsd)
        || !/^(0|[1-9][0-9]{0,59})(\.[0-9]{1,18})?$/.test(value.multiplier)
        || compareDecimal(value.bidUsd, decimalProduct(value.uiBidUsd, value.multiplier)) !== 0
        || compareDecimal(value.askUsd, decimalProduct(value.uiAskUsd, value.multiplier)) !== 0) return null;
    } else if (value.multiplier !== '1') return null;
    if (expiresAt <= now) return Object.freeze({ token: token as `0x${string}`, assetUid: value.assetUid, symbol: value.symbol,
      source: value.source, status: 'stale', bidUsd: null, askUsd: null, midpointUsd: null, asOf, expiresAt });
  }
  return Object.freeze({ token: token as `0x${string}`, assetUid: value.assetUid, symbol: value.symbol, source: value.source, status: value.status,
    bidUsd: value.status === 'available' ? value.bidUsd : null, askUsd: value.status === 'available' ? value.askUsd : null,
    midpointUsd: value.status === 'available' ? midpoint(value.bidUsd, value.askUsd) : null, asOf, expiresAt });
}

export function parseAssetPriceSnapshot(payload: unknown, chainId: number, now = Date.now()): AssetPriceSnapshot {
  const empty = (): AssetPriceSnapshot => Object.freeze({ chainId, updatedAt: null, prices: Object.freeze({}) });
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return empty();
  const value = payload as DisplayPriceResponse;
  if (value.chainId !== chainId || value.displayOnly !== true || value.confidence !== 'provider_reported' || value.status !== 'configured'
    || !Array.isArray(value.references) || value.references.length > MAX_PRICE_REFERENCES) return empty();
  const prices: Record<string, AssetPrice> = {}; const duplicates = new Set<string>(); let updatedAt: number | null = null;
  for (const raw of value.references) {
    const parsed = parseReference(raw, chainId, now); if (!parsed || duplicates.has(parsed.token)) continue;
    if (prices[parsed.token]) { delete prices[parsed.token]; duplicates.add(parsed.token); continue; }
    prices[parsed.token] = parsed; if (parsed.asOf !== null) updatedAt = Math.max(updatedAt ?? 0, parsed.asOf);
  }
  return Object.freeze({ chainId, updatedAt, prices: Object.freeze(prices) });
}

export function createAssetPriceStore(options: { baseUrl: string | null; chainId: number; fetcher?: typeof fetch; pollIntervalMs?: number }) {
  const listeners = new Set<Listener>(); const fetcher = options.fetcher ?? fetch; const pollInterval = options.pollIntervalMs ?? 60_000;
  let snapshot = parseAssetPriceSnapshot(null, options.chainId); let pending: Promise<void> | null = null; let stopped = false; let active = false; let lastRequestAt = 0;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  const notify = () => listeners.forEach(listener => listener(snapshot));
  const scheduleExpiry = () => {
    clearTimeout(expiryTimer);if(options.chainId!==56||stopped)return;
    const deadlines=Object.values(snapshot.prices).filter(p=>p.status==='available'&&p.expiresAt!==null).map(p=>p.expiresAt!);
    if(!deadlines.length)return;
    expiryTimer=setTimeout(()=>{
      const now=Date.now(),prices=Object.fromEntries(Object.entries(snapshot.prices).map(([token,p])=>[token,p.status==='available'&&p.expiresAt!==null&&p.expiresAt<=now?{...p,status:'stale' as const,bidUsd:null,askUsd:null,midpointUsd:null}:p]));
      snapshot=Object.freeze({...snapshot,prices:Object.freeze(prices)});notify();scheduleExpiry();
    },Math.max(1,Math.min(...deadlines)-Date.now()));
  };
  const currentPrice = (token: string | null | undefined): AssetPrice | null => {
    const key = token?.toLowerCase(), price = key && ADDRESS.test(key) ? snapshot.prices[key] ?? null : null;
    return options.chainId === 56 && price?.status === 'available' && price.expiresAt !== null && price.expiresAt <= Date.now()
      ? { ...price, status: 'stale', bidUsd: null, askUsd: null, midpointUsd: null } : price;
  };
  const refresh = (): Promise<void> => {
    if (stopped || !options.baseUrl) return Promise.resolve(); if (pending) return pending;
    lastRequestAt = Date.now();
    const client = new TickerGardenV1Client(options.baseUrl, (input, init) => fetcher(input, { ...init, signal: AbortSignal.timeout(8_000) }));
    // BSC views consume paired assets. Local stock labels never authorize a full multiplier refresh.
    const request = options.chainId === 56 ? client.listSelectedDisplayPrices([ZERO_TOKEN,...Object.values(BSC_STABLES)]) : client.listDisplayPriceReferences();
    pending = request.then(value => { if (stopped) return;
      if (!value || value.chainId !== options.chainId || value.displayOnly !== true || value.confidence !== 'provider_reported' || value.status !== 'configured' || !Array.isArray(value.references)) throw new Error('invalid asset price catalog');
      const next = parseAssetPriceSnapshot(value, options.chainId); if (value.references.length > 0 && Object.keys(next.prices).length === 0) throw new Error('empty asset price catalog');
      if (JSON.stringify(next) !== JSON.stringify(snapshot)) { snapshot = next; notify(); scheduleExpiry(); } }).catch(() => { /* Retain evidence; BSC expiration still invalidates its displayed value. */ }).finally(() => { pending = null; });
    return pending;
  };
  const start = () => { if (stopped || pollTimer) return; active = true; void refresh(); pollTimer = setInterval(() => { if (typeof document === 'undefined' || document.visibilityState === 'visible') void refresh(); }, pollInterval); };
  const resume = () => { if (active && Date.now() - lastRequestAt >= 1000 && (typeof document === 'undefined' || document.visibilityState === 'visible') && (typeof navigator === 'undefined' || navigator.onLine)) void refresh(); };
  if (typeof window !== 'undefined') { window.addEventListener('pageshow', resume); window.addEventListener('online', resume); if(typeof document!=='undefined')document.addEventListener('visibilitychange',resume); }
  return {
    start, refresh,
    pause() { active = false; clearInterval(pollTimer); pollTimer = undefined; },
    snapshot: () => snapshot,
    get: currentPrice,
    midpointUsd(token: string | null | undefined): string | null { const price = currentPrice(token); return price?.status === 'available' ? price.midpointUsd : null; },
    subscribe(listener: Listener) { listeners.add(listener); listener(snapshot); return () => listeners.delete(listener); },
    stop() { stopped = true; clearInterval(pollTimer); clearTimeout(expiryTimer); listeners.clear(); if (typeof window !== 'undefined') { window.removeEventListener('pageshow', resume); window.removeEventListener('online', resume); if(typeof document!=='undefined')document.removeEventListener('visibilitychange',resume); } },
  };
}

export type AssetPriceStore = ReturnType<typeof createAssetPriceStore>;
