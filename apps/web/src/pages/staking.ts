export default {title: 'Stake — TickerGarden', html: `
<main class="page staking-page"><header class="staking-heading"><h1>Stake Stock</h1><p>Manage your positions and collect staking rewards.</p><a href="/claim">Creator &amp; holder rewards <i class="ph ph-arrow-up-right" aria-hidden="true"></i></a></header>
<div class="stake-runtime"><span data-rewards-status role="status"></span><button type="button" data-rewards-refresh>Refresh balances</button><button type="button" data-rewards-connect>Connect wallet</button><span data-rewards-action-status role="status"></span><span data-rewards-empty hidden>No markets loaded yet. <a href="/explore">Explore tokens</a>.</span></div>
<section class="panel"><nav class="rewards-tabs" role="tablist" aria-label="Staking functions">
<button type="button" role="tab" id="rewards-tab-positions" aria-selected="true" aria-controls="rewards-panel-positions" data-rewards-tab="positions">Positions</button>
<button type="button" role="tab" id="rewards-tab-staker" aria-selected="false" aria-controls="rewards-panel-staker" data-rewards-tab="staker">Staking rewards</button>
<button type="button" role="tab" id="rewards-tab-activity" aria-selected="false" aria-controls="rewards-panel-activity" data-rewards-tab="activity">Activity</button>
</nav>      <section class="rewards-panel" role="tabpanel" id="rewards-panel-activity" aria-labelledby="rewards-tab-activity" data-rewards-panel="activity" hidden>
        <div class="rewards-panel-head"><div><h2>Wallet activity</h2><p>Finalized protocol events that reference your wallet. A listed role does not mean you initiated the transaction. Amounts in event details use raw contract units.</p></div></div>
        <div data-user-activity></div>
      </section>

      <section class="rewards-panel" role="tabpanel" id="rewards-panel-positions" aria-labelledby="rewards-tab-positions" data-rewards-panel="positions">
        <div class="rewards-panel-head">
          <div>
            <h2>Positions</h2>
            <p>Search for a market, choose your STOCK amount and stake. Manage your position and return unlocked principal directly to your wallet.</p>
          </div>
          <div class="field" style="min-width:min(100%,280px)">
            <label for="position-market-search">Search markets</label>
            <input id="position-market-search" type="search" data-position-search placeholder="Token symbol, name or market ID" autocomplete="off" aria-controls="position-market">
            <small data-position-search-status aria-live="polite"></small>
            <label for="position-market">Market</label>
            <select id="position-market" name="marketId" data-position-market aria-describedby="position-market-help">
              <option value="">Select a configured market</option>
            </select>
            <small id="position-market-help">Only markets with Stock staking enabled are listed.</small>
          </div>
        </div>
        <h3>Vault balances across assets</h3>
        <p class="locked-note" data-account-balances aria-live="polite">Connect a wallet to view finalized Vault balances.</p>
        <p class="locked-note" data-position-summary aria-live="polite"><i class="ph ph-lock-key" aria-hidden="true"></i><span>Select a market to view your staked balance and unlock time.</span></p>

        <div class="reward-forms" style="margin-top:18px">
          <form class="reward-form" name="stake" data-reward-form="stake">
            <h3>Stake STOCK</h3>
            <p>Stake directly from your wallet into this market. New stake starts earning after 30 seconds. Every addition restarts the 24-hour lock for your entire position and normal reward claims.</p>
            <div class="field"><label for="stake-amount">STOCK amount</label><input id="stake-amount" name="amount" data-reward-amount type="text" inputmode="decimal" placeholder="0.0" autocomplete="off" required></div>
            <p data-stake-preview aria-live="polite">Enter an amount to preview your position.</p>
            <p>A token approval may be requested first; staking itself is one transaction.</p>
            <button type="button" disabled class="action-button" data-reward-action="stake" data-action="stake">Stake STOCK</button>
          </form>
          <form class="reward-form" name="unstakeAndWithdraw" data-reward-form="unstakeAndWithdraw">
            <h3>Unstake to wallet</h3>
            <p>After the lock expires, return your full staked STOCK to your wallet in one transaction. Earned rewards stay available in Staker rewards. Partial withdrawals are not supported.</p>
            <p data-unstake-preview aria-live="polite">Select a market to view your unlock time.</p>
            <button type="button" disabled class="action-button" data-reward-action="unstakeAndWithdraw" data-action="unstakeAndWithdraw">Unstake all to wallet</button>
          </form>
          <form class="reward-form danger-panel" name="rageQuit" data-reward-form="rageQuit">
            <h3><i class="ph ph-warning" aria-hidden="true"></i> Immediate escape</h3>
            <p class="danger-copy">Rage quit exits your own principal without the normal lock or market-phase restriction, provided the STOCK token transfers successfully and exactly. All unclaimed rewards are forfeited to the platform; token pause or blacklist rules can cause the exit to revert.</p>
            <p data-ragequit-estimate>Load a verified position to see principal and estimated forfeited rewards.</p>
            <button type="button" disabled class="action-button danger-button" data-reward-action="rageQuit" data-action="rageQuit" data-reward-route="allocation-manager">Rage quit position</button>
          </form>
        </div>

        <details class="subsection" data-emergency-recovery>
          <summary>Advanced emergency recovery</summary>
        <div class="subsection">
          <h3>Direct vault escape</h3>
          <p>This independent on-chain route does not depend on the read API, market phase, Gauge, rewards, lock time, or asset admission status. Principal transfer must still succeed exactly; STOCK issuer pause or blacklist rules may cause a revert. Enter the canonical marketId; Factory, Registry, assetUid and Vault bindings are derived and verified directly on Robinhood Chain before signing.</p>
          <form class="reward-form danger-panel" name="directVaultRageQuit" data-reward-form="directVaultRageQuit">
            <div class="fields">
              <div class="field full"><label for="direct-vault-market-id">Canonical marketId</label><input id="direct-vault-market-id" name="marketId" data-direct-vault-market type="text" inputmode="text" autocomplete="off" placeholder="0x followed by 64 hexadecimal characters" pattern="0x[0-9a-fA-F]{64}" aria-describedby="direct-vault-help" required></div>
              <div class="field"><label for="direct-vault-asset-uid">Derived assetUid</label><output id="direct-vault-asset-uid" data-direct-vault-asset>—</output></div>
              <div class="field"><label for="direct-vault-principal">Allocated principal</label><output id="direct-vault-principal" data-direct-vault-principal>—</output></div>
            </div>
            <p id="direct-vault-help" data-direct-vault-status role="status" aria-live="polite">Connect a wallet and enter a marketId to verify the independent principal route.</p>
            <button type="button" disabled class="action-button danger-button" data-reward-action="directVaultRageQuit" data-action="directVaultRageQuit" aria-describedby="direct-vault-help">Direct vault rage quit</button>
          </form>
        </div>

        <div class="subsection">
          <h3>Settle forfeited rewards</h3>
          <p>Permissionless cleanup retries the reward settlement after principal has already been returned. It never transfers principal a second time.</p>
          <form class="reward-form" name="settleRageQuitRewards" data-reward-form="settleRageQuitRewards">
            <div class="fields">
              <div class="field"><label for="settle-market">Market</label><select id="settle-market" name="marketId" data-settle-market required><option value="">Use selected market</option></select></div>
              <div class="field"><label for="settle-user">Position owner</label><input id="settle-user" name="user" data-settle-user type="text" placeholder="Wallet address" autocomplete="off" pattern="0x[0-9a-fA-F]{40}" required></div>
            </div>
            <button type="button" disabled class="action-button" data-reward-action="settleRageQuitRewards" data-action="settleRageQuitRewards">Settle rage-quit rewards</button>
          </form>
        </div>
        </details>
      </section>

      <section class="rewards-panel" role="tabpanel" id="rewards-panel-staker" aria-labelledby="rewards-tab-staker" data-rewards-panel="staker" hidden>
        <div class="rewards-panel-head">
          <div>
            <h2>Staker rewards</h2>
            <p>Collect trading-fee rewards for your staked Stock. Token rewards are automatically converted to the paired asset.</p>
          </div>
          <div class="field staker-market-field">
            <label for="staker-market">Market</label>
            <select id="staker-market" name="marketId" data-staker-market aria-describedby="staker-market-help"><option value="">Select a configured market</option></select>
            <small id="staker-market-help">Choose a market to load live staker rewards.</small>
          </div>
        </div>
        <p class="role-copy tab-action-help" data-staker-action-help aria-live="polite">Connect a wallet and choose a market to enable staker actions.</p>
        <div class="locked-note" data-staker-status aria-live="polite"><i class="ph ph-lock-key" aria-hidden="true"></i><span>Choose a market to view claimable rewards.</span></div>
        <div class="reward-cards" data-staker-rewards aria-live="polite" style="margin-top:18px">
          <article class="reward-card" data-staker-reward="quote">
            <div class="garden-head"><span class="token-mark lime"><i class="ph ph-coins" aria-hidden="true"></i></span><div><h3>Settled</h3><small>Paid in this market’s paired asset</small></div></div>
            <div class="claimable" data-staker-claimable="quote">Unavailable</div>
            <button type="button" disabled class="action-button" data-reward-action="claimStaker" data-action="claimStaker" data-reward-asset="quote">Claim rewards</button>
          </article>
          <article class="reward-card" data-staker-reward="meme">
            <div class="garden-head"><span class="token-mark coral"><i class="ph ph-arrows-left-right" aria-hidden="true"></i></span><div><h3>Pending conversion</h3><small>Automatically converted to the market paired asset</small></div></div>
            <div class="claimable" data-staker-claimable="meme">Unavailable</div>
            <p class="role-copy">Estimated conversion value is not guaranteed.</p>
            <button type="button" disabled class="action-button" data-reward-action="claimStaker" data-action="claimStaker" data-reward-asset="meme">Claim original tokens</button>
          </article>
        </div>
        <details class="subsection reward-details">
          <summary>Original-token fallback</summary>
          <div class="details-content">
          <h3>Staker fallback</h3>
          <p>If conversion cannot complete, request original-token access. The 7-day wait and existing claim locks apply.</p>
          <div style="display:grid;gap:10px;margin:12px 0">
          <button type="button" disabled class="action-button" data-reward-action="requestStakerRawExit">Request original tokens</button>
          <button type="button" disabled class="action-button" data-reward-action="cancelStakerRawExit">Resume automatic conversion</button>
          </div>
          </div>
        </details>
        <p class="role-copy fallback-status" data-staker-conversion-status aria-live="polite">Conversion status unavailable</p>
        <p class="locked-note" style="margin-top:18px"><i class="ph ph-info" aria-hidden="true"></i><span>Claiming settled staker rewards does not end or close your position.</span></p>
      </section>

</section></main>`};
