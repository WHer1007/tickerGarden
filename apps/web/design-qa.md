# Homepage signal arbor — design QA

final result: passed

## Scope and visual target

Only the homepage right-hand illustration is replaced. Existing homepage typography, colors, copy, header, actions, proof strip and all subpages are explicitly preserved per the user instruction.

Source: `/Users/dear/.codex/generated_images/01a06fba-6fc6-7362-ac2a-fa635e9dc15b/exec-33aa4162-74ed-4dd5-9a8d-308e48cb103e.png`.
Asset: `assets/signal-arbor.png`, 1254 × 1254, extracted by ImageGen from the approved illustration. Its nine fruit labels remain part of the artwork.

## Evidence

- Full homepage: `../../outputs/designs/signal-arbor/1440-rest.png`, Chrome viewport 1440 × 980, device scale factor 1.
- Focused comparison: `../../outputs/designs/signal-arbor/comparison.png`. The approved right-hand artwork is cropped and normalized in an HTML comparison viewer alongside the browser-rendered 570 × 570 component. Original source screenshot is not stretched to the full current page, because the user expressly excluded changes to the other page content.
- Mobile: `../../outputs/designs/signal-arbor/390-tree.png`, 350 × 350 illustration inside a 390px viewport.
- Hover/click: `1440-hover.png`, `1440-click.png` and mobile equivalents in the same evidence directory.
- No-JavaScript image fallback: `fallback.png`.
- In-app browser preview inspected: homepage exposes all nine fruit buttons with accessible stock labels.

## Required fidelity surfaces

- Typography: existing Fraunces/DM Sans page styling unchanged; ticker lettering retained within the image cutouts. Accessible button labels mirror all nine tickers. Mobile raster lettering is naturally smaller than desktop but the image remains sharp at 2x density.
- Spacing/layout: tree stays in the existing right column with a clear gap from the left content. On mobile it stacks in the existing hero flow. No horizontal overflow. Illustration has a little more internal breathing room than the mock to fit its existing responsive slot.
- Colors/tokens: SHA-256 checks confirm `styles.css`, `subpages.css`, the hero copy and every checked subpage are unchanged. New component styles are scoped to `.signal-arbor`. The image white matte is removed at runtime and blended onto the actual existing cream surface, preventing a white rectangle or a new page background.
- Image quality: full leafy line-art silhouette, single lime NVDA fruit and nine distinct ticker fruits match the approved direction. No new 3D approximation; runtime layers are literal source-image cutouts. Slight silhouette/proportion variation from ImageGen extraction remains a P3 refinement, not a change of direction.
- Copy/content: all existing page text preserved. No visible picker, instructions, tree heading, footer controls, made-up metrics or market data. Artwork stays independent of data service configuration.

## Interaction validation

Mouse hover highlights source branch pixels, lifts the fruit and briefly sways selected leaves. Highlight selection is exclusive, including neutralization of the baked-in NVDA color when another fruit is active. Click detaches the fruit image, accelerates it downward, fades it near the roots and restores it after 1.55 seconds. Repeated clicks during a fall are ignored. Neighboring leaf tips remain attached. Arrow keys/Home/End move between stock fruit buttons; Enter activates native buttons. Reduced-motion mode disables transforms/animations. No automatic animation loop. The initial PNG renders without JavaScript. Page errors: none in automated checks. Homepage no longer requests Three.js/garden-3d.

## Findings and comparison history

First focused source/implementation comparison found no actionable P0/P1/P2 differences. Existing page styling differences versus the generated full-page mock are intentional preservation, not drift. P3: minor raster extraction differences in leaf outlines and compact mobile ticker size; no additional iteration is required for the decorative component.

## Validation

37 frontend tests passed; TypeScript and production build passed. `outputs/designs/signal-arbor/check.cjs` covers desktop/mobile, hover/click, keyboard, reduced motion and no-JavaScript fallback. `preservation-check.json` records unchanged hashes for both existing stylesheets, the runtime app, left hero content and subpages. No protocol, wallet or dependency files changed in this task.

## Interaction revision

Verified the reported hover issue against the new hover capture: AAPL is filled lime and NVDA is neutral line art; exactly one fruit and branch are active. The click capture shows the fruit below its branch. Desktop/mobile browser checks, 37 frontend tests and production build passed after the revision. Existing site colors and other pages remain unchanged.

## Font wordmark revision — 2026-09-06

final result: passed

### Source and implementation evidence

- Source visual truth: `assets/tickergarden-wordmark-tight.png`, 1144 × 160 transparent PNG; previous browser baseline `../../outputs/designs/signal-arbor/1440-rest.png`, 1440 × 980 at device scale factor 1.
- Implementation: `http://127.0.0.1:4174/index.html`, captured and inspected in the Codex in-app browser at 1280 × 720 and 390 × 844. The focused header and footer states were also inspected at their rendered CSS sizes.
- State: homepage at rest with Google Fonts loaded; header sticky state at the top and footer at the bottom.

### Required fidelity surfaces

- Fonts and typography: the raster wordmark is replaced by editable `Ticker` and `Garden` spans using Nunito Sans 900 with DM Sans as fallback. At desktop the wordmark measures 176.3 × 52 CSS px beside a 52 × 52 mark; at mobile it measures 136.5 × 42 beside a 42 × 42 mark. The tighter tracking preserves the compact rounded silhouette without raster softness.
- Spacing and layout rhythm: the existing 10px desktop and 7px mobile brand gaps remain. The font version is slightly narrower than the former 190px/145px image boxes, which gives navigation more breathing room. Desktop and 390px layouts have no horizontal overflow.
- Colors and visual tokens: header `Ticker` remains dark green and `Garden` remains lime. Footer text renders solid white with `filter:none`, replacing the former raster inversion filter.
- Image quality and asset fidelity: the illustrated mark remains the supplied transparent PNG unchanged. Only the textual wordmark is converted to live type; no shape or CSS drawing substitutes for the logo mark.
- Copy and content: the visible name remains exactly `TickerGarden`; the link keeps its existing `TickerGarden home` accessible name, while the decorative split spans are hidden from duplicate announcement.

### Findings and comparison history

The first comparison found no P0/P1/P2 issue. The font version closely preserves the original rounded weight while improving high-density sharpness, responsive sizing and footer color control. The remaining difference is P3: Nunito Sans has slightly less bulbous terminals than the raster source. This is acceptable because the overall silhouette and two-color recognition remain intact.

### Validation

Nunito Sans reported loaded in the browser. Header and footer were checked at desktop and 390 × 844; no missing font, wrapping, overflow or console-visible rendering problem was observed. All 57 frontend tests and the full production build passed.
