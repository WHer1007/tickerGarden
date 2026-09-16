# 最新合约开销审查

日期：2026-09-13。对象是包含 Creator 可选 LP 费率的当前未提交源码，不等同于现有测试网部署。源码指纹和原始日志见 [证据目录](evidence/contract-cost-review-2026-09-13/)。本轮新增测量测试和报告，没有修改生产合约、部署、广播或启用周期任务。

## 结论与范围

仍有优化空间，主要在手续费临时状态的持久存储、Stake 激活快照写入、重复返回完整市场配置，以及每市场的完整合约部署。Locker 和 Holder 后台调用还可以通过按需执行减少次数。不能把删除资产检查、降低结算预算或减少用户权益记录当作等价优化。

覆盖创建/首买、Curve 买卖/毕业、v4 Hook/FeeVault 入账、奖励分配/领取、Stock 存取/Stake/退出、Holder 快照发布、Locker 收费/复投、Registry 读取及 runtime 体积。本文是开销审查，不替代新增安全审计，也不提供部署放行。候选项没有实施前后 A/B 实测，因此不承诺节省百分比。

## 当前实测基线

编译：Solidity 0.8.26，Cancun，optimizer runs=200，项目 v1 profile。

| 测量场景 | Gas | 解释 |
| --- | ---: | --- |
| 未启用 Stake 的卖出 swap | 512,008 | 新增 `ContractCostBaseline.t.sol` 中 `_sell()` 区间 |
| 已有活跃 Stake、无待激活桶的卖出 swap | 605,229 | 同一 fixture，真实 Gauge clone，先独立 checkpoint 激活 |
| 30 个成熟桶、双资产累计指数非零的 swap | 3,253,289 | 既有 `CurrentContractOptimizationBoundary.t.sol` 测量区间重新执行 |

前两项对共同的 Router、PoolManager、Hook、FeeVault、Registry、两个代币执行 `vm.cool`，第二项额外冷却 Gauge/实现/权重 mock；并非将所有依赖均恢复为生产交易初始状态。使用真实 PoolManager、Hook、FeeVault 和 Meme Token，但 Registry、Quote、Creator Registry 和 Allocation 权重来源含 mock。fixture 开启 Holder 分享，LP 费率为 0；不是所有业务配置的统一报价。30 桶用例的冷却集合和准备过程不同，不将其与前两项相减作为桶的净成本。

这些是执行区间消耗，不是交易 receipt `gasUsed`，没有统一计算 intrinsic gas、最终退款或 RH 数据发布成本。活跃 Stake 场景的整笔测试 gas 与区间不同，不能混用。没有把 Gauge 的 4,000,000 gas 上限当作正常实际扣费，也没有按实时 ETH/RH 费率换算金额。

产品 `--gas-report` 另外包含创建、Curve、Vault、Stake、Locker 调用；快照目录另跑 gas report。其统计混合成功/预期失败、不同冷热状态、mock 和不变量操作。例如 Factory 的最大值受到特殊失败场景影响，不能拿最大/平均值当作正常创建费用。本报告保留原始分布，但不以其计算优化收益。

## 按实施价值排序的候选

### GC-01：FeeVault 临时入账状态改为更紧凑的布局，优先做 A/B

位置：`contracts/src/v1/shared/ProtocolFeeVaultV4Credit.sol:16,61,81`。

编译器 storage layout 确认 `PendingV4Credit` 占 7 个 slot。`uint32 sourceVersion` 独占一个 slot；把它放在 `address feeAsset` 或 `address source` 后可以装进同一 slot，不缩小任何字段的取值范围，布局可降为 6 个 slot。每次收费 swap 都写入并在 finalize 删除这份上下文，频率高。

这是最适合先测的小改动，但删除退款有上限，编译器的掩码读改写也有成本；7→6 个 slot 不代表整笔 Gas 降低 1/7。应同时测首次/后续入账、Native/ERC20、回调回滚、多 swap 同交易、运行字节码。仅适用于新部署，不能直接改变已有实例的存储布局。

### GC-02：用 transient storage 保存跨回调的交易内上下文

位置：`ProtocolFeeVaultV4Credit.sol:40,69,109`、`ProtocolFeeVaultCurveCredit.sol:14,87`；Factory 的 `_prepareCurveInitialization` 在 `TickerGardenFactoryV1.sol:423` 附近。

V4 begin→转账→finalize、Curve sweep begin→finalize 的 pending 内容只需要存活于同一交易。Factory 也把 Curve 构造快照写入 storage，构造完成后立即删除。这些是 transient storage 的候选。Curve、Locker 等使用的持久 ReentrancyGuard 也可单独评估 transient guard。

这是高频交易的重点改造候选，安全敏感程度高于 GC-01。必须保留同一交易中跨子调用共享的锁、原生 receive 校验、失败子调用回滚、第二次顺序调用可用、FeeVault self-call 的 `_creditState == 2` 边界。不得迁移真正跨交易的 nonce、负债、待领取权益和 Locker 未复投余额。显式清理仍有必要，不能依赖交易结束自动清零来放松 multicall 重入边界。

