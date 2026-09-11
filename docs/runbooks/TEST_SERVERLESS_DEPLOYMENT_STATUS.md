# Test serverless deployment status

Last verified: 2026-09-11 (Asia/Shanghai)

## Active scope

Only the Robinhood testnet environment is active. No production Vercel runtime has production chain variables, no production Alchemy webhook is configured, and the production PostgreSQL, queue, and object-storage containers are stopped. Their Docker volumes and protected configuration remain available for a future release.

The VPS Compose file puts all production services behind the `production` profile. Routine `docker compose up -d` therefore starts only the test data services and Caddy.

## Test endpoints

| Component | Endpoint | State |
| --- | --- | --- |
| Web | `https://tickergarden-web-test.vercel.app` | active |
| Read API | `https://tickergarden-read-api-test.vercel.app` | active |
| Content API | `https://tickergarden-content-test.vercel.app` | active |
| Pipeline | `https://tickergarden-pipeline-test.vercel.app` | active |
| Queue relay | `https://queue-test.159-89-207-161.sslip.io` | active |
| S3-compatible storage | `https://s3-test.159-89-207-161.sslip.io` | active |
| PostgreSQL | `159.89.207.161:5433` with required TLS | active |

Credentials are not recorded in this document. Local application secrets are in ignored mode-0600 environment files; server secrets are in mode-0600 files under `/etc/tickergarden`.

## Chain ingestion gate

The original test Alchemy block-only webhook was deleted. Its inactive replacement is a Custom Webhook filtered by two release-bound variables: trusted source addresses and the 27 event topics used by the frontend projectors. The management script seeds fixed addresses from the frozen event catalog and adds dynamic addresses already recorded in `contract_sources` before creating the webhook.

After a test market is created and its sources are committed to `contract_sources`, run `npm --prefix services/backend-ts run alchemy:webhook:sync` with the protected test environment loaded. This updates the existing variables without creating or activating another webhook.

A signed synthetic notification completed the full path through the Vercel pipeline, PostgreSQL inbox/job/outbox, the VPS queue relay, the signed worker callback, and two independent RPC providers.

A short live activation of the deleted block-only query observed about eight notifications per second and created 179 jobs in roughly 20 seconds. The backlog was removed. The filtered replacement remains inactive until a real matching testnet transaction proves that nonmatching blocks generate no deliveries, a newly created market's Meme/Curve/Gauge addresses are added to the address variable, and a bounded load test confirms stable queue depth and provider usage.

This deployment is test infrastructure evidence only. It is not production readiness or permission to broadcast transactions.
