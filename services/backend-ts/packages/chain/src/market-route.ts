import { decodeFunctionResult, parseAbi, type Hex } from 'viem';
const key = '(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)';
const tail = 'address hook,address quoteAsset,address memeToken,address gauge,address curve,address launchLocker,uint32 sourceVersion,uint8 launchPhase,bool curveTradingEnabled,bool poolTradingEnabled';
export const coreMarketRouteAbi = parseAbi([`function canonicalRoute(bytes32 marketId) view returns ((${key} poolKey,bytes32 poolId,${tail}) route)`]);
const legacyMarketRouteAbi = parseAbi([`function canonicalRoute(bytes32 marketId) view returns ((${key} poolKey,bytes32 poolId,address swapRouter,address quoter,${tail}) route)`]);
/** Exact static lengths distinguish the current core tuple from the frozen test release.
 * Legacy service fields are discarded; they never authorize a wallet's external target.
 */
export function decodeCoreMarketRoute(raw: Hex) {
  if (raw.length === 2 + 16 * 64) return decodeFunctionResult({abi:coreMarketRouteAbi,functionName:'canonicalRoute',data:raw});
  if (raw.length === 2 + 18 * 64) {
    const {swapRouter: _router,quoter: _quoter,...route}=decodeFunctionResult({abi:legacyMarketRouteAbi,functionName:'canonicalRoute',data:raw});
    return route;
  }
  throw Error('Unsupported canonical market route encoding');
}
