
export default {
  title: 'Terms of Use — TickerGarden',
  html: `
<main class="page legal-page">
      <section class="page-hero">
        <div>
          <div class="kicker"><i class="ph ph-scales" aria-hidden="true"></i>TickerGarden legal</div>
          <h1>Terms of Use</h1>
          <p>The responsibilities, boundaries, and risks that apply when you access the interface or ask your wallet to interact with TickerGarden markets and protocol contracts.</p>
        </div>
        <aside class="hero-badge"><i class="ph ph-file-text" aria-hidden="true"></i><strong>Terms draft</strong><span>Dated September 4, 2026</span></aside>
      </section>

      <aside class="legal-draft-banner" role="note">
        <i class="ph ph-warning-circle" aria-hidden="true"></i>
        <div><strong>Pre-launch legal draft</strong>These Terms are not yet effective. The contracting entity, legal contact, restricted-jurisdiction policy, governing law, dispute forum, liability cap, and effective date must be completed and approved by qualified counsel before production publication.</div>
      </aside>

      <div class="legal-layout">
        <nav class="legal-toc" aria-label="Terms of Use contents">
          <strong>On this page</strong>
          <ol>
            <li><a href="#terms-status">Status and agreement</a></li>
            <li><a href="#terms-service">About TickerGarden</a></li>
            <li><a href="#terms-eligibility">Eligibility</a></li>
            <li><a href="#terms-interface">Interface and custody</a></li>
            <li><a href="#terms-wallet">Wallet security</a></li>
            <li><a href="#terms-transactions">Transactions</a></li>
            <li><a href="#terms-assets">Created tokens and STOCK</a></li>
            <li><a href="#terms-creation">Creation and content</a></li>
            <li><a href="#terms-bloom">Lifecycle and Bloom</a></li>
            <li><a href="#terms-fees">Fees and allocations</a></li>
            <li><a href="#terms-treasury">Holder fee sharing</a></li>
            <li><a href="#terms-risks">Risk disclosures</a></li>
            <li><a href="#terms-use">Acceptable use</a></li>
            <li><a href="#terms-third-party">Third parties</a></li>
            <li><a href="#terms-ip">IP and submitted content</a></li>
            <li><a href="#terms-availability">Availability and access</a></li>
            <li><a href="#terms-disclaimers">Disclaimers and liability</a></li>
            <li><a href="#terms-law">Law and disputes</a></li>
            <li><a href="#terms-general">General terms</a></li>
          </ol>
        </nav>

        <article class="legal-document">
          <header>
            <h2>Terms of Use</h2>
            <p>Draft date: September 4, 2026 · Status: pre-launch review · Read together with the <a href="/privacy">Privacy Policy</a> and any transaction-specific disclosure shown by the interface.</p>
          </header>

          <section id="terms-status">
            <h2>1. Status and agreement</h2>
            <p>This page is a product-integrated legal draft. It does not become a binding agreement until a named operator publishes it with an effective date after legal and deployment approval.</p>
            <p>Once effective, accessing or using the production interface, connecting a wallet, creating a market, or submitting a transaction through it will indicate acceptance of the final Terms and Privacy Policy. If you do not agree, do not use the production interface.</p>
            <span class="legal-placeholder"><strong>Required before launch:</strong> identify the full contracting entity and address, effective date, acceptance method, and monitored legal contact.</span>
          </section>

          <section id="terms-service">
            <h2>2. About TickerGarden</h2>
            <p>TickerGarden is a software interface for discovering and creating fixed-supply token markets associated with eligible official Stock Tokens, preparing wallet transactions, reading public blockchain state, trading through configured Curve or Pool routes, allocating matching STOCK after a market blooms, and viewing or claiming protocol-defined fees where available.</p>
            <p>The interface operator is not the issuer of third-party Stock Tokens or the companies referenced by their tickers. Unless expressly stated in a separate written agreement, the operator is not a bank, broker, securities exchange, custodian, investment adviser, fiduciary, transfer agent, or tax adviser. Nothing in the interface is investment, legal, accounting, or tax advice.</p>
          </section>

          <section id="terms-eligibility">
            <h2>3. Eligibility and lawful access</h2>
            <p>You must be at least 18 and at least the legal age of majority where you live, have capacity to accept the final Terms, and be legally permitted to use the interface. If acting for an organization, you must be authorized to bind it.</p>
            <p>You may not use the interface if doing so would violate applicable securities, commodities, financial-services, consumer-protection, anti-money-laundering, sanctions, tax, or other law. You may not use it while subject to an applicable restricted-party designation or from a jurisdiction where access is prohibited by the final operator.</p>
            <span class="legal-placeholder"><strong>Required before launch:</strong> counsel must approve a precise restricted-jurisdiction and sanctions policy. No definitive jurisdiction list is adopted by this draft.</span>
          </section>

          <section id="terms-interface">
            <h2>4. Interface, protocol, and custody boundaries</h2>
            <p>The web interface does not hold your private keys and cannot sign a transaction for you. Every blockchain transaction must be reviewed and authorized through your wallet. The operator generally cannot reverse, cancel, replace, or guarantee settlement of a confirmed or pending transaction.</p>
            <p>Some TickerGarden protocol contracts do hold assets under published smart-contract rules. In particular, STOCK deposited for allocation may be held by the canonical <code>UserStockVault</code>. This contract custody is distinct from custody by the website operator and remains subject to smart-contract, network, asset, and configuration risk.</p>
            <p>Where implemented, <code>rageQuit</code> prioritizes return of allocated STOCK principal under the contract’s rules but forfeits unclaimed fee entitlements and may require later reward-accounting cleanup. It is not insurance and does not protect against token, chain, wallet, or contract failure.</p>
          </section>

          <section id="terms-wallet">
            <h2>5. Wallet and account security</h2>
            <p>You are responsible for your wallet, devices, private keys, recovery phrase, permissions, token approvals, and every action authorized through them. TickerGarden cannot restore a wallet or recover assets sent to the wrong address.</p>
            <ul>
              <li>Never provide a private key or recovery phrase to TickerGarden or anyone claiming to provide support.</li>
              <li>Verify the chain, contract address, function, assets, amounts, approvals, slippage, fees, and recipient before signing.</li>
              <li>Use only wallets, devices, RPC endpoints, and links you trust.</li>
              <li>Revoke unnecessary approvals and act promptly if you suspect compromise.</li>
            </ul>
          </section>

          <section id="terms-transactions">
            <h2>6. Transactions and displayed data</h2>
            <p>Transaction previews, quotes, balances, fee estimates, Curve progress, Pool state, token metadata, claimable amounts, and simulations can be delayed, incomplete, unavailable, or different from final execution. The interface may intentionally disable an action when canonical state or a safe route cannot be verified.</p>
            <p>Transactions may fail, remain pending, be reordered, partially fill where supported, execute at an unexpected price, or cost more than expected because of network conditions, price movement, liquidity, slippage, contract behavior, transaction ordering, or third-party systems. You are responsible for reviewing the final wallet request.</p>
          </section>

          <section id="terms-assets">
            <h2>7. Created-token and STOCK relationship</h2>
            <div class="legal-callout"><strong>A token created through TickerGarden is not the referenced stock.</strong><p>It does not represent company ownership, shares, voting rights, dividends, a fixed redemption right, or a promise to track the price of a stock or Stock Token.</p></div>
            <p>An eligible Stock Token serves as the market’s immutable community association and, after the market blooms, as the matching asset used for protocol allocation and actual-fee distribution. STOCK is not collateral or a redemption reserve for the created token.</p>
            <p>The same STOCK can anchor multiple independent token markets. Names, symbols, images, and ticker references can be similar or misleading; verify the canonical <code>marketId</code>, Asset UID, token address, creator, Curve, Pool, and Gauge before interacting.</p>
            <p>Third-party Stock Tokens have their own issuer, legal terms, technical controls, backing or redemption arrangements, transfer limitations, and regulatory risks. TickerGarden does not guarantee any of those characteristics.</p>
          </section>

          <section id="terms-creation">
            <h2>8. Market creation and submitted content</h2>
            <p>You are responsible for each market you create or promote and for its name, symbol, metadata, image, description, links, beneficiary address, and related communications. You must have the rights and permissions needed to use that content, and it must be lawful, accurate, and not misleading.</p>
            <p>Creating a market does not mean that TickerGarden, a Stock Token issuer, Robinhood, a referenced company, or any other party sponsors, audits, approves, or endorses it. Placement, ranking, trending treatment, or inclusion in an interface directory is not an investment recommendation or quality statement.</p>
            <p>The operator may hide or restrict offchain metadata or links on surfaces it controls for legal, security, abuse, or product-integrity reasons. It cannot erase immutable contracts, public blockchain transactions, or independently stored content.</p>
          </section>

          <section id="terms-bloom">
            <h2>9. Market lifecycle and Bloom</h2>
            <p><strong>Bloom</strong> is TickerGarden’s user-facing name for a successful protocol lifecycle transition. A market is <strong>Bloomed</strong> only when the canonical Registry records <code>launchPhase == PoolCreated</code>. “Ready to Bloom” and “Bloom Pending” are earlier conditions and do not mean Pool creation succeeded.</p>
            <p>Bloom confirms a lifecycle transition and creation of the canonical Pool under the applicable protocol rules. It is not a quality rating, endorsement, valuation, liquidity guarantee, promise of future trading, or assurance that users can exit at a desired price. Permanently locked initial liquidity does not prevent price movement, thin market depth, smart-contract loss, or loss of token value.</p>
          </section>

          <section id="terms-fees">
            <h2>10. Trading fees, creator fees, and STOCK allocations</h2>
            <p>Transactions may incur blockchain gas, Curve fees, Hook or protocol fees, price impact, slippage, and third-party costs. Applicable values are determined by the market’s immutable or versioned configuration and the final transaction, not by a marketing statement. Review the current preview and canonical contract state before signing.</p>
            <p>Market creators, active matching-STOCK allocators, and the platform may receive portions of fees actually generated by the relevant market under its applicable rules. Fee assets may be paired assets or created tokens. Amounts can be zero, volatile, illiquid, delayed, unclaimable because of technical failure, or worth less when claimed.</p>
            <p>Where selected at creation, token fee burning is immutable. Creator and Staker fees paid in the created token, including creator tax, are destroyed when a reward claim is processed, including a paired-asset-only claim; their paired-asset fees continue to be paid normally. Holder fees paid in the created token are destroyed by FeeVault during funding settlement and are not funded to the HolderRewardsDistributor, so holder snapshots cover the paired asset only. Burn occurs during settlement, never on swaps or transfers, and reduces token supply through the token’s burn mechanism rather than a dead-address transfer. Unclaimed Creator and Staker fees remain pending until settlement. Platform fees are unaffected.</p>
            <p>STOCK allocation does not mint created tokens and is not a fixed-income, savings, brokerage, dividend, or guaranteed-yield product. No displayed annualized rate, estimate, historical fee amount, or “Harvest” label is a promise of future return. You are responsible for taxes and reporting arising from creation, trading, allocation, and claims.</p>
          </section>

          <section id="terms-treasury">
            <h2>11. Holder fee sharing</h2>
            <p>This opt-in is immutable at market creation. When selected, 50% of the creator base fee share, excluding creator tax, is earmarked for holders. The creator retains the other 50% of the base fee share and 100% of creator tax. No extra per-user deposit or staking step is required.</p>
            <p>For the snapshot model, FeeVault funds the HolderRewardsDistributor and a trusted publisher commits a wallet-balance snapshot root. Only the direct wallet balance of the created token at the snapshot is included; LP and other indirect holdings are excluded. Selling after the snapshot does not remove that round’s entitlement. Publication cadence is an off-chain policy, and the contract does not promise a fixed 24-hour or 7-day payout period.</p>
            <p>Claims pay the selected original paired asset and/or created token. The protocol does not convert one reward asset into the other or provide an on-chain fallback. Rewards can be delayed, unavailable, or worth less when received, and no displayed estimate guarantees payment time or token value.</p>
            <p>For markets with token fee burning enabled, the Holder snapshot and claimable holder reward cover the paired asset only. The burn setting cannot be changed after market creation.</p>
            <p>Creator revenue uses append-only beneficiary epochs. A beneficiary transfer creates a new epoch only after the applicable pre-graduation Curve fees are swept and the old epoch is settled; fees already assigned to the old epoch remain payable to the old beneficiary.</p>
          </section>

          <section id="terms-risks">
            <h2>12. Risk disclosures</h2>
            <p>You are responsible for your own research and decisions. Only use assets you can afford to lose. Risks include, without limitation:</p>
            <ul>
              <li>loss of some or all assets through volatility, illiquidity, malicious assets, market manipulation, or lack of buyers;</li>
              <li>bugs, exploits, unexpected behavior, upgrade risk in third-party assets, or failures in TickerGarden and integrated contracts;</li>
              <li>wallet compromise, phishing, signature misuse, incorrect approvals, or transactions sent to the wrong contract or network;</li>
              <li>RPC, indexer, API, wallet, Uniswap, metadata, oracle, bridge, explorer, hosting, or blockchain outages and inaccuracies;</li>
              <li>front-running, sandwiching, transaction reordering, congestion, chain reorganization, forks, validator conduct, and changing gas costs;</li>
              <li>legal, securities, commodities, sanctions, tax, accounting, consumer-protection, or other regulatory consequences;</li>
              <li>failure of a market to Bloom, failure or delay in Pool creation, unavailable claims, or inability to exit a position.</li>
            </ul>
            <p>No statement on the interface is an offer, solicitation, recommendation, or prediction of profit, appreciation, liquidity, or legal status.</p>
          </section>

          <section id="terms-use">
            <h2>13. Acceptable use</h2>
            <p>You must not use the interface to:</p>
            <ul>
              <li>violate law, sanctions, intellectual-property, privacy, publicity, consumer, or other rights;</li>
              <li>publish deceptive, fraudulent, abusive, illegal, infringing, or malicious metadata, links, or communications;</li>
              <li>steal, launder funds, finance unlawful activity, manipulate a market, impersonate another party, or conceal criminal proceeds;</li>
              <li>misrepresent a TickerGarden-created token as stock, tokenized equity or debt, a dividend right, a redeemable claim, or an officially endorsed company asset;</li>
              <li>interfere with infrastructure, bypass lawful access controls, distribute malware, exploit vulnerabilities, evade rate limits, or automate access in a harmful manner;</li>
              <li>misrepresent an affiliation, partnership, audit, approval, or endorsement involving TickerGarden, a Stock Token issuer, Robinhood, or a referenced company.</li>
            </ul>
            <p>Open smart-contract access does not create permission to use the operator-controlled website, branding, APIs, or infrastructure unlawfully.</p>
          </section>

          <section id="terms-third-party">
            <h2>14. Third-party services and interests</h2>
            <p>The interface may connect to wallets, Stock Token issuers, blockchain networks, Uniswap, smart contracts, RPC services, APIs, indexers, explorers, storage systems, fonts, and external websites. TickerGarden does not control their availability, accuracy, security, conduct, policies, or legal status. A link or integration is not an endorsement.</p>
            <p>The final operator, contributors, affiliates, or service providers may hold, trade, create, allocate STOCK to, receive fees from, or otherwise have interests in markets displayed by the interface. Any required conflict disclosures and organizational controls must be completed before launch. No fiduciary or advisory duty arises merely because the interface displays or supports a market.</p>
          </section>

          <section id="terms-ip">
            <h2>15. Intellectual property, licenses, and feedback</h2>
            <p>TickerGarden branding, interface design, documentation, and original content may be protected by intellectual-property law. Subject to the final Terms and any open-source license, users receive a limited, revocable, nonexclusive, nontransferable right to access the interface for lawful purposes.</p>
            <p>You retain rights you lawfully hold in submitted content. To the extent needed to operate, display, secure, index, and promote the applicable product surface, the final Terms may require a worldwide, nonexclusive, royalty-free license to that content. Immutable or distributed copies may continue to exist after offchain removal.</p>
            <p>Feedback should not contain confidential information. A final feedback license and copyright-reporting process must be approved and published before launch.</p>
          </section>

          <section id="terms-availability">
            <h2>16. Service availability and access</h2>
            <p>The operator may change, restrict, suspend, or discontinue the website, APIs, indexing, metadata display, or other offchain services for legal, security, technical, or operational reasons. Continuous availability, preservation of offchain data, wallet compatibility, or advance notice is not guaranteed.</p>
            <p>Autonomous smart contracts and public networks may remain accessible through other tools even when the TickerGarden interface is unavailable, subject to their own rules and your technical ability. The operator may be unable to stop or modify those contracts.</p>
          </section>

          <section id="terms-disclaimers">
            <h2>17. No warranties, liability, and indemnity</h2>
            <p>To the fullest extent permitted by law, the final production interface and related operator-controlled services are expected to be provided “as is” and “as available,” without warranties of merchantability, fitness for a particular purpose, title, noninfringement, accuracy, availability, security, or uninterrupted operation.</p>
            <p>To the fullest extent permitted by law, the operator and relevant affiliates, personnel, and service providers should not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages; lost profits or data; loss of assets; failed or delayed transactions; contract or wallet compromise; market movement; network events; or third-party conduct arising from use of the interface.</p>
            <p>The final agreement may require users to indemnify applicable operator parties for claims resulting from unlawful use, submitted content, breach of the Terms, or violation of another person’s rights. Mandatory consumer rights and liabilities that cannot lawfully be excluded will remain unaffected.</p>
            <span class="legal-placeholder"><strong>Required before launch:</strong> counsel must identify protected parties, permitted warranty exclusions, liability cap and carve-outs, indemnity procedure, and any mandatory consumer-language variation.</span>
          </section>

          <section id="terms-law">
            <h2>18. Governing law and dispute resolution</h2>
            <p>No governing law, court, arbitration forum, class-action waiver, informal-resolution period, or opt-out process has been approved for TickerGarden. Legal terms used by another platform are not adopted by reference.</p>
            <span class="legal-placeholder"><strong>Required before launch:</strong> the final operator and qualified counsel must select and publish enforceable governing-law, venue, dispute, consumer-rights, and notice provisions appropriate to the offered jurisdictions.</span>
          </section>

          <section id="terms-general">
            <h2>19. General terms, changes, and contact</h2>
            <p>The final Terms should address severability, waiver, assignment, survival, entire agreement, electronic notices, language priority, and feature-specific terms. The operator may update effective Terms as services, risks, or legal requirements change, with the effective date identifying the applicable version and material changes communicated where required.</p>
            <span class="legal-placeholder"><strong>Not yet effective:</strong> contracting entity, address, legal email, effective date, jurisdiction schedule, governing law, dispute process, and liability provisions remain open. Do not publish this draft as final Terms until those fields and the Privacy Policy have passed legal review.</span>
          </section>
        </article>
      </div>
    </main>
`,
};
