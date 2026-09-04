# TickerGarden legacy website（已归档）

> **Archived 2026-09-04:** 本目录是已停止维护的旧辅助前端，仅用于历史追溯。TickerGarden V1 唯一正式用户前端是 `apps/web/`。本目录不参与根级构建、测试、CI、部署或新功能对接；旧托管描述符已改名为 `.openai/hosting.json.archived`，避免被识别为可发布站点。以下内容保留为归档时快照，不代表当前产品口径。

> **Current product boundary (2026-09-04):** the console must not offer market-level pause, retire, Emergency, or Recovery management. It should display one-way `launchPhase`, retain asset/configuration pause/retire messaging, and make user `rageQuit` available at all times for immediate principal return with asynchronous reward forfeiture/reallocation. This target is not a completion claim.

This Vite/React app is the V1 product console for Robinhood Chain (chain ID
4663). V1 starts locked unless all five runtime settings below are supplied.
The parser in `src/v1/runtimeConfig.ts` fails closed on any missing or malformed
value; contract addresses must be lowercase, non-zero 20-byte hex addresses.

## Local setup

From this directory:

```sh
npm install
npm run dev
```

Other useful checks:

```sh
npm run build
npm run test
```

`npm run dev` serves the local Vite page. `npm run build` runs generated-artifact
and type checks before producing the build. `npm run test` runs those checks plus
the unit and Sites-worker tests.

## Product routes

The browser uses History API routes backed by the Sites worker's HTML fallback:

- `/` — protocol overview and product entry points
- `/create` — Factory-preview-bound Meme market creation
- `/markets` — fully paginated canonical market directory
- `/markets/:marketId` — Curve trading and graduated-pool route facts
- `/portfolio` — STOCK deposit, allocation, earnings and immediate Rage Quit
- `/rewards` — holder rewards plus V1 Treasury TWAB/Merkle claim, root request and permissionless settlement flows
- `/stats` — revision-scoped market counts and per-Quote raw balance totals
- `/faq` — launch, trading, allocation and safety explanations

The market directory and statistics never insert sample records. Statistics are
computed only from market pages that share one finalized revision; balances for
different Quote assets remain separate. The current API has no canonical price,
volume, TVL or time-series contract, so the site does not claim those metrics.

## Required V1 environment

Copy `.env.example` as a starting point, then provide approved values through
the local environment. The example intentionally contains only non-production
placeholder text; do not treat it as a deployable configuration.

```text
VITE_V1_READ_API_URL
VITE_V1_FACTORY_ADDRESS
VITE_V1_LAUNCH_ROUTER_ADDRESS
VITE_V1_ALLOCATION_MANAGER_ADDRESS
VITE_V1_PROTOCOL_FEE_VAULT_ADDRESS
VITE_V1_CREATOR_REVENUE_REGISTRY_ADDRESS
VITE_V1_TREASURY_DISTRIBUTOR_ADDRESS
VITE_V1_TREASURY_PROOF_API_URL
```

`VITE_V1_READ_API_URL` and `VITE_V1_TREASURY_PROOF_API_URL` must be HTTP(S)
origins such as `https://api.example.test` (or
`http://localhost:8787` for local work). Paths, credentials, query strings, and
fragments are rejected because the canonical read routes live at `/health` and
`/v1/*`.

The frontend does not accept placeholder or zero addresses. If configuration is
missing, the page reports the missing keys, keeps transactions locked, and does
not construct a V1 read client. It also rejects a health response that does not
explicitly declare the complete V1 product runtime and the expected
read-only/non-custodial API boundary. The current Backend contract's
`productRuntimeImplemented: true` flag only indicates that the client-side
transaction capability is implemented. It does not certify deployment: the versioned API
must be synchronized, all deployment addresses must be supplied, and every
configured address must pass onchain code/binding verification. If configuration is present but the finalized
read snapshot cannot be loaded, or any configured contract has no runtime code,
`App.jsx` keeps the runtime gate closed and disables actions. A successful local
build or test run is not evidence of a deployment.

When the gate eventually opens, configured Router, AllocationManager and
ProtocolFeeVault addresses must first match the immutable bindings returned by
the configured Factory. The app then resolves the four configuration registries
and MarketRegistry from that Factory and compares any API-projected STOCK,
Vault, Quote, Meme, Curve, Gauge, pool route and lifecycle identity with fresh
onchain views. This comparison runs before live quotes and again at every
simulation/signature freshness checkpoint; an API address cannot become an
approval spender or transaction target based on formatting alone.

Never put private keys, wallet secrets, or signer configuration in this file or
in Vite environment variables. Wallet signing is intentionally performed by the
user's connected wallet when the runtime gates are open.

## Release boundary

Formal publication remains gated by the approved production manifest and its
deployment/codehash and chain preflight evidence. It also requires the separate
legal, security, and independent audit gates to be closed. Local runtime values,
mock/test fixtures, a reachable API, or passing `npm run build`/`npm run test`
cannot substitute for those production gates.
