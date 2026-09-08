export default { title: 'Stake — TickerGarden', html: `
<main class="page staking-page">
  <div class="stake-runtime"><span data-rewards-status role="status"></span><button type="button" data-rewards-refresh>Refresh balances</button><button type="button" data-rewards-connect>Connect wallet</button><span data-rewards-action-status role="status"></span><span data-rewards-empty hidden>No markets loaded yet. <a href="/explore">Explore tokens</a>.</span></div>
  <aside class="stake-sidebar">
    <h1>My markets</h1>
    <label class="search-field"><i class="ph ph-magnifying-glass" aria-hidden="true"></i><input data-position-search type="search" aria-label="Search staking markets" placeholder="Search markets…" autocomplete="off"></label>
    <small data-position-search-status></small>
    <div data-stake-my-markets>Connect a wallet to view your markets.</div>
    <p data-stake-history-status aria-live="polite"></p>
    <button type="button" data-stake-history-more hidden>Load more records</button>
    <div data-claim-market-lookup></div>
  </aside>
  <section class="stake-content" data-rewards-panel="positions" aria-label="Market staking">
    <button type="button" data-rewards-tab="positions" hidden>Positions</button>
    <div class="stake-toolbar"><span>Stake Stock</span><i class="ph ph-caret-right" aria-hidden="true"></i><strong data-stake-market-title>Select a market</strong><select data-position-market aria-label="Select staking market"><option value="">Select a market</option></select></div>
    <article class="market-card">
      <div class="market-card-head"><span class="token-mark"><i class="ph ph-leaf" aria-hidden="true"></i></span><div><h2 data-stake-market-title>Select a market</h2><p data-stake-market-description>Choose a market to see its staking activity.</p></div><span class="phase-pill" data-stake-phase>—</span></div>
      <div class="market-stats">
        <div><span>24H volume</span><strong data-stake-volume>Unavailable</strong></div>
        <div><span>Total fees</span><strong data-stake-fees>Unavailable</strong><small>Cumulative allocated fees</small></div>
        <div><span>Total staked</span><strong data-stake-total>Unavailable</strong><small>Active + pending stake</small></div>
      </div>
      <p class="status-line" data-stake-stats-status aria-live="polite">Search or select a market to get started.</p>
    </article>
    <article class="position-card">
      <div class="section-heading"><div><h2>Your stake</h2><p>Stake Stock to earn a share of trading fees.</p></div><button type="button" class="primary-button" data-open-stake><i class="ph ph-plus" aria-hidden="true"></i> Add stake</button></div>
      <div class="position-stats"><div><span>Wallet available</span><strong data-stake-wallet>Unavailable</strong></div><div><span>Your stake</span><strong data-stake-allocated>Unavailable</strong></div><div><span>Status</span><strong data-stake-unlock>Unavailable</strong></div></div>
      <div class="rewards-card">
        <h2>Staking rewards</h2>
        <div class="reward-values"><div><span>Claimable</span><strong data-staker-claimable="quote">Unavailable</strong></div><div><span>Awaiting conversion</span><strong data-staker-claimable="meme">Unavailable</strong></div></div>
        <div class="reward-actions"><button type="button" disabled class="primary-button" data-reward-action="claimStaker" data-action="claimStaker" data-reward-asset="quote">Claim rewards</button><button type="button" disabled class="link-button" data-reward-action="unstakeAndWithdraw" data-action="unstakeAndWithdraw">Unstake all</button></div>
        <p data-staker-action-help aria-live="polite">Connect a wallet and choose a market.</p>
        <p data-unstake-preview aria-live="polite">Full withdrawals only. Earned rewards remain claimable.</p>
      </div>
    </article>
    <details class="advanced-section"><summary>Original-token rewards</summary><div class="advanced-body">
      <p>If conversion cannot complete, request original tokens. The 7-day wait and existing claim locks apply.</p>
      <p data-staker-conversion-status aria-live="polite">Choose a market to view conversion status.</p>
      <button type="button" disabled data-reward-action="requestStakerRawExit">Request original tokens</button>
      <button type="button" disabled data-reward-action="cancelStakerRawExit">Resume automatic conversion</button>
      <button type="button" disabled data-reward-action="claimStaker" data-reward-asset="meme">Claim original tokens</button>
    </div></details>
    <details class="advanced-section" data-emergency-recovery><summary>Emergency recovery</summary><div class="advanced-body">
      <form name="rageQuit" data-reward-form="rageQuit"><h3>Immediate escape</h3><p>Return your full principal without waiting for the lock. All unclaimed rewards are forfeited to the platform. Stock token transfer restrictions may prevent an exit.</p><p data-ragequit-estimate>Load a position to see principal and estimated forfeited rewards.</p><button type="button" disabled data-reward-action="rageQuit" data-action="rageQuit" data-reward-route="allocation-manager">Rage quit position</button></form>
      <form name="directVaultRageQuit" data-reward-form="directVaultRageQuit"><h3>Direct vault escape</h3><p>Recover principal independently of market data and rewards. Bindings are verified before signing; Stock token transfer restrictions still apply.</p><label for="direct-vault-market-id">Canonical market ID</label><input id="direct-vault-market-id" name="marketId" data-direct-vault-market placeholder="0x…" autocomplete="off" pattern="0x[0-9a-fA-F]{64}" required><label>Verified Stock asset</label><output data-direct-vault-asset>—</output><label>Allocated principal</label><output data-direct-vault-principal>—</output><p data-direct-vault-status role="status">Connect a wallet and enter a market ID.</p><button type="button" disabled data-reward-action="directVaultRageQuit" data-action="directVaultRageQuit">Direct vault rage quit</button></form>
      <form name="settleRageQuitRewards" data-reward-form="settleRageQuitRewards"><h3>Settle forfeited rewards</h3><p>Retry reward cleanup after principal has been returned. This never returns principal a second time.</p><label for="settle-market">Market</label><select id="settle-market" name="marketId" data-settle-market required><option value="">Use selected market</option></select><label for="settle-user">Position owner</label><input id="settle-user" name="user" data-settle-user placeholder="0x…" autocomplete="off" pattern="0x[0-9a-fA-F]{40}" required><button type="button" disabled data-reward-action="settleRageQuitRewards" data-action="settleRageQuitRewards">Settle rage-quit rewards</button></form>
    </div></details>
  </section>
  <dialog data-stake-dialog aria-labelledby="stake-dialog-title"><form class="stake-dialog-form" data-reward-form="stake">
    <button type="button" class="dialog-close" data-close-stake aria-label="Close add stake"><i class="ph ph-x" aria-hidden="true"></i></button>
    <h2 id="stake-dialog-title">Add stake</h2>
    <div class="dialog-market"><span class="token-mark"><i class="ph ph-leaf" aria-hidden="true"></i></span><div><strong data-stake-modal-market>Select a market</strong><span>Staking asset <img data-stake-stock-icon hidden width="20" height="20" alt=""><b data-stake-modal-stock>—</b></span></div><span class="phase-pill" data-stake-phase>—</span></div>
    <div class="dialog-balance"><span>Wallet balance</span><strong data-stake-modal-wallet>Unavailable</strong></div>
    <label for="stake-amount">Amount</label><div class="amount-row"><div class="amount-field"><input id="stake-amount" name="amount" data-reward-amount type="text" inputmode="decimal" autocomplete="off" placeholder="0" aria-describedby="stake-preview" required><span data-stake-modal-stock>—</span></div><button type="button" data-stake-max>Max</button></div>
    <div class="after-stake"><div><span>Currently staked</span><strong data-stake-modal-current>Unavailable</strong></div><div><span>After staking</span><strong data-stake-modal-after>—</strong></div></div>
    <p id="stake-preview" data-stake-preview aria-live="polite">Enter an amount to preview your position.</p>
    <div class="lock-notice"><i class="ph ph-warning-circle" aria-hidden="true"></i><span>Adding stake restarts the 24-hour lock for your entire position. Normal reward claims are locked too.</span></div><p class="activation-note">New stake starts earning after 30 seconds.</p>
    <p data-stake-transaction-status role="status" aria-live="polite"></p>
    <button type="button" disabled class="primary-button dialog-submit" data-reward-action="stake" data-action="stake">Review stake</button><button type="button" class="secondary-button" data-close-stake>Cancel</button><small>Approval may be required · Network fee applies</small>
  </form></dialog>
</main>` };
