# Launch flow corrections — 2026-09-18

Follow-up to `LAUNCH_FAILURE_AUDIT_2026-09-18.md`. Implemented locally in the alignment checkout; not deployed and no real transaction broadcast during this validation.

## Corrections

- After broadcast, storage write failures retain the known transaction journal in page memory; receipt verification continues. The pre-broadcast storage probe still rejects an unsafe submission. Matching known transactions are reconciled rather than resent.
- Launch recovery reads both v2 multi-transaction journals and legacy journals. Verified cleanup only removes the matching launch intent and hash; unrelated trades and approvals remain.
- A verified reverted receipt supersedes an earlier pending diagnostic. Purchase recovery checks an existing receipt and returns to the form with a fresh balance rather than resending the purchase.
- Confirmed launch data preparation uses a bounded 60-second attempt, existing automatic 10-second retry, and cancellation on closing/leaving the progress flow. The existing status text explains longer preparation after 15 seconds. The minimum four-second transition and full data-readiness gate remain; no premature success or fabricated data.
- Wallet/account/network, approval, simulation, quote expiration/10% cap, route, upload authorization/session/quota, and connection failures now have distinct user-language messages. Unknown outcomes retain duplicate-submission guards and automatic checking; users are not sent to inspect transaction history.
- Invalid upload completion state returns HTTP 409 with `upload_session_invalid`, rather than 503. The frontend discards the invalid session and classifies it accordingly.
- Existing Docs Launch/Help sections explain retry paths and that purchased paired assets remain in the wallet if launch does not complete. No new page component or risk warning was added.

## Verification

- Web complete suite: 600 passed, 0 failed, 0 skipped.
- Backend unit suite: 160 passed, 0 failed.
- Content integration on an isolated local PostgreSQL schema: passed, including invalid-session 409, authorization, idempotency and publication-provider recovery.
- Web and backend TypeScript checks passed; final web production build passed.
- `git diff --check` passed.

## Boundaries

Contracts, signature/receipt/identity checks, exact-output purchase quantity and the confirmed ETH +10% cap are unchanged. Memory fallback protects an active page, not complete browser-process loss; durable records and backend launch recovery remain necessary after that. Data services that remain down continue the confirmed-data preparation state rather than incorrectly showing success. Recovery still cannot safely infer the outcome of a wallet request that returned no transaction hash and has no matching backend record. This validation does not claim production deployment or a new live-wallet transaction test.
