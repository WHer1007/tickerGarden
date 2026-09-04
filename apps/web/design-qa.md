# TickerGarden Homepage Restoration QA

## Comparison target

- Original visual direction: `/Users/dear/.codex/generated_images/01a05c0a-7536-7772-8034-b71c14f478a4/exec-447605d4-58ba-4b06-a9fc-637e81a151dc.png`
- Most recent approved lifecycle reference: `qa-captures/homepage-product-copy-footer-1487x1050.png`
- Implementation URL: `http://127.0.0.1:5174/`
- Restored hero capture: `qa-captures/homepage-restored-hero.png`
- Restored lifecycle capture: `qa-captures/homepage-restored-how.png`
- Focused normalized comparison: `qa-captures/homepage-restored-how-comparison.png`
- Reference pixels: 1487 × 1050. Restored lifecycle capture: 1280 × 720. Focused reference and implementation regions were normalized to 1280 × 220 without changing their content order.
- State: signed-out homepage, navigation closed, current local Vite preview.

## Full-view and focused evidence

- The restored browser-rendered page visibly contains the stock tree and all ten ticker fruits: NVDA, AAPL, MSFT, AMZN, GOOGL, META, TSLA, AVGO, JPM, and COST.
- The focused comparison places the previous approved lifecycle copy and the restored implementation together. The section title, introduction, three step titles, body copy, images, order, palette, and layout match; only natural line wrapping differs with viewport width.
- The browser loaded `app.js`, which imports the shared shell and injects the fruit links. The prior broken page loaded only `subpages.js`, leaving `#fruits` empty.

## Required fidelity surfaces

- Fonts and typography: the existing Fraunces and DM Sans hierarchy is unchanged; the restored copy uses the previous heading and body weights.
- Spacing and layout: the existing four-column lifecycle row and responsive stacking rules are unchanged.
- Colors and tokens: cream, forest, lime, coral, line, paper, and muted tokens remain unchanged.
- Image quality: the original local tree and all three process illustrations remain in use with no replacements or regenerated approximations.
- Copy and content: restored to “Launch a Ticker Meme”, “Graduate the Market”, and “Allocate STOCK, Earn Fees”, including the earlier fixed-supply, locked-liquidity, and actual-fee descriptions.
- Interaction and accessibility: ten fruit links are present in the rendered DOM; the existing hover/focus `fruit-sway` rule and reduced-motion fallback remain in `styles.css`. Browser console warnings and errors were empty.

## Comparison history

### Pass 1 — blocked

- [P1] The homepage entry loaded `subpages.js` directly, so the fruit-generation code in `app.js` never executed and the tree had no fruits.
- [P2] The approved lifecycle copy had been replaced by implementation-status language unrelated to the intended homepage story.

Fixes: restored the homepage module entry to `app.js` and restored the latest protocol-aligned lifecycle copy recovered from the local screenshot and session history.

### Pass 2 — passed

- Browser DOM reports 10 ticker fruits and the three restored lifecycle headings.
- Browser console reports no warnings or errors.
- `npx vite build` succeeds and emits the homepage bundle with its `home` JavaScript entry.
- No actionable P0, P1, or P2 visual findings remain in the requested restoration scope.

## Technical note

The repository-level `npm run build` gate is currently blocked by separate in-progress V1 application changes in `src/app.ts` and a stale generated ABI bridge. Those files were not changed as part of this homepage restoration; the Vite production bundle itself passes.

final result: passed
