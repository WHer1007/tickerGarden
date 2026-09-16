# Test serverless deployment status

Last verified: 2026-09-13 (Asia/Shanghai)

Current RH release: `0x685b5c20e826f4ddd076b61216c7529a967322082925c4741469b0fda837a7f2`. [Latest test publication evidence](../reviews/FRONTEND_LATEST_RH_RELEASE_2026-09-13.md). Historical measurements below remain dated evidence, not current release certification.

Holder snapshot backend update (2026-09-13): finalized reward projection and proof API deployed; `0004_holder_rewards` migrated. Periodic publication and signing remain disabled. [Backend report](../reviews/HOLDER_SNAPSHOT_BACKEND_2026-09-13.md).

## Active scope

Only the Robinhood testnet environment is active. The production Compose profile has no running containers, no production Alchemy webhook is registered, and no production Vercel chain-ingestion environment is enabled. Test and production can share the VPS only through separate databases, credentials, storage buckets, queues, networks, and Compose profiles.

This is test-environment evidence. It is not production readiness or permission to broadcast transactions.

## Test endpoints

| Component | Endpoint | State |
| --- | --- | --- |
| Web | `https://tickergarden-web-test.vercel.app` | active; Preview deployment `dpl_7Z25DQphyNPpvzu9QNU8cAkYYteU`; function verified `sin1` |
| Read API | `https://tickergarden-read-api-test.vercel.app` | active; Preview deployment `dpl_3hcn7LGN7fggbmRnT4Fy6V2wgNF2`; both functions verified `sin1` |
| Content API | `https://tickergarden-content-test.vercel.app` | active |
| Pipeline | `https://tickergarden-pipeline-test.vercel.app` | active; Preview deployment `dpl_FzFBzZ8b17xFzFejJy1YHztDfFq1` |
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

Historical 2026-09-12 ingestion started at release activation block `117032526`. It queries only the frozen frontend event topics and release-bound contract addresses. The shared Uniswap v4 PoolManager is queried separately with registered project `poolId` values. Twenty-one complete filtered ranges cover activation through finalized block `117582716`; primary and log-secondary result sets matched before each range was committed.

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

At 2026-09-12 16:28 CST, the Read API test alias was found pointing at a later `iad1` deployment while PostgreSQL remained in Singapore. Vercel runtime logs for that deployment showed `/v1/markets` at 973 ms p50 and 2.70 s maximum, and `/v1/market-statistics` at 4.81 s p50 and 4.97 s maximum. The alias was restored to the verified `sin1` deployment `dpl_GgfH5Xt4Da3XnqQpnLqdWqpbqkAi`, and the Vercel project sandbox default was changed from `iad1` to `sin1` to prevent the same region drift. Five post-change reads from the Singapore VPS measured Bloomed `/v1/markets` at 58–109 ms, Growing `/v1/markets` at 63–395 ms, and `/v1/market-statistics` at 70–237 ms; all returned HTTP 200.

Revision-addressed public reads now receive immutable CDN caching. The snapshot poller adopts the already-rendered Foundation revision instead of forcing a second full reset. Browser RPC reads use bounded batches of at most 20 allowed calls; transaction submission methods remain blocked at the proxy. Market identity and historical analytics render independently while canonical route verification keeps quote and transaction controls locked.

The online Stats check returned HTTP 200 for `/health`, `/v1/protocol-statistics`, `/v1/statistics-prices`, and `/v1/updates`. The page rendered 12 launches in the current 24-hour window, 3 Bloomed markets, 2 staking wallets, and `$13.41` of stock staking value. Metrics without complete historical USD coverage render `Unavailable` rather than a zero placeholder.

Market-cap reads are available independently of complete 24-hour historical coverage. The test price worker combines Coinbase ETH/USD with identity-verified Synthra V3 testnet pool spots for the five configured stock tokens; the VPS runs `tickergarden-price-refresh-test.timer` every five minutes. References are persisted in PostgreSQL and the Read API publishes native ETH plus the configured Stock Token catalog through a five-minute shared CDN cache. The frontend keeps one application-wide observable price store, polls the cached catalog once per minute, and updates Create, Trade, Explore and Stats consumers when its version changes. A transient failed quote refresh does not replace an unexpired successful reference. Explore merges `/v1/market-statistics` into Read API directory rows and displays current MC values.

The 2026-09-12 price-cache acceptance manually ran the VPS refresh service with a successful exit and then read six available references from the aliased Read API: ETH from Coinbase plus NFLX, PLTR, AMD, AMZN and TSLA from identity-verified testnet pools. The active systemd timer reported a five-minute next trigger.

