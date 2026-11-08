import {bscStakingAssets} from '../chains/bsc/generated.ts';
import robinhood from './generated/robinhood-mainnet-4663.paired-assets.json' with {type: 'json'};
import supplemental from '../../assets/company-logo-sources.json' with {type: 'json'};

// Only registered bStocks receive an alias. This is presentation metadata, never token identity.
const underlyingSymbols = new Map<string, string>(bscStakingAssets
  .filter(asset => asset.symbol.endsWith('B'))
  .map(asset => [asset.symbol, asset.symbol.slice(0, -1)]));
const logos = new Map<string, string>([
  ...supplemental.assets.map(asset => [asset.symbol, asset.path] as const),
  ...robinhood.assets.filter(asset => asset.logoUrl).map(asset => [asset.symbol, asset.logoUrl!] as const),
]);

export function stockDisplaySymbol(symbol: string): string {
  const normalized = symbol.toUpperCase();
  return underlyingSymbols.get(normalized) ?? normalized;
}

/** Reuse the exact RH image URL for the same company; no third-party image requests at runtime. */
export function stockBrandLogoUrl(symbol: string): string | undefined {
  return logos.get(symbol.toUpperCase()) ?? logos.get(stockDisplaySymbol(symbol));
}
