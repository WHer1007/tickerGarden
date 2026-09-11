# TickerGarden VPS runtime

This stack hosts the stateful services that cannot run in Vercel Functions. Test and production share one VPS while remaining isolated by Docker networks, PostgreSQL instances and volumes, MinIO instances and buckets, queue databases, credentials, ports, and public hostnames.

Only the test environment is active. Production services are assigned to the Compose `production` profile, so the default `docker compose up -d` cannot start them. Production volumes and configuration are retained for a later release, but production PostgreSQL, queue, MinIO, Vercel runtime variables, and Alchemy ingestion remain inactive.

| Environment | PostgreSQL TLS | Queue endpoint | S3 endpoint |
| --- | --- | --- | --- |
| test | `159.89.207.161:5433` | `https://queue-test.159-89-207-161.sslip.io` | `https://s3-test.159-89-207-161.sslip.io` |
| production (paused) | `159.89.207.161:5434` | `https://queue-prod.159-89-207-161.sslip.io` | `https://s3-prod.159-89-207-161.sslip.io` |

Secrets live only in `/etc/tickergarden/{test,production}.env` on the server. Starting the test stack uses the default profile:

```bash
docker compose -f /opt/tickergarden/infra/vps/compose.yml up -d
```

The `production` profile must not be enabled while the project is test-only. A future production release requires an explicit operational decision and a separate validation pass before running `docker compose --profile production up -d` or configuring production Vercel/Alchemy resources.

The original block-only Alchemy webhook was deleted after a live test observed roughly eight notifications per second and an immediate queue backlog. Its replacement uses Custom Webhook variables to require both a trusted current-release source address and one of 27 frontend-required event topics. The replacement remains inactive while test transactions and dynamic source registration are prepared. RPC reads remain a bounded verification and recovery layer after a matching event; they are not a per-block poller.

The queue relay implements the subset of the QStash publish and callback-signature protocol used by the TypeScript backend. Messages, deduplication keys, attempts, leases, and dead-letter state are persisted in PostgreSQL. This avoids running a development-only QStash emulator in production.

Kafka or Redpanda can replace the relay storage when traffic requires partitioned, multi-node streaming. On the current 2 vCPU / 4 GB single host, PostgreSQL-backed delivery keeps message durability while avoiding a second clustered storage system with no high-availability benefit.
