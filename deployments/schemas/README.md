# V2 deployment schemas

The release-readiness and placeholder rules are frozen in
`spec/v2_execution_manifest.json.readiness` and enforced by the deployment
package. `v2-deployment-manifest.schema.json` is the V2-E-104-A network
deployment schema. It covers chain/finalized-block evidence, external
dependencies, all 18 protocol modules, configuration snapshots, Quote and
official STOCK identity, four CREATE2 components, Hook mask/core-fee
constraints, AccessManager permissions, product/Fork/E2E reports, gate
evidence, role handoff, and the fixed-block live probes consumed by E104-B.

The schema is necessary but not sufficient for deployment. `schema.ts` combines
JSON Schema validation with the canonical placeholder policy, and `src/v2/preflight.ts`
executes the pinned read-only RPC/code/getter/storage/permission/receipt checks.
Actual product artifacts, a production manifest, deployment evidence, and closed
central readiness gates are still required before any deployment.

No schema in this directory may weaken the central readiness policy or accept
an unclassified zero/empty/reference-fixture value.
