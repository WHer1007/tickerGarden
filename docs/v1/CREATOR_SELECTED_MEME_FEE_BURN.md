# Creator-selected Meme fee burn

This V1 policy describes an immutable market setting selected at creation. It is a product and accounting rule; it does not claim that a deployment is live.

When burn mode is enabled:

- Creator and Staker earned Meme fees, including Creator tax, are destroyed when their reward claim is settled. This also applies when the claim requests Quote only. Their Quote fees are paid normally.
- Holder Meme fees are destroyed by FeeVault when funding settlement is called. They are never funded to the HolderRewardsDistributor, so holder snapshots and claims cover Quote only.
- Platform fees are unaffected.
- Unclaimed Creator and Staker fees remain pending until settlement.
- Rewards forfeited through emergency exit follow the existing Platform forfeiture policy. Forfeited Meme fees may be claimed by Platform without burning. This is an intentional exception, confirmed by the user on 2026-09-13.
- No burn occurs on swaps or transfers. The burn reduces token supply through the token's real burn mechanism; it is not a transfer to a dead address.

The setting cannot be changed after market creation. Markets without the setting follow their configured reward rules.
