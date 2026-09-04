export type SiteRoute =
  | { name: "home" }
  | { name: "create" }
  | { name: "markets" }
  | { name: "market"; marketId: string }
  | { name: "portfolio" }
  | { name: "stats" }
  | { name: "faq" }
  | { name: "not-found"; pathname: string };

export const SITE_NAVIGATION = [
  { name: "home", label: "Overview", href: "/" },
  { name: "create", label: "Create", href: "/create" },
  { name: "markets", label: "Markets", href: "/markets" },
  { name: "portfolio", label: "Portfolio", href: "/portfolio" },
  { name: "stats", label: "Stats", href: "/stats" },
  { name: "faq", label: "FAQ", href: "/faq" },
] as const;

export function parseSiteRoute(pathname: string): SiteRoute {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (normalized === "/") return { name: "home" };
  if (normalized === "/create") return { name: "create" };
  if (normalized === "/markets") return { name: "markets" };
  if (normalized === "/portfolio") return { name: "portfolio" };
  if (normalized === "/stats") return { name: "stats" };
  if (normalized === "/faq") return { name: "faq" };

  const marketMatch = normalized.match(/^\/markets\/([^/]+)$/);
  if (marketMatch?.[1]) {
    try {
      return { name: "market", marketId: decodeURIComponent(marketMatch[1]) };
    } catch {
      return { name: "not-found", pathname };
    }
  }

  return { name: "not-found", pathname };
}

export function routeIsActive(route: SiteRoute, name: (typeof SITE_NAVIGATION)[number]["name"]): boolean {
  if (name === "markets" && route.name === "market") return true;
  return route.name === name;
}

export function marketHref(marketId: string): string {
  return `/markets/${encodeURIComponent(marketId)}`;
}

export type MarketLike = {
  readonly marketId: string;
  readonly assetUid: string;
  readonly memeToken: string;
  readonly quoteAsset: string;
  readonly launchPhase: number;
  readonly curveProgress: {
    readonly realQuoteReserve: string;
    readonly accruedCurveFees: string;
    readonly readyToGraduate: boolean;
  };
  readonly source: { readonly blockNumber: string };
};

export type MarketFilter = {
  readonly search?: string;
  readonly phase?: "all" | "0" | "1" | "2" | "3";
  readonly assetUid?: string;
  readonly order?: "newest" | "oldest";
};

function parseRawAmount(value: string): bigint {
  return /^(0|[1-9][0-9]*)$/.test(value) ? BigInt(value) : 0n;
}

export function filterMarkets<T extends MarketLike>(markets: readonly T[], filter: MarketFilter): T[] {
  const search = filter.search?.trim().toLowerCase() ?? "";
  const phase = filter.phase ?? "all";
  const assetUid = filter.assetUid?.toLowerCase() ?? "all";
  const direction = filter.order === "oldest" ? 1 : -1;

  return markets
    .filter((market) => phase === "all" || market.launchPhase === Number(phase))
    .filter((market) => assetUid === "all" || market.assetUid.toLowerCase() === assetUid)
    .filter((market) => search.length === 0 || [market.marketId, market.assetUid, market.memeToken, market.quoteAsset]
      .some((value) => value.toLowerCase().includes(search)))
    .sort((left, right) => {
      const leftBlock = parseRawAmount(left.source.blockNumber);
      const rightBlock = parseRawAmount(right.source.blockNumber);
      if (leftBlock === rightBlock) return left.marketId.localeCompare(right.marketId) * direction;
      return leftBlock < rightBlock ? -direction : direction;
    });
}

export function summarizeMarkets(markets: readonly MarketLike[]) {
  const phaseCounts = [0, 0, 0, 0];
  let readyToGraduate = 0;
  const quoteGroups = new Map<string, { quoteAsset: string; markets: number; realQuoteReserve: bigint; accruedCurveFees: bigint }>();

  for (const market of markets) {
    if (market.launchPhase >= 0 && market.launchPhase <= 3) phaseCounts[market.launchPhase]! += 1;
    if (market.curveProgress.readyToGraduate) readyToGraduate += 1;
    const quoteAsset = market.quoteAsset.toLowerCase();
    const current = quoteGroups.get(quoteAsset) ?? { quoteAsset, markets: 0, realQuoteReserve: 0n, accruedCurveFees: 0n };
    current.markets += 1;
    current.realQuoteReserve += parseRawAmount(market.curveProgress.realQuoteReserve);
    current.accruedCurveFees += parseRawAmount(market.curveProgress.accruedCurveFees);
    quoteGroups.set(quoteAsset, current);
  }

  return {
    total: markets.length,
    phaseCounts: phaseCounts as readonly number[],
    readyToGraduate,
    quoteGroups: [...quoteGroups.values()].sort((left, right) => right.markets - left.markets || left.quoteAsset.localeCompare(right.quoteAsset)),
  };
}
