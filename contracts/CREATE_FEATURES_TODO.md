# Create feature follow-up

## Creator tax — implemented for development

Creator tax now supports 0–5% (0–500 bps), fixed at creation and added to the base
trading fee. Curve and graduated Hook settlement credit the entire surcharge to
the creator. Canonical creation parameters, economics commitment, web form and
metadata validation carry the rate. See [implementation rules](../docs/v1/V1_CREATOR_TAX.md).
Deployment and release verification remain separate; this is not evidence of a deployed feature.

## Creator fee sharing with holders

The immutable `creatorFeesToHolders` choice defaults off and is persisted in
`properties.launch` as descriptive metadata; the onchain MarketConfig is
authoritative. When enabled, exactly 50% of the creator base-fee share, excluding
creator tax, is earmarked for holders. The creator retains the other 50% of the
base-fee share and 100% of creator tax. Platform/staker splits and the existing
creator conversion, claim, and beneficiary-transfer flows remain unchanged.

Factory creation registers the enabled market with the holder-sharing distributor
using the protocol fee vault and predicted launch locker. Holder periods begin at
market creation and run for 30 days; Quote is assigned when FeeVault credits it,
including curve sweep credits. Root processing may be platform-triggered and
delayed; no deployed automatic keeper or instant payout is implied. Pending Meme
and Quote conversion must be cleared before requesting a Root, and there is no
collective raw-token fallback.

## Existing atomic developer purchase — verified

`LaunchAndBuyRouter.launchAndBuy` routes native and ERC20 Quote through
`LaunchAndBuyRouterNative` / `LaunchAndBuyRouterERC20`: createMarketFor then curve.buy
in one transaction. Failure rolls back creation and purchase; unused Quote is
refunded to the creator. ERC20 allowance may require a prior approval transaction;
creation + purchase remains atomic. Frontend recipient is the publishing wallet.

The manual slippage field was removed. Developer buy remains the amount; the
frontend retains automatic 100bps minimum output protection based on simulation.