A cold Chrome check of the aliased Create page rendered the cached ETH reference as available, made exactly one `/v1/prices/references` request, made no `/v1/statistics-prices` request, made no direct Coinbase request, and reported no browser or request failures. The broader acceptance rendered all 18 desktop/mobile route checks and submitted no transactions; its final platform-only Node fetch was affected by the workstation's intermittent TLS reset, while the same endpoint checks passed from the VPS.

Two consecutive VPS reads of the final price-catalog deployment returned `x-vercel-cache: HIT`; the catalog contained six available references and the browser-facing cache header allowed a 60-second local reuse window.

Token detail fee allocation reads use the current immutable market configuration and cumulative finalized allocation rows. Curve and Bloomed markets display each recipient percentage and exact asset-separated Quote/Meme amounts; the snapshot label distinguishes these totals from live settlement authority.

The 2026-09-12 token-detail repair fixed the production Web RPC proxy accepting only JSON-RPC requests with an explicit `params` array even though Viem legally omits `params` for parameterless reads. It also added the read-only `eth_getLogs` method used by the live trade chart and redraws fee allocation after canonical release verification populates the fee configuration. Post-deployment browser evidence for a Bloomed market rendered Price `0.00000000208357 ETH`, Market cap `$5,282.1`, the 35% Creator / 35% Holders / 30% Platform split with asset-separated cumulative amounts, and the explicit `No Trades In This Period` chart state. All sampled same-origin RPC requests returned HTTP 200; no transaction was submitted.

The 24-hour volume fields remain `null` while the deployment is younger than a complete 24-hour window and time-aligned historical USD observations are unavailable. Protocol statistics that require complete historical price coverage remain fail-closed; the UI shows `Unavailable`, never fabricated `$0`.

The 2026-09-12 UX pass corrected conflicting Explore states, added local error recovery, replaced internal terms with user-facing copy, restored visible keyboard focus, completed tab keyboard behavior, clarified balance actions, increased small touch targets, and identified testnet Stats data. The 324-test frontend suite and Vercel production build passed. Vercel inspection confirmed the aliased preview is `READY`; HTTP body checks from the workstation were blocked by the same intermittent TLS reset noted above, so this run does not add new screenshot evidence.

The 2026-09-12 performance pass found that detail analytics incorrectly treated sparse relevant-block storage as incomplete chain coverage even though `covered_ranges` were complete. The Read API now validates the finalized ingestion checkpoint and its continuous complete ranges. Online acceptance returned statistics, charts, trades, holders, and fees for 1H, 12H, and 1D. The Read API was explicitly deployed to `sin1`; same-region warm reads were 60–90 ms and the sampled cold penalty was substantially lower than the earlier `iad1` deployment. The frontend now lazy-loads three pixel-identical lossless WebP step images, uses normal price-catalog caching, starts prices only on product routes, and stops deterministic Stats partial states from triggering repeated requests.

## Operational notes

Reapply `permissionsSql(...)` after schema or read-surface changes. The Read API role requires `SELECT` on `projection_checkpoints` and `ingestion_checkpoints` for the statistics endpoints; these grants were applied on 2026-09-11.

The VPS runs the chain coverage fence and price refresh every five minutes and repairs or dispatches continuation jobs every minute. Reaching a finalized fence refreshes all coherent projections even when the filtered interval contains no events, so `/v1/updates` remains synchronized during quiet periods. All chain-refresh, chain-dispatch, and price-refresh timers were active at the last verification.

When adding a new market, commit its discovered sources first. The relay refreshes `contract_sources` and current published pool IDs, backfills each new source from its birth block, then adds it to the live filtered subscriptions.

The route-recovery follow-up retries canonical verification during the 30-second detail refresh when verification is still unavailable, even if sourceVersion and launchPhase are unchanged. The user-reported market `0xe596600919dc0beb84a6e5a3660d6dba13c0424f20550f453d4cf7cd8dfdebf1` passed `assertCanonicalMarketBinding` against current Registry and canonicalRoute reads through the aliased Web RPC proxy; its poolTradingEnabled flag was true. The frontend suite passed 329 tests and the preview build succeeded. Browser UI inspection timed out during this follow-up; no wallet transaction was submitted.


## Database display boundary — 2026-09-12

Public page bootstrap and display no longer read RPC or scan explorer/log history. The market projector asynchronously publishes finalized display price, total supply, active/allocated stake and creator tax. Wallet action preparation retains canonical validation, real-time quotes, balances/allowances, simulation and receipt checks. The public chart/price/history cannot be overwritten with live quote or receipt data. The Uniswap v4 trading-ready sentence requested for removal is absent from the deployed Web bundle.

