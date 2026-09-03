# TickerGarden website

This Vite/React app is the V2 product console for Robinhood Chain (chain ID
4663). V2 starts locked unless all five runtime settings below are supplied.
The parser in `src/v2/runtimeConfig.ts` fails closed on any missing or malformed
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

## Required V2 environment

Copy `.env.example` as a starting point, then provide approved values through
the local environment. The example intentionally contains only non-production
placeholder text; do not treat it as a deployable configuration.

```text
VITE_V2_READ_API_URL
VITE_V2_FACTORY_ADDRESS
VITE_V2_LAUNCH_ROUTER_ADDRESS
VITE_V2_ALLOCATION_MANAGER_ADDRESS
VITE_V2_PROTOCOL_FEE_VAULT_ADDRESS
```

`VITE_V2_READ_API_URL` must be an HTTP(S) origin such as
`https://api.example.test` (or `http://localhost:8787` for local work). Paths,
credentials, query strings, and fragments are rejected because the canonical
read routes live at `/health` and `/v2/*`.

The frontend does not accept placeholder or zero addresses. If configuration is
missing, the page reports the missing keys, keeps transactions locked, and does
not construct a V2 read client. It also rejects a health response that does not
explicitly declare the complete V2 product runtime and the expected
read-only/non-custodial API boundary. The current Backend contract deliberately
reports `productRuntimeImplemented: false`, so this release stays transaction-
locked until the remaining product, legal, security, and deployment gates are
closed and that versioned API contract is advanced. If configuration is present but the finalized
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
