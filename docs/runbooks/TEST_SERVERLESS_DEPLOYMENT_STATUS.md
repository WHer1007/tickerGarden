# Test serverless deployment status

Last verified: 2026-09-12 03:57 (Asia/Shanghai)

## Active scope

Only the Robinhood testnet environment is active. The production Compose profile has no running containers, no production Alchemy webhook is registered, and no production Vercel chain-ingestion environment is enabled. Test and production can share the VPS only through separate databases, credentials, storage buckets, queues, networks, and Compose profiles.

This is test-environment evidence. It is not production readiness or permission to broadcast transactions.

## Test endpoints

| Component | Endpoint | State |
| --- | --- | --- |
| Web | `https://tickergarden-web-test.vercel.app` | active; Preview deployment `dpl_J8ivsGsLMB4iVyn7MpHAuoWtJUMR` |
| Read API | `https://tickergarden-read-api-test.vercel.app` | active; Preview deployment `dpl_GgfH5Xt4Da3XnqQpnLqdWqpbqkAi` |
| Content API | `https://tickergarden-content-test.vercel.app` | active |
| Pipeline | `https://tickergarden-pipeline-test.vercel.app` | active; Preview deployment `dpl_36oA1Z5SQaiPdKPViNRj5syQjLyn` |
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

Initial ingestion starts at release activation block `117032526`. It queries only the frozen frontend event topics and release-bound contract addresses. The shared Uniswap v4 PoolManager is queried separately with registered project `poolId` values. Twenty-one complete filtered ranges cover activation through finalized block `117582716`; primary and log-secondary result sets matched before each range was committed.

The finalized publication revision is `117582716:0xaead33ea991a0a6cbcdb2f32547267854f5cd645adb3cb496b1ca5779ab09f60`. All six projection checkpoints are present at the same revision: `configs`, `markets`, `accounts`, `positions`, `history`, and `analytics`. Current published/test data includes 12 markets, 4 accounts, 4 positions, 61 normalized trades, and 46 positive market/address balance pairs. The chain queue has 18 succeeded jobs, no pending/retry/dead jobs, and no unresolved source conflicts.

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

The 2026-09-12 loading optimization moved the Web RPC function and Read API functions to `sin1`, matching the Singapore VPS. A cold browser trace rendered all 12 Explore cards in 2.8–4.1 seconds, compared with the earlier 7.3–13.6 second range; request count fell from 65–120 to 29–38. A cold token-detail trace rendered identity in 2.8–4.1 seconds and fee/analytics sections in 3.7–4.9 seconds, compared with 6.1, 12.6, and 10.0 seconds respectively in the pre-change trace. The detail route issued one `/detail` request and no separate `/market-statistics` or `/market-display-statistics` request. These measurements are test evidence from the current workstation/network path, not a production SLO.

Revision-addressed public reads now receive immutable CDN caching. The snapshot poller adopts the already-rendered Foundation revision instead of forcing a second full reset. Browser RPC reads use bounded batches of at most 20 allowed calls; transaction submission methods remain blocked at the proxy. Market identity and historical analytics render independently while canonical route verification keeps quote and transaction controls locked.

The online Stats check returned HTTP 200 for `/health`, `/v1/protocol-statistics`, `/v1/statistics-prices`, and `/v1/updates`. The page rendered 12 launches in the current 24-hour window, 3 Bloomed markets, 2 staking wallets, and `$13.41` of stock staking value. Metrics without complete historical USD coverage render `Unavailable` rather than a zero placeholder.

Market-cap reads are available independently of complete 24-hour historical coverage. The test price worker combines Coinbase ETH/USD with identity-verified Synthra V3 testnet pool spots for the five configured stock tokens; the VPS runs `tickergarden-price-refresh-test.timer` every five minutes. References are persisted in PostgreSQL and the Read API publishes native ETH plus the configured Stock Token catalog through a five-minute shared CDN cache. The frontend keeps one application-wide observable price store, polls the cached catalog once per minute, and updates Create, Trade, Explore and Stats consumers when its version changes. A transient failed quote refresh does not replace an unexpired successful reference. Explore merges `/v1/market-statistics` into Read API directory rows and displays current MC values.

The 2026-09-12 price-cache acceptance manually ran the VPS refresh service with a successful exit and then read six available references from the aliased Read API: ETH from Coinbase plus NFLX, PLTR, AMD, AMZN and TSLA from identity-verified testnet pools. The active systemd timer reported a five-minute next trigger.

A cold Chrome check of the aliased Create page rendered the cached ETH reference as available, made exactly one `/v1/prices/references` request, made no `/v1/statistics-prices` request, made no direct Coinbase request, and reported no browser or request failures. The broader acceptance rendered all 18 desktop/mobile route checks and submitted no transactions; its final platform-only Node fetch was affected by the workstation's intermittent TLS reset, while the same endpoint checks passed from the VPS.

Two consecutive VPS reads of the final price-catalog deployment returned `x-vercel-cache: HIT`; the catalog contained six available references and the browser-facing cache header allowed a 60-second local reuse window.

Token detail fee allocation reads use the current immutable market configuration and cumulative finalized allocation rows. Curve and Bloomed markets display each recipient percentage and exact asset-separated Quote/Meme amounts; the snapshot label distinguishes these totals from live settlement authority.

The 24-hour volume fields remain `null` while the deployment is younger than a complete 24-hour window and time-aligned historical USD observations are unavailable. Protocol statistics that require complete historical price coverage remain fail-closed; the UI shows `Unavailable`, never fabricated `$0`.

The 2026-09-12 UX pass corrected conflicting Explore states, added local error recovery, replaced internal terms with user-facing copy, restored visible keyboard focus, completed tab keyboard behavior, clarified balance actions, increased small touch targets, and identified testnet Stats data. The 324-test frontend suite and Vercel production build passed. Vercel inspection confirmed the aliased preview is `READY`; HTTP body checks from the workstation were blocked by the same intermittent TLS reset noted above, so this run does not add new screenshot evidence.

The 2026-09-12 performance pass found that detail analytics incorrectly treated sparse relevant-block storage as incomplete chain coverage even though `covered_ranges` were complete. The Read API now validates the finalized ingestion checkpoint and its continuous complete ranges. Online acceptance returned statistics, charts, trades, holders, and fees for 1H, 12H, and 1D. The Read API was explicitly deployed to `sin1`; same-region warm reads were 60–90 ms and the sampled cold penalty was substantially lower than the earlier `iad1` deployment. The frontend now lazy-loads three pixel-identical lossless WebP step images, uses normal price-catalog caching, starts prices only on product routes, and stops deterministic Stats partial states from triggering repeated requests.

## Operational notes

Reapply `permissionsSql(...)` after schema or read-surface changes. The Read API role requires `SELECT` on `projection_checkpoints` and `ingestion_checkpoints` for the statistics endpoints; these grants were applied on 2026-09-11.

The VPS runs the chain coverage fence and price refresh every five minutes and repairs or dispatches continuation jobs every minute. Reaching a finalized fence refreshes all coherent projections even when the filtered interval contains no events, so `/v1/updates` remains synchronized during quiet periods. All chain-refresh, chain-dispatch, and price-refresh timers were active at the last verification.

When adding a new market, commit its discovered sources first. The relay refreshes `contract_sources` and current published pool IDs, backfills each new source from its birth block, then adds it to the live filtered subscriptions.
