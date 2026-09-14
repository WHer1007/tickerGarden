# Token detail loading audit — 2026-09-12

Scope: test Web `/trade`, market `0xe596600919dc0beb84a6e5a3660d6dba13c0424f20550f453d4cf7cd8dfdebf1`.

## Request measurements

Two sequential rounds from the Singapore VPS to the public Read API alias; requests within each round were concurrent after health, except candles measured after the summary to obtain its finalized timestamp. Times include HTTPS and response body transfer. These are endpoint measurements, not browser rendering/LCP measurements; first-round slowness alone does not prove a cold start or database query bottleneck.

| Endpoint | First round (ms) | Second round (ms) |
| --- | ---: | ---: |
| Health | 2565 | 30 |
| Config asset | 2627 | 72 |
| Config quote | 2783 | 86 |
| Config baseline | 4643 | 83 |
| Config template | 998 | 87 |
| Market directory (100) | 5020 | 62 |
| Target market | 2690 | 61 |
| Detail summary (1H) | 6191 | 57 |
| Candles (1m) | 2930 | 26 |
| USD price references | 2229 | 73 |

The large first/second-round difference indicates that endpoint/cache/instance state deserves further backend profiling. Current middleware caches successful detail/candle responses for 15 seconds at the CDN with stale-while-revalidate; finalized revision reads use immutable cache keys. No cache TTL or finality guard was weakened.

Static Web checks: HTML 61 ms; main JavaScript 81 ms / 185,621 gzip bytes; chain dependency 426 ms / 89,899 gzip bytes; trade chunk 17 ms / 2,784 gzip bytes; trade CSS 20 ms / 8,577 gzip bytes. All returned HTTP 200. Main/HTML/trade assets were cache hits; chain and global CSS were misses. Transfer was substantially faster than the first-round Read API responses in this sample. CPU parsing and browser layout were not measured.

## Findings and applied changes

1. The old cold route waited for health, four configuration catalogs and a 100-market directory, then sometimes fetched its selected market separately. Trade now fetches its single market alongside asset/quote/baseline configs; it skips creation templates. Other pages reload a complete foundation when needed, including navigation while bootstrap is in flight.
2. A new foundation was followed by another health request. The initial route now uses the snapshot it just loaded.
3. Summary analytics used to start only after foundation completion. It now prefetches on route mount, is consumed once, and is validated against the finalized identity before rendering.
4. Initial chart loading used to wait for the combined detail endpoint. Candles now begin independently as soon as the database market timestamp is available. Summary timeout/failure does not clear a valid chart or database overview. 1H/12H/1D remains chart-only.
5. Ordinary database snapshot refreshes unnecessarily requested wallet balances. Balance RPC is now limited to wallet/market activation and explicit trade refresh. RPC verification still gates executable quotes and signing, and never gates public display. Verification completion no longer calls the public fee renderer.
6. Metadata/content loads already had a separate 10-second request and did not block the page. USD references also load independently; missing USD valuation does not hide Quote price or chart. The combined database summary still owns volume/holders/fee totals/recent trades; those fields share one response. This change does not claim to split that backend query into separate services.
7. Market changes now cancel the prior summary request and reject late responses, in addition to the existing chart cancellation.

## Verification and limits

Web suite: 337 tests passing, including deferred summary, initial-chart independence, prefetch deduplication, summary failure isolation, cleared-market late response rejection, chart range changes, and static RPC boundaries. TypeScript and generated artifact checks pass. Test deployment build and asset verification are recorded in the deployment runbook.

No wallet transaction was submitted. No browser LCP or live wallet RPC latency was measured. Slow service responses can still delay their own modules; the frontend changes remove avoidable request waterfalls and unrelated RPC work, not the underlying server response time. The follow-up below identifies the dominant cause using runtime logs and a same-source region-only deployment comparison.


## Root-cause follow-up: runtime region drift

Confirmed 2026-09-12 after the user requested attribution of the 6.19-second response:

- `vercel inspect` of the active Read API showed both functions in **iad1**, while PostgreSQL runs in Singapore. App `vercel.json` contained sin1 and project inspection showed sandbox sin1; neither had constrained this deployment's actual runtime. The deploy command omitted explicit `--regions sin1`.
- Before correction, successful CDN MISS samples were 4,751 ms (1H), 4,748 ms (12H), and 4,695 ms (1D). Response `x-vercel-id` showed `sin1::iad1`. Vercel request logs showed corresponding handler durations of 4,453.94 / 4,431.98 / 4,431.77 ms. Other logged requests repeatedly took 5.8–6.5 seconds, including stale-cache background refreshes. Thus the problem was repeated origin latency, not merely a single initial cold start. The 57 ms second request was explicitly CDN HIT.
- The success path executes 17 application SQL statements plus BEGIN/COMMIT. `coverageFor` is invoked twice and accounts for ten statements. Although some calls use Promise.all, they share one pg PoolClient and therefore queue on the same database connection; they are not concurrent SQL execution. With a distant database, these round trips accumulate. The sampled market has only eight trades, four holders and eight fee rows.
- Redeployed identical staged backend source, changing only region with `--regions sin1`. Before alias switch, both actual runtime functions were verified in sin1. New-preview MISS samples were 552 / 332 / 83 ms for 1H / 12H / 1D; this included the first observed invocation of the new deployment.
- After switching the test alias, MISS samples were **140 / 76 / 79 ms**. Headers showed `sin1::sin1`. The cached 1H repeat was 24 ms and is excluded from the origin comparison. Response sizes (8,373 / 11,567 / 9,742 bytes), chart point counts (60 / 144 / 96), and trade/holder/fee counts matched the old responses. No backend business code or SQL changed between deployments. This controlled comparison establishes cross-region database round trips as the dominant bottleneck.

All comparisons use observed CDN cache headers. A no-cache request header did not reliably bypass Vercel caching; unknown query parameters were rejected with HTTP 400 and were excluded. No cache keys, validation, finality protections, or TTLs were relaxed to produce these results.

The exact 6.19-second historical request was not individually traced through every SQL statement; additional connection/cold-start/load variation may explain the difference from the 4.7-second reproductions. No individual SQL execution plan was measured, and none is claimed to be the source of multi-second latency. SQL consolidation remains optional future work; it is unnecessary to explain the measured improvement and must preserve independently available short-window charts when full-day coverage is missing.

Prevention: `AGENTS.md` now mandates explicit Singapore placement for every Vercel deployment. `scripts/check-vercel-region.mjs` rejects non-Ready deployments, missing runtime evidence, mixed regions and any region other than sin1. Its focused regression test and a real deployment check passed.

Post-deployment runtime logs independently confirmed five successful MISS handler durations of 50.65, 50.89, 64.61, 56.65 and 53.30 ms. This excludes browser/CDN transport and corroborates the same-region improvement. Backend TypeScript checking passed.
