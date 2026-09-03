# TickerGarden V2 deployment tooling

This directory is the fail-closed boundary for the future V2 deployment
package. It reads the canonical execution manifest for `V2-EXEC-4` and exports
the shared four-state readiness derivation:

- current state is `IMPLEMENTATION_ALLOWED`;
- implementation, deployment, and production gates remain distinct;
- production candidates are rejected for empty or synthetic values;
- live evidence is accepted only from manifest-pinned finalized-block reads;
- no deployment transaction is submitted.

V2-E-104-A/B are implemented. The manifest schema and structural validator feed
a read-only live verifier for runtime codehashes, key getters/storage, canonical
PoolKey/PoolId, Hook bits, v4 core fees, Position NFT custody, AccessManager
selector events/roles/delays, and finalized role-handoff receipts. The HTTP RPC
transport has a strict read-method allowlist and cannot submit a transaction.

V2-C-403 adds a deterministic, calldata-only AccessManager configuration plan.
It derives 22 role-gated selectors and 58 immutable/direct selectors from the
compiled 18-module manifest, grants the four frozen Safe roles, makes the
48-hour governance role the admin of every V2 role, and renounces the bootstrap
`ADMIN_ROLE` last. OpenZeppelin's global-admin configuration surface is then
intentionally locked; `grantRole` and `revokeRole` for V2 roles remain available
only through delayed governance. The planner never broadcasts transactions.

`preflightV2Deployment` and `preflightProductionManifest` enforce the canonical
readiness state before any RPC request. The lower-level `verifyV2LiveState` is
available for deterministic tests and evidence generation, but does not alter
readiness or submit transactions. Since central readiness remains
`IMPLEMENTATION_ALLOWED`, the deployment entry points currently fail before RPC.

Run `npm run build` and `npm test` from this directory to verify the tooling.
