# Independent test references

Production services are Go only. This directory is used exclusively by `make contract-check` and developer validation tools. It has no HTTP listener, scheduler, signer, database adapter, CLI service, package manifest, or deployment artifact.

- `api/` evaluates snapshot/query/pagination rules in memory. The HTTP service has been removed; existing API golden JSON (including cursor bytes) remains unchanged.
- `projection/` applies synthetic decoded events to in-memory maps. Chain ingestion, checkpoint I/O, and worker loops were removed with the old service.
- `settlement-reference.ts` retains only the pure planner and digest. No transaction transport or runner is retained.
- `treasury-reference.ts` retains the pure ROOT_V1 calculation and its tests. It uses the same viem 2.56.3 encoder already pinned in `apps/web/package-lock.json`; run `npm --prefix apps/web ci` from the repository root for these test tools.
- Client tests exercise the Go-owned OpenAPI browser SDK. Source schema and generation are in `../openapi/` and `../scripts/`.

These implementations remain independent of the Go algorithms and generate fixtures that Go tests compare. Updating a Go implementation must not silently update both sides to make a regression pass. Contract changes require specification review, appropriate OpenAPI versioning, and regenerated/verified fixtures.

This is development tooling, not an alternate backend. Node and TypeScript are not required by any production Go binary.
