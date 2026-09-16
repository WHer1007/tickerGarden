export const MAX_CREATOR_TAX_BPS = 500;
export function creatorTaxBps(value: string): number {
  const normalized = value.trim() || '0';
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(normalized)) throw new Error('Creator tax must have at most two decimal places');
  const [whole, fraction=''] = normalized.split('.');
  const bps = Number(whole)*100 + Number(fraction.padEnd(2,'0'));
  if (!Number.isSafeInteger(bps) || bps < 0 || bps > MAX_CREATOR_TAX_BPS) throw new Error('Creator tax must be between 0% and 5%');
  return bps;
}
/** TODO(CREATE-CREATOR-TAX): remove this gate only after Factory/Curve/Hook fee support is deployed. */
export function assertCreatorTaxSupported(bps: number): void {
  if (!Number.isInteger(bps) || bps < 0 || bps > MAX_CREATOR_TAX_BPS) throw new Error('Creator tax must be between 0% and 5%.');
}
