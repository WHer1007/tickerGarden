# Token detail — option 2 implementation QA (2026-09-08)

Source visual truth: `/Users/dear/.codex/generated_images/01a08060-7dd4-7e53-aedd-ab8c80f90dcc/exec-0d276e25-b48b-48bb-9a15-5b73ae721d59.png`.

Implementation: `http://127.0.0.1:5176/trade`.
Evidence: `outputs/designs/token-detail-pons-2026-09-08/implementation-desktop.png` and `implementation-mobile.png`.

## State and comparison

Source is an illustrative populated market, 1487 × 1058 pixels. Browser desktop capture uses 1487 × 1058 CSS pixels; saved viewport image is 1487 × 1058 pixels (1:1). Mobile is 390 × 844 CSS/image pixels. Source and desktop screenshot were emitted together in the same comparison call. A full-page browser capture produced stitching artifacts and was discarded in favor of viewport captures. No image resizing or artificial financial data was used.

The actual route has no verified market loaded. This intentionally differs from the source's GCAT token, example balances, line chart and trades. The application preserves existing validated candle/trade/holder widgets rather than replacing them with the illustrative plot. Loaded-market visual and wallet transaction execution were not validated in this environment.

## Findings and comparison history

- Initial P1: fee summary was below the overview instead of replacing the duplicate header assets. Moved the summary into the header's right column. Lower card now distinguishes detailed rules from total distribution.
- Initial P2: large technical empty heading, sans-serif section titles and excess header height weakened the selected composition. Replaced the empty heading with Market details, restored serif display hierarchy, reduced header spacing and moved technical status into an expandable loader.
- Initial P2: fixed chart height and overflow could clip real widget controls. Changed to an auto-height container with a minimum empty height; tables retain their own scrolling.
- Initial P2: mobile metadata inherited an ordering rule and appeared beneath the fee summary. Reset header child ordering and verified the revised mobile screenshot.
- Final comparison: no actionable P0/P1/P2 finding in the empty-state desktop/mobile implementation. Source-to-implementation full-view comparison is readable at native dimensions; header fee summary, section titles and trade controls were also inspected in the native viewport capture without downscaling.

## Required fidelity surfaces

- Typography: serif token/section headings and existing brand/body fonts; source's hierarchy retained. Existing global navigation is preserved.
- Spacing/layout: about / market overview / trade columns; fee summary above trade; stacked mobile with trading first. Both desktop and mobile have document scroll width equal to viewport width.
- Colors: cream backgrounds, forest text/buttons, pale green accents and restrained borders.
- Images: existing real brand artwork used as an empty market fallback. Illustrative GCAT/NVDA/ETH assets are not misrepresented as loaded token metadata.
- Copy: no sample prices, 0.3% fee, fixed supply, active staking assertion or community-owned claim. Fee percentages are conditional on verified configuration and phase; creator tax is separate. Holder statistics explicitly count addresses. Missing values stay Unavailable.

## Interaction and verification

- Trades/Holders selection updates aria-selected and the visible panel.
- Buy/Sell remain disabled without a verified market/wallet; no transaction was sent.
- Browser error log: none in inspected run.
- `npm test --prefix apps/web`: 150 tests passed, including generated artifact checks and TypeScript.
- `npm run build --prefix apps/web`: passed; existing large bundle warning remains.
- Existing quote expiration, canonical bindings, allowance checks and transaction construction are retained.

## Implementation checklist

- [x] Apply option 2 and the user's header correction.
- [x] Wire metadata, validated holders/supply, USD metrics and Registry fee configuration.
- [x] Preserve truthful unavailable states and trading locks.
- [x] Desktop/mobile visual and interaction checks.
- [ ] Follow-up integration coverage with a live verified market and connected test wallet.
- [ ] Add a backend cumulative fee distribution endpoint before displaying paid totals.

final result: passed

## User-requested populated sample preview — 2026-09-08

URL: `/trade?preview=sample`. Source is the same option 2 image. Added an explicit bilingual sample banner and populated token details, price plot, statistics, fee allocation rows/totals, executions, holders and simulated trade inputs. This is a separate visual fixture with all live data hooks renamed; it exits route mounting before live widgets and trade handlers initialize.

Evidence: `outputs/designs/token-detail-pons-2026-09-08/sample-desktop.png` (1487 × 1400 viewport), `sample-mobile.png` (390 × 844 viewport). Desktop screenshot and original source were inspected together. The taller desktop viewport accommodates the preview banner and existing site shell; no pixel rescaling used. Retained current typography, cream/forest palette, three-column spacing, real brand fallback image and requested header fee summary. Placeholder token artwork remains a known intentional difference from the illustrative cat avatar. Data tables and fee rows were readable in the native screenshot. No new actionable P0/P1/P2 issues found in this sample-data update.

Verified Buy/Sell switching, holder tab content, disabled transaction submission, zero live trade/widget hooks in the sample DOM, no horizontal overflow on desktop/mobile, and no browser console errors. Production build, generated checks and TypeScript passed. Preview calculations are illustrative floating-point display math only; they never enter actual trade execution.

final result: passed

## Reference reconstruction after user fidelity review — current acceptance

