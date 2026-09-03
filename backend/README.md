# TickerGarden V1 read API

> **Current API boundary (2026-09-04):** market responses expose one-way `launchPhase` facts and no deployed-market administration or management-recovery state. Asset/configuration status remains available where applicable. The local API and OpenAPI artifacts are synchronized to `V1-EXEC-6`; deployment, audit, and production E2E remain separate gates.

This package exposes a non-custodial, read-only HTTP API over V1 Indexer read
models. It does not hold keys, sign requests, submit transactions, or treat its
cache as the chain's source of truth.

Endpoints:

- `GET /health`
- `GET /v1/markets?assetUid=&limit=&cursor=`
- `GET /v1/markets/:marketId`
- `GET /v1/config/:asset|quote|pons|template?limit=&cursor=`
- `GET /v1/users/:address/positions?limit=&cursor=`

Market responses include canonical IDs and component addresses, Curve progress,
the complete five-field PoolKey when graduated, Router/Quoter/Hook/LaunchLocker,
lifecycle state, and record provenance. Position responses keep free, allocated,
pending, active, activation/unlock timestamps, and Quote/Meme claimables separate.
Amounts are base-10 integer strings; the API never estimates balances or rewards.
Curve progress includes real reserve, sellable/reserved supply, accrued fees,
graduation readiness and sweep time. Canonical route lifecycle fields must match
the market snapshot, and PoolKey Hook/currencies must match that same route.

Every list is deterministically ordered, defaults to 50 rows, and rejects limits
outside `1..100`. Cursors bind the endpoint, normalized filter, ordering key, and
Indexer revision; reuse against another filter or reorged snapshot fails closed.
All successful reads include explicit Indexer sync/finality/head/lag status and
each entity includes its own source block, transaction, and log. Non-GET methods
fail with a typed `405 read_only` envelope. Invalid requests and missing records
use the same error shape and retain the current sync status.

`openapi/v1.json` is the versioned OpenAPI 3.1 contract. The deterministic
generator also writes `src/generated/v1-client.ts`, which exports every response
type plus a GET-only `TickerGardenV1Client`; Backend and Web should import those
types instead of copying response interfaces. The client validates identifiers
and page limits before issuing a request and throws `TickerGardenApiError` for a
typed API error response.

Run `npm run generate:openapi` after intentionally changing the source schema.
`openapi/v1.lock.json` binds its fingerprint to the OpenAPI SemVer and
`V1-EXEC-6`; any changed schema without a version increase fails closed. CI uses
`npm run check:openapi` to reject stale spec, client, or lock output.

The bundled `InMemoryReadModelRepository` defines the adapter contract and is used
for deterministic tests. It accepts only `V1-EXEC-6` snapshots carrying zero I502
reconciliation alerts, then validates canonical hex, unsigned amounts, lifecycle,
PoolKey/route, position conservation, dual assets, uniqueness, and source bounds.
A production process must populate that contract from the canonical I502
checkpoint/projections; the default empty repository reports
`sync.status = unavailable` rather than fabricating data.

Run `npm run build`, `npm test`, or `npm start` from this directory.
