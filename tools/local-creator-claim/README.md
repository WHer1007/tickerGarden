# Local Creator claim environment

This isolated local environment exercises the current production protocol modules with local-only Uniswap v4 boundary contracts. It supports the Creator flow and browser buy/sell testing after a market graduates. The local swap boundary uses deterministic constant-product pricing; production router behavior remains covered by Fork tests.

## Wallet network

- RPC URL: `http://127.0.0.1:18678`
- Chain ID: `46630`
- Currency symbol: `ETH`
- Creator account: `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`
- Creator private key: `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d`
- Staker account: `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC`
- Staker private key: `0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a`

The account and key are Anvil defaults and are valid only on this disposable local chain.

The local metadata service runs at `http://127.0.0.1:8797`. It verifies the Creator wallet signature and returns an isolated test-only metadata record, so the Create page can complete without external storage.

## Holder claim fixture

Run `npm run local:holder:prepare` once. It creates and graduates a Holder-sharing market, transfers the circulating test tokens to the fourth Anvil account, accrues and funds Quote plus Token rewards, publishes a one-account wallet snapshot through the real Distributor, and exposes the proof through the local read-only service. Connect the printed Holder account, open the printed claim URL, select **Holder**, and claim either asset or both.

## Manual flow

1. Open `http://127.0.0.1:5179/create` and connect the Creator account.
2. Create a market. For a dual-asset payout, leave **Burn Meme fees** off and **Creator fees to holders** off. Any allowed Creator tax and LP fee may be selected.
3. Copy the created market ID, then run `npm run local:creator:accrue -- <market-id>` from the repository root. Omitting the ID selects the newest market.
4. Open `http://127.0.0.1:5179/claim#creator`, connect the same Creator account, select the market, and claim both Quote and Meme rewards.
5. Run `npm run local:creator:status` to inspect the local market list.

After step 3, the token detail page can quote and execute local buys and sells through the same transaction UI used by the test deployment. These swaps call the real local Hook and FeeVault so Creator, Staker and Platform accounting can be inspected after each transaction.

The accrual helper first graduates a growing market, then sends controlled Quote and Meme swap fee input through the deployed Hook and ProtocolFeeVault. It validates fee accounting and claims without pretending that the local v4 boundary is a production AMM.

## Staker claim fixture

Run `npm run local:staker:prepare` once. It installs the local TSLA Stock fixture at the test-only configured address, admits it through the real Stock registry, creates and graduates a staking-enabled market, stakes 100 TSLA from the Staker account, activates the position, accrues Quote and Token fees, and advances the disposable chain beyond the 24-hour claim lock. The command prints the exact market, balances, transactions, and claim URL and is idempotent for the current local runtime.
