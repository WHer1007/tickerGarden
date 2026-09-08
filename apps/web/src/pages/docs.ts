
export default {
  title: 'Docs — TickerGarden',
  html: `
<main class="page">
      <section class="page-hero">
        <div>
          <div class="kicker"><i class="ph ph-book-open-text" aria-hidden="true"></i>Documentation</div>
          <h1>Docs</h1>
          <p>Find clear answers about markets, trading, rewards and holder fee sharing.</p>
        </div>
        <aside class="hero-badge"><i class="ph ph-chats-circle" aria-hidden="true"></i><strong>Protocol guide</strong><span>Read the current protocol semantics</span></aside>
      </section>

      <label class="search" style="display:block;max-width:720px;margin-bottom:28px"><i class="ph ph-magnifying-glass" aria-hidden="true"></i><span class="sr-only">Search docs</span><input data-docs-search type="search" placeholder="Search the docs" /></label>
      <p class="page-status" data-page-status role="status" aria-live="polite">Documentation loaded.</p>
      <section class="docs-layout">
        <nav class="docs-nav" aria-label="Documentation topics"><button class="active" type="button" data-docs-filter="all">All topics</button><button type="button" data-docs-filter="basics">Basics</button><button type="button" data-docs-filter="markets">Markets &amp; trading</button><button type="button" data-docs-filter="vault">STOCK Vault</button><button type="button" data-docs-filter="treasury">Holder fee sharing</button><button type="button" data-docs-filter="risk">Risk &amp; boundaries</button></nav>
        <div class="docs-list">
          <details open data-topic="basics"><summary>What is a STOCK and what is a Ticker Meme?</summary><p>STOCK is the eligible on-chain asset selected by a market creator. A Ticker Meme is a community signal associated with that STOCK. It is not equity, stock ownership, a dividend, a voting right, a redemption claim, or a promise that the Meme tracks the company.</p></details>
          <details data-topic="basics"><summary>Can one STOCK have more than one Meme market?</summary><p>Yes. The same eligible STOCK may be selected by many creators for multiple independent Meme markets. Each market has its own immutable configuration and canonical bytes32 marketId; a STOCK is not limited to one market.</p></details>
          <details data-topic="markets"><summary>How is a market created?</summary><p>Creation selects an active official assetUid, quoteAssetConfigId, tickerGardenBaselineId, and launchTemplateId from their registries, then supplies a beneficiary, name, symbol (up to 16 characters), and metadata URI. The launch mode may create the market or create it and perform a first buy. Salt, expectedEconomics, and deployment addresses are derived by the runtime rather than entered by ordinary users.</p></details>
          <details data-topic="markets"><summary>When can I trade?</summary><p>Curve-phase trading is available only when the configured route and current on-chain state can be verified. A Pool swap is locked when a V4 quoter or builder is unavailable. The interface must fail closed and must never show a guessed or fabricated quote.</p></details>
          <details data-topic="markets"><summary>What does the trade preview contain?</summary><p>After loading a canonical bytes32 marketId, the preview may show a quote, fee, price impact, and minimum received only when returned by a verified route. An unloaded, unsupported, or unverified market remains unavailable for submission.</p></details>
          <details data-topic="vault"><summary>How do I stake STOCK?</summary><p>In Claim, search for a market and enter one STOCK amount. Approve the token if needed, then stake directly from your wallet. New stake activates after 30 seconds; every addition resets the entire position’s 24-hour lock. After unlocking, Unstake all to wallet returns full principal in one transaction and keeps earned rewards available for separate claiming. Behind the interface, The STOCK Vault records users’ allocations of the market’s selected STOCK in raw token units. The same STOCK can be allocated to the corresponding markets after blooming, according to deployed rules; the Vault does not turn a Meme into stock ownership.</p></details>
          <details data-topic="vault"><summary>How does minimumAllocation work?</summary><p><code>minimumAllocation</code> is configured by an administrator for each STOCK asset and can be changed through governance. It is a new-position/allocation admission rule, not a creator-entered form value. The protocol keeps its raw-unit safety floor; existing positions are not silently reduced by a configuration change.</p></details>
          <details data-topic="vault"><summary>What is rageQuit?</summary><p><code>rageQuit</code> immediately returns the user’s full STOCK principal. The user gives up unclaimed rewards, and reward cleanup may settle asynchronously. This principal exit is not affected by market phase, lock time, minimumAllocation, asset admission status, or Gauge/reward availability and does not change the market lifecycle. Claim also exposes an independent direct-Vault route that derives canonical market, STOCK and Vault identities on-chain without relying on the read API.</p></details>
          <details data-topic="treasury"><summary>How does holder fee sharing work?</summary><p>The choice is permanent once a market is created. Fifty percent of the creator base fee share, excluding creator tax, is earmarked for holders; the creator keeps the other 50% and all creator tax. Background Quote settlement feeds the existing distribution workflow. Allocations use 7-day balance-time-weighted holdings and require no extra holder deposits. The platform may trigger the existing Root workflow; each Root requires review and may be delayed, and holders can claim only after a distribution is finalized.</p></details>
          <details data-topic="treasury"><summary>Does the protocol have TGARD or LP mining?</summary><p>No. There is no TGARD token or LP mining program. Do not treat old mock screens, reward points, or LP incentive language as deployed protocol features.</p></details>
          <details data-topic="risk"><summary>What happens when a configuration is not deployed?</summary><p>The page and runtime fail closed. Creation, market loading, quoting, and submission stay unavailable until the required registry entries and deployed addresses are verified. The UI does not substitute demo records, prices, balances, or activity.</p></details>
          <details data-topic="risk"><summary>What risks should I consider?</summary><p>On-chain markets involve contract, liquidity, volatility, wallet, and network risks. Review the current canonical marketId, configuration, route, and wallet transaction before signing. A Ticker Meme never represents the underlying company’s securities.</p></details>
        </div>
      </section>
    </main>
`,
};
