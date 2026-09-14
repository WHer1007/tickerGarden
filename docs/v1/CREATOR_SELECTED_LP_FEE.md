# Creator-selected optional v4 LP fee

Status: implemented in the current source candidate; NOT_BROADCAST. Existing deployments keep their original fee policy. Keeper scheduling remains disabled.

## Creation choice

The Create flow exposes the setting under **Advanced** as an optional
static v4 LP fee:

- Advanced toggle off: `0%`;
- Advanced toggle on: choose exactly `0.1%`, `0.2%`, or `0.3%`.

The selected value is frozen when the market is created. There is no later
setter or adjustment for an existing market.

## Scope and fee relationship

The selected LP fee applies only after the market graduates to its canonical
v4 pool. It is an additional pool fee alongside the existing protocol fee and
creator tax; it does not replace, reduce, or alter either one. The creator tax
remains the separate creator charge described in
[`V1_CREATOR_TAX.md`](./V1_CREATOR_TAX.md).

This fee is native active LP reward accrual from the v4 pool. It is not a
FeeVault credit, is not part of the protocol fee split, and does not become a
creator, holder, staker, or platform claim balance through FeeVault.

## Canonical graduation locker

The canonical graduation `LaunchLocker` remains permanently locked. Its fee collection and bounded reinvestment path is documented in
[`LOCKER_FEE_COMPOUNDING.md`](./LOCKER_FEE_COMPOUNDING.md). It collects only its own position rewards; other active LP positions earn their own share under v4 rules. Zero-fee pools do not accrue swap LP rewards.

## Contract binding

`CreateMarketParams.lpFeePips` and `MarketConfig.lpFeePips` use exactly 0, 1000, 2000 or 3000. Factory preview and creation validate these values. Expected-economics schema 8 binds the choice, and fee-policy schema 5 identifies this regime. The baseline `poolFee` and policy `poolKeyFee` remain zero as the default; they do not override the per-market choice. Protocol `LP_SHARE_BPS` remains zero.

Canonical PoolKey, graduation math, Hook binding and Locker custody agree on the stored fee. The Hook checks actual slot0 LP fee against that PoolKey before charging its own fee. No setter or dynamic-fee flag is permitted. The `lpFeeMode()` capability probe distinguishes this ABI from earlier deployments.

Native LP and Core protocol fees are included by the v4 quoter. The Hook base fee and creator tax keep their existing delta basis. Percentages with different bases must not be mechanically added to advertise an effective total fee. UserClaims remains raw-asset claim selection; it does not perform internal reward conversion or apply a 98% output rule.

This is source implementation evidence only. A new deployment, verification and explicit Keeper configuration are required for live operation; this change does not enable periodic backend execution.
