# TickerGarden V1 deployment tooling

> **Current deployment boundary (2026-09-04):** the `V1-EXEC-9` schema, role plan, preflight, and built `dist` contain no deployed-market administration, graduation retry, or terminal rescue role/selectors. Graduation is atomic with the final curve buy; `launchPhase` moves directly from `NotGraduated` to `PoolCreated`. Asset/configuration status remains. No target-chain deployment or readiness gate is implied closed by this local implementation.

This directory is the fail-closed boundary for the future V1 deployment
package. It reads the canonical execution manifest for `V1-EXEC-9` and exports
the shared four-state readiness derivation:

- current state is `IMPLEMENTATION_ALLOWED`;
- implementation, deployment, and production gates remain distinct;
- production candidates are rejected for empty or synthetic values;
- live evidence is accepted only from manifest-pinned finalized-block reads;
- no deployment transaction is submitted.

V1-E-104-A/B are implemented. The manifest schema and structural validator feed
a read-only live verifier for runtime codehashes, key getters/storage, canonical
PoolKey/PoolId, Hook bits, v4 core fees, Position NFT custody, AccessManager
selector events/roles/delays, and finalized role-handoff receipts. The HTTP RPC
transport has a strict read-method allowlist and cannot submit a transaction.
Treasury evidence additionally requires immutable getter proofs that
`TreasuryDistributorV1.authority()` equals the manifested AccessManager and
`marketRegistry()` equals the canonical `MarketRegistryV1`; a selector mapping
on an AccessManager that the Treasury does not actually use is rejected before
any RPC request.

The same binding rule is enforced independently for `OfficialStockRegistryV1`,
`ApprovedQuoteRegistry`, `PonsBaselineRegistry`, and `LaunchTemplateRegistry`:
each Registry must provide finalized-block `authority()` evidence equal to the
manifested AccessManager. One correctly bound Registry cannot stand in for a
missing or mismatched check on another.

Initial-release ERC-20 Quote evidence is fail-closed to direct immutable code:
`proxyKind` must be `NONE`, implementation address/hash must equal the token
address/runtime hash, and the EIP-1967 implementation, admin, and beacon slots
must each be proven zero at the pinned finalized block. The same snapshot must
prove the configured `decimals()` value, and executable `CALLCODE`,
`DELEGATECALL`, or `SELFDESTRUCT` opcodes are rejected. Native Quote remains the
zero-address branch. This proxy proof supplements, rather than replaces, source
review and exact-balance-delta behavior evidence.

V1-C-403 adds a deterministic, calldata-only AccessManager configuration plan.
It derives 22 role-gated selectors and 61 immutable/direct selectors from the
compiled 19-module manifest (83 protocol permissions in total), grants five frozen roles to Safe members, including dedicated and mutually independent Treasury Root publisher/reviewer members, makes the
48-hour governance role the admin of every V1 role, and renounces the bootstrap
`ADMIN_ROLE` last. OpenZeppelin's global-admin configuration surface is then
intentionally locked; `grantRole` and `revokeRole` for V1 roles remain available
only through delayed governance. The planner never broadcasts transactions.

Deployment evidence must retain the registration calldata fingerprint and pin
the immutable beacon address/code. After an upgrade, use immediate guardian
`pauseAsset`, 48-hour-governance `acceptAssetImplementation`, then delayed
`unpauseAsset`, with each step separately evidenced.

`preflightV1Deployment` and `preflightProductionManifest` enforce the canonical
readiness state before any RPC request. The lower-level `verifyV1LiveState` is
available for deterministic tests and evidence generation, but does not alter
readiness or submit transactions. Since central readiness remains
`IMPLEMENTATION_ALLOWED`, the deployment entry points currently fail before RPC.

Run `npm run build` and `npm test` from this directory to verify the tooling.
