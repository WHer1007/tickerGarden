# TickerGarden V1 协议参数与产品规则

> **历史发布基线（2026-09-05）：** `V1-EXEC-11` 已实现市场永久自治、管理员准入的多 Quote 白名单与最终买入内原子毕业；`launchPhase` 只允许 `NotGraduated -> PoolCreated`。资产与配置对象的 pause/retire 参数仍保留。确定性部署与固定区块 Fork 证据已经闭合，但尚未广播测试网交易，外部审计和生产 E2E 尚未完成。

> 本轮源码变更状态：`NOT_PRODUCTION_READY / NOT_BROADCAST`；历史基线的发布资格不适用于修改后的源码。
> 更新时间：2026-09-10
> 适用范围：TickerGarden V1；不覆盖、修改或废止任何 Test Prototype 文档
> 发行兼容基线：[Pons V2 官方文档](https://docs.ponsfamily.com/v2)
> 对比参考：[Pump.fun 费用](https://pump.fun/docs/fees) 与 [Pump.fun Bonding Curve](https://pump.fun/docs/bonding-curve)（仅借鉴原则，不复制其点时参数）
> 技术实现基线：参见 [V1_TECHNICAL_ARCHITECTURE.md](./V1_TECHNICAL_ARCHITECTURE.md)
> 可验证执行规范：参见 [V1_EXECUTION_SPEC.md](./V1_EXECUTION_SPEC.md)（当前 canonical 执行规则为 `V1-EXEC-11`）
> Pons 行为基线：参见 [V1_PONS_BEHAVIOR_BASELINE.md](./V1_PONS_BEHAVIOR_BASELINE.md)
> Stock Vault 架构决策：参见 [V1_MULTI_ASSET_STOCK_VAULT.md](./V1_MULTI_ASSET_STOCK_VAULT.md)
> 品牌文化与用户语言：参见 [brand/BRAND_CULTURE_AND_ECOSYSTEM.md](../../brand/BRAND_CULTURE_AND_ECOSYSTEM.md)

本文把用户已经确认的产品规则写入“已冻结”章节。Pons runtime 行为、管理员风险审查后的 Quote 白名单集合、通用数值域，以及 Robinhood 官方目录当前观测到的194种 STOCK 全量可选 Base 规则已经形成机器证据。当前已实现的 STOCK 路径只作为质押 Base 和分配权重，不使用价格、USD 名义目标或 backing target；Stock Token 作为 Quote 可走通用 `addQuoteConfig`，并可选提交显式指纹承诺。194 个 Base 不自动成为 Quote，Stock Quote 为 `NO_ACTIVE_CONFIG`；确定性价格配置生成器和产品参数/首批 allowlist 属于 `PENDING_PRODUCT_ACTIVATION`。上述为 2026-09-05 基线记录。2026-09-10 的批处理 Holder 和奖励兑换保护属于新候选版本，尚未部署，不能继承历史发布资格；规则见 [连续收益说明](../operations/HOLDER_CONTINUOUS_REWARDS.md)。

## 1. 版本边界

TickerGarden V1 放弃 Test Prototype 的 Stock Token 质押增发 Ticker Meme、LP 挖矿和持续排放模型。V1 的 Ticker Meme 不再作为质押奖励被持续铸造；Stock Token 持有者获得的收益只来自对应 Meme 已经实际产生并到账的交易手续费。

Test Prototype 文件继续保留为历史设计与已完成工作的记录。任何 Test Prototype 与本文冲突的机制，只在 V1 中由本文取代；不得直接修改 Test Prototype 文档使其看起来像 V1。

V1 的核心定位为：

```text
Pons V2 兼容发行基线
+ 一个官方 STOCK 对应多个 Ticker Meme
+ 用户在 Meme 毕业后用真实 STOCK 自由配置其质押池
+ 每个市场创建时选择一种获批 Quote Asset
+ 按池、按实际收费资产原样分配 Quote 或 Ticker Meme 手续费
+ 只有完成毕业并进入 PoolCreated 的市场才开放 STOCK 质押
+ 毕业后固定按 afterSwap unspecified currency 收取 TickerGarden 基础费 1%，进入 FeeVault 统一记账，PoolKey.fee 与 LP fee 为0；pinned v4 Core protocol fee 由 PoolManager 独立收取并单独展示
+ 毕业后启用固定 Meme Gauge 和手续费分配规则
```

Ticker Meme 是文化与社区用途的 meme token，不代表对应股票的所有权、股东权、固定赎回权、收益承诺或价格跟踪关系。

## 2. 已冻结的 V1 原则

1. Ticker Meme 不再通过 Stock Token 质押或 LP 质押持续增发。
2. V1 不设置 Ticker Meme 挖矿排放、EmissionController、LP 挖矿预算或奖励归属期。
3. 所有 Ticker Meme 的发行、定价、曲线交易、反狙击、部分成交、毕业状态机和永久锁定流动性以一个经版本化冻结的 Pons V2 基线为准，不再只是“Pons V2 风格”。
4. V1 删除自定义的 `2,500 USDC` 毕业门槛和 `1% LaunchAllocation`。Ticker Meme 固定总供应量全部铸入曲线，但曲线只出售 Pons V2 公式确定的 `sellableTokens`；毕业池的 `reservedTokens` 由 `supply`、所选 Quote Asset 的 `phantomQuote` 与 `graduationThreshold` 推导，不是独立百分比参数，也不存在跨 Quote 通用的固定毕业金额。
5. 每个 Ticker Meme 创建时必须选择并永久绑定一个 Registry 认证的官方 Stock Token `Asset UID`。
6. 同一个 `Asset UID` 可以对应任意数量的 Ticker Meme；V1 不再执行“一种 STOCK 只能有一个官方 Meme”的唯一性约束。
7. 每个 Vault schema 版本设置一个共享 MultiAsset `UserStockVault`，所有本金账本以 Asset UID 隔离；每个 Ticker Meme 设置一个独立的轻量 `MemeStockGauge`。
8. 用户只需把同一种 STOCK 按 Asset UID 存入一次 canonical `UserStockVault`，之后可以自由决定向该 STOCK 下任意多个已经进入 `PoolCreated` 的 Meme Gauge 分配多少 STOCK。
9. 合约层不设置一个钱包参与 Meme 的固定数量上限。每钱包一个 Meme 或最多五个 Meme 的规则均不进入 V1 协议；用户实际可参与数量仍受其 STOCK 本金、每仓位最低值与 Gas 成本限制。
10. 每个非零 Meme 质押仓位必须达到对应 Asset UID 当前配置的 `minimumAllocation`；该值使用 Stock Token raw units，由治理/管理员通过延迟权限更新。它不是 Vault deposit 的门槛；普通存入可为任意正数量。minimum 的可配置范围受 canonical numeric bounds 约束，不要求是固定数量或整数倍。
    `minimumAllocation` 的协议安全下限为 `414` raw units；该下限用于满足每市场/feeAsset lifetime fee-credit 的 `uint48` 累加器边界。管理员可按资产动态提高或降低，但新值不得低于 `414`；该参数按 Asset UID 保存，不是全局统一值。
11. 用户对所有 Meme 的 STOCK 分配总和不得超过其在对应 `UserStockVault` 中的本金余额；同一份 STOCK 不能在多个 Meme 中重复计数。
12. V1 不再从零质押手续费购买 STOCK，也不设置 `STOCK_PURCHASE` Bucket、`FeeExecutor` 或 `ProtocolStockTreasury`。用户 STOCK 本金只存在于 `UserStockVault`，平台和创建者不能使用它制造“协议自我背书”。
13. 每个 Meme 的手续费独立记账。某 Meme 的质押者只能分享该 Meme 实际产生的质押者手续费，不能分享同 STOCK 下其他 Meme 的手续费。基础手续费按实际收到的资产原样分桶；连续 Holder/奖励结算路径可将已记入负债的 Meme 奖励兑换为该市场 Quote，不改变普通手续费的原资产记账规则。
14. 新市场可以选择 `ApprovedQuoteRegistry` 中任意经管理员风险审查、已批准且身份仍有效的 `ACTIVE` Quote；Quote 可以是原生资产或任意 Token，包括可升级 ERC-20、Stock proxy、USDG 与 cbBTC。每个 Meme 创建时只选择一种 Quote，发行后不可更改；曲线买卖、毕业门槛和毕业池以该 Quote 计价。暂停或退休某配置只阻止后续市场，不改变既有市场。毕业池 non-LP 手续费按 Swap 实际收费资产在固定的 Quote/Meme 两种资产中分桶和领取；仅已明确的奖励结算路径可将 Meme 负债兑换为 Quote。
15. 所有质押者奖励按费用发生时的有效 STOCK 数量比例分配，不按钱包数量平均，不使用一钱包一票，也不设置可由拆钱包绕过的地址级收益上限。LP 协议手续费固定为0；存在 Active stake 时按 Creator40%/Staker30%/Platform30%，无 Active stake 时按 Creator70%/Staker0%/Platform30%，Staker 与 Platform 向下取整、余数归 Creator。取消10 STOCK 饱和与线性释放。
16. 只有 `launchPhase == PoolCreated` 且市场处于允许新增仓位的 ACTIVE 状态时，`allocate`、`increaseAllocation` 或 `depositAndAllocate` 才可成功。新增部分先进入 `pendingAmount`，在分配交易时间后满 `30 seconds` 才成为有效份额并开始计奖；等待期间旧 `activeAmount` 继续正常计奖。allocation 不支持 partial decrease 或跨市场迁移。
17. 同一用户在同一 Gauge 最多保存一个 pending 增量；激活前再次增仓时，新数量与原 pending 合并，并把 pending 的 `activationAt` 重置为本次分配时间加 `30 seconds`。已 active 的旧份额不因 pending 重置而停止计奖。
18. 每次新仓位或增仓成功时，整个合并仓位的 `unlockAt` 重置为该笔分配交易时间加 `24 hours`。`unlockAt` 从分配交易而不是激活时点起算；未达到该时间不得正常 claim 或整仓 close。用户级 `rageQuit` 是例外：可绕过24小时，但放弃全部未领取双资产收益并整仓取回本金。
19. 领取、激活和整仓 close 必须先结算旧有效份额的两种手续费权益，再改变有效份额。rageQuit 是本金优先的例外：Vault 先返还本金并留下奖励弃权 tombstone，Gauge 清理可在同笔交易中尽力完成，也可随后重试；待结算用户不能领取旧奖励或重新进入同一仓位。新份额不得领取 `activationAt` 之前产生的历史手续费，零质押期间产生的手续费不得追溯分给未来质押者。
20. Ticker Meme 创建时可以登记固定 Gauge，但该 Gauge 在毕业完成前保持不可分配、无有效仓位状态。`NotGraduated` 禁止新增或增加 STOCK 分配；只有最终买入原子成功并进入 `PoolCreated` 才开放质押。毕业不改变 `marketId`、Asset UID 或 Gauge 身份，曲线期费用不追溯给毕业后质押者。
21. V1 不设置 LP 质押挖矿或 Ticker Meme 排放。毕业后 TickerGarden 基础费固定按 Uniswap v4 核心 Swap 的 unspecified currency 实际 delta 收取 `1%`，Creator tax 依原基数取整并单独展示；PoolKey.fee 与 LP fee 为0。pinned v4 Core protocol fee 可按方向独立存在，单方向最高 1000 pips（0.1%），由 PoolManager 收取且不进入 FeeVault；canonical LP 仍永久锁定但不获得协议 LP 手续费。
22. 所有市场、Gauge、费用、国库和毕业池使用 `marketId`、`Asset UID` 与 canonical 合约地址关联；Symbol、名称和 Logo 不是身份主键。
23. 协议假设同一实际用户可以控制任意数量的钱包。钱包级限制不得被描述为一人级限制，平台指标不得把钱包数量等同于独立用户数量。

## 3. Pons V2 兼容发行、差异与毕业

### 3.1 兼容基线

“照搬 Pons V2”在 V1 中表示：发行生命周期与经济数学必须和一个明确、不可歧义的 Pons V2 参考版本行为等价，而不是在部署后自动跟随 Pons 外部 Factory 的可变配置。编码前必须形成 `TickerGardenBaselineManifest`，至少冻结：

- 参考网络、Factory/release、ABI 与运行时代码哈希；
- `launchConfigId` 及其 `supply`、`curveFeeBps`、`phantomQuote`、`graduationThreshold`、`poolFee`、`tickSpacing`；
- 原生 Quote 语义，以及每个管理员获批 ERC-20 Quote 的地址、decimals、`phantomQuote`、`graduationThreshold` 与资产行为约束；
- 反狙击曲线、费用计算顺序、部分成交与退款规则；
- `NotGraduated → PoolCreated` 原子状态机；
- 最终买入失败全回滚、无毕业重试/终态救援/市场资产接收人，以及永久 Locker 语义；
- 毕业后 Hook 对 Quote/Meme 两种实际收费资产的原样分桶、到账校验和领取语义；
- 一组可执行的曲线、报价、毕业和费用参考测试向量。

每个市场必须保存 `tickerGardenBaselineId` 与 `expectedEconomics` 哈希。Pons 后续新增、修改或禁用配置不能改变已经创建的 TickerGarden 市场；TickerGarden 若要采用新的 Pons 版本，必须新增 baseline 版本并通过兼容测试，不能静默覆盖旧版本。

这里要求的是可验证的行为兼容，不代表自动获得 Pons 合约源码的复制许可，也不代表继承其安全保证。源码许可、参考实现来源、字节码/行为等价性和 TickerGarden 差异代码必须单独完成法律与安全审查。Pons 官方文档在本次核验时仍将三项独立审计标为进行中，因此 V1 不得把“采用 Pons baseline”宣传成“已经审计”。

按 Pons V2 规则，毕业池保留量为：

```text
reservedTokens = floor(
    supply × phantomQuote
    ÷ (phantomQuote + graduationThreshold)
)
sellableTokens = supply - reservedTokens
```

因此 V1 不存在独立的 `LaunchAllocation` 配置，更不存在固定 `1%` 的默认值。

非规范性点时核验（2026-09-02，Robinhood Chain block `52,289,586`）：Pons 官方文档列出的 Factory `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` 当前只有一个启用的 `launchConfigId = 0`，链上读取为：

| 字段 | 点时值 |
|---|---:|
| `supply` | `1,000,000,000 × 10^18` |
| `curveFeeBps` | `100`（1%） |
| native config `phantomQuote` | `1.68 × 10^18` |
| native config `graduationThreshold` | `4.2 × 10^18` |
| `poolFee` | `0` |
| `tickSpacing` | `200` |

该 phantom/threshold 比例推导出的池保留量是总供应量的 `2/7 ≈ 28.5714%`，而不是 `1%`。但这张表只说明当时的原生 Quote 配置，不能套用于其他资产。每个 ERC-20 Quote 必须有独立、版本化的 `pairTokenEconomics`；若某资产尚未获批或 economics 为零，Factory 必须拒绝该 Quote。任何实现都不能把 native config 的 `4.2 × 10^18` 原始单位解释为 `4.2 USDC` 或其他资产，也不能退回自定义 `2,500 USDC`。

同日外部证据复核发现，Pons 官方源码仓库 README 另指向 `0x7E1EAbd52Ae29598e6483F72dCf1a70b14284dB8`，且其固定区块发行开关、runtime codehash 和部分 ABI 行为与上述文档 Factory 不同。产品现已明确选择官方文档所列、仍在活跃创建市场的 `0x7eD598…` 固定区块行为作为参考，而不是选择已关闭的旧 Factory，也不建立运行时依赖。完整证据见 [V1_G0_EXTERNAL_EVIDENCE.md](./V1_G0_EXTERNAL_EVIDENCE.md)，正式继承范围、独立 ABI、CREATE2 与向量见 [V1_PONS_BEHAVIOR_BASELINE.md](./V1_PONS_BEHAVIOR_BASELINE.md)。公开源码与活跃 runtime 仍无法完全复现，因此这是获产品批准的行为目标，不等于已关闭安全、许可和差分验证门禁。

### 3.2 Pons V2 与 Pump.fun 的采纳取舍

TickerGarden 不把任一平台整体照搬，而是冻结以下组合：

| 来源 | 采纳部分 | TickerGarden 规则 |
|---|---|---|
| Pons V2 | Phantom Reserve 曲线和公式推导 `reservedTokens` | 不设置自定义 `1% LaunchAllocation` |
| Pons V2 | 逐市场 `expectedEconomics` | 已发行市场不受后续全局配置修改影响 |
| Pons V2 | 多 Quote、反狙击、尾单部分成交与退款 | 逐 Quote economics，发行时永久选定一种 Quote |
| Pons V2 | 自动毕业、两阶段 retry 与救援状态机（仅作对照） | 只采纳自动触发；TickerGarden 采用单交易原子毕业、失败整笔回滚，不提供 retry、终态救援或市场资产接收人 |
| Pons V2 | canonical 全范围流动性永久锁定 | 创建者和平台不能撤走初始流动性 |
| Pons V2 | Pull 式费用领取 | 某个收款地址失败不能阻塞全市场分配 |
| Pump.fun | 极简默认发行模板 | 普通创建者只看到一个推荐曲线模板和 Quote 选择；底层参数不开放随意填写 |
| Pons V2 | 原子 `launch-and-buy` | 创建和创建者首买可在一笔交易完成，不允许交易插入其间 |
| Pump.fun | 毕业后向 LP 分配交易手续费 | 不采纳该收益路径；`PoolKey.fee = 0`，Hook 收取的 TickerGarden 基础费1%进入 FeeVault，Core protocol fee 由 PoolManager 独立收取 |
| Pump.fun | 动态市值/成熟度费率档 | 不采纳；TickerGarden 基础费固定为1%，Core protocol fee 另按 pinned v4 Core 配置收取 |
| Pump.fun | 创建者团队分账 | 协议仍只认一个 `creatorRevenueBeneficiary`；该地址可使用固定、可审计的外部分账合约 |

明确不采纳：零成本无限创建、基于即时现货市值的二十多个费率档位、全局修改已发行项目 economics、没有明确反狙击保护，以及 Mayhem、返现或新的代币排放玩法。创建费参考 Pons 活跃部署：当前 Factory 永久固定为 `0.0005` 原生资产、严格匹配 `msg.value`、直接进入平台收入；不再另设 `5 USDG`、可退保证金、STOCK 创建资格或地址级限速，也不存在原地调价 setter。

Pons 的开盘反狙击定价和原子 `launch-and-buy` 行为作为参考。首买不设置“毕业门槛1%”这一额外上限；最大成交量由剩余 `sellableTokens`、尾单部分成交、退款和 `minTokensOut` 决定。作为 TickerGarden 自有 ABI 的安全收窄，不暴露 Pons 的任意团队豁免数组，只自动豁免真实 creator/beneficiary 和原子首买 recipient。当前新 release 使用用户于 2026-09-07 批准的 5 秒窗口：elapsed `0/1/2/3/4/≥5s` 为 raw `9900/2475/309/19/1/0 bps`，仍应用基础手续费、Creator tax 与最低净 Quote 保护。历史外部 runtime 的 `9900/618/19/0` 三秒表仅作为存档证据，不代表新版本。详细操作见 [协议优化指南](../planning/PROTOCOL_OPTIMIZATION_2026-09-07.md)。

Pump 的 LP 手续费与动态费率档均不进入 V1-EXEC-11。TickerGarden 基础费固定为 `1%`，不存在 TWAP、流动性、滚动量、现货市值或治理触发的升降档；`PoolKey.fee = 0`，TickerGarden 自身费用进入 FeeVault。pinned v4 Core protocol fee 是独立的 PoolManager 费用，需单独展示，不能并入 TickerGarden 分成或与不同基数的费率简单相加。精确 PoolKey、Hook、取整和原子结算见 [V1_EXECUTION_SPEC.md](./V1_EXECUTION_SPEC.md)。

### 3.3 已确认的 TickerGarden 差异

除下表外，发行默认继承冻结的 Pons V2 基线。任何新增差异都必须加入版本化差异登记并通过产品、合约和测试评审。

| 项目 | Pons V2 基线 | TickerGarden V1 差异 |
|---|---|---|
| STOCK 关系 | 发行本身不要求绑定官方 STOCK | 创建时永久绑定一个认证 `Asset UID`，并创建对应 Meme Gauge |
| 报价与结算资产 | 原生资产或 Pons 批准的 ERC-20 | 创建者从 TickerGarden 获批 Quote 列表中选择一种并永久用于曲线与毕业池；毕业池手续费则按 Swap 实际收费的 Quote 或 Meme Token 原样分配与领取 |
| 标准手续费去向 | Pons/创建者/可选 buyback，核心池费率为零 | 曲线阶段禁止质押并按 Creator70%/Platform30% 分配；毕业后 LP 协议手续费为0；存在 active stake 时按 Creator40%/Staker30%/Platform30%，无 active stake 时按 Creator70%/Staker0%/Platform30% |
| 创建者附加税 | 创建者可在上限内选择 | V1 初版固定为 `0`，避免在三方分配之外叠加未定义费用 |
| 创建者 buyback/vesting | 可选，并从创建者份额支出 | V1 初版关闭；不复用 Pons 的 Meme buyback vault 或五年 vesting |
| STOCK 质押 | 无 | 每 Vault schema 一个 MultiAsset 用户 Vault、每 Meme 一个 Gauge；本金按 Asset UID 隔离，仅 `PoolCreated` 后开放，并按有效 STOCK 分毕业池手续费 |
| 创建费与首买 | 精确原生创建费；可通过可信 Router 原子 launch-and-buy | 初始创建费和付款语义兼容；保留 TickerGarden creator/marketId 身份和自有 CREATE2 domain |
| 地址与 ABI | Pons 自有部署栈，公开源码与活跃 runtime 存在漂移 | 不复制地址或不完整源码；按确认行为建立 TickerGarden ABI、数学不变量、地址预测和固定向量 |

Pons V2 的曲线基础费率、开盘反狙击税及其衰减规则随 `tickerGardenBaselineId` 冻结。TickerGarden 不额外叠加“质押手续费”；曲线期只替换 non-LP 费用受益人路由。`PoolCreated` 后采用不可变 `V1-EXEC-11` fee policy：`PoolKey.fee = 0`，Hook 对核心 Swap 的 unspecified currency 实际 delta 固定收取 TickerGarden 基础费1%，实际进入 FeeVault；pinned v4 Core protocol fee 由 PoolManager 独立收取，不进入 FeeVault。Staker 是否取得 non-LP 的固定30%（无 Active 时为0）仅由该笔费用发生时是否存在 active stake 决定，不再读取 saturation 或 release 参数。反狙击税只属于曲线阶段，按 Pons 规则并入曲线标准手续费后，以该市场 Quote 进入同一 TickerGarden 分配流程。

CREATE2 使用 TickerGarden 自有 domain 和可离线验证的标准 EIP-1014 公式；创建者收益身份沿用已冻结 epoch 模型，community takeover/管理员任意 override 不继承。TickerGarden 仅继承 Pons 的最终买入自动触发与永久锁仓原则，不继承两阶段 `Swept`、permissionless retry 或 owner/terminal rescue；本项目采用全原子失败回滚。`launch-and-buy`、多 Quote 和公式化毕业池数量均已确定采纳。精确矩阵见 [V1_PONS_BEHAVIOR_BASELINE.md](./V1_PONS_BEHAVIOR_BASELINE.md)。

### 3.4 Quote Asset 选择与冻结

TickerGarden 采用 Pons V2 的“一市场一 Quote”语义，而不是让一个市场同时交易多个 Quote。Factory 可以使用 `ApprovedQuoteRegistry` 中任意管理员已登记且处于 `ACTIVE` 的 config；追加式集合可包括：

- Robinhood Chain 原生资产，以 `address(0)` 作为 canonical 标识；
- 经 `ApprovedQuoteRegistry` 逐资产风险评估并批准的任意 canonical Token；
- 官方 Stock Token 的 Base 资格与 Quote 资格分开，绑定 STOCK 不会自动获得 Quote 资格；Quote 可走通用 `addQuoteConfig`，也可选择带明确指纹承诺的 `addStockQuoteConfig`。

每个 `QuoteAssetConfig` 至少冻结：

```text
quoteAssetConfigId
quoteAsset                 // address(0) = native
quoteDecimals
phantomQuote
graduationThreshold
tickerGardenBaselineId
economicsHash
status
```

Quote 准入唯一由管理员逐资产风险审查后的白名单决定；不设 ordinary ERC-20 的 immutable、opcode 或零 EIP-1967 slot 禁令。Registry 可保存 codehash、proxy slots、decimals、transfer 行为及其他审查记录，作为风险与运行时安全证据。任意 Token 均须满足冻结的 numeric bounds、逐 Quote economics、`ACTIVE` 状态、访问控制和按实际余额守恒的 transfer accounting safety；这些条件不能被 symbol、包装声明或链下价格绕过。

Robinhood 官方 Stock Token 仍受 `OfficialStockRegistryV1` 的 Base 注册政策约束，但作为 Quote 时可使用通用 `addQuoteConfig`。需要时可使用可选的 `addStockQuoteConfig` 提交 Asset UID、canonical Token、Beacon、implementation、runtime codehash 与 proxy-slot fingerprint commitments；这些记录用于风险审查和身份漂移检测，不构成自动准入或普遍代理禁令。实际激活仍待管理员白名单、产品参数和目标链证据批准。

Quote config 的地址、decimals、phantom/threshold 和 `economicsHash` 永不修改；`status` 是独立的新发行门禁，可以暂停某资产的新发行，但不能把历史市场迁移到另一 Quote。更新 economics 必须新增 `quoteAssetConfigId`，`expectedEconomics` 不包含可变的 status。

Robinhood 官方 Stock Token 目录中存在 chainId `4663` deployment 的全部资产都属于可准入 STOCK；2026-09-02 点时观测为194项，但该数量不是协议上限。准入身份必须绑定 `chainId + Asset UID + canonical token + decimals`，并在生产登记前复核 Beacon/implementation；symbol/name 不能作为身份。HTTP 目录只用于离线取证，合约运行时只认 TickerGarden Registry。

当前观测到的194项 ACTIVE 官方 STOCK 全部可以登记为质押 Base。创建者在创建 Meme 时从 ACTIVE Registry 中选择一个 `assetUid`，一个市场恰好绑定一个 Base 且创建后不可更改；同一个 Asset UID 可以对应任意多个 Meme。STOCK 持有人在市场毕业后自行决定是否分配，以及向哪个匹配市场分配多少。作为质押 Base 时，STOCK 价格、Chainlink Feed 覆盖、USD 名义金额和 backing target 均不参与准入、权重或手续费计算。完整规则见 [V1_OFFICIAL_STOCK_ADMISSION.md](./V1_OFFICIAL_STOCK_ADMISSION.md)。

Base 资格与 Quote 资格必须分开：194项官方资产的 Base 资格不会自动生成194项 Quote。Stock Quote 必须由管理员独立风险审查并加入 allowlist；数量不设协议上限。Robinhood `/rhj/prices/{symbol}` 可以在生成 Quote config 和创建页面展示时提供底层股票 USD `bid/ask` 参考，但必须乘一次 `/rhj/assets` 的 `currentMultiplier` 才得到每枚 Stock Token 的参考价；Robinhood Chain 的 Chainlink Feed 已经包含该 multiplier，禁止再次相乘。API/Oracle 只用于链下生成与交叉校验，治理登记后 Curve 和毕业仍只读取冻结的 raw `phantomQuote`、`graduationThreshold` 和真实 Token 余额，绝不随股价动态改参。完整规则、失败门禁与实现缺口见 [V1_STOCK_QUOTE_PRICE_REFERENCE.md](./V1_STOCK_QUOTE_PRICE_REFERENCE.md)。

TickerGarden 的获批列表不必与 Pons 现网列表永久相同，但每个 Pons 现网未批准的新增 Quote 都必须登记为显式 TickerGarden 差异，独立冻结 economics、完成参考向量和安全审查；不能借“兼容 Pons”省略这些步骤。

当前仓库提供一个 native bootstrap 示例，权威记录为 [`spec/v1_initial_quote_configs.json`](../../spec/v1_initial_quote_configs.json)。它不是协议上限或首发 allowlist 冻结；管理员可在部署前后按相同规则追加多项 config：

| Config | Quote | Decimals | `phantomQuote` | `graduationThreshold` | `quoteAssetConfigId == economicsHash` |
|---|---|---:|---:|---:|---|
| `NATIVE_ETH_V1` | `address(0)` | 18 | `1680000000000000000` | `4200000000000000000` | `0x110acc145df286ef871d394b987b4ce12b062dc4d50d75343cdac7986a21e64e` |

USDG 与 cbBTC 的可升级性、codehash 和 proxy-slot 观测记录属于风险审查信息，二者状态为 `REGISTRY_ACTIVATION_REQUIRED`，不是 `BLOCKED_PROXY_POLICY`。管理员可通过通用 `addQuoteConfig` 为任意 Token（含代理 Token）追加 config；`addStockQuoteConfig` 的显式 fingerprint commitments 仍可选。当前没有激活任何 Quote config，也没有广播链上交易。

市场创建时，创建者选择一个 ACTIVE `assetUid` 作为质押 Base，并选择一个 ACTIVE `quoteAssetConfigId`；Factory 将 canonical Stock Token/decimals/Vault 身份连同 `tickerGardenBaselineId`、`launchConfigId`、`launchTemplateId` 和 `feePolicyId` 一起纳入 `expectedEconomics`。创建后以下项目终身一致：

`quoteAssetConfigId` 必须非零、显式存在且状态为 ACTIVE；未登记的零值不能因为其 `quoteAsset == address(0)` 而被误判为原生 Quote。

```text
买入支付资产 = 卖出所得资产 = 毕业门槛资产
= 毕业池配对资产 = Market Quote Asset

毕业池 non-LP 手续费分配与领取资产
= 该笔 Swap 实际收取的 Quote Asset 或 Ticker Meme Token
```

协议不把普通手续费强制换成 USDC，也不在普通分桶阶段转换 Ticker Meme Token；已记入负债的 Meme 奖励可由受约束的奖励结算路径兑换为该市场 Quote。每个 Meme Gauge 的奖励资产集合在创建时固定且有界，恰好是该市场的 canonical Quote Asset 与 Ticker Meme Token；不得加入第三种资产或动态奖励列表。两种资产分别使用原始最小单位记账、分桶和领取，不能按美元估值相互净额结算。前端可以显示统一美元估值作为参考，但链上会计不依赖价格。

若创建者选择的 Quote 恰好是该 Meme 绑定的 canonical Stock Token，Quote 侧手续费仍以该 Stock Token 原始单位直接分配，Meme Token 侧手续费仍分 Meme Token。FeeVault 中作为手续费负债持有的 Stock Token 与 `UserStockVault` 中的用户质押本金必须位于不同合约，不能互相冲抵。

### 3.5 市场创建

任何满足 Factory 规则的创建者可以为 Registry 中处于 ACTIVE 状态的官方 Stock Token 创建 Ticker Meme。创建时至少冻结：

- `marketId`；
- 创建者手续费收款身份；
- 对应 `Asset UID` 与 canonical Stock Token；
- Ticker Meme Token 地址与总供应量；
- `tickerGardenBaselineId`、`launchConfigId`、`launchTemplateId`、`feePolicyId`、`quoteAssetConfigId` 与 `expectedEconomics`；
- Pons V2 曲线、报价资产经济参数、反狙击、毕业与永久流动性配置；
- 该市场唯一的 canonical Quote Asset、decimals 和原生/ERC-20 类型；
- 对应 `MemeStockGauge`；
- 曲线阶段与毕业后阶段的官方收费入口。

一个 Ticker Meme 只能登记一次，一个 `marketId` 只能绑定一个 Meme、一个 `Asset UID` 和一个 Gauge。创建者或管理员不能在发行后把 Meme 改绑到另一种 STOCK。

V1 当前 Factory 的创建费为 `500000000000000 wei`（`0.0005` 原生资产）。普通创建要求 `msg.value == launchFee`。原子 `launchAndBuy` 在 native Quote 时要求 `msg.value == launchFee + firstBuyAmount`；ERC-20 Quote 时严格要求 `msg.value == launchFee`，从调用者钱包拉取已授权且足额的指定 Quote。合约不兑换外部资产、不选择外部交易池，也不接受额外 ETH 代替 Quote。获取 Quote 由用户或外部流程提前完成。创建和首买任一步失败均回滚；首买数量按所选 Quote 的 raw units 计量，最低 Meme 到账保护不变，尾单未使用的 Quote 退回调用者。外部兑换若是另一笔交易，不会随创建失败回滚。新 Router 构造参数仅包含 Factory 与 ApprovedQuoteRegistry；已删除外部 PoolManager、pool fee、tick spacing 和 unlock callback 依赖。旧 release 不会自动改变；此次构造字节码变化必须重新生成生产预测地址与部署计划。

### 3.6 曲线阶段

曲线阶段尚未完成毕业，禁止向该 Meme 分配或增加 STOCK。`MemeStockGauge` 即使已在创建时登记，也必须保持 `totalActiveStock == 0`，不得形成质押者手续费权益。

用户可以提前把 canonical Stock Token 存入 `UserStockVault` 形成空闲余额，但这只是通用本金托管，不代表已向任何 Meme 质押，不产生锁定期或收益。`depositAndAllocate` 在目标市场未进入 `PoolCreated` 时必须整笔回滚；前端不得把单纯 `deposit` 展示成该 Meme 的质押。

曲线交易和 STOCK 本金托管完全分开：

- 用户交易 Ticker Meme 时使用创建时冻结的 Quote Asset；
- 毕业开放后，用户质押的是绑定的官方 Stock Token；
- 绑定的 Stock Token 只有在独立通过 Quote 审查并被创建者选中时才同时作为报价资产；
- Stock Token 的 USD 价格不动态决定 Ticker Meme 的 raw 曲线价格；
- Stock Token 本金不进入曲线储备或毕业流动性。

由于曲线期在协议上必然是零有效质押，曲线手续费只按第 6.4 节固定分给创建者和平台，不进入 `STAKER_REWARD` Bucket，也不为毕业后的第一位质押者保留。

曲线使用 Pons V2 的 pricing reserve 与 constant-product 整数数学：`quoteReserve` 包含不可提取的 phantom quote，`realQuoteReserve` 只表示真实 Quote。买入先扣标准费、创建者附加税（V1 固定为零）与开盘反狙击税后再定价；卖出先定价再从 Quote 输出中扣费。临近毕业的超额买入必须在同一交易内部分成交并退回未使用 Quote，不能卖穿 `reservedTokens`。

### 3.7 毕业

> **用户侧品牌术语：Bloom（绽放）。** `Bloom` 是协议 Graduation 成功事件的非规范性产品语言，唯一对应 canonical Registry 中 `launchPhase == PoolCreated`；成功后的持续状态统一显示为 `In Bloom`，不使用 `Bloomed`。`readyToGraduate() == true` 只能称为 `Ready to Bloom`，不得显示为 `In Bloom`，也不得据此开放 STOCK 配置。当前协议没有可持续观察的 `Bloom Pending`/`Swept` 或 `Rescued` 状态。`Rooted Liquidity` 只描述 `PoolCreated` 后 canonical 初始流动性永久锁定的事实，`Harvest` 只描述已经实际产生并记账的手续费，二者都不是新的 `launchPhase`。合约、ABI、事件与技术规范继续使用 `Graduation`、`PoolGraduated` 和 `PoolCreated`，完整语言规则见 [`brand/BRAND_CULTURE_AND_ECOSYSTEM.md`](../../brand/BRAND_CULTURE_AND_ECOSYSTEM.md)。

当最后一笔买入使 `sellableTokens == 0` 时，Curve 在同一交易内自动执行毕业。初始公式把 `realQuoteReserve` 的理论终点锚定在本市场 `QuoteAssetConfig` 中的 `graduationThreshold` 附近；实际数值会受每笔整数舍入影响，不得假设与阈值逐 raw unit 恒等。阈值以所选 Quote 的原始单位表示，不是跨资产统一的美元门槛，更不是 TickerGarden 全局写死的 `2,500 USDC`。Factory 在创建前验证配置决定的 canonical pool 数量，Curve 在转移资产前要求真实 Quote 不低于该数量、真实 Meme 恰好等于 reservedTokens，并以 canonical PoolKey 再跑同一 `GraduationPoolMath`；若真实路径不可表示或任一建池步骤失败，最终买入整体回滚且市场保持 `NotGraduated`。

曲线把 `reservedTokens` 作为 `sweptTokens` 交给毕业模块。为避免任意交易历史的整数舍入改变初始池价，入池 Quote/Meme 只由冻结配置决定：

```text
poolQuoteAmount = ceil(
    sellableTokens × phantomQuote
    / reservedTokens
)
lockedExcessQuote = sweptQuote - poolQuoteAmount
poolMemeAmount = floor(
    reservedTokens × poolQuoteAmount
    / (poolQuoteAmount + phantomQuote)
)
lockedExcessMeme = reservedTokens - poolMemeAmount
```

`poolQuoteAmount` 与 `poolMemeAmount` 进入 full-range LP；交易历史造成的 `lockedExcessQuote` 和未进池 Meme 一并永久锁定。当前 `phantom/threshold = 2/5` 时，曲线保留量是供应的 `2/7`，真正入池 Meme 是 `10/49`，额外永久锁定是 `4/49`。因此不能把 `reservedTokens`、`sweptTokens` 与 `poolMemeAmount` 当成同一数量，也不能把实际多出的 Quote 用来抬高初始池价。

毕业流程必须保证：

- 只使用真实到账的市场 Quote，不信任调用参数、美元估值或链下展示值；
- 同一市场只能成功毕业一次；
- 最后一笔买入必须自动完成毕业；若池创建失败，最终买入及所有副作用整体回滚，资产仍在原 Curve 状态中，不产生可重试的中间托管；
- 毕业后的官方池永久锁定，创建者和平台不能移除其 canonical 流动性；
- Gauge 地址、创建者身份和绑定 Stock Token 不因毕业改变；毕业前 Gauge 必须为空且不产生质押者奖励，成功进入 `PoolCreated` 时才原子开放新增分配；曲线期已经产生的费用归属不得追溯重算；
- 毕业前后全部使用同一个 `marketId`。

费用源与唯一阶段事实绑定：`NotGraduated` 时 Curve 是 ACTIVE fee source；同一交易原子进入 `PoolCreated` 后，毕业池 Hook 成为新的 ACTIVE fee source，不存在持久的无来源窗口。最后一笔曲线费用必须在 Pool 创建前完成最后一次 sweep，使用 Curve 地址、`sourceVersion` 和单调 `sweepNonce` 形成唯一 `curveFeeId`。毕业池则使用 `poolId + sourceVersion + feeNonce + feeAsset + base + T` 形成 `feeId`，不依赖不存在的外部 `tradeId`。

质押门禁与同一状态机绑定，不设置管理员可独立切换的“提前开放”开关。最终曲线交易完成成交、退款和最后 fee sweep 后，由 exact registered Curve 同步调用 payable `GraduationExecutor.graduateFromCurve(marketId, quoteAmount, memeAmount)`，执行 per-market Locker 部署、池注册、初始化、永久锁仓、双资产 dust 锁定、Hook 启用、`sourceVersion` 增加与 `PoolCreated`。调用不使用 `try/catch` 吞错；失败会向上回滚最终买入，确保没有部分 Locker/Pool/Hook 状态泄漏。协议没有管理员或任意调用者可触发的毕业救援，也没有任何市场资产接收人。

精确曲线、价格、Token/Quote 注入数量、滑点与边界不得由实现者另行设计；必须来自冻结的 Pons V2 基线、逐 Quote economics 和可执行参考测试。TickerGarden 只对已登记差异编写附加规格。

## 4. STOCK 托管与自由分配

### 4.1 用户 STOCK 本金的唯一托管域

每个 `Asset UID` 只绑定一个 canonical 用户本金合约；当前 schema 的所有 UID 共享同一 MultiAsset Vault：

```text
UserStockVault
├── deposited[assetUid][user]
├── allocated[assetUid][user]
└── 只托管用户存入的各类 STOCK 本金
```

`UserStockVault` 不得把用户本金借贷、做市、转给创建者、转给平台国库或用于任何外部策略。新费率不再产生协议购买 STOCK 的资金来源，因此 V1 不部署与手续费链路相关的 `ProtocolStockTreasury`。

### 4.2 存入、空闲和已分配余额

对任一用户和 `Asset UID`，始终独立满足：

```text
Deposited(assetUid, user) = FreeBalance(assetUid, user) + Allocated(assetUid, user)
Allocated(assetUid, user) = Σ Allocation(assetUid, user, marketId)
TotalAllocated(assetUid) <= TotalDeposited(assetUid)
Vault.balanceOf(canonicalToken(assetUid)) >= TotalDeposited(assetUid)
```

用户可以存入任意最小单位的 canonical Stock Token，也可以提取任意空闲余额。动态 `minimumAllocation` 只作用于每个 Meme 的最终非零分配仓位，避免不足门槛的余额在 Vault 中被锁死。

### 4.3 单仓位最低值

对每个用户、每个 Meme：

```text
NewAllocation == 0
or
NewAllocation >= minimumAllocation(assetUid)
```

其中 Registry 按 Asset UID 保存 raw-unit `minimumAllocation`，注册时设定，之后只能通过延迟治理权限更新；该值的允许范围受 canonical numeric bounds 约束。实现直接按原始最小单位比较，不依赖价格或 symbol。

明确允许：

```text
minimumAllocation
minimumAllocation + 1 raw unit
任意更高的正整数 raw-unit 仓位
```

明确拒绝：

```text
0 < Allocation < minimumAllocation
```

不执行固定 0.5 的 `%`、倍数检查、四舍五入或向上取整。由于不允许部分减仓，allocation 只能增加，或通过正常 close / rageQuit 整仓归零。

### 4.4 多 Meme 自由配置

合约不设置钱包级 Meme 数量上限。用户可以把同一种 STOCK 分配给一个或多个已经进入 `PoolCreated` 的 Meme，只要每个非零仓位满足当前 `minimumAllocation` 且总分配不超过本金。因此实际可参与数量是有限的，受可质押市场集合、`Σ Allocation <= VaultBalance`、每仓位动态最低值和 Gas 共同约束。

示例：用户存入 `10 NVDA`，以下配置有效：

```text
Meme A = 1.273 NVDA
Meme B = 0.8501 NVDA
Meme C = 5.4 NVDA
Meme D = 2.4769 NVDA
Total  = 10 NVDA
```

钱包数量不进入奖励公式。把相同 STOCK 本金拆到多个钱包不会凭空增加总收益，只会增加操作与 Gas 成本。

## 5. 仓位生效、持有与退出

### 5.1 毕业后分配与30秒延迟激活

单纯存入 `UserStockVault` 不代表支持任何 Meme，因此不会产生收益。分配入口首先要求目标市场已经进入 `PoolCreated` 且对应 Asset 允许新增仓位；`NotGraduated` 或 Asset PAUSED/RETIRED 时必须拒绝新增和增加。通过门禁后，用户调用 `allocate(marketId, amount)`，或在同一笔交易调用 `depositAndAllocate` 指定 Meme，新增份额先进入 pending，不立即增加有效权重。固定顺序为：

```text
处理已经到期的 activation bucket
→ checkpoint Quote/Meme 两套 Gauge 指数
→ 以旧 activeAmount 结算用户历史收益
→ Vault 锁定新增 STOCK
→ 新增数量创建或合并到唯一 pendingAmount
→ pending activationAt = now + 30 seconds
→ 整个仓位 unlockAt = now + 24 hours
```

等待30秒期间：

- 原有 `activeAmount` 继续参与手续费分配；
- `pendingAmount` 已占用 Vault allocation，但不进入 `totalActiveStock`，不分享任何手续费；
- 同一 Gauge 再次增仓只合并到这一份 pending，并重置 pending 的30秒计时；
- `unlockAt` 同时重置为最新增仓交易时间加24小时。

当 `block.timestamp >= activationAt` 时，协议在下一次手续费 credit、用户操作或 permissionless checkpoint 开始处先处理到期激活，再分配新的手续费。pending 从其激活快照开始计奖；在此之前产生的 Quote 或 Meme Token 手续费都不属于它。没有手续费和用户操作的空闲期间无需主动执行，因为期间没有可漏记的收益。

最低仓位校验作用于操作后的有效仓位：

```text
TargetPosition = ActiveAmount + PendingAmountAfterOperation
TargetPosition == 0 || TargetPosition >= minimumAllocation(assetUid)
```

因此已有 `0.6 STOCK` active 时可以新增 `0.1 STOCK` pending，操作后目标为 `0.7 STOCK`；active 与 pending 都为零时不能提交 `0.4 STOCK`。新份额在30秒内不分享任何 fee credit；到期激活必须在当笔新手续费分桶之前处理，避免边界漏记或多记。已存在低于新门槛的仓位只能继续增仓至门槛，或整仓退出。

### 5.2 24小时最短持有期

每次新分配或增仓后，整个合并仓位至少锁定 `24 hours`，从该笔分配交易的 `block.timestamp` 起算，而不是从30秒激活完成时起算。V1 第一版采用有界状态：同一用户在同一 Gauge 只保存一个 active 聚合仓位和最多一个 pending 增量，不保存无界 tranche 数组。

增仓会把 active 与 pending 对应的整个 Meme 仓位 `unlockAt` 重置为 `now + 24 hours`。只有仓位所有者可以为本人增仓；不得允许第三方通过极小增仓恶意延长他人的锁定时间。前端必须在签名前明确展示新的 `activationAt` 和 `unlockAt`。

这组规则是 V1 第一版的 JIT 质押防线：30秒延迟排除同区块和极短窗口抢入，24小时锁定让参与者承担交易后继续持有 STOCK 的机会成本。它不能保证阻止提前30秒以上获知交易的人，但比“单次不得超过池总量50%”更难通过拆钱包直接绕过；V1 初版不再叠加地址级50%上限。两个时间均以链上 `block.timestamp` 判断，前端倒计时只作估算，合约不按区块数换算。

### 5.3 只允许整仓退出

allocation 不允许减仓，也不允许从市场 A 迁移到市场 B。达到 `unlockAt` 后，用户只有一条保留收益的正常退出路径：整仓 `close`。由于24小时远长于30秒，正常路径下 pending 已经成熟；操作仍必须先处理所有到期激活：

1. 处理到期 activation bucket，并更新 Quote/Meme 两套全局手续费指数；
2. 按旧有效份额分别结算用户待领取 Quote 与 Meme Token；
3. 清除该用户在该 market 的全部 Gauge active/pending 权重；
4. 清除同一 market 的全部 Vault allocation，将本金变为 Vault `FreeBalance`；
5. 保留已经结算及可领取的收益，用户随后调用 `withdrawFreeStock` 取回本金。

用户也可以选择 `rageQuit`：它是整仓、立即的本金逃生路径，不检查 `unlockAt`、`minimumAllocation`、Launch phase 或 Market status。Vault 先写入奖励弃权 tombstone，再清除本人 allocation 并把完整 STOCK 本金直接转回本人钱包；Gauge 的 active/pending 与奖励清理位于本金转账之后。若 Gauge 清理失败，本金交易仍成功，tombstone 保留并阻止该用户领取旧奖励或重新进入同一 market，任何地址可随后重试奖励结算。两种退出都不会改变 market 状态，也不会影响其他用户的正常业务。

## 6. 手续费分配

### 6.1 手续费基数

曲线基础费率和开盘反狙击税随 `tickerGardenBaselineId` 冻结。毕业池不采用动态档位：所有 `PoolCreated` 市场固定 `PoolKey.fee = 0`，由 Hook 的 `afterSwap` 对 Uniswap 核心 Swap 的 unspecified currency 实际 delta 收取 TickerGarden 基础费1%；Core protocol fee 独立由 PoolManager 收取。exact-input 的收费资产是 output，exact-output 的收费资产是 input。定义：

```text
D_curve = 曲线期以 Market Quote 实际收取并划给创建者/平台的费用
D_asset = PoolCreated 后在该笔 Swap 收费资产中划给创建者/质押者/平台的部分
L_asset = 0（LP 协议手续费）
T_asset = D_asset = 毕业后该笔 Swap 的总协议手续费
```

曲线阶段不存在 Uniswap LP，因此 `L = 0`，只产生 `D_curve`。`D_curve` 包含 Pons 标准曲线费以及按 Pons 规则并入标准费的反狙击税；V1 创建者附加税固定为零，且 `D_curve` 不包含质押者份额。

毕业池阶段的唯一整数公式为：

```text
base = abs(coreSwapUnspecifiedDelta)
T_asset = floor(base × 10,000 / 1,000,000)
L_asset = 0
D_asset = T_asset
```

比例直接在该 Swap 实际收费的同一种资产中切分。`D_asset` 由 `PoolManager.take` 实际转入 FeeVault，经精确余额增量验证后才可记账；Hook 不调用 `PoolManager.donate`。若资产是 Quote，三方获得 Quote；若是 Ticker Meme Token，三方获得 Meme Token。本次分桶不得转换、用估值替代或跨资产净额结算，也不得把 Token 侧费用延迟归属到另一质押快照。已分桶的 Meme 负债可在独立奖励结算交易中兑换为 Quote，并仍归原收益人。

`D_curve/D_asset/L_asset/T_asset` 均不包括 Gas。毕业池不使用请求交易额或指定资产名义值，而使用核心实际成交后的 unspecified delta，所以部分成交不会被按未成交数量过收。`PoolCreated` 后的 STOCK 质押不会额外叠加收费，只改变 `D_asset` 的受益人。Hook 每笔都必须确认 v4 `lpFee == 0`；pinned v4 Core `protocolFee` 可按方向存在且最高为 1000 pips（0.1%），由 PoolManager 独立收取，不进入 FeeVault，并在报价中单独展示。

### 6.2 固定毕业池分配（V1-EXEC-11）

毕业后每笔 Swap 使用处理完到期 activation bucket 后的 `totalActiveStock` 快照。只要 `S > 0`，按 Creator40% / Staker30% / Platform30% 分配；`S == 0` 时按 Creator70% / Staker0% / Platform30% 分配。LP 协议手续费始终为0。

```text
T_asset = floor(base × 1%)
L_asset = 0
D_asset = T_asset
if S == 0:
    Staker = 0; Platform = floor(T_asset × 30%); Creator = T_asset - Platform
else:
    Staker = floor(T_asset × 30%)
    Platform = floor(T_asset × 30%)
    Creator = T_asset - Staker - Platform
```

`Staker` 份额再按该笔费用发生时各 active staker 的实际 raw-unit `activeAmount / S` 比例分配。Quote 和 Meme Token 两种 feeAsset 分别维护独立 bucket、index 和 remainder，不进行跨资产估值或净额结算。没有 active stake 时产生的费用不追溯给未来质押者。

### 6.3 用户级 rageQuit 与放弃收益

用户可直接调用 `UserStockVault.rageQuit(assetUid, marketId)`，也可调用便利入口 `AllocationManager.rageQuit(marketId)`，整仓退出该 market 的全部 allocation。两者都绕过24小时锁、动态最低仓位和市场生命周期状态，且 recipient 永远是仓位本人。固定安全顺序为：

1. Vault 以 `assetUid + user + marketId` 的权威 allocation 取得完整本金；
2. 先写入 `rageQuitSettlementPrincipal` tombstone，再同步清除 user/market/asset 三层 allocation 账本；
3. 对 canonical STOCK 执行精确转账，本金在本交易中直接到本人钱包；若 Token 转账本身失败，前三步按 EVM 原子性全部回滚；
4. Manager 仅在本金完成后，以限定 Gas 尝试 Gauge 弃权清理。失败不得回滚本金；tombstone 留待 `settleRageQuitRewards(marketId,user)` 被任何人重试。

奖励清理完成时，Gauge 清除调用者的 active/pending 权重和全部未领取 Quote/Meme 权益。所有因 `rageQuit` 放弃的完整最小单位都按 `marketId + feeAsset` 隔离记入 forfeiture reserve，随后只可在平台 claim 时转换为平台收入；无论当时是否仍有 Active staker，都不得重新进入 Gauge accumulator，也不得被现有或后加入的 staker 捕获。这样取消了对 remaining-active cohort 与 mutation nonce 的分支依赖，也避免异步清理时需要重建历史质押者集合。

FeeVault 暂时失败或耗尽固定 Gas 时，Gauge 记录聚合 deferred amount，任何人可调用 `flushDeferredForfeiture()` 补记；补记采用先清零、失败恢复，不能重复入账。用户的本金完成状态不依赖该补记。

在 tombstone 清除前，Gauge 的 `settle`/`consumeClaimable` 必须拒绝该用户，Vault 也拒绝其重新锁入同一 `assetUid + marketId`；其他用户的交易、质押、领取以及 Meme/Curve/Hook/LP 均不受影响。正常 `claim` 与整仓 `close` 仍需 `now >= unlockAt`，并保留已结算收益。市场级 Emergency 与 `forceReleaseAllocation` 已删除，不是用户级 rageQuit 的前置条件。

### 6.4 曲线阶段固定零质押分配

Pump.fun 的曲线阶段 LP fee 为零，因为此时尚不存在 AMM LP。TickerGarden 采用同一原则，不创建虚假 LP 地址，协议 LP 手续费为0。由于未进入 `PoolCreated` 的市场禁止 STOCK 质押，曲线阶段在协议上必然满足 `totalActiveStock == 0`。实际收取的非 LP 费用记为 `D_curve`，固定分配为：

```text
Creator = 70% × D_curve
Platform = 30% × D_curve
Stakers = 0
LP = 0
```

曲线费用不得进入 Gauge accumulator 或 `STAKER_REWARD` Bucket，也不得在毕业后追溯给任何质押者。该阶段规则避免把 LP 或质押者费用存入一个未来可能被抢领的 Bucket，也避免为了加入额外 Quote 而改变 Pons 的 `reservedTokens` 和毕业初始价格。前端必须分别展示“曲线手续费”和“毕业池手续费”，不能用一个模糊费率覆盖两个阶段。

Creator 收益受益人使用单调 epoch。受益人变更前必须先在旧 epoch 下原子 sweep 所有已产生 Curve fee，确认累计值归零后才创建新 epoch；毕业池费用在每笔 credit 时绑定当时 epoch。旧 epoch 负债永久支付给旧 beneficiary，管理员不能重定向。

Curve→FeeVault 的 ERC-20 sweep 使用 `beginCurveCredit → exact transfer → finalizeCurveCredit`。begin 在全局 credit lock 内冻结 FeeVault 的资产余额，finalize 只在同一 canonical Curve、market/sourceVersion、nonce、feeId 全部匹配且 `balanceAfter - balanceBefore == sweptAmount` 时记账；预先存在于 FeeVault 的余额不能冒充本次到账。native Quote 走同一 begin/finalize 身份验证，并要求 finalize 的 `msg.value` 精确等于本次金额。任一步失败会使 Curve 的 nonce、储备更新、资产转账和 FeeVault 负债整体回滚。

### 6.5 整数守恒

手续费按该笔实际 `feeAsset` 的最小单位计算。每个完整资产最小单位必须进入一个明确 Bucket；高精度奖励指数产生的 scaled remainder 另行显式保存，不得与未入账资金混为一谈。推荐分桶顺序：

毕业池不切出 LP；`S=0` 时不产生 Staker Bucket，`S>0` 时将总手续费的30%计入 Staker Bucket：

```text
LP = 0
D_asset = T_asset
StakerPortion = (S == 0) ? 0 : floor(T_asset × 30 / 100)
PlatformPortion = floor(T_asset × 30 / 100)
CreatorPortion = T_asset - StakerPortion - PlatformPortion
```

`S` 取同一笔手续费入账前、处理完已成熟 activation bucket 后的原子快照。Staker 与 Platform 份额向下取整，最终整数余数明确交给 Creator；`S=0` 时为 `70/0/30/0`，`S>0` 时为 `40/30/30/0`。

曲线阶段固定执行：

```text
PlatformPortion = floor(D_curve × 30 / 100)
CreatorPortion = D_curve - PlatformPortion
```

以上整数分桶分别对 Quote 与 Meme Token 独立执行。Staker 与 Platform 份额先向下取整，Creator 接收该资产的全部整数余数，保证 FeeVault 三类负债之和严格等于实际手续费；不得用一种资产的余数填补另一种资产。Gauge 的高精度指数与用户 remainder 只用于 `PoolCreated` 后的质押者会计。

### 6.6 平台收入

毕业池 PlatformPortion（Active 时为30%，无 Active 时为30%）以及曲线阶段固定的30%，统一定义为 `TickerGarden Platform Revenue`。

已经归属于 Platform 的收益按以下用途分配：70% 用于购买真实股票或股票代币，形成项目后续发展的长期储备；20% 用于每周回购并销毁一个当周评选出的优秀 Meme Token；10% 用于产品开发、基础设施、安全、审计、合规和日常运营。该比例只是 Platform 收益的二次用途说明，不改变 Creator、Staker、Holder 或 Platform 的链上手续费分配比例，也不改变现有合约会计。

每周优秀 Meme 的评选综合市场表现、真实交易活跃度、参与用户、流动性和社区增长等因素。评选结果、回购金额和销毁记录应公开展示；若当周没有符合条件的项目，对应预算保留至后续周期，不转作平台开销。完整用户说明见 [`PLATFORM_REVENUE_USE.md`](../PLATFORM_REVENUE_USE.md)。

创建者、质押者和平台领取该笔手续费实际使用的资产，因此同一市场可能分别累积 Quote 与 Ticker Meme Token。平台若希望把已领取资产汇总成 USDC 或其他国库资产，只能在平台收入负债形成并完成领取之后执行独立国库策略；平台国库策略不得擅自改动用户或创建者负债。协议奖励结算路径另行受操作员权限、原收益人归属、链上价格保护及原币退出规则约束。

## 7. 质押者手续费会计

每个 Meme Gauge 在该市场进入 `PoolCreated` 后才允许形成有效仓位。奖励资产集合固定为 `marketQuoteAsset` 与 `tickerMemeToken` 两种；每种资产独立维护同构会计：

```text
totalActiveStock
totalPendingStock
rewardState[feeAsset].accFeePerShare
rewardState[feeAsset].indexRemainder
user.activeAmount
user.pendingAmount
user.activationAt
user.unlockAt
user.reward[feeAsset].accumulatorPaid
user.reward[feeAsset].pendingFee
user.reward[feeAsset].remainder
```

V1-EXEC-11 固定指数精度为：

```text
INDEX_PRECISION = 1e27
```

30秒激活使用32槽、1秒粒度的环形时间轮，并为每个槽保存绝对 `generation = activationAt`。每次会使用权重的写操作固定扫描32槽，先处理 `generation <= block.timestamp`，再处理本笔手续费或仓位变更；旧 Quote/Meme 双指数快照按绝对 generation 和引用计数保留，不能被环形槽复用覆盖。正式算法和不变量见 [V1_EXECUTION_SPEC.md](./V1_EXECUTION_SPEC.md) 第8–9节。

令固定 `INDEX_PRECISION = P = 1e27`，某 Meme 以某个 `feeAsset` 获得质押者手续费 `R`、当时有效 STOCK 总量为 `S` 时，该资产的池级 remainder 使用以下完整整数公式：

```text
carry = floor(indexRemainder[feeAsset] / S)
normalizedRemainder = indexRemainder[feeAsset] % S

whole = floor(R × P / S)
fraction = (R × P) % S

merged = normalizedRemainder + fraction
accFeePerShare[feeAsset] += carry + whole + floor(merged / S)
indexRemainder[feeAsset] = merged % S
```

`indexRemainder` 表示尚未形成一个 accumulator 最小单位的池级 scaled numerator。即使 `S` 因增仓或整仓退出改变，也先以新分母执行 `div/mod` 归一化；不得直接假设旧 remainder 小于新 `S`。

该 remainder 是绝对的 scaled reward，而不是依赖旧分母的比例。每次更新都满足：

```text
R × P + PreviousIndexRemainder
= DistributedAccumulatorDelta × S + NewIndexRemainder

UndistributedRewardInFeeAssetRawUnits
= NewIndexRemainder / P
```

因此旧 `S = 10` 时的 remainder `9`，在新 `S = 1` 时转换为 `9` 个 accumulator 最小单位，只代表同一份 `9/P` fee-asset raw unit 池级 Dust，不会放大为 `9` 个资产最小单位。Quote 与 Meme Token 的 Dust 完全隔离，分别留在该市场对应 Bucket，并在下一次收到同一种资产的质押者手续费时继续分配。

Solidity 实现必须使用 `mulDiv`、`mulmod` 与 remainder 会计，不能直接计算可能溢出的 `R × P`，不能使用浮点数，也不能遍历质押者。用户结算定义为：

```text
delta = CurrentAccumulator - UserAccumulatorPaid
whole = floor(UserActiveStock × delta / P)
fraction = (UserActiveStock × delta) % P
merged = UserRemainder + fraction

UserPendingFee[feeAsset] += whole + floor(merged / P)
UserRemainder = merged % P
UserAccumulatorPaid = CurrentAccumulator
```

每种 `feeAsset` 的 `UserRemainder` 单位是“该资产一个最小单位乘以 `P` 后的不足整单位部分”，始终位于 `[0, P)`。它在普通 claim 和整仓 close 后继续归属于同一用户、同一 `marketId` 和同一资产，不能跨资产合并，也不能被平台或其他质押者领取；rageQuit 则放弃该仓位的未领取收益。

市场永久退休后，任何不足一个对应资产最小单位、无法转账的用户 remainder，以及无法再形成整数权益的池级 Dust，永久保留在该 `marketId + feeAsset` 的 `STAKER_REWARD` Bucket 中；不得转给创建者、平台、国库、最后一个质押者、另一资产或其他市场。未领取的整数用户权益仍永久可 claim。

修改用户有效份额前必须先更新 Gauge 并分别结算两种资产的旧份额。pending 激活时以该 activation bucket 在激活边界记录的两套指数作为计奖起点。用户只能领取实际到账、已经记入该 Meme 对应资产质押者 Bucket 的 Quote 或 Meme Token；协议不得为奖励增发任何 Token 或凭证资产。

## 8. 毕业后 LP 手续费

TickerGarden 保持 Pons 的 canonical pool 与永久锁仓安全边界，但协议 LP 手续费为零：

- 曲线阶段 `LP fee = 0`，因为此时没有 Uniswap LP；
- `PoolCreated` 后，Hook 不调用 `PoolManager.donate`，TickerGarden 基础费1%转入 FeeVault；Core protocol fee 由 PoolManager 独立收取；
- 不部署 LP Gauge，不要求 LP NFT 质押，不发放 Ticker Meme 或平台币奖励；
- 外部 LP 可以按标准 Uniswap v4 规则增加或移除自己的流动性，但该 canonical pool 的核心费率为0，协议交易不会为其产生 LP feeGrowth；
- 毕业时的 canonical 全范围仓位仍永久锁定，但不获得协议 LP 手续费。

每个毕业市场部署一个绑定该 `marketId` 的不可变 `LaunchLocker`，永久持有 canonical Position NFT 与相关余额。新版支持公开 `collectLockedFees()` 及仅 Keeper 可调用的有界 `compoundLockedFees`。只使用独立记账的 LP 手续费及其余量；毕业剩余资产、直接转入资产和仓位本金不可被复投消耗。Keeper 由治理通过现有 48 小时权限延迟更换，默认零地址；单笔复投截止时间最多为执行时刻后 5 分钟。详见 `LOCKER_FEE_COMPOUNDING.md`。

Uniswap v4 PoolKey 的 LP fee 固定为零，TickerGarden Hook 基础费固定为1%。pinned v4 Core protocol fee 可按方向独立存在，最高1000 pips，由 PoolManager 收取；实现不得把不同基数费率机械相加冒称实际总费。每笔只需证明：

```text
L_asset = 0
D_asset = T_asset
Hook transient delta = T_asset - D_asset = 0
```

零质押只决定 Staker Bucket 是否为0；核心 LP fee 与协议 LP 分成始终为0。旧的 `STOCK_PURCHASE`、Quote→STOCK Swap、`FeeExecutor` 和 `ProtocolStockTreasury` 路径从 V1 删除。

## 9. 毕业开启与毕业后连续性

每个 Meme 只有一个固定 `MemeStockGauge` 身份，但 Gauge 在曲线阶段保持不可分配、`totalActiveStock == 0`，曲线费用仅进入创建者和平台 Bucket。成功进入 `PoolCreated` 时才开放 STOCK 分配，Gauge 从零仓位、零质押者累计指数开始服务毕业池手续费；毕业前费用不得成为其历史奖励。

`PoolCreated` 之后的暂停或恢复不得：

- 重置 Quote/Meme 任一 `accFeePerShare`；
- 清除用户任一资产的待领取手续费；
- 要求用户重新存入 STOCK；
- 改变既有 active/pending 仓位、`activationAt` 或 `unlockAt`；
- 改变创建者或 `Asset UID`；
- 追溯改变已经产生的手续费分配；
- 把曲线期手续费追溯分给毕业后质押者；
- 为 LP 新增 Ticker Meme 挖矿排放。

## 10. 上万个 Meme 的可扩展规则

链上不得通过无界数组遍历某 STOCK 下的全部 Meme，也不得遍历用户全部仓位或某 Gauge 的全部质押者。

单市场操作必须保持有界：

| 操作 | 复杂度目标 |
|---|---:|
| 创建一个 Meme Gauge | O(1) |
| 对 `PoolCreated + ACTIVE` Meme 分配或增仓 | O(1)，最多一个 pending 增量 |
| 整仓 close 或 rageQuit 一个 Meme | O(1) |
| 给一个 Meme 记入手续费 | O(1) |
| 领取一个 Meme 的 Quote/Meme 手续费收益 | O(1) |

前端和 Indexer 通过事件维护：

- `Asset UID → marketId[]`；
- `user + Asset UID → active/pending marketId[]`；
- 每个 Meme 的有效 STOCK、手续费、毕业、流动性、暂停和退休状态；
- 用户按 marketId 分别待领取的 Quote/Meme 资产与数量。

V1-EXEC-11 永久只保留单市场操作，不提供 batch ABI，也不得提供 `claimAll()` 或 `withdrawAllMarkets()`。若后续版本需要批量领取或部分退出，必须升级 `executionSpecId`、使用有界数组并重新完成 Gas、ABI、权限和原子性审计，不能静默加入首发实现。

## 11. 配置状态与用户逃生

对象级 Registry 门禁固定为：

- Asset `PAUSED/RETIRED`：阻止该 STOCK 的新存入、新市场和新建/增加分配；
- Quote `PAUSED/RETIRED`：只阻止使用该 config 创建新市场；
- Pons baseline 与 Launch template `PAUSED/RETIRED`：只阻止使用该版本创建新市场。

这些配置变化不枚举、不暂停也不改写已部署市场。既有 Curve/v4 交易、已产生手续费领取、activation checkpoint、满足锁定期的整仓 close、空闲 STOCK 提取和链上读取不依赖这些新准入门禁。

任何 Gauge 故障或配置状态都不能锁住 `UserStockVault` 中的用户本金。Vault 按 `assetUid + user + marketId` 保存权威 allocation，并按资产同步维护 user/market/total 三层聚合。用户本人可随时调用 `rageQuit(assetUid, marketId)`：不读取 Gauge，不检查24小时锁、最低仓位或 `launchPhase`，先留下奖励弃权 tombstone，再清除本人 allocation 并把同额 STOCK 直接转回本人钱包。若 Gauge 故障，奖励权重可延后清理，但该用户旧 claim 与同 market 再入保持关闭，直至 permissionless retry 成功。

协议没有部署后市场暂停、退休、接管或管理员恢复入口。用户本金只通过无状态依赖的 `rageQuit` 取回；被放弃奖励异步进入平台 forfeiture reserve，不向其他 staker 重分配。

费用与参数安全不变量：市场创建时选择的 ACTIVE 官方 `Asset UID` 是唯一且不可变的质押 Base；作为 Base 的 STOCK 价格和美元估值不进入质押、权重或手续费协议计算。Stock Quote 的 USD 价格也只生成创建前的参考证据，不成为市场运行时输入。每笔毕业池手续费必须使用记账时的 `S = totalActiveStock` 原子快照：`S=0` 时按 Creator70/Staker0/Platform30，`S>0` 时按 Creator40/Staker30/Platform30，Staker 与 Platform 向下取整、余数归 Creator；LP为0且同资产整数守恒始终成立，pending 在30秒激活前不得进入 `S`。

## 12. V1 明确删除的 Test Prototype 机制

V1 不实现：

- Stock Token 质押产生 Ticker Meme；
- LP 质押产生 Ticker Meme；
- 10 亿/100 亿/1000 亿挖矿预算档位；
- 1460/1453 天排放窗口；
- 70%/30% 股票池与 LP 池排放；
- 20% 立即领取、80% 进入 56 天 RewardEscrow；
- 10,000 美元 Stock Token 排放软门槛；
- 依赖 Stock 价格决定 Meme 排放速度；
- 买入手续费购买 STOCK、TGARD 销毁和卖出侧 Meme 销毁的 Test Prototype 不对称分桶；
- 每个 Asset UID 只能创建一个 Ticker Meme；
- LP NFT Subscriber 挖矿。

“删除 LP NFT Subscriber 挖矿”不等于禁止标准 LP。毕业后协议 LP 手续费为0，用户仍可按 Uniswap v4 原生规则提供流动性，但没有质押、积分或代币排放。

V1 可以复用 Test Prototype 中已经验证的 canonical 资产身份、固定目的地 Bucket、`accRewardPerShare` 精度与用户退出优先原则，但不得把旧排放或异步 STOCK 购买语义带入 V1。

## 13. 已关闭的执行决策与仍开放的产品参数

以下执行设计与本轮新增取证已由当前 `V1-EXEC-11` 关闭，不再属于实现者可选项：

| ID | 已冻结结论 |
|---|---|
| V1-FROZEN-V4-FEE-01 | `PoolKey.fee = 0`、Hook mask `0x2044`、afterSwap unspecified currency 固定1%、no donate、take full fee、核心 LP fee 必须为零；Core protocol fee 可按方向存在且最高1000 pips、失败全回滚 |
| V1-FROZEN-VAULT-01 | 每 schema 一个共享 MultiAsset Vault；权威 `allocation[assetUid][user][marketId]` 与资产内三层聚合；Gauge 不托管 STOCK；用户在任意 `launchPhase` 均可先于奖励清理立即取回完整本金 |
| V1-FROZEN-ACTIVATION-01 | `1s/30s/32-slot` 绝对 generation 时间轮、双指数 snapshot/refcount、`INDEX_PRECISION=1e27`、固定边界与 remainder 公式 |
| V1-FROZEN-STATE-ABI-01 | Asset/Quote/Pons/Template 保留对象级准入状态；市场仅有单向 `launchPhase` 事实；不存在部署后市场管理或管理员恢复 selector；核心 ABI、事件与权限由机器清单生成 |
| V1-FROZEN-LOCKED-LP-01 | canonical locked position 永久持有；协议 LP 手续费为0，LaunchLocker 仅公开归集、Keeper 有界复投，无提款路径 |
| V1-G0-PONS-RUNTIME-VECTORS-01 | 活跃 runtime 的3秒反狙击整数表与 native/ERC-20 完整毕业 receipt 已固定，并由独立整数模型逐值复核 |
| V1-G0-PRODUCTION-QUOTES-01 | 新市场可选择任意管理员风险审查、批准且 `ACTIVE` 的 Quote；`NATIVE_ETH_V1` 只是 bootstrap 示例；任意 Token（含可升级 USDG、cbBTC 与 Stock proxy）均可进入 `REGISTRY_ACTIVATION_REQUIRED`；`addQuoteConfig` 为通用路径，`addStockQuoteConfig` 的显式指纹承诺可选；当前无激活或广播，价格生成器与首批 allowlist 是 `PENDING_PRODUCT_ACTIVATION` |
| V1-FROZEN-NUMERIC-01 | 6–18 decimals admission、int128/uint256/uint64 上限、full-precision mulDiv 与 accumulator 生命周期证明见 `spec/v1_numeric_bounds.json` |
| V1-G0-BATCH-01 | batch ABI 明确移出 V1 首发范围；单市场入口永久保留 |

规范正文及机器可读清单位于 [V1_EXECUTION_SPEC.md](./V1_EXECUTION_SPEC.md) 和 `spec/v1_*`；任何偏离必须使用新的 `executionSpecId`。

### 13.1 本轮新增确认

| ID | 已确认结论 |
|---|---|
| V1-G0-PONS-BASELINE-01 | 选择活跃 `0x7eD598…` 固定区块的链上行为作为非运行时依赖 baseline；公开源码只作参考，独立重写 |
| V1-G0-PONS-QUOTE-01 | 已实现 native + 追加式管理员风险审查 Quote 白名单；通用 `addQuoteConfig` 支持任意 Token，Stock 指纹 commitments 可由可选 `addStockQuoteConfig` 提交；管理员逐资产评估并激活，一市场一 Quote、逐资产 economics |
| V1-G0-RH-STOCK-QUOTE-REFERENCE-01 | 少量官方 Stock Token 可走独立 Quote allowlist；官方 REST 底层股票价乘一次 multiplier 形成创建参考，Chainlink Token 价不重复乘，市场运行时只使用冻结 raw 参数 |
| V1-G0-PONS-DIFF-01 | 产品差异集中为手续费分配和毕业后 STOCK 质押；其余发行主链路继承，必要安全优化使用自有 ABI/Registry/CREATE2/向量明确登记 |
| V1-G0-LAUNCH-FRICTION-01 | 当前 Factory 创建费 immutable 为 `0.0005` 原生资产并精确支付；不使用旧建议的 `5 USDG`；改费必须新 Factory + 新 `executionSpecId` |
| V1-G0-ANTI-SNIPE-01 | 采用原子 launch-and-buy 和 Pons 尾单/退款语义；不设人为的“毕业门槛1%”首买上限；精确 runtime raw/effective 表已固定 |
| V1-G0-OFFICIAL-STOCK-BASE-01 | 当前观测194项 ACTIVE 官方 STOCK 全部可由创建者选择为市场唯一质押 Base；STOCK 只作 raw-unit 质押分配，不使用价格、Feed 或 backing target |
| [历史] V1-FROZEN-STAKER-SATURATION-01 | 旧 `V1-EXEC-3` 曾冻结 `stakeSaturationWholeTokens = 10`；每市场 `B = 10 × 10^stockDecimals`，质押者 Bucket 按 `min(S,B)/B` 线性释放。该历史决策已被当前 `V1-EXEC-11` 的动态 `minimumAllocation` 与 active Creator40/Staker30/Platform30 取代，不再生效。 |

2026-09-05 基线的实现、artifact、生成 ABI、测试网依赖快照与 fixed-block Fork/E2E 曾形成 `DEPLOYMENT_ELIGIBLE` 证据；修改后的源码须重新生成候选证据，实际广播、部署后 finalized 身份/实现复核和外部签字仍必须按测试网 runbook 与 production gates 完成。

### 13.2 尚未冻结的产品参数与外部签字

以下事项不应由实现者自行假设：

| ID | 未冻结事项 | 阻塞范围 |
|---|---|---|
| V1-G0-PONS-SECURITY-01 | 确认源码/许可、完成 baseline 等价验证，并对 Pons 未关闭审计风险和 TickerGarden 差异代码取得独立安全签字 | 法律、合约、审计、部署审批 |
| V1-G0-LEGAL-01 | 冻结 Stock Token 质押手续费收益的地区准入、风险披露和前端措辞 | Web、合规、部署范围 |
| V1-G0-RH-STOCK-QUOTE-PARAMS-01 | 冻结首批 Stock Quote 清单、目标 USD 参考规模、取价侧、最大时效、REST/Chainlink 偏差阈值及公司行动策略 | Stock Quote config generator、机器 manifest、前端与部署批准 |

`V1-P-010` 与 `V1-T-001` 已随当前 `V1-EXEC-11` 的无价格 STOCK Base 规则闭合，implementation 与 technical deployment gate 当前均为空。Pons security、独立审计、Legal、生产角色移交、源码验证、监控与 soak 属于后续 production gates；`DEPLOYMENT_ELIGIBLE` 只允许受控部署验证，不得被表述为已部署或生产可用。


### 统一领取的结算与有效期（2026-09-11）

当前候选的 `MarketRegistry` 没有 router/quoter getter 或字段。`FeeVault.claimUserRewards(marketId,role,epoch)` 以及 `claimUserRewardAssets(marketId,role,epoch,assets)` 均只领取原始资产；后者返回本次 `quotePaid,memePaid`。Staker 通过仅 FeeVault 可调用的结算路径一次检查锁和退出状态、一次结算，只消费所选资产的权益。两套资产负债与用户归属保持独立。

当前 raw-only 领取没有 conversion、deadline、fallback 或 restore API。Quote 与 Meme 按原始资产分别支付。

Holder 转账检查点仅在账户有新增指数需要结算时读取转账前余额，并将同一份余额复用于两套奖励；领取时在任何付款回调前完成所有被选账本的结算。奖励指数、释放批次、应计权益和 Quote/Meme 负债不合并。

### 单市场资产选择（2026-09-11）

`claimUserRewardAssets(marketId,role,epoch,assets)` 支持 `assets=1` 仅 Quote、`2` 仅 Meme、`3` 两者；0 和其他值回滚。`claimUserRewards(marketId,role,epoch)` 是选择两者的便利入口，两者共用同一实现。此选择不是跨市场批量领取。

未选资产不消费、不付款，也不执行其独立的 FeeVault 余额/偿付校验。Holder 的 Meme 余额仍是持有人权重来源，不能省略有历史指数差时的余额结算。

前端、后端观察器和官方任务使用 `TICKERGARDEN_USER_CLAIM_RAW_ASSETS_V1` 识别当前 FeeVault，不将旧部署识别为支持新入口。事件的 paid 字段描述本次所选原始资产权益，不表示用户剩余全部资产。

Gauge/Vault 的 pending 计数为零时直接跳过 32 槽激活扫描；有 pending 时保留完整到期处理、奖励截止和队列一致性校验。Holder 在指数未变化时跳过无效账户写入，在流处理函数中复用账本 key，不改变释放规则。


## 生产候选补充：Treasury 延迟迁移（2026-09-13）

`ProtocolFeeVault.platformTreasury()` 为唯一收款地址来源，Factory 同名 getter 与创建费付款读取 FeeVault；不再有两个独立 immutable 收款地址。初始地址仍由 `V1_PLATFORM_TREASURY` 提供，部署时必须与 Factory 配置一致；FeeVault 的 `authority` 固定为同一 AccessManager。

治理 Safe 以 AccessManager 活跃角色 1 成员身份**直接**调用 `proposePlatformTreasury(address)`，合约开始不可缩短的 172800 秒等待期。此操作不通过 AccessManager.schedule/execute，不叠加第二个 48 小时。新地址必须是有代码的合约，并自身调用 `acceptPlatformTreasury(uint256 nonce)`；任意人到期后可执行 `executePlatformTreasury(nonce)`，但提议者此时仍须是活跃角色 1 成员。治理或独立 Guardian（角色 2）可立即调用 `cancelPlatformTreasury(nonce)`。待执行提议不可覆盖，先取消再发起会增加 nonce，旧确认不能复用。角色 0 部署者、旧 Treasury 及其他人没有隐含提议/取消权限。

切换时不搬移资金、不遍历市场：FeeVault 内所有尚未支付的平台权益，包括切换前累计部分，之后都支付给新 Treasury；已支付旧地址的资金不能因此追回。Creator、Staker、Holder 的资产与账目不变。全部迁移操作共享 FeeVault credit/claim 锁，禁止结算回调期间切换。候选外层 runtime codehash 变化会阻止生效，但 Safe owners、threshold、modules、guard 或代理实现变化仍须监控。

此功能仅存在于新编译的候选合约，既有部署不能通过更新配置获得它。操作见 `docs/runbooks/PLATFORM_TREASURY_ROTATION.md`。
