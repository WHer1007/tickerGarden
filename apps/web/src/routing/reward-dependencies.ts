// Load page-specific code before mounting its controls. A failed chunk is handled
// by the route boundary, before event handlers can start a wallet action.
export async function loadRewardPageDependencies(page: 'rewards' | 'staking'): Promise<void> {
  const common: Promise<unknown>[] = [
    import('../ui/reward-claim-dialog.ts'),
    import('../v1/generated/contracts/legacy/ProtocolFeeVault.ts'),
    import('../v1/generated/contracts/current/ProtocolFeeVault.ts'),
  ];
  const specific: Promise<unknown>[] = page === 'rewards' ? [
    import('../v1/creatorMarkets.ts'), import('../v1/holderMarkets.ts'),
    import('../v1/features/holderSnapshots.ts'), import('../v1/features/continuousRewards.ts'),
    import('../v1/features/userClaims.ts'),
    import('../v1/generated/contracts/legacy/TickerGardenCurve.ts'),
  ] : [
    import('../v1/stakeStatistics.ts'),
    import('../v1/generated/contracts/legacy/MemeStockGauge.ts'),
    import('../v1/generated/contracts/legacy/AllocationManager.ts'),
  ];
  await Promise.all([...common, ...specific]);
}
