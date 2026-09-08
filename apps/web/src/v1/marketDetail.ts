/** Display-only protocol rules. Never used to build quotes or settlement amounts. */
export function feeDistribution(phase: number, staking: boolean, holders: boolean, taxBps: number) {
  if (![0, 1].includes(phase) || !Number.isInteger(taxBps) || taxBps < 0 || taxBps > 500) throw new Error('Invalid fee configuration');
  const split = (active: boolean) => {
    const creator = active ? 40 : 70;
    return `Creator ${holders ? creator / 2 : creator}% · ${holders ? `Holders ${creator / 2}% · ` : ''}${active ? 'Stakers 30% · ' : ''}Platform 30%`;
  };
  const conditional = phase === 1 && staking;
  return {
    summary: conditional ? 'Distribution follows active stake' : split(false),
    rules: conditional ? `With active STOCK stake: ${split(true)}. Without active stake: ${split(false)}.` : split(false),
    note: `${phase === 0 ? 'Curve phase' : 'Pool phase'} · Holder sharing ${holders ? 'on' : 'off'}. Percentages apply to protocol fees; rounding residual goes to creator. Creator tax ${(taxBps / 100).toFixed(2)}% is separate and goes to creator.`,
  };
}
export function detailUsd(value: unknown): string {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)(\.\d+)?$/.test(value)) return 'Unavailable';
  const [whole = '', fraction = ''] = value.split('.');
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction.padEnd(2, '0').slice(0, 2)}`;
}
