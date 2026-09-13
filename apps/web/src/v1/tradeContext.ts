import type {MarketReadModel} from './generated/read-api.ts';
// Only execution bindings belong to a quote context. Publication timestamps,
// display metrics and curve reserves are refreshed independently.
export function tradeContextKey(market:MarketReadModel):string {
 return JSON.stringify([market.marketId,market.memeToken,market.quoteAsset,market.quoteAssetConfigId,
  market.tickerGardenBaselineId,market.assetUid,market.curve,market.gauge,market.sourceVersion,
  market.launchPhase,market.poolId,market.poolKey,market.canonicalRoute]);
}