项目编译目标已是 Cancun，但生产采用前仍须在目标链验证 TLOAD/TSTORE 行为及部署工具支持。此次没有编译此候选，更没有链上验证或节省数值。普通字段重排与 transient 改造是同一成本的不同方案，收益不能相加。

### GC-03：Stake 成熟桶优先减少快照写入，其次减少无效扫描

位置：`MemeStockGaugeActivationWheel.sol:24`、`MemeStockGaugeActivationSnapshots.sol:42`、`IV1Protocol.sol:175`、`UserStockVaultRewardAccounting.sol:136,156`。

队列固定 32 个槽，已经在 pending 总量为 0 时提前返回；不是随持有人数增长的无限遍历。仍有 pending、但尚未成熟时会扫描；成熟时会逐桶记录双资产指数、引用数和 processed 标记。

`ActivationSnapshot` 有两个 uint256 指数、uint256 refs 和 bool processed，当前布局需要四个 slot。可研究独立的内部紧凑表示，例如把 refs 和 processed 合并表示，并通过 getter 保留原外部接口；但必须先证明引用数边界，或证明以 refs 非零表示未清理快照与当前 generation/删除规则完全等价。不能为省一个 slot 随意截断 refs、缩小金额/指数或把不同激活秒的权益混成一个桶。

对“存在未来桶但尚无成熟桶”可试验 earliest activation 或占用位图，避免每次都扫描 32 槽。它会增加 Stake/取消/退出时的维护写入；必须按真实读写频率比较，不能只测 swap。也不能消除成熟时必须记录的历史权益。

已有公开 `checkpointActivations()` 可让维护者提前承担部分成熟处理成本；这转移并平滑交易成本，不保证降低全系统总 Gas，也不能成为交易可用性的唯一依赖。用户尚未授权启用周期执行，本轮不启用。

`STAKER_SETTLEMENT_GAS=4,000,000` 和 reserve=300,000 是故障隔离及防止故意少供 Gas 的安全预算。不得凭普通场景消耗降低预算；完成真实 Allocation/Vault、30 桶、双资产和故障分支的上界验证后才能重新评估。

### GC-04：高频调用使用专用市场 getter，保留转账前后验证

位置：`TickerGardenMemeHookBinding.sol:131`、`ProtocolFeeVaultV4Credit.sol:166`、`UserStockVaultRewardAccounting.sol:108`。

已有测试 `HolderPoolFlow.t.sol:test_swapReusesSlot0AndFinalizedMarketSnapshot` 确认普通 swap 读取完整市场三次：Hook、FeeVault begin、FeeVault finalize。当前 MarketView 编码为 22 个 ABI word；不等同于 22 个独立 storage slot。Hook 还读取完整 canonicalPoolKey 后再次 hash。

可新增有明确字段集合的 `feeSource`/市场身份 getter，返回实际需要的地址、阶段、sourceVersion、税率和 policy，而不搬运整份创建信息；或者为不变 PoolKey 暴露哈希。保持现有 `market()` 兼容前后端，仅让热路径用窄接口。Stake/Vault 的市场绑定读取也可按同样原则审查。

不能直接删除 begin/finalize 中任一个来源复核：中间有外部代币转账。也不能由调用者传入未验证的 MarketView 替代 Registry。此项涉及多个模块、ABI/产物和源版本边界；字节码可能增大，必须同时通过 Factory/FeeVault 体积 gate。

### GC-05：持续增长的 feeId 消耗表，可研究但不建议直接删除

位置：`ProtocolFeeVaultV4Credit.sol:42,109,158`、`ProtocolFeeVaultV4Accounting.sol:28,95`、`ProtocolFeeVaultLiabilities.sol:183`。

每个唯一 feeId 都新增永久 consumed 记录，同时 V4 按 pool 保存连续 nonce，Curve 另有 sweep nonce。长期来看这是随收费事件增长的状态开销。

可以研究让正确域分隔的单调 nonce 成为唯一防重放依据。但必须证明跨 market、pool、sourceVersion、Curve→V4、失败重试、外部调用重入仍不可重放，并解决公开 `consumedFeeId()` 的历史查询兼容。只保留事件不能作为合约内重放校验。这是协议/接口改造，优先级低于不改变语义的存储压缩。

### GC-06：降低每市场部署成本属于架构级候选

位置：`TickerGardenFactoryV1.sol:159,321`、`GraduationExecutorPoolExecution.sol:184,270`。

Curve 是每市场部署完整 runtime（17,829 bytes）；Locker 毕业时部署完整 runtime（8,771 bytes）。Gauge 已采用固定实现 clone，不能再把 Gauge clone 当成未完成优化。Factory 的固定部署 delegate target 用于搬出 creation code，并不意味着 Curve 本身已经是 clone。

