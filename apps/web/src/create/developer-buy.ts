/** Read on demand, coalescing calls and caching failures as unavailable (never zero). */
export class DeveloperBuyBalanceCache {
  private entries = new Map<string, { expires: number; result: Promise<bigint | null> }>();
  private readonly now: () => number;
  private readonly ttl: number;
  constructor(now = Date.now, ttl = 30_000) { this.now = now; this.ttl = ttl; }
  read(key: string, fetchBalance: () => Promise<bigint>): Promise<bigint | null> {
    const cached = this.entries.get(key);
    if (cached && cached.expires > this.now()) return cached.result;
    const entry = { expires: Infinity, result: Promise.resolve<bigint | null>(null) };
    entry.result = Promise.resolve().then(fetchBalance).catch(() => null).then(balance => {
      entry.expires = this.now() + this.ttl;
      return balance;
    });
    this.entries.set(key, entry);
    return entry.result;
  }
}

export function developerBuyNotice(input: {
  amount: bigint; balance: bigint; symbol: string; displayAmount: string; native: boolean; autoBuy: boolean;
}): string {
  if (input.amount <= input.balance) return '';
  if (input.native) return 'Insufficient ETH. Add ETH for your buy, launch fee and gas.';
  if (!input.autoBuy) return `Insufficient ${input.symbol}. Automatic purchase is unavailable for this asset.`;
  return `Insufficient ${input.symbol}. At launch, we’ll use ETH to buy the full ${input.displayAmount} ${input.symbol}. Keep enough ETH for the purchase, launch fee and gas.`;
}
