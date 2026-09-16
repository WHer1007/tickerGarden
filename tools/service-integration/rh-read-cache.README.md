# Robinhood testnet scoped RPC relay

This relay is demand-only. It never scans or prefetches history at startup or while idle. The previous whole-chain log/receipt prefetch loop has been removed. The default configuration is read-only and does not publish verified financial snapshots. An explicitly configured, exact-intent deployment capability is temporary and must be removed after the authorized transactions finish.

## Shared throughput budget

Set `cuPerSecond: 10000` (the maximum). Every upstream attempt, including retries, head/chain checks and `/independent` requests, consumes the same rolling 1000 ms budget. Each allowed method is conservatively charged 500 throughput CU, so no more than 20 calls per rolling second are admitted at the default budget. This is an upper-bound reservation, not reported provider billing. Cache hits consume no upstream CU. Method weights are based conservatively on https://www.alchemy.com/docs/reference/compute-unit-costs (checked 2026-09-08; block receipts: 500 throughput CU).

Run one relay and route all integration services through it. Direct RPC clients, other processes or other applications on the same provider account are outside this limiter. The local integration runner routes all primary RPC variables to this relay and independent checks to `/independent`. Independent responses never reuse primary cache entries. `stats.attemptedCU` and `stats.attemptedRequests` include failed attempts; status contains no credentials.

## Required scope

Configuration requires `prefetch: false`, `scopeFile`, `cacheDir`, `chainId: 46630`, `host: "127.0.0.1"`, and a local port. RPC URLs are environment-only: `RH46630_RPC_PUBLIC`, `RH46630_RPC_PRIVATE`, `RH46630_RPC_LOGS`, `RH46630_RPC_INDEPENDENT`.

The scope file has `startBlock`, `maxLogRange` (default 512, maximum 2048), and `contracts`. Every contract declares a lowercase address, `fromBlock`, and business `reason`. Shared PoolManager entries also declare `shared: true` and an explicit `poolIds` array; an empty array disables its log history while allowing scoped state reads.

- Read only this release's protocol history from the verified business start. Existing deployment bootstrap evidence remains separate.
- Logs require explicit permitted addresses and a bounded numeric range. No whole-chain or open-ended log requests.
- Shared PoolManager logs require project pool IDs in topic 1. Never read all pools.
- State targets must be explicitly listed and historical reads must respect the contract start.
- Transaction receipts require a transaction returned by a scoped project log query.
- Full block receipts require a block containing a scoped project event and are reserved for receipt-root proofs. No receipt sweep across empty or unrelated blocks.
- Add factory-created market contracts, asset dependencies and pool IDs only after authenticating their project relationship and creation block. Merely appearing in an RPC response is insufficient to add a new contract.

An optional `originProof` grants `eth_getCode` at exactly `parentBlock = startBlock - 1` and `businessBlock` (at most 4096 blocks after start), only for its explicit addresses. It also permits that parent header. It never enables earlier logs, calls, balances, storage, or receipts. This supports runtime absence and deployment identity checks.

Deployment bootstrap evidence may omit receipts only when `VerifyEventExclusion` recomputes the complete header hash and its Bloom excludes every protocol emitter. Positive Blooms fail closed; filtered empty RPC logs alone cannot substitute for this proof. Hash-linked ancestry and independently checked canonical anchors remain required. This optimization does not claim full receipt-root coverage or automatically make business snapshots publishable.

Scope checks run before cache lookup. Original JSON results use SHA-256 content-addressed storage; downstream canonical/header/receipt-root validation is still required. Filtered logs alone do not prove absence or complete financial history. Legacy workers that require unfiltered logs are intentionally rejected and must be adapted before restart; do not mark their partial results ready.

## Checks

`node --test tools/service-integration/rpc-cu-budget.test.mjs tools/service-integration/rpc-project-scope.test.mjs tools/service-integration/rh-read-cache.test.mjs`

## Local integration browser

The current independent frontend is `http://127.0.0.1:5178` and the gateway permits CORS only for that exact origin. OPTIONS requests are answered locally without RPC. Other origins receive no CORS grant. `node tools/service-integration/redirect-legacy-frontend.mjs` keeps old `5176` bookmarks pointing to `5178`, preserving pathname and query; do not run the retired frontend configuration on that port.
