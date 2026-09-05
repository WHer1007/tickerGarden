import { readFileSync } from 'node:fs';

export type ReleasePair = {
  symbol: string; chainId: number; tokenAddress: string; decimals: number; assetKind: string;
  assetUid: string | null; phantomQuote: string; graduationThreshold: string;
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
    for (const field of ['decimals','phantomQuote','graduationThreshold'] as const) {
      if (quote[field] !== pair[field]) throw new Error(`${pair.symbol}: release ${field} mismatch`);
    }
    if (quote.assetKind === "OFFICIAL_STOCK" && pair.assetUid && quote.assetUid !== pair.assetUid) throw new Error(`${pair.symbol}: release canonical assetUid mismatch`);
    if (pair.runtimeCodeHash && quote.runtimeCodeHash !== pair.runtimeCodeHash) throw new Error(`${pair.symbol}: release token runtime mismatch; refresh admission evidence`);
  }
}
