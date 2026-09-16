import productionRelease from './generated/robinhood-mainnet-4663.paired-assets.json' with { type: 'json' };
import robinhoodTestnetRelease from './generated/robinhood-testnet-46630.paired-assets.json' with { type: 'json' };
import arbitrumSepoliaRelease from './generated/arbitrum-sepolia-421614.paired-assets.json' with { type: 'json' };
import { ROBINHOOD_PRODUCTION_CHAIN_ID, ROBINHOOD_CHAIN_ID } from '../v1/chain.ts';
import type { ConfigReadModel } from '../v1/readApi.ts';

export type ReleasePairedAsset = {
  readonly symbol: string;
  readonly logoUrl?: string | null;
  readonly name: string;
  readonly chainId: number;
  readonly tokenAddress: string;
  readonly decimals: number;
  readonly phantomQuote: string | null;
  readonly graduationThreshold: string | null;
  readonly activationStatus: string;
  readonly admissionPath: string;
  readonly assetKind?: string;
};
type PairedAssetRelease = { readonly chainId: number; readonly observedAt: string; readonly supplyReferenceRaw: string; readonly assets: readonly ReleasePairedAsset[] };
const releases = new Map<number, PairedAssetRelease>([
  [ROBINHOOD_PRODUCTION_CHAIN_ID, productionRelease],
  [46630, robinhoodTestnetRelease],
  [421614, arbitrumSepoliaRelease],
]);
const release = releases.get(ROBINHOOD_CHAIN_ID);
if (!release) throw new Error(`No paired-asset manifest for chain ${ROBINHOOD_CHAIN_ID}`);
export const RELEASE_PAIRED_ASSETS = release.assets;
export const RELEASE_OBSERVED_AT = release.observedAt;
export const RELEASE_CHAIN_ID = release.chainId;
export const RELEASE_SUPPLY = BigInt(release.supplyReferenceRaw);

/** Returns the release catalog for the selected network; unknown networks have no catalog. */
export function pairedAssetsForChain(chainId: number): readonly ReleasePairedAsset[] {
  return releases.get(chainId)?.assets ?? [];
}

/** A release selection is not a chain activation. Only matching own-registry configs can sign. */
export function activePairedConfig(asset: ReleasePairedAsset, configs: readonly ConfigReadModel[], chainId: number): ConfigReadModel | undefined {
  if (chainId !== asset.chainId || asset.graduationThreshold === null || asset.phantomQuote === null) return undefined;
  return configs.find(config => config.kind === 'quote' && config.status === 1
    && String(config.values.quoteAsset).toLowerCase() === asset.tokenAddress
    && config.values.quoteDecimals === asset.decimals
    && config.values.phantomQuote === asset.phantomQuote
    && config.values.graduationThreshold === asset.graduationThreshold);
}
export function releasePairForSelection(value: string, configs: readonly ConfigReadModel[]): ReleasePairedAsset | undefined {
  if (value.startsWith('pending:')) return RELEASE_PAIRED_ASSETS.find(asset => value === `pending:${asset.symbol}`);
  const config = configs.find(item => item.id === value);
  return config ? RELEASE_PAIRED_ASSETS.find(asset => asset.tokenAddress === String(config.values.quoteAsset).toLowerCase()) : undefined;
}

// Frontend-only pause following the mainnet simple-route review. Registry stays unchanged.
const pausedQuoteAddresses = new Set([
  '0x95052ddcd5dc25641657424a8cf04834997e1730', // SATS
  '0x2f62fc9fabb470c690f141c28340ed832bb27020', // BND
]);
export function isQuoteSelectionPaused(asset: ReleasePairedAsset): boolean {
  return asset.chainId === ROBINHOOD_PRODUCTION_CHAIN_ID && pausedQuoteAddresses.has(asset.tokenAddress.toLowerCase());
}
