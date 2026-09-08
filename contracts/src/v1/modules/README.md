# V1 protocol modules

> Current local implementation: `V1-EXEC-11`, 19 canonical modules. Target-chain deployment, independent audit, and production approval remain separate gates.

| Module | Role |
|---|---|
| `OfficialStockRegistryV1` | Append-only STOCK identity, shared-Vault binding, decimals, dynamic `minimumAllocation`, and asset admission status. |
| `ApprovedQuoteRegistry` | Append-only native/direct-immutable ERC-20 Quote admission plus a separate official Stock immutable-Beacon path that pins UID, canonical token, proxy fingerprint, and evidence; any identity-current `ACTIVE` config may be selected by a new market. |
| `TickerGardenBaselineRegistry` | Frozen TickerGarden curve, anti-snipe, supply, and graduation baseline. |
| `LaunchTemplateRegistry` | Frozen implementation/code identity and fee-policy template. |
| `LaunchConfigResolver` | Read-only aggregation of the three launch-configuration registries. |
| `TickerGardenFactoryV1` | Validates active configuration snapshots and atomically creates/registers one market. |
| `MarketRegistryV1` | Stores immutable `MarketConfig` and the four-field, one-way `MarketRuntime`. |
| `LaunchAndBuyRouter` | Atomically creates a market and executes the creator's first native/ERC-20 buy. |
| `TickerMemeTokenV1` | Fixed-supply, immutable-identity Meme ERC-20; no admin mint, pause, tax, or metadata mutation. |
| `TickerGardenCurve` | Executes pre-graduation trading, exact reserve accounting, sweep, and graduation trigger. |
| `UserStockVault` | Shared multi-asset STOCK custody and authoritative principal/allocation ledger. |
| `AllocationManager` | Coordinates Vault principal with a market Gauge; exposes allocate, close, and principal-first `rageQuit`. |
| `MemeStockGauge` | Per-market 269-byte immutable-argument clone for activation, weight, dual-asset rewards, and forfeiture. |
| `TickerGardenMemeHook` | Binds the canonical v4 pool and atomically accounts post-graduation fees. |
| `ProtocolFeeVault` | Exact-arrival fee liabilities, fixed-recipient claims, and forfeiture reserve accounting. |
| `GraduationExecutor` | Exact-Curve-only atomic pool creation, permanent LP/dust locking, Hook activation, and Registry commit. |
| `LaunchLocker` | Permanently locks the canonical full-range v4 position; it has no fee collection or compounding path. |
| `CreatorRevenueRegistry` | Immutable creator-beneficiary epochs with pre-graduation fee sweep on transfer. |

## Autonomous-market boundary

After `registerMarket`, there is no market-level administrator, pause, retire, hook-disable, Gauge-disable, takeover, graduation retry, terminal rescue, or reward-recovery surface. `MarketRuntime` contains only `poolId`, `sourceVersion`, and `launchPhase`, with `NotGraduated -> PoolCreated` as the only transition. The final buy either completes the canonical Pool, permanent Locker, Hook activation, and Registry commit together or reverts completely.

Asset and launch-configuration registries retain object-scoped pause/unpause/retire controls. Those controls affect new admission or new STOCK exposure only; they cannot stop an existing market's Curve/v4 trading or a user's principal exit.

`UserStockVault.rageQuit` returns the caller's full principal immediately and writes a reward-settlement tombstone before the exact STOCK transfer. Gauge cleanup and platform-forfeiture reserve recording are asynchronous and permissionless; any Quote/Meme reward forfeited by rageQuit is recorded in `ProtocolFeeVault`'s platform reserve, never redistributed to other stakers. Failure cannot roll back principal already returned. The ABI legacy `redistributed` field is retained for compatibility and is always `false`.

The canonical ABI and permissions are generated from [`spec/v1_abi_surface.json`](../../../../spec/v1_abi_surface.json) and [`spec/v1_permissions_matrix.json`](../../../../spec/v1_permissions_matrix.json). Generated artifacts must not reintroduce removed management selectors.
