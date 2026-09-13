# Shared V1 implementation

> Current local boundary: `V1-EXEC-11`. Shared code contains no deployed-market administrator, pause/retire/takeover switch, Hook/Gauge disable path, graduation retry, terminal rescue, or management-recovery ledger.

## Foundation

- `ImmutableAccessManaged` and `DelayedUnpause` implement selector-scoped AccessManager authorization and the state-relative 24-hour unpause delay for Asset/Quote/TickerGarden/Template configuration objects only.
- `V1Identifiers`, `V1Create2`, `V1MarketEconomics`, and `V1FactoryValidation` provide typed IDs, deterministic deployment, immutable economics hashes, active configuration-snapshot validation, and exact `MultiAsset.v6` Vault schema/dependency admission.
- `V1Scaffold` freezes the `V1-EXEC-11` compile identity.

## Launch and creation

- `LaunchAndBuyRouterNative` and `LaunchAndBuyRouterERC20` implement exact-value, caller-bound atomic create-and-first-buy flows.
- Factory validation reads the dynamic raw-unit `minimumAllocation` and the four configuration registries; those statuses affect new creation only.

## Shared STOCK Vault and Allocation

- `UserStockVaultIdentity` freezes OfficialStockRegistry, MarketRegistry, AllocationManager, and schema `TickerGarden.UserStockVault.MultiAsset.v6`.
- `UserStockVaultDeposits`, `UserStockVaultRewardAccounting`, and `UserStockVaultLedger` maintain exact-arrival custody, `assetUid/user/marketId` principal aggregates, Vault-authoritative effective reward weight, and rage-quit accumulator cutoffs.
- `UserStockVaultExits` implements caller-only free withdrawal and principal-first `rageQuit`. RageQuit ignores lock, minimum, asset admission status, Gauge availability, and `launchPhase`; it writes a tombstone, clears the complete allocation, and transfers exact STOCK to the owner in the same transaction.
- `AllocationManagerIncreases` and `AllocationManagerDeposits` admit new exposure only for `PoolCreated + Asset ACTIVE`; `AllocationManagerExits` keeps normal full close locked while making rageQuit reward cleanup best-effort and permissionless.

## Per-market Gauge

- `MemeStockGaugeClone` freezes seven ABI words in a 269-byte deterministic immutable-argument clone: market ID, Asset UID, Quote config ID, AllocationManager, FeeVault, Quote asset, and Meme token.
- Activation wheel/snapshot/pending/locked-position layers provide bounded 30-second activation and 24-hour normal close without custody of STOCK.
- Accumulator/settlement/forfeiture layers maintain independent Quote/Meme rewards. Every rageQuit forfeiture is removed from the Gauge and reserved as platform revenue, regardless of surviving active stake; it is never redistributed. FeeVault failure leaves a permissionless deferred flush.
- There is no Gauge administrator or disable state.

## v4 Hook and fees

- `TickerGardenMemeHookBinding` and `TickerGardenMemeHookLifecycle` bind one canonical pool through `NONE -> EXPECTED -> INITIALIZE_SEEN -> ACTIVE`. No transition leaves `ACTIVE`.
- `TickerGardenMemeHookFeeCalculation` and `TickerGardenMemeHookFeeExecution` compute the selected-currency fee and credit the full amount to exact FeeVault liabilities; no LP donate path exists.
- `ProtocolFeeVaultCurveCredit`, `ProtocolFeeVaultV4Credit`, `ProtocolFeeVaultV4Accounting`, and `ProtocolFeeVaultLiabilities` cover exact source/version checks, atomic begin/finalize balance-delta proofs for both Curve and v4 credits, fee buckets, fixed-recipient liabilities, claims, and forfeiture reserves. Pre-existing Vault balances cannot be reused as new Curve receipts. There is no recovery cap/root/claim layer.

## Graduation and permanent liquidity

- `GraduationExecutorEntry`, `GraduationExecutorAssetAccounting`, and `GraduationExecutorPoolExecution` authenticate the exact Curve, consume only the exact assets delivered by the final buy, deploy/bind the Locker, initialize and mint the canonical v4 pool, permanently lock both-currency dust, activate the Hook, and commit `PoolCreated` atomically.
- `LaunchLockerBinding` and `LaunchLockerCustody` permanently isolate the full-range Position NFT and balances per market. `LaunchLockerCompounding` adds public fee collection and Keeper-bounded reinvestment of separately accounted fees; position principal and observed unrelated balances remain isolated.

Configuration controls can stop new admission or new STOCK exposure, but cannot alter existing Curve/v4 trading or block principal exit. Target-chain identities, production deployment manifest, independent audit, and live E2E remain external gates.
