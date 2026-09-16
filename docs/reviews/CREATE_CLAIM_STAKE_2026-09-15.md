# Create, Claim and Stake alignment — 2026-09-15

Internal engineering record. Target: test / Robinhood Testnet 46630. No contract changes or production deployment.

## Changes

- Create preview invalidation now depends on preview inputs; description and social edits update locally. Upload sessions retain successful stages in wallet-scoped memory for five minutes, so transient status failures can resume without another successful upload or authorization signature. No token is persisted to disk.
- Creator directory fetches 50 records per page and hydrates missing market identities with bounded concurrency. Selection is no longer limited to the first 100 public markets. Historical beneficiaries can load earlier distribution periods in batches of 20, with wallet and route guards.
- Stake searches the backend directory, filters for a usable gauge, and loads 30 results per page. Input debounce, cancellation and revision guards prevent stale results from replacing a new query.
- History projection processes new event blocks and rematerializes affected aggregates. Canonical rollback rewinds the checkpoint, invalidates reads, and removes orphaned contributions. Transactions remain intact for claim-event deduplication; 256 event-bearing blocks bound each continuation.
- Holder datasets are fully verified during publication/backfill; wallet GET reads and verifies only the indexed wallet proof. Compact stored datasets avoid repeating all Merkle paths. Snapshot input reads use keyset batches and discard zero balances; the bound is 100,000 positive holders.

## Verification

Frontend full suite: 462 passed including additional creator pagination tests. Backend: 86 unit tests plus API contract gates passed. PostgreSQL integration: 25 passed, none skipped. Desktop/mobile browser fixture: remote search beyond 100 markets, 30-result pagination, missing-gauge exclusion, creator identity hydration, historical period selection and preservation passed. Routing lifecycle: 69 assertions passed.

Holder fixture: 10,001 holders; compact dataset 711,156 bytes versus 11,278,813 bytes for full proofs; wallet responses below 3 KB. Local timings are not production latency guarantees. Incremental history tests cover duplicate execution, reorg correction, preservation of untouched records and a 257-block continuation.

## Test upgrade order

1. Apply core migration 0016 and role permissions to the separately scoped test database.
2. Backfill existing Holder datasets with `scripts/index-holder-proofs.ts` using test pipeline credentials. Verify all commitments before atomic index publication; malformed data fails closed.
3. Deploy Pipeline and Read API from committed `test`, then Web. Every deployment explicitly requests `sin1`; region verification must pass before assigning test aliases.
4. Confirm scheduler processing advances history to `history-incremental-v2`, and run hosted API/page acceptance.

## Limits

No live signed transactions are exercised by the local browser fixture. Historical beneficiary RPC results are mocked there; directory requests use real Hono and PostgreSQL. Snapshot preparation still streams historical token logs per requested snapshot; it is not an incremental balance ledger. The 100,000-holder ceiling is not a measured production capacity claim. History upgrade performs a one-time replay, then uses incremental continuations. Production migration and deployment require separate authorization.
