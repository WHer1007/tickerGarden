# Production backend efficiency delivery — 2026-11-13

Production verification: 2026-11-13 03:14–03:21 CST (2026-11-12 19:14–19:21 UTC). Scope: RPC budget coverage and synchronization status first, followed by idle queries and demand-driven prices. Test services were not redeployed or reconfigured; Vercel remains paused. Offsite backups remain deferred.

## Delivered behavior

- BSC Display Worker and Event Relay now require the shared QuickNode policy in production. Missing/invalid policy fails startup. Scope is `production:56:quicknode`: 10 method units/s, burst 20, interactive reserve 5, background concurrency 1, non-interactive concurrency 2. Batch HTTP requests consume one unit per JSON-RPC method. This is a rate/concurrency budget, not a monthly billing cap.
- Worker configuration is projected from `/etc/tickergarden/hosting.json`. The Display control pool is capped at one additional connection using the existing BSC pipeline role. Relay permits use the private Read API mapping with both candidate and permit authentication. No Alchemy fallback was added.
- Additive migration `0037_display_health` records durable, sticky gaps independently of readable snapshots. `/health` exposes `coverage`, `synchronized=false`, `snapshotAvailable`, and `publishedSnapshot`. Its operational `sync` no longer invents a live head or zero lag. The frontend loads the explicitly published snapshot for display; transaction checks remain in their existing active validation paths.
- Display startup, idle, reconnect and price paths do not scan, backfill or catch up. Event recovery continues through the durable inbox and bounded reads. Missing completeness evidence remains `gap/unverified`, including after process restart.
- BSC pool discovery reads the exact current publication before expanding records. Unchanged revisions reuse parsed routes. Tests cover advancement, rollback/reorg and empty routes, including the restricted source role.
- RH Relay serializes only durable claims and shares empty-queue backoff; 8 concurrent deliveries are retained.
- RH's five-minute full-catalog price schedule is disabled. Passive catalog/statistics reads use persisted data. Explicit selected-token reads use TTL reuse and request coalescing, then request only those prices over the private Pipeline route. Frontend demand is bounded and expires; expired RH quotes become `stale` with numeric values removed. One structured batch log retains observation evidence.

## Production evidence

| Check | Result |
|---|---|
| Unauthenticated permit | 403 |
| Occupied background slot | Second background permit returned 429 |
| Interactive reserve during background occupation | 200; all test leases released |
| RH/BSC health | 200, snapshot readable, persistent `gap`, `synchronized=false` |
| Display RPC, 19:14:30–19:20:29 UTC | 0 for both workers, including price notifications |
| BSC Relay after permission correction | 200, 16 sources, 1 subscription, pending 0, dead 0, no current error |
| RH Relay | 200, 20 sources, 1 subscription, 8 publishers, no current error |
| Selected RH USDG / ETH / AAPL reads | 3 refreshes, exactly 1 output per refresh, all available, 0 RPC |
| RH scheduled price work across >5 minutes after restart | Only those 3 explicit refreshes; no full 196-item batch |
| BSC steady routing check | EXPLAIN execution 0.297 ms; one publication PK lookup; 9 buffer hits, 0 reads |
| Earlier routing baseline | 128.031 ms; approximately 103,000 historical publication rows filtered |
| RH empty seed claim sample | 6 calls / 35.90 s, versus audit baseline 72 / 47.51 s (about 89% lower rate) |
| Public BSC Launch page | HTTP 200; HTML matches built artifact; browser main present, no page errors or HTTP 5xx |
| Failed systemd units | None |

The old and new query measurements are short production samples, not load-test guarantees. The new routing measurement is the steady revision check; a changed revision also expands only that selected version. Relay `eth_chainId` and `eth_subscribe` establishment messages are separately metered and are not Display Worker calls.

## Validation and provenance

- Main backend: 260 unit tests passed; 1 mainnet-only case skipped under the default testnet fixture and exercised in a separate successful two-test production price run. Packaging and generated gates passed. Integration: 69 passed, 1 unrelated opt-in capacity case skipped after rerunning the two corrected assertions/setup cases.
- BSC: 261 unit tests and 25 holder tests passed. Integration: 23 passed, 1 unrelated opt-in capacity case skipped after running the loopback TCP and price fixtures. The restricted-role routing test passed again after its permission assertion was added. Both backends typechecked.
- Actual Display process tests covered idle, price notifications, durable event processing and restart after a gap. RPC-control integration, RH Relay 14 tests, and Worker configuration 2 Python tests passed.
- Web: 804 tests, TypeScript, generated source/client/catalog, build, performance and SEO artifact gates passed. The ABI source gate was used for the production composition; unrelated compiled artifacts in another worktree were not used to regenerate ABI sources.
- Product commits were accepted through `test` and then `master`. Main runtime/frontend: `7bf2ee9875f1d8a96118441c00eed8f9fa1983f9`; BSC runtime: `251e89e52fb184b2f5795ffb77189d977490d5b0`; BSC restricted-role grant/test: `3a066279ed5d113e87738258feda2d35a8158b06`.
- Main `test/master` were pushed to origin. BSC is the existing local production repository without a remote.
- Exact live file hashes were checked before replacement. Frontend composition retains the prior production tree and ticker fix, changing only four approved files. Main/BSC source boundary checks passed; no codex branch was deployed.

## Release corrections and rollback

The first migration attempt rejected a digest without its required `0x` prefix; its transaction rolled back before any service change. The corrected digest was applied with the migration.

During rollout, BSC Relay's old restricted role lacked SELECT on the new direct routing tables, causing 9 reconnect attempts. The required SELECT grants were added without business-table write privileges, and a real restricted-role integration check now covers them. Relay health recovered at 19:17:20 UTC; the durable gap remains visible. No complete-chain or no-missed-event claim is made.

Backend rollback: `/opt/tickergarden-hosting/releases/20261112/backups/backend-efficiency-20261112T191425Z`.
Frontend rollback: `/opt/tickergarden-hosting/releases/20261112/backups/web-demand-prices-20261112T191534Z`.

Rollback restores scoped files, canonical configuration, rendered worker profiles, frontend assets and the prior relay image. The additive operational table should remain so a rollback does not erase gap evidence. Old immutable frontend assets were retained for existing tabs.

## Remaining boundaries

The two chains currently report an upstream recovery gap. This delivery makes that state durable and truthful; it does not prove historical event completeness or clear it by scanning. An explicit upstream durable-event repair and evidence would be needed to resolve coverage. Monthly QuickNode consumption and actual savings require provider billing data over a longer window. Global DB connection budgeting, additional public endpoint restriction, resident-loop tuning and unified composite release identity were outside this selected optimization batch.

Evidence: [verification](evidence/2026-11-13-backend-efficiency/verification.json), [post-release logs](evidence/2026-11-13-backend-efficiency/postcheck-final.json), [query plan](evidence/2026-11-13-backend-efficiency/routing-explain.json), [scoped release hashes](evidence/2026-11-13-backend-efficiency/scoped-release.json).
