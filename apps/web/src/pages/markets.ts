
export default {
  title: 'Explore — TickerGarden',
  html: `
<main class="page">
      <section class="page-hero">
        <div>
          <div class="kicker"><i class="ph ph-plant" aria-hidden="true"></i>Explore the garden</div>
          <h1>Explore</h1>
          <p>Browse on-chain community markets and their verified activity.</p>
        </div>
        <aside class="hero-badge"><i class="ph ph-tree" aria-hidden="true"></i><strong>Live directory</strong><span>Waiting for canonical market data</span></aside>
      </section>

      <section class="toolbar" aria-label="Market filters">
        <label class="search"><i class="ph ph-magnifying-glass" aria-hidden="true"></i><span class="sr-only">Search by market name or Meme Token address</span><input data-market-search type="search" placeholder="Search name or Meme Token address" /></label>
        <div class="pills market-tabs" role="tablist" aria-label="Market stage">
          <button class="pill active" role="tab" aria-selected="true" type="button" data-market-filter="bloomed">Bloomed</button>
          <button class="pill" role="tab" aria-selected="false" type="button" data-market-filter="growing">Growing</button>
        </div>
        <label class="field-inline"><span>Find STOCK Token</span><input data-market-stock-search type="search" placeholder="STOCK symbol, token address or Asset UID" /></label>
        <label class="field-inline"><span>STOCK category</span><select data-market-asset><option value="">All STOCK Tokens</option></select></label>
        <label class="field-inline"><span>Sort</span><select data-market-sort><option value="recent">Recently created</option><option value="volume24h">24h volume (USD)</option><option value="marketCap">Market cap (USD)</option></select></label>
      </section>

      <p class="page-status" data-page-status role="status" aria-live="polite">Loading canonical market records…</p>
      <section class="garden-grid" data-market-list aria-live="polite" aria-busy="false" aria-label="Explore markets">
        <p data-market-loading hidden>Loading markets from the configured read API…</p>
        <p data-market-empty>No market records are available yet.</p>
        <p data-market-locked hidden>Market listing is locked until the required configuration is deployed.</p>
        <!-- Runtime inserts each result and sets its trade URL from the canonical bytes32 marketId. -->
        <template data-market-item-template>
          <a class="garden-card" data-market-card data-market-link href="/trade">
            <div class="garden-head"><span class="token-mark lime" data-market-tone aria-hidden="true"></span><div><h3 data-market-name></h3><p data-market-asset-label></p></div><span data-market-phase></span></div>
            <div class="garden-stats"><span><small>24h volume</small><strong data-market-volume></strong></span><span><small>Market cap</small><strong data-market-cap></strong></span><span><small>STOCK Token</small><strong data-market-stock></strong></span></div>
          </a>
        </template>
      </section>
    </main>
`,
};
