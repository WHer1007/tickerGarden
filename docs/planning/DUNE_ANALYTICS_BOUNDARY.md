# Dune analytics integration boundary

Date: 2026-09-08

## Decision

Dune can replace most of TickerGarden's self-computed public, historical analytics. It must not replace the canonical Read API, contract/RPC reads, transaction tracking, user financial state, or settlement and solvency checks.

The recommended design is a hybrid:

1. Dune indexes and aggregates public history.
2. Scheduled Dune queries produce versioned result sets.
3. A small TickerGarden adapter fetches, validates and caches the latest successful results while preserving the existing `/v1/stats/*` response contracts.
4. The current indexer/Read API/RPC remains authoritative for live markets, trade previews, receipts, positions, rewards, exits and financial controls.

The browser must not hold the Dune API key or execute Dune SQL during each page request. A Dune outage must degrade historical charts and rankings only; it must not block trading, claims or exits.

## V1 Stats product fields

The Pons analytics page was reviewed on 2026-09-08 as a product reference. Its main pattern is a `24h` / `All time` switch over trading volume and token launches, with lifetime developer, revenue and creator-earning totals, daily charts, an explicit Dune link and a data-period note. Its separate buyback-and-burn balances are specific to the Pons fee pipeline and must not be copied into TickerGarden.

TickerGarden V1 uses the following fields:

| UI field | 24h | All time | V1 source and status |
| --- | --- | --- | --- |
| Trading volume (USD) | Sum of external finalized market executions over the rolling 24-hour window | Scheduled historical aggregate | 24h is implemented by the Go Read API with exact-address Quote USD prices. All time remains unavailable until the Dune query is configured and verified. |
| Token launches | Markets whose verified deployment timestamp falls inside the rolling 24-hour window | Current complete market count | Implemented by the finalized market directory. Dune can replace the historical aggregation after parity checks. |
| Bloomed markets | Current count | Current count | Authoritative finalized Read API because this is current market state. |
| Holder addresses | Current distinct positive-balance address snapshot | Current distinct positive-balance address snapshot | Existing holder projection. It is a delayed address count, not a person count or reward-eligibility result. |
| Daily volume and launches | Recent completed intervals | Complete history | Dune is the preferred source after query activation. Until then, the existing Quote-denominated hourly execution detail remains available and USD history stays unavailable. |
| Protocol revenue / creator earnings | Optional later field | Optional later field | Add only after the fee and tax event definitions reconcile exactly with the canonical Postgres projection. |

The Stats page must display `Unavailable` for missing all-time USD history or incomplete Quote USD coverage. A missing Dune result is never rendered as `$0`.

## Dune availability finding

Dune indexes Robinhood Chain raw and curated activity, so it is suitable for TickerGarden launch counts, execution counts, unique addresses and historical series. Its public Robinhood Chain examples currently show that `dex.trades.amount_usd` and `price_usd` can be null for this chain. Dune's general price catalog lists Robinhood support, but long-tail prices are admitted only after filtering and a volume threshold. Therefore chain support alone is not proof that every TickerGarden Quote or Meme Token has usable USD coverage.

For TickerGarden, Dune SQL must calculate raw execution volume from exact protocol events and join USD prices by `blockchain + contract_address`. The existing approved Quote Token price mapping remains the fallback for display conversion. Per-market FDV on `/explore` stays on the finalized Go Read API because it needs the latest protocol execution price and exact baseline supply; Dune may later provide a delayed comparison series but is not the V1 authority for that value.

## Metric suitability

| Metric | Dune suitability | Required TickerGarden definition | Product use |
| --- | --- | --- | --- |
| Issued token and market count | High | Factory events, unique market ID, release/version and canonical token address | Historical totals and trends |
| Trade count and buy/sell count | High | Curve buy/sell plus graduated Pool swap; exclude reverted transactions and identify internal conversions | Historical Stats and rankings |
| Quote-denominated volume | High | Curve consideration excludes fee and tax; Pool volume uses core deltas; internal reward conversions are reported separately | Historical charts and 24h rankings |
| USD trading volume | Conditional | Quote volume multiplied by a timestamp-aligned USD price for the exact chain and token address | Display only; unavailable if quote USD coverage is missing or stale |
| Historical candles | High | One consistent Curve/Pool price basis, with internal conversions explicitly included or excluded | Completed intervals and long-range charts |
| Latest executable price | Low | Current Curve quote or current verified Pool route and price impact | Keep RPC/contract path |
| Holder count and distribution | Medium to high | Positive current balances, zero address removed, documented protocol-address exclusions; address count is not human count | Delayed public analytics |
| Holder eligibility and claimable rewards | Unsuitable | Continuous balance-time accounting, exclusions, finalized roots and on-chain claim state | Keep own Holder ledger/RPC |
| Market cap | Conditional | Label the definition. Current code calculates baseline total supply multiplied by the latest finalized execution price, which is closer to FDV than circulating market cap | Delayed display only |
| User positions, rewards and exits | Unsuitable | Same-block Vault/Gauge/distributor state, finality and proof validity | Keep own Read API/RPC |
| FeeVault solvency, liabilities and settlement | Unsuitable | Canonical financial evidence and exact contract balances | Keep own backend controls; Dune may provide an independent audit view |

## Required SQL semantics

### Trades and volume

TickerGarden has two execution phases. Before Bloom, use decoded `CurveBuy` and `CurveSell` events. After Bloom, filter the canonical Uniswap v4 `Swap` event by the exact market `poolId`. Do not aggregate token `Transfer` volume as trading volume.

