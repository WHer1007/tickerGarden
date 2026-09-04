# V1 protocol modules

> Current local implementation: `V1-EXEC-8`, 19 canonical modules. Target-chain deployment, independent audit, and production approval remain separate gates.

| Module | Role |
|---|---|
| `OfficialStockRegistryV1` | Append-only STOCK identity, shared-Vault binding, decimals, dynamic `minimumAllocation`, and asset admission status. |
| `ApprovedQuoteRegistry` | Append-only native/ERC-20 Quote economics and configuration admission status. |
| `PonsBaselineRegistry` | Frozen Pons-compatible curve, anti-snipe, supply, and graduation baseline. |
| `LaunchTemplateRegistry` | Frozen implementation/code identity and fee-policy template. |
| `LaunchConfigResolver` | Read-only aggregation of the three launch-configuration registries. |
| `TickerGardenFactoryV1` | Validates active configuration snapshots and atomically creates/registers one market. |
| `MarketRegistryV1` | Stores immutable `MarketConfig` and the four-field, one-way `MarketRuntime`. |
| `LaunchAndBuyRouter` | Atomically creates a market and executes the creator's first native/ERC-20 buy. |
| `TickerMemeTokenV1` | Fixed-supply, immutable-identity Meme ERC-20; no admin mint, pause, tax, or metadata mutation. |
| `PonsCompatibleCurve` | Executes pre-graduation trading, exact reserve accounting, sweep, and graduation trigger. |
| `UserStockVault` | Shared multi-asset STOCK custody and authoritative principal/allocation ledger. |
| `AllocationManager` | Coordinates Vault principal with a market Gauge; exposes allocate, close, and principal-first `rageQuit`. |
| `MemeStockGauge` | Per-market 269-byte immutable-argument clone for activation, weight, dual-asset rewards, and forfeiture. |
| `TickerGardenMemeHook` | Binds the canonical v4 pool and atomically accounts post-graduation fees. |
| `ProtocolFeeVault` | Exact-arrival fee liabilities, fixed-recipient claims, and forfeiture reserve accounting. |
| `GraduationExecutor` | Permissionless pool creation/retry and delayed fixed-recipient rescue from `Swept`. |
| `LaunchLocker` | Permanently locks the canonical full-range v4 position; it has no fee collection or compounding path. |
| `CreatorRevenueRegistry` | Immutable creator-beneficiary epochs with pre-graduation fee sweep on transfer. |

## Autonomous-market boundary

After `registerMarket`, there is no market-level administrator, pause, retire, hook-disable, Gauge-disable, takeover, or reward-recovery surface. `MarketRuntime` contains only `poolId`, `sourceVersion`, `sweptAt`, and `launchPhase`, with `NotGraduated -> Swept -> PoolCreated|Rescued` as the only transitions.

Asset and launch-configuration registries retain object-scoped pause/unpause/retire controls. Those controls affect new admission or new STOCK exposure only; they cannot stop an existing market's Curve/v4 trading or a user's principal exit.

`UserStockVault.rageQuit` returns the caller's full principal immediately and writes a reward-settlement tombstone before the exact STOCK transfer. Gauge cleanup, redistribution, and reserve recording are asynchronous and permissionless; failure cannot roll back principal already returned.

The canonical ABI and permissions are generated from [`spec/v1_abi_surface.json`](../../../../spec/v1_abi_surface.json) and [`spec/v1_permissions_matrix.json`](../../../../spec/v1_permissions_matrix.json). Generated artifacts must not reintroduce removed management selectors.
