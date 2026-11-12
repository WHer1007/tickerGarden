# Server hosting migration — 2026-11-12

## Result and remaining billing blocker

Web, API gateway, Robinhood/BSC Read API, Pipeline, Content, and the former test aliases now run on the existing Singapore server `159.89.207.161`. Public HTTPS, market reads, internal authentication and queue delivery were verified after DNS cutover. Thirteen hosting services are enabled in systemd. No contracts, signer permissions or financial write capabilities were added.

All eight Vercel projects are paused, automatic Git deployments disabled, and an active deny-all firewall rule protects their old production/preview deployment URLs. Legacy Pipeline and Content Cron jobs are disabled. Observability Plus is off. Flat Rate CDN 10M renewal is canceled, effective **2026-12-11**. Spend Management is set to the platform minimum **USD 1 with automatic pause enabled**; Vercel rejected USD 0. This budget is an additional safeguard, not proof of zero charges or a cap on subscription fees.

**Full billing shutdown is not complete:** Vercel refused the Pro downgrade with “You cannot downgrade while your plan has an overdue payment. Please settle the outstanding invoice first.” The account remains Pro/overdue, with USD 91.99 due. No payment was made. The owner must resolve this at <https://vercel.com/garden24/~/settings/billing>, then complete/retry the downgrade and verify its effective date. Existing invoices and current-period subscription charges do not disappear when workloads stop.

## DNS and entry points

These records have already been saved in Cloudflare; no additional DNS action is required. All use proxied mode and Auto TTL. Keep Cloudflare origin TLS verification enabled. Caddy manages the server certificates.

| Name | Type | Target | Purpose |
| --- | --- | --- | --- |
| `@` | A | `159.89.207.161` | Production frontend |
| `www` | CNAME | `tickergarden.com` | Production frontend |
| `api` | A | `159.89.207.161` | Unified production API |
| `test` | A | `159.89.207.161` | Isolated test frontend/API |
| `content` | CNAME | `api.tickergarden.com` | Compatibility for old Content clients |
| `pipeline` | CNAME | `api.tickergarden.com` | Compatibility for signed callbacks |

New clients use `https://api.tickergarden.com`; chain selection remains `chainId=4663` or `56`. Test clients use `https://test.tickergarden.com`, with chain `46630`. Queue/storage DNS remains unchanged. Root, www and test initially encountered certificate provisioning errors during cutover; certificates subsequently issued and all three returned HTTPS 200.

## Removed background cost

- Disabled the old BSC dispatcher that called two Vercel endpoints every ten seconds even when queues were empty.
- Replaced dispatch HTTP polling with a resident scheduler: every 15 seconds it checks the isolated database for due durable work; only due jobs invoke queue repair/dispatch directly. Lease recovery and retry state remain intact. Idle cycles produce neither dispatch HTTP nor success logs.
- Removed duplicate Vercel/server dispatch and price timers. Each Robinhood environment now has one local five-minute price refresh owner. Pipeline invokes its existing handler directly inside the process.
- Queue delivery, chain relay notifications, gateway upstream requests and worker callbacks use exact private routes. They preserve the original signed URL identity and headers while connecting inside the server network. Unmapped `*.vercel.app` fetches fail closed.
- The frontend now uses the new API origin. Static hashed assets are immutable/cacheable; HTML remains refreshable. Existing RPC proxy, market page rendering, security headers, streaming and redirects are preserved.

Display Workers retain their existing event/request-only code and durable inbox. This release does not add a scan, history recovery, idle RPC or price-triggered chain advance. Production application RPC remains QuickNode; test RPC credentials were not migrated to another provider. BSC staged-opening flags remain disabled. A short post-cutover log sample contained only database/price-read display activity, which is a bounded observation rather than a claim of continuous zero RPC measurement.

## Runtime and source inventory

Release root: `/opt/tickergarden-hosting/releases/20261112`.

