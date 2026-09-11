# Frontend performance audit — 2026-09-12

Scope: Vercel web shell, Home, Explore, token detail/trade, Create, Stake, Claim, Stats, the shared Read API, static assets, polling, and data completeness on the Robinhood testnet deployment.

Evidence was collected from the current checkout and from the Singapore VPS against the aliased test deployments. Timings are point-in-time samples, not an SLO or percentile study.

## Baseline

| Surface | Cold or first sample | Warm samples | Response size |
| --- | ---: | ---: | ---: |
| Web HTML | 0.35–0.87 s | 0.07–0.34 s | 1.4 KB |
| Read API `/health` | 2.53 s | 0.07–0.08 s | 551 B |
| Read API `/v1/markets?limit=20` | 1.39 s | 0.08–0.10 s | 25.9 KB |
| Read API `/v1/protocol-statistics` | 2.72 s | 0.06–0.08 s | 3.5 KB |
| Read API `/v1/prices/references` | 0.56 s | 0.07–0.08 s | 2.7 KB |

The deployed HTML loads 186 KB compressed application JavaScript, 86 KB compressed chain JavaScript, about 26 KB compressed CSS, and a 147 KB WOFF2 icon font before route-specific content and data. Vercel returned `x-vercel-cache: HIT` for the HTML and immutable hashed assets after warm-up.

## Findings and changes

| Priority | Finding | Evidence and impact | Action |
| --- | --- | --- | --- |
| P0 | Token detail analytics rejected valid sparse block storage as a coverage gap. | All 12 markets returned `statistics`, `chart`, and `trades` as `null` for 1H and 12H. The database had complete `covered_ranges`, but the reader incorrectly required one `chain_blocks` row for every block. Live ingestion intentionally stores range evidence and relevant/boundary blocks. | Fixed in the serverless Read API: validate the ingestion checkpoint and continuous complete `covered_ranges`, matching the statistics reader. |
| P0 | Read API cold starts dominate data load. | Same-region cold samples were 1.39–2.72 s while warm samples were 60–100 ms. Every dynamic page depends on the shared foundation load. | Keep functions in `sin1`; next reduce cold DB round trips with an aggregated foundation response and consider Vercel warm-instance or Fluid configuration after measuring cost. |
| P1 | Route templates are split, but route behavior is still eager. | `src/app.ts` is 5,993 lines / 393 KB source and imports Create, Trade, Stake, Claim, Treasury, analytics and wallet logic before route selection. The main minified chunk remains about 668 KB, gzip 186 KB, plus the 292 KB chain chunk. | Split page controllers and write flows behind route-level dynamic imports. This is the largest remaining frontend code change and needs staged regression testing. |
| P1 | Initial foundation loading fans out across services. | A cold dynamic page reads health, four config collections, a market page, Factory bindings/fees/registries and runtime code before all features become ready. Explore then requests two stage pages and market statistics. | Add a revision-bound `/v1/foundation` read model containing health, configs and the initial directory; keep direct contract checks only for transaction readiness and refresh them immediately before writes. |
| P1 | Three below-the-fold Home images downloaded eagerly. | The PNG files totalled 3.14 MB and had no lazy loading or intrinsic dimensions. | Fixed: lossless WebP is pixel-identical, totals about 1.59 MB, reserves 1254×1254 layout space, decodes asynchronously, and is lazy-loaded. This saves about 1.55 MB of stored bytes and removes the images from initial page loading. |
| P1 | Stats retried deterministic partial data for up to roughly 150 seconds. | Missing price coverage set `valid=false`, causing up to 18 repeated `/v1/protocol-statistics` requests even though a price-store update already triggers a render. | Fixed: timed retries now run only while the server says the snapshot is pending/stale. Known partial values remain `Unavailable` and wait for the global price update. |
| P1 | The global price request bypassed normal browser caching. | The store set Fetch `cache: no-cache` even though the API publishes a 60-second browser and five-minute shared cache. | Fixed: use normal HTTP caching; the one-minute poll can reuse a fresh response and revalidate after expiry. |
| P2 | Static entry pages started the global price catalog unnecessarily. | `/docs`, `/privacy`, `/terms`, `/risks`, and 404 do not consume market prices, but the price store started globally. | Fixed for fresh static-page loads: start the price store when a dynamic product route mounts. |
| P2 | Explore makes duplicate directory reads and applies MC in a second render. | Foundation already contains a first market page; Explore fetches Bloomed and Growing pages separately, then fetches `/v1/market-statistics`. MC arrives after the initial cards. | Include stage counts and card display metrics in a revision-bound Explore response, or reuse the foundation rows while the complete directory fits in one page. |
| P2 | Full Phosphor font packaging is oversized. | Build output contains a 147 KB WOFF2 actually used by browsers plus unused TTF/WOFF/SVG variants, including a 3.0 MB SVG font; the icon CSS describes the full set. | Replace the font package with an audited icon subset or WOFF2-only asset. Do not hand-draw replacements; preserve the existing icon shapes and accessible names. |
| P2 | The Home tree performs expensive runtime image processing. | The 1254×1254 source is decoded, read through Canvas, traversed and split into multiple layers and fruit masks on the main thread. | Precompute the masks/layers as build assets. Until then, initialize interaction after first paint or idle time and keep the static image as the immediate visual. |
| P2 | Several dynamic images rely on CSS containers rather than intrinsic dimensions. | Market, token, staking and wallet images can appear after data arrives; missing dimensions can add small layout shifts. | Add width/height or aspect-ratio contracts to the shared image renderers, then verify desktop/mobile layouts visually. |
| P3 | Unused Three.js code remains in the frontend package. | `garden-3d.ts` is reachable only through an otherwise unused `garden-entry.ts`; it is absent from the current production chunks but remains an install and maintenance dependency. | Remove it after confirming no planned route uses it. |
| P3 | Response timing lacks server-side phase visibility. | Live responses expose cache state but no database/query timing, so cold-start, connection and SQL time cannot be separated from the client. | Add `Server-Timing` for function boot, pool acquisition and bounded query groups without exposing SQL or credentials. |

## Data completeness

At the audited revision, all 12 markets had identity, market cap and a last-buy record through `/v1/market-statistics`. All 12 had holder and fee allocation data. The directory endpoint deliberately does not embed `metrics` or `lastBuy`; Explore joins them from the statistics endpoint.

The 24-hour USD fields remain unavailable because the test deployment does not yet have complete historical USD coverage. Protocol `marketCapUsd` also remains unavailable because aggregate valuation is fail-closed when coverage is incomplete. These values must remain `Unavailable`; presenting partial totals as complete or replacing them with `$0` would be misleading.

Before the Read API fix, 1H and 12H detail chart/trade data were also unavailable because of the incorrect block-row continuity check. The deployment acceptance step must confirm those shorter periods now return chart/trade objects while 1D remains unavailable until its full interval is covered.

## Recommended implementation order

1. Deploy and verify the analytics coverage fix and the completed low-risk frontend changes.
2. Split `app.ts` by route, beginning with Create and transaction write flows, and set a compressed initial-JS budget.
3. Add one revision-bound foundation endpoint and reuse its first market rows in Explore.
4. Replace the full Phosphor package with an exact subset and precompute Home tree layers.
5. Add response timing and collect browser RUM for LCP, INP, CLS, API TTFB and route request counts before changing keep-warm capacity.
