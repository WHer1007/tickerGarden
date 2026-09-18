# TickerGarden V1 Creator 收益 Epoch 模型

> **当前边界（2026-09-18）：** Creator revenue 不得依赖市场级 pause/retire/emergency 或 Recovery 管理状态；市场部署后永久自治，launchPhase 仅为事实。受益人交接采用提名、接收者接受或当前受益人取消的两步流程。当前 FeeVault 使用原资产领取接口；旧兑换和 permissionless claim 说明不适用于当前版本。

> 规格任务：`V1-P-004`
> 状态：`FROZEN / DEPLOYMENT_ELIGIBLE`
> 更新时间：2026-09-18

## 1. 规则

Creator beneficiary 的变更只影响变更成功后的新费用。变更前已产生但仍留在 Curve 中尚未 sweep 的费用、已经进入 FeeVault 的负债，以及毕业池每笔已 credit 的费用，都永久属于产生时的 beneficiary epoch。提名本身不改变 current epoch 或分账归属；只有 pending beneficiary 接受后才建立新 epoch。

`CreatorRevenueRegistry` 是唯一 beneficiary 权威：

```solidity
mapping(bytes32 marketId => uint32 epoch) public currentCreatorEpoch; // 初始 1
mapping(bytes32 marketId => mapping(uint32 epoch => address beneficiary)) public creatorBeneficiaryAt;
```

Factory 登记市场时初始化 epoch 1；beneficiary 等于 MarketConfig 的 `creatorRevenueBeneficiaryAtCreation`。epoch checked increment，0 无效且不得回绕。管理员、Guardian、Recovery 和 Factory 均不能覆盖已登记 beneficiary。

## 2. 交接与 Curve sweep 边界

Curve 会跨交易累计 Quote fee。提名可以先独立提交；接收者接受及其归集、epoch 切换必须在同一笔交易内按以下顺序完成：

交接有提名、接受两步；当前受益人也可取消提名：

```text
current beneficiary calls transferCreatorRevenueBeneficiary(marketId, newBeneficiary)
-> require caller == beneficiaryAt[currentEpoch]
-> require newBeneficiary != 0 and != oldBeneficiary
-> store pendingCreatorRevenueBeneficiary and emit CreatorRevenueBeneficiaryProposed

current beneficiary may cancel with cancelCreatorRevenueBeneficiaryTransfer(marketId)
-> require caller == beneficiaryAt[currentEpoch]
-> clear pending beneficiary

pending beneficiary calls acceptCreatorRevenueBeneficiary(marketId)
-> require caller == pending beneficiary
-> if NotGraduated, call the market's registered Curve.sweepCurveFees()
-> require Curve.accruedCurveFees() == 0
-> checked currentEpoch + 1
-> clear pending beneficiary and store beneficiaryAt[newEpoch]
```

接受时的 Curve sweep 在 epoch 增加前读取 current epoch，所以此前累计费用全部 credit 给旧 epoch。sweep、实际到账、FeeVault credit 或 epoch 写入任一失败，接受交易整体回滚，pending 提名也保持不变。接受时还会检查 Curve accrued 为0；即使市场已毕业也执行该检查。原子毕业进入 `PoolCreated` 前必须完成最终 Curve sweep 并断言 accrued 为0；失败则最终买入与 sweep 一并回滚。毕业池 Hook fee 每笔原子 credit，直接绑定交易当时的 epoch。

该设计无需 Curve 保存可增长的 epoch 队列，也不遍历历史 beneficiary。

## 3. 负债与当前领取

Creator 负债键固定为：

```text
creatorLiability[marketId][creatorEpoch][feeAsset]
```

Staker/Platform 负债不增加 creator epoch 维度。每次 Curve/v4 credit 把 creatorEpoch 写入事件并增加对应负债；后续 beneficiary 变化不能迁移或合并历史负债。

```solidity
claimUserRewardAssets(bytes32 marketId, uint8 role, uint32 creatorEpoch, uint8 assets)
creatorLiability(bytes32 marketId, uint32 creatorEpoch, address feeAsset) view returns (uint256)
```

当前 Creator claim 通过 FeeVault 的 `claimUserRewardAssets` 原资产接口执行，Creator 使用 `role = 0` 和对应的非零 epoch。调用者必须等于 `creatorBeneficiaryAt(marketId, creatorEpoch)`；任何其他地址代领都会回滚。`assets` 可选 Quote（1）、Meme（2）或两者（3），不接受自定义 recipient。旧 epoch 仍由其历史受益人领取，不要求该受益人仍是 current beneficiary。单资产 claim 只消费所选资产的负债；转账或销毁失败会回滚该 claim。

市场启用 `burnMemeFees` 时，Creator 的 Meme 收益不会支付给钱包，而是在 claim 结算时真实销毁；Quote 仍按原资产支付。该模式下每次 Creator claim 都会同时结算并销毁该 epoch 的全部 Meme 收益，即使 `assets` 只选择 Quote。未领取的 Meme 负债保持待结算状态，不能计作钱包收入。未启用 burn 模式时，Meme 按所选原资产支付。

## 4. 事件

```text
CreatorRevenueEpochInitialized(marketId, epoch, beneficiary)
CreatorRevenueBeneficiaryProposed(marketId, epoch, currentBeneficiary, pendingBeneficiary)
CreatorRevenueBeneficiaryTransferCancelled(marketId, epoch)
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
5. 当前 Creator claim 只能由该 epoch beneficiary 发起；不存在代领 recipient 参数，管理员没有 override。
6. beneficiary 变更不改变 creator 身份、marketId、salt namespace、Token 或 Gauge。

## 6. 产品边界

当前网页只提供 Creator 奖励领取，尚未开放收益交接按钮。后端记录提名、取消和接受状态；pending 钱包无需已有历史收益即可被目录和读接口识别。不能把底层接口支持描述成网页已开放交接。
