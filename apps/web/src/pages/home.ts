const asset3Large = new URL('../../assets/step-liquidity-640.webp', import.meta.url).href;
const asset2Large = new URL('../../assets/step-earn-640.webp', import.meta.url).href;
const asset1Large = new URL('../../assets/step-stake-640.webp', import.meta.url).href;
const asset0 = new URL('../../assets/signal-arbor.png', import.meta.url).href;
const asset1 = new URL('../../assets/step-stake-320.webp', import.meta.url).href;
const asset2 = new URL('../../assets/step-earn-320.webp', import.meta.url).href;
const asset3 = new URL('../../assets/step-liquidity-320.webp', import.meta.url).href;

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
          <p class="hero-kicker"><i class="ph ph-plant" aria-hidden="true"></i>Stake to earn</p>
          <h1>Stake the ticker.<span>Grow the culture.</span></h1>
          <div class="hero-proof" aria-label="TickerGarden features">
            <div class="hero-feature"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></svg><div><strong>194 Stock tokens</strong><span>Official Robinhood assets</span></div></div>
            <div class="hero-feature"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21v-9M12 16C5 16 3 12 3 7c6 0 9 3 9 9ZM12 12c0-6 3-9 9-9 0 6-3 9-9 9Z"/></svg><div><strong>30% base-fee share</strong><span>For active Stock stakers after Bloom</span></div></div>
            <div class="hero-feature"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h4m6 0h6M4 17h10m6 0h0"/><circle cx="11" cy="7" r="3"/><circle cx="17" cy="17" r="3"/></svg><div><strong>Custom LP fees</strong><span>Set your market’s LP fee</span></div></div>
            <div class="hero-feature"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3c1 5 6 6 6 11a6 6 0 0 1-12 0c0-3 2-5 3-6 0 3 1 4 2 4 2-2 2-6 1-9Z"/></svg><div><strong>Token fee burning</strong><span>Burn token fees. Reduce supply.</span></div></div>
          </div>
          <div class="hero-actions">
            <a class="home-button primary" href="/explore">Explore markets <i class="ph ph-arrow-up-right" aria-hidden="true"></i></a>
            <a class="home-button secondary" href="/create">Launch a token <i class="ph ph-sprout" aria-hidden="true"></i></a>
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
        <a class="home-button banner-button" href="/create">Launch a token <i class="ph ph-arrow-right" aria-hidden="true"></i></a>
      </section>

      <section class="how" aria-labelledby="how-heading">
        <div class="how-heading"><p class="section-kicker">Simple mechanics</p><h2 id="how-heading">How it grows</h2><p>From an eligible Stock Token to a living onchain community.</p></div>
        <div class="steps">
          <article><img src="${asset1}" srcset="${asset1} 320w, ${asset1Large} 640w" sizes="(max-width: 700px) 280px, 320px" width="1254" height="1254" loading="lazy" decoding="async" alt="Candlesticks growing from soil" /><div><span>01</span><h3>Launch a community token</h3><p>Launch a fixed-supply token with your chosen paired asset.</p></div></article>
          <article><img src="${asset2}" srcset="${asset2} 320w, ${asset2Large} 640w" sizes="(max-width: 700px) 280px, 320px" width="1254" height="1254" loading="lazy" decoding="async" alt="A sprouting ticker chart" /><div><span>02</span><h3>Bloom the Market</h3><p>Curve trading moves into permanently locked liquidity.</p></div></article>
          <article><img src="${asset3}" srcset="${asset3} 320w, ${asset3Large} 640w" sizes="(max-width: 700px) 280px, 320px" width="1254" height="1254" loading="lazy" decoding="async" alt="A healthy liquidity garden" /><div><span>03</span><h3>Allocate STOCK, Earn Fees</h3><p>After Bloom, stake STOCK to earn trading fees.</p></div></article>
        </div>
      </section>
    </main>
`,
};
