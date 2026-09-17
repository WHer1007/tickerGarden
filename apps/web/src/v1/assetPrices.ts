import { TickerGardenV1Client, type DisplayPriceReference, type DisplayPriceResponse } from './generated/read-api.ts';

const ADDRESS = /^0x[0-9a-f]{40}$/;
const DECIMAL = /^(0|[1-9][0-9]{0,119})(\.[0-9]{1,36})?$/;
const MAX_PRICE_REFERENCES = 256;

export type AssetPrice = Readonly<{
  token: `0x${string}`;
  assetUid: `0x${string}`;
  symbol: string;
  source: DisplayPriceReference['source'];
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

function parseReference(raw: unknown, chainId: number): AssetPrice | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as DisplayPriceReference;
  const token = String(value.token).toLowerCase();
  if (value.source === 'fixed_usd' && (value.symbol !== 'USDG' || value.bidUsd !== '1' || value.askUsd !== '1' || value.multiplier !== '1')) return null;
  if (value.token !== token || value.chainId !== chainId || !ADDRESS.test(token) || !/^0x[0-9a-f]{64}$/.test(value.assetUid)
    || !/^[A-Z][A-Z0-9.\-]{0,15}$/.test(value.symbol) || value.unit !== 'USD_PER_WHOLE_TOKEN'
    || !['robinhood_rest', 'coinbase_spot', 'testnet_pool_spot', 'fixed_usd'].includes(value.source)
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
  return Object.freeze({ token: token as `0x${string}`, assetUid: value.assetUid, symbol: value.symbol, source: value.source, status: value.status,
    bidUsd: value.status === 'available' ? value.bidUsd : null, askUsd: value.status === 'available' ? value.askUsd : null,
    midpointUsd: value.status === 'available' ? midpoint(value.bidUsd, value.askUsd) : null, asOf, expiresAt });
}

export function parseAssetPriceSnapshot(payload: unknown, chainId: number, _now?: number): AssetPriceSnapshot {
  const empty = (): AssetPriceSnapshot => Object.freeze({ chainId, updatedAt: null, prices: Object.freeze({}) });
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return empty();
  const value = payload as DisplayPriceResponse;
  if (value.chainId !== chainId || value.displayOnly !== true || value.confidence !== 'provider_reported' || value.status !== 'configured'
    || !Array.isArray(value.references) || value.references.length > MAX_PRICE_REFERENCES) return empty();
  const prices: Record<string, AssetPrice> = {}; const duplicates = new Set<string>(); let updatedAt: number | null = null;
  for (const raw of value.references) {
    const parsed = parseReference(raw, chainId); if (!parsed || duplicates.has(parsed.token)) continue;
    if (prices[parsed.token]) { delete prices[parsed.token]; duplicates.add(parsed.token); continue; }
    prices[parsed.token] = parsed; if (parsed.asOf !== null) updatedAt = Math.max(updatedAt ?? 0, parsed.asOf);
  }
  return Object.freeze({ chainId, updatedAt, prices: Object.freeze(prices) });
}

export function createAssetPriceStore(options: { baseUrl: string | null; chainId: number; fetcher?: typeof fetch; pollIntervalMs?: number }) {
  const listeners = new Set<Listener>(); const fetcher = options.fetcher ?? fetch; const pollInterval = options.pollIntervalMs ?? 60_000;
  let snapshot = parseAssetPriceSnapshot(null, options.chainId); let pending: Promise<void> | null = null; let stopped = false; let active = false; let lastRequestAt = 0;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  const notify = () => listeners.forEach(listener => listener(snapshot));
  const refresh = (): Promise<void> => {
    if (stopped || !options.baseUrl) return Promise.resolve(); if (pending) return pending;
    lastRequestAt = Date.now();
    const client = new TickerGardenV1Client(options.baseUrl, (input, init) => fetcher(input, { ...init, signal: AbortSignal.timeout(8_000) }));
    pending = client.listDisplayPriceReferences().then(value => { if (stopped) return;
      if (!value || value.chainId !== options.chainId || value.displayOnly !== true || value.confidence !== 'provider_reported' || value.status !== 'configured' || !Array.isArray(value.references)) throw new Error('invalid asset price catalog');
      const next = parseAssetPriceSnapshot(value, options.chainId); if (value.references.length > 0 && Object.keys(next.prices).length === 0) throw new Error('empty asset price catalog');
      if (JSON.stringify(next) !== JSON.stringify(snapshot)) { snapshot = next; notify(); } }).catch(() => { /* Retain the last valid same-chain snapshot. */ }).finally(() => { pending = null; });
    return pending;
  };
  const start = () => { if (stopped || pollTimer) return; active = true; void refresh(); pollTimer = setInterval(() => { if (typeof document === 'undefined' || document.visibilityState === 'visible') void refresh(); }, pollInterval); };
  const resume = () => { if (active && Date.now() - lastRequestAt >= 1000 && (typeof document === 'undefined' || document.visibilityState === 'visible') && (typeof navigator === 'undefined' || navigator.onLine)) void refresh(); };
  if (typeof window !== 'undefined') { window.addEventListener('pageshow', resume); window.addEventListener('online', resume); if(typeof document!=='undefined')document.addEventListener('visibilitychange',resume); }
  return {
    start, refresh,
    pause() { active = false; clearInterval(pollTimer); pollTimer = undefined; },
    snapshot: () => snapshot,
    get(token: string | null | undefined): AssetPrice | null { const key = token?.toLowerCase(); return key && ADDRESS.test(key) ? snapshot.prices[key] ?? null : null; },
    midpointUsd(token: string | null | undefined): string | null { const key = token?.toLowerCase(); const price = key && ADDRESS.test(key) ? snapshot.prices[key] : null; return price?.status === 'available' ? price.midpointUsd : null; },
    subscribe(listener: Listener) { listeners.add(listener); listener(snapshot); return () => listeners.delete(listener); },
    stop() { stopped = true; clearInterval(pollTimer); listeners.clear(); if (typeof window !== 'undefined') { window.removeEventListener('pageshow', resume); window.removeEventListener('online', resume); if(typeof document!=='undefined')document.removeEventListener('visibilitychange',resume); } },
  };
}

export type AssetPriceStore = ReturnType<typeof createAssetPriceStore>;
