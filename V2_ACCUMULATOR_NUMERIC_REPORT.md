# TickerGarden V2 Accumulator 数值域与 Dust 报告

> 任务：`V2-T-202-B`  
> 状态：`FROZEN TEST EVIDENCE`  
> 日期：2026-09-03

## 1. 冻结数值域

- STOCK decimals：逐一覆盖 `6..18`；每个 decimals 均派生 `B = 10 × 10^decimals`。
- 单次 reward、会计 amount 与 canonical STOCK supply 上界：`int128.max`。
- 最小合法非零仓位：`floor(10^decimals / 2) + 1`；全域最小值为 6 decimals 下的 `500,001` raw units。
- accumulator 精度：`P = 1e27`；单市场、单奖励资产生命周期 credit 上限：`2^48 - 1`。

这些值与 `spec/v2_numeric_bounds.json` 的 `APPROVED_GENERIC_NUMERIC_DOMAIN` 一致。

## 2. 固定边界向量

`MarketFeeAccounting.t.sol` 对每个 decimals `6..18` 分别固定以下向量：

| 有效 STOCK `S` | 结论 |
|---:|---|
| `0` | Staker 为 0，非 LP 余额由 Creator / Platform 对分 |
| `1` | 线性公式在最小正值处精确向下取整 |
| `B - 1` | 饱和前最后一个 raw unit 仍按线性公式 |
| `B` | 达到 20 / 40 / 20 / 20 固定分桶 |
| `B + 1` | Staker 上限不再增长，全部 active 仍留给 Gauge 内用户比例分配 |

分桶始终满足 `creator + staker + platform = nonLpAmount`；所有整数 residual 确定性进入 Platform，不存在未记账单位。

`MemeStockGaugeAccumulators.t.sol` 对每个 decimals 使用对应最小合法仓位和 `int128.max` reward，逐次验证：

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
Smin = 500,001
Amax = int128.max
Nmax = 2^48 - 1

maxDelta = floor(Rmax × P / Smin)
         + floor((Amax - 1) / Smin)
         + 1
         = 340281686357565748331877944016162546049846363770647066137636

maxAccumulator = Nmax × maxDelta
               = 95780779742558228248573271207669416566285394209083720090990696582777711580
```

`uint256.max / maxAccumulator = 1,208`，因此批准生命周期内 accumulator 不可溢出。实现同时对人工构造的 accumulator/pendingFee 越界状态执行原子回滚，证明超出批准域时 fail closed，而不是静默截断。

## 5. 复现

```bash
cd contracts
FOUNDRY_PROFILE=v2 forge test --match-path test/v2/shared/MarketFeeAccounting.t.sol -vv
FOUNDRY_PROFILE=v2 forge test --match-path test/v2/shared/MemeStockGaugeAccumulators.t.sol -vv
python3 -m unittest spec.test_v2_execution_spec
```
