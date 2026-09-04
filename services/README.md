# Services

Independently buildable backend and operational processes live here. Each service owns its package manifest, lockfile, build, tests, and deployment artifact.

| Path | Responsibility | Trust boundary |
| --- | --- | --- |
| `backend-api/` | Reconciled read-only HTTP API and OpenAPI client | Never exposes protocol writes |
| `indexer/` | Event projection, replay, reorg handling, and reconciliation | Derives state from canonical chain data |
| `maintenance-runner/` | Permissionless maintenance transaction preparation/submission | Simulate first; no privileged selectors or custody |
| `treasury-root-generator/` | Deterministic Treasury roots and proofs | Produces data; does not approve or publish roots |

The root `package.json` is the canonical aggregate build and test entry point.
