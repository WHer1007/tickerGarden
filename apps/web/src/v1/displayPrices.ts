import { parseAssetPriceSnapshot, type AssetPrice, type AssetPriceStore } from './assetPrices.ts';

const address = /^0x[0-9a-f]{40}$/;
const clean = (s: string) => s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
export type DisplayPriceView = Readonly<{ status: 'available' | 'stale' | 'unavailable'; text: string; expiresAt?: number }>;
const unavailable = (): DisplayPriceView => ({ status: 'unavailable', text: 'USD reference unavailable. On-chain amounts are shown in the Quote asset.' });

/** This view never supplies a transaction quote, multiplier, or write permission. */
export function displayPriceView(payload: unknown, chainId: number, token: string, now: number): DisplayPriceView {
  if (!address.test(token) || !Number.isFinite(now)) return unavailable();
  return priceView(parseAssetPriceSnapshot(payload, chainId, now).prices[token] ?? null);
}

function priceView(price: AssetPrice | null): DisplayPriceView {
  if (!price) return unavailable();
  if (price.status === 'stale') return { status: 'stale', text: 'USD reference expired. Waiting for a fresh price.' };
  if (price.status !== 'available' || !price.bidUsd || !price.askUsd || price.expiresAt === null || price.asOf === null) return unavailable();
  if (price.source === 'fixed_usd') return { status: 'available', text: 'USDG is valued at $1 for display calculations. This is a fixed assumption, not a live market price.', expiresAt: price.expiresAt };
  const provider = price.source === 'robinhood_rest' ? 'Robinhood' : price.source === 'coinbase_spot' ? 'Coinbase' : 'Verified testnet pool';
  return { status: 'available', text: `Quote USD reference: $${clean(price.bidUsd)}–$${clean(price.askUsd)} per ${price.symbol} token · ${provider} · ${new Date(price.asOf).toISOString()} · Display estimate only.`, expiresAt: price.expiresAt };
}

export function mountDisplayPrice(element: HTMLElement, store: AssetPriceStore, chainId: number) {
  let token: string | null = null;
  const render = () => {
    const view = token ? priceView(store.get(token)) : unavailable();
    if (element.textContent !== view.text) element.textContent = view.text; element.dataset.priceStatus = view.status;
  };
  const unsubscribe = store.subscribe(render);
  render();
  return {
    setToken(next: string | null) {
      const normalized = next?.toLowerCase() ?? null;
      const valid = normalized && address.test(normalized) ? normalized : null;
      if (valid === token) return; token = valid; render();
    },
    stop() { unsubscribe(); token = null; render(); },
  };
}
