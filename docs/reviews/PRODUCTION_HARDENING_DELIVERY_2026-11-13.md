# Production hardening and cost reduction — 2026-11-13

Scope: existing Singapore VPS services. No Vercel deployment, financial opening, contract transaction, database migration, or test RPC configuration change. Offsite backup is deferred at the user's request.

## Security and recovery

- Rebooted into Ubuntu kernel `6.8.0-149-generic` after verified on-host database/configuration backups.
- Closed public database ingress on 5432, 5433 and 5434 before Docker NAT, using an nftables prerouting guard installed before Docker starts. Host/private database connections remain functional. External PostgreSQL SSL probes receive no response.
- Removed obsolete UFW public database allowances and fixed the missing final entry in Cloudflare IPv4/IPv6 allowlist parsing.
- Reboot exposed preexisting dynamic Docker IP collisions. Restored and persisted the existing private addresses in projections from `/etc/tickergarden/hosting.json`; recovered only verified orphaned resident-worker advisory locks.

## BSC prices and RPC

- Frontend `98cf02e1a8b2b6b6ec236a193668f39060b2ba34`: accepts verified BSC Binance/raw-unit references and fixed USDT/USDC identities. Expired values become explicitly stale. The production ticker-label fix is preserved.
- Frontend symbol discovery uses the local reviewed catalog. Price views request only BNB/USDT/USDC; a production probe returned all three available with zero RPC.
- Backend `ccaf3cb36beb7601d93fcc723142f68d34b8755d`: reviewed token selection, bounded single-event/request reads, weighted batch accounting and shared PostgreSQL budget. QuickNode policy: 10 RPC methods/sec, burst 20, interactive reserve 5, background concurrency 1, noninteractive concurrency 2. This is a rate/concurrency budget, not a dollar billing cap.
- A selected NVDAB request made exactly four methods: chain identity, finalized anchor, one multiplier read, and an exact-anchor hash recheck. No ranges or catch-up were requested.
- Follow-up `3176460f78bb8f8de7a751cef0da3eec9a0056a8`: requests without `tokens` read persisted prices only, including the legacy statistics-price view. Missing/expired values stay explicit. Full-catalog background requests cannot authorize RPC. Explicit reviewed token selections and authenticated operator requests remain supported.
- Follow-up also hashes multiplier-cache identity to a fixed length. Production monitoring caught a PostgreSQL index-key overflow for the former 78-address cache key; a 96-address database regression test now covers it. The earlier version was not accepted as the final release.
- Display Workers retain their existing push-only/durable-inbox behavior. Price notifications do not advance chain cursors or access RPC.

## Idle queries, storage and logs

- Main event delivery `b06326367b`: durable event inserts wake waiting publishers immediately. Empty polling backs off from 500 ms to a maximum of 5 s. Cross-process/missed hints still discover durable work on the bounded poll; no RPC fallback was added.
- BSC event delivery `9d41e2f`: same bounded wake/backoff behavior in BSC queue and relay. Existing retry, lease and inbox persistence are preserved.
- Measured production claim queries over 59.19 seconds: 4.055 queries/sec, versus approximately 39.6/sec in the initial inspection, about 90% lower. This measures empty queue claims, not total database traffic.
- Price logs retain observations but write shared multiplier evidence once per batch. Each stored asset retains its own complete block/provider/multiplier proof. Existing current-price payloads were compacted transactionally from 979,882 to 172,306 logical bytes (82.4% smaller); price values and timestamps were unchanged.
- Journal policy is projected from the canonical host configuration: 512 MiB persistent cap, 128 MiB runtime cap, maximum 7 days. Relevant recent service logs and system warnings were archived first. Journal usage fell from 3.9 GiB to approximately 410 MiB; active files can vary within the configured limit.

## Verification and release provenance

- Main Web: typecheck, 803 tests, generated source, production build, performance and SEO gates. Public BSC Launch HTML exactly matches the built artifact. The release is the existing production frontend plus the four approved price files; no unrelated local changes were included.
- BSC: 258 unit tests and 25 Holder tests; 22 PostgreSQL integration tests plus one intentionally skipped opt-in synthetic capacity test. Tests include actual worker startup, reconnect, 30-second idle, price pushes and health checks with zero RPC; concurrent weighted budget deductions; 96-address cache keys; and passive public catalog reads.
- Event delivery: 12 RH relay tests, 5 RH queue tests, 13 BSC relay tests and 6 BSC queue tests passed.
- Changes were accepted through isolated `test` and `master` trees. BSC's dirty user checkout was left intact; deployment provenance comes from a separate production checkout. VPS maintenance source gates enforce the accepted master, exact patch hashes, existing isolation, QuickNode-only configuration and required post-release verification.
- Per-step rollback data is retained under `/opt/tickergarden-hosting/releases/20261112/backups/`; initial host/database backups are under `/var/backups/tickergarden-hardening-20261113`. No credentials are included in this report.

Final acceptance at 2026-11-12 18:21:40 UTC (2026-11-13 02:21:40 Asia/Shanghai), covering 93 seconds after the final patch:

- 13 hosting services active; all 9 backend readiness endpoints return 200; all 6 configured workers active; no failed systemd units; 10 containers running.
- BSC Pipeline: exactly four physical RPC requests/four methods, all attributed to the explicit single-stock verification. The unscoped 81-asset catalog and statistics view produce no RPC. Three selected paired assets return available prices with no RPC.
- BSC and Robinhood production Display Workers: zero RPC and zero warning/error events. BSC Pipeline has zero warning/error events in this final window.
- Public Launch HTML matches the approved artifact. Public PostgreSQL probes on 5432/5433/5434 remain blocked after the reboot and container replacements.
- Old/absent price evidence is explicitly stale/unavailable; it is not silently refreshed by catalog polling. GPROB remains unavailable when its provider validation fails.

Remaining scope: offsite backup is intentionally deferred. Existing Vercel billing suspension/deferred arrears decisions were not changed. The BSC repository has no configured remote; accepted commits and production master are retained in the isolated local production checkout, with exact file hashes and rollback copies on the server. No user worktree changes were overwritten.
