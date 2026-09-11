export default {
 title:'Explore — TickerGarden',
 html:`
<main class="page explore-page">
 <header class="explore-heading"><div><h1>Explore</h1><p>Discover the next community to grow with.</p></div><a href="/create" class="explore-create"><i class="ph ph-plus" aria-hidden="true"></i>Create Token</a></header>
 <section class="explore-controls" aria-label="Market filters">
  <div class="explore-search-row">
   <label class="explore-search"><i class="ph ph-magnifying-glass" aria-hidden="true"></i><span class="sr-only">Search tokens by name or address</span><input data-market-search type="search" placeholder="Search tokens by name or address" autocomplete="off" spellcheck="false"></label>
   <div class="explore-stock-filter"><select data-market-asset aria-label="Stock" hidden><option value="">All Stocks</option></select></div>
  </div>
 </section>
 <div class="explore-results-heading"><p class="page-status" data-page-status role="status" aria-live="polite">Loading Tokens…</p><button type="button" data-market-reset hidden><i class="ph ph-arrow-counter-clockwise" aria-hidden="true"></i>Reset Filters</button></div>
 <section class="explore-sections" data-market-list aria-live="polite" aria-busy="false" aria-label="Explore markets">
  <p class="explore-empty" data-market-loading hidden>Loading Tokens…</p>
  <p class="explore-empty" data-market-empty>No Tokens Yet</p>
  <p class="explore-empty" data-market-locked hidden>Unable To Load Tokens</p>
  <section class="explore-stage explore-stage-bloomed" aria-labelledby="explore-bloomed"><header><div><i class="ph ph-flower" aria-hidden="true"></i><h2 id="explore-bloomed">Bloomed</h2><span data-stage-count="1">-</span></div><p>Growing communities. Open markets.</p></header><div class="garden-grid" data-stage-grid="1"><p class="stage-empty" data-stage-empty="1">Loading Tokens…</p></div><nav class="explore-pagination" aria-label="Bloomed pages"><button type="button" data-stage-prev="1" disabled aria-label="Previous page"><i class="ph ph-caret-left" aria-hidden="true"></i></button><span data-stage-page="1"><button type="button" aria-label="Page 1" aria-current="page">1</button></span><button type="button" data-stage-next="1" disabled aria-label="Next page"><i class="ph ph-caret-right" aria-hidden="true"></i></button></nav></section>
  <section class="explore-stage explore-stage-growing" aria-labelledby="explore-growing"><header><div><i class="ph ph-plant" aria-hidden="true"></i><h2 id="explore-growing">Growing</h2><span data-stage-count="0">-</span></div><p>New ideas on their way to bloom.</p><div class="explore-stage-sort" role="group" aria-label="Sort Growing Tokens"><div class="explore-sort-options"><button type="button" data-growing-sort="createdAt_desc" aria-pressed="true">Newest</button><button type="button" data-growing-sort="createdAt_asc" aria-pressed="false">Oldest</button><button type="button" data-growing-sort="marketCapUsd_desc" aria-pressed="false">Market Cap</button><button type="button" data-growing-sort="recentBuy_desc" aria-pressed="false">Recent Buys</button></div></div></header><div class="garden-grid" data-stage-grid="0"><p class="stage-empty" data-stage-empty="0">Loading Tokens…</p></div><nav class="explore-pagination" aria-label="Growing pages"><button type="button" data-stage-prev="0" disabled aria-label="Previous page"><i class="ph ph-caret-left" aria-hidden="true"></i></button><span data-stage-page="0"><button type="button" aria-label="Page 1" aria-current="page">1</button></span><button type="button" data-stage-next="0" disabled aria-label="Next page"><i class="ph ph-caret-right" aria-hidden="true"></i></button></nav></section>
  <template data-market-item-template>
   <article class="garden-card" data-market-card>
    <a class="explore-card-link" data-market-link href="/trade" aria-label="View Token"></a>
    <div class="explore-card-image" aria-busy="true"><span class="token-mark" data-market-tone aria-hidden="true"></span><span class="explore-image-loading" data-market-image-loading role="status" aria-label="Loading Token Image"><span aria-hidden="true"></span></span><span class="explore-phase" data-market-phase></span></div>
    <div class="explore-card-body"><h3 data-market-name></h3><div class="explore-symbol-row"><p class="explore-card-symbol" data-market-symbol></p><span class="explore-card-stock"><img data-market-asset-icon hidden alt=""><span data-market-asset-label></span></span></div>
    <div class="garden-stats"><span class="explore-card-cap" aria-label="Market Cap"><strong data-market-cap></strong> <small>MC</small></span><span class="explore-card-age"><time data-market-age>-</time></span></div>
    <div class="explore-card-footer"><a class="explore-card-address" data-market-address target="_blank" rel="noopener noreferrer"></a><div class="explore-bloom-progress" data-market-progress hidden><progress max="100" value="0" aria-label="Bloom Progress"></progress><span data-market-progress-label>-</span></div><span data-market-stock hidden></span></div></div>
   </article>
  </template>
 </section>
</main>`,
};
