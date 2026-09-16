export const legacyRedirects = {
  "/rewards": "/claim",
  "/rewards.html": "/claim",
  "/market": "/explore",
  "/market.html": "/explore",
  "/markets": "/explore",
  "/markets.html": "/explore",
  "/index.html": "/",
  "/explore.html": "/explore",
  "/trade.html": "/trade",
  "/create.html": "/create",
  "/stats.html": "/stats",
  "/stats/stocks.html": "/stats/stocks",
  "/claim.html": "/claim",
  "/stake.html": "/stake",
  "/docs.html": "/docs",
  "/privacy.html": "/privacy",
  "/terms.html": "/terms"
};
export function legacyRedirect(pathname) { return legacyRedirects[pathname.replace(/\/+$/, "") || "/"] ?? null; }
