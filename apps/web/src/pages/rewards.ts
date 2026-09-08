export default {
  title: 'Claim — TickerGarden',
  html: `
<main class="page">
    <section class="reward-hero" aria-labelledby="rewards-title">
      <div>
        <div class="kicker" style="color:#bcd0c5"><i class="ph ph-sparkle" aria-hidden="true"></i>Claim</div>
        <h1 id="rewards-title">Claim</h1>
        <p>Manage your stakes, collect rewards and track creator revenue.</p>
      </div>
      <div class="rewards-runtime" data-rewards-runtime>
        <strong data-rewards-runtime-title><i class="ph ph-lock-key" aria-hidden="true"></i>Runtime locked</strong>
        <button type="button" class="runtime-refresh" data-rewards-refresh><i class="ph ph-arrows-clockwise" aria-hidden="true"></i>Refresh balances</button>
        <button type="button" class="runtime-refresh" data-rewards-connect>Connect wallet</button>
        <span data-rewards-status aria-live="polite" role="status">Wallet and runtime configuration are required. No fallback data is shown.</span>
        <span>Selected position rewards: <strong data-rewards-total>—</strong></span>
        <span data-rewards-action-status aria-live="polite" role="status"></span>
        <span data-rewards-empty hidden>No markets loaded yet. <a href="/explore">Explore tokens</a> or <a href="/create">create a token</a>.</span>
      </div>
    </section>

    <section class="panel" aria-label="Claim workspace">
      <nav class="rewards-tabs" role="tablist" aria-label="Claim functions">
        <button type="button" role="tab" id="rewards-tab-positions" aria-selected="true" aria-controls="rewards-panel-positions" data-rewards-tab="positions">Positions</button>
        <button type="button" role="tab" id="rewards-tab-staker" aria-selected="false" aria-controls="rewards-panel-staker" data-rewards-tab="staker">Staker rewards</button>
        <button type="button" role="tab" id="rewards-tab-creator" aria-selected="false" aria-controls="rewards-panel-creator" data-rewards-tab="creator">Creator</button>
        <button type="button" role="tab" id="rewards-tab-treasury" aria-selected="false" aria-controls="rewards-panel-treasury" data-rewards-tab="treasury">Holder fee sharing</button>
        <button type="button" role="tab" id="rewards-tab-activity" aria-selected="false" aria-controls="rewards-panel-activity" data-rewards-tab="activity">Activity</button>
      </nav>
      <section class="rewards-panel" role="tabpanel" id="rewards-panel-activity" aria-labelledby="rewards-tab-activity" data-rewards-panel="activity" hidden>
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

      <section class="rewards-panel" role="tabpanel" id="rewards-panel-creator" aria-labelledby="rewards-tab-creator" data-rewards-panel="creator" hidden>
        <div class="creator-layout">
          <div>
            <div class="rewards-panel-head">
              <div><h2>Creator revenue</h2><p>View creator earnings and claim them to the recorded beneficiary.</p></div>
            </div>
            <p class="role-copy tab-action-help" data-creator-action-help aria-live="polite">Connect a wallet and choose a market to enable creator actions.</p>
            <div class="fields">
              <div class="field"><label for="creator-market">Market</label><select id="creator-market" name="marketId" data-creator-market><option value="">Select a configured market</option></select></div>
              <div class="field"><label for="creator-epoch">Creator beneficiary version</label><input id="creator-epoch" name="epoch" data-creator-epoch type="number" min="1" step="1" placeholder="Configured version" inputmode="numeric"><small>Version of the beneficiary recorded for this revenue, not a reward cycle.</small><button type="button" data-creator-current>Use current version</button></div>
              <div class="field full"><label for="creator-beneficiary">Selected version beneficiary</label><output id="creator-beneficiary" data-creator-beneficiary>Locked — beneficiary unavailable</output></div>
              <div class="field full"><label for="creator-current-beneficiary">Current future-revenue controller</label><output id="creator-current-beneficiary" data-creator-current-beneficiary>Locked — beneficiary unavailable</output></div>
              <div class="field full"><label for="creator-status">Revenue status</label><output id="creator-status" data-creator-status aria-live="polite">Locked — connect wallet and load a configured market</output></div>
            </div>
            <div class="subsection">
              <form class="reward-form" name="claimCreator" data-reward-form="claimCreator">
                <h3>Claim creator revenue</h3>
                <p>Pays the recorded beneficiary for this market and version. Token revenue is automatically converted to the paired asset.</p>
                <div class="field"><label for="creator-fee-asset">Quote asset</label><input id="creator-fee-asset" name="feeAsset" data-creator-fee-asset type="hidden"><span data-creator-quote-asset>Locked — quote asset unavailable</span><span class="role-copy" data-creator-pending-meme>Pending Meme conversion</span></div>
                <button type="button" disabled class="action-button" data-reward-action="claimCreator" data-action="claimCreator">Claim creator revenue</button>
                <button type="button" disabled class="action-button" data-reward-action="claimCreatorRaw">Claim original tokens</button>
              </form>
            </div>
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
          </div>
          <aside class="panel creator-side">
            <div class="kicker"><i class="ph ph-user-circle" aria-hidden="true"></i>Beneficiary rules</div>
            <p class="role-copy" style="margin-top:16px">Claims pay the beneficiary recorded for the selected version. Only the current beneficiary can nominate a future recipient; past earnings stay with the original recipient.</p>
            <div class="preview-list" style="margin-top:18px"><div><span>Market</span><strong data-creator-market-summary>—</strong></div><div><span>Epoch</span><strong data-creator-epoch-summary>—</strong></div><div><span>Status</span><strong data-creator-status-summary>Locked</strong></div></div>
          </aside>
        </div>
      </section>

      <section class="rewards-panel" role="tabpanel" id="rewards-panel-treasury" aria-labelledby="rewards-tab-treasury" data-rewards-panel="treasury" hidden>
        <div class="treasury-layout">
          <div>
              <div><h2>Holder fee sharing</h2><p>Hold tokens and earn rewards. Select a market to view the amount currently claimable.</p><p class="role-copy">Legacy markets use a 7-day reward cycle. Continuous markets release rewards over 24 hours. When enabled, 50% of the creator base fee share is distributed to holders. The creator keeps the other 50% and all creator tax. Rewards are claimed in the market's paired asset.</p></div>
            </div>
            <p class="role-copy tab-action-help" data-holder-action-help aria-live="polite">Connect a wallet and choose a market to enable holder actions.</p>
            <div class="fields">
              <div class="field"><label for="treasury-market">Market</label><select id="treasury-market" name="marketId" data-treasury-market><option value="">Select a configured market</option></select></div>
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
              <div class="reward-data"><small>Claimable by holders</small><output data-treasury-claimable>Locked — finalized Root required</output></div>

            </div>
            <p class="locked-note" data-treasury-status-note aria-live="polite"><i class="ph ph-lock-key" aria-hidden="true"></i><span>Choose a market to see this cycle’s distribution status and your reward eligibility.</span></p>

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

            <div class="subsection">
              <form class="reward-form" name="claim" data-reward-form="claim">
                <h3>Claim holder rewards</h3>
                <p>Your eligibility is checked automatically. Rewards are paid in the paired asset to your wallet.</p>
                <details class="reward-details proof-details"><summary>Distribution verification details</summary><div class="details-content"><div class="reward-data-grid"><div class="reward-data"><small>Merkle Root</small><output data-treasury-root>—</output></div><div class="reward-data"><small>Root service fee</small><output data-treasury-fee>Unavailable</output></div><div class="reward-data"><small>Proof source</small><output data-treasury-proof>Unavailable</output></div></div><div class="fields">
                  <div class="field"><label for="claim-leaf-index">Leaf index</label><input id="claim-leaf-index" name="leafIndex" data-treasury-leaf-index type="number" min="0" step="1" placeholder="Proof API value" inputmode="numeric" readonly></div>
                  <div class="field"><label for="claim-account">Leaf account (fixed recipient)</label><input id="claim-account" name="account" data-treasury-leaf-account type="text" placeholder="Proof API value" autocomplete="off" readonly></div>
                  <div class="field"><label for="claim-twab">TWAB numerator</label><input id="claim-twab" name="twab" data-treasury-twab type="number" min="0" step="1" placeholder="Proof API value" inputmode="numeric" readonly></div>
                  <div class="field"><label for="claim-amount">Quote amount</label><input id="claim-amount" name="amount" data-treasury-claim-amount type="number" min="0" step="any" placeholder="Proof API value" readonly></div>
                  <div class="field full"><label for="claim-proof">Merkle proof</label><textarea id="claim-proof" name="proof" class="proof-box" data-treasury-proof-input placeholder="Proof API value" spellcheck="false" readonly></textarea></div>
                </div></div></details>
                <button type="button" disabled class="action-button" data-reward-action="claim" data-action="claim">Claim holder rewards</button>
              </form>
            </div>

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
            </div>
          </div>
          <aside class="panel treasury-side" data-legacy-treasury>
            <div class="kicker"><i class="ph ph-shield-check" aria-hidden="true"></i>Reward delivery</div>
            <p class="role-copy" style="margin-top:16px">The platform prepares each distribution and an independent reviewer checks it. Once finalized, eligible holders can claim. You do not need to publish or review a distribution.</p>
            <div class="preview-list" style="margin-top:18px"><div><span>Root publisher</span><strong>Platform role only</strong></div><div><span>Pending-root reviewer</span><strong>Reviewer role only</strong></div><div><span>Holder recipient</span><strong data-treasury-recipient>Leaf account only</strong></div></div>
          </aside>
        </div>
      </section>
    </section>
  </main>
`,
};
