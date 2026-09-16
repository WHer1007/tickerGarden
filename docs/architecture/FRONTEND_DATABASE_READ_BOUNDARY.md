# Frontend database read boundary

Public page data comes from the Read API database: Home, Explore, token identity, price, supply, market capitalization, volumes, charts, trade history, holders, fee allocations, and aggregate stake. An RPC proxy does not change this rule. Missing or stale database data stays unavailable; the browser must not scan logs or fall back to chain/explorer reads.

The backend event relay subscribes to release-bound logs and registered pool swaps. Events wake the ingestion pipeline; scheduled refreshes also advance finalized snapshots for time-dependent gauge state and quiet markets. Market display observations use both configured RPC providers at the same finalized block and are published with block/hash/time provenance. Read handlers never perform those observations. Failed optional display observations omit the display section without invalidating the independently verified market identity/route.

Wallet action forms may read the chain for balances, allowances, executable quotes, claim/exit eligibility, simulation, signing preflight and receipt verification. These live values must not overwrite public price/chart/history/fee statistics or the database position directory. Canonical contract binding checks happen during wallet action preparation, not during public page initialization.

The database detail chart contains only executions in the selected interval. The latest recorded execution and recent-trade list are independent of that chart interval. Volume is returned in whole Quote units. Empty verified intervals and unavailable coverage are distinct. Sparse event indexing uses complete covered ranges, rather than requiring a stored block row for every empty block.

Regression checks: `apps/web/tests/display-data-boundary.test.ts`, backend market-projector unit tests, and `services/backend-ts/tests/integration/analytics-db.test.ts`.


## Demand-driven updates

Frontend data updates are scoped to the affected section. A token-detail 1H/12H/1D action calls only the database candles endpoint, with an independent request, loading/error state, window cache, and stale-response guard. It must not invalidate statistics, holder/fee/history data or wallet form state. Summary cache hits do not render again; unchanged table and fee data do not rebuild their DOM. Independent source refresh schedules are not driven by unrelated controls.


## Token detail loading isolation

A cold trade route loads its target market and the required asset/quote/baseline configurations concurrently after the finalized health revision. It skips the market directory and launch templates. The partial foundation is marked and replaced before entering a page that needs the full directory, including navigation during an in-flight bootstrap. A freshly loaded foundation does not trigger a second health request.

Detail analytics prefetch begins as soon as the route mounts, independently of foundation loading; it is consumed once and validated against the final market identity before display. Initial candles start when the database display timestamp arrives, without waiting for detail analytics. Chart and summary requests have separate cancellation, timeout, error, and cache state. A failed summary preserves a valid database overview and chart. Switching markets cancels obsolete requests.

Wallet balance reads run after a connected wallet/market becomes available and after an explicit trade refresh, never as a prerequisite for public display. Routine background snapshot refreshes do not re-read wallet balances. Canonical route verification and executable quotes remain in the wallet amount/preflight path; completion or failure does not render public fee allocations or statistics.

Wallet balance requests use a stable chain/market/account/asset key rather than the identity of a refreshed database response object. Each asset publishes independently; failures retry at most twice after the initial attempt and preserve previously read values for the same context. Wallet/market changes clear the context and reject late responses. Visibility/network recovery may retry missing balances without refreshing public statistics.

Explore Stock filtering applies only to Bloomed. Stock changes and stock-only resets refresh phase 1 alone and do not invalidate Growing pagination or request its statistics. Growing requests never include the selected Stock assetUid; token search remains shared across both stages.
