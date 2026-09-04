import { useMemo, useState } from "react";
import {
  ArrowRight,
  ChartDonut,
  Leaf,
  LockKey,
  MagnifyingGlass,
  ShieldCheck,
  TrendUp,
  Wallet,
} from "@phosphor-icons/react";
import { filterMarkets, marketHref, summarizeMarkets } from "./model.ts";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const PHASE_LABELS = ["Curve", "Swept", "Pool created", "Rescued"];

function shortHex(value, left = 6, right = 4) {
  if (!value || value.length <= left + right + 2) return value || "—";
  return `${value.slice(0, left + 2)}…${value.slice(-right)}`;
}

function rawNumber(value) {
  try {
    return BigInt(value).toLocaleString("en-US");
  } catch {
    return "—";
  }
}

function ProductLink({ href, onLink, children, className = "" }) {
  return <a className={className} href={href} onClick={(event) => onLink(event, href)}>{children}</a>;
}

function DataState({ foundation, noun = "canonical data" }) {
  if (foundation.status === "loading") return <div className="empty-state" role="status">Loading {noun} from the finalized Read API…</div>;
  if (foundation.status === "error") return <div className="empty-state empty-state-error" role="alert"><strong>{noun} unavailable</strong><span>{foundation.error}</span></div>;
  return <div className="empty-state"><strong>{noun} stays locked until runtime configuration is complete.</strong><span>No demo balances, markets or prices are substituted for unavailable chain facts.</span></div>;
}

export function HomePage({ foundation, onLink }) {
  const markets = foundation.status === "ready" ? foundation.markets : [];
  const summary = useMemo(() => summarizeMarkets(markets), [markets]);
  return (
    <>
      <section className="home-actions" aria-label="Product entry points">
        <article className="feature-card feature-card-dark">
          <span className="feature-index">01 · Launch</span>
          <Leaf size={30} weight="duotone" aria-hidden="true" />
          <h2>Grow a Meme market from approved roots.</h2>
          <p>Choose an official STOCK context, approved Quote economics and a frozen launch template. Factory preview binds every economic parameter before the wallet sees a signature.</p>
          <ProductLink href="/create" onLink={onLink} className="card-link">Create a market <ArrowRight aria-hidden="true" /></ProductLink>
        </article>
        <article className="feature-card">
          <span className="feature-index">02 · Discover</span>
          <TrendUp size={30} weight="duotone" aria-hidden="true" />
          <h2>Inspect markets through one canonical snapshot.</h2>
          <p>Search every fully loaded market by ID, Meme address, Quote or STOCK context, then open a deep-linked trading surface.</p>
          <ProductLink href="/markets" onLink={onLink} className="card-link">Explore markets <ArrowRight aria-hidden="true" /></ProductLink>
        </article>
        <article className="feature-card">
          <span className="feature-index">03 · Participate</span>
          <Wallet size={30} weight="duotone" aria-hidden="true" />
          <h2>Keep STOCK principal and earnings legible.</h2>
          <p>Free, pending and active balances remain separate. Normal claims respect the lock; Rage Quit returns the caller’s principal immediately.</p>
          <ProductLink href="/portfolio" onLink={onLink} className="card-link">Open portfolio <ArrowRight aria-hidden="true" /></ProductLink>
        </article>
      </section>

      <section className="snapshot-band" aria-labelledby="snapshot-title">
        <div className="snapshot-copy"><p className="eyebrow">Finalized snapshot</p><h2 id="snapshot-title">Facts before motion.</h2><p>Every funds-sensitive route is checked against immutable Factory and Registry bindings, then simulated before signature.</p></div>
        {foundation.status === "ready" ? <div className="snapshot-metrics"><div><strong>{summary.total}</strong><span>markets loaded</span></div><div><strong>{summary.phaseCounts[0]}</strong><span>on Curve</span></div><div><strong>{summary.phaseCounts[2]}</strong><span>pool created</span></div><div><strong>{foundation.assets.filter((item) => item.status === 1).length}</strong><span>active STOCK assets</span></div></div> : <DataState foundation={foundation} noun="snapshot metrics" />}
      </section>

      <section className="flow-section" aria-labelledby="flow-title">
        <div className="section-heading"><div><p className="eyebrow">One-way lifecycle</p><h2 id="flow-title">A market advances. It is not remotely steered.</h2></div><ProductLink href="/faq" onLink={onLink} className="text-link">Read protocol FAQ <ArrowRight aria-hidden="true" /></ProductLink></div>
        <ol className="flow-grid">
          <li><span>01</span><strong>Create</strong><p>Factory derives the Meme, Curve and Gauge from approved inputs.</p></li>
          <li><span>02</span><strong>Curve</strong><p>Buy and sell against live, onchain reserves with a fresh 30-second quote.</p></li>
          <li><span>03</span><strong>Sweep</strong><p>Graduation moves assets once the configured threshold is reached.</p></li>
          <li><span>04</span><strong>Pool</strong><p>The canonical pool route is displayed only from finalized indexed and onchain state.</p></li>
        </ol>
      </section>
    </>
  );
}

