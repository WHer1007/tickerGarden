export const PAGE_PATHS = {
  home: "/", markets: "/explore", trade: "/trade", create: "/create",
  stats: "/stats", statsStocks: "/stats/stocks", rewards: "/claim", staking: "/stake", docs: "/docs",
  privacy: "/privacy", terms: "/terms",
} as const;

export type PageName = keyof typeof PAGE_PATHS | "not-found";
export type Route = Readonly<{ page: PageName; pathname: string; search: string; hash: string; href: string; key: string }>;

/** Old bookmarks retain their query and fragment while resolving to a clean path. */
export function resolveRoute(url: URL): Route {
  let pathname = url.pathname.replace(/\/+$/, "") || "/";
  if (pathname === "/rewards" || pathname === "/rewards.html") pathname = PAGE_PATHS.rewards;
  else if (["/market", "/market.html", "/markets", "/markets.html"].includes(pathname)) pathname = PAGE_PATHS.markets;
  else if (pathname === "/index.html") pathname = "/";
  else if (pathname.endsWith(".html") && Object.values(PAGE_PATHS).includes(pathname.slice(0, -5) as typeof PAGE_PATHS[keyof typeof PAGE_PATHS])) {
    pathname = pathname.slice(0, -5);
  }
  // The staking surface moved out of the rewards page. Keep old tab links
  // addressable, including their query string and selected tab fragment.
  const migratedClaimHash = pathname === PAGE_PATHS.rewards && ["#positions", "#staker", "#activity"].includes(url.hash);
  if (migratedClaimHash) pathname = PAGE_PATHS.staking;
  const page = (Object.entries(PAGE_PATHS).find(([, path]) => path === pathname)?.[0] ?? "not-found") as PageName;
  const key = pathname + url.search;
  return { page, pathname, search: url.search, hash: url.hash, key, href: key + url.hash };
}

export function isRouteLink(url: URL, origin: string): boolean {
  if (url.origin !== origin || !["http:", "https:"].includes(url.protocol)) return false;
  return resolveRoute(url).page !== "not-found" || !url.pathname.split("/").at(-1)?.includes(".");
}
