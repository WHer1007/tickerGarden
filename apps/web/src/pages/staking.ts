export default { title: 'Stake — TickerGarden', html: `
<main class="page staking-page">

  <aside class="stake-sidebar">
    <h1>My markets</h1>
    <div data-stake-my-markets></div>
    <button type="button" data-stake-history-more hidden>Load more records</button>
    <div data-claim-market-lookup></div>
  </aside>
  <section class="stake-content" data-rewards-panel="positions" aria-label="Market staking">
    <button type="button" data-rewards-tab="positions" hidden>Positions</button>
    <div class="stake-toolbar"><div class="stake-market-search"><label class="search-field"><i class="ph ph-magnifying-glass" aria-hidden="true"></i><input data-position-search type="search" aria-label="Search staking markets" placeholder="Search markets…" autocomplete="off" aria-controls="stake-search-results" aria-expanded="false"></label><div id="stake-search-results" data-stake-search-results role="listbox" aria-label="Matching markets" hidden></div></div><select data-position-market aria-label="Selected staking market" hidden><option value="">Select a market</option></select></div>
    <article class="market-card">
      <div class="market-card-head"><span class="token-mark stake-token-mark"><img data-stake-token-logo alt="" hidden></span><div><div class="stake-market-title-row"><h2 data-stake-market-title>Select a market</h2><button type="button" class="stake-token-details" data-stake-token-details hidden aria-label="View token details" title="View token"><i class="ph ph-arrow-up-right" aria-hidden="true"></i></button></div><p class="stake-market-subtitle"><span data-stake-market-description>Choose a market to see its staking activity.</span><span class="stake-quote-asset" data-stake-quote-asset hidden><img data-stake-quote-icon width="16" height="16" alt="" hidden><span data-stake-quote-symbol></span></span></p></div><span class="phase-pill" data-stake-phase>-</span></div>
      <div class="market-stats">
        <div><span>24H volume</span><strong data-stake-volume>-</strong></div>
        <div><span>Total fees</span><strong data-stake-fees>-</strong><small>Cumulative allocated fees</small></div>
        <div><span>Total staked</span><strong data-stake-total>-</strong><small>Active + pending stake</small></div>
      </div>
      <p class="status-line" data-stake-stats-status aria-live="polite">Search or select a market to get started.</p>
    </article>
    <article class="position-card"><p data-rewards-action-status role="status"></p>
      <div class="section-heading"><div><h2>Your stake</h2><p>Stake Stock to earn a share of trading fees.</p></div><button type="button" class="primary-button" data-open-stake><i class="ph ph-plus" aria-hidden="true"></i> Add stake</button></div>
      <div class="position-stats"><div><span>Wallet available</span><strong data-stake-wallet>-</strong></div><div><span>Staked principal</span><strong data-stake-allocated>-</strong><small class="stake-share">Share of total <b data-stake-share>-</b></small><small data-stake-active-breakdown>Active + pending stake</small></div><div><span>Status</span><strong data-stake-unlock>-</strong><small data-stake-unlock-at></small></div></div>
    <div class="rewards-card">
        <h2>Staking rewards</h2><p>Rewards are paid in the original Quote and Meme assets; conversion is never automatic.</p>
        <div class="reward-values"><div><span>Available to claim</span><strong data-staker-claimable="quote">-</strong><small data-staker-locked-note></small></div><div><span>Meme rewards</span><strong data-staker-claimable="meme">-</strong></div><div><span>Total earned</span><strong data-staker-earned>-</strong><small title="Claimed and unclaimed rewards. Excludes forfeited rewards.">Claimed + Unclaimed</small></div><div><span>Total claimed</span><strong data-staker-claimed>-</strong></div></div>
        <div class="reward-actions"><button type="button" disabled class="primary-button" data-reward-action="claimStaker" data-action="claimStaker" data-reward-asset="quote">Claim rewards</button><button type="button" disabled class="link-button" data-reward-action="unstakeAndWithdraw" data-action="unstakeAndWithdraw">Unstake all</button></div>
        <p data-staker-action-help aria-live="polite">Connect a wallet and choose a market. Staking rewards use the separate 24-hour lock.</p>
        <p data-unstake-preview aria-live="polite">Full withdrawals only. Earned rewards remain claimable.</p>
      </div>
    </article>


  </section>
  <dialog data-stake-dialog aria-labelledby="stake-dialog-title"><form class="stake-dialog-form" data-reward-form="stake">
    <button type="button" class="dialog-close" data-close-stake aria-label="Close add stake"><i class="ph ph-x" aria-hidden="true"></i></button>
    <h2 id="stake-dialog-title">Add stake</h2>
    <div class="dialog-market"><span class="token-mark stake-token-mark"><img data-stake-token-logo alt="" hidden></span><div><strong data-stake-modal-market>Select a market</strong><span>Staking asset <img data-stake-stock-icon hidden width="20" height="20" alt=""><b data-stake-modal-stock>-</b></span></div><span class="phase-pill" data-stake-phase>-</span></div>
    <div class="dialog-balance"><span>Wallet balance</span><strong data-stake-modal-wallet>-</strong></div>
    <label for="stake-amount">Amount</label><div class="amount-row"><div class="amount-field"><input id="stake-amount" name="amount" data-reward-amount type="text" inputmode="decimal" autocomplete="off" placeholder="0" aria-describedby="stake-preview" required><span data-stake-modal-stock>-</span></div><button type="button" data-stake-max>Max</button></div>
    <p id="stake-preview" data-stake-preview aria-live="polite">Enter an amount to preview your position.</p>
    <div class="after-stake"><div><span>Currently staked</span><strong data-stake-modal-current>-</strong></div><div><span>After staking</span><strong data-stake-modal-after>-</strong></div></div>
    <div class="lock-notice"><i class="ph ph-warning-circle" aria-hidden="true"></i><span data-stake-modal-relock hidden>Adding stake restarts the full 24-hour lock. Rewards unlock at the same time.</span><span data-stake-modal-unlock>Expected unlock: —</span></div><p class="activation-note">New stake starts earning after 30 seconds.</p>
    <p data-stake-transaction-status role="status" aria-live="polite"></p>
    <button type="button" disabled class="primary-button dialog-submit" data-reward-action="stake" data-action="stake">Stake</button><button type="button" class="secondary-button" data-close-stake>Cancel</button><small>Approval may be required · Network fee applies</small>
  </form></dialog>
</main>` };
