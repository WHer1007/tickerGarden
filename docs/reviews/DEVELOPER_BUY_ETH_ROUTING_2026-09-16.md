# Developer buy ETH funding acceptance — 2026-09-16

## Implemented behavior

Create uses existing paired-asset balances first. If insufficient on Robinhood mainnet (4663), Read API quotes only the deficit via a reviewed fixed Uniswap route. The catalog includes 192 Stock tokens and USDG. SATS/BND remain greyed out in the paired-asset picker; contracts, registry entries and staking assets are unchanged.

One application confirmation includes the additional purchase, maximum ETH, price impact including pool fees, minimum paired asset received and total ETH budget. The wallet still requests required transaction signatures. After confirmation: metadata publication, fresh balance/price checks, native ETH purchase, exact allowance when needed, then launch-and-buy. The purchase is a separate on-chain transaction inside the launch workflow; cancellation or failure of launch leaves purchased tokens in the wallet.

No fixed percentage slippage allowance is added. Exact-output purchase caps derive from the fresh quote and cannot exceed the approved ETH cap or approved asset quantity. Router commands are built locally from the shared allowlist; the API cannot specify arbitrary transaction targets, calldata or recipients. Surplus USDG, WETH (unwrapped) and ETH return to the wallet. The existing developer-buy 1% tolerance was removed: its final launch simulation output becomes the launch transaction minimum.

A saved purchase journal tracks uncertain signatures and hashes independently from the launch transaction. Receipt recovery and a fresh balance read precede retries. Manually supplied recovery hashes must match sender, router, value and exact saved calldata. Wallet account/network, codehash, expiry, transaction simulation and receipt transfer checks precede advancement.

## API and deployment

`GET /v1/quote-purchase?chainId=4663&token=<address>&amountOut=<raw amount>` uses the service-scoped Read API `TG_READ_RPC_URL`. No 0x credentials or new service are needed. Requests are allowlisted, uint128-bounded and never cached. Four in-flight quotes and eight queued quotes are allowed per instance; identical in-flight requests coalesce. Responses return block number, expiration, raw amounts and price impact. Errors use public retry copy.

Mainnet Universal Router: `0x8876789976decbfcbbbe364623c63652db8c0904`.
Mainnet runtime codehash verified in the fork: `0x2ce6aaaf9f4151f5e1cbf774668772f17f532ae11b15e9284fd0a072a8b0fbde`.

References: [official deployments](https://developers.uniswap.org/docs/protocols/v4/deployments), [Uniswap SDK deployment profiles](https://github.com/Uniswap/sdks/blob/main/sdks/universal-router-sdk/src/utils/constants.ts), [router dispatcher](https://github.com/Uniswap/universal-router/blob/main/contracts/base/Dispatcher.sol). Actual execution verification below takes precedence over assuming current upstream source matches deployment.

## Verification

- Frontend tests/typecheck and Vercel build including asset budgets.
- Backend tests/typecheck, generated contract/packaging checks and TypeScript build.
- Tests cover allowlisted routes, paused/unknown assets, exact-output encoding, reversed V3 paths, V4 settlement, refund commands, malformed amounts, deadlines, public API errors, no-store behavior and confirmation spending bounds.
- Full transaction tests ran only on an owned local mainnet fork, block **64600190**, hash `0x463e003e590dcec08c4794f216eb8a82447c00aa35b208796a8507655f13929e`. The upstream compatibility proxy rejects broadcast methods.

| Sample | Route | Purchase gas | Result |
| --- | --- | ---: | --- |
| P | ETH → Stock, V4 | 149,380 | Passed |
| CRM | ETH → WETH → USDG, V3 → Stock, V4 | 283,550 | Passed |
| ON | ETH → WETH → USDG → Stock, V3/V3 | 281,118 | Passed |
| DELL | ETH → WETH → Stock, V3 | 181,057 | Passed |
| USDG | ETH → WETH → USDG, V3 | 164,119 | Passed |

Each sample also rejected a deliberately insufficient ETH cap, with no paired-asset balance change. CRM then exercised the production LaunchAndBuyRouter: approval, deliberately reverted launch, verification that purchased CRM remained in the wallet, and successful launch-and-buy retry using that balance. The created token balance satisfied the exact simulated minimum.

Evidence: `outputs/reviews/quote-purchase-integration/fork-64600190.json`.
Reproduction: `node --experimental-strip-types tools/research/verify-quote-purchase-fork.mjs` (local fork only).

The execution samples cover every route shape, not all 192 individual stocks. The full earlier catalog/depth audit is under `outputs/reviews/rh-buy-routes-2026-09-16/`. Every user purchase still requires a fresh quote and simulation; old depth observations are not executable quotes. Browser/wallet UI automation was not performed, consistent with the user's code-only testing preference. No public-chain transactions, commits or deployment were performed for this change.
