# Production runtime P1/P2 repair — 2026-11-09

## Scope and release identity

Scoped backend/operations repair only. No frontend build, alias change, UI/style edit, contract transaction, schema migration, PostgreSQL restart, or financial-worker enablement.

| Component | Accepted source | Production result |
| --- | --- | --- |
| RH Read API | `295c186633595b1a8dc90c46ec9031f390863c59` | `dpl_HJLRNiaBvTWyLYHWHEwJRvjMfiqy`, three functions verified in `sin1`, promoted |
| RH Relay | same commit; image `sha256:b8e3825b1a8d64d0c819c26fa774e9f8c846f50c900e4c26fda2c56afea9f5b1` | Production and test relay healthy |
| RH Display | two reviewed store files over the existing production baseline | `/opt/tickergarden-releases/295c186633-runtime-only` |
| RH backup | `9438cdc47b63020140164e4932a0cedcde618a7b` | Daily systemd timer; first backup and isolated restore passed |
| BSC Read API | `774b1c5ff5ec9ef4b7fd4db4b2b884ac3d5d7c4b` | `dpl_79d8qBdrofN1YjcfqHzCz7hACJGP`, two functions verified in `sin1`, promoted |
| EVM Gateway | same BSC commit | `dpl_5ofW4r4Svtx81GkC3514tzh2ybLy`, one function verified in `sin1`, promoted |
| BSC Display | three reviewed event-consumption files over its existing baseline | `/opt/tickergarden-bsc/releases/774b1c5-runtime-only` |
| Web | unchanged `836cbb090b69640498cc52f31633f2bc77505eb7` | Unchanged deployment `dpl_AzaMyiS2JaQxVGjmEAdZbmNJ7WU6` |

Product changes were accepted through isolated `test` → `master` worktrees. Dirty primary RH/BSC development directories were not used as deployment sources. BSC release repository is `/Users/dear/Documents/code/TickerGarden-BSC-config-release`; its local origin has a checked-out dirty `master`, so that primary working tree was not overwritten.

## Findings, fixes, and limits

### P1: candles returned false coverage gaps

The initial review's apparent range gap was a **sorting defect**, not proof that history was missing: `SELECT number::text AS number ... ORDER BY number` sorted the output text alias. Crossing eight to nine digits selected block `99998354` before newer numeric blocks and misordered coverage ranges. Qualifying numeric source columns fixes anchors, through-blocks and range traversal. Live persisted ranges were contiguous; no production backfill was necessary to correct this defect.

Coverage reads and protocol statistics no longer execute concurrent queries on the same PoolClient. Updates resolve publication/sync/data inside one repeatable-read, read-only transaction, preventing mixed revisions during a concurrent publication.

Production checks: health and updates 200; original failing historical interval 200; the candidate's recent covered interval also 200. A later rolling interval extending beyond persisted coverage returned 503, correctly. **This repair does not claim continuous live-head coverage.** Under push-only policy, absent events do not authorize a history scan. Unproven intervals remain unavailable until an authorized upstream/request-driven process establishes coverage.

### P1: idle RPC and legacy recovery timers

Removed Relay's 30-second `eth_blockNumber` heartbeat. Request timeouts and transport close/error still reconnect; a quiet subscription does not generate chain requests. Production Relay now resolves only QuickNode endpoints; removed residual Alchemy fallbacks.

Disabled legacy five-minute chain-refresh timers in production and test. They invoked bootstrap scans independently of an active request and violated the current RPC boundary. Explicit operator recovery remains available. Price-only updates continue without chain RPC.

### P1: RH backup gap

Added daily RH application + queue logical backups at 20:15 UTC with up to ten minutes jitter. Files are private, checksummed, and published atomically after archive inspection. Added password-free role definitions because row-level policies reference roles even with `--no-owner --no-acl` dumps.

Restored and queried all five databases (RH app/queue; BSC app/queue/relay) inside a temporary PostgreSQL 17 container with no network, 0.5 CPU and 384 MiB. Main databases restored 111 and 109 tables and their projection checkpoints; queue/relay databases also restored. The temporary container/volume were removed. Production PostgreSQL was never restarted or restored into.

Local verified off-host copy: `/Users/dear/Documents/TickerGarden-Backups/2026-11-09/`. Five dumps plus role manifest total 41,643,128 bytes; all six SHA-256 checks passed. This is **one verified local copy**, not an always-online remote backup service. Server backups are scheduled; future off-host synchronization, remote retention and delivered failure alerts are not yet automated. RH retention remains non-destructive pending an off-host retention policy.

