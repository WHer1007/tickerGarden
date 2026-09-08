/** Public flow decisions. Never substitutes for pre-signature contract checks. */
export function tradingRoute(phase: number, route: {curveTradingEnabled: boolean; poolTradingEnabled: boolean}): 'curve' | 'pool' | null {
  if (phase === 0 && route.curveTradingEnabled) return 'curve';
  if (phase === 1 && route.poolTradingEnabled) return 'pool';
  return null;
}

export function stakerClaimHelp(state: {allocated: bigint; unlockAt: bigint; now: bigint; settlementPrincipal: bigint; quoteClaimable: bigint; memeClaimable: bigint}): string {
  if (state.settlementPrincipal > 0n) return 'Principal has been returned. Reward cleanup must finish before claiming.';
  if (state.allocated > 0n && (state.unlockAt === 0n || state.now < state.unlockAt)) {
    return state.unlockAt === 0n ? 'Reward claims are locked until your position unlock time is available.'
      : `Reward claims unlock ${new Date(Number(state.unlockAt) * 1000).toLocaleString()}. Adding stake restarts the lock for the entire position.`;
  }
  if (state.quoteClaimable > 0n) return 'Settled rewards are ready to claim to your connected wallet. Your stake stays in place.';
  if (state.memeClaimable > 0n) return 'Rewards are awaiting conversion to the paired asset. Original-token access is available through the fallback below.';
  return 'No rewards to claim yet. Rewards accrue from eligible trading fees while your stake is active.';
}

export function rewardTab(hash: string): 'positions' | 'staker' | 'creator' | 'treasury' | 'activity' {
  const value = hash.replace(/^#/, '');
  return value === 'staker' || value === 'creator' || value === 'treasury' || value === 'activity' ? value : 'positions';
}
