import {bscStakingAssets} from '../chains/bsc/generated.ts';
import robinhood from './generated/robinhood-mainnet-4663.paired-assets.json' with {type: 'json'};

// Only registered bStocks receive an alias. This is presentation metadata, never token identity.
const underlyingSymbols = new Map<string, string>(bscStakingAssets
  .filter(asset => asset.symbol.endsWith('B'))
  .map(asset => [asset.symbol, asset.symbol.slice(0, -1)]));
// File provenance stays in company-logo-sources.json, outside the browser dependency graph.
const supplementalSymbols = new Set(['USDT', 'USDC', ...underlyingSymbols.values()]);
const logos = new Map<string, string>(robinhood.assets
  .filter(asset => asset.logoUrl).map(asset => [asset.symbol, asset.logoUrl!]));

export function stockDisplaySymbol(symbol: string): string {
  const normalized = symbol.toUpperCase();
  return underlyingSymbols.get(normalized) ?? normalized;
}

/** Reuse the exact RH image URL for the same company; no third-party image requests at runtime. */
export function stockBrandLogoUrl(symbol: string): string | undefined {
  const underlying = stockDisplaySymbol(symbol);
  return logos.get(symbol.toUpperCase()) ?? logos.get(underlying)
    ?? (supplementalSymbols.has(underlying) ? `/company-logos/${underlying.toLowerCase()}.png` : undefined);
}
