# Approved token detail frontend baseline

Approved by the user on 2026-09-08. The reference layout is now the production `/trade?marketId=<bytes32>` template, not just the sample route. Subsequent data work must retain the following structure.

| Region | Frozen fields and behavior |
| --- | --- |
| Shared shell | Current common navigation and wallet picker |
| Compact hero | Token image; symbol first, black; smaller gray token name; contract/copy; creator address without avatar; horizontal Launched label/date |
| Top-right fee allocation | Refined DM Sans metrics, distribution bar and Details; bottom aligned with left hero content; percentages reflect actual Curve/Pool/active stake/holder-sharing state |
| About | Description only here; Symbol, Fixed supply, Circulating supply, Market cap, Holders; Website and X account links; Quote asset; staking base; community note |
| Market overview | Price with Quote unit, period change, 24h Quote volume; 1H/6H/1D/1W/1M/ALL line/area chart; Recent trades and Holders tabs |
| Activity | Time, Type, Price, Amount, Value, Trader; holder address/balance/share; readable empty/error states; latest/top 100 expanded within the card |
| Fee distribution | Separate card below the entire Market overview, including activity; dynamic creator/holders/stakers/platform rows; actual cumulative allocations by asset |
| Trade | Buy green, Sell red (including reverse button); input/output assets and amounts; live wallet balances; on-chain quote, slippage, trading fee, minimum received; shared wallet picker; existing simulation/approval/submission protections |
| Responsive | Existing three-column desktop; responsive center/right and stacked mobile; no page-wide horizontal overflow |

The slogan, top description, “Design preview · illustrative data”, top creator avatar, and duplicate top asset cards remain removed. About no longer repeats Creator/Launched.

## Sources and missing values

- No synthetic prices, amounts, candles, holders or fees appear in the production route.
- Chart gaps stay gaps; empty covered intervals do not receive interpolated prices.
- A known complete zero and an unavailable result are distinct.
- Metadata content comes only from the configured content-addressed backend and is not trusted for economics.
- Price and market cap are Quote-denominated; cap uses the documented circulation policy, not directory FDV.
- Fee percentages are current on-chain configuration; cumulative credits are delayed display-only history.
- Data source and observation time remain visible, with detailed block provenance in the source tooltip.

## Implementation and checks

- `apps/web/src/pages/trade.ts` + `tradeReference.css` + `tradeLive.css`
- `apps/web/src/v1/tokenDetail.ts`, `tokenDetailWidget.ts`, `tokenMetadata.ts`
- `/v1/markets/{marketId}/detail` and OpenAPI `TokenDetailResponse`
- `apps/web/tests/token-detail.test.ts` and `apps/web/tests/browser/token-detail.html`
- `services/backend-go/internal/tokendetail/detail_test.go` and HTTP route tests

The sample preview remains explicitly isolated for historical design reference. The browser integration fixture is separately labelled controlled data and is excluded from the production Vite build. Neither is live market evidence.

The existing execution limitation remains: canonical Curve trades use the verified RPC/allowance/simulation path; graduated V4 submission remains locked until a pinned V4 quoter/builder is implemented. This data integration does not claim to implement V4 transaction routing.

## Verification record (2026-09-08)

- Frontend suite: 156 passing tests, including detail identity/freshness, integer precision, fee rules and immutable metadata verification.
- Production Vite build and complete backend `contract-check` passed. Rebuilt ABI/event source fingerprints were synchronized; ABI surfaces and event definitions were unchanged.
- Backend: race-enabled tests for `internal/tokendetail`, `internal/httpapi`, `internal/analytics`, `internal/app`; `go vet` for those packages; API binary build passed.
- Upload utility: 2 passing tests covering deterministic identities, freshness, deduplication and rejection of circular Dune exports. No remote upload was performed.
- Browser: production unavailable state; controlled valid/stale responses; chart period switching; delayed old-market response isolation; activity expansion; Sell red; desktop and 390px mobile. Mobile document width equals viewport width; fee distribution follows Market overview.
- Runtime boundary: local `/readyz` reports `database=reachable`, `read_model=unavailable`, `status=not_ready`. Dune Query ID and API key are not configured. This is not live testnet/Dune end-to-end acceptance.

Before live acceptance, publish a synchronized verified read model, complete analytics/holder history coverage, and configure a verified Dune query (or use indexer fallback). Follow the Dune setup guide for the exact network coverage probe and optional upload route.
