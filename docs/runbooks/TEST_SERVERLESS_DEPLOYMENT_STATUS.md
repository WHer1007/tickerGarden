# Test serverless deployment status

Last verified: 2026-09-11 22:41 (Asia/Shanghai)

## Active scope

Only the Robinhood testnet environment is active. The production Compose profile has no running containers, no production Alchemy webhook is registered, and no production Vercel chain-ingestion environment is enabled. Test and production can share the VPS only through separate databases, credentials, storage buckets, queues, networks, and Compose profiles.

This is test-environment evidence. It is not production readiness or permission to broadcast transactions.

## Test endpoints

| Component | Endpoint | State |
| --- | --- | --- |
| Web | `https://tickergarden-web-test.vercel.app` | active; Preview deployment `dpl_5Zb6hPi6LW99RRqohZQn7ety1XVe` |
| Read API | `https://tickergarden-read-api-test.vercel.app` | active |
| Content API | `https://tickergarden-content-test.vercel.app` | active |
| Pipeline | `https://tickergarden-pipeline-test.vercel.app` | active; Preview deployment `dpl_2o7sUUV5Z7hMWaCoXHm6jbuWhMTp` |
| Chain event relay | VPS internal `chain-event-relay-test:8081` | healthy |
| Queue relay | `https://queue-test.159-89-207-161.sslip.io` | active |
| S3-compatible storage | `https://s3-test.159-89-207-161.sslip.io` | active |
| PostgreSQL | `159.89.207.161:5433`, TLS required | active |

Credentials are not recorded here. Local secrets stay in ignored mode-0600 environment files; VPS secrets stay in mode-0600 files under `/etc/tickergarden`.

## Chain ingestion and publication

The test pipeline uses three bounded RPC roles:

- Alchemy is the primary RPC and WebSocket log source.
- dRPC is the independent archive/status RPC used for historical `eth_call`, code identity, block, and finality consensus.
- Robinhood's official testnet RPC is the independent historical-log RPC used for large filtered `eth_getLogs` ranges.

Initial ingestion starts at release activation block `117032526`. It queries only the frozen frontend event topics and release-bound contract addresses. The shared Uniswap v4 PoolManager is queried separately with registered project `poolId` values. Fourteen complete filtered ranges cover activation through finalized block `117485970`; primary and log-secondary result sets matched before each range was committed.

The finalized publication revision is `117485970:0x5587c1d90d929b7463b8e5bbafe25104203decbafcc0d4c596e09f0afea7f7e9`. All six projection checkpoints are present at the same revision: `configs`, `markets`, `accounts`, `positions`, `history`, and `analytics`. Current published/test data includes 12 markets, 4 accounts, 4 positions, 61 normalized trades, and 46 positive market/address balance pairs. The chain queue has 11 succeeded jobs, no pending/retry/dead jobs, and no unresolved source conflicts.

The VPS relay reads dynamic sources from `contract_sources` and current pool IDs from the published `markets` projection. Its verified health state is 49 active sources, 3 active pools, 2 filtered log subscriptions, 0 pending events, 0 dead events, and no last error. `CHAIN_RELAY_MAX_BACKFILL_BLOCKS=100000` allows bounded reconnect recovery; the current deployment recovered the earlier 50,000-plus-block gap before becoming healthy.

The previous Alchemy block-only and Custom Webhooks remain deleted. They are not used for test ingestion because empty filtered notifications still woke Vercel once per block. The active WebSocket relay wakes Vercel only for an allowed contract/topic event or an allowed PoolManager `Swap` with a registered `poolId`.

## Online acceptance evidence

The 2026-09-11 online checks passed for:

- `/internal/live` and `/internal/ready` on Read API, Content API, and Pipeline;
- exact-origin CORS allow and unknown-origin deny;
- unsigned chain relay rejection (401) and malformed content challenge rejection (400);
- finalized `/health`, `/v1/markets`, `/v1/updates`, global holders, and market detail reads;
- desktop and mobile Home, Explore, Trade, Create, Stake, Claim, and Stats routes with a real published market;
- legacy rewards redirects, create-draft recovery, wallet connection, account change, and wrong-chain invalidation;
- zero submitted transactions during browser acceptance;
- CSP, frame denial, MIME sniffing denial, no-cache `index.html`, and non-SPA 404 behavior for missing API paths.

The browser made no legacy `/integration/` bootstrap request. The frontend reads the deployed Read API.

The 24-hour market/protocol statistics endpoints currently return `analytics_unavailable` because the activation-to-finalized test history is less than a complete 24-hour window. This is the required fail-closed result; the UI must show `Unavailable`, never fabricated `$0`. The price refresh records five configured references as unavailable because the upstream reference provider returned no usable quote.

## Operational notes

Reapply `permissionsSql(...)` after schema or read-surface changes. The Read API role requires `SELECT` on `projection_checkpoints` for the statistics endpoints; this grant was applied on 2026-09-11.

When adding a new market, commit its discovered sources first. The relay refreshes `contract_sources` and current published pool IDs, backfills each new source from its birth block, then adds it to the live filtered subscriptions.