For Curve buys, quote consideration is `quoteIn - fee - tax`. For Curve sells it is `quoteOut + fee + tax`. For Pool swaps, use the Meme and Quote core deltas. Internal creator, staker and holder reward conversions must be linked by transaction and classified separately so they do not inflate external user volume. Refund events are not trades.

Every result must retain chain, market ID, token and Quote address, block range, query version and calculation basis. Do not combine raw Quote amounts across different assets as if they were one currency.

### Holders

Counting every address that ever received a token is wrong. The query must reconstruct or read the latest positive ERC-20 balance, remove the zero address, and apply the versioned TickerGarden protocol-address exclusion list. Report both positive addresses and included addresses if the UI needs both.

Dune's curated balance tables are convenient but currently refresh on an approximately 1.5-hour schedule and are in open beta. Raw or decoded `Transfer` events can provide a faster custom result, but they cost more query compute and still need completeness checks. TickerGarden's Holder reward ledger remains separate because eligibility depends on balance-time history and exact finalized accounting rather than a delayed display count.

### USD volume and market cap

Join prices by both blockchain and exact contract address. Never join by symbol alone. If the Quote asset has no fresh Dune USD price, publish Quote-denominated volume and mark USD metrics unavailable.

Dune's long-tail DEX pricing requires sufficient volume and applies filtering; a newly launched Meme or Stock Token may not be covered. TickerGarden currently has a display-only Robinhood REST midpoint source for approved Stock Tokens. That source must remain separately labelled and must never enter trade execution.

Before exposing `marketCapUSD`, choose and label one definition:

- `fdvUsd = baselineTotalSupply × latestFinalizedExecutionPrice × quoteUsdPrice`; or
- `circulatingMarketCapUsd = includedCirculatingSupply × price × quoteUsdPrice` with a versioned exclusion policy.

The current backend basis is the first definition and should be called FDV in the UI unless the supply basis changes.

## Endpoint split

The first Dune-backed migration may cover:

- `GET /v1/stats/overview`
- `GET /v1/stats/series`
- `GET /v1/assets/{assetUid}/statistics`
- completed historical windows of `GET /v1/markets/{marketId}/candles`
- delayed public holder counts and rankings

Keep the existing canonical backend for:

- market discovery and current market phase/reserves;
- `quoteBuy`, `quoteSell`, route selection, slippage and minimum output;
- transaction submission, receipt status and finality;
- wallet positions, allocations, unlock/rage-quit state and exact principal;
- creator, staker and holder claimable amounts and reward conversion;
- Treasury roots/proofs, FeeVault liabilities and solvency;
- any state used to authorize, sign, execute or settle a financial action.

## Adapter contract

The adapter should fetch the latest successful scheduled query result, validate a strict schema, and cache it. Each response needs at least:

- `source: "dune"`;
- `queryId` and an internal query/schema version;
- `sourceBlockNumber` or covered time/block range;
- finality semantics;
- `observedAt` and `cacheAt`;
- metric basis such as volume and supply definitions;
- stale/unavailable status instead of synthetic zeroes.

Keep the current response schemas during the first migration so the frontend and fallback implementation do not change together. The adapter must apply timeouts, response-size limits, rate-limit handling and last-known-good caching. Scheduled-query failure currently has no built-in Dune notification, so TickerGarden monitoring must alert on stale result age and schema mismatch.

## Migration and acceptance

1. Submit and verify the active Factory, Curve, Hook, Pool-related and reward-conversion ABIs. Factory-created token contracts can use Dune's factory/dynamic decoding only after their deployment pattern and bytecode matching are verified.
2. Build versioned SQL for market inventory, external trade volume, internal conversion volume, completed candles, holder balances and optional USD metrics.
3. Run Dune and the existing PostgreSQL implementation in parallel against the same finalized block/time ranges on Arbitrum Sepolia and then RH production observation data.
4. Require exact equality for integer raw volumes, trade/event identity and holder balances after exclusions. For USD values, require identical source timestamps and explicit tolerance because they are display estimates.
5. Exercise missing ABI rows, duplicate events, reorged ranges, stale prices, Dune timeout/rate limit, partial results and query-schema changes. These cases must return stale/unavailable and never a false zero.
6. After sustained parity and freshness monitoring, retire only the duplicated historical aggregation work. Preserve canonical event ingestion needed by transactions, positions, rewards and financial publication.

## Current repository impact

There is no Dune client, query ID, result cache or Dune fallback adapter in the repository today. `CandleStore` currently backs trades, candles, per-asset statistics, global statistics/series and holder endpoints from PostgreSQL canonical projections. The frontend already consumes those Read API contracts, so a provider interface behind the current handlers is the smallest safe integration.

The Stats page currently states that it does not display USD TVL, USD volume, price or yield. Adding Dune does not automatically change that product rule; USD metrics should be enabled only after exact Quote price coverage and labels are accepted.

## External references

- Dune Robinhood Chain: <https://dune.com/blockchains/robinhood>
- Data catalog and dataset layers: <https://docs.dune.com/data-catalog/overview>
- Data freshness: <https://docs.dune.com/data-catalog/data-freshness>
- Contract decoding: <https://docs.dune.com/web-app/decoding/decoding-contracts>
- Token transfers: <https://docs.dune.com/data-catalog/curated/token-transfers/overview>
- Token balances: <https://docs.dune.com/data-catalog/curated/balances/overview>
- Prices: <https://docs.dune.com/data-catalog/curated/prices/overview>
- Scheduled queries: <https://docs.dune.com/web-app/query-editor/query-scheduler>
- API execution and latest results: <https://docs.dune.com/api-reference/executions/execution-object>
- API rate limits: <https://docs.dune.com/api-reference/overview/rate-limits>
