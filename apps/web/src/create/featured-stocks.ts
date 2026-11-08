import {stockDisplaySymbol} from './stock-branding.ts';
// Editorial display order only; asset eligibility and identity remain unchanged.
export const FEATURED_STOCKS = [
  'SPCX', 'NVDA', 'TSLA', 'AAPL', 'MSFT', 'AMZN', 'GOOGL', 'META', 'AVGO', 'AMD',
  'PLTR', 'COIN', 'NFLX', 'MSTR', 'TSM', 'ORCL', 'COST', 'SPY', 'QQQ', 'BABA',
] as const;
const rank = new Map<string, number>(FEATURED_STOCKS.map((symbol, index) => [symbol, index]));
export function sortStakingAssets<T>(assets: readonly T[], symbol: (asset: T) => string): T[] {
  return [...assets].sort((a, b) => {
    const left = symbol(a).toUpperCase(), right = symbol(b).toUpperCase();
    return (rank.get(left) ?? FEATURED_STOCKS.length) - (rank.get(right) ?? FEATURED_STOCKS.length)
      || left.localeCompare(right, 'en');
  });
}

/** BSC pins its three base assets and the first ten RH featured companies. */
export function sortPairedAssets<T extends {readonly symbol: string; readonly chainId?: number}>(assets: readonly T[]): T[] {
  if (assets.some(asset => asset.chainId === 56)) {
    const preferred = ['BNB', 'USDT', 'USDC', ...FEATURED_STOCKS.slice(0, 10)];
    const priority = (symbol: string) => {
      const index = preferred.indexOf(stockDisplaySymbol(symbol));
      return index < 0 ? preferred.length : index;
    };
    return [...assets].sort((a, b) => priority(a.symbol) - priority(b.symbol)
      || a.symbol.localeCompare(b.symbol, 'en'));
  }
  const base = ['ETH', 'USDG'];
  return [
    ...base.flatMap(symbol => assets.filter(asset => asset.symbol.toUpperCase() === symbol)),
    ...sortStakingAssets(assets.filter(asset => !base.includes(asset.symbol.toUpperCase())), asset => asset.symbol),
  ];
}