This section supersedes the earlier sample preview's visual acceptance. The user correctly identified missing reference elements and excessive layout drift in that version.

Source: `/Users/dear/.codex/generated_images/01a08060-7dd4-7e53-aedd-ab8c80f90dcc/exec-0d276e25-b48b-48bb-9a15-5b73ae721d59.png` (1487 × 1058).
Current implementation: `/trade?preview=sample`.
Current evidence: `outputs/designs/token-detail-pons-2026-09-08/reference-desktop.png` (1487 × 1058 viewport/image) and `reference-mobile.png` (390 × 844). Native scale, no screenshot resampling. Source and final implementation were emitted in the same comparison input; full-sized desktop input allowed inspection of header, table, asset controls and fee rows.

### Fix history

1. P1: previous sample omitted custom avatar/icon assets, explorer rows, asset descriptions, community/risk cards, toolbar, balance lines and information controls. Rebuilt sample markup; reused exact raster crops for cat, creator, ETH, NVDA and plant assets. All six asset files render successfully.
2. P1: sample's separate chart/fee/activity cards and oversized chart pushed content below the reference viewport. Rebuilt the center as one card, matching three columns (312 / flexible center / 362 px), 8 px gaps and y=267 start at reference width. Restored compact fee rows and five execution rows.
3. P2: initial reconstruction used wider Georgia display metrics and excess chart whitespace. Calibrated Times-style headings and numbers, hero title line height, chart padding/height, table density and panel padding. Sample chart line is sampled from the reference's illustrative trace; it is not represented as live data.
4. P2: mobile time labels overlapped. Show alternate labels at narrow widths; revised mobile screenshot confirms readable labels and scrollWidth=390 at viewport width 390.
5. Final desktop capture confirms all three panels and lower risk/community cards fit the source-size viewport. Header's duplicate ETH/NVDA cards intentionally remain replaced by fee distribution, per the user's earlier approved correction.

### Fidelity surfaces and boundaries

- Typography: measured Times-style serif titles, Arial interface/body copy, corrected weights, line heights and tab/table density. Minor font rasterization differences from the generated source remain.
- Layout/spacing: 65 px shell header, 202 px hero, source-width three-column composition, merged central card and compact trade form. Responsive layout retains all content; tables scroll internally on mobile.
- Color/tokens: warm off-white, forest titles/buttons, pale lime badges, subtle gray borders, green/red trade types.
- Asset quality: source-derived avatar/asset/plant raster crops; remaining standard control icons use the installed Phosphor library. Source artwork is not replaced by CSS approximations.
- Copy/content: reference text and illustrative data restored, including unavailable market cap/fee totals, sample balance dashes and 0.3% illustrative fee. These are preview-only, not protocol economics or ownership claims applied to a real market.

### Verification

Chart period state, holders tab, amount preview and preview wallet dialog exercised. Both header and trade wallet controls are isolated from wallet connection in this route. Production trade hooks are absent from the sample surface. No transaction sent. All source assets load; no browser console errors; no horizontal document overflow at desktop/mobile widths. Production build and generated/TypeScript checks pass. Final frontend suite: 150/151 pass. The remaining existing navigation test expects the literal footer label Robinhood, while the current shared footer renders Robinhood Chain. The footer is hidden in this reference preview and was not changed by this reconstruction. An earlier run passed 151/151 before that shared-file state changed.

No actionable P0/P1/P2 differences remain in this reconstruction. P3 residual: standard library icon geometry and browser font rasterization differ slightly from the generated image. This is a functional HTML/CSS/canvas implementation, not a flattened screenshot.

final result: passed

## Header fee overview redesign — latest local refinement

User rejected the boxed top-right fee card. Replaced it with an unboxed editorial overview: muted overline, three large numeric shares, restrained beneficiary labels, a 40/30/30 proportional strip, and a Details action that scrolls to and focuses the existing fee details. The existing lower fee table remains the detailed view.

Before source: `outputs/designs/token-detail-pons-2026-09-08/reference-desktop.png`. After: `fee-overview-desktop.png` (1487 × 1058), `fee-overview-detail.png` (390 × 90 focused crop), `fee-overview-mobile.png` (390 × 844). Before and after full-view images were inspected in the same tool input; focused crop verifies the redesigned region. Intentional deviation is limited to the requested top-right component. Type hierarchy, colors and whitespace remain consistent with the selected page. No new image assets were needed; proportional strip represents the sample allocation data.

Verified Details focuses the Fee distribution details section, mobile scroll width equals viewport width, and production build including TypeScript/generated checks passes. No actionable P0/P1/P2 finding in this local refinement.

final result: passed

## Shared header integration

Removed every reference-only override of `.shell-header`, `.header-actions`, `.wallet`, logo sizing, navigation and responsive header rules. Header markup continues to come from the project's `setupShell()`; inherited header font now follows the shared styles. The sample label moved below the header into the detail content. Approved content and fee overview remain intact.

Evidence: `outputs/designs/token-detail-pons-2026-09-08/shared-header-desktop.png` at 1487 × 1058. Mobile verified at 390 × 844: shared navigation opens/closes, document width stays 390, header controls remain visible. Production build passed. Existing preview-only wallet guard remains in place.

final result: passed
