import { readFileSync } from 'node:fs';

export type ReleasePair = {
  symbol: string; chainId: number; tokenAddress: string; decimals: number; assetKind: string;
  assetUid: string | null; phantomQuote: string | null; graduationThreshold: string | null;
  activationStatus: string; runtimeCodeHash: string | null;
};
const release = JSON.parse(readFileSync(new URL('../../manifests/robinhood-mainnet-4663.paired-assets.json', import.meta.url),'utf8')) as {chainId:number;assets:ReleasePair[]};

/** Additional production whitelist check; never replaces finalized chain/code/transfer preflight. */
export function assertReleasePairedAssets(candidate: unknown): void {
  const manifest = candidate as {chain?:{chainId?:number};quoteAssets?:Record<string,unknown>[]};
  if (!manifest || manifest.chain?.chainId !== release.chainId) throw new Error('Release paired assets are for Robinhood mainnet 4663 only');
  if (!Array.isArray(manifest.quoteAssets) || manifest.quoteAssets.length === 0) throw new Error('Release requires configured quote assets');
  for (const quote of manifest.quoteAssets) {
    const pair = release.assets.find(asset => asset.tokenAddress === String(quote.tokenAddress).toLowerCase());
    if (!pair) throw new Error('Quote is outside the selected release paired-asset whitelist');
    if (pair.graduationThreshold === null) throw new Error(`${pair.symbol}: production graduation threshold pending approval`);
    if (pair.phantomQuote === null || BigInt(pair.phantomQuote) * 5n !== BigInt(pair.graduationThreshold) * 2n) throw new Error(`${pair.symbol}: release phantomQuote must equal 40% of graduationThreshold`);
    for (const field of ['decimals','phantomQuote','graduationThreshold'] as const) {
      if (quote[field] !== pair[field]) throw new Error(`${pair.symbol}: release ${field} mismatch`);
    }
    if (quote.assetKind === "OFFICIAL_STOCK" && pair.assetUid && quote.assetUid !== pair.assetUid) throw new Error(`${pair.symbol}: release canonical assetUid mismatch`);
    if (pair.runtimeCodeHash && quote.runtimeCodeHash !== pair.runtimeCodeHash) throw new Error(`${pair.symbol}: release token runtime mismatch; refresh admission evidence`);
  }
}

const stakingRelease = JSON.parse(readFileSync(new URL('../../manifests/robinhood-mainnet-4663.staking-assets.json', import.meta.url),'utf8')) as {chainId:number;assets:{assetUid:string;tokenAddress:string;decimals:number;minimumAllocation:string}[]};

/** Initial production release must contain the complete user-approved universe. */
export function assertReleaseAssetCoverage(candidate: unknown): void {
  assertReleasePairedAssets(candidate);
  const manifest = candidate as {quoteAssets:Record<string,unknown>[];officialStocks?:Record<string,unknown>[]};
  const quotes = new Set(manifest.quoteAssets.map(row=>String(row.tokenAddress).toLowerCase()));
  if (quotes.size!==release.assets.length || manifest.quoteAssets.length!==release.assets.length) throw new Error('Production requires exactly 196 unique Quote assets');
  const stocks=manifest.officialStocks;
  if (!Array.isArray(stocks) || stocks.length!==stakingRelease.assets.length || new Set(stocks.map(row=>String(row.tokenAddress).toLowerCase())).size!==stakingRelease.assets.length) throw new Error('Production requires exactly 194 unique Stake assets');
  for (const row of stocks) {
    const asset=stakingRelease.assets.find(a=>a.tokenAddress===String(row.tokenAddress).toLowerCase());
    if (!asset || String(row.assetUid).toLowerCase()!==asset.assetUid || row.decimals!==asset.decimals) throw new Error('Production Stake identity mismatch');
    if (row.minimumAllocation!==asset.minimumAllocation) throw new Error('Production Stake minimumAllocation must be 0.5 raw-token units');
  }
}
