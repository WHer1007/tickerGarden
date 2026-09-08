export default { title: 'Claim — TickerGarden', html: `
<main class="page claim-page" aria-label="Claim rewards">
<div class="claim-workspace">
<nav class="rewards-tabs claim-tabs" role="tablist" aria-label="Reward roles" aria-orientation="vertical">
<button type="button" role="tab" id="rewards-tab-creator" aria-selected="true" aria-controls="rewards-panel-creator" data-rewards-tab="creator"><i class="ph ph-user" aria-hidden="true"></i>Creator</button>
<button type="button" role="tab" id="rewards-tab-treasury" aria-selected="false" aria-controls="rewards-panel-treasury" data-rewards-tab="treasury"><i class="ph ph-users" aria-hidden="true"></i>Holder</button>
</nav>
<div class="claim-content">
<section class="rewards-panel" role="tabpanel" id="rewards-panel-creator" aria-labelledby="rewards-tab-creator" data-rewards-panel="creator">
<header class="claim-card-heading"><div><h2>Creator rewards</h2><p>Trading fees earned by your tokens.</p></div></header>
<div class="field"><label for="creator-market">Select token</label><div class="claim-token-select"><i class="ph ph-coins" aria-hidden="true"></i><select id="creator-market" data-creator-market><option value="">Select a token</option></select></div></div>
<div class="claim-amounts"><div><span>Available to claim</span><strong data-creator-quote-asset>Unavailable</strong></div><div><span>Awaiting conversion</span><strong data-creator-pending-meme>Unavailable</strong><small>Automatically converted to the paired asset.</small></div></div>
<dl class="claim-facts"><div><dt>Receive in</dt><dd data-creator-receive-asset>—</dd></div><div><dt>Recipient</dt><dd><span data-creator-beneficiary>—</span><button type="button" data-copy-beneficiary aria-label="Copy recipient address" disabled><i class="ph ph-copy" aria-hidden="true"></i></button></dd></div><div><dt>Creator share</dt><dd>Includes base fees and creator tax.</dd></div></dl>
<input type="hidden" data-creator-fee-asset>
<div class="claim-action"><button type="button" disabled class="action-button" data-reward-action="claimCreator">Claim creator rewards</button><p data-creator-action-help role="status">Connect your wallet to continue.</p></div><small class="claim-gas-note">Network fee applies.</small>
<p class="claim-result" data-creator-status role="status"></p>
<details class="claim-advanced"><summary>Advanced options</summary>
<div class="field"><label for="creator-epoch">Beneficiary version</label><input id="creator-epoch" data-creator-epoch type="number" min="1" step="1" inputmode="numeric"><small>Past revenue stays with the beneficiary recorded for that version.</small><button type="button" data-creator-current>Use current version</button></div>
<div class="field"><label>Current beneficiary</label><output data-creator-current-beneficiary>—</output></div>
<button type="button" disabled class="action-button" data-reward-action="claimCreatorRaw">Claim original tokens</button>
            <details class="subsection reward-details">
              <summary>Original-token fallback</summary>
              <div class="details-content">
                <h3>Creator fallback</h3>
                <p>If conversion cannot complete, request original-token access. The 7-day wait applies to both reward roles in this market.</p>
                <div style="display:grid;gap:10px;margin:12px 0">
                  <button type="button" disabled class="action-button" data-reward-action="requestCreatorRawExit">Request original tokens</button>
                  <button type="button" disabled class="action-button" data-reward-action="cancelCreatorRawExit">Resume automatic conversion</button>
                </div>
              </div>
            </details>
            <p class="role-copy fallback-status" data-creator-conversion-status aria-live="polite">Conversion status unavailable</p>
            <details class="subsection reward-details">
              <summary>Beneficiary transfer controls</summary>
              <div class="details-content">
              <p>Nominate a wallet first. Future revenue changes only when that wallet accepts; past earnings remain with the previous beneficiary.</p><p data-creator-pending-beneficiary aria-live="polite">Load a market to view its pending handoff.</p><button type="button" disabled class="action-button" data-reward-action="acceptCreatorRevenueBeneficiary">Accept as new beneficiary</button><button type="button" disabled class="action-button" data-reward-action="cancelCreatorRevenueBeneficiaryTransfer">Cancel nomination</button>
              <form class="reward-form" name="transferCreatorRevenueBeneficiary" data-reward-form="transferCreatorRevenueBeneficiary">
                <h3>Transfer future beneficiary</h3>
                <p>Only the current creator beneficiary may transfer future creator revenue. The runtime must confirm that caller before enabling this action.</p>
                <div class="field"><label for="new-creator-beneficiary">New beneficiary address</label><input id="new-creator-beneficiary" name="newBeneficiary" data-creator-new-beneficiary type="text" placeholder="Wallet address" autocomplete="off" pattern="0x[0-9a-fA-F]{40}" required></div>
                <button type="button" disabled class="action-button" data-reward-action="transferCreatorRevenueBeneficiary" data-action="transferCreatorRevenueBeneficiary">Nominate beneficiary</button>
              </form>
              </div>
            </details>
</details>
</section>
      <section class="rewards-panel" role="tabpanel" id="rewards-panel-treasury" aria-labelledby="rewards-tab-treasury" data-rewards-panel="treasury" hidden>
        <div class="holder-content">
          <div class="rewards-panel-head">
              <div><h2>Holder rewards</h2><p>Hold tokens and earn rewards. Select a market to view the amount currently claimable.</p></div>
            </div>
            <p class="role-copy tab-action-help" data-holder-action-help aria-live="polite">Connect a wallet and choose a market to enable holder actions.</p>
            <div class="fields">
              <div class="field"><label for="treasury-market">Select token</label><select id="treasury-market" name="marketId" data-treasury-market><option value="">Select a configured market</option></select></div>
              <div class="field" data-legacy-treasury><label for="treasury-epoch">Reward cycle</label><input id="treasury-epoch" name="epoch" data-treasury-epoch type="number" min="1" step="1" placeholder="Current cycle" inputmode="numeric"><small>Defaults to the latest completed cycle, when available. Choose an earlier cycle to claim past rewards.</small></div>
            </div>
            <div data-continuous-treasury hidden>
              <div class="reward-data-grid"><div class="reward-data"><small>Currently claimable</small><output data-continuous-claimable aria-live="polite">—</output></div><div class="reward-data"><small>Release schedule</small><output>Released continuously over 24 hours</output></div></div>
              <p data-continuous-release></p><p data-continuous-funding></p><p>Pending collection → pending swap → releasing → claimable. The 24-hour period starts when funds are actually injected; transaction time and injection time may differ.</p><p class="role-copy" data-continuous-unswept>—</p><p class="role-copy" data-continuous-status></p>
              <p class="role-copy" data-continuous-pending></p>
              <p class="role-copy">New purchases participate only in rewards released after the purchase. Transfers do not affect rewards already earned. No staking is required; network gas is paid when claiming.</p>
              <button type="button" disabled class="action-button" data-reward-action="claimContinuous">Claim rewards</button>
            </div>
            <div data-legacy-treasury>
            <div class="reward-data-grid" aria-label="Holder reward cycle status">
              <div class="reward-data"><small>Status</small><output data-treasury-status aria-live="polite">Locked</output></div>
              <div class="reward-data"><small>Reward cycle</small><output data-treasury-epoch-id>—</output></div>
              <div class="reward-data"><small>Available to claim</small><output data-treasury-claimable>Unavailable</output></div>

            </div>
            <p class="locked-note" data-treasury-status-note aria-live="polite"><i class="ph ph-lock-key" aria-hidden="true"></i><span>Choose a market to see this cycle’s distribution status and your reward eligibility.</span></p>

            <div class="subsection">
              <form class="reward-form" name="claim" data-reward-form="claim">
                <p>Your eligibility is checked automatically. Rewards are paid in the paired asset to your wallet.</p>
                <button type="button" disabled class="action-button" data-reward-action="claim" data-action="claim">Claim holder rewards</button>
              </form>
            </div>

<details class="claim-advanced"><summary>Advanced options</summary>                <details class="reward-details proof-details"><summary>Distribution verification details</summary><div class="details-content"><div class="reward-data-grid"><div class="reward-data"><small>Merkle Root</small><output data-treasury-root>—</output></div><div class="reward-data"><small>Root service fee</small><output data-treasury-fee>Unavailable</output></div><div class="reward-data"><small>Proof source</small><output data-treasury-proof>Unavailable</output></div></div><div class="fields">
                  <div class="field"><label for="claim-leaf-index">Leaf index</label><input id="claim-leaf-index" name="leafIndex" data-treasury-leaf-index type="number" min="0" step="1" placeholder="Proof API value" inputmode="numeric" readonly></div>
                  <div class="field"><label for="claim-account">Leaf account (fixed recipient)</label><input id="claim-account" name="account" data-treasury-leaf-account type="text" placeholder="Proof API value" autocomplete="off" readonly></div>
                  <div class="field"><label for="claim-twab">TWAB numerator</label><input id="claim-twab" name="twab" data-treasury-twab type="number" min="0" step="1" placeholder="Proof API value" inputmode="numeric" readonly></div>
                  <div class="field"><label for="claim-amount">Quote amount</label><input id="claim-amount" name="amount" data-treasury-claim-amount type="number" min="0" step="any" placeholder="Proof API value" readonly></div>
                  <div class="field full"><label for="claim-proof">Merkle proof</label><textarea id="claim-proof" name="proof" class="proof-box" data-treasury-proof-input placeholder="Proof API value" spellcheck="false" readonly></textarea></div>
                </div></div></details>
            <details class="subsection reward-details">
              <summary>Request a Root</summary>
              <div class="details-content">
              <form class="reward-form" name="requestRoot" data-reward-form="requestRoot">
                <h3>Request a Root</h3>
                <p>The platform may trigger a Root after the epoch closes and the finality delay passes. After one additional publication window, the existing permissionless workflow may also allow a request. A reviewed zero-eligibility result rolls funding into the same market’s current epoch. The configured service fee may be native currency or an ERC-20; ERC-20 requests require allowance before signing.</p>
                <div class="fields">
                  <div class="field"><label for="root-service-fee-asset">Service fee asset</label><output id="root-service-fee-asset" data-treasury-fee-asset>Locked — live configuration required</output></div>
                  <div class="field"><label for="root-service-fee-allowance">ERC-20 allowance</label><output id="root-service-fee-allowance" data-treasury-fee-allowance>Locked — live allowance required</output></div>
                </div>
                <button type="button" disabled class="action-button" data-reward-action="requestRoot" data-action="requestRoot">Request Root</button>
              </form>
              </div>
            </details>

            <details class="subsection reward-details">
              <summary>Permissionless epoch actions</summary>
              <div class="details-content">
              <h3>Permissionless epoch actions</h3>
              <p>These actions can move the configured Root state forward after the relevant time condition. Runtime checks must remain authoritative.</p>
              <div class="form-actions">
                <button type="button" disabled class="action-button" data-reward-action="finalizeRoot" data-action="finalizeRoot">Finalize Root</button>
                <button type="button" disabled class="action-button" data-reward-action="expireRootRequest" data-action="expireRootRequest">Expire Root request</button>
                <button type="button" disabled class="action-button" data-reward-action="rolloverExpiredEpoch" data-action="rolloverExpiredEpoch">Rollover expired epoch</button>
              </div>
              </div>
            </details>

            <details class="subsection reward-details"><summary>Service fee refunds</summary>
              <form class="reward-form" name="withdrawServiceCredit" data-reward-form="withdrawServiceCredit">
                <h3>Withdraw Root service credit</h3>
                <p>If a Root request expires or is rejected, its requester receives a pull-based refund credit. Enter the original fee asset; use the zero address for native ETH. Funds can only be paid to the connected credit beneficiary.</p>
                <div class="fields">
                  <div class="field"><label for="treasury-service-credit-asset">Credit asset</label><input id="treasury-service-credit-asset" name="serviceCreditAsset" data-treasury-service-credit-asset type="text" inputmode="text" autocomplete="off" placeholder="0x…; zero address for native ETH" pattern="0x[0-9a-fA-F]{40}" required></div>
                  <div class="field"><label for="treasury-service-credit">Available credit</label><output id="treasury-service-credit" data-treasury-service-credit>Locked — live credit required</output></div>
                </div>
                <button type="button" disabled class="action-button" data-reward-action="withdrawServiceCredit" data-action="withdrawServiceCredit">Withdraw service credit</button>
              </form>
            </details>

            <details class="subsection" data-treasury-advanced>
              <summary style="cursor:pointer;font-weight:800">Protocol integration boundary</summary>
              <p style="margin-top:12px">Funding the Quote distribution balance and burning Ticker Meme belong to the protocol integration runtime. They are intentionally absent from the holder interface and cannot be submitted from this page.</p>
            </details>
</details>
            </div>
          <details class="treasury-side" data-legacy-treasury><summary>About reward distribution</summary>
            <div class="kicker"><i class="ph ph-shield-check" aria-hidden="true"></i>Reward delivery</div>
            <p class="role-copy" style="margin-top:16px">The platform prepares each distribution and an independent reviewer checks it. Once finalized, eligible holders can claim. You do not need to publish or review a distribution.</p>
            <div class="preview-list" style="margin-top:18px"><div><span>Root publisher</span><strong>Platform role only</strong></div><div><span>Pending-root reviewer</span><strong>Reviewer role only</strong></div><div><span>Holder recipient</span><strong data-treasury-recipient>Leaf account only</strong></div></div>
          </details>
        </div>
      </section>

<div class="claim-connection"><span data-rewards-status role="status"></span><button type="button" data-rewards-connect>Connect wallet</button><button type="button" data-rewards-refresh aria-label="Refresh rewards"><i class="ph ph-arrows-clockwise" aria-hidden="true"></i>Refresh</button></div>
<div data-claim-market-lookup></div><p data-rewards-action-status role="status"></p><p data-rewards-empty hidden>No tokens loaded yet. <a href="/explore">Explore tokens</a> or <a href="/create">create a token</a>.</p>
</div></div></main>`};
