# V1 deployment schemas

> **Current schema boundary (2026-09-05):** `V1-EXEC-11` encodes atomic graduation and removes deployed-market administration, graduation retry, and terminal rescue role/selector requirements; asset/configuration status and the direct `NotGraduated -> PoolCreated` fact remain. Schemas validate the current evidence and plan, but do not claim that a target-chain deployment occurred.

The release-readiness and placeholder rules are frozen in
`spec/v1_execution_manifest.json.readiness` and enforced by the deployment
package. `v1-deployment-manifest.schema.json` is the V1-E-104-A network
deployment schema. It covers chain/finalized-block evidence, external
dependencies, all 19 protocol modules including the shared V1 TreasuryDistributor, configuration snapshots, Quote and
official STOCK identity, four CREATE2 components, Hook mask/core-fee
constraints, all 95 AccessManager permission rows and five frozen role bindings (including independent Treasury Root publisher/reviewer members), product/Fork/E2E reports, gate
evidence, role handoff, and the fixed-block live probes consumed by E104-B.

The schema is necessary but not sufficient for deployment. `schema.ts` combines
JSON Schema validation with the canonical placeholder policy, and `src/v1/preflight.ts`
executes the pinned read-only RPC/code/getter/storage/permission/receipt checks.
`v1-testnet-deployment-plan.schema.json` validates the non-broadcast chain 46630
rehearsal plan, while `v1-deployment-gate-evidence.schema.json` validates exactly
one CLOSED evidence row per technical deployment gate and binds local evidence
files by SHA-256. Product artifacts, plan and evidence are complete for
`DEPLOYMENT_ELIGIBLE`; actual receipts, source verification, role handoff,
production manifest, independent audit and production approval remain separate.
The network deployment schema accepts chain 46630 only with
`releaseStatus=DEPLOYMENT_CANDIDATE`; every `PRODUCTION_CANDIDATE` remains
fail-closed to Robinhood Chain mainnet 4663.

No schema in this directory may weaken the central readiness policy or accept
an unclassified zero/empty/reference-fixture value.
