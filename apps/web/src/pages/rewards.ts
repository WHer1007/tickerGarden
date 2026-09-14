export default { title: 'Claim — TickerGarden', html: `
<main class="page claim-page" aria-label="Claim rewards">
<div class="claim-workspace">
<nav class="rewards-tabs claim-tabs" role="tablist" aria-label="Reward roles" aria-orientation="vertical">
<button type="button" role="tab" id="rewards-tab-creator" aria-selected="true" aria-controls="rewards-panel-creator" data-rewards-tab="creator"><i class="ph ph-user" aria-hidden="true"></i>Creator</button>
<button type="button" role="tab" id="rewards-tab-treasury" aria-selected="false" aria-controls="rewards-panel-treasury" data-rewards-tab="treasury"><i class="ph ph-users" aria-hidden="true"></i>Holder</button>
</nav>
<div class="claim-content">
<section class="rewards-panel" role="tabpanel" id="rewards-panel-creator" aria-labelledby="rewards-tab-creator" data-rewards-panel="creator">
<header class="claim-card-heading"><div><h2>Creator rewards</h2></div></header>
<div class="field"><label for="creator-market">Select token</label><div class="claim-token-select"><i class="ph ph-coins" aria-hidden="true"></i><select id="creator-market" data-creator-market><option value="">Select a token</option></select></div></div>
<div class="claim-amounts"><div><span>Available to claim</span><strong data-creator-quote-asset>-</strong></div><div><span>Token rewards</span><strong data-creator-pending-meme>-</strong></div></div>
<dl class="claim-facts"><div><dt>Receive in</dt><dd data-creator-receive-asset>-</dd></div><div><dt>Recipient</dt><dd><span data-creator-beneficiary>-</span><button type="button" data-copy-beneficiary aria-label="Copy recipient address" disabled><i class="ph ph-copy" aria-hidden="true"></i></button></dd></div></dl>
<input type="hidden" data-creator-fee-asset>
<div class="claim-action"><button type="button" class="action-button" data-rewards-connect><i class="ph ph-wallet" aria-hidden="true"></i> Connect wallet</button><button type="button" disabled class="action-button" data-reward-action="claimCreator">Claim creator rewards</button></div>
<p class="claim-result" data-creator-status role="status"></p>
<input type="hidden" data-creator-epoch>

</section>
      <section class="rewards-panel" role="tabpanel" id="rewards-panel-treasury" aria-labelledby="rewards-tab-treasury" data-rewards-panel="treasury" hidden>
        <div class="holder-content">
          <div class="rewards-panel-head">
              <div><h2>Holder rewards</h2><p data-holder-reward-summary>Select a token to view your available rewards.</p></div>
            </div>
            <p class="role-copy tab-action-help" data-holder-action-help aria-live="polite"></p>
            <button type="button" class="action-button" data-rewards-connect><i class="ph ph-wallet" aria-hidden="true"></i> Connect wallet</button>
            <div data-holder-recent hidden aria-hidden="true"></div>
            <div class="fields">
              <div class="field holder-token-search"><label for="holder-search">Token</label><div class="holder-token-search-control"><i class="ph ph-magnifying-glass" aria-hidden="true"></i><input id="holder-search" data-holder-search type="search" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="holder-search-results" placeholder="Search name, symbol, or address" autocomplete="off" spellcheck="false"><i class="ph ph-caret-down" aria-hidden="true"></i></div><div id="holder-search-results" class="holder-search-results" data-holder-search-results role="listbox" aria-label="Token search results" hidden></div><select id="treasury-market" name="marketId" data-treasury-market hidden aria-hidden="true"><option value="">Select a token</option></select></div>
              <input type="hidden" id="treasury-epoch" name="epoch" data-treasury-epoch>
            </div>
            <div class="holder-reward-card" data-snapshot-rewards hidden>
              <label class="field holder-round-field" for="holder-round" data-holder-round-field hidden>Distribution<select id="holder-round" data-snapshot-round disabled><option value="">No rewards available</option></select></label>
              <div class="claim-amounts"><div><span>Available to claim</span><strong data-snapshot-quote>—</strong></div><div><span>Token rewards</span><strong data-snapshot-meme>—</strong></div></div>
              <dl class="claim-facts"><div><dt>Receive in</dt><dd data-snapshot-assets>—</dd></div><div><dt>Recipient</dt><dd data-snapshot-recipient>—</dd></div></dl>
              <div class="claim-action holder-reward-actions"><button type="button" disabled class="action-button" data-reward-action="claimSnapshot"><i class="ph ph-gift" aria-hidden="true"></i> Claim rewards</button><button type="button" class="secondary-button" data-snapshot-more hidden>View older rounds</button></div>
              <p class="claim-result" data-snapshot-status role="status" aria-live="polite">Loading rewards…</p>
            </div>
            <div data-continuous-treasury hidden>
              <div class="claim-amounts"><div><span>Available to claim</span><strong data-continuous-claimable aria-live="polite">-</strong></div><div><span>Total earned</span><strong data-continuous-earned>-</strong><small>Claimed and unclaimed</small></div></div>
              <dl class="claim-facts"><div><dt>Token available</dt><dd data-continuous-meme>-</dd></div><div><dt>Total claimed</dt><dd data-continuous-claimed>-</dd></div><div><dt>Receive in</dt><dd data-continuous-asset>-</dd></div></dl>
              <details class="holder-pool-details"><summary>Market reward pool</summary><dl class="claim-facts"><div><dt>Awaiting collection</dt><dd data-continuous-unswept>-</dd></div><div><dt>Token fees awaiting funding</dt><dd data-continuous-conversion>-</dd></div><div><dt>Awaiting funding</dt><dd data-continuous-pending>-</dd></div><div><dt>Releasing</dt><dd data-continuous-release>-</dd></div><div><dt>Pending release</dt><dd data-continuous-idle>-</dd></div><div><dt>Last injection</dt><dd data-continuous-funding>-</dd></div></dl><small>Legacy market totals, not your personal rewards. This older release uses 24-hour batches.</small></details>
              <p class="role-copy" data-continuous-status></p>
              <button type="button" disabled class="action-button" data-reward-action="claimContinuous">Claim rewards</button>
            </div>
            <div data-legacy-treasury>
            <div class="reward-data-grid" aria-label="Holder reward cycle status">
              <div class="reward-data"><small>Status</small><output data-treasury-status aria-live="polite">Locked</output></div>
              <div class="reward-data"><small>Reward cycle</small><output data-treasury-epoch-id>-</output></div>
              <div class="reward-data"><small>Available to claim</small><output data-treasury-claimable>-</output></div>

            </div>
            <p class="locked-note" data-treasury-status-note aria-live="polite"><i class="ph ph-lock-key" aria-hidden="true"></i><span>Choose a market to see this cycle’s distribution status and your reward eligibility.</span></p>

            <div class="subsection">
              <form class="reward-form" name="claim" data-reward-form="claim">
                <p>Your eligibility is checked automatically. Rewards are paid in the paired asset to your wallet.</p>
                <button type="button" disabled class="action-button" data-reward-action="claim" data-action="claim">Claim holder rewards</button>
              </form>
            </div>

            </div>
        </div>
      </section>

</div></div></main>`};
