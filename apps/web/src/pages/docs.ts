const topics = [
  ['basics', 'Getting Started'], ['create', 'Launch A Token'],
  ['trading', 'Trading & Bloom'], ['staking', 'Stock Staking'],
  ['rewards', 'Claim Rewards'], ['help', 'Help'],
] as const;

const answers = [
  ['basics', 'What Is TickerGarden?', 'Launch a community token, trade it, and share trading fees with its creator, eligible holders or Stock stakers. A token is not company equity and does not track a stock price.'],
  ['basics', 'What Do I Need To Start?', 'Connect your wallet on the network shown in the footer. Keep ETH for transaction fees and the required asset for buying or staking. Testnet assets are for testing.'],
  ['basics', 'Paired Asset Or Staking Asset?', 'The paired asset is what you use to buy and sell the token. The staking asset is the Stock accepted for staking in that market. They can be different assets; holding the community token is not the same as staking Stock.'],
  ['create', 'How Do I Launch A Token?', 'Open <a href="/create">Create</a>, add a name, ticker and image, then choose a paired asset. Review the fees and Bloom target, confirm your launch, and approve the wallet transaction. The success page provides a link to your token once confirmation is complete.'],
  ['create', 'What Can I Upload?', 'Use PNG, JPG or WebP up to 2 MB. Names allow 64 characters, tickers 16 letters or numbers, and descriptions 300 characters. Description, website and X are optional.'],
  ['create', 'Where Are My Token Details Published?', 'Your image and metadata are published to IPFS at launch. After creation, use the token information pack and listing links to submit your details to other platforms. Publication does not automatically create a third-party listing.'],
  ['create', 'What Is Developer Buy?', 'An optional first purchase included with your launch. Leave it blank to skip. If a supported asset purchase is needed, review the ETH amount shown before confirming.'],
  ['create', 'Which Settings Should I Review?', 'Choose whether to enable Stock staking and Holder fee sharing. Creator tax is an extra trading fee from 0% to 5%, with up to two decimal places. The paired asset, staking option, holder-sharing option and creator tax are fixed at launch.'],
  ['trading', 'Growing Or Bloomed?', 'Growing tokens trade on a bonding curve. When the Bloom target is reached, the final buy creates the liquidity pool and the token becomes Bloomed. Trading then uses that pool, with its initial liquidity permanently locked.'],
  ['trading', 'What Is The Bloom Target?', 'The net paired asset needed to complete the curve, excluding fees and virtual reserves. Check the target on Create or the token page: it depends on the asset and network. A buy above the remaining curve amount only uses what is needed and refunds the excess.'],
  ['trading', 'How Do I Buy Or Sell?', 'Open a token, select Buy or Sell and enter an amount. Check the output, trading fee and price impact, then confirm in your wallet. Token approval may be required first; approval alone does not complete the trade.'],
  ['trading', 'Can My Final Price Change?', 'Yes. Quotes refresh while you trade, and other trades can change the price before confirmation. Price impact shows how much your trade moves the pool price. The trading form currently has no user-set slippage limit.'],
  ['trading', 'What Is Anti-Snipe?', 'Buys during the first 5 seconds after launch may carry an additional, declining fee. Check the quoted fee before buying.'],
  ['trading', 'How are trading fees shared?', 'A completed trade creates the fee; indexing and allocation can appear later, so an allocated total is not the same as an immediately claimable balance. The token page shows the current split between Creator, Holder, Staker and Platform. Stakers only earn after Bloom with active stake. Creator tax goes entirely to the creator wallet and is separate from the base fee split. Any pool fee shown in the quote is charged separately by the liquidity pool and is excluded from these shares.'],
  ['staking', 'What Does Enable Staking Rewards Do?', 'It lets users stake the selected Stock and share that market’s trading fees after Bloom. The creator must enable it at launch. A Growing market can show staking information, but new stake opens only after Bloom.', 'staking-rewards'],
  ['staking', 'How Do I Stake Stock?', 'Go to <a href="/stake">Stake</a>, search for a market and select Add. Enter an amount within your wallet balance and above the displayed minimum, approve if needed, then confirm Stake. My Markets lists your positions.'],
  ['staking', 'When Does My Stake Earn Rewards?', 'New stake starts earning after 30 seconds. Rewards depend on your active share of that market’s stake and the fees it generates. Adding more before activation restarts the wait for the pending amount; existing active stake keeps earning. There is no fixed yield.'],
  ['staking', 'When Can I Withdraw Or Claim?', 'New stake starts a 24-hour lock. Each addition restarts the lock for your entire position, including normal reward claims. After the countdown ends, withdraw your full position or claim rewards on Stake. Withdrawing principal keeps earned rewards available to claim separately.'],
  ['rewards', 'Where Do I Claim Each Type Of Reward?', 'Use <a href="/claim#creator">Claim → Creator</a> for creator fees, <a href="/claim#holder">Claim → Holder</a> for holder rewards, and <a href="/stake">Stake</a> for staking rewards. These are separate balances.'],
  ['rewards', 'How Do Creator Rewards Work?', 'The Creator tab lists tokens launched by your connected wallet. Fees are paid to the designated creator wallet. If you chose a different creator wallet at launch, that address receives the fees.'],
  ['rewards', 'How Does Holder Fee Sharing Work?', 'Enabled tokens share half of the creator’s base fees with holders; creator tax is excluded. On updated markets, Quote and Meme rewards release separately over 24 hours using your eligible balance. No staking is needed, and earned rewards remain yours after selling. Creator, Staker and Holder claims let you choose Quote, Meme, or both in their original form. You can exchange claimed assets later in a separate wallet transaction. Staking locks still apply. Older markets follow the distribution status shown on Claim.'],
  ['help', 'Why Is A Reward Not Claimable Yet?', 'The market may not have earned fees, your stake may still be locked, or a holder distribution may still be settling. Check the status on the relevant rewards page. Displayed fee totals are not your claimable balance.'],
  ['help', 'My Transaction Is Pending. What Should I Do?', 'Check the transaction status at the bottom of the page or open it in the explorer. Do not submit again while it is pending. A launch in progress is restored after refreshing. Rejected wallet requests do not complete the action.'],
  ['help', 'Why Do Statistics Update Later?', 'Market and protocol statistics can take 10–20 minutes to refresh. Transaction status is tracked separately. A dash means data is not available yet, not necessarily zero.'],
  ['help', 'How Do I Check The Right Token?', 'Compare the contract address, not just the name or ticker. Different tokens can look alike, and multiple markets can use the same Stock. Review <a href="/risks">Risks</a> before using funds you cannot afford to lose.'],
];

