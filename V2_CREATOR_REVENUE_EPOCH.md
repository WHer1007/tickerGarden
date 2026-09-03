# TickerGarden V2 Creator 收益 Epoch 模型

> 规格任务：`V2-P-004`  
> 状态：`FROZEN / IMPLEMENTATION_ALLOWED`  
> 更新时间：2026-09-02

## 1. 规则

Creator beneficiary 的变更只影响变更成功后的新费用。变更前已产生但仍留在 Curve 中尚未 sweep 的费用、已经进入 FeeVault 的负债，以及毕业池每笔已 credit 的费用，都永久属于产生时的 beneficiary epoch。

`CreatorRevenueRegistry` 是唯一 beneficiary 权威：

```solidity
mapping(bytes32 marketId => uint32 epoch) public currentCreatorEpoch; // 初始 1
mapping(bytes32 marketId => mapping(uint32 epoch => address beneficiary)) public creatorBeneficiaryAt;
```

Factory 登记市场时初始化 epoch 1；beneficiary 等于 MarketConfig 的 `creatorRevenueBeneficiaryAtCreation`。epoch checked increment，0 无效且不得回绕。管理员、Guardian、Recovery 和 Factory 均不能覆盖已登记 beneficiary。

## 2. Curve sweep 边界

Curve 会跨交易累计 Quote fee，因此 beneficiary 变更必须在一笔交易内按以下顺序执行：

```text
current beneficiary calls transferCreatorRevenueBeneficiary(marketId, newBeneficiary)
-> require caller == beneficiaryAt[currentEpoch]
-> require newBeneficiary != 0 and != oldBeneficiary
-> NotGraduated 时调用 exact registered Curve.sweepCurveFees()
-> require Curve.accruedCurveFees() == 0
-> checked currentEpoch + 1
-> store beneficiaryAt[newEpoch]
```

Curve sweep 在 epoch 增加前读取 current epoch，所以此前累计费用全部 credit 给旧 epoch。sweep、实际到账、FeeVault credit 或 epoch 写入任一失败，整笔变更回滚。`Swept/PoolCreated/Rescued` 已按状态机完成最终 Curve sweep，但仍断言 accrued 为0。毕业池 Hook fee 每笔原子 credit，直接绑定交易当时的 epoch。

该设计无需 Curve 保存可增长的 epoch 队列，也不遍历历史 beneficiary。

## 3. 负债与领取

Creator 负债键固定为：

```text
creatorLiability[marketId][creatorEpoch][feeAsset]
```

Staker/Platform 负债不增加 creator epoch 维度。每次 Curve/v4 credit 把 creatorEpoch 写入事件并增加对应负债；后续 beneficiary 变化不能迁移或合并历史负债。

```solidity
claimCreator(bytes32 marketId, uint32 creatorEpoch, address feeAsset)
creatorLiability(bytes32 marketId, uint32 creatorEpoch, address feeAsset) view returns (uint256)
```

claim 可由任何人触发，但固定支付 `creatorBeneficiaryAt(marketId, creatorEpoch)`，不接受 recipient。旧 beneficiary 不必仍是 current beneficiary。支付失败只回滚该 epoch/asset 的 claim。

## 4. 事件

```text
CreatorRevenueEpochInitialized(marketId, epoch, beneficiary)
CreatorRevenueBeneficiaryUpdated(marketId, oldEpoch, newEpoch, oldBeneficiary, newBeneficiary)
CurveFeesSwept(marketId, creatorEpoch, quoteAsset, sweepNonce, feeId, amount, creatorAmount, platformAmount)
FeeBucketsCredited(marketId, creatorEpoch, feeAsset, feeId, creator, staker, platform, activeStock)
FeeClaimed(beneficiaryType, beneficiary, marketId, beneficiaryEpoch, feeAsset, amount)
```

`beneficiaryEpoch` 对 Creator 为实际 epoch；对 Staker/Platform 固定为0。

## 5. 不变量

1. epoch 从1开始且只增不减；每个 epoch beneficiary 写一次。
2. beneficiary 变更成功时，旧 Curve accrued fee 为0且旧累计费用已进入旧 epoch 负债。
3. 每笔 creator credit 恰好绑定一个非零 epoch，之后不可改变。
4. 所有 epoch 的 creator liability 均计入对应资产 totalLiability。
5. claim recipient 只能是该 epoch beneficiary；管理员没有 override。
6. beneficiary 变更不改变 creator 身份、marketId、salt namespace、Token 或 Gauge。
