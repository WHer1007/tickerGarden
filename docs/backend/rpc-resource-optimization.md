# RPC resource scope and synchronization changes

Status: implemented and locally verified; not deployed by this change. No contract changes or wallet transactions.

## Log scope

The display scanner supplies both explicit address batches (maximum 256) and module event topics for every request. Factory discovery is also topic-filtered and reused rather than scanned twice. Newly discovered token/Curve/Gauge addresses are included in the same range, preserving creation-and-first-buy processing. Shared PoolManager events are decoded only from verified receipts triggered by project activity; the scanner never requests all PoolManager swaps.

## Public Web RPC

The Web proxy resolves targets through the database-only `GET /v1/rpc-scope` service. The scope contains runtime protocol contracts, configured Stock/quote tokens, reviewed exchange contracts, and canonical dynamic market contracts (including recently confirmed launches before settlement publication). Unknown contract targets and event signatures are denied before contract/log RPC. Arbitrary state overrides and full-transaction block downloads are rejected. Receipt/transaction-hash lookups require a known project/exchange target before returning data; the target cannot be known until the first hash lookup completes.

Wallet-native balance/nonce, gas fees and block headers remain explicit execution exceptions. They cannot be restricted to protocol contract addresses because users' wallets are externally owned accounts. These methods receive the same request/concurrency limits.

Limits are **per warm function instance**: 120 calls per client IP / 10 seconds, 600 total calls / 10 seconds, 32 concurrent upstream operations, 20 calls per input batch. Identical in-flight requests share their result and restore the caller's JSON-RPC ID. Completed results are not retained as authoritative chain state. These are application admission limits, not a cross-instance global quota or a substitute for edge DDoS protection. IP identification uses Vercel's `x-vercel-forwarded-for` header; see [Vercel request headers](https://vercel.com/docs/headers/request-headers). When another proxy sits ahead of Vercel, the platform may identify that proxy rather than the end user; verify this during staging acceptance.

## Single source

RpcTransport shares concurrent identical reads only for the same endpoint, fetch implementation, timeout and response-size policy. Sequential block consensus and discovered code checks reuse the primary result for the same source. Different endpoints retain independent reads and comparison. Completed calls are evicted immediately, so the post-observation anchor check remains a fresh request and can detect a reorg. Receipt contents, block identity, state invariants and settlement finality rules remain enforced.

## Static identity

Verified token name, symbol, metadata URI, deployment timestamp and code hash are reused from persisted canonical market records. The token contract initializes these fields without a setter. Reuse requires the same market, token, chain and creation block hash and a verification block no later than the new observation. Dynamic reserves, supply, allocation and active stake continue to refresh. Display rollback restores the prior record; a changed creation hash forces identity reads again.

## One recovery scanner

Relay persists filtered WS events in its existing `chain_relay_events` inbox before sending a deployment/schema-specific PostgreSQL notification. Display Worker listens on its existing database pool and processes its durable block cursor; notifications are only wake-up hints, never completeness or canonicality proof. A missed notification or restart is recovered by scanning from the stored cursor. No extra database connection allowance is added: one of the two display connections listens, the other performs all projection queries.

`CHAIN_RELAY_RECOVERY_OWNER=display` is the new default. Relay no longer runs its own HTTP reconciliation/backfill in this mode. Display Worker owns the scoped scan, receipt checks and reorg undo. Live events coalesce to no more than one pass per second; quiet periods receive a 30-second fallback scan. Only an actual backlog beyond the current 200-block batch, or baseline initialization, uses the 100 ms catch-up pause. The finality-tag lookup and fresh boundary checks remain independent from event hints.

`CHAIN_RELAY_RECOVERY_OWNER=relay` is an explicit rollback mode for deployments that do not yet run the new display worker. It restores Relay's prior HTTP recovery scan. Do not leave both scanners in recovery mode after acceptance.

## Release order and acceptance

1. Run repository checks. Deploy Read API before Web so `/v1/rpc-scope` exists before proxy enforcement. Confirm Web runtime `VITE_V1_READ_API_URL` and `VITE_V1_CHAIN_ID` match the target environment.
2. Deploy display worker before Relay. Confirm both use the same database server, environment, release digest and schema for the notification channel. The Relay source role needs SELECT on `confirmed_display_markets` in addition to its existing source-directory grants; check before switching. PostgreSQL LISTEN/NOTIFY is used on the existing connections.
3. Deploy Relay with recovery owner `display`; verify health output, notify delivery, current cursor progression and fallback recovery with notifications withheld. Release both test and production from their required branches; all Vercel runtime functions must pass the sin1 gate before aliasing/promoting.
4. In staging: create + first buy, refresh detail, trade, stake, claim, ETH/Stock allowance and receipt reads must work. An unknown eth_call/getCode/log target must be rejected without an upstream contract/log call. Compare method counts at quiet load and on a market event. These live acceptance steps remain pending deployment; local tests do not prove production savings.
5. Roll back Relay recovery ownership first if reverting the display worker. Keep the Read API scope endpoint available until all enforcing Web deployments have been replaced.

## Local evidence

- Frontend full suite: 537 passing; typecheck, build, asset budgets and SEO checks pass.
- Backend full gates: generated locks, Vercel packaging, HTTP contract checks, typecheck and 158 unit tests pass; build passes.
- Local PostgreSQL: 3 tests pass, covering cursor advancement, rollback, quiet market preservation, historical chart data, dynamic RPC scope and cross-connection notification.
- Relay: 7 unit tests pass; standalone TypeScript check passes.
- Existing pending 1H historical-chart changes remain in the working tree and are not silently deployed as part of this task.
