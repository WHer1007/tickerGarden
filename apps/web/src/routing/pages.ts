import home from "../pages/home.ts";
import markets from "../pages/markets.ts";
import trade from "../pages/trade.ts";
import create from "../pages/create.ts";
import stats from "../pages/stats.ts";
import rewards from "../pages/rewards.ts";
import docs from "../pages/docs.ts";
import privacy from "../pages/privacy.ts";
import terms from "../pages/terms.ts";
import risks from "../pages/risks.ts";
import type { PageName } from "./routes.ts";

export const pages: Record<PageName, Readonly<{ title: string; html: string }>> = {
  home, markets, trade, create, stats, rewards, docs, privacy, terms, risks,
  "not-found": { title: "Page not found — TickerGarden", html: `<main class="page"><section class="page-hero"><div><div class="kicker">404</div><h1>Page not found</h1><p>This page does not exist. Explore the garden or return home.</p><a class="action-button" href="/">Back to home</a></div></section></main>` },
};
