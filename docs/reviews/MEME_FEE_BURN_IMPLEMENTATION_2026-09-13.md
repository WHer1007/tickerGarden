# Meme fee burn implementation — 2026-09-13

Status: implemented locally; NOT_BROADCAST. This is not a production security certification.

## Immutable creation policy

`burnMemeFees` defaults off and is committed by the schema-7 expected-economics hash. The Factory stores it in the canonical market config; no mutation exists. The Create page exposes one switch in Advanced, persists the draft and repeats the choice in confirmation. Unsupported deployed factories reject an enabled choice instead of silently ignoring it. Off retains legacy ABI compatibility.

| Owner | Meme settlement when enabled | Quote settlement |
|---|---|---|
| Creator, including creator tax | Burn the epoch beneficiary's earned balance during any claim, including Quote-only | Pay beneficiary normally |
| Staker | Burn the caller's earned balance during any claim, including Quote-only | Pay caller normally |
| Holder | Burn the market's Holder Meme liability in FeeVault when funding is settled | Transfer to Distributor, publish funded snapshot, claim by proof |
| Platform | Normal payout; excluded from this burn policy | Normal payout |

No swap or transfer calls the reward burn path. Pending user fees remain pending until settlement. Existing emergency-exit and failed-accrual forfeiture policies remain unchanged. A user can also voluntarily burn their own token balance; this is distinct from fee burn accounting.

## Safety and accounting

- Debit only the selected ownership ledger, never the entire FeeVault balance.
- Verify exact reductions of FeeVault token balance and total supply. Preserve final solvency checks. Burn/payment/debit failure reverts the entire settlement.
- Holder Meme funding, nonzero Meme snapshot budgets and nonzero Meme entitlements are rejected for burn markets.
- `MemeFeesBurned` records market, beneficiary, role, epoch, token and actual amount. Receipt feedback reports actual burns, separate from paid rewards.
- Backend ingestion recognizes the new event plus current snapshot events. Canonical event replay updates database burn totals and holder supply; duplicate projection does not compound totals.
- `/v1/meme-fee-burns` reads published database aggregates only. Missing or mismatched publication is unavailable, not fabricated zero.
- Market cap uses same-checkpoint observed or indexed supply, never initial supply as a fallback. Token burns are supported in full, incremental and recent-market balance reconstruction.
- Frontend nontransaction statistics remain database sourced; contract capability and canonical market checks run as part of wallet transaction preparation.

## Validation

- Solidity local suite: 944 passed, zero failed. Includes burn-only settlement, Quote-only burn, platform isolation, failure rollback, retry, immutable economics and Holder snapshot rejection.
- Frontend: 384 tests passed; TypeScript and production build passed.
- Backend: 54 unit tests passed; TypeScript, API/contract coverage and generated baseline checks passed.
- Specification suite: 66 passed. Canonical ABI, interfaces, economics vectors and compiled product manifests regenerated.
- Runtime budgets pass: Factory 23,941 bytes, FeeVault 23,059 bytes. Factory has only 59 bytes of internal budget headroom; future additions require size review.
- Local browser: desktop 1440px and mobile 390px checked; one Advanced toggle, draft persistence, no horizontal overflow, styled burn confirmation and hidden asset selection. Evidence: `outputs/reviews/meme-fee-burn-2026-09-13/`.
- PostgreSQL integration: 9 passed, zero skipped. Legacy/current snapshot histories, burn API replay idempotency, orphan-anchor rejection, canonical burn removal and incremental supply reduction verified.

## Release boundary

No network deployment, signed transaction or production configuration cutover was performed. Existing deployed contracts do not acquire the setting. Release requires new contract deployment, updated source addresses/code identities and backend/frontend deployment configuration. Snapshot publisher automation and proof publication remain the previously agreed separate TODO; this change supplies contract checks and event/read support, not that automation. Real-wallet end-to-end validation and live fork/deployment gates remain release work.