At revision `117997390:0xba004d031471ab7cf7e72373ca163d1f25d96521037c520c9114552c49016058`, all 12 market records contained the new display section. The requested market `0xe596600919dc0beb84a6e5a3660d6dba13c0424f20550f453d4cf7cd8dfdebf1` returned its finalized spot price/supply/tax; its detail response returned eight historical trades, four holders, eight fee credits, zero verified 24-hour volume, and no unavailable-section reasons. A quiet chart interval does not erase the latest historical execution or recent trade list. No synthetic candles are added.

Validation: 331 frontend tests and production build; 46 backend unit tests; nine contract/HTTP tests; backend typecheck and Vercel packaging; local PostgreSQL analytics integration including decimal volume, quiet intervals and missing-coverage rejection. Test aliases were verified via SSH/API and the deployed JS asset. Browser automation timed out, so this change does not claim a new full browser acceptance or a submitted wallet trade. Mainnet was not deployed.


The subsequent Trading fee display update shows quoted fee amounts and asset symbols instead of rates. Curve quotes retain exact returned/reconstructed fee amounts. Exact-input v4 fees use an explicitly approximate reverse calculation from net output (base fee and creator tax floor independently on-chain), denominated in the output token; this estimate never enters settlement or minimum-output math. Frontend tests: 332 passed; Vercel build passed.

The separate Pool fee row was subsequently removed from the trade form. Trading fee amounts remain visible. Typecheck and Vercel build passed.


The chart period update isolates 1H/12H/1D requests to `/v1/markets/:id/candles`. The chart has independent loading/error/cache/cancellation state. Summary requests remain market-scoped; cache hits do not redraw. Unchanged tables and fee sections retain their DOM. A DOM-harness regression exercises period clicks, cached returns, out-of-order responses, and chart-only errors while asserting exactly one initial detail request and unchanged trade-table writes. Frontend tests: 336 passed; Vercel build passed. The user explicitly requested preserving the demand-driven refresh principle for future work.

Token-detail loading isolation (2026-09-12): Web `dpl_8exWzw4oKeC8J7KnuHSF64VG6pWX` skips the full directory/creation templates during detail bootstrap, starts analytics early, and loads the initial chart independently. 337 Web tests and the Vercel build passed. See `docs/reviews/TOKEN_DETAIL_LOADING_AUDIT_2026-09-12.md` for endpoint measurements and limits.

Fee distribution USD display (2026-09-12): Web `dpl_6wa3hbYPFQUPQywzsiq59H7A2REb` values Quote and Meme fee allocations with database prices, renders dollar amounts, and removes the Quote-unit footer. Missing valuations remain unavailable. 339 Web tests and deployment build passed.


## Mandatory Vercel Singapore deployment gate (2026-09-12)

All Vercel deployments must explicitly pass `--regions sin1`. Before aliasing or promotion, run `node services/backend-ts/scripts/check-vercel-region.mjs <deployment-url-or-id>` from the repository root. Unknown/non-Singapore function placement blocks publication. This policy applies to every service and environment; it does not grant production authorization.

The Read API alias previously pointed to `dpl_CdExRn1gUgF2h7Sw2MYb1Gcz8NoQ`, whose **actual functions were in iad1**, despite nested app configuration and project sandbox displaying sin1. The staging-root deployment did not explicitly pass the runtime region. Neither a build location nor a sandbox setting is sufficient evidence of function placement. Redeployed the same staged backend source using `--regions sin1`; `vercel inspect` and the gate verified both `index` and `api/index` in sin1 before aliasing `dpl_48rFj5uP8WgiKbz51nAcDPPEkkAR`.

Uncached test-alias detail requests (CDN MISS) changed from 4,751 / 4,748 / 4,695 ms to 140 / 76 / 79 ms for 1H / 12H / 1D. Response sizes and chart/trade/holder/fee counts matched. See `docs/reviews/TOKEN_DETAIL_LOADING_AUDIT_2026-09-12.md` for the root-cause follow-up. No SQL or transaction safety behavior was changed.

Pool price impact (2026-09-12): Web `dpl_Ey5zoqie3cKkkkXMQ8JEW1L1Y7Me` computes estimated fee-adjusted execution impact against the same-block v4 slot0 already read by the wallet quote. Both swap directions and raw token decimals are covered. No new RPC calls or public statistics refreshes were added. 341 Web tests and the build passed; runtime region gate verified sin1 before aliasing.

Trade asset alignment (2026-09-12): Web `dpl_4iEcn5G3ak3dudc6eekA8Y1R9FEG` restores flex vertical centering for both asset badges and isolates label ellipsis in an inner span. Build and four existing accessibility tests passed; sin1 gate passed before aliasing. Browser visual inspection timed out; deployed markup/CSS were checked directly.

