# V1 Legacy Contract Surface Audit — 2026-09-10

> 清理前的历史审计。兼容建议已被 2026-09-11 的 current-only 决定取代，进展见 [当前清理复审](CURRENT_CONTRACT_CLEANUP_AUDIT_2026-09-11.md)。

## Conclusion

The current Robinhood testnet release does not deploy the legacy `TreasuryDistributorV1`. Component 14 is `HolderRewardsDistributorV1` at `0x86EFd5DE382DB5AEe75A4c89B837e519153d3309`.

The release still has a `platformTreasury` (`0xD84897cD860Da0B51D39a252961B18D54fBbb266`). This is the fixed recipient of the platform fee bucket. It is a different role from the retired holder-reward Treasury/Merkle distributor and remains part of the current economics.

The repository currently mixes legacy Merkle/TWAB reward surfaces with the V4 dual-asset holder-reward release. Some items are archival only, while others are compiled into the deployed contracts and remain callable.

## Audit scope and evidence

- Current release: `deployments/releases/0x6e743e8bf90c0e91cd7de52711a1a68976401c494187f1e015fc66ef17310f95/robinhood-testnet-46630.v1.deployed.json`
- Release status: `DEPLOYED_VERIFIED_ACTIVE_TEST_ONLY`
- Factory: `0x10508E1A87715A3B00e2e559CDaddE30138C362f`
- ProtocolFeeVault: `0x22b46B58d1ac1cE8d04816BdCe55C6e8c4AAd1da`
- HolderRewardsDistributorV1: `0x86EFd5DE382DB5AEe75A4c89B837e519153d3309`
- Review covered Solidity sources, deployment builders and mode selection, generated ABI/spec artifacts, environment checks, frontend callers, backend event/read models, and the saved verified deployment inventory.

## Findings

| Severity | Surface | Current state | Required treatment |
| --- | --- | --- | --- |
| High | Canonical deployment and ABI model | `V1DeterministicDeploymentBuilder.build()` still deploys `TreasuryDistributorV1`; `buildContinuous()` replaces the same component slot with `HolderRewardsDistributorV1`. The TypeScript component list still names that slot `TreasuryDistributorV1`. Canonical ABI/spec artifacts contain both generations. | Split the manifests, interfaces, preflight, and generated clients by reward mode/release. Make V4 the only current-release path and move legacy Merkle deployment into an explicitly named legacy package. |
| Medium | Old direct reward claims | `ProtocolFeeVault.claimCreator`, `claimStaker`, and `claimStakerFor` remain callable. `HolderRewardsDistributorV1.claim` remains a Quote-only direct holder claim. They can bypass the V4 `claimUserRewards` choice and unified claim event. Recipients remain fixed, so this review found no caller-directed theft path. | In the next release, expose creator, staker, and holder claims only through the V4 user-claim flow. Keep `claimPlatform` as a separate platform operation. Version backend indexing during the transition. |
| Medium | Disabled settlement and raw-exit machinery | The deployed `ProtocolFeeVault` inherits `settlementOperator`, `setSettlementOperator`, `settleRewards`, `settleHolderRewards`, `RAW_EXIT_DELAY`, `rawRewardExitAt`, and conversion nonce/events. V4 hard-disables batch settlement through `_requiresUserClaim() == true`; raw-exit request/cancel are overridden to revert. The operator setter remains callable but cannot activate those disabled functions. | Remove this storage, ABI, events, and deployment configuration from the next V4 FeeVault. This also recovers needed EIP-170 headroom; the deployed runtime is 24,302 bytes, only 274 bytes below the limit. |
| Medium | Token Treasury burn compatibility | `TickerMemeTokenV1` still stores `_treasuryDistributor`, exposes `treasuryDistributor()`, and contains `burnTreasury()`. In V4 the address is the holder distributor. The V4 distributor has no burn call, so the burn path is operationally unreachable for new markets, although it remains in token bytecode and ABI. | Rename the distributor field/getter and remove Treasury burn support in the next token implementation if holder-reward burns are no longer part of the economics. This changes bytecode, ABI, and deterministic addresses. |
| Low | Stale runtime terminology | Factory fields use `treasuryDistributor`; the V4 holder module exposes `currentEpochId()` that always returns bucket `1`; Quote funding is named `fundCreatorFees()`. These are active compatibility interfaces rather than current business concepts. | Replace with `holderRewardsDistributor`, `rewardBucket`, and `fundHolderRewards` in the next version. Provide adapters only for explicitly supported old releases. |
| Low | Old environment gates | `tools/environment.mjs` still requires a 604,800-second Treasury epoch and test-only seven-day raw exit. These values do not describe the deployed V4 user-claim path. | Move them into a legacy profile. Current V4 checks should validate the 24-hour stream and governed 1–24-hour funding interval instead. |
| Informational | Historical source and tests | `TreasuryDistributorV1`, `TreasuryClaimLeafV1`, Merkle/TWAB interfaces, root publishing, finalization, burn, claims, tests, and old fork fixtures remain in the tree. They are not deployed by the current Robinhood release. | Retain only if old immutable releases must remain reproducible; relocate and label them as legacy so they cannot be selected by the current deployment command. |

## Current versus legacy Treasury meanings

| Name | Meaning | Latest release |
| --- | --- | --- |
| `platformTreasury` | Receives the platform share of protocol fees | Active and required |
| `TreasuryDistributorV1` | Old seven-day epoch, TWAB, Merkle-root holder reward distributor | Not deployed |
| `treasuryDistributor` on Factory/Token | Stale name for the market's holder reward distributor | Active name, points to `HolderRewardsDistributorV1` |
| Treasury burn | Allows the bound distributor to burn Meme tokens it owns | Present in bytecode; unreachable through the V4 distributor |

## Important exclusions

Other seven-day constants are not automatically legacy Treasury settings. LP emission delays, governance or naming windows, and position/exit rules must be judged by their own business requirements. They should not be removed as part of this cleanup merely because they also use seven days.

## Remediation order

1. Freeze the deployed release as immutable evidence and do not mutate its artifacts.
2. Create a V4-only contract/API manifest and deployment builder; isolate `legacy-merkle-7d-v1` under a legacy entry point.
3. Remove disabled batch settlement/raw-exit code from the new FeeVault.
4. Close the direct creator/staker/holder claim bypasses and keep only the unified user-choice claim flow plus platform claim.
5. Rename holder reward concepts and regenerate Solidity interfaces, ABI/spec files, frontend ABI, backend event catalogs, and preflight rules together.
6. Run the full Foundry, generated-artifact, deployment, frontend, backend, bytecode-size, and live testnet verification gates before deploying the replacement release.

Removing the compiled surfaces requires a new contract release and redeployment. The current verified deployment cannot be changed in place.
