# Stats alignment — 2026-09-15

Internal review record. Target: test / Robinhood Testnet 46630. No contract or production changes.

## Behavior and definitions

- 24h volume uses canonical finalized raw quote flow, excluding known internal conversions. USD values use current display prices and are explicitly labelled estimates.
- 24h fee revenue sums transaction-reported fees and creator taxes; unknown fee coverage remains unavailable. It is separate from allocation-time Creator, Staker, Holder and Platform distributions.
- MEME fee valuation uses the finalized market quote price multiplied once by the current Quote USD price. Missing prices remain null; zero amounts need no price.
- Stock totals and wallet counts cover positive allocated balances, not unallocated vault deposits. The position publication supplies its own timestamp and block hash. Missing/invalid position data does not become zero.
- Pipeline prepares a shared snapshot every 20 minutes. GET performs one indexed snapshot read with canonical/generation checks. Market counts and position sums/distinct wallets execute in SQL rather than returning full populations to the service.
- Frontend separates price rendering from snapshot fetching, preserves Stock search/expansion, clears stale rows after request failure, supports explicit retry, and shows activity/staking timestamps separately. Snapshot display expires after 25 minutes; scheduled refresh is every 20 minutes.

## Verification

Frontend: 464 passed. Backend: 86 unit tests and API contract gates passed. Routing lifecycle: 69 assertions passed. PostgreSQL integration: 25 passed, none skipped. Fixture covers distinct trade-time versus allocation-time fees, missing fee coverage, internal-volume exclusion, older position timestamp, orphaned position anchor, and repeated scheduled publication.

Synthetic 20,001-market / 20,001-wallet run: build about 370 ms, indexed GET about 1 ms, response 1,339 bytes. This is local evidence, not a hosted SLA or a full traffic load test.

Desktop/mobile fixture uses real Hono and PostgreSQL: estimated volume/fees, no refetch during price rendering, search/focus retention, coherent clearing on 503, retry recovery and Stock expansion. No chain writes.

## Deployment

Apply migration 0017 plus role permissions to test DB; publish the initial snapshot; deploy Pipeline, Read API and Web from committed test. Every deployment requires explicit sin1 and region verification before alias. Confirm natural scheduled refresh and hosted API/page acceptance. Production remains separately authorized.

## Limits

USD amounts are current-price estimates, not historical trade-time dollar proceeds. Incomplete fee/price coverage shows a dash. Stock list uses configured asset metadata; unidentified positive allocations prevent a falsely complete total. Existing homepage-copy regression expectation was synchronized with the user's previously requested sentence removal.
