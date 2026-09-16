# TickerGarden V1 deployment tooling

> **Current deployment boundary (2026-09-05):** `V1-EXEC-11` is `DEPLOYMENT_ELIGIBLE`: seven technical deployment gates are closed by the checked evidence report. The Robinhood testnet file is a non-broadcast plan, not proof that a deployment occurred. Eight production gates remain open and the repository grants no implicit broadcast authority.

This directory is the fail-closed boundary for the future V1 deployment
package. It reads the canonical execution manifest for `V1-EXEC-11` and exports
the shared four-state readiness derivation:

- current state is `DEPLOYMENT_ELIGIBLE`;
- implementation, deployment, and production gates remain distinct;
- production candidates are rejected for empty or synthetic values;
- live evidence is accepted only from manifest-pinned finalized-block reads;
- read-only plan verification submits no deployment transaction.

The deterministic Solidity entry point lives at
`contracts/script/v1/DeployV1Deterministic.s.sol`. Its `preview()` path validates
dependencies and prints the complete CREATE2 graph without loading a private
key. Its `run()` path requires the expected deployer and previewed orchestrator,
then deploys the 16 ordinary components, Hook/Executor helper pair and Factory.
Registry activation, role handoff and market creation are deliberately separate.

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

Quote eligibility is determined solely by an administrator risk-reviewed
whitelist. `addQuoteConfig` is the generic configuration path and supports
native assets, ordinary ERC-20s, and Stock proxy tokens. `addStockQuoteConfig`
is an optional path for explicit Asset UID, Beacon, implementation, runtime
codehash, or EIP-1967 proxy-slot fingerprint commitments; none of those
commitments is a universal admission ban. Codehash, proxy-slot, opcode,
`decimals()`, and transfer-behavior observations remain review and safety
evidence. Numeric bounds, frozen economics, `ACTIVE` status, access control,
and exact balance-delta accounting remain required. Native Quote remains the
zero-address branch.

Robinhood official Stock Tokens remain eligible as Base assets under the unchanged
`OfficialStockRegistryV1` policy, but Base eligibility does not automatically make
one a Quote. They may enter the same administrator-reviewed Quote whitelist through
`addQuoteConfig`; explicit Stock fingerprint commitments remain available through
`addStockQuoteConfig`. No Stock Quote, USDG Quote, or cbBTC Quote is currently
`ACTIVE`. Admission, live fixed-block Fork and preflight are implemented. The
deterministic price-config generator and initial product allowlist are
`PENDING_PRODUCT_ACTIVATION`; they are production activation work rather than an
open runtime or Fork gate.

V1-C-403 adds a deterministic, calldata-only AccessManager configuration plan.
It derives 23 role-gated selectors and 64 immutable/direct selectors from the
compiled 19-module manifest (87 protocol permissions in total), grants five frozen roles to Safe members, including dedicated and mutually independent Treasury Root publisher/reviewer members, makes the
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
readiness or submit transactions. Central readiness is now
`DEPLOYMENT_ELIGIBLE`, so deployment preflight may run; production preflight
continues to fail until all eight production gates are closed.

The pinned rehearsal plan is
`manifests/robinhood-testnet-46630.v1.plan.json`; its chain 46630 v4 contracts
are project-pinned test-only dependencies because no Uniswap-published 46630
mapping was found. Explicit acceptance and a same-day live codehash recheck are
required before any broadcast. See
`../docs/v1/V1_TESTNET_DEPLOYMENT_RUNBOOK.md` and
`../docs/v1/V1_TESTNET_ROLLBACK_CHECKLIST.md` for the operator sequence.

Run `npm run build`, `npm test`, and `npm run check:testnet-plan-live` from this
directory to verify the tooling. None of these commands broadcasts.

### Create paired-asset release selection

`manifests/robinhood-mainnet-4663.paired-assets.json` records the user-selected
56-asset Pons V2 create universe (ETH + 55 tokens). Generate/check with
`python3 tools/generate-v1-paired-assets.py [--check]` from repository root.
Production preflight now checks membership, token units, economics and canonical
identity against this file before the existing live checks. This is a product
selection, not a Registry activation receipt: 53 official stocks still need their
own admission/configuration, including USDG and cbBTC. It does not apply mainnet
addresses to testnet.