export default {
  title: 'Docs — TickerGarden',
  html: `
<main class="page docs-page">
  <header class="page-hero docs-heading">
    <div><div class="kicker"><i class="ph ph-book-open-text" aria-hidden="true"></i>User Guide</div><h1>Docs</h1><p>Launch, trade, stake and claim. The essentials in one place.</p></div>
  </header>
  <label class="docs-search"><i class="ph ph-magnifying-glass" aria-hidden="true"></i><input data-docs-search type="search" aria-label="Search docs" placeholder="Search the docs" autocomplete="off" /></label>
  <div class="docs-body">
    <nav class="docs-toc" aria-label="Documentation topics"><span class="docs-toc-label">Contents</span>${topics.map(([id, label]) => `<a href="#docs-${id}">${label}<i class="ph ph-arrow-up-right" aria-hidden="true"></i></a>`).join('')}</nav>
    <div class="docs-content">${topics.map(([topic, label], index) => `<section class="docs-section" id="docs-${topic}" data-docs-section aria-labelledby="docs-title-${topic}"><header class="docs-section-heading"><span aria-hidden="true">${String(index + 1).padStart(2, '0')}</span><h2 id="docs-title-${topic}">${label}</h2></header>${answers.filter(([id]) => id === topic).map(([, question, answer, id]) => `<article class="docs-article" data-docs-article${id ? ` id="${id}"` : ''}><h3>${question}</h3><p>${answer}</p></article>`).join('')}</section>`).join('')}
      <p class="docs-empty" data-docs-empty role="status" hidden>No matching articles. Try another search.</p>
    </div>
  </div>
</main>`,
};
