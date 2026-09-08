> R3 测试链更新（2026-09-06）：7 天持有人周期，0.42 ETH 测试毕业门槛，当前链上地址和测试边界见 [R3 报告](outputs/reviews/arbitrum-r3-scenarios/REPORT.md)。下文 R2 和未部署候选记录保留为历史说明。

> Historical 2026-09-05 pre-brand-renaming verification: that revision was `DEPLOYMENT_ELIGIBLE`, with eight production gates still open. The historical evidence is recorded under [`outputs/reviews/optional-stock-staking/`](outputs/reviews/optional-stock-staking/) and [`deployments/evidence/v1-optional-staking-gates.json`](deployments/evidence/v1-optional-staking-gates.json). No release certificate exists and no broadcast was performed; the older gate evidence remains historical (`STALE`).

Current brand-renamed candidate: `IMPLEMENTATION_ALLOWED / NOT_BROADCAST`. Gate `V1-DEPLOY-ARTIFACT-CODEHASH-01` requires new release identity, ABI/codehash review and deployment rehearsal. Earlier R2 evidence is historical and does not certify these renamed sources.

# TickerGarden V1

> 历史 2026-09-05 发布候选复核（不适用于品牌重命名后的源码）：当时的 product artifact 已由同一候选的完整验证覆盖；旧部署证据仍仅作历史记录。完整验证结果见 [`outputs/reviews/optional-stock-staking/`](outputs/reviews/optional-stock-staking/)。


> **Historical implementation checkpoint (2026-09-05, before brand rename):** `V1-EXEC-11` implements permanently autonomous deployed markets, administrator-curated multi-Quote admission, and atomic graduation in the final Curve buy. Any pool-creation failure rolls back the entire final buy; there is no persistent `Swept` state, graduation retry, terminal rescue, or market-asset recipient. Asset/configuration registries retain object-scoped controls, and `rageQuit` returns principal immediately before asynchronous reward cleanup. The seven technical deployment gates are evidenced as closed; no testnet transaction was broadcast, no production approval was granted, and all eight production gates remain open.

This workspace contains the canonical TickerGarden V1 implementation. The earlier product prototype is classified as **Test Prototype** and is not part of the V1 build or runtime graph. Runnable products are grouped under `apps/` and `services/`: the formal user-facing frontend is `apps/web/`, while the read API, Indexer, maintenance runner, and Treasury root generator live under `services/`. The former auxiliary frontend remains in `archive/legacy-website/` for historical traceability and is excluded from builds, tests, CI and deployment. The product surface covers market/configuration registries, creator revenue, fixed-supply Meme token, Curve, Gauge, Factory, Vault/allocation, launch Router, FeeVault, Hook, GraduationExecutor, LaunchLocker, and the V1 `TreasuryDistributor` surfaced through Rewards. Native and ERC-20 atomic launch-and-buy code paths share the same canonical Router entry point and preserve the immediate caller as creator. A new market may select any administrator-approved `ACTIVE` Quote config; native ETH is one bootstrap example, not a unique or hard-coded release Quote. Arbitrary ERC-20 Quotes, including reviewed proxy assets, follow the administrator-reviewed whitelist and runtime/accounting evidence policy.

Current truth:

