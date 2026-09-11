import { TickerGardenV1Client, type DisplayPriceReference, type DisplayPriceResponse } from './generated/read-api.ts';

const ADDRESS = /^0x[0-9a-f]{40}$/;
const DECIMAL = /^(0|[1-9][0-9]{0,119})(\.[0-9]{1,36})?$/;

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

function parseReference(raw: unknown, chainId: number, now: number): AssetPrice | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as DisplayPriceReference;
  const token = String(value.token).toLowerCase();
  if (value.token !== token || value.chainId !== chainId || !ADDRESS.test(token) || !/^0x[0-9a-f]{64}$/.test(value.assetUid)
    || !/^[A-Z][A-Z0-9.\-]{0,15}$/.test(value.symbol) || value.unit !== 'USD_PER_WHOLE_TOKEN'
    || !['robinhood_rest', 'coinbase_spot', 'testnet_pool_spot'].includes(value.source)
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
  if (![asOf, expiresAt, retrievedAt].every(Number.isFinite) || asOf > now || retrievedAt > now + 5_000 || retrievedAt < asOf
    || expiresAt <= asOf || expiresAt - asOf > 1_200_000) return null;
  const status = expiresAt <= now ? 'stale' as const : 'available' as const;
  return Object.freeze({ token: token as `0x${string}`, assetUid: value.assetUid, symbol: value.symbol, source: value.source, status,
    bidUsd: status === 'available' ? value.bidUsd : null, askUsd: status === 'available' ? value.askUsd : null,
    midpointUsd: status === 'available' ? midpoint(value.bidUsd, value.askUsd) : null, asOf, expiresAt });
}

export function parseAssetPriceSnapshot(payload: unknown, chainId: number, now = Date.now()): AssetPriceSnapshot {
  const empty = (): AssetPriceSnapshot => Object.freeze({ chainId, updatedAt: null, prices: Object.freeze({}) });
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return empty();
  const value = payload as DisplayPriceResponse;
  if (value.chainId !== chainId || value.displayOnly !== true || value.confidence !== 'provider_reported' || value.status !== 'configured'
    || !Array.isArray(value.references) || value.references.length > 64) return empty();
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
  let snapshot = parseAssetPriceSnapshot(null, options.chainId); let pending: Promise<void> | null = null; let stopped = false;
  let pollTimer: ReturnType<typeof setInterval> | undefined; let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  const notify = () => listeners.forEach(listener => listener(snapshot));
  const scheduleExpiry = () => {
    clearTimeout(expiryTimer); const next = Object.values(snapshot.prices).filter(price => price.status === 'available' && price.expiresAt !== null)
      .map(price => price.expiresAt!).sort((a, b) => a - b)[0];
    if (next === undefined) return;
    expiryTimer = setTimeout(() => { snapshot = parseAssetPriceSnapshot({ chainId: options.chainId, displayOnly: true, confidence: 'provider_reported', status: 'configured',
      references: Object.values(snapshot.prices).map(price => ({ ...price, chainId: options.chainId, unit: 'USD_PER_WHOLE_TOKEN', multiplier: '1',
        asOf: price.asOf === null ? null : new Date(price.asOf).toISOString(), expiresAt: price.expiresAt === null ? null : new Date(price.expiresAt).toISOString(),
        retrievedAt: new Date(price.asOf ?? Date.now()).toISOString() })) }, options.chainId); notify(); scheduleExpiry(); }, Math.max(0, next - Date.now() + 1));
  };
  const refresh = (): Promise<void> => {
    if (stopped || !options.baseUrl) return Promise.resolve(); if (pending) return pending;
    const client = new TickerGardenV1Client(options.baseUrl, (input, init) => fetcher(input, { ...init, signal: AbortSignal.timeout(8_000) }));
    pending = client.listDisplayPriceReferences().then(value => { if (stopped) return;
      if (!value || value.chainId !== options.chainId || value.displayOnly !== true || value.confidence !== 'provider_reported' || value.status !== 'configured' || !Array.isArray(value.references)) throw new Error('invalid asset price catalog');
      const next = parseAssetPriceSnapshot(value, options.chainId); if (value.references.length > 0 && Object.keys(next.prices).length === 0) throw new Error('empty asset price catalog');
      if (JSON.stringify(next) !== JSON.stringify(snapshot)) { snapshot = next; notify(); scheduleExpiry(); } }).catch(() => { /* Keep unexpired cached values. */ }).finally(() => { pending = null; });
    return pending;
  };
  const start = () => { if (stopped || pollTimer) return; void refresh(); pollTimer = setInterval(() => { if (typeof document === 'undefined' || document.visibilityState === 'visible') void refresh(); }, pollInterval); };
  const resume = () => { if (typeof navigator === 'undefined' || navigator.onLine) void refresh(); };
  if (typeof window !== 'undefined') { window.addEventListener('pageshow', resume); window.addEventListener('online', resume); }
  return {
    start, refresh,
    snapshot: () => snapshot,
    get(token: string | null | undefined): AssetPrice | null { const key = token?.toLowerCase(); return key && ADDRESS.test(key) ? snapshot.prices[key] ?? null : null; },
    midpointUsd(token: string | null | undefined): string | null { const key = token?.toLowerCase(); const price = key && ADDRESS.test(key) ? snapshot.prices[key] : null; return price?.status === 'available' ? price.midpointUsd : null; },
    subscribe(listener: Listener) { listeners.add(listener); listener(snapshot); return () => listeners.delete(listener); },
    stop() { stopped = true; clearInterval(pollTimer); clearTimeout(expiryTimer); listeners.clear(); if (typeof window !== 'undefined') { window.removeEventListener('pageshow', resume); window.removeEventListener('online', resume); } },
  };
}

export type AssetPriceStore = ReturnType<typeof createAssetPriceStore>;
