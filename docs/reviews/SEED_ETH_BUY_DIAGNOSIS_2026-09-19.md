# SEED ETH buy diagnosis — 2026-09-19

## Verified production evidence

- Market `0x01f5eb9ec14492bcefcc4598d9ac8ed3f1c2a2e7eca7b217b2e7b60576448476` is Growing and paired with AAPL (`0xaf3d76f1834a1d425780943c99ea8a608f8a93f9`), not USDG.
- A production conversion quote probe returned HTTP 503 `conversion_unavailable`. The Read API project's environment listing and active deployment environment both lack `ZEROX_API_KEY`.
- A read-only direct upstream probe using the existing private local credential successfully quoted 0.001 ETH to USDG; the result passed the project's conversion calldata checks.
- The actual 0.001 ETH to AAPL upstream probe returned HTTP 422 `BUY_TOKEN_NOT_AUTHORIZED_FOR_TRADE`. Adding the missing credential cannot alone enable SEED's ETH conversion.
- No wallet signature, transaction submission, production configuration change or deployment was performed. The user's actual amount and current browser state were not available; probes used the previously supplied wallet address.

## Local corrections

- Forward `ZEROX_API_KEY` only to the Read API; exclude unrelated services and inherited shell credentials. Require this key at the production Read API deployment boundary.
- Classify upstream asset restrictions without exposing raw provider messages. Retain safe conversion-failure diagnostics and an actionable paired-asset response.
- Preserve the conversion-unavailable explanation when the trade form renders without a quote. Keep the existing balance-row stock purchase link; no new component.
- Coalesce payment-balance reads by account/token, ignore results belonging to a different active account/token, and refresh balance/button state with a safe message after read failure.

## Validation and remaining actions

- Environment/deployment tests: 25 passed.
- Backend conversion tests: 12 passed.
- Frontend conversion/payment-balance tests: 12 passed.
- Frontend and backend type checks passed; whitespace check passed.

Corrections are local and uncommitted alongside the earlier observability work. Production is unchanged. A production release still requires the normal approval and test/master/Singapore deployment gates.

For this market, use the existing AAPL payment path and stock-pool purchase entry while the 0x route is unavailable. Supporting a different automatic exchange provider or direct pool route is a separate integration decision and must not be represented as resolved by a credential update.
