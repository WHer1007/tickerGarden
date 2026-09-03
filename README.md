# TickerGarden V1

> **Current implementation (2026-09-04):** `V1-EXEC-6` implements permanently autonomous deployed markets. Market administration and protocol-managed recovery have been removed from source, ABI, permissions, deployment schema, and off-chain consumers. `launchPhase` is a one-way lifecycle fact. Asset/configuration registries retain object-scoped controls, and `rageQuit` returns principal immediately before asynchronous reward cleanup. Local gates pass; target-chain deployment, independent audit, and production E2E remain open.

This workspace contains the canonical TickerGarden V1 implementation. The earlier product prototype is classified as **Test Prototype** and is not part of the V1 build or runtime graph. The product surface covers market/configuration registries, creator revenue, fixed-supply Meme token, Curve, Gauge, Factory, Vault/allocation, launch Router, FeeVault, Hook, GraduationExecutor, and LaunchLocker. Native and ERC-20 atomic launch-and-buy paths share the same canonical Router entry point and preserve the immediate caller as creator.

Current truth:

- Execution-spec identity: `V1-EXEC-6`.
- V1 documentation and machine-readable specification files at the repository root and under `spec/` are canonical.
- Solidity has a generated, compiled interface baseline for the current autonomous market surface; target-chain Fork and deployment evidence remain open. The four configuration registries append-only freeze canonical STOCK, Quote economics, Pons behavior baselines, and launch component identities through an immutable AccessManager authority. The Indexer provides artifact-derived handlers, replay/reorg checkpoints and reconciliation; the Backend remains a read-only boundary, the maintenance runner submits only permissionless calls through an injected transport, and the Web binds every funds-sensitive API address back to immutable Factory/Registry views before quote, simulation or signature.
- Product-contract, Fork, and deployment CI tracks are independent. Product is `ACTIVE` with nineteen compiled modules, Fork is `FIXTURES_ACTIVE` with deterministic local controls but no live replay, and deployment tooling is `ACTIVE` because its schema and read-only live preflight layers are complete. None of these states means a complete product, deployment candidate, or production evidence exists.
- Canonical readiness is `IMPLEMENTATION_ALLOWED`: product implementation is in progress and deployment readiness remains **false**, but the implementation parameter gate is closed.
- The current Robinhood official directory observation contains 194 active STOCK assets. All 194 are selectable as a market's staking base; this count is not a protocol cap.
- A market creator selects exactly one ACTIVE official Asset UID at market creation. That STOCK base is immutable for the market, while holders choose whether and how much of that same STOCK to allocate after graduation.
- STOCK price, USD notional, Chainlink price-feed coverage and backing targets are not protocol inputs. The protocol uses raw STOCK balances only for activation, lock accounting and pro-rata fee distribution.
- Post-graduation fees allocate 50% of the non-LP portion to Stakers whenever active stake exists; the remainder is split equally between Creator and Platform. Each Asset UID has an administrator-configured raw-unit `minimumAllocation`, subject to the protocol safety floor of 414 raw units. User-level `rageQuit` returns principal, forfeits unclaimed rewards, and does not affect the market; forfeiture is redistributed to remaining Active stakers or recorded as reserve for later Platform revenue.
- Historical Test Prototype documents are isolated under `docs/test-prototype/` for audit context only; they are not V1 requirements and are not part of any build or runtime import graph.

The repository intentionally has no compatibility alias for the former development-version namespace. Contract names, execution domains, API routes, environment variables, manifests, generated clients, artifacts, tests, and CI profiles all use V1. References to **Pons V2** and independent data-schema revisions such as `MultiAsset.v2` retain their upstream or schema meaning.

## Workspace map

| Path | Current responsibility |
| --- | --- |
| `contracts/src/v1` | Isolated Foundry namespace; generated interfaces, nineteen artifact-checked product modules, reusable implementation layers, and a compile marker |
| `docs/test-prototype/` | Historical pre-V1 product prototype documents; audit context only |
| `spec/` | V1 execution manifests, reference model, vectors, generators, and compiled-product artifact manifest |
| `V1_OFFICIAL_STOCK_ADMISSION.md` | All-official-STOCK admission rule, fixed-block identity evidence, and user-selectable staking-base boundary |
| `backend/` | Reconciled V1 read API plus versioned OpenAPI 3.1 schema and generated TypeScript client |
| `indexer/` | Artifact-derived V1 event schema, deterministic projections, canonical replay/reorg checkpoint, and reconciliation core |
| `deployments/` | V1 deployment manifest Schema plus fixed-block, read-only, fail-closed live preflight; never submits transactions |
| `services/maintenance-runner/` | Non-privileged permissionless maintenance runner; injected transport, simulate-first submission, bounded retries and no signer/custody |
| `website/` | V1 product console with generated API/ABI bridges, Robinhood wallet, Launch/Curve and Vault flows, plus a fail-closed complete-runtime gate |
| `tools/check-v1-boundary.mjs` | Static guard against Test Prototype runtime reintroduction |
| `tools/check-v1-ci-tracks.mjs` | Fail-closed product, Fork, and deployment track inventory and test runner |

## Verify the implementation

Prerequisites are Node.js 22.13+, Python 3, Foundry 1.8.1, and the pinned contract dependencies.

```bash
node contracts/scripts/sync-dependencies.mjs --check
npm run build
npm test
```

The root commands deliberately keep specification checks, V1 contract tests, off-chain tests, and website tests separate. A green local build does not prove the still-open archive Fork, legal, independent-audit, AccessManager installation, production-manifest, or deployment gates.

See `V1_READINESS_AND_DEPLOYMENT_GATES.md` for the four-state gate, `V1_DEVELOPMENT_PLAN.md` for implementation work, and `docs/test-prototype/TEST_CODE_REMOVAL_RECORD.md` for the recoverable deletion record.
