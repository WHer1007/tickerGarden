import { TickerGardenV1Client } from './generated/read-api.ts';

const address = /^0x[0-9a-f]{40}$/;
const decimal = /^(0|[1-9][0-9]{0,119})(\.[0-9]{1,36})?$/;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const positive = (v: unknown): v is string => typeof v === 'string' && decimal.test(v) && /[1-9]/.test(v);
function compare(a: string, b: string): number {
  const [ai, af = ''] = a.split('.'); const [bi, bf = ''] = b.split('.');
  const scale = Math.max(af.length, bf.length);
  const x = BigInt(ai + af.padEnd(scale, '0')); const y = BigInt(bi + bf.padEnd(scale, '0'));
  return x < y ? -1 : x > y ? 1 : 0;
}
const clean = (s: string) => s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
export type DisplayPriceView = Readonly<{ status: 'available' | 'stale' | 'unavailable'; text: string; expiresAt?: number }>;
const unavailable = (): DisplayPriceView => ({ status: 'unavailable', text: 'USD reference unavailable. On-chain amounts are shown in the Quote asset.' });

/** This view never supplies a transaction quote, multiplier, or write permission. */
export function displayPriceView(payload: unknown, chainId: number, token: string, now: number): DisplayPriceView {
  if (!address.test(token) || !Number.isFinite(now) || !object(payload) || payload.chainId !== chainId || payload.displayOnly !== true || payload.confidence !== 'provider_reported' || !['configured', 'not_configured'].includes(String(payload.status)) || !Array.isArray(payload.references) || payload.references.length > 64) return unavailable();
  if (payload.status === 'not_configured') return unavailable();
  const matches = payload.references.filter(v => object(v) && v.token === token);
  if (matches.length !== 1) return unavailable();
  const r = matches[0];
  if (!object(r) || r.chainId !== chainId || r.source !== 'robinhood_rest' || r.unit !== 'USD_PER_WHOLE_TOKEN' || typeof r.symbol !== 'string' || !/^[A-Z][A-Z0-9.\-]{0,15}$/.test(r.symbol) || typeof r.assetUid !== 'string' || !/^0x[0-9a-f]{64}$/.test(r.assetUid)) return unavailable();
  if (r.status === 'stale') return { status: 'stale', text: 'USD reference expired. Waiting for a fresh price.' };
  if (r.status !== 'available' || !positive(r.bidUsd) || !positive(r.askUsd) || !positive(r.multiplier) || compare(r.bidUsd, r.askUsd) > 0) return unavailable();
  if (typeof r.asOf !== 'string' || typeof r.expiresAt !== 'string' || typeof r.retrievedAt !== 'string') return unavailable();
  const asOf = Date.parse(r.asOf); const expiry = Date.parse(r.expiresAt); const retrieved = Date.parse(r.retrievedAt);
  if (![asOf, expiry, retrieved].every(Number.isFinite) || asOf > now || retrieved > now + 5000 || retrieved < asOf || expiry <= asOf || expiry - asOf > 300000) return unavailable();
  if (expiry <= now) return { status: 'stale', text: 'USD reference expired. Waiting for a fresh price.' };
  // API prices already include the REST multiplier. Preserve decimal strings.
  return { status: 'available', text: `Quote USD reference: $${clean(r.bidUsd)}–$${clean(r.askUsd)} per ${r.symbol} token · Robinhood · ${new Date(asOf).toISOString()} · Display estimate only.`, expiresAt: expiry };
}

function waitForPrice<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  let cancel = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    cancel = () => reject(new Error('Price request interrupted'));
    if (signal.aborted) cancel(); else signal.addEventListener('abort', cancel, { once: true });
  });
  return Promise.race([pending, interrupted]).finally(() => signal.removeEventListener('abort', cancel));
}

export function mountDisplayPrice(element: HTMLElement, baseUrl: string | null, chainId: number) {
  let token: string | null = null; let controller: AbortController | null = null;
  let generation = 0; let payload: unknown; let stopped = false;
  const render = () => { const view = token ? displayPriceView(payload, chainId, token, Date.now()) : unavailable(); if (element.textContent !== view.text) element.textContent = view.text; element.dataset.priceStatus = view.status; };
  const refresh = async () => {
    if (stopped || !token || !baseUrl || controller) return;
    const ownGeneration = generation; const abort = new AbortController(); controller = abort;
    const timeout = setTimeout(() => abort.abort(), 8000);
    try {
      const client = new TickerGardenV1Client(baseUrl, (input, init) => fetch(input, { ...init, signal: abort.signal, cache: 'no-store' }));
      const value: unknown = await waitForPrice(client.listDisplayPriceReferences(), abort.signal);
      if (ownGeneration === generation && !stopped) payload = value;
    } catch { if (ownGeneration === generation && !stopped) payload = undefined; }
    finally { clearTimeout(timeout); if (controller === abort) controller = null; if (ownGeneration === generation && !stopped) render(); }
  };
  // Local expiry is checked even when requests fail or a browser tab resumes.
  const expiryTimer = setInterval(render, 1000);
  const refreshTimer = setInterval(() => { void refresh(); }, 30000);
  const resume = () => { render(); void refresh(); };
  if (typeof window !== 'undefined') window.addEventListener('pageshow', resume);
  render();
  return {
    setToken(next: string | null) {
      const normalized = next?.toLowerCase() ?? null;
      const valid = normalized && address.test(normalized) ? normalized : null;
      if (valid === token) return;
      generation++; controller?.abort(); controller = null; token = valid; payload = undefined; render(); void refresh();
    },
    stop() { stopped = true; generation++; controller?.abort(); clearInterval(expiryTimer); clearInterval(refreshTimer); if (typeof window !== 'undefined') window.removeEventListener('pageshow', resume); payload = undefined; render(); },
  };
}
