# V1 数学与状态机参考规格

> 任务：`P-002`
>
> 状态：`REVIEW`。公式、舍入、边界和可执行测试向量已经完成；在产品与安全负责人签字前，不得把对应 G0 项标记为 `APPROVED`。
>
> 权威参考实现：[`spec/reference_math.py`](./spec/reference_math.py)；测试：[`spec/test_reference_math.py`](./spec/test_reference_math.py)。Solidity 实现必须做差分测试，不能重新解释本文公式。

## 1. 冻结结论

| 主题 | V1 决定 |
|---|---|
| Token 精度 | Ticker Meme Token 固定 18 decimals |
| 总挖矿预算 | `TotalMiningBudget = MaximumSupply`；无预挖、团队份额、空投或额外创世铸造 |
| 两池预算 | 股票池向下取整 70%，全部余数归 LP 池；两者之和严格等于总预算 |
| 排放时钟 | `block.timestamp`，不使用区块高度 |
| 股票池窗口 | 固定 `1460 days = 126,144,000 seconds` |
| LP 窗口 | 股票池开始后 7 天启动，与股票池同一时刻结束，即 `1453 days` |
| 排放曲线 | 初始速率为平均速率 1.5 倍，线性衰减到 0.5 倍；累计函数见第 3 节 |
| 错过排放 | 零有效份额和股票软门槛不足造成的未释放额度不积压、不追赶 |
| 暂停 | 普通暂停不移动起止时间；现有有效份额继续结算，零份额区间仍永久错过 |
| 期末 | 停止产生新的 `ReleasedBudget`；从未释放的额度永久取消；期末前已赚取但未领取的奖励仍可领取 |
| Stock 软门槛 | 创建市场时用 multiplier-adjusted 官方 Feed 计算 10,000 美元对应的完整 Token 数量并向上取整，之后冻结原始单位目标 |
| 用户奖励精度 | 全局指数为 `1e27`；用户保存 `accumulatorPaid`、整数 pending 与小数 remainder，乘法使用 `mulDiv/mulmod` |
| 领取 | 每来源至少间隔 7 天；20% 向下取整立即到账，余数全部进入 56 天线性归属 |
| Escrow 上界 | 每用户、每奖励来源最多 8 个活跃 tranche；槽位固定，不使用无界数组 |
| Bucket | 买入侧两个 40% 向下取整，全部余数归协议收入；卖出侧 100% 进入 Ticker Meme burn Bucket |

股票池的精确日历开始时间仍属于每个市场的 launch manifest 参数，不是全局常量；一经市场创建即不可修改。

## 2. 三层供应会计

必须区分以下三个量：

```text
ScheduledBudget(t)  理论曲线在 t 时刻走过的预算
ReleasedBudget      在有效份额和软门槛规则下已经分配给 Gauge 用户的预算
MintedSupply        用户领取时已经实际铸造的 Token
```

核心关系：

```text
0 <= PoolMinted <= PoolReleased <= PoolBudget
MintedSupply = StockPoolMinted + LPPoolMinted
MintedSupply <= MaximumSupply
CanceledAtEnd = MaximumSupply - StockPoolReleased - LPPoolReleased
```

`ReleasedBudget` 在每次 Gauge checkpoint 时增加。用户 claim 只把已经释放并通过奖励指数归属给该用户的额度转为实际铸币，不再消耗新的排放时间额度。因此：

- 截止时间后 `ReleasedBudget` 永远不能增加；
- 截止时间后仍允许 claim，并可使 `MintedSupply` 增加，但必须满足 `PoolMinted <= PoolReleased`；
- 这不是补发或追赶，而是领取截止时间前已经形成的权益；
- `CanceledAtEnd` 永远不能重新进入 `ReleasedBudget` 或 `MintedSupply`；
- burn 只减少 `totalSupply()`，不减少 `MintedSupply`、`PoolMinted` 或 `PoolReleased`。

