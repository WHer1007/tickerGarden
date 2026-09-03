# TickerGarden V2

This workspace is a clean V2 implementation namespace. The previous V1 product runtime was removed without being adapted into V2. Eighteen product modules now compile behind exact artifact checks, including market/configuration registries, creator revenue, fixed-supply Meme token, Curve, Gauge, Factory, Vault/allocation, launch Router, FeeVault, Hook, GraduationExecutor, LaunchLocker, and MarketController. Native and ERC-20 atomic launch-and-buy paths share the same canonical Router entry point and preserve the immediate caller as creator.

Current truth:

- Execution-spec identity: `V2-EXEC-3`.
- V2 documentation and machine-readable specification files are preserved.
- Solidity has a generated, compiled interface baseline with artifact-level ABI checks. `MarketRegistryV2` implements immutable market state and transitions; the four completed configuration registries append-only freeze canonical STOCK, Quote economics, Pons behavior baselines, and launch component identities through an immutable AccessManager authority. The Indexer now has artifact-derived event handlers, canonical replay/reorg checkpoints, and reconciliation alerts; API, maintenance runner, and web retain independent scaffold boundaries.
- Product-contract, Fork, and deployment CI tracks are independent. Product is `ACTIVE` with eighteen compiled modules, Fork is `FIXTURES_ACTIVE` with deterministic local controls but no live replay, and deployment tooling is `ACTIVE` because its schema and read-only live preflight layers are complete. None of these states means a complete product, deployment candidate, or production evidence exists.
- Canonical readiness is `IMPLEMENTATION_ALLOWED`: product implementation is in progress and deployment readiness remains **false**, but the implementation parameter gate is closed.
- The current Robinhood official directory observation contains 194 active STOCK assets. All 194 are selectable as a market's staking base; this count is not a protocol cap.
- A market creator selects exactly one ACTIVE official Asset UID at market creation. That STOCK base is immutable for the market, while holders choose whether and how much of that same STOCK to allocate after graduation.
- STOCK price, USD notional, Chainlink price-feed coverage and backing targets are not protocol inputs. The protocol uses raw STOCK balances only for activation, lock accounting and pro-rata fee distribution.
- The post-graduation staker bucket releases linearly with active STOCK and is capped at 10 whole STOCK per market: `B = 10 × 10^stockDecimals`. Each market snapshots this raw-unit `stakeSaturationAmount`; it is not a price or USD target.
- Historical `V1_*.md` documents remain for audit context only; they are not part of any build or runtime import graph.

## Workspace map

| Path | Current responsibility |
| --- | --- |
| `contracts/src/v2` | Isolated Foundry namespace; generated interfaces, eighteen artifact-checked product modules, reusable implementation layers, and a compile marker |
| `spec/` | V2 execution manifests, reference model, vectors, generators, and compiled-product artifact manifest |
| `V2_OFFICIAL_STOCK_ADMISSION.md` | All-official-STOCK admission rule, fixed-block identity evidence, and user-selectable staking-base boundary |
| `backend/` | Reconciled V2 read API plus versioned OpenAPI 3.1 schema and generated TypeScript client |
| `indexer/` | Artifact-derived V2 event schema, deterministic projections, canonical replay/reorg checkpoint, and reconciliation core |
| `deployments/` | V2 deployment manifest Schema plus fixed-block, read-only, fail-closed live preflight; never submits transactions |
| `services/maintenance-runner/` | Non-privileged maintenance boundary; no transaction submission |
| `website/` | Read-only V2 status page, generated API/ABI bridges, Robinhood wallet configuration, and fail-closed transaction state machine |
| `tools/check-v2-boundary.mjs` | Static guard against V1 runtime reintroduction |
| `tools/check-v2-ci-tracks.mjs` | Fail-closed product, Fork, and deployment track inventory and test runner |

## Verify the scaffold

Prerequisites are Node.js 22.13+, Python 3, Foundry 1.8.1, and the pinned contract dependencies.

```bash
node contracts/scripts/sync-dependencies.mjs --check
npm run build
npm test
```

The root commands deliberately keep specification checks, V2 contract tests, off-chain tests, and website tests separate. A green scaffold does not claim that protocol functionality exists.

See `V2_READINESS_AND_DEPLOYMENT_GATES.md` for the four-state gate, `V2_DEVELOPMENT_PLAN.md` for implementation work, and `V1_CODE_REMOVAL_RECORD.md` for the recoverable deletion record.
