
export default {
  title: 'Stats — TickerGarden',
  html: `
<main class="page">
      <section class="page-hero">
        <div>
          <div class="kicker"><i class="ph ph-chart-line-up" aria-hidden="true"></i>On-chain data</div>
          <h1>Protocol analytics</h1>
          <p>Track trading activity, token launches, market growth, and holder participation across TickerGarden.</p>
        </div>
        <p class="page-status" data-page-status role="status" aria-live="polite">Loading on-chain statistics…</p>
      </section>

      <section class="stats-toolbar" aria-label="Analytics time range">
        <div class="pills" role="tablist" aria-label="Analytics period">
          <button class="pill active" type="button" role="tab" aria-selected="true" data-stats-period="24h">24h</button>
          <button class="pill" type="button" role="tab" aria-selected="false" data-stats-period="all">All time</button>
        </div>
        <p data-stats-source>Finalized on-chain data from the TickerGarden Read API.</p>
      </section>

      <section class="stats-grid" data-stats-summary aria-live="polite" aria-busy="false">
        <article class="stat-card"><i class="ph ph-chart-line-up" aria-hidden="true"></i><strong data-stat-volume>—</strong><small data-stat-volume-label>24h trading volume (USD)</small></article>
        <article class="stat-card"><i class="ph ph-plant" aria-hidden="true"></i><strong data-stat-launches>—</strong><small data-stat-launches-label>Token launches in 24h</small></article>
        <article class="stat-card"><i class="ph ph-flower-lotus" aria-hidden="true"></i><strong data-stat-bloomed>—</strong><small>Bloomed markets</small></article>
        <article class="stat-card"><i class="ph ph-users-three" aria-hidden="true"></i><strong data-stat-holders>—</strong><small>Current holder addresses</small></article>
      </section>

      <section class="stats-layout">
        <article class="panel" data-stats-phases aria-labelledby="phase-stats-heading">
          <div class="panel-title"><div><h2 id="phase-stats-heading">Market growth</h2><p>Current Bloomed and Growing market counts</p></div></div>
          <div class="activity-list" data-stats-phase-list><p data-stats-loading>Loading phase totals…</p></div>
        </article>
        <aside class="panel" data-stats-quotes aria-labelledby="quote-stats-heading">
          <div class="panel-title"><div><h2 id="quote-stats-heading">Quote assets</h2><p>On-chain reserves grouped by asset</p></div></div>
          <div class="activity-list" data-stats-quote-list><p data-stats-empty>No quote-asset records are available yet.</p></div>
        </aside>
      </section>

      <section class="panel stats-notice" aria-labelledby="stats-boundary-heading">
        <h2 id="stats-boundary-heading">How these figures are calculated</h2>
        <p>USD volume uses external finalized executions and the configured USD price for each exact Quote Token address. Internal reward conversions are excluded. Holder counts represent distinct addresses, not people. Missing or stale price coverage is shown as unavailable instead of zero.</p>
      </section>
      <section class="panel stats-detail-panel" data-global-statistics data-expanded aria-label="Global execution statistics"><h2>Execution details</h2></section>
      <section class="panel stats-detail-panel" data-global-holders aria-label="Global holder addresses"><h2>Holder details</h2></section>
      <section class="panel stats-detail-panel" data-global-series aria-label="Global hourly execution volumes"><h2>Hourly execution activity</h2></section>
    </main>
`,
};
