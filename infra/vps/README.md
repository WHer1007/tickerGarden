# TickerGarden VPS runtime

This stack hosts the stateful services that cannot run in Vercel Functions. Test and production share one VPS while remaining isolated by Docker networks, PostgreSQL instances and volumes, MinIO instances and buckets, queue databases, credentials, ports, and public hostnames.

Only the test environment is active. Production services are assigned to the Compose `production` profile, so the default `docker compose up -d` cannot start them. Production volumes and configuration are retained for a later release, but production PostgreSQL, queue, MinIO, Vercel runtime variables, and Alchemy ingestion remain inactive.

| Environment | PostgreSQL TLS | Queue endpoint | S3 endpoint |
| --- | --- | --- | --- |
| test | `159.89.207.161:5433` | `https://queue-test.159-89-207-161.sslip.io` | `https://s3-test.159-89-207-161.sslip.io` |
| production (paused) | `159.89.207.161:5434` | `https://queue-prod.159-89-207-161.sslip.io` | `https://s3-prod.159-89-207-161.sslip.io` |

Secrets live only in `/etc/tickergarden/{test,production}.env` on the server. Starting the test stack uses the default profile:

```bash
docker compose -f /opt/tickergarden/compose.yml up -d
```

The `production` profile must not be enabled while the project is test-only. A future production release requires an explicit operational decision and a separate validation pass before running `docker compose --profile production up -d` or configuring production Vercel/Alchemy resources.

The original block-only and filtered Alchemy Custom Webhooks were deleted after live tests showed per-block delivery and immediate queue growth. The test-chain entry is an Alchemy WebSocket `eth_subscribe("logs")` relay running on this VPS. Ordinary contracts use release-bound and discovered dynamic addresses plus the frontend-required topic0 allowlist. The shared Uniswap v4 PoolManager is isolated into a `Swap topic0 + project poolId topic1` subscription; when no project pool is registered, that subscription is omitted. Matches are durably written to the PostgreSQL inbox; reconnects use bounded 1,000-block `eth_getLogs` chunks within the configured 10,000-block ceiling, and `removed` logs enter reorg rewind/reingest. The relay wakes the Vercel pipeline only after a matching event is committed. Production-chain reads and ingestion remain disabled.

The queue relay implements the subset of the QStash publish and callback-signature protocol used by the TypeScript backend. Messages, deduplication keys, attempts, leases, checkpoints, and dead-letter state are persisted in PostgreSQL. This durable inbox is also the handoff boundary for the WebSocket event relay; Vercel is invoked only after a matching log has been committed.

The test host runs `tickergarden-price-refresh-test.timer` once per minute. Its root-only service reads `TG_PRICE_REFRESH_TOKEN` from `/etc/tickergarden/test.env` and invokes the test pipeline's display-price refresh endpoint. This is required because Vercel Cron runs only for production deployments, while the active test services intentionally use Preview aliases.

Kafka or Redpanda can replace the relay storage when traffic requires partitioned, multi-node streaming. On the current 2 vCPU / 4 GB single host, PostgreSQL-backed delivery keeps message durability while avoiding a second clustered storage system with no high-availability benefit.