Controller 不盲信 Gauge 提交的累计数：每次 `recordRelease` 都要求 `ScheduledCumulative` 精确等于当前链上时间的曲线值，并强制：

```text
ReleasedCumulative >= PreviousReleased
ReleasedDelta <= ScheduledCumulative - PreviousScheduled
```

第二条约束使此前已 checkpoint 为零释放或低系数释放的额度无法在未来追赶。`finalizeEmission` 只能在共同终点后执行，并要求股票池与 LP 池都已把 `PreviousScheduled` checkpoint 到各自完整预算；因此公开 finalizer 不能抢先取消 Gauge 尚未结算的最后一段。finalize 后禁止继续增加 Released，但既有 `PoolMinted < PoolReleased` 的 claim 永久可用。

该分层避免要求用户必须在第 1460 天前手动领取，也避免把无人质押期间的预算后来分给新用户。

## 3. 排放累计函数

对任一池定义：

```text
B = PoolBudget
S = EmissionStart
E = EmissionEnd
T = E - S
d = clamp(timestamp - S, 0, T)
```

累计计划排放使用纯整数公式：

```text
C(B,S,E,t)
= floor(B * (3*d*T - d*d) / (2*T*T))
```

等价连续形式为 `B × (1.5x - 0.5x²)`，其中 `x=d/T`。瞬时速率为：

```text
r(d) = B * (3*T - 2*d) / (2*T*T)
```

因此初始速率为 `1.5B/T`，结束前速率为 `0.5B/T`，不存在尾部、跳变或归零前悬崖。边界强制为：

```text
t <= S  => C = 0
t >= E  => C = B
```

每次 checkpoint 先把时间夹到 `[S,E]`，再计算：

```text
ScheduledDelta = C(now) - C(lastUpdate)
lastUpdate = clamp(now, S, E)
```

累计函数只在最终除法时向下取整，禁止先计算浮点 `x`，也禁止逐秒循环。

### 3.1 股票池实际释放

```text
effectiveStake = min(totalStaked, targetStockAmount)
coefficient = effectiveStake / targetStockAmount
```

为避免 checkpoint 频率改变结果，保存 `coefficientRemainder`：

```text
numerator = ScheduledDelta * effectiveStake + coefficientRemainder
ActualRelease = floor(numerator / targetStockAmount)
coefficientRemainder = numerator % targetStockAmount
```

`totalStaked == 0` 时 `ActualRelease = 0`，本时段 `ScheduledDelta` 永久错过；只保留此前已经存在、但不足 1 个最小奖励单位的 remainder。达到或超过门槛时 `ActualRelease = ScheduledDelta`。

在改变任一用户质押量前，必须先按旧 `totalStaked` checkpoint；更新余额后再更新 reward debt。因此新存入者不能分享存入前的排放，退出者也不会丢失退出前权益。

### 3.2 LP 池实际释放

LP 池不使用 Stock Token 门槛：

```text
totalEligibleLiquidity == 0 => ActualRelease = 0
totalEligibleLiquidity > 0  => ActualRelease = ScheduledDelta
```

`totalEligibleLiquidity` 只统计已订阅、canonical PoolId、精确全区间且当前 liquidity 非零的仓位。LP 开始前的时间及零有效 LP 区间永久错过。

## 4. 奖励指数与用户结算

两个 Gauge 使用相同的累计指数，精度固定为：

```text
INDEX_PRECISION = 1e27
```

全局更新保存 `indexRemainder`：

```text
indexNumerator = ActualRelease * INDEX_PRECISION + indexRemainder
accRewardPerShare += floor(indexNumerator / totalEffectiveShares)
indexRemainder = indexNumerator % totalEffectiveShares
```

`totalEffectiveShares` 会在 stake/withdraw 时变化，因此上一次 checkpoint 的 `indexRemainder` 可能大于新的分母。实现必须先把旧 remainder 对新分母做 `div/mod` 归一化，再合并本次 `mulmod`；不能假设它始终小于当前 shares，否则大额退出后可能出现下溢并锁死 checkpoint/withdraw。该归一化只搬运尚未形成一个 accumulator 最小单位的 scaled numerator，不新增 ReleasedBudget。

