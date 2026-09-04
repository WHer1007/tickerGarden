# TickerGarden V1 Accumulator 数值域与 Dust 报告

> **适用性说明（2026-09-04）：** 本报告中的 Emergency/市场状态 Gas 与状态机结果属于旧管理架构历史数据；永久自治改造后必须重新测量。用户 rageQuit 本金路径和异步奖励结算是当前目标，资产/配置 pause/retire 仍独立保留。

> 任务：`V1-T-202-B`
> 状态：`V1-EXEC-8 FROZEN TEST EVIDENCE / FORFEITURE PROOF RESIDUAL OPEN`
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

## 5. Rage Quit 弃权重分配的证明边界

`rageQuit`移除退出用户后，若仍有其他Active staker且清理时的cohort nonce与有效权重仍等于退出快照，会把该用户已经形成的整数收益重新送入同一奖励资产accumulator。这个动作会在没有新增FeeVault credit时增加`accFeePerShare`，但它只转移已存在的Staker entitlement，不能增加FeeVault的`totalLiability`；没有剩余Active或延期期间cohort变化时则改记forfeiture reserve。cohort变化但当前仍有Active时，不得吸收仍属于存续staker的global index remainder。

对一个初始reward `R`，连续退出只会把该reward的既有份额逐步转给剩余权重；当所有中间分母均不低于`Smin=414`时，其累计重分配效果应受`R × P / Smin`同阶上界约束，而不会按退出人数复制reward。现有实现以checked arithmetic fail closed，产品测试已覆盖双资产两用户重分配、最后用户reserve，以及FeeVault失败或耗尽固定gas额度时先返还本金、再由Gauge保存待补记金额并由permissionless `flushDeferredForfeiture()`恰好成功补记一次；该重试不受历史Gauge emergency flag阻断。

但当前机器证明尚未把“3个以上不同权重用户连续rageQuit + denominator变化 + index/user/forfeiture remainder归一化”写成独立形式化不变量。因此本报告不把该组合场景声明为完全证明；外部审计前必须补充数学推导和多用户双资产连续退出fuzz，并确认它仍被上述每credit最小分母上界覆盖。该项当前是证明覆盖缺口，不是已确认的新增负债或可提取资金漏洞。

## 6. 复现

```bash
cd contracts
FOUNDRY_PROFILE=v1 forge test --match-path test/v1/shared/MarketFeeAccounting.t.sol -vv
FOUNDRY_PROFILE=v1 forge test --match-path test/v1/shared/MemeStockGaugeAccumulators.t.sol -vv
python3 -m unittest spec.test_v1_execution_spec
```
