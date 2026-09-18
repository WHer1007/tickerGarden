# Test and production release — 2026-09-19

Status: deployed. Test and production applications and resident/display workers were updated. No database migration or project contract deployment was required; no mainnet transaction was signed during acceptance.

## Scope and source

- Configured V3/V4 ETH conversion followed by the existing project buy; payment choices are paired asset plus ETH, deduplicated.
- Small-price zero-count subscript display, exact-value accessibility/copy handling, and balance refresh fixes.
- Structured/redacted diagnostics and optional Sentry/Lark integration. Sentry and Lark remain unconfigured and disabled.
- Test Web: `8cc405c72a79fb466ffd47821f02988f1e9d375a`; test backend and both environments' Worker source: `35e49f9832ea3d7d4b47b8e9a63d97156d35afc5`.
- Production application source: `ea6c8af6e95700f82da1945d4c0bd3c808619cc5`, merged from accepted test. Product trees matched before upload. Test and master were pushed to origin.

## Verification

- Local frontend: 645 tests; backend: 210 unit tests plus packaging, generated artifacts and type checks; deployment/environment checks: 25 tests. Frontend/backend builds passed.
- Seven mainnet-fork route/recovery scenarios passed at pinned block 66401542, entirely on localhost.
- Test detected a Web function import failure (`ERR_MODULE_NOT_FOUND`). TypeScript relative-import rewriting fixed the emitted runtime paths; 11 focused tests and typecheck passed, then the actual deployed RPC call passed.
- Both environments: 11 HTML routes, 18 referenced assets, RPC chain ID, markets and current Stats display API passed. Explore, market page/detail and Stats section reads passed. Explore/Stats streams emitted readiness and at least two heartbeat events.
- All four deployments in each environment passed the Singapore runtime gate before alias or promotion (Web 2, Read API 3, Pipeline 2, Content 2 functions).
- Both production Workers were running with zero automatic restarts; no module/syntax/uncaught startup errors. One listener-not-ready warning occurred during display-worker startup.
- Production ETH→AAPL quote returned HTTP 200 with `configured-pool`, block 66420942, 0.001 ETH input, 7753211673303154 raw AAPL quoted and 7675679556570122 raw AAPL minimum (1% tolerance). Public project RPC accepted the router code read; runtime code hash matched the pinned router hash.
- Test is noindex; production is indexable. Final production page/resource checks passed after domain propagation; the first sweep briefly encountered an old asset reference while aliases switched.

## Limits and follow-ups

- These are HTTP/API, source/build and local-fork checks, not a production wallet-signed purchase or a new interactive browser session.
- The unused legacy `/v1/protocol-statistics` endpoint returned snapshot-pending 503 in test. Current frontend Stats uses `/v1/stats/display`, which passed; legacy snapshot availability is not claimed by this release.
- SEED market data and trading HTML are available. Its server-delivered HTML still has the generic Trade title; per-market server metadata delivery remains a separate follow-up.
- External alert delivery is not activated until its configuration is provided.

## Deployment URLs

| Service | Test | Production |
|---|---|---|
| web | https://tickergarden-3uaejgehg-garden24.vercel.app | https://tickergarden-lzfzwn6gl-garden24.vercel.app |
| read-api | https://tickergarden-read-lmrrzulof-garden24.vercel.app | https://tickergarden-read-5e141jev5-garden24.vercel.app |
| pipeline | https://tickergarden-chain-pipeline-le9z3th2m-garden24.vercel.app | https://tickergarden-chain-pipeline-ovkyrm34m-garden24.vercel.app |
| content | https://tickergarden-content-f6ckuz4wt-garden24.vercel.app | https://tickergarden-content-34gs0if29-garden24.vercel.app |

Public entries: https://tickergarden-web-test.vercel.app and https://tickergarden.com. Production custom domains were verified against the deployment IDs after promotion.
