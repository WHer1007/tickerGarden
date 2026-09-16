# Frontend performance optimization — 2026-09-15

Implemented in the local `test` worktree. No deployment or production promotion was performed.

## Changes and measured asset sizes

| Item | Before | After |
| --- | ---: | ---: |
| Three homepage instructional images | 1,593,504 bytes | 25,024 bytes (320px), 55,204 bytes (640px) |
| Footer Robinhood icon | 91,842 bytes | 722 bytes |
| Regular icon font | 147,380 bytes | 5,984 bytes |
| Homepage DOM canvas pixel buffers | 63,816,288 bytes | 8,116,008 bytes |

Images use responsive sources. Approved original artwork remains available for regeneration. Canvas numbers are width × height × 4, not actual browser process memory. Branch highlights use cropped canvases while retaining original pixel coordinates and interaction behavior.

The Phosphor generator includes literal classes and `icon('name')` calls. The build checks every used source icon against the subset CSS. The pre-existing nonexistent `sprout` name is mapped to the package's plant glyph. Legacy SVG/TTF/WOFF font formats are no longer emitted through the regular font import.

Docs, Privacy, Terms and Risks have prerendered main content and a light entry point. Shared navigation markup and Docs search have one source each. Direct document visits do not download the chain/business runtime or request prices. Connecting a wallet explicitly loads the application runtime. Business-to-document SPA navigation preserves the connected wallet and pauses price polling. Vite's preload helper is separated from the chain chunk so its dependency placement cannot pull chain code into static pages.

Stake, creator-beneficiary and treasury action builders load on demand. Amount preview validation remains synchronous in a small shared validator; transaction checks are preserved. Failed action chunk loads display a retry message before entering transaction state.

Snapshot polling seeds its first recent-activity digest without rebuilding an already rendered snapshot. Recovery/reset still rebuilds. Unchanged config scopes are reused on all business routes. Price subscriptions remain inactive until needed, pause on static routes, and deduplicate immediate pageshow notifications while keeping expiration handling.

The build enforces asset budgets, icon coverage and document prerender checks. A repeatable browser check covers nine routes at desktop and mobile viewport sizes, document search, wallet activation from the light entry, and absence of static-route financial requests.

## Verification

- `npm test --prefix apps/web`: 468 passed, none skipped.
- `npm run build --prefix apps/web`: generated artifacts, typecheck, build, budgets and icon coverage passed.
- `npm run test:browser:lifecycle --prefix apps/web`: router (13 assertions), application route lifecycle (69 assertions), history lifecycle passed.
- `npm run test:browser:performance --prefix apps/web -- http://127.0.0.1:4188`: 18 route/viewport checks.
- Nine fruit hover targets and GOOGL click/drop/restore checked in Chrome.
- Desktop/mobile screenshots inspected; no horizontal overflow or uncaught page exceptions in the tested routes.

Raw measurements and screenshots are in ignored `outputs/frontend-opt-*` artifacts. Local static-server responses are uncompressed; their byte totals must not be compared directly with the earlier Vercel Brotli transfer totals.

## Remaining limits

Create and Trade controller separation and per-contract ABI generation are now complete; see the follow-up below. The shared application still owns wallet state, routing and the remaining page controllers. Those can be modularized separately if maintenance needs justify it.

Live user experience telemetry was not connected to an external collector. Production latency, slow physical devices, real wallet signatures and a populated 20,000-market workload were not measured. Current browser checks use the unconfigured local build; they verify rendering, routing and loading boundaries, not production readiness.

## Maintenance

- Images: `node apps/web/scripts/resize-public-images.mjs` (ImageMagick).
- Icons: `python3 apps/web/scripts/generate-phosphor-subset.py` (FontTools with WOFF2 support).
- Browser checks: build, serve with `npm start --prefix apps/web`, then run `npm run test:browser:performance --prefix apps/web`.

## Follow-up: business entry, Create/Trade and ABI separation

- `src/controllers/create.ts` and `trade.ts` each extract 31 business functions. They load on their respective route, using a typed context with live getters/setters for the existing wallet, request generations and transaction state. Controller imports of the application are type-only. Slow controller responses cannot overwrite a later route.
- The ABI generator emits 56 independent contract/version modules (19 current, 18 burn, 19 legacy). Runtime consumers import individual contracts; compatibility aggregate exports remain for existing tooling. The build rejects runtime aggregate imports. Compiled-artifact and source-only checks cover every generated module; tests reject modified/obsolete modules and compare the entire legacy ABI against its frozen snapshot.
- Browser asset catalogs are generated from deployment manifests using only the fields the UI consumes. Full deployment evidence remains outside the browser bundle. Catalog drift is checked in local and Vercel builds. Public asset catalogs have a separate cacheable chunk.
- Explicit chunk boundaries keep shared dependencies out of controller chunks. All chain-library dependencies share a chunk to avoid cross-chunk initialization cycles. The build checks startup dependencies and enforces a 500 KB business-entry ceiling.

Measured local production builds, minified JS (decimal KB):

| File | Before this follow-up | After |
| --- | ---: | ---: |
| Business entry | 1,253.71 KB (gzip 220.28 KB) | 407.05 KB (gzip 133.23 KB) |
| Create controller | Inside entry | 44.09 KB (gzip 13.83 KB) |
| Trade controller | Inside entry | 44.04 KB (gzip 12.91 KB) |
| Public asset catalogs | Full manifests inside entry | 165.86 KB (gzip 24.92 KB) |

The entry reduction is about 68%; it is not a claim that total network transfer drops by 68%. Shared catalogs and the ABI modules needed by the selected page still load. Create/Trade controllers are absent from other routes' request lists in fresh browser contexts. The application source shrank from 6,503 to 5,022 lines, including the typed shared-state adapter.

Additional verification: 468 unit/source tests; existing wallet/router/history lifecycle suite; 18 production-build route/viewport cases with controller request isolation; deliberately delayed Create and Trade downloads followed by navigation to Stats and back; source-only ABI verification; production build and dependency/size gates. All passed. No real wallet signing, transaction broadcast or deployment was performed.

Repeat slow-navigation checks with `npm run test:browser:controllers --prefix apps/web -- http://127.0.0.1:4188`. Generate asset catalogs with `npm run generate:catalogs --prefix apps/web`; do not edit generated files manually.