用户侧保存：

```text
accumulatorPaid
pending
userRemainder   // [0, INDEX_PRECISION)
```

结算顺序为：

```text
deltaAcc = accRewardPerShare - accumulatorPaid
whole = Math.mulDiv(userShares, deltaAcc, INDEX_PRECISION)
fraction = mulmod(userShares, deltaAcc, INDEX_PRECISION)

pending += whole + floor((userRemainder + fraction) / INDEX_PRECISION)
userRemainder = (userRemainder + fraction) % INDEX_PRECISION
accumulatorPaid = accRewardPerShare
```

改变 shares 前先按旧 shares 结算，改变后只保留当前 `accumulatorPaid`。领取时清零并领取整数 `pending`，`userRemainder` 原样保留供未来累计。

Solidity 禁止直接计算 `userShares * deltaAcc` 或保存 `userShares * accumulator` 形式的 scaled debt，因为极小早期份额会把 accumulator 推高，后来大额加入可能使中间乘积溢出 `uint256`。必须使用 OpenZeppelin `Math.mulDiv` 和 EVM `mulmod`，并用溢出安全方式合并两个均小于 `INDEX_PRECISION` 的 remainder。这使 claim 频率不会抹掉用户小数权益。期末每用户可能保留不足 1 wei 的不可表示尾数；不得把该尾数分给协议、其他用户或恢复为可排放预算。

必须先完成全局 checkpoint，再结算用户，再改变 shares/debt，最后执行 Token mint/transfer。所有外部入口使用非重入保护。

## 5. Stock 软门槛快照

市场创建时读取官方、已写入 manifest 的 Stock Token Feed。该 Feed 已包含 corporate-action multiplier，不能再次乘 `uiMultiplier()`。

```text
wholeTarget
= ceil(10,000 * 10^feedDecimals / positivePriceAnswer)

targetStockAmount
= wholeTarget * 10^stockTokenDecimals
```

门禁条件：

- Stock Token 地址、UID、18 decimals、Beacon 与实现 code hash 匹配批准 manifest；
- Feed 地址、description、decimals 与 heartbeat 匹配 manifest；
- `answer > 0`、`updatedAt > 0`、`answeredInRound >= roundId`；
- `block.timestamp - updatedAt <= heartbeat`；
- L2 sequencer 为 up，且恢复后已经过 1 小时宽限期；
- `oraclePaused() == false`；
- 部署 preflight 未发现 `IN_PROGRESS` corporate action。

任何条件失败都拒绝创建/激活市场，不使用缓存旧价格或链下报价降级。目标值创建后冻结，不进入奖励热路径，也不因后续价格变化自动修改。软门槛不是抵押品风控线，因此不引入持续预言机依赖。

按 P-004 快照的 NVDA Feed 答案 `21900465000`、8 decimals 计算：

```text
ceil(10,000 / 219.00465) = 46 NVDA Token
targetStockAmount = 46e18 raw units
```

该示例不能替代首发当天重新执行 preflight。

## 6. Claim 与 RewardEscrow

每个用户按奖励来源（股票 Gauge 或 LP Gauge）独立执行：

```text
CLAIM_COOLDOWN = 7 days
MAX_ACTIVE_TRANCHES = 8
VESTING_DURATION = 56 days
```

首次 claim 不需要等待；之后要求 `now >= lastClaimAt + 7 days`。零奖励 claim 必须 revert，失败交易不更新时间。

对整数奖励 `R`：

```text
Immediate = floor(R * 2000 / 10000)
Vesting = R - Immediate
```

余数全部进入 Vesting，确保 `Immediate + Vesting = R`。EmissionController 在同一交易中：

