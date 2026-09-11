import { feePreviewTable } from '../create/fee-preview.ts';

export default {
  title: 'Launch a token — TickerGarden',
  html: `
<main class="page">
      <section class="panel listing-package" data-listing-package aria-label="Created token information" hidden></section>
      <div class="create-layout">
        <form class="panel launch-form" data-create-form>
          <section class="form-section">
            <h2>Your token</h2>
            <div class="fields">
              <label class="field" for="market-name"><span>Name</span><input id="market-name" name="name" maxlength="64" placeholder="Token name" required /></label>
              <label class="field" for="market-symbol"><span>Ticker</span><input id="market-symbol" name="symbol" maxlength="16" pattern="[A-Za-z0-9]{1,16}" placeholder="SYMBOL" required /></label>
              <label class="field full" for="description"><span>Description <small>Optional</small></span><textarea id="description" name="description" maxlength="300" aria-describedby="description-count" placeholder="Tell your community about your token." rows="3"></textarea><small id="description-count" data-description-count>0 / 300</small></label>
              <label class="field full upload-field" for="token-image"><span>Token image</span><span class="upload-surface"><i data-upload-icon class="ph ph-image-square" aria-hidden="true"></i><img data-upload-thumbnail alt="Selected token image" hidden /><span class="upload-copy"><strong data-upload-title>Choose an image</strong><small data-upload-info>PNG, JPG or WebP · up to 2 MB</small><small data-upload-action hidden>Click to replace image</small></span></span><input id="token-image" name="tokenImage" type="file" required accept="image/png,image/jpeg,image/webp" /><small data-image-status role="status"></small></label>
              <label class="field" for="x-profile"><span>X profile <small>Optional</small></span><input id="x-profile" name="x" placeholder="x.com/handle" maxlength="100" /></label>
              <label class="field" for="website"><span>Website <small>Optional</small></span><input id="website" name="website" type="url" placeholder="https://yourwebsite.com" maxlength="512" /></label>
            </div>
          </section>
          <section class="form-section">
            <h2>Plant your market</h2>
            <div class="fields">
              <div class="field full quote-asset-field">
                <label id="quote-asset-label" for="quote-asset-trigger">Paired asset</label>
                
                <div class="quote-picker" data-quote-picker>
                  <button id="quote-asset-trigger" class="quote-picker-trigger" type="button" aria-haspopup="listbox" aria-expanded="false" aria-controls="quote-asset-options" aria-labelledby="quote-asset-label quote-asset-current">
                    <span id="quote-asset-current" class="quote-picker-current" data-quote-current>Loading paired assets…</span>
                    <i class="ph ph-caret-down" aria-hidden="true"></i>
                  </button>
                  <div id="quote-asset-options" class="quote-picker-options" data-quote-options role="listbox" aria-labelledby="quote-asset-label" hidden></div>
                  <select id="quote-asset-config" class="quote-native-select" name="quoteAssetConfigId" tabindex="-1" aria-hidden="true" required><option value="" selected disabled>Loading paired assets…</option></select>
                </div>
              </div>
              <div class="graduation-note field full"><i class="ph ph-trend-up" aria-hidden="true"></i><div><strong data-graduation-caption>Loading bloom target…</strong><details class="graduation-details"><summary>Details</summary><small>Net funds raised, excluding fees and virtual reserves.</small><small data-graduation-exact></small><p class="muted display-price-reference" data-display-price>USD reference unavailable.</p></details></div></div>
              <div class="field full launch-treasury"><div class="treasury-heading"><i class="ph ph-plant" aria-hidden="true"></i><label for="staking-enabled"><strong>Enable Staking Rewards</strong></label><a class="staking-docs-link" href="/docs#staking-rewards" target="_blank" rel="noopener noreferrer" aria-label="Staking Rewards Docs (Opens In A New Tab)">Docs <i class="ph ph-arrow-up-right" aria-hidden="true"></i></a><input id="staking-enabled" type="checkbox" role="switch" name="stakingEnabled" aria-controls="staking-stock-field" /></div><small>Cannot Be Changed After Launch.</small></div>
              <div class="field full" id="staking-stock-field" data-staking-stock-field hidden>
                <label id="rewards-stock-label" for="rewards-stock-trigger">Staking asset</label>
                <div class="quote-picker" data-quote-picker>
                  <button id="rewards-stock-trigger" class="quote-picker-trigger" type="button" aria-haspopup="listbox" aria-expanded="false" aria-controls="rewards-stock-options" aria-labelledby="rewards-stock-label rewards-stock-current" aria-describedby="rewards-stock-help">
                    <span id="rewards-stock-current" class="quote-picker-current" data-quote-current>Loading staking assets…</span>
                    <i class="ph ph-caret-down" aria-hidden="true"></i>
                  </button>
                  <div id="rewards-stock-options" class="quote-picker-options" data-quote-options role="listbox" aria-labelledby="rewards-stock-label" hidden></div>
                  <select id="asset-uid" class="quote-native-select" name="assetUid" tabindex="-1" aria-hidden="true" disabled><option value="" selected disabled>Loading staking assets…</option></select>
                </div>
                <small id="rewards-stock-help">Stake This Asset To Earn Trading Fees.</small>
              </div>
              <label class="field full" for="first-buy-amount"><span>Developer buy <small>Optional</small></span><span class="launch-amount"><input id="first-buy-amount" name="firstBuyAmount" type="text" inputmode="decimal" pattern="(?:0|[1-9][0-9]*)(?:\.[0-9]+)?" placeholder="0.00" aria-describedby="developer-buy-help developer-buy-balance developer-buy-notice" /><strong data-buy-symbol>-</strong></span><span class="developer-buy-footer"><small id="developer-buy-help">Leave blank to skip.</small><small id="developer-buy-balance" data-developer-buy-balance role="status">Connect wallet for balance</small></span><small id="developer-buy-notice" data-developer-buy-notice role="status" hidden></small></label>
            </div>
          </section>
          <details class="launch-advanced">
            <summary>Advanced <i class="ph ph-caret-down" aria-hidden="true"></i></summary>
            <div class="fields">
              <label class="field full" for="beneficiary"><span>Creator wallet</span><input id="beneficiary" name="beneficiary" autocomplete="off" placeholder="Connected wallet" /><small>Receives your fees. Defaults to your connected wallet.</small></label>
              <label class="field full" for="creator-tax"><span>Creator tax</span><span class="launch-amount"><input id="creator-tax" name="creatorTax" type="number" min="0" max="5" step="0.01" value="0" inputmode="decimal" /><strong>%</strong></span><small>Extra trading fee (0–5%), entirely yours. Fixed at launch.</small><small data-creator-fee-note></small></label>
              <div class="field full launch-treasury"><div class="treasury-heading"><i class="ph ph-vault" aria-hidden="true"></i><label for="treasury-enabled"><strong>Share creator fees with holders</strong></label><input id="treasury-enabled" name="treasuryEnabled" type="checkbox" role="switch" aria-controls="treasury-details" /></div><small data-treasury-option-status>Share 50% of base fees with holders. Creator tax stays yours. Permanent at launch.</small><div id="treasury-details" hidden><p>Eligible holders can claim rewards after settlement. Payouts may be delayed.</p><a href="/claim">View holder rewards <i class="ph ph-arrow-up-right" aria-hidden="true"></i></a></div></div>
            </div>
          </details>
          <div hidden><select name="tickerGardenBaselineId" aria-label="Automatic baseline"></select><select name="launchTemplateId" aria-label="Automatic launch template"></select><select name="launchMode" aria-label="Automatic launch mode"><option value="create">Create</option><option value="create-buy">Create and buy</option></select></div>
          <p class="config-status create-notice create-notice-error" data-notice-level="error" data-create-config-status role="status" aria-live="polite"></p>
          <div class="create-preview create-notice" data-create-preview aria-live="polite"></div>
          <div class="launch-funding" data-launch-funding hidden aria-live="polite">
            <div><span>Payment route</span><strong data-funding-route>-</strong></div>
            <div><span>Paired asset balance</span><strong data-funding-quote-balance>-</strong></div>
            <div><span>ETH for asset purchase</span><strong data-funding-swap>-</strong></div>
            <div><span>Estimated gas</span><strong data-funding-gas>-</strong></div>
            <div><span>Total ETH required</span><strong data-funding-total>-</strong></div>
            <div><span>Wallet ETH balance</span><strong data-funding-balance>-</strong></div>
          </div>
          <button class="action-button" type="submit" data-create-submit disabled><i class="ph ph-plant" aria-hidden="true"></i>Launch token</button>
        </form>
        <aside class="panel token-preview" aria-labelledby="preview-heading">
          <div class="preview-orbit" data-preview-image-frame><i class="ph ph-image-square" data-token-placeholder role="img" aria-label="Your token image"></i><img data-token-image alt="Token preview" hidden /></div>
          <small id="preview-heading">YOUR TOKEN</small><h2 data-token-symbol>ticker</h2><p data-token-name>Your next big idea</p><p class="token-description" data-token-description></p>
          <div class="preview-list"><div><span>Launch fee</span><strong data-preview-launch-fee>-</strong></div><div><span>Paired with</span><strong data-preview-quote>-</strong></div><div><span>Base trade fee</span><strong data-preview-trade-fee>-</strong></div><div><span>Bloom target</span><strong data-preview-graduation>-</strong></div><div><span>Liquidity</span><strong>Locked when Bloomed</strong></div><div><span>Staking asset</span><strong data-preview-asset>-</strong></div><div><span>Developer buy</span><strong data-preview-mode>-</strong></div><div><span>Creator tax</span><strong data-preview-creator-tax>0%</strong></div><div><span>Holder fee sharing</span><strong data-preview-treasury>Off</strong></div></div>
          <section class="fee-preview" aria-labelledby="fee-preview-heading">
            <h2 id="fee-preview-heading">Your fee earnings</h2>
            <p>Share of trading fees.</p>
            <section class="fee-scenario is-current" data-fee-current-table>${feePreviewTable(false, false)}</section>
            <div class="creator-tax-summary"><span>Creator tax <strong data-fee-tax>0%</strong></span><strong data-creator-tax-recipient hidden>100% to you</strong></div>
            <p class="fee-preview-note" data-fee-staking-note>Staking rewards are off.</p>
            <small>Creator tax is separate. Excludes LP fees; rounding applies.</small>
          </section>
        </aside>
      </div>
    </main>
`,
};
