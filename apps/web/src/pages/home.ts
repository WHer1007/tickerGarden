const asset0 = new URL('../../assets/signal-arbor.png', import.meta.url).href;
const asset1 = new URL('../../assets/step-stake.webp', import.meta.url).href;
const asset2 = new URL('../../assets/step-earn.webp', import.meta.url).href;
const asset3 = new URL('../../assets/step-liquidity.webp', import.meta.url).href;

/*
 * Deferred after the first release. Restore this block inside the home template
 * when the homepage market directory is ready to be opened publicly.
 *
 * <section class="trending" id="gardens" aria-labelledby="home-markets-heading">
 *   <div class="trending-heading">
 *     <div>
 *       <p class="section-kicker">On-chain directory</p>
 *       <h2 id="home-markets-heading">Markets in the garden</h2>
 *     </div>
 *     <a href="/explore">View all markets <i class="ph ph-arrow-right" aria-hidden="true"></i></a>
 *   </div>
 *   <div class="market-rail" data-home-markets aria-live="polite" aria-busy="false" aria-label="Live market links">
 *     <p data-home-markets-loading hidden>Loading markets from the configured read API…</p>
 *     <p data-home-markets-empty>No markets are available from the configured read API yet.</p>
 *     <p data-home-markets-locked hidden>Market data is locked until the required protocol configuration is deployed.</p>
 *   </div>
 * </section>
 */

export default {
  title: 'TickerGarden — Grow community signals',
  html: `
<main class="home-main">
      <section class="home-hero">
        <div class="hero-copy">
          <p class="hero-kicker"><i class="ph ph-plant" aria-hidden="true"></i>Community signal markets</p>
          <h1>Stake the ticker.<span>Grow the culture.</span></h1>
          <p class="hero-lede">TickerGarden is where stock communities create and trade their own onchain tokens—an open, expressive layer for every ticker story.</p>
          <div class="hero-actions">
            <a class="home-button primary" href="/explore">Explore markets <i class="ph ph-arrow-up-right" aria-hidden="true"></i></a>
            <a class="home-button secondary" href="/create">Create a market <i class="ph ph-sprout" aria-hidden="true"></i></a>
          </div>
          <div class="hero-proof" aria-label="TickerGarden principles">
            <span><strong>Rooted</strong> onchain</span>
            <span><strong>Grown</strong> by communities</span>
            <span><strong>Inspired</strong> by ticker culture</span>
          </div>
        </div>

        <div class="tree-stage signal-arbor" data-signal-arbor role="group" aria-label="Interactive stock fruit tree">
          <div class="arbor-art">
            <img class="arbor-source" data-arbor-source src="${asset0}" width="1254" height="1254" decoding="async" fetchpriority="high" alt="A leafy line-art tree bearing AAPL, AMZN, MSFT, NVDA, GOOGL, COST, TSLA, META and AVGO fruits." />
          </div>
          <span class="arbor-announcement" data-arbor-status role="status" aria-live="polite"></span>
        </div>
      </section>

      <section class="creation-banner">
        <div><p class="section-kicker">One STOCK. Many cultures.</p><h2>Grow the next <em>community token.</em></h2></div>
        <p>Every stock carries more than one story. Give the next culture room to take root.</p>
        <a class="home-button banner-button" href="/create">Create a market <i class="ph ph-arrow-right" aria-hidden="true"></i></a>
      </section>

      <section class="how" aria-labelledby="how-heading">
        <div class="how-heading"><p class="section-kicker">Simple mechanics</p><h2 id="how-heading">How it grows</h2><p>From an eligible Stock Token to a living onchain community.</p></div>
        <div class="steps">
          <article><img src="${asset1}" width="1254" height="1254" loading="lazy" decoding="async" alt="Candlesticks growing from soil" /><div><span>01</span><h3>Launch a community token</h3><p>Launch a fixed-supply token with your chosen paired asset.</p></div></article>
          <article><img src="${asset2}" width="1254" height="1254" loading="lazy" decoding="async" alt="A sprouting ticker chart" /><div><span>02</span><h3>Bloom the Market</h3><p>Curve trading moves into permanently locked liquidity.</p></div></article>
          <article><img src="${asset3}" width="1254" height="1254" loading="lazy" decoding="async" alt="A healthy liquidity garden" /><div><span>03</span><h3>Allocate STOCK, Earn Fees</h3><p>After Bloom, stake STOCK to earn trading fees.</p></div></article>
        </div>
      </section>
    </main>
`,
};