1. 校验该 Gauge 的 `PoolMinted + R <= PoolReleased`；
2. 将 `Immediate` 铸给用户；
3. 将 `Vesting` 铸给 RewardEscrow；
4. 增加 `PoolMinted` 与全局 `MintedSupply`；
5. 创建固定槽位 tranche。

每个 tranche 保存 `total`、`released`、`start`。累计已归属量：

```text
Vested(t)
= floor(total * min(max(t-start,0), 56 days) / 56 days)

Releasable(t) = Vested(t) - released
```

在 56 天边界直接得到 `total`，不存在尾数滞留。`releaseVested` 最多扫描 8 个固定槽位。创建新 tranche 时优先使用空槽；若槽位已成熟但尚未领取，先按 checks-effects-interactions 结清给用户再复用。7 天 cooldown 保证第 9 次合法 claim 时第 1 个槽位已经成熟。

退出 Gauge、市场暂停、排放结束或市场退休都不能罚没、加速或重置已有 tranche。

## 7. Bucket 会计

Bucket 主键：

```text
BucketKey = keccak256(chainId, marketId, feeAsset, bucketType)
```

买入侧对已由 Hook 算出的协议费 `F`：

```text
StockBuyback = floor(F * 40 / 100)
TGARDBuyback = floor(F * 40 / 100)
ProtocolRevenue = F - StockBuyback - TGARDBuyback
```

卖出侧：

```text
TickerMemeBurn = F
```

因此任意金额（包括极小额）都严格守恒。Bucket 只保存余额与累计流入/流出，不保存可被卡死的 `EXECUTING` 状态：

```text
totalIn == balance + totalConsumed
```

FeeExecutor 对每种用途使用专用函数。交易中先扣减匹配 Bucket 并登记唯一 `batchId`，再调用固定 Router/Path；任何兑换、输出校验、入库或销毁失败都会让整笔交易回滚，Bucket 与 `batchId` 自动恢复。成功后不得重复使用相同 `batchId`。

Worker 是否达到最小金额/间隔只决定何时提交，不改变链上余额和用途。Router、Path、slippage、deadline、单笔/每日上限属于 G0-12，不在本数学规格中填占位值。

## 8. 市场与模块状态机

### 8.1 市场主状态

```text
REGISTERED -> ACTIVE
REGISTERED -> PAUSED
REGISTERED -> RETIRED
ACTIVE     -> PAUSED
ACTIVE     -> RETIRED
PAUSED     -> ACTIVE
PAUSED     -> RETIRED
RETIRED    -> (terminal)
```

| 状态 | 新风险操作 | 排放 | 用户退出与既有权益 |
|---|---|---|---|
| REGISTERED | 禁止 stake、subscribe、initialize 和 swap | 未开始 | 无用户资金；错误注册可直接退休 |
| ACTIVE | 按模块规则开放 | 按固定时间轴和有效份额结算 | 全部开放 |
| PAUSED | 禁止新 stake、subscribe、initialize 和协议 swap；允许降低风险 | 现有有效份额继续按固定时间轴结算；不延长截止时间 | withdraw、claim、release、unsubscribe、remove liquidity、collect、transfer 始终开放 |
| RETIRED | 永久禁止新风险和 swap | 转入前先 checkpoint；转入后的计划额度永久不释放 | 既有 pending/tranche 可永久领取，资产和 NFT 可退出 |

退休必须是终态。具体 caller、Timelock、紧急条件与函数级暂停矩阵由 P-005 冻结。

### 8.2 正交状态

以下状态不塞入市场主 enum，避免组合爆炸：

- `poolInitialized: false -> true`，只能成功一次；
- `metadataFinalized: false -> true`，只能成功一次；
- 排放阶段由 timestamp 派生为 `NOT_STARTED / ACTIVE / ENDED`，不由管理员切换；
- LP NFT 订阅为 `NONE / ACTIVE / STOPPED`，转移或 unsubscribe 结算后进入 STOPPED，新 owner 可重新建立新的 beneficiary 记录；
- RewardEscrow 槽位为 `EMPTY / ACTIVE / MATURED`，由时间和金额派生；
- Bucket 的 `EMPTY / ACCUMULATING / EXECUTABLE` 由余额和 G0-12 风控阈值派生，不持久化执行锁。

