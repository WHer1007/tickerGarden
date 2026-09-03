# TickerGarden V2 组合调用与身份传递

> 规格任务：`V2-P-003`  
> 状态：`REVIEW`  
> 更新时间：2026-09-02

## 1. 原则

组合 Router/Manager 可以协调同一交易，但不能成为用户本金所有人、市场 creator 或 salt namespace。协议禁止 `tx.origin`、公开的任意 `user/creator` 转发入口、跨交易暂存用户资产和通用签名执行器。

## 2. depositAndAllocate

采用 Vault 模块入口：

```solidity
depositStockFor(address user, uint256 amount) // AllocationManager only
```

固定流程：

```text
user calls AllocationManager.depositAndAllocate(marketId, depositAmount, allocationAmount)
-> user = msg.sender
-> validate market PoolCreated + ACTIVE, asset ACTIVE and amount rules
-> Vault.depositStockFor(user, depositAmount)
   -> Vault.safeTransferFrom(user, Vault, depositAmount)
   -> require exact balance delta
   -> credit deposited[user]
-> require freeBalanceOf(user) >= allocationAmount
-> settle Gauge and lock allocation for the same user
-> create/merge pending and reset whole-position 24h lock
```

用户只授权 Vault，不授权 Manager；Manager 和 Vault 均不持有跨交易临时余额。`depositAmount` 可以小于、等于或大于 `allocationAmount`，因为 allocation 可以同时使用用户原有 free balance。任一步失败，deposit 与 allocation 全部回滚。公开 `depositStock` 仍只给 `msg.sender` 记账；`depositStockFor` 只接受 immutable AllocationManager，不能由 Router、治理或公众调用。

## 3. launchAndBuy

采用 Factory 模块入口：

```solidity
createMarketFor(address creator, CreateMarketParams params) // immutable LaunchAndBuyRouter only
```

固定流程：

```text
creator calls LaunchAndBuyRouter.launchAndBuy(params, firstBuyAmount, minTokensOut, recipient)
-> creator = msg.sender
-> native Quote requires msg.value == launchFee + firstBuyAmount
-> ERC-20 Quote requires msg.value == launchFee and pulls firstBuyAmount from creator
-> Factory.createMarketFor(creator, params)
-> Factory derives marketId/CREATE2 salt namespace from creator, never Router
-> Router executes the new Curve's one permitted initial buy
-> bought Meme goes to explicit recipient
-> unused native/ERC20 Quote is returned to creator
```

`creator` 是市场身份和 salt namespace；`creatorRevenueBeneficiary` 是可单独指定的收入受益人，二者不得混为一个字段。Factory 的普通 `createMarket(params)` 固定使用自身 `msg.sender`。`createMarketFor` 只信任登记的 immutable Router；Router 不提供 `launchAndBuyFor(arbitraryCreator, ...)`。首买不设置人为的毕业门槛百分比上限；最大实际成交由曲线剩余 `sellableTokens`、尾单 partial fill、退款和 `minTokensOut` 共同决定。若未来增加 relayer，必须另开 executionSpecId 并使用带 chainId、nonce、deadline、完整 params hash 的 EIP-712 授权，本版本不预留通用签名入口。

Router 不发与 Factory/Curve 重复的摘要事件。创建身份以 Factory 的 `MarketCreated` 为准；首买、退款、最终 `LaunchSwept` 和自动毕业失败以 exact Curve 的事件为准；成功建池以 GraduationExecutor 的 `PoolGraduated` 为准。

## 4. 不变量

1. 组合调用前后，本金只从 user 到其 Asset UID 对应 Vault；买入资产只到 explicit trade recipient。
2. `depositAndAllocate` 记录的 user 必须等于最外层调用者；内部模块不能替换。
3. `launchAndBuy` 的 creator 必须等于 Router 最外层调用者；marketId 与 salt namespace 不得包含 Router 身份。
4. beneficiary 不改变 creator 身份；recipient 不改变 creator 或 beneficiary。
5. 不使用 `tx.origin`、delegatecall、permit 任意 call target 或跨交易 Router 余额。
6. Router 调用结束时不保留 creator 的原生或 ERC-20 Quote；未花费首买金额只能退回 creator，不能退给可任意指定的 recipient。
