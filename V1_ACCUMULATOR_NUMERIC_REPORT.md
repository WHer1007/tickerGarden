# TickerGarden V1 Accumulator 数值域与 Dust 报告

> **适用性说明（2026-09-04）：** 本报告中的 Emergency/市场状态 Gas 与状态机结果属于旧管理架构历史数据；永久自治改造后必须重新测量。用户 rageQuit 本金路径和异步奖励结算是当前目标，资产/配置 pause/retire 仍独立保留。

> 任务：`V1-T-202-B`
> 状态：`V1-EXEC-9 FROZEN TEST EVIDENCE / FORFEITURE PROOF RESIDUAL OPEN`
> 日期：2026-09-04

## 1. 冻结数值域

- STOCK decimals：逐一覆盖 `6..18`；费用权重只使用实际 active raw balance，不再派生10 STOCK饱和值。
- 单次 reward、会计 amount 与 canonical STOCK supply 上界：`int128.max`。
- 每个Asset的业务最低仓位由管理员经48小时延迟动态配置；精确接受`position >= minimumAllocation(assetUid)`。协议只冻结算术安全下限`414 raw units`，它不是推荐业务门槛。
- accumulator 精度：`P = 1e27`；单市场、单奖励资产生命周期 credit 上限：`2^48 - 1`。

这些值与 `spec/v1_numeric_bounds.json` 的 `APPROVED_GENERIC_NUMERIC_DOMAIN` 一致。

## 2. 固定边界向量

`MarketFeeAccounting.t.sol` 对每个 decimals `6..18` 分别固定以下向量：

| 有效 STOCK `S` | 结论 |
|---:|---|
| `0` | Staker 为 0，非 LP 余额由 Creator / Platform 对分 |
| `414` | Staker 固定取得`floor(nonLpAmount / 2)`，再由Gauge按实际份额分配 |
| 任意 `S > 0` | Creator / Staker / Platform / LP 为40 / 30 / 30 / 0，与S大小无关 |
| `int128.max` | 与最小正active使用同一固定分桶，Stock stake没有上限或饱和分支 |

分桶始终满足 `creator + staker + platform = nonLpAmount`；所有整数 residual 确定性进入 Platform，不存在未记账单位。

`MemeStockGaugeAccumulators.t.sol` 使用协议安全下限414及多个更高管理员配置值（500,000 raw units、10e18 raw units）和`int128.max` reward，逐次验证：

```text
reward × P + oldPoolRemainder
= accumulatorDelta × activeStock + newPoolRemainder
newPoolRemainder < activeStock
```

并在 `activeStock = reward = int128.max` 时得到精确 `accumulatorDelta = P`、`remainder = 0`。

## 3. 多用户与 Dust 守恒

四用户任意非零 `uint64` raw-unit 比例、任意非零 `uint96` reward 的 256-run fuzz 直接组合池级 credit 与用户结算，逐次验证：

```text
reward × P
= sum(integerClaimable) × P
  + sum(userRemainder)
  + poolRemainder
```

其中每个 `userRemainder < P`，且 `poolRemainder < activeStock`。四用户测试中暂时尚未形成整数 claim 的差额最多 4 raw reward units，但等值 scaled 权益全部保存在 pool/user remainder 中；因此 P007 定义下的永久经济 dust 为 `0`。用户数量增加只会增加分别归属各用户的暂存 fraction，不会把它丢失、转给其他用户或跨资产合并。

## 4. 生命周期 Overflow 证明

Solidity 固定证明使用最不利组合：

```text
Rmax = int128.max
Smin = 414
Amax = int128.max
Nmax = 2^48 - 1

maxDelta = floor(Rmax × P / Smin)
         + floor((Amax - 1) / Smin)
         + 1
         = 410969042175046453458181893444505529438331477612771265014212816

maxAccumulator = Nmax × maxDelta
               = 115677501575021392952934502843251004716326723164096785336269155381167824754480
```

`uint256.max / maxAccumulator = 1`，剩余约0.099% headroom；因此414是当前证明允许的最小值，不能由管理员进一步降低。实现同时对人工构造的 accumulator/pendingFee 越界状态执行原子回滚，证明超出批准域时 fail closed，而不是静默截断。

## 5. Rage Quit forfeiture 归属与数值边界

`rageQuit` 移除退出用户后，退出用户已经形成但尚未领取的 Quote/Meme 奖励不再进入任何 staker accumulator，也不根据 Active staker 数量、cohort nonce 或清理时序分支。Gauge 将其交给 `ProtocolFeeVault.recordForfeiture`，统一记为平台 forfeiture reserve；这不会增加任何用户的 `totalLiability`，也不会把旧收益暴露给后加入者。正常新手续费仍按当前有效 Active 权重分配，但 rageQuit forfeiture 与正常分配路径严格隔离。

现有实现以 checked arithmetic fail closed，测试已覆盖双资产退出、平台 reserve 记账，以及 FeeVault 失败或耗尽固定 gas 额度时先返还本金、再由 Gauge 保存待补记金额并由 permissionless `flushDeferredForfeiture()` 补记一次；该重试不受历史 Gauge emergency flag 阻断。ABI 中 legacy `redistributed` 字段保留用于兼容，但恒为 `false`。

因此不再需要以“连续退出重分配效果”作为当前协议不变量或形式化证明目标。仍需持续验证的是：每次 forfeiture 金额只记账一次、deferred flush 幂等、reserve 余额 delta 精确，以及本次记账失败绝不影响已完成的本金退出。

## 6. 复现

```bash
cd contracts
FOUNDRY_PROFILE=v1 forge test --match-path test/v1/shared/MarketFeeAccounting.t.sol -vv
FOUNDRY_PROFILE=v1 forge test --match-path test/v1/shared/MemeStockGaugeAccumulators.t.sol -vv
python3 -m unittest spec.test_v1_execution_spec
```
