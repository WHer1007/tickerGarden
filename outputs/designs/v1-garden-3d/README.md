# V1 interactive Signal Garden

The homepage tree is now a procedural Three.js sculpture. Deep green leaves, curved tapering branches, lime/coral/ivory fruit and a ceramic island retain the existing V1 palette. No external 3D model or texture service is required.

Interactions: drag horizontally to rotate (mouse also allows a slight tilt), click a ticker to reveal editorial copy, cycle tickers, reset view, pause motion, and keyboard Left/Right/Home on the viewport. Labels follow the actual 3D fruit and nearer labels take precedence when fruit overlap. The ten tickers are illustrative brand content, not an asset allowlist, price feed, or verified market directory.

Implementation:
- `apps/web/src/home/garden-data.ts`: static identities and editorial copy.
- `apps/web/src/home/garden-3d.ts`: geometry, lighting, interaction, labels and resource disposal.
- `apps/web/src/home/garden-entry.ts`: homepage-only lazy enhancement.
- `apps/web/index.html`, `apps/web/styles.css`: controls and responsive styling.
- Three.js 0.185.1 / @types/three 0.185.4 pinned in the existing web package and lockfile.

Performance: separate lazy chunk (~137 KB gzip), pixel ratio capped at 1.75, ~30 fps limit, no rendering while offscreen or in a hidden document. Reduced-motion preference disables ambient motion by default. Original static illustration and all ten original labels remain available when WebGL fails to start or its context is lost.

Verified:
- Existing Web tests: 36 passed; TypeScript and Vite production build passed.
- Browser: canvas mounts without Read API, ten fruit controls, fruit selection, next ticker, drag, reset, keyboard rotation, reduced motion, mobile selection, no horizontal page overflow, WebGL context-loss fallback; no page errors.
- Mobile touch: real touch events rotate horizontally while vertical gestures scroll the page.
- Initial WebGL unavailable: original tree remains visible and 3D-only controls stay hidden.
- Desktop 1440×1050 and mobile 390×844 screenshots inspected; rotated label overlap corrected.

`desktop.png`, `desktop-rotated.png`, `mobile.png`, `fallback.png` record the verified states. Browser check scripts are included; run them from the repository root with Playwright available (`PLAYWRIGHT_MODULE` can point to an existing installation) and the V1 dev server on port 5193. `CHROME_PATH` optionally overrides the local macOS Chrome executable. Browser fixtures do not connect wallets or broadcast transactions.

Only the V1 homepage presentation is changed by this work; protocol and real market data paths remain independent.
