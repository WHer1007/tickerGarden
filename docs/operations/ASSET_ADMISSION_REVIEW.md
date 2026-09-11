# Asset Admission Review

This is the public review inventory used by `tools/asset-risk-review.mjs`. It is an admission gate for future runs of `tools/activate-robinhood-testnet-canonical-assets.mjs` (`plan`, `audit`, or `execute`). A `pending` record blocks those future modes. It does not disable existing markets, trading, or withdrawals, and it does not change any on-chain registry or issuer control.

## Current state

`config/asset-risk-reviews.json` currently lists five Stock identities: TSLA, AMZN, PLTR, NFLX, and AMD. Their identity, implementation fingerprints, and minimum values were imported from a historical release manifest. They have not been freshly re-verified on chain. Every record is therefore `status: "pending"`, with `acceptedIssuerRisk: false`, empty reviewer and issuer-control fields, no review dates, and unknown capabilities. These records must not be described as safely approved or production-ready.

The recorded `minimumAllocationRaw` is `1000000000000000000` for each entry (18-decimal units). This is a historical release value for the listed Stock records, not a universal economic optimum. The validator only treats `414` raw units as the numeric safety floor; a real approval still needs a non-empty rationale and, for staking, a matching asset UID and planned minimum.

## Field meanings

- `chainId`, `tokenAddress`, `decimals`, `roles`, and `assetUid` identify the asset and its intended `quote` or `staking` use. The validator rejects invalid or duplicate identity, a decimals mismatch, and a role that is not covered by the record.
- `status` and `acceptedIssuerRisk` are the approval decision. Admission requires `approved` and `true`; `pending` is a deliberate stop for future admission only.
- `reviewer`, `issuerControl`, `reviewedAt`, `validUntil`, and `evidence` make the decision attributable and time-bounded. The review date cannot be in the future, the expiry must be after the review date and current time, and evidence must contain non-empty strings.
- `capabilities.pause`, `blacklist`, and `upgrade` must each be explicitly `present` or `absent`. `feeOnTransfer` and `rebasing` must be explicitly `absent`; unknown or enabled behavior is rejected.
- `checkMode: "stock-fingerprint"` requires the token, beacon, beacon implementation, and implementation runtime hashes/addresses to match the supplied fingerprint. The alternative `runtime-codehash` mode requires the reviewed runtime hash to match. These are review inputs; this document records no new chain check.
- `minimumAllocationRaw` is a decimal integer in raw asset units. It must be at least 414, and `minimumRationale` must explain the chosen value. `logo` is presentation metadata and is not an approval signal.

## What an approval must establish

Before changing a record to approved, a reviewer must use current evidence to check the token's pause, blacklist, and upgrade paths, including the active implementation or beacon, and confirm that fee-on-transfer and rebasing behavior are absent. The reviewer must record the source evidence, identity and implementation fingerprints, issuer control, dates, roles, decimals, and economic minimum. Issuer control can still block or delay an exit even after these checks; that residual risk must be accepted explicitly and is not removed by this table.

The review cannot bypass existing protocol boundaries. Original-token/raw exits, their timing rules, and permanent LP locks remain governed by the deployed contracts and their existing procedures. An admission record is not a rescue permission, a withdrawal override, or a deployment claim.
