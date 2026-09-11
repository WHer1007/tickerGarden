# Holder Rewards Operations

This document describes the holder-reward modes in the current source tree. Source and local tests do not prove deployment readiness, target-chain state, or production operation.

## Modes and immutable boundaries

- **Legacy Merkle:** Treasury Merkle distributions use seven-day epochs. A market already deployed with this distributor keeps that behavior.
- **Legacy continuous (`STREAM_24H_V1`):** each funded stream releases for 24 hours and at most 64 streams can coexist. Funding in the same second can coalesce; adding funding does not extend an existing stream. A full capacity defers new funding while preserving the FeeVault liability.
- **Batched continuous (`BATCHED_24H_V2`):** the fixed-interval mode merges public funding into pending state, starts at most one batch per market every four hours, and each batch releases for 24 hours. At most six batches are retained. Same-second funding can merge; existing releases are never extended. `idle` includes pending amounts waiting for a batch and amounts held while eligible supply is zero. A permissionless checkpoint can activate due pending state even when no new trade has occurred.

- **Dual-asset configurable (`TICKERGARDEN_HOLDER_DUAL_ASSET_24H_V4`):** current source releases Quote and Meme separately for 24 hours. Funding defaults to one admission per market every four hours and is configurable through AccessManager from 1–24 hours. The ring has a fixed capacity of 24. Existing streams retain their end times. Read `fundingInterval(marketId)` for the live value; `FUNDING_INTERVAL()` is only the default. See [configuration and deployment wiring](../v1/V1_HOLDER_FUNDING_INTERVAL.md).

V2 enforces the four-hour admission interval on chain. The worker also defaults to a four-hour schedule; neither clock executes a transaction by itself. The amount threshold is an operational dust setting; the public funding entry is not protected by that minimum. Amounts below the configured operational threshold remain in the FeeVault. Legacy and V2 distributor state is immutable per deployed market; an old market is not converted by changing frontend configuration or an ABI.

## Holder accounting

Holder rewards use the eligible balance during each 24-hour release and do not require staking. Selling or transferring after earning does not remove rewards already attributed to the account. Pool, curve, locker, vault, distributor, and graduated-hook inventory is excluded from ordinary holder supply according to the deployed distributor rules.

The worker is compatible with legacy continuous, fixed batched, and configurable batched modes by reading the distributor mode before selecting the path. It checks markets every four hours and processes the maintenance result returned for that cycle. This is a bounded scheduled check; it does not imply that an unchanged market never causes an RPC read.

## Reward conversion protections

Creator, Staker and Holder reward conversions use the canonical pool estimate for display only. Project callers pass minimumQuote=0; no reference-window readiness, price deviation, output discount or preset price-impact gate applies. Actual positive output and ownership accounting are still verified. Existing immutable deployments retain their previous behavior.

These protections apply to reward conversion only. They add no slippage rule to ordinary user buys or sells. The seven-day `rawExit` request belongs to legacy releases. V4 disables that entrypoint and lets the beneficiary choose conversion or immediate original-asset payment in `claimUserRewards`; the normal reward-release, stake-lock and ownership conditions still apply.

## Worker and journal handling

The worker reads deployment artifacts and chain state before preparing an operation. It persists signed intents before submission, recovers the same signed bytes, and never deletes the journal or automatically replaces a nonce. Receipt failures, missing expected events, consumed pending nonces, and `needs_attention` states require manual reconciliation. Market failures remain retryable on the next four-hour cycle.

The local test worker uses the configured gas caps and dust settings from the test environment. Those settings are operational limits, not protocol economics. Do not run the test signer against another environment or treat a local preview as a broadcast or deployment result.

## Release selection

A new deployment must set:

```text
V1_DEPLOYMENT_HOLDER_MODE=dual-asset-24h-v4
```

The legacy deployment script must explicitly select:

```text
legacy-merkle-7d-v1
```

The batched mode requires a new release, mode-specific artifacts, and fresh deployment, Fork, conversion, claim, and receipt evidence. Existing legacy addresses remain unchanged. Neither mode is production-ready merely because local source tests pass.

The selected source policy accepts a pinned v4 Core protocol fee up to 1000 pips (0.1%) per direction, with direction-specific values allowed. PoolKey.fee and LP fee remain zero. Core protocol fee is collected independently by PoolManager, does not enter FeeVault or TickerGarden distributions, and is shown separately from the TickerGarden 1% base fee and Creator tax. Reward conversion does not recursively charge TickerGarden fees, but Core fee remains in the actual output.

Frontend write approval is version-specific. The V4 contracts are deployed and registry-active on Robinhood testnet in release `0x6e743e8bf90c0e91cd7de52711a1a68976401c494187f1e015fc66ef17310f95`, but the release remains `ACTIVE_TEST_ONLY` and has not passed its public market E2E gate. The configured frontend therefore remains on the prior verified release until that separate gate passes.

## V4 user-choice release

`TICKERGARDEN_HOLDER_DUAL_ASSET_24H_V4` releases Quote and Meme separately against the same eligible balances. The worker skips operator conversions when FeeVault reports `TICKERGARDEN_USER_CLAIM_V1`; it funds Meme using `fundHolderMemeRewards` and Quote using `fundHolderRewards`. Asset minima remain funding/dust admission thresholds, never execution price floors. `TG_HOLDER_MINIMUM_QUOTE_JSON` (the existing per-asset map, also accepting Meme addresses) can also specify a Meme token minimum; the fallback is 1 whole Meme, with existing gas budgets retained.

Use the new user claim path for conversion or direct original-asset payment. Refunds restore the same holder's earned Meme immediately, without another stream. Existing single-asset history replay is not V4-compatible and must not be used to grant claim eligibility. On-chain `claimableAssets` and asset-specific market state are authoritative. Deployments and frontend write approvals are separate gates; no prior V3 approval enables V4 writes.
