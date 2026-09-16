import type { PageName } from "./routes.ts";

export type PageTemplate = Readonly<{ title: string; html: string }>;

const loaders: Record<Exclude<PageName, "not-found">, () => Promise<{ default: PageTemplate }>> = {
  home: async () => { await import("../home/signal-arbor.css"); return import("../pages/home.ts"); },
  markets: async () => { await import("../pages/markets.css"); return import("../pages/markets.ts"); },
  trade: () => import("../pages/trade.ts"),
  create: async () => { await import("../create/create.css"); return import("../pages/create.ts"); },
  stats: async () => { await import("../pages/stats.css"); return import("../pages/stats.ts"); },
  statsStocks: async () => { await import("../pages/stats.css"); return import("../pages/statsStocks.ts"); },
  staking: async () => { await import("../pages/staking.css"); return import("../pages/staking.ts"); },
  rewards: async () => { await import("../pages/rewards.css"); return import("../pages/rewards.ts"); },
  docs: () => import("../pages/docs.ts"),
  privacy: async () => { await import("../../legal.css"); return import("../pages/privacy.ts"); },
  terms: async () => { await import("../../legal.css"); return import("../pages/terms.ts"); },
};

const notFound: PageTemplate = {
  title: "Page not found — TickerGarden",
  html: `<main class="page not-found-page">
    <section class="not-found-content" aria-labelledby="not-found-title">
      <p class="not-found-code" aria-hidden="true">404</p>
      <p class="not-found-eyebrow">A little off the garden path</p>
      <h1 id="not-found-title">Page not found</h1>
      <p class="not-found-description">This page may have moved, or the link may be incorrect.<br>There’s still plenty to explore in the garden.</p>
      <nav class="not-found-actions" aria-label="Find your way back">
        <a class="not-found-primary" href="/explore">Explore the garden<i class="ph ph-arrow-right" aria-hidden="true"></i></a>
        <a class="not-found-secondary" href="/">Back to home</a>
      </nav>
      <p class="not-found-help">Need a hand? <a href="/docs#docs-help" data-router-ignore>Contact us</a></p>
    </section>
  </main>`,
};

export async function loadPageTemplate(page: PageName): Promise<PageTemplate> {
  return page === "not-found" ? notFound : (await loaders[page]()).default;
}