### P2: test RPC 403 and old Display runtime

User confirmed Alchemy service termination. Server test HTTP now uses `https://rpc.testnet.chain.robinhood.com`, independent public HTTP uses `https://robinhood-testnet.drpc.org`, and WS uses `wss://robinhood-testnet.drpc.org`. Chain 46630 and log subscription were verified. Production credentials are not reused. Authoritative local test config and Vercel Pipeline **preview variables** were updated; existing Vercel preview deployments are immutable and were not redeployed in this backend production release.

A follow-up exposed the old test Display process still scanning after RPC availability returned. Temporarily stopped it, verified a seven-file overlay on the exact old baseline, then started `/opt/tickergarden-releases/295c186633-test-display-only-v2`. It is now push-only. Five boundary/process tests passed, including startup, a 30-second idle interval, price push, listener reconnect and recovery hint making zero RPC calls. No DB migration or production worker restart accompanied this test repair.

### P2: BSC quote work and Gateway cancellations

Read API reuses a complete persisted batch only when every observation is recent (15-second bound) and every available quote is unexpired. Missing, future-dated, expired and incomplete batches trigger the existing refresh/rejection path. GPROB remains unavailable for `book_spread_exceeded`; trading thresholds and frontend exclusion were not relaxed.

Gateway forwards a request ID, records quote outcome/header latency, distinguishes client cancellation (499), upstream timeout (504) and other failure (502), and bounds quote wait to 25 seconds. Logs exclude query strings, credentials and upstream URLs. This improves diagnosis; historical 499s cannot all be retrospectively attributed to one root cause.

Eight post-release public price requests returned 200, 81 rows, 80 available and GPROB rejected. First observed request took 6.49 seconds; seven following requests took 0.50–1.10 seconds. These are small-sample client timings through a local proxy, **not** sustained server latency percentiles or proof that all slow requests are eliminated.

### P2: stale transport failures, old display event and health status

Both historical transport dead letters had a downstream succeeded job with exactly the same operation ID and payload digest. Preserved original records and success proof at `/var/backups/tickergarden-runtime-repair-20261109/transport-dead-resolution.json`, annotated their resolution, and did not replay or delete them. Their physical transport state remains `dead` for audit; unresolved business jobs are zero.

The one old display event is now acknowledged only after exact identity/content matches against canonical finalized blocks and logs, including the current finalized baseline. No RPC scan or state rollback was needed. Tests cover mismatched data, removed/non-finalized events and duplicates.

Health no longer rewrites a persisted `synced` publication to `lagging` solely because indexing is idle. It continues to state `syncBasis=persisted-publication`, `liveChainHeadVerified=false` and checkpoint age. Idle is not proof of current-head synchronization.

## Validation and evidence

- RH: 258 unit tests, 70 distinct database integration cases including the separately enabled 100,001-holder capacity case, 12 Relay tests; typecheck, generation and packaging checks passed.
- BSC: 276 backend/Holder tests, 22 database integration tests (no skips), 29 Gateway/release-gate tests; typecheck/build passed.
- Test Display overlay: typecheck and five focused boundary/process tests passed against its existing baseline/dependencies.
- BSC recent production-address Fork at block `132563064`, hash `0x80be464f250644a7eb62853984ede0288c701981caf9ee81bd11cb6dc2ae5bfd`: 21 module code hashes, production template/governance/economics checked; BNB and USDT Factory creations, frontend notification/reload recovery, real independent DB writes, duplicate callback and RH isolation passed. No mainnet broadcast; Holder approval remains closed.
- Candidate and post-promotion cross-chain health, configs, markets and quote API checks passed. All six deployed functions were verified in `sin1` before promotion; Web deployment ID unchanged.
- Restore activity coincided with brief slow-connection/query warnings. They are retained in evidence, not suppressed. The 15-minute RH release health gate subsequently passed. PostgreSQL containers have remained running since September 23; no active blocking sessions were observed.

Final server window 10:12:00–10:15:01 UTC: all six resident/display/relay services active, zero new structured warning/error records, zero RPC usage records while idle, no failed systemd units, 21 PostgreSQL connections and zero blocking sessions. RH deadlock counter remained at its historical value of 2; BSC was 0. This is a bounded observation window, not a long-duration stability claim.

Private raw evidence, logs and rollback configuration are under `.codex_tmp/runtime-fixes/` in the isolated RH and BSC worktrees; BSC sealed release acceptance is under `TickerGarden-BSC-config-release/evidence/2026-11-09-runtime-fixes/`. Secrets, DB dumps and private env snapshots must not be committed.
