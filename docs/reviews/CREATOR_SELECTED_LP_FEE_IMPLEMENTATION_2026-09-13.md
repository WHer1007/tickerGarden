# Creator-selected LP fee implementation — 2026-09-13

Status: source implementation complete; NOT_BROADCAST. No commit, deployment, Keeper configuration, or periodic worker activation was performed by this task.

## Business behavior

Creation accepts `lpFeePips` of exactly 0, 1000, 2000 or 3000 (0%, 0.1%, 0.2%, 0.3%). Factory preview validates the same choice as creation, expected-economics schema 8 commits to it, and MarketRegistry stores it without an update path. Fee-policy schema 5 identifies the new regime. Baseline `poolFee` and fee-policy `poolKeyFee` remain the zero default; the canonical PoolKey uses the immutable market choice.

Graduation math, Hook binding, canonical route, and Locker custody accept the selected fee. Before charging its own fee, the Hook requires actual slot0 LP fee to match the canonical key. FeeVault LP allocation remains zero: native LP accrual is separate, and the canonical Locker only owns its own position's rewards. Collection and bounded compounding preserve the previous accounting and permanent-custody protections.

The Factory's validation reads creation parameters directly from calldata, avoiding unnecessary copies of name, symbol and metadata. This keeps Factory runtime within the existing 24,000-byte budget: 23,824 bytes (176 bytes remaining). No runtime size limit was relaxed.

The frontend includes the Advanced switch and three tiers, draft persistence, signed-preview/receipt verification, and separate pool-fee disclosure. Exact quotes already include native pool fees; estimated price impact now removes both native LP and Core protocol fees. `lpFeeMode()` identifies the new Factory ABI. Legacy and burn-only deployment tuples remain supported, with nonzero fee selections rejected on older deployments.

Backend decoding supports the old 20-word, burn 21-word and new 22-word market records. Market projection verifies the stored fee against the canonical pool. Analytics accepts native LP plus bounded Core protocol fees instead of rejecting every nonzero Swap fee. OpenAPI advances to 4.7.0. Deployment schema/preflight validates the tier, market tuple offsets, canonical key, and slot0 equality.

## Verification

- Full local Solidity regression excluding live forks: 93 suites, 1004 passed, zero failed/skipped.
- Focused Hook fee suite: 16 passed; all four tiers preserve FeeVault accounting for both directions and exact-input/exact-output modes.
- Real local v4 PoolManager/PositionManager collection and compounding: all four tiers with ERC20 and native pairs. Nonzero swap fees increase the same locked position; zero tier creates no swap LP rewards. This local fixture mocks only the Permit2 adapter.
- Frontend: 390 tests passed; build passed. Browser interactions passed at 1440px and 390px: default off, all three tiers, preview updates, off reset, and no horizontal overflow.
- Backend: 63 unit tests passed, contract checks/typecheck/build passed. Deployment tooling: 68 tests passed.
- Execution specification: 63 tests passed; current contract surface: 3 passed. Interface, product artifact, fixture, backend ABI/bootstrap, source-boundary and runtime-size checks passed.
- RH mainnet Fork: chain 4663, block 55747994, hash `0xd7bc428f76e456752aed5c129204b1aed67239a2cb824f1be544d41dcd60df78`. All three Fork tests passed through the repository's pinned read-only RPC proxy, including all four fee tiers through real creation, graduation, swaps and Locker fee collection. The RPC is the existing Alchemy mainnet configuration; no credential is included here.

## Release boundary

The changed immutable contracts require a new reviewed deployment to take effect. Existing deployed markets retain their original fee. The current RH/Vercel aliases and deployment configuration are unchanged. Keeper scheduling and snapshot periodic publication remain disabled as requested. Passing these tests is not an independent full security audit or authorization to deploy.