| Service name (`tg-hosting-*.service`) | Private port | Original application source |
| --- | ---: | --- |
| `rh-read` | 8201 | `295c186633595b1a8dc90c46ec9031f390863c59` |
| `rh-pipeline` | 8202 | `082eb229236882bde0acc2a1dc8f783ab070f88a` |
| `rh-content` | 8203 | `b5da19a8bee9ea5272d9d63e17f1688bc615c507` |
| `bsc-read` | 8211 | `774b1c5ff5ec9ef4b7fd4db4b2b884ac3d5d7c4b` |
| `bsc-pipeline` | 8212 | `39217f4fb4112a28647d1932e67d24aa82dbadfa` |
| `bsc-content` | 8213 | `b8a1d17e7a6084c3e7779a12e6617f08d9514a87` |
| `test-read` | 8221 | `c74bc3b66fe844a511af46676d98638ed3b1f9de` |
| `test-pipeline` | 8222 | `04f5d0a50cc2048166d504acefff3e93de5eb2a9` |
| `test-content` | 8223 | RH Content source with isolated test configuration |
| `gateway` | 8300 | BSC Read source's existing EVM gateway |
| `web` | 8301 | Production `836cbb090b` tree plus isolated API-origin changes |
| `test-gateway` | 8310 | Same gateway router, isolated test configuration |
| `test-web` | 8311 | `c74bc3b66fe844a511af46676d98638ed3b1f9de`, rebuilt test origins |

The hosting adapter and production frontend origin change were promoted through `test` to `master`, ending at `da1c647d3e8f9a5c13f5405cc9d90f4940b3b296` before this documentation. Existing applications were archived from their exact deployed source commits rather than replacing them with unrelated current worktrees. No dirty development worktree was uploaded.

All new listeners bind `172.18.0.1`, behind Caddy. Firewall access to ports 8201–8311 is restricted to the Docker private network. Node 24.21.0 uses a 192 MB JS heap limit per service and releases temporary startup allocations. A persistent 2 GB swap file provides headroom. At 15:44 UTC, available memory was approximately 1.6 GB, swap use 742 MB, load 0.36/0.56/1.52, and no systemd units were failed. This is a small shared host, not a load-tested capacity guarantee.

## Configuration and routine operations

`/etc/tickergarden/hosting.json` (root-owned, mode 600) is the authoritative configuration for migrated hosting. Keep production/test resources and credentials isolated within it. Do not edit generated `runtime/*.json`, BSC `config/service-runtime.json`, or private route projections by hand. Existing non-hosting worker environment files retain their previous roles.

Validate and render on the server:

```sh
sudo python3 /opt/tickergarden-hosting/releases/20261112/adapter/render-config.py \
  --root /opt/tickergarden-hosting/releases/20261112 --check
sudo python3 /opt/tickergarden-hosting/releases/20261112/adapter/render-config.py \
  --root /opt/tickergarden-hosting/releases/20261112
sudo systemctl restart tg-hosting-rh-read.service
```

Restart only services whose configuration changed. The renderer does not restart anything, dispatch jobs or contact RPC. Check `systemctl status tg-hosting-<name>` and `journalctl -u tg-hosting-<name> --since '15 minutes ago'`. Do not print configuration files into support logs.

Private transport is also loaded by existing resident/display workers and five existing queue/relay containers. Their systemd drop-ins and Compose release overrides preserve it across restarts. Container configuration snapshots are root-only under `/etc/tickergarden/hosting-container-backup`; stopped `*-pre-hosting` containers are retained for recovery. The BSC queue is managed directly with Docker, so preserve its configured read-only loader/transport mounts when recreating it.

The active Caddy configuration is `/opt/tickergarden/Caddyfile`. Validate before reload. Update this bind-mounted file in place; an atomic replacement changes the inode without updating an existing container mount.

## Verification and recovery boundaries

Completed: 798 frontend tests; production and test frontend builds; five adapter tests covering signed URL/body identity, route isolation, blocked Vercel fallback, streaming cancellation and idle scheduling; Python syntax and 13-service configuration validation; master production source boundaries and test frontend source boundary. Authenticated backend metrics returned 200, chain 4663/56/46630 market reads returned 200, and signed probes returned 204. Real production/test durable queue probes were delivered with 204. The BSC signed handler was verified directly; its restricted queue destination allowlist was preserved rather than relaxed for a probe.

Browser verification covered the production homepage, Explore and an existing market trade page. Public root/www/test and API HTTPS passed. Old Vercel endpoints returned 503 or firewall 403. No wallet transaction, new chain event, destructive recovery, full reboot or load test was performed.

Prefer an on-server application/configuration rollback while keeping the new DNS. Preserve durable databases and queue storage; do not run old and new dispatchers simultaneously. The pre-cutover ingress is saved at `/opt/tickergarden/Caddyfile.pre-server-migration-20261112`; do not blindly restore it because its Vercel destinations are retired. Re-enabling Vercel, its cron or paid subscriptions requires a new explicit decision and billing verification. Back up the canonical hosting configuration, service units/drop-ins, release manifest, adapter, source archives and container recreation metadata alongside the existing database backups before removing retained artifacts.