- Execution-spec identity: `V1-EXEC-11`.
- Human-readable V1 documentation under `docs/v1/` and machine-readable specification files under `spec/` are canonical.
- Solidity has a generated, compiled interface baseline for the current autonomous market surface. The four configuration registries append-only freeze canonical STOCK, Quote economics, TickerGarden launch baselines, and launch component identities through an immutable AccessManager authority. The Indexer provides artifact-derived handlers, replay/reorg checkpoints and reconciliation; the Backend remains a read-only boundary, the maintenance runner submits only permissionless calls through an injected transport, and the Web binds every funds-sensitive API address back to immutable Factory/Registry views before quote, simulation or signature.
- Product-contract, Fork, and deployment CI tracks are independent and `ACTIVE`. The Fork track replays a fixed Robinhood Chain block against a real official Stock Token BeaconProxy, real Pons reference contracts, and real Uniswap v4 core while executing Stock Quote admission, atomic graduation, Vault allocation, and principal-first `rageQuit`. Synthetic balance funding is explicitly recorded; it is not represented as a natural historical balance.
- Canonical readiness is `DEPLOYMENT_ELIGIBLE`: all seven technical deployment gates are closed by the refreshed [`deployments/evidence/v1-optional-staking-gates.json`](./deployments/evidence/v1-optional-staking-gates.json), with verification details in [`outputs/reviews/optional-stock-staking/`](outputs/reviews/optional-stock-staking/). This authorizes a controlled testnet deployment rehearsal only after operator inputs and the project-pinned test-only v4 dependencies are explicitly accepted. No release certificate exists and no broadcast was performed; readiness does not mean `PRODUCTION_READY` or close the eight production gates.
- The current Robinhood official directory observation contains 194 active STOCK assets. All 194 are selectable as a market's staking base; this count is not a protocol cap.
- A market creator selects exactly one ACTIVE official Asset UID at market creation. That STOCK base is immutable for the market, while holders choose whether and how much of that same STOCK to allocate after graduation.
- As a staking base, STOCK price, USD notional, Chainlink price-feed coverage and backing targets are not protocol inputs. `V1-EXEC-11` implements administrator-reviewed arbitrary Quote admission, including reviewed proxy assets, plus the dedicated Robinhood Stock Quote BeaconProxy evidence path: official Asset UID, canonical token, Beacon/implementation fingerprints, and fail-closed identity drift checks are pinned, with deployment preflight and fixed-block Fork coverage. The 194 Base assets are not automatically Quotes, and no Stock Quote is currently activated. The deterministic price-config generator and initial product allowlist remain `PENDING_PRODUCT_ACTIVATION` production work.
- The protocol fee remains 1% after graduation. LP receives 0%; with Active stakers the split is Creator 40% / Staker 30% / Platform 30%, and without Active stakers it is Creator 70% / Staker 0% / Platform 30%. Staker and Platform portions round down and any integer remainder goes to Creator. Hook sends the full fee to FeeVault; canonical LP remains permanently locked but receives no protocol LP fee. This removes spot-price-sensitive donate/compound paths and reduces gas and keeper operations. Optional stock staking is immutable at creation; disabled markets have no stock binding or Gauge. Current three-case Fork evidence is recorded in `outputs/reviews/optional-stock-staking/`. Platform 收益的后续用途为：70% 股票发展储备、20% 每周优秀 Meme 回购销毁、10% 平台开销；这只是 Platform 份额的二次使用方式，不改变上述链上分配。详见 [`docs/PLATFORM_REVENUE_USE.md`](docs/PLATFORM_REVENUE_USE.md)。
- Historical Test Prototype documents are isolated under `docs/test-prototype/` for audit context only; they are not V1 requirements and are not part of any build or runtime import graph.

The repository intentionally has no compatibility alias for the former development-version namespace. Contract names, execution domains, API routes, environment variables, manifests, generated clients, artifacts, tests, and CI profiles all use V1. References to **Pons V2** and independent data-schema revisions such as `MultiAsset.v2` retain their upstream or schema meaning.

## Workspace map

| Path | Current responsibility |
| --- | --- |
| `apps/web/` | Formal V1 user-facing frontend; markets, trade, create, stats, FAQ, and the `Rewards` page |
| `contracts/src/v1/` | Isolated Foundry namespace; generated interfaces, nineteen artifact-checked product modules, reusable implementation layers, and a compile marker |
| `services/backend-go/` | 唯一后端：Go API、内容服务、索引、维护、结算与 Treasury；OpenAPI 契约归该模块所有 |
| `deployments/` | Deployment schemas, testnet plan, gate evidence, AccessManager plan and fixed-block read-only preflight; the Solidity broadcast entry point remains operator-controlled |
| `spec/` | V1 execution manifests, reference model, vectors, generators, and compiled-product artifact manifest |
| `docs/v1/` | Canonical human-readable V1 architecture, product rules, audit decisions, and readiness gates |
| `docs/test-prototype/` | Historical pre-V1 product prototype documents; audit context only |
| `brand/BRAND_CULTURE_AND_ECOSYSTEM.md` | Approved stock-culture-garden positioning, slogan system, ecosystem flywheel, and the non-normative `Bloom` user-language mapping |
| `archive/legacy-website/` | Archived former auxiliary frontend; historical reference only and excluded from active build, test, CI and deployment graphs |
| `tools/check-v1-boundary.mjs` | Static guard against Test Prototype runtime reintroduction |
| `tools/check-v1-ci-tracks.mjs` | Fail-closed product, Fork, and deployment track inventory and test runner |

## Verify the implementation

Prerequisites are Node.js 22.13+, Python 3, Foundry 1.8.1, and the pinned contract dependencies.

```bash
node contracts/scripts/sync-dependencies.mjs --check
npm run build
npm test
```

The root commands deliberately keep specification checks, V1 contract tests, off-chain tests, and the formal `apps/web` tests separate. A green build plus the recorded Fork closes the technical deployment gate set only; it does not prove legal approval, independent audit, on-chain AccessManager installation, source verification, browser production E2E, monitoring, or canary soak.

See `docs/README.md` for the documentation index, `docs/v1/V1_READINESS_AND_DEPLOYMENT_GATES.md` for the four-state gate, and `docs/v1/V1_DEVELOPMENT_PLAN.md` for implementation work. The formal operator sequence and incident handling are in `docs/v1/V1_TESTNET_DEPLOYMENT_RUNBOOK.md` and `docs/v1/V1_TESTNET_ROLLBACK_CHECKLIST.md`.

环境配置与分支说明见 [config/README.md](config/README.md)。日常联调使用 `test`，仅维护根目录 `.env.test.local`；正式环境保留在 `.env.master.local`，没有正式部署配置时禁止启动。
