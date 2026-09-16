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
  risks: async () => { await import("../../legal.css"); return import("../pages/risks.ts"); },
};

const notFound: PageTemplate = { title: "Page not found — TickerGarden", html: `<main class="page"><section class="page-hero"><div><div class="kicker">404</div><h1>Page not found</h1><p>This page does not exist. Explore the garden or return home.</p><a class="action-button" href="/">Back to home</a></div></section></main>` };

export async function loadPageTemplate(page: PageName): Promise<PageTemplate> {
  return page === "not-found" ? notFound : (await loaders[page]()).default;
}
