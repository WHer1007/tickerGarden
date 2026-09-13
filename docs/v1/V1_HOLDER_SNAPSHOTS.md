# V1 Holder Wallet Snapshots

## Current contract model

`HolderRewardsDistributorV1` distributes fully funded wallet-balance snapshot entitlements. Only direct wallet Meme balances are included; LP and other indirect holdings are excluded. It is wallet based: an account is eligible through the published Merkle leaf, and does not need to retain the Meme tokens at claim time. Smart contract wallets are eligible as accounts. Token transfers do not call the distributor.

The distributor excludes the zero address, `0xdead`, the market meme token, the market curve, the graduated pool manager, the locker, the distributor itself, the FeeVault, and the graduated hook. These exclusions are recorded per market when the market is registered. The distributor has no automatic balance or current-holding eligibility check at claim time.

## Funding and publication

The FeeVault funds quote rewards through bucket `1` and meme rewards through `fundMemeFees`. Funding is transferred into the distributor and increases its liability accounting; a publication can allocate only amounts already funded for that market. A publication with neither budget is invalid.

`publishSnapshots` is restricted to `snapshotPublisher`, accepts one to `MAX_PUBLISH_BATCH` publications (`32`), and processes the batch atomically. The publisher starts as the zero address. Governance configures or rotates it with `setSnapshotPublisher`; the call is authorized through the market registry's official stock registry and its AccessManager authority. There is no per-round multisig action in this contract.

For each market, rounds start at `1` and must increase by exactly one. Snapshot blocks must be at or after market registration and strictly greater than the previous snapshot block, and a publication cannot overwrite an existing round. The snapshot block must be earlier than the publication transaction. The canonical L2 number/hash comes from ArbSys on RH/Nitro, and native block opcodes on other supported EVM chains. For the preceding 256 blocks the supplied hash must match the canonical on-chain hash; older history remains publisher-attested. Hash equality does not prove finality.

Each publication records the market, round, snapshot block and hash, Merkle root, data hash, and quote/meme budgets. Budgets become the round's remaining claim capacity and are deducted from the market's unallocated funded balances.

## Batched funding

`ProtocolFeeVault.fundHolderRewardsBatch(marketIds, assets, gasPerAsset)` provides permissionless best-effort funding for 1–32 markets. Quote and Meme execute as separate guarded child calls, with 100,000–2,000,000 Gas per asset and bounded returndata. A valid zero-balance item skips asset balance reads and transfers. Failures preserve that item's accounting and funds; other items continue when sufficient Gas remains.

`HolderFundingResult` distinguishes zero balance, funded, and reverted items. `HolderFundingBatchStopped` identifies the first unattempted item when Gas is insufficient. Completion means all items were attempted, not that all succeeded. Replaying the list does not resend previously transferred money, but can pick up newly accrued fees; snapshot budgets must remain separately fixed by the publisher. Funding alone never publishes a root or opens claims. Existing single-asset funding methods remain available.

See [batch funding review](../reviews/HOLDER_BATCH_FUNDING_REVIEW_2026-09-13.md) for result codes, continuation and verification.

## Leaves and claims

The leaf is a domain-separated double hash over:

`LEAF_DOMAIN`, `block.chainid`, `address(distributor)`, market ID, round, account, quote amount, and meme amount.

The inner hash is `keccak256(abi.encode(...))`; the outer hash is `keccak256(bytes.concat(innerHash))`. Proofs use OpenZeppelin's sorted-pair Merkle verification. This binds a leaf to the chain, distributor deployment, market, round, account, and both asset amounts.

An account calls `claimSnapshot` directly with its amounts, an asset mask (`1` quote, `2` meme, `3` both), and a Merkle proof. Quote and meme claims are tracked independently per account and round, so an unselected asset remains claimable. The claim is checked against the round root and remaining funded budget, then paid by the distributor.

The former FeeVault role-2 user-claim path is no longer the holder reward claim interface for this model. Integrations should use `claimSnapshot` and construct proofs from the published snapshot data.

## Trust and unresolved operational scope

The active AccessManager role-2 Guardian may immediately call `revokeSnapshotPublisher(expectedPublisher)`, including while the distributor target is closed. A matching nonzero current publisher is required. Existing roots and claims remain valid; only delayed governance can install a replacement. Closing the AccessManager target alone does not stop publication. See the [implementation and manual preflight runbook](../reviews/CONTRACT_OPTIMIZATIONS_IMPLEMENTED_2026-09-13.md).

The publisher is trusted for historical balance calculation and allocation correctness. A Merkle proof proves inclusion in the publisher's committed data; it does not prove that the off-chain calculation is correct. Historical balance correctness and finality are publisher-attested for every round; recent on-chain block-hash verification is only an identity check.

The backend now implements explicit-block snapshot preparation, durable datasets, proof API, finalized publication/claim projection, and funding/publication simulation. See [backend operations](../operations/HOLDER_SNAPSHOT_BACKEND.md). The user has requested no periodic publication yet. Cadence, sampling policy, publisher signing and broadcast execution remain disabled or unresolved. Nothing in this document authorizes or confirms a broadcast.
