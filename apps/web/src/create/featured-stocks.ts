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