可评估 Curve/Locker 固定实现、不可升级的 clone 或带不可变参数的代理。收益来自减少重复部署代码；代价是每次调用的转发、配置加载以及构造期身份验证重构。Curve 交易频繁、Locker 调用相对较少，二者应分别计算生命周期收支。必须保证无可变 implementation 管理权、每市场存储隔离、CREATE2 预测/经济哈希/初始化只能一次等边界。

先做独立新版本实验，不在本次审查中迁移现有市场或引入可升级代理。也不为降低最后买入 Gas 拆开原子毕业；这是用户已确认保留的业务设计。

### GC-07：Locker/快照先减少不必要调用次数

`LaunchLockerCompounding.sol:65` 的 `compoundLockedFees` 已内部调用 `_collect`。Keeper 若准备立即复投，不必先额外发一笔 `collectLockedFees` 再复投。独立 collect 仍有用途，不删除公开入口。

未来维护策略应在可形成有效双边流动性、费用积累足以覆盖操作成本时复投；单边不足、零费用、金额很小时跳过。链下估算和模拟后才提交，避免固定时间机械复投。只合并交易次数不会保证每次增加的流动性价值足以覆盖长期收益，应单独设运维策略。

`HolderRewardsDistributorV1.sol:227` 已支持最多 32 个发布项。`CanonicalBlockClock.number()` 当前在每项调用中读取，可在入口获取一次并传入 `_publish`；RH 分支调用 ArbSys，批量时可去掉重复读取，属于低风险、待测的小项。不同 snapshotBlock 的 hash、各市场预算和资产偿付检查仍逐项保留。

Holder 使用 `claimedAssets[market][round][account]`，每个钱包/轮次独立 storage slot。海量领取下可研究带 leaf index 的位图；这会更改 Merkle leaf schema、proof 生成、前后端和双资产独立领取语义，暂列后续版本，不与当前小优化混做。轮次 root/剩余预算不应为清理存储而提前删除，旧轮次权益仍有效。

## 体积约束

| 合约 | 当前 runtime bytes | 项目预算 | 预算余量 | EIP-170 余量 |
| --- | ---: | ---: | ---: | ---: |
| Factory | 23,824 | 24,000 | 176 | 752 |
| FeeVault | 23,104 | 23,500 | 396 | 1,472 |

检查通过，但空间很紧。不要把项目预算余量写成链上硬限制余量。optimizer runs/viaIR 调参必须比较整个交易生命周期与代码哈希；不能为了体积 gate 临时放宽预算，也不能拿旧部署清单继续部署新字节码。

## 不建议省略的开销与已完成优化

- FeeVault、Stock Vault、Locker 的到账差额、最终偿付、资产身份与回调后的复核保留。跨外部调用复用旧余额会重新引入亏空/捐赠干扰问题。
- Locker 的 LP 身份、流动性前后、PositionManager sweep 隔离与精确使用额度保留。ERC20/Permit2 每资产批准再撤销是授权边界；永久大额授权不是本轮等价优化。
- Creator/Staker/Holder 分账、Creator epoch、双资产独立领取、舍入余数及 rageQuit 奖励截止不合并。销毁时机维持用户确认的设计。
- Router 的首次 Quote 配置复用已经完成；FeeVault finalize 的市场快照复用、Gauge 双资产消费一次、Holder 支付余额复用、空激活队列跳过都已完成，不重复申报收益。
- View/RPC 查询单独执行不消耗用户链上交易 Gas；只有被状态交易调用时才纳入执行成本。离线索引缓存不能替代资金结算的链上权威检查。

## 验证与实施顺序

本轮产品 gas report：21 suites，331 passed；Holder 快照产品：2 suites，21 passed；既有 30 桶专项：1 passed；新增 swap 基准：2 passed。全部成功，具体命令见对应日志和下方。测试数不加上继承重复用例冒充新增覆盖。本轮没有重新跑完整非 Fork/RH Fork/发布 CI，也没有生产交易 receipt 采样。

新增测试类完整重跑 9 项通过（含 7 项继承场景），见 `baseline-regression.log`；`git diff --check` 通过，最终核验生产源码与本轮保存的指纹一致。编译警告来自已有测试 mock 的 selfdestruct 和可收紧的测试函数 mutability。

```sh
node tools/check-contract-runtime-size.mjs
node tools/run-forge.mjs inspect ProtocolFeeVault storage-layout --json
node tools/run-forge.mjs test --match-path 'test/v1/product/*.t.sol' --gas-report
node tools/run-forge.mjs test --match-path 'test/v1/treasury/product/*.t.sol' --gas-report
node tools/run-forge.mjs test --match-test testAudit_realGaugeThirtyMatureBucketsFitBudgetWithoutLosingRewards -vv
node tools/run-forge.mjs test --match-contract ContractCostBaselineTest --match-test testCost_ -vv
```

推荐顺序：先 A/B 验证 GC-01 和批量时钟复用；再设计交易内 transient 上下文与成熟桶快照压缩；之后评估窄市场 getter。feeId 账本、clone 架构和 Holder 位图放入独立版本设计。每项只有在语义回归、真实目标链验证、产物一致性和 runtime gate 均通过后才能报告为已实现的优化。
