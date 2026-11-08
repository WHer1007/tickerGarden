import {stockDisplaySymbol} from './stock-branding.ts';
// Editorial display order only; asset eligibility and identity remain unchanged.
export const FEATURED_STOCKS = [
  'SPCX', 'NVDA', 'TSLA', 'AAPL', 'MSFT', 'AMZN', 'GOOGL', 'META', 'AVGO', 'AMD',
  'PLTR', 'COIN', 'NFLX', 'MSTR', 'TSM', 'ORCL', 'COST', 'SPY', 'QQQ', 'BABA',
] as const;
const rank = new Map<string, number>(FEATURED_STOCKS.map((symbol, index) => [symbol, index]));
const bscRank = new Map<string, number>(FEATURED_STOCKS.slice(0, 10).map((symbol, index) => [symbol, index]));
export function sortStakingAssets<T>(assets: readonly T[], symbol: (asset: T) => string, chainId?: number): T[] {
  const priorities = chainId === 56 ? bscRank : rank;
  const priority = (symbol: string) => priorities.get(chainId === 56 ? stockDisplaySymbol(symbol) : symbol) ?? priorities.size;
  return [...assets].sort((a, b) => {
    const left = symbol(a).toUpperCase(), right = symbol(b).toUpperCase();
    return priority(left) - priority(right)
      || left.localeCompare(right, 'en');
  });
}

/** BSC pins its three base assets and the first ten RH featured companies. */
export function sortPairedAssets<T extends {readonly symbol: string; readonly chainId?: number}>(assets: readonly T[]): T[] {
  const chainId = assets.some(asset => asset.chainId === 56) ? 56 : undefined;
  const base = chainId === 56 ? ['BNB', 'USDT', 'USDC'] : ['ETH', 'USDG'];
  return [
    ...base.flatMap(symbol => assets.filter(asset => asset.symbol.toUpperCase() === symbol)),
    ...sortStakingAssets(assets.filter(asset => !base.includes(asset.symbol.toUpperCase())), asset => asset.symbol, chainId),
  ];
}
