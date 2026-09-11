# Test serverless deployment status

Last verified: 2026-09-11 (Asia/Shanghai)

## Active scope

Only the Robinhood testnet environment is active. No production Vercel runtime has production chain variables, no production Alchemy ingestion or chain reads are enabled, and the production PostgreSQL, queue, and object-storage containers are stopped. Their Docker volumes and protected configuration remain available for a future release.

The VPS Compose file puts all production services behind the `production` profile. Routine `docker compose up -d` therefore starts only the test data services and Caddy.

## Test endpoints

| Component | Endpoint | State |
| --- | --- | --- |
| Web | `https://tickergarden-web-test.vercel.app` | active |
| Read API | `https://tickergarden-read-api-test.vercel.app` | active |
| Content API | `https://tickergarden-content-test.vercel.app` | active |
| Pipeline | `https://tickergarden-pipeline-test.vercel.app` | active |
| Chain event relay | VPS internal `chain-event-relay-test:8081` | active, healthy |
| Queue relay | `https://queue-test.159-89-207-161.sslip.io` | active |
| S3-compatible storage | `https://s3-test.159-89-207-161.sslip.io` | active |
| PostgreSQL | `159.89.207.161:5433` with required TLS | active |

Credentials are not recorded in this document. Local application secrets are in ignored mode-0600 environment files; server secrets are in mode-0600 files under `/etc/tickergarden`.

## Chain ingestion gate

Both the original block-only webhook and the later filtered Custom Webhook have been deleted. Live testing showed that the filtered Custom Webhook still posted once per latest canonical block when the filtered log list was empty. The active replacement is a VPS Alchemy WebSocket `eth_subscribe("logs")` relay. Its ordinary-contract filter is the intersection of fixed release-bound addresses, dynamic addresses recorded in `contract_sources`, and the frontend projector topic0 allowlist. The shared Uniswap v4 PoolManager uses a separate `Swap topic0 + project poolId topic1` subscription, so unrelated pools cannot wake Vercel.

After a test market is created and its sources are committed to `contract_sources`, update the relay address set from the frozen catalog and PostgreSQL. New addresses are backfilled from their birth block with bounded `eth_getLogs` before entering the live set. The relay stores a durable PostgreSQL inbox/checkpoint, reconnects after disconnects, and replays a bounded range. `removed: true` logs enter the existing reorg rewind/reingest path. Vercel is woken only after a matching log is committed.

A signed synthetic notification completed the existing Vercel pipeline, PostgreSQL inbox/job/outbox, VPS queue relay, signed worker callback, and two independent RPC providers. The updated pipeline Preview deployment is `dpl_CXm88n4i6HLcwqhHLYzmWpAefUYZ`; `/v1/webhooks/chain-relay` rejects an unsigned body with 401 and the removed `/v1/webhooks/alchemy` path returns 404.

A short live activation of the deleted block-only query observed about eight notifications per second and created 179 jobs in roughly 20 seconds. The backlog was removed. The first WebSocket candidate exposed a second noise source: the shared PoolManager delivered 48 unrelated Swap logs. Those queue, inbox and job records were removed, and the poolId topic1 restriction was deployed. With no project pool currently registered, the healthy relay reported 17 active sources, 0 active pools and 1 subscription; its durable event count remained 0 across a 20-second observation. A real matching testnet transaction, dynamic Meme/Curve/Gauge and pool registration, forced reconnect backfill, and removed/reorg recovery still require bounded acceptance evidence.

This deployment is test infrastructure evidence only. It is not production readiness or permission to broadcast transactions.