## 9. 测试向量

| ID | 输入 | 预期结果 |
|---|---|---|
| MATH-001 | 总预算 `1,000,000,000e18` | 股票 `700,000,000e18`，LP `300,000,000e18`，和不变 |
| MATH-002 | `B=32,S=0,E=4,t=[0,1,2,3,4]` | 累计 `[0,11,20,27,32]` |
| MATH-003 | 两次各计划释放 5，stake/target=`50/100` | 第一次 `(2, remainder 50)`，第二次 `(3, remainder 0)` |
| MATH-004 | NVDA `answer=21900465000`，Feed 8 decimals | `targetStockAmount=46e18` |
| MATH-005 | 10 奖励、3 shares，一次更新与 4+6 两次更新 | 全局 accumulator/remainder 完全相同；拆分用户结算也保留相同 pending/remainder |
| MATH-006 | `R=101` | immediate 20，vesting 81；第 28 天 vested 40，第 56 天 81 |
| MATH-007 | 每 7 天 claim 一次 | 0–49 天正好 8 个槽；第 56 天第一个槽可复用 |
| MATH-008 | 买入协议费 `F=101` | Stock 40，TGARD 40，Revenue 21，总和 101 |
| MATH-009 | 时间常量 | 股票 126,144,000 秒；LP 延迟 604,800 秒；LP 窗口 125,539,200 秒 |
| MATH-010 | accumulator=`1e56`，后来加入 `uint128.max` LP liquidity | 直接 debt 乘积超过 `uint256`；`accumulatorPaid + mulDiv/mulmod` 新用户 pending 为 0 且不溢出 |
| MATH-011 | 旧 `indexRemainder` 大于 withdraw 后的新 `totalShares` | 先对新分母归一化；checkpoint 不下溢，`ReleasedBudget` 不超计划值 |
| STATE-001 | 所有市场状态边 | 只允许第 8.1 节列出的边；RETIRED 无出边 |

运行：

```bash
python3 -m unittest discover -s spec -p 'test_*.py' -v
```

## 10. 必须保持的不变量

1. `PoolMinted <= PoolReleased <= PoolBudget`，两池预算之和等于 `MaximumSupply`。
2. `ReleasedBudget` 与 `MintedSupply` 单调不减；`CanceledAtEnd` 一经形成不可减少。
3. 任意 checkpoint 拆分不改变固定 stake/liquidity 历史下的池级累计结果。
4. 无有效份额的计划排放不进入 remainder，也不能由未来参与者获得。
5. soft-threshold 系数始终在 `[0,1]`；达到门槛后不超发。
6. 用户 pending 与小数 remainder 不因 claim、withdraw 或 checkpoint 频率减少；中间乘积不依赖可溢出的普通乘法。
7. claim 的 immediate、vesting 与保留 scaled remainder 守恒；退出不罚没。
8. `totalIn == bucketBalance + totalConsumed`；失败执行不改变任一项。
9. PAUSED 和 RETIRED 状态下的用户退出、既有 claim 与 vesting release 永不依赖 Worker、Indexer、Backend API 或管理员恢复。
10. 所有循环严格受 8 个 tranche 或固定数量外部依赖约束，不随用户历史或全局市场数增长。

## 11. 仍属于其他任务的决定

本文件不替代以下门禁：

- G0-07/G0-08：v4 exact-input fee delta、PoolKey、tickSpacing、Hook 权限与首笔价格边界；
- G0-09/G0-10：Subscriber ABI、beneficiary 回调和 Gas 实测；
- G0-11/G0-12：TGARD、允许 Router/Path 及执行风控；
- G0-13/P-005：角色、Timelock、Guardian 和函数级暂停矩阵；
- G0-15：NVDA 供应档位、初始 Symbol、创建者、具体开始时间。
