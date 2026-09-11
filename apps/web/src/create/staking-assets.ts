import catalog from '../config/staking-assets.json' with { type: 'json' };
import type { ConfigReadModel } from '../v1/readApi.ts';

export const STAKING_ASSETS = catalog.assets;

/** Identity is chain + token + asset UID, never the ticker alone. */
export function stakingAssetForConfig(chainId: number, config: ConfigReadModel) {
  const token = String(config.values.stockToken ?? '').toLowerCase();
  return STAKING_ASSETS.find(asset => asset.chainId === chainId
    && asset.tokenAddress.toLowerCase() === token
    && asset.assetUid.toLowerCase() === config.id.toLowerCase());
}

/** Local listing approval cannot override the on-chain registry. */
export function isListedStakingAsset(chainId: number, config: ConfigReadModel): boolean {
  return config.status === 1 && stakingAssetForConfig(chainId, config)?.enabled === true;
}