Trade balance reliability (2026-09-12): Web `dpl_8xYbpdd2ngurNjPwfAbj92qhcgoo` accepts balance responses by stable wallet/market/asset context, publishes each asset separately and retries failed reads twice. Existing balances survive refresh failures; late old-wallet responses are rejected. 345 Web tests and build passed; sin1 runtime gate passed before aliasing.

Explore Stock scope (2026-09-12): Web `dpl_51vcjvNqFrBo8rZN7VceLtiQAqyD` limits Stock selection to Bloomed queries and updates only that stage on Stock changes or Stock-only resets. Growing ignores Stock assetUid and retains its page/sort. 345 tests and deployment build passed; sin1 runtime gate passed before aliasing.

The 2026-09-12 Explore/detail code audit preserves later cursor pages across background revisions and price updates, avoids rebuilding unchanged cards and charts, updates cached refresh status independently, and settles abandoned balance waits. Web 347 tests and build passed. Preview `dpl_AVgCxxwZKprVxwgAM5qk1u63ksYW` passed the runtime region gate (one function in `sin1`) before the test alias was assigned. This run has no new browser screenshots because the browser connection timed out; see `docs/reviews/EXPLORE_DETAIL_AUDIT_2026-09-12.md` for scope, timings, and outstanding recommendations.

Explore idle-retention repair: deployment `dpl_4sUykrWnCoGY1jGRgWcADvhzcPjj` passed the runtime gate (one function in sin1) before assignment to the Web test alias. Transient snapshot failures retain labelled cached cards and paging; hidden/pagehide no longer clear the list. All 351 Web tests and build passed. No new browser soak evidence is claimed; see `docs/reviews/EXPLORE_IDLE_RETENTION_FIX_2026-09-12.md`.

Report-driven optimization deployment: Web `dpl_CTqxWjFfbKuKbzsLn1jtibnyDo6R` (1 function) and Read API `dpl_AegKeQ9FTNrP39HEvBgWN1mh9jfM` (2 functions) passed runtime sin1 gates before alias assignment. Adds independent database activity reads, visible-only statistics patches, quote-context isolation, metadata deduplication, strict directory response handling and route-scoped widget imports. Web 359 tests/build, backend contract 9 and unit 47 tests, and the real PostgreSQL analytics integration test passed. See `docs/reviews/EXPLORE_DETAIL_OPTIMIZATIONS_2026-09-12.md`; browser visual acceptance remains blocked by tab-creation timeout.


## Immediate market discovery — 2026-09-12 20:18

Creation no longer depends on the finalized publication fence. The browser sends only a successful launch transaction hash to `POST /v1/launches`; the signed WebSocket relay supplies an independent delivery path. Pipeline verifies the canonical Factory event, complete successful receipts and creation-block observations against two RPC providers, then stores confirmed market/display data plus creation-transaction analytics in PostgreSQL `recent_markets`. Display reads never call RPC.

Web uses `includeRecent=true` on market detail and Explore pagination. Read API merges active confirmed rows into the finalized base, excludes duplicates and serves this overlay with `Cache-Control: no-store`. `/v1/updates` includes `recentVersion`; visible first pages update when discovery changes without waiting for a new finalized revision. Finalized projections replace confirmed rows later. Financial settlement retains its existing finality rules. Confirmed rows expire after 30 minutes if finalized publication has not superseded them; removed-event tombstones suppress reorged records.

Deployment inputs: Web build needs `TG_PROFILE=test` and `VITE_V1_PIPELINE_URL=https://tickergarden-pipeline-test.vercel.app`; Pipeline needs `TG_ALLOWED_ORIGINS=https://tickergarden-web-test.vercel.app`. All three deployments used explicit `--regions sin1` and passed `check-vercel-region.mjs` before aliasing (Web: one function; Read API and Pipeline: two each).

Migration `0003_recent_markets` and role grants are applied to TEST only. During final review the initial script was found to omit its migration-history insert; the script was corrected, the already-created test table was verified and its history row registered. Repeated migration is verified as a no-op. Final digest: `0x38e221fb56825e5d2a9006531fdddaa797df4a75c9ae370fdcf576dd85644f93`.

Validation: 362 Web tests, 50 backend unit tests, nine contract/HTTP tests, two real PostgreSQL integration tests including repeat migration, typecheck/generated artifacts/packaging and deployed builds passed. A real creation receipt replay with an intentionally older finalized database base returned the market in detail and Growing without advancing finality (7.1–7.9 seconds across two runs). Live test Pipeline first observation took 3.485 seconds; the duplicate aliased request took 0.420 seconds. These are samples, not latency guarantees. Aliased Pipeline and Read API readiness, CORS preflight, Web bundle configuration and target market reads passed; chain queue had 260 succeeded jobs and no other states at acceptance. No new launch or wallet transaction was submitted. Browser connection timed out, so there is no new desktop/mobile visual acceptance.
