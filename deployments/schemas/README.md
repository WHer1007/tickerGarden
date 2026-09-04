# V1 deployment schemas

> **Current schema boundary (2026-09-04):** `V1-EXEC-9` encodes atomic graduation and removes deployed-market administration, graduation retry, and terminal rescue role/selector requirements; asset/configuration status and the direct `NotGraduated -> PoolCreated` fact remain. The schema is locally synchronized but is not evidence of a target-chain deployment.

The release-readiness and placeholder rules are frozen in
`spec/v1_execution_manifest.json.readiness` and enforced by the deployment
package. `v1-deployment-manifest.schema.json` is the V1-E-104-A network
deployment schema. It covers chain/finalized-block evidence, external
dependencies, all 19 protocol modules including the shared V1 TreasuryDistributor, configuration snapshots, Quote and
official STOCK identity, four CREATE2 components, Hook mask/core-fee
constraints, all 83 AccessManager permission rows and five frozen role bindings (including independent Treasury Root publisher/reviewer members), product/Fork/E2E reports, gate
evidence, role handoff, and the fixed-block live probes consumed by E104-B.

The schema is necessary but not sufficient for deployment. `schema.ts` combines
JSON Schema validation with the canonical placeholder policy, and `src/v1/preflight.ts`
executes the pinned read-only RPC/code/getter/storage/permission/receipt checks.
Actual product artifacts, a production manifest, deployment evidence, and closed
central readiness gates are still required before any deployment.

No schema in this directory may weaken the central readiness policy or accept
an unclassified zero/empty/reference-fixture value.
