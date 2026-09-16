import { formatUnits } from 'viem';

const MAX = (1n << 256n) - 1n;
/** Same integer partition and ceiling as TickerGardenSupplyMath, not a USD-price estimate. */
export function graduationEconomics(supply: bigint, phantomQuote: bigint, threshold: bigint) {
  if (supply <= 0n || supply > MAX || phantomQuote <= 0n || threshold <= 0n || phantomQuote + threshold > MAX) throw new Error('Invalid graduation configuration');
  const reserved = supply * phantomQuote / (phantomQuote + threshold);
  if (reserved === 0n || reserved >= supply) throw new Error('Invalid curve supply partition');
  const sellable = supply - reserved;
  const requiredNet = (sellable * phantomQuote + reserved - 1n) / reserved;
  if (requiredNet > MAX) throw new Error('Graduation amount exceeds uint256');
  return { reserved, sellable, threshold, requiredNet } as const;
}

/** Display rounding is explicit. Exact raw-token amounts remain available alongside it. */
export function graduationAmount(raw: bigint, decimals: number) {
  if (raw <= 0n || !Number.isSafeInteger(decimals) || decimals < 6 || decimals > 18) throw new Error('Invalid paired asset units');
  const exact = formatUnits(raw, decimals);
  const [whole, fraction = ''] = exact.split('.');
  const shortened = fraction.slice(0, 6).replace(/0+$/, '');
  const display = shortened ? `${whole}.${shortened}` : whole!;
  const approximate = /[1-9]/.test(fraction.slice(6));
  return { exact, display: `${approximate ? '≈ ' : ''}${display}`, approximate };
}

export function developerBuyMode(value: string): 'create' | 'create-buy' {
  const normalized = value.trim();
  if (!normalized || /^0(?:\.0+)?$/.test(normalized)) return 'create';
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(normalized)) throw new Error('Developer buy must be a plain non-negative decimal');
  return 'create-buy';
}