export function MarketsPage({ foundation, activeAssets, onLink }) {
  const [search, setSearch] = useState("");
  const [phase, setPhase] = useState("all");
  const [assetUid, setAssetUid] = useState("all");
  const [order, setOrder] = useState("newest");
  const markets = foundation.status === "ready" ? foundation.markets : [];
  const filtered = useMemo(() => filterMarkets(markets, { search, phase, assetUid, order }), [markets, search, phase, assetUid, order]);

  return (
    <section className="catalog-page" aria-labelledby="market-catalog-title">
      <div className="section-heading"><div><p className="eyebrow">Canonical market directory</p><h2 id="market-catalog-title">Every market in the same finalized revision.</h2></div>{foundation.status === "ready" ? <span className="snapshot-chip">Block {foundation.sync.blockNumber} · {foundation.markets.length} loaded</span> : null}</div>
      <div className="market-toolbar" role="search">
        <label className="search-field"><span>Search ID or address</span><div><MagnifyingGlass aria-hidden="true" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Market, Meme, Quote or STOCK…" /></div></label>
        <label><span>Lifecycle</span><select value={phase} onChange={(event) => setPhase(event.target.value)}><option value="all">All phases</option>{PHASE_LABELS.map((label, index) => <option value={String(index)} key={label}>{label}</option>)}</select></label>
        <label><span>Official STOCK</span><select value={assetUid} onChange={(event) => setAssetUid(event.target.value)}><option value="all">All assets</option>{activeAssets.map((asset) => <option value={asset.id} key={asset.id}>{shortHex(asset.id)} · {shortHex(asset.values.stockToken)}</option>)}</select></label>
        <label><span>Created</span><select value={order} onChange={(event) => setOrder(event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
      </div>

      {foundation.status !== "ready" ? <DataState foundation={foundation} noun="market directory" /> : filtered.length === 0 ? <div className="empty-state"><strong>No markets match this view.</strong><span>Clear the search or change a lifecycle/STOCK filter. The app never injects sample markets.</span></div> : <div className="market-catalog">
        {filtered.map((market, index) => <article className="market-card" key={market.marketId}>
          <div className="market-card-head"><span className="market-rank">{String(index + 1).padStart(2, "0")}</span><span className={`phase phase-${market.launchPhase}`}>{PHASE_LABELS[market.launchPhase] || `Phase ${market.launchPhase}`}</span></div>
          <div><p className="eyebrow">Market ID</p><h3>{shortHex(market.marketId, 10, 8)}</h3></div>
          <dl className="market-facts"><div><dt>Real Quote reserve</dt><dd>{rawNumber(market.curveProgress.realQuoteReserve)} <small>raw</small></dd></div><div><dt>Meme token</dt><dd>{shortHex(market.memeToken)}</dd></div><div><dt>Quote</dt><dd>{market.quoteAsset === ZERO_ADDRESS ? "Native ETH" : shortHex(market.quoteAsset)}</dd></div><div><dt>STOCK context</dt><dd>{shortHex(market.assetUid)}</dd></div></dl>
          <ProductLink href={marketHref(market.marketId)} onLink={onLink} className="market-open">Inspect & trade <ArrowRight aria-hidden="true" /></ProductLink>
        </article>)}
      </div>}
      {foundation.status === "ready" ? <p className="scope-note">Showing {filtered.length} of {foundation.markets.length} markets. Pagination is consumed only while every page remains on revision <code>{foundation.sync.revision}</code>.</p> : null}
    </section>
  );
}

export function StatsPage({ foundation }) {
  const markets = foundation.status === "ready" ? foundation.markets : [];
  const summary = useMemo(() => summarizeMarkets(markets), [markets]);
  const maximum = Math.max(1, ...summary.phaseCounts);
  return (
    <section className="stats-page" aria-labelledby="stats-heading">
      <div className="section-heading"><div><p className="eyebrow">Snapshot analytics</p><h2 id="stats-heading">Measurable without manufacturing a price.</h2></div><span className="pill">Local aggregation · one revision</span></div>
      {foundation.status !== "ready" ? <DataState foundation={foundation} noun="protocol statistics" /> : <>
        <div className="stats-hero">
          <div className="stat-orbit"><ChartDonut size={34} weight="duotone" aria-hidden="true" /><strong>{summary.total}</strong><span>canonical markets</span><small>finalized block {foundation.sync.blockNumber}</small></div>
          <div className="lifecycle-chart" aria-label={`Lifecycle distribution: ${PHASE_LABELS.map((label, index) => `${label} ${summary.phaseCounts[index]}`).join(", ")}`}>
            {PHASE_LABELS.map((label, index) => <div className="chart-row" key={label}><span>{label}</span><div><i style={{ width: `${summary.phaseCounts[index] / maximum * 100}%` }} /></div><strong>{summary.phaseCounts[index]}</strong></div>)}
          </div>
          <div className="stat-notes"><div><span>Ready to graduate</span><strong>{summary.readyToGraduate}</strong></div><div><span>Active STOCK configs</span><strong>{foundation.assets.filter((item) => item.status === 1).length}</strong></div><div><span>Approved Quote configs</span><strong>{foundation.quotes.filter((item) => item.status === 1).length}</strong></div></div>
        </div>
        <div className="section-heading compact-heading"><div><p className="eyebrow">Asset-safe totals</p><h2>Quote balances never cross denominations.</h2></div></div>
        {summary.quoteGroups.length === 0 ? <div className="empty-state"><strong>No market balances in this snapshot.</strong></div> : <div className="quote-ledger">{summary.quoteGroups.map((group) => <article key={group.quoteAsset}><div><span>{group.quoteAsset === ZERO_ADDRESS ? "Native ETH Quote" : shortHex(group.quoteAsset, 8, 6)}</span><small>{group.markets} market{group.markets === 1 ? "" : "s"}</small></div><dl><div><dt>Real reserve</dt><dd>{rawNumber(group.realQuoteReserve)} raw</dd></div><div><dt>Accrued Curve fees</dt><dd>{rawNumber(group.accruedCurveFees)} raw</dd></div></dl></article>)}</div>}
        <div className="method-note"><ShieldCheck size={26} aria-hidden="true" /><div><strong>What these numbers mean</strong><p>Counts and raw Quote totals are derived only from the fully paginated market set at revision <code>{foundation.sync.revision}</code>. The current Read API has no canonical price, volume, TVL or time-series endpoint, so this page intentionally makes none of those claims.</p></div></div>
      </>}
    </section>
  );
}

const FAQ_GROUPS = [
  {
    title: "Launch & markets",
    items: [
      ["What does “Create token” deploy?", "It creates one Meme market through TickerGardenFactoryV1. The Factory derives the Meme token, Pons-compatible Curve and Gauge from an approved STOCK context, Quote configuration, Pons baseline and launch template."],
      ["Can the platform pause or retire a deployed Meme market?", "No market-level PAUSED or RETIRED control is presented. A deployed market follows the one-way launch lifecycle. Governance can still manage versioned protocol configuration, accepted STOCK assets and fee-related infrastructure within their explicit contracts."],
      ["What happens after graduation?", "The market leaves Curve trading, is swept, and may expose a canonical pool route. This release displays PoolKey and route facts, but keeps pool swaps unavailable until pinned Robinhood Chain v4 fork evidence and a complete quote/simulation surface exist."],
    ],
  },
  {
    title: "Trading & data",
    items: [
      ["Why does a Curve quote expire?", "Reserves can change between users. A quote is bound to its market, trade side and finalized Read API revision for 30 seconds. The app rechecks canonical chain bindings and simulates again before requesting a signature."],
      ["Why are amounts shown in raw units?", "Tokens can use different decimals. Transaction inputs stay explicit in raw units so the interface cannot silently round a funds-sensitive amount. Market details format known Quote decimals alongside the exact raw value."],
      ["Are the statistics global TVL or price data?", "No. The statistics page aggregates only the fully paginated market snapshot returned at one finalized revision. Quote assets are grouped separately, and no price, volume or TVL is invented without a canonical endpoint."],
    ],
  },
  {
    title: "STOCK, rewards & safety",
    items: [
      ["What is minimumAllocation?", "It is the smallest non-zero STOCK allocation permitted for an official asset. Governance can preset and later update it per STOCK as market conditions change, while the contracts preserve their arithmetic safety floor."],
      ["What is the difference between free, pending and active STOCK?", "Free STOCK is deposited but unallocated. A new allocation is pending for 30 seconds, then becomes active. Normal close and reward claims respect the 24-hour unlock boundary."],
      ["Does Rage Quit wait 24 hours?", "No. Rage Quit is a caller-only emergency escape: it ignores the normal lock, minimum and market launch phase, returns the caller’s exact principal first, and forfeits that caller’s rewards. Rewards are redistributed to remaining active stakers, or reserved for platform income if none remain. It does not pause the market or affect other traders."],
      ["Why are all actions sometimes locked?", "The interface fails closed unless every deployment address is configured, the Read API reports the expected execution spec and finalized revision, deployed code and immutable bindings match, and the wallet is on Robinhood Chain. Missing facts are never replaced with placeholders."],
    ],
  },
];

export function FaqPage() {
  return <section className="faq-page" aria-labelledby="faq-heading"><div className="faq-intro"><p className="eyebrow">Protocol field guide</p><h2 id="faq-heading">Questions worth answering before a signature.</h2><p>Short explanations of the launch lifecycle, canonical data boundary and user-controlled exits in the current V1 surface.</p></div><div className="faq-groups">{FAQ_GROUPS.map((group, groupIndex) => <section key={group.title}><div className="faq-group-title"><span>{String(groupIndex + 1).padStart(2, "0")}</span><h3>{group.title}</h3></div><div>{group.items.map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div></section>)}</div></section>;
}

export function NotFoundPage({ onLink }) {
  return <section className="not-found"><LockKey size={38} weight="duotone" aria-hidden="true" /><p className="eyebrow">404 · Unknown route</p><h2>This path is outside the garden.</h2><p>No protocol action was attempted. Return to a known product surface.</p><ProductLink href="/" onLink={onLink} className="button-link">Back to overview <ArrowRight aria-hidden="true" /></ProductLink></section>;
}
