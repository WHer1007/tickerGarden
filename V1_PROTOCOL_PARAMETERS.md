# TickerGarden 第一版协议参数

> 文档状态：V1 机制草案  
> 更新时间：2026-09-02  
> 品牌名称：TickerGarden  
> 品牌口号：Stake the ticker. Grow the culture.  
> 本次修订：同步最新 V1 产品确认及 P-002/P-005 评审稿——供应上限三档、48 个月期末永久取消未释放额度、10,000 美元 Stock Token 软门槛、LP 延后 7 天启动、首笔至少实际到账 500 USDC、NVDA 首发、网站直连边界，以及权限/退出矩阵。
> 技术实现基线：参见 [TECHNICAL_ARCHITECTURE.md](./TECHNICAL_ARCHITECTURE.md)。
> 端到端流程与缺口：参见 [V1_WORKFLOWS_AND_GAPS.md](./V1_WORKFLOWS_AND_GAPS.md)。

## 1. 产品定位

TickerGarden 是一个运行在 Robinhood Chain 上、在协议与合约层保持无许可的股票文化 meme 发行和流动性平台。

每个白名单 Robinhood Stock Token 对应一个独立的 Ticker Meme 市场。用户质押对应 Stock Token，持续挖出对应 Ticker Meme；Ticker Meme 挖出后，任何用户都可以为官方 Ticker Meme/USDC 池提供流动性，并将通过仓位校验的官方 Uniswap v4 LP NFT 直接订阅到该市场的非托管 Gauge，继续获得该 Ticker Meme。LP 订阅和计奖不要求用户持有或质押任何 Stock Token。

“Ticker Meme”是面向用户的正式类别名称。本文既有章节中的 `mStock` 仅作为早期技术占位称呼，应理解为对应的 Ticker Meme Token；`m<TICKER>` 不再是强制 Symbol 格式，编码前应将新合约与接口统一命名为 `TickerMemeToken` 或其他最终冻结的技术名称。

V1 首发 Stock Token 已确定为 NVDA。以下以首发市场为例；`GPU` 只是初始 Symbol 示例，最终首发 Symbol 仍须写入 launch manifest：

- 股票质押资产：Registry 认证的 Robinhood NVDA Stock Token。
- 对应 Ticker Meme：由创建者初始命名，例如 `GPU`。
- Token 全称：`GPU — NVDA Ticker Meme`。
- 官方流动性交易对：GPU/USDC。
- 股票池：质押 NVDA Stock Token，按最终冻结的排放时钟持续获得 GPU。
- LP 池：用户保留官方 GPU/USDC PositionManager NFT，通过 Subscriber 直接登记参与挖矿，无需质押 NVDA Stock Token，并获得独立的 GPU 排放。
- 股票池和 LP 池完全分开，LP 不再作为股票质押权重的增强系数。
- 平台不为 GPU 设置初始价格，不承诺 GPU 跟踪 NVDA 股票价格。

TickerGarden 不宣称 Ticker Meme 拥有股票所有权、固定赎回权、1:1 股票抵押或股票价格跟踪关系。

## 2. 已确定的 V1 原则

1. 协议保持完全无许可，不依赖一人一账户或链下身份识别。
2. 必须假设同一用户可以创建和控制任意数量的钱包。
3. Stock Token 必须来自 TickerGarden 的白名单 Registry，并按合约地址及 Asset UID 识别，不能仅根据 ticker、名称或 Logo 识别。
4. 任意用户均可为白名单 Stock Token 创建对应的 Ticker Meme 挖矿市场。
5. 在 V1 的 Robinhood Chain 部署中，同一个 Asset UID 只能创建一次官方 Ticker Meme 市场。
6. 创建市场需要支付创建费用；收费资产、金额和最终用途尚待确定。
7. 每个 Ticker Meme 的固定供应上限由创建者从 10 亿、100 亿、1000 亿三个档位中选择；Factory 不接受任意供应数值，部署后不能修改。
8. Ticker Meme 按 `block.timestamp` 通过股票池 1460 天、LP 池 1453 天窗口持续释放，采用初始 1.5 倍平均速率线性衰减至 0.5 倍的无尾部曲线；用户按有效份额分配并自行领取，期末未释放额度永久取消，期末前已赚取权益仍可领取。每市场精确起点写入 launch manifest。
9. 股票质押池与 LP 挖矿池完全分开；总挖矿额度按股票池 70%、LP 池 30% 分配，两个池共享同一个 `MaximumSupply` / `MintedSupply` 安全上限。
10. LP 获得 mStock 奖励不需要任何 Stock Token 余额或质押资格；只要 canonical LP NFT 通过仓位校验并成功订阅 Gauge，即可从订阅生效时点开始计奖。
11. 只有官方 canonical Ticker Meme/USDC 池的 LP 才能获得 LP 挖矿奖励。
12. 外部池保持无许可，但不获得官方标识、官方 LP 排放或官方国库权益。
13. 官方池采用 Uniswap v4。
14. 官方池每笔 Swap 的总有效手续费固定为 1%，从该笔交易的输入资产单边收取。
15. 平台不使用预言机决定 mStock 初始价格；首个 LP 用户无许可完成定价。
16. 平台不干预初始价格，也不提供价格锚定、价格担保或价格纠偏。
17. V1 只支持 Robinhood Chain；Stock Token 质押、mStock 发行与转账、官方池、LP 挖矿、手续费执行和国库全部位于同一条链。
18. V1 不部署 BSC 合约、跨链桥、wrapped mStock、跨链消息、跨链奖励会计或双链流动性池。
19. Robinhood Chain 是 mStock 的 canonical 发行链。任何 V2 多链扩展不得改变已经发行的 mStock 经济含义或重新打开已消耗的排放额度。
20. TGARD 回购销毁是 V1 必备功能，不延后到 V1.1 或 V2。
21. 用户 Swap 只完成 0.60% LP 手续费和 0.40% 协议手续费的扣取、记账与归集；Stock Token 购买、TGARD 回购销毁、mStock 销毁和协议收入划拨不在用户交易链路中执行。
22. 买入 mStock 时，0.40% 协议手续费按 40% Stock Token / 40% TGARD 销毁 / 20% 协议收入分配；卖出 mStock 时，0.40% 协议手续费全部进入 mStock Burn Bucket，之后异步销毁。
23. 每个市场的 StockTreasuryVault 与 mStock Token 必须是不同合约；mStock 合约不得托管或处置 Stock Token。
24. 股票池与 LP 池的每次奖励领取均只让 20% mStock 立即进入用户钱包，其余 80% 自该次领取时起在 8 周（56 天）内线性释放。
25. 用户解除股票质押、停止 LP 计奖、取消 LP 订阅或转移 LP NFT 时，已经进入归属期的奖励不得被罚没、加速或重新分配；管理员不得提前解锁、取消或没收用户归属中的 mStock。
26. LP 挖矿采用非托管 `CanonicalLPNFTGauge`，该合约实现 Uniswap v4 `ISubscriber`；LP NFT 始终留在用户钱包，不转入 Gauge，也不发行 tgLP 或其他 Vault 份额。
27. V1 只奖励 canonical PositionManager、canonical PoolId 且精确匹配官方全区间的 LP NFT；有效份额按该仓位的原始 `liquidity` 与有效订阅时间计算，不使用美元价值、预言机、交易量或 Vault NAV。
28. LP NFT 的订阅、加减流动性、取消订阅、转移和销毁必须通过 PositionManager 的 Subscriber/Notifier 生命周期同步结算；任何回调都不得托管资产、执行 Swap、领取费用或遍历无界数据。
29. 面向用户的资产类别统一称为 `Ticker Meme`，不强制使用 `m<TICKER>` 形式的 Symbol。
30. 创建者在建池时拥有一次初始命名权：Symbol 为 3–8 位 ASCII 英文字母，统一转为大写，并通过平台内唯一性与保留词校验。
31. 对应 Ticker Meme 社区拥有一次永久有效的最终命名权；该权利没有过期时间，只有第一次成功执行的最终命名会消耗，失败提案不消耗。
32. Symbol、名称或 Logo 都不是资产身份主键；市场、Token、Gauge、PoolKey、国库与治理必须始终通过 `marketId`、Asset UID 和合约地址关联。
33. 股票池采用软门槛：目标质押量等于 10,000 美元对应的 Stock Token 整数数量；低于目标时按 `min(totalStaked / targetStockAmount, 1)` 降低股票池释放系数，不阻止任意数量质押或退出。
34. LP 池排放在股票池排放开始 7 天后启动，并与股票池使用同一最终截止时间；LP 订阅资格仍与 Stock Token 余额完全无关。
35. 官方池首笔流动性必须实际到账至少 500 USDC，同时提供非零 Ticker Meme 并形成非零 liquidity；检查实际到账值，不能只信任调用参数中的 desired amount。
36. V1 首发 Stock Token 为 Registry 认证的 NVDA；正式部署前仍须完成 canonical 地址、Asset UID、代码、multiplier、Feed 和公司行动状态的 manifest 校验。
37. 网站采用前后端分离，但不做全流量代理：协议历史与数据库聚合读模型通过 Backend API，钱包、RH RPC、canonical v4 Quoter/StateView 等公开无特权服务可由 Web 按 manifest/allowlist 直连。

### 2.1 链范围与版本边界

V1 的协议状态只有一个权威来源：Robinhood Chain。前端和索引器可以缓存或聚合链上事件，但不得成为余额、奖励、市场状态或供应上限的最终依据。

V1 的链边界如下：

| 能力 | V1 规则 |
|---|---|
| 部署链 | 仅 Robinhood Chain |
| 主网 Chain ID | 4663 |
| 测试网 Chain ID | 46630 |
| Gas 资产 | ETH |
| Stock Token 质押 | 仅 Robinhood Chain |
| mStock 发行与流通 | 仅 Robinhood Chain |
| 官方 Ticker Meme/USDC 池 | 仅 Robinhood Chain；主网固定使用 canonical-bridge USDC |
| LP 挖矿与手续费分配 | 仅 Robinhood Chain |
| BSC、跨链桥和 wrapped mStock | V1 不支持 |

前端在 V1 只能发起 Robinhood Chain 交易。用户连接其他网络时，应提示切换到 Robinhood Chain，而不是展示尚未支持的跨链入口。

V2 可以重新评估 BSC 扩展。当前候选方向为：Robinhood Chain 保持 canonical 发行链，通过 Chainlink CCIP CCT 的 lock/mint、burn/unlock 模型在 BSC 创建 1:1 映射资产；BSC 初始阶段不参与 Stock Token 质押或 mStock 排放。该方向不是 V1 的部署承诺，也不授权在 V1 合约中预置桥接管理员、铸币角色或可用的跨链入口。V2 必须另行完成威胁建模、权限设计、速率限制、异常恢复、测试和专项审计。

## 3. 无许可市场创建

### 3.1 创建资格

任何地址均可调用 TickerGarden Factory 创建 Ticker Meme 市场，但对应 Stock Token 必须已经进入官方 StockRegistry 白名单。

Factory 必须校验：

- Stock Token 合约地址。
- 稳定的 Asset UID。
- 当前资产状态。
- 该 Asset UID 尚未创建 Ticker Meme 市场。
- 创建费用已经支付。

创建者负责触发标准化部署并设置初始 Symbol。除该初始命名权外，创建者不获得以下经济、资金处置或持续治理特权：

- 不能额外铸造 mStock。
- 不能修改供应上限。
- 不能转走用户质押资产。
- 不能修改官方 PoolKey。
- 不能修改交易手续费。
- 不能决定首个 LP 价格。
- 不能提取官方 LP 挖矿奖励池。

### 3.2 同步部署和登记

创建 Ticker Meme 市场时，同一笔 Factory 流程完成：

~~~text
TickerMemeToken
NamingGovernor / NamingExecutor
StockStakingGauge
CanonicalLPNFTGauge（ISubscriber）
RewardEscrow
TickerGarden Fee Hook
Canonical PoolKey Registry
Permissionless Initializer
对应 Stock Token TreasuryVault
~~~

此时官方 LP 市场进入 REGISTERED 状态，表示官方 PoolKey 已经确定，但 Uniswap v4 池尚未写入初始价格。

### 3.3 Ticker Meme 初始命名与一次性社区最终命名

#### 3.3.1 初始命名

创建者在调用 Factory 时提交初始 `symbol`。该字段适用以下固定规则：

- 长度为 3–8 位；采用 3 位下限是为了允许 `GPU` 等具有传播性的 Meme Symbol。
- 只允许 ASCII 英文字母 `A–Z`；前端可以接收小写输入，但 Factory 必须规范化为大写后再校验和写入。
- 在 TickerGarden Registry 内不得与其他 canonical Ticker Meme 的当前或历史 Symbol 重复；任何曾经使用过的 Symbol 永久保留，改名后也不能被其他市场重新使用。
- 不得使用协议保留名称，包括 `TGARD`、结算稳定币、Gas 资产及治理未来明确登记的其他系统 Symbol。
- 创建者只直接填写 Symbol；Token 全称由协议自动生成为 `<SYMBOL> — <STOCK_TICKER> Ticker Meme`。
- 初始命名不消耗社区的一次性最终命名权。

以 NVDA 为例：

~~~text
Stock Asset: NVDA
Initial Symbol: GPU
Token Name: GPU — NVDA Ticker Meme
Official Garden: NVDA Garden
Official Pair: GPU/USDC
~~~

#### 3.3.2 社区最终命名

社区最终命名权在市场创建后永久保留，不设置失效日期。社区可以在任何后续时点发起最终命名提案，并选择保留当前 Symbol 或替换为另一个满足相同格式、唯一性和保留词规则的 Symbol。

- 同一市场同时只能存在一个命名提案。
- 投票权来自该 Ticker Meme 的锁定或委托投票权，不能采用一钱包一票。
- 提案开始区块记录余额与供应快照；投票期间的转账不能对同一份 Token 产生重复投票权。
- 投票周期为 7 天，部署时换算并冻结为 Robinhood Chain 上的固定区块数量。
- 有效投票权必须达到提案开始时已释放供应快照的 10%。
- 赞成票必须达到有效票的三分之二。
- 提案通过后进入 7 天执行时间锁。
- 提案失败不消耗最终命名权；同一市场在 30 天冷却期后可以重新发起。
- 第一次成功执行的最终命名将 `metadataFinalized` 永久设为 `true`；无论社区选择新 Symbol 还是确认保留当前 Symbol，此后都不能再次修改。

#### 3.3.3 合约与身份约束

Ticker Meme Token 不应为了改名采用通用可升级代理。推荐在不可升级 Token 中内置由专用 `NamingGovernor` / `NamingExecutor` 调用的一次性 `finalizeMetadata`：

~~~text
require(metadataFinalized == false)
validate(newSymbol)
update name and symbol
metadataFinalized = true
emit TickerMemeMetadataFinalized(marketId, oldSymbol, newSymbol)
~~~

`marketId` 应由 Robinhood Chain ID 与稳定 Asset UID 派生，不能由 Symbol 派生。改名不得改变：

- Ticker Meme Token 合约地址、余额、供应量或 `MintedSupply`。
- 对应 Stock Token、Asset UID、股票质押池和 LP 奖励资格。
- canonical PoolKey、PoolId、LP NFT、Hook、RewardEscrow 或 StockTreasuryVault。
- 官方池中的流动性和用户现有仓位。

Registry 必须维护永久的 `symbolEverUsed` 索引。初始命名和最终命名都先原子占用新 Symbol；旧 Symbol 保留为历史别名且永不释放，避免钱包或第三方缓存仍显示旧 Symbol 时被另一个市场复用。

改名后，前端和索引器至少在 30–90 天内展示 `NEW_SYMBOL（formerly OLD_SYMBOL）`，并同步自定义改名事件。钱包、DEX 和区块浏览器可能缓存旧 Symbol；官方身份始终以 Registry 中的合约地址与 `marketId` 为准。

## 4. mStock 供应与持续释放

每个 Ticker Meme 市场的创建者必须从以下三个固定供应档位中选择一个：

~~~text
SupplyTier ∈ {1,000,000,000; 10,000,000,000; 100,000,000,000}
MaximumSupply = selected SupplyTier（按完整 Token 计量）
MintedSupply ≤ MaximumSupply
~~~

Factory 必须使用枚举或等价常量映射档位，不能接受任意 `MaximumSupply`。供应档位一经市场创建即永久冻结。Ticker Meme 固定使用 18 decimals；`TotalMiningBudget = MaximumSupply`，V1 不存在预挖、团队份额、空投或额外创世铸造。

`MintedSupply` 表示该市场历史实际铸造量，必须单调递增。另以 `PoolReleased` 记录各 Gauge 在截止时间前已经分配给用户、但可能尚未领取铸造的额度。必须始终满足 `PoolMinted <= PoolReleased <= PoolBudget`。mStock 的普通转账、进入合约托管、未来可能发生的跨链锁定或销毁，都不得降低 `MintedSupply`，也不得重新释放已经消耗的铸币额度。V1 的供应上限检查不得仅依赖当前 `totalSupply()`。

mStock 不一次性释放。两个 Gauge 都使用 `block.timestamp` 和整数累计函数，不按区块、不使用浮点数，也不逐秒循环。完整公式、舍入和状态机以 [V1 数学与状态机参考规格](./V1_MATH_AND_STATE_MACHINES.md) 为准。

已经确定的总排放边界为：

~~~text
StockEmissionWindow = 1460 days
StockPoolBudget = TotalMiningBudget × 70%
LPPoolBudget = TotalMiningBudget - StockPoolBudget
~~~

整数拆分时先计算股票池 70%，剩余值全部归 LP 池，保证总挖矿额度完整守恒。股票池的排放起点仍须在 G0 冻结；LP 池的起点已经确定为：

~~~text
LPPoolEmissionStart = StockPoolEmissionStart + 7 days
LPPoolEmissionEnd = StockPoolEmissionEnd
~~~

股票池固定运行 1460 天；LP 池在第 7 天启动并与股票池同日结束，实际窗口为 1453 天。两个预算分别在自己的有效窗口内使用同一平滑线性衰减曲线：初始速率为平均速率 1.5 倍，线性衰减至 0.5 倍，不存在尾部。对预算 `B`、窗口长度 `T` 和夹紧后的已过时间 `d`：

~~~text
ScheduledCumulative
= floor(B × (3 × d × T - d²) ÷ (2 × T²))
~~~

零有效份额及股票池软门槛不足造成的当期未释放额度不积压、不补发；普通暂停不移动时间轴，现有有效份额继续结算。期末停止增加 `PoolReleased`，永久取消 `MaximumSupply - StockPoolReleased - LPPoolReleased`。用户在期末前已经赚取但尚未 claim 的奖励不属于取消额度，期末后仍可在 `PoolMinted <= PoolReleased` 约束下领取；已经进入 RewardEscrow 的奖励继续按原 56 天计划释放。

每个池使用累计奖励指数进行 O(1) 结算：

~~~text
INDEX_PRECISION = 1e27
accRewardPerShare += floor((ActualRelease × INDEX_PRECISION + indexRemainder) ÷ TotalEffectiveShares)

deltaAcc = accRewardPerShare - accumulatorPaid
pending += mulDiv(UserEffectiveShares, deltaAcc, INDEX_PRECISION)
         + carriedUserRemainder
~~~

Gauge 必须用 `Math.mulDiv`/`mulmod` 保留全局除法 remainder 与用户小数 remainder，禁止直接计算可能溢出的 `shares × accumulator` scaled debt；领取频率不能抹掉用户的小数权益。期末每用户不足 1 wei 的不可表示尾数不得转给协议或其他用户。

用户只要保持有效质押，就持续获得奖励；用户可以随时发起领取，领取不终止后续挖矿。每次领取必须经过以下归属规则：

~~~text
ClaimedReward = R
ImmediateReward = floor(R × 20%)
VestingReward = R - ImmediateReward

UnlockedVesting(t)
= VestingReward × min(t - ClaimTime, 56 days) ÷ 56 days
~~~

- `ImmediateReward` 直接进入用户钱包。
- `VestingReward` 进入专用 `RewardEscrow`，从该次领取时间开始连续线性释放，56 天后全部可提取。
- 每个用户、每个奖励来源至少间隔 7 天领取；最多 8 个活跃 tranche，使用固定槽位。第 9 次合法领取时第 1 个槽位已经达到 56 天并可在结清后复用。
- 领取时立即发行的 20% 与进入 RewardEscrow 的 80% 都计入 `MintedSupply` 和 `totalSupply`，不能因尚未解锁而重新计算为可用排放额度。
- 用户可以随时提取已经解锁的部分；解除股票质押、LP 停止计奖、取消 LP 订阅或转移 NFT 不影响既有归属计划。
- RewardEscrow 不得提供管理员提前解锁、取消归属、没收、再质押、借贷或通用外部调用能力。
- 挖矿排放停止后，已经进入 RewardEscrow 的最后一批奖励仍按原时间表继续释放，最长延续 56 天。

仍待每个市场 launch manifest 冻结股票池精确开始时间。P-002 的其余数学参数已经形成可执行参考规格，但在产品和安全负责人签字前仍处于 `REVIEW`，不得标记对应 G0 项为 `APPROVED`。

## 5. 股票质押池

股票池允许任意非零数量质押，不设置会阻止挖矿的硬门槛。市场使用“10,000 美元对应的 Stock Token 整数数量”作为软门槛目标：

~~~text
targetStockAmount = integerStockAmountEquivalentTo(10,000 USD)
StockEmissionCoefficient = min(TotalStakedStockUnits / targetStockAmount, 1)
~~~

股票池的实际释放速率乘以 `StockEmissionCoefficient`；达到目标后恢复 100% 计划速率，低于目标时按比例变慢。用户之间仍按各自 Stock Token 有效质押份额分配，不按钱包美元价值单独加权：

~~~text
UserStockReward
= StockPoolRewardPerUnit
× UserStakedStockUnits
÷ TotalStakedStockUnits
~~~

Stock Token 必须来自该 mStock 市场登记的 canonical 合约。

`targetStockAmount` 在市场创建时读取 manifest 固定的 multiplier-adjusted 官方 Feed，并按完整 Stock Token 数量向上取整后永久冻结。创建时必须验证正价格、heartbeat staleness、sequencer 与 1 小时恢复宽限、`oraclePaused == false`，且 preflight 不存在处理中公司行动。Feed 已包含 multiplier，不能重复乘 `uiMultiplier()`。价格不进入每次用户奖励分配的热路径。Stock Token 的合约迁移和有效单位显示应由专门适配层处理，不能将错误合约或同名假币计入质押。

用户解除股票质押时：

1. 先结算截至当前排放时点的股票池奖励。
2. 更新股票池质押余额并向用户返还 Stock Token。
3. 已产生但未领取的股票池奖励仍归用户所有。
4. 用户之后领取未领取奖励时，仍按 20% 即时 / 80% 线性 56 天执行。
5. 已领取并进入 RewardEscrow 的奖励保持原归属时间表，不因解除质押而被罚没、加速或重新分配。
6. `StockStakingGauge` 不调用 `CanonicalLPNFTGauge`；股票质押余额的任何变化都不改变 LP 订阅或 LP 奖励。

## 6. 独立 LP 挖矿池

### 6.1 LP 直接订阅，无 Stock Token 门槛

LP 挖矿与股票质押池在资格和会计上完全解耦：

- 任意 canonical LP NFT owner 均可直接调用 PositionManager 订阅对应 Gauge。
- Gauge 不读取钱包 Stock Token 余额，不读取 `StockStakingGauge`，也不保存 `MinimumStockStake`。
- 用户没有 Stock Token、从未参与股票池或已经全部解除股票质押，都不影响 LP 订阅与持续计奖。
- `StockStakingGauge` 不向 LP Gauge 发送门槛变化通知，Factory 和 Registry 也不为 LP 奖励保存门槛参数。
- LP 奖励资格只由 canonical PositionManager、PoolId、Hook、精确全区间、当前 liquidity 和 subscriber 状态决定。
- 多钱包可以分别提供 LP 并直接订阅；协议不尝试识别同一自然人。

### 6.2 奖励原则

LP 池拥有独立的 mStock 排放额度：

~~~text
LPPoolEmissionStart = StockPoolEmissionStart + 7 days
LPPoolEmissionEnd = StockPoolEmissionEnd
~~~

在 `LPPoolEmissionStart` 之前，任何 LP NFT 都不能累计 LP 排放；这不影响仓位赚取 Uniswap LP 手续费。两个池共用同一最终截止时间，期末尚未进入 `LPPoolReleased` 的额度永久取消；截止前已赚取未领取权益仍可 claim。

~~~text
UserLPReward
= ∫ LPPoolEmissionRate(t)
  × UserSubscribedLiquidity(t)
  ÷ TotalSubscribedLiquidity(t) dt
~~~

LP 奖励不依赖：

- LP 的美元价值。
- 对应股票的美元价格。
- mStock 的美元价格。
- 外部预言机。
- 用户交易量。
- 实时资产价值偏移。

不得按名义交易量直接发放 mStock，以避免对刷交易和循环交易套利。

### 6.3 非托管 NFT Gauge / Subscriber

V1 最终采用 `CanonicalLPNFTGauge`，由每个 mStock 市场独立部署并实现 Uniswap v4 `ISubscriber`。本方案不托管 LP NFT、不发行 tgLP，也不实现标准区间 Vault、自动再平衡、NAV 或 ERC-4626 份额会计。

用户参与链路为：

~~~text
用户钱包持有 canonical PositionManager NFT
→ 用户直接调用 PositionManager.subscribe(tokenId, CanonicalLPNFTGauge, data)
→ PositionManager 调用 Gauge.notifySubscribe
→ Gauge 从 PositionManager 读取 owner、PoolKey、tick、liquidity 和 subscriber 状态
→ 校验通过后开始按 liquidity × 有效时间计奖
~~~

用户直接调用 `PositionManager.subscribe`，不需要把 NFT 转给 Gauge，也不应为 Gauge 授予 NFT 转移权限。`data` 只能作为版本化提示，Gauge 不得信任其中的 owner、PoolId、tick 或 liquidity，所有资格数据必须从 canonical PositionManager 读取。

V1 的可奖励仓位必须同时满足：

- NFT 来自当前环境部署清单中的 canonical PositionManager。
- `subscriber(tokenId)` 等于该市场的 `CanonicalLPNFTGauge`，且同一 NFT 不能重复登记。
- PoolKey 与 Registry 登记的 canonical PoolId 完全一致，包括币对、fee、tickSpacing 和 TickerGarden Hook。
- `tickLower = TickMath.minUsableTick(tickSpacing)` 且 `tickUpper = TickMath.maxUsableTick(tickSpacing)`，即精确的官方全区间。
- 当前 `liquidity > 0`。

在所有可奖励 NFT 使用同一 PoolId 和同一全区间的前提下：

~~~text
UserSubscribedLiquidity = Σ 该用户已订阅 NFT 的当前 liquidity

TotalSubscribedLiquidity = Σ 全部通过校验且已订阅 NFT 的当前 liquidity
~~~

Gauge 可按用户聚合 `UserSubscribedLiquidity` 以 O(1) 领取和结算，但不需要任何股票门槛状态或跨 Gauge 回调。LP 手续费仍属于 NFT owner；领取手续费不会把费用交给 Gauge，也不形成额外 mStock 奖励。

Subscriber 生命周期必须满足：

- `notifySubscribe`：仅接受 canonical PositionManager 调用；验证仓位并登记用户、liquidity 与奖励债务。
- `notifyModifyLiquidity`：先按旧 liquidity 结算，再更新该 NFT 和用户聚合 liquidity；不得在回调中铸币、转币、Swap 或调用任意外部目标。回调中的 `feesAccrued` 可被 donation 影响，只用于观测或直接忽略，绝不能进入奖励权重。
- `notifyUnsubscribe`：按已登记受益人结算到当前时点并停止计奖；回调必须常数时间、非重入且不能被普通暂停阻断。
- `notifyBurn`：结算并永久移除仓位；该回调失败会使 PositionManager 的 burn 回滚，因此必须常数时间、非重入、正常路径不 revert，且不能被普通暂停阻断。
- PositionManager 在 NFT 转移时自动取消订阅；转移后的新 owner 若要参与，只需重新订阅并通过仓位校验。
- 用户可随时直接取消订阅；即使 Gauge 的新增订阅被暂停，也不能限制用户操作自己的 NFT 或领取已产生奖励。

Uniswap PositionManager 对取消订阅回调设置 Gas 上限；调用交易必须先提供不低于该检查要求的剩余 Gas，通过检查后，即使 `notifyUnsubscribe` 自身失败，PositionManager 仍完成取消订阅。因此 Gauge 的 `notifyUnsubscribe` 必须只做有界内部记账，并通过 Gas 上界测试；同时提供 permissionless `syncPosition(tokenId)` 作为防御性对账入口。领取与仓位同步前必须核对 `subscriber(tokenId)`、owner 和当前 liquidity，发现状态不一致时停止该仓位后续计奖。该补偿路径不能替代正确回调，测试必须证明正常取消订阅和转移均能在官方 Gas 上限内完成结算。

如果 `notifyModifyLiquidity` 或 `notifyBurn` 因 Gauge 异常而阻塞用户操作，前端和文档必须提供明确逃生流程：用户用足够交易 Gas 先直接调用 PositionManager `unsubscribe(tokenId)`，确认订阅已经清除后，再修改流动性或 burn。任何 TickerGarden 暂停开关都不得关闭这条路径。

### 6.4 Robinhood Chain v4 支持核验

截至 2026-09-01，Uniswap 官方部署清单已经列出 Robinhood Chain 主网（Chain ID 4663）的 v4 合约：

| 合约 | RH 主网地址 |
|---|---|
| PoolManager | `0x8366a39cc670b4001a1121b8f6a443a643e40951` |
| PositionManager | `0x58daec3116aae6d93017baaea7749052e8a04fa7` |
| Quoter | `0x8dc178efb8111bb0973dd9d722ebeff267c98f94` |
| StateView | `0xf3334192d15450cdd385c8b70e03f9a6bd9e673b` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |

Uniswap 官方 `PositionManager` 继承 `Notifier`，并实现 `subscribe`、`unsubscribe` 以及对 `ISubscriber` 的仓位修改、取消订阅、转移和销毁通知，因此 RH 主网满足 NFT Gauge/Subscriber 的技术前提。生产部署仍须从版本化环境清单读取地址，并在部署前重新校验 chain ID、合约代码哈希、`poolManager()`、Subscriber 接口和构造参数；业务合约不得仅凭本文地址硬编码信任。

本次通过 Robinhood 官方公共主网 RPC 进一步读取到：chain ID 为 4663；上述 PositionManager 具有 23,877 bytes runtime code；`poolManager()` 返回表中 PoolManager；`unsubscribeGasLimit()` 返回 300,000；合约名称为 `Uniswap v4 Positions NFT`；runtime bytecode 中存在 `subscribe`、`unsubscribe`、`subscriber` 与 `unsubscribeGasLimit` 的函数选择器。这是 2026-09-01 的点时核验结果，不能替代部署脚本在目标区块再次执行相同 preflight。

Robinhood 官方提供测试网 Chain ID 46630，但该网络截至核验日未出现在 Uniswap 官方 v4 测试网部署清单。主网地址不得复制到测试网。canonical 集成测试优先使用固定区块的 RH 主网 Fork；如 V1 需要 RH 公共测试网端到端演练，则部署并锁定仅供测试的 v4 core/periphery 版本及独立地址清单，或在 Uniswap 后续发布 RH 测试网官方地址后切换并重新验证。

核验来源：

- [Robinhood Chain 网络配置](https://docs.robinhood.com/chain/connecting/)
- [Uniswap v4 官方部署清单](https://developers.uniswap.org/docs/protocols/v4/deployments)
- [Uniswap v4 PositionManager](https://github.com/Uniswap/v4-periphery/blob/main/src/PositionManager.sol)
- [Uniswap v4 Notifier](https://github.com/Uniswap/v4-periphery/blob/main/src/base/Notifier.sol)
- [Uniswap v4 ISubscriber](https://github.com/Uniswap/v4-periphery/blob/main/src/interfaces/ISubscriber.sol)

## 7. 官方 Uniswap v4 池

### 7.1 唯一官方 PoolKey

每个 Ticker Meme 市场登记一个官方 canonical PoolKey，至少固定：

~~~text
currency0 / currency1
TickerMemeToken / RH_CANONICAL_USDC
fee configuration
tickSpacing
TickerGarden Fee Hook
~~~

V1 的结算资产已经固定为 Robinhood Chain canonical bridge 映射的 USDC，不再保留可切换的通用稳定币参数。主网绑定：

~~~text
Ethereum Circle USDC:
0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48

RH L2 Gateway Router:
0x1E324B9316138CA9a73F960213621AD1aaf01B89

RH canonical-bridge USDC:
0x80e0e24718dbfcad49ecaa6f1e6c89a190586ca8

name: USD Coin
symbol: USDC
decimals: 6
~~~

该地址由 RH 官方 L2 Gateway Router 的 `calculateL2TokenAddress(EthereumUSDC)` 得出；2026-09-01 点时链上读取确认其 `l1Address()` 返回上述以太坊 Circle USDC。它是通过 RH canonical bridge 部署的桥接表示，不是 Circle 在 Robinhood Chain 原生发行的 USDC。Circle 当前原生 USDC 地址清单尚未列出 Robinhood Chain，因此前端和宣传必须使用“RH canonical-bridge USDC”，不得使用“Circle-native USDC”表述。

RH 测试网当前可使用由测试网 L2 Gateway Router 映射的 `USDC.e` 测试资产 `0x71c6e1c209a4e3d4bd9911b2d53c98023a56c32f`（6 decimals）；它没有主网价值，只能进入测试环境 manifest。主网与测试网部署脚本都必须重新校验 chain ID、地址、runtime code、symbol、decimals、L1 映射与 transfer 行为，禁止只按 `USDC` Symbol 信任资产。

来源：[Robinhood Chain Protocol Contracts](https://docs.robinhood.com/chain/protocol-contracts/)、[Robinhood Chain Bridging](https://docs.robinhood.com/chain/bridging/)、[Circle USDC Contract Addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses)。

Factory 记录：

~~~text
canonicalPoolId[assetUid] = poolId
canonicalPoolKey[assetUid] = poolKey
~~~

只有该 PoolId 可以进入官方 LP 挖矿。

TickerGarden 无法也不会阻止第三方创建：

- 相同币对、不同费率的池。
- 相同币对、不同 tickSpacing 的池。
- 相同币对、没有 TickerGarden Hook 的池。
- mStock 与其他资产的池。

这些外部池不会被官方 Router 默认使用，也不能获得官方 LP 挖矿奖励。

### 7.2 REGISTERED 与 INITIALIZED

官方池具有两个阶段：

~~~text
REGISTERED
PoolKey 已登记
尚无初始价格
尚无流动性

        ↓ 任意用户调用 initializeAndAddLiquidity

INITIALIZED
初始价格已经写入
首笔流动性已经加入
开放正常交易和后续加仓
~~~

技术上，创建 mStock 挖矿市场时同步创建的是 PoolKey、Hook、Initializer 和 LP 挖矿配置；真正的 Uniswap v4 initialize 必须等待首个 LP 用户提供初始价格。

## 8. 无许可首个 LP 定价

mStock 开始挖出后，任何地址都可以成为官方池的第一个流动性提供者。

首个 LP 用户自行决定：

- 初始 Ticker Meme/USDC 价格。
- 投入的 mStock 数量。
- 投入的 USDC 数量。
- 在 canonical 全区间约束内的首笔仓位。
- 交易时机。

平台不进行：

- 预言机定价。
- 股票价格映射。
- 平台报价。
- 人工审核。
- 白名单 LP 审批。
- 初始价格纠偏。
- 初始价格担保。

初始化必须通过无许可 PermissionlessInitializer，在同一笔交易中完成：

~~~text
initialize(initialSqrtPriceX96)
+
addLiquidity(TickerMemeToken, USDC, tickRange)
~~~

Initializer 只提供流程安全，不决定价格：

- 任何地址均可调用。
- 只能初始化 Registry 中的 canonical PoolKey。
- 初始化和第一笔非零流动性必须原子完成。
- 首笔必须实际到账至少 500 USDC；必须同时提供非零 Ticker Meme，并最终形成非零 liquidity。
- 首笔仓位必须精确使用该 PoolKey tickSpacing 的 canonical 全区间。
- USDC 最低值按交易实际到账余额变化校验，不能只检查前端或调用者提交的 `amountDesired`。
- 初始价格必须位于首个仓位的有效区间内。
- 初始化成功后不能再次初始化。
- 必须记录初始化者、初始价格、区间、资产数量和流动性事件。

第一个用户可能采用极端价格或很少的流动性，这是无许可定价的自然结果。后续市场参与者通过加减流动性和套利交易形成市场价格，TickerGarden 不介入。

前端必须明确显示：

> mStock 初始价格由首个流动性提供者设定，不代表 TickerGarden、Robinhood Chain、Stock Token 发行人或对应上市公司的定价及认可。

## 9. 固定 1% 单边手续费

> **G0-07 实现口径待签字：** P-003 已证明，如果 Hook 先按 gross input 收取严格 0.40%，v4 原生 0.60% LP fee 只能对剩余 99.60% 输入收费，组合费率为 0.9976% 而非严格 1%。本章的 1% 与 60%/40% 表述仍代表产品目标，不代表生产整数公式已经批准。推荐将协议费改为补足总费到 1% 的 remainder（约 gross 0.402414%）；详见 [`V1_V4_FEE_AND_SUBSCRIBER_SPIKE.md`](./V1_V4_FEE_AND_SUBSCRIBER_SPIKE.md)。签字前不得实现生产 Hook。

### 9.1 收费口径

每笔 Swap 的总有效手续费固定为输入资产的 1%。

~~~text
买入 mStock：
用户输入 USDC
从 USDC 输入额中收取 1%

卖出 mStock：
用户输入 mStock
从 mStock 输入额中收取 1%
~~~

买入和卖出是两笔独立 Swap。如果用户先买入再卖出，在不考虑价格波动、滑点和 Gas 的情况下，理论往返手续费约为：

~~~text
1 - 0.99 × 0.99 = 1.99%
~~~

此前讨论的成熟后降至 0.5% 方案取消。V1 使用长期固定 1% 有效手续费，不依赖预言机、时间、区块阶段或外部数据。

### 9.2 LP 与协议分配

每笔 Swap 的 1% 总有效手续费分为：

| 去向 | 占成交输入额 | 占总手续费 |
|---|---:|---:|
| 当前有效区间 LP | 0.60% | 60% |
| TickerGarden 协议 | 0.40% | 40% |
| 合计 | 1.00% | 100% |

原推荐技术实现（P-003 后不得直接照此编码，须先关闭上述 G0-07 口径）：

~~~text
Uniswap v4 LP fee：0.60%
TickerGarden Hook custom accounting：0.40%
用户界面显示的总有效手续费：1.00%
~~~

不得将 PoolKey 的 LP fee 直接设置为 1% 后再额外收取 0.40%，否则用户实际手续费会超过 1%。

### 9.3 协议手续费的不对称用途

0.40% 协议手续费的用途由 Swap 输入资产方向确定。

买入 Ticker Meme Token 时，用户输入 RH canonical-bridge USDC。协议手续费按以下比例在 ProtocolFeeVault 中立即完成内部记账：

| 买入侧用途 | 协议份额内部比例 | 占成交输入额 |
|---|---:|---:|
| 购买对应 Stock Token，直接进入该股票独立国库 | 40% | 0.16% |
| 购买并销毁 TGARD | 40% | 0.16% |
| 协议收入 | 20% | 0.08% |
| 合计 | 100% | 0.40% |

卖出 mStock 时，用户输入 mStock：

| 卖出侧用途 | 协议份额内部比例 | 占成交输入额 |
|---|---:|---:|
| 进入对应市场的 mStock Burn Bucket，之后异步销毁 | 100% | 0.40% |
| 合计 | 100% | 0.40% |

卖出侧协议手续费不进入 Stock Token 购买、TGARD 回购或协议收入分配，也不得由 FeeExecutor 再次卖入市场。销毁只降低 `totalSupply()`，不得降低 `MintedSupply` 或重新释放已经消耗的排放额度。

TGARD 回购销毁仍是 V1 必备功能，但只由买入侧获得的稳定币协议手续费提供资金。

### 9.4 用户交易与异步执行边界

用户 Swap 链路只允许完成：

~~~text
校验 canonical PoolKey
→ 结算 0.60% LP fee
→ 扣取 0.40% protocol fee
→ 按 marketId、输入资产和用途写入 ProtocolFeeVault
→ 返回 Swap 结果
~~~

TickerGardenV4Hook 不得在 Swap 回调中：

- 调用外部 Router 执行兑换。
- 查询回购报价或外部价格预言机。
- 购买 Stock Token 或 TGARD。
- 销毁 mStock 或 TGARD。
- 向 StockTreasuryVault 或 ProtocolTreasury 执行后续划拨。
- 等待链下服务返回结果。

协议外部执行程序在用户交易结束后独立运行：

~~~text
读取待执行 Bucket
→ 检查时间间隔、最小金额和执行上限
→ 获取允许路径的报价
→ 计算 minAmountOut 与 deadline
→ eth_call 模拟
→ 调用链上 FeeExecutor
→ 等待确认并核对链上事件与余额
~~~

外部程序只负责选择执行时机和提交受约束交易，不托管手续费资产，也不得成为用户 Swap、领取奖励、解除股票质押或操作 LP NFT 的必要依赖。外部程序停止、报价异常或 FeeExecutor 执行失败时，用户交易继续正常运行，未处理资产保留在 ProtocolFeeVault 中等待后续重试。

### 9.5 ProtocolFeeVault 记账

ProtocolFeeVault 至少按以下键隔离余额：

~~~text
marketId
feeAsset
bucketType
~~~

买入侧的 `bucketType` 为 `STOCK_BUYBACK`、`TGARD_BUYBACK` 和 `PROTOCOL_REVENUE`；卖出侧只有 `MSTOCK_BURN`。整数拆分时先计算两个 40% Bucket，剩余值全部归入 20% 协议收入 Bucket，保证每笔协议手续费完整守恒且没有未记账 Dust。

ProtocolFeeVault 不提供任意资产提取或通用外部调用。FeeExecutor 只能消费与目标操作一致的 Bucket；失败交易必须整体回滚，不能出现 Bucket 已扣减但目标资产未到账或未销毁的状态。

## 10. 对应 Stock Token 国库

每个 mStock 市场拥有独立的 Stock Token TreasuryVault：

~~~text
mNVDA 手续费收入
→ 购买 NVDA Stock Token
→ NVDA TreasuryVault

mTSLA 手续费收入
→ 购买 TSLA Stock Token
→ TSLA TreasuryVault
~~~

不同股票国库不得自动混用。当前 V1 推荐方向为：

- StockTreasuryVault 与 mStock Token 分开部署，mStock 合约不持有 Stock Token。
- 只持有对应 canonical Stock Token。
- FeeExecutor 购买 Stock Token 时，将接收地址直接设置为对应 StockTreasuryVault，不经过链下程序、Keeper 或临时中转地址。
- 不跨股票调拨。
- 不用于团队或日常运营。
- 不用于 TGARD 回购。
- 不借贷、不加杠杆、不部署第三方收益策略。
- 不提供任意 `execute`、常规 `approve` 或正常状态下提取 canonical Stock Token 的接口。
- 仅在合约迁移、公司行动、退市、安全事故或协议终止等预定义事件中处置。

国库不代表 mStock 持有人享有 1:1 赎回权或底层股票所有权。

## 11. 收入与流动性飞轮

~~~text
质押对应 Stock Token
→ 持续挖出 mStock
→ 用户无许可初始化官方 Ticker Meme/USDC 市场
→ 用户提供官方 LP 并直接订阅
→ LP NFT 通过仓位校验并直接订阅后获得额外 mStock
→ 官方池流动性和交易深度增加
→ 1% 交易手续费增加
→ 买入侧稳定币协议费异步购买对应 Stock Token
→ 对应 StockTreasuryVault 增长
→ 买入侧稳定币协议费异步回购并销毁 TGARD
→ 卖出侧 mStock 协议费异步销毁
→ LP 获得真实手续费收入
~~~

必须同时披露反向风险：

~~~text
mStock 排放增加
→ 市场卖压增加
→ mStock 价格下降
→ LP 挖矿价值下降
→ LP 流动性可能退出
~~~

因此前端必须区分：

~~~text
Emission APR：来自新发行 mStock
Fee APR：来自真实交易手续费
~~~

## 12. V1 合约模块

以下合约全部部署在 Robinhood Chain。V1 不包含 BridgeAdapter、CCIP TokenPool、LayerZero OFT、BSC wrapped token 或任何跨链消息接收器。

~~~text
OfficialStockRegistry
├── canonical Stock Token
├── Asset UID
└── 对应 Ticker Meme Token、marketId 与 canonical PoolId

TickerGardenFactory
├── 校验白名单和唯一性
├── 部署 Ticker Meme Token
├── 只接受 10 亿 / 100 亿 / 1000 亿供应档位并永久冻结
├── 部署股票池和 LP 池
├── 部署该市场专用 RewardEscrow
├── 登记 canonical PoolKey
├── 登记创建者提交的初始 Symbol
└── 收取市场创建费用

NamingGovernor / NamingExecutor
├── 以 Ticker Meme 锁定或委托投票权形成快照
├── 执行 7 天投票、参与率、赞成率、冷却期与 7 天 Timelock
├── 只允许第一次成功执行调用 Token.finalizeMetadata
└── 不改变 marketId、Token 地址、PoolKey、Gauge、余额或供应会计

StockStakingGauge
├── Stock Token 存取
├── 以 10,000 美元对应的 Stock Token 整数数量计算池级软门槛系数
├── 股票池奖励结算
└── 领取时执行 20% 即时 / 80% RewardEscrow 分流

CanonicalLPNFTGauge（ISubscriber）
├── 不托管 NFT，只接受 canonical PositionManager 回调
├── 只登记 canonical PoolId 的精确全区间仓位
├── 允许任意合格 LP NFT owner 直接订阅，不读取 Stock Token 余额
├── 按用户聚合 subscribed liquidity 并 O(1) 结算
├── 处理 subscribe、modify、unsubscribe、transfer 和 burn 生命周期
├── 按最终冻结的统一排放时钟释放 mStock
├── 处理仓位同步、停止计奖和领取
└── 领取时执行 20% 即时 / 80% RewardEscrow 分流

TickerGardenV4Hook
├── 校验 canonical PoolKey
├── 每笔 Swap 收取协议 0.40%
├── 识别买入 USDC 与卖出 mStock 方向
├── 只完成手续费记账与归集
└── 将收入交给 ProtocolFeeVault

PermissionlessInitializer
├── 任意地址可调用
├── 原子初始化和加入首笔流动性
├── 校验实际到账至少 500 USDC、非零 Ticker Meme、非零 liquidity 和 canonical 全区间
├── 不使用预言机或平台定价
└── 记录初始化信息

ProtocolFeeVault
├── 按 marketId、feeAsset 和 bucketType 隔离记账
├── 买入侧登记 40% / 40% / 20% Bucket
├── 卖出侧登记 100% mStock Burn Bucket
└── 只允许 FeeExecutor 消费匹配用途的 Bucket

FeeExecutor
├── 异步消费买入侧 USDC Bucket
├── 购买对应 Stock Token 并直接转入 StockTreasuryVault
├── 回购并销毁 TGARD
├── 异步销毁卖出侧 Burn Bucket 中的 mStock
├── 划拨协议收入
└── 执行 deadline、minAmountOut、额度、间隔和路径限制

StockTreasuryVault
├── 每只股票独立
├── 只接收对应 Stock Token
├── 与 mStock Token 完全分离
└── 按预定义事件受限处置

ProtocolTreasury
└── 只接收已经完成归属的协议收入

TGARD
└── 提供 V1 回购后的可验证销毁接口

EmissionController（暂定模块名）
├── 股票池 70% / LP 池 30% 固定总预算
├── 48 个月排放窗口
├── LP 在股票池开始 7 天后启动并共享最终截止时间
├── 统一排放时钟与速率
├── 排放衰减
├── 期末永久取消所有未进入 PoolReleased 的挖矿额度
└── 三档固定供应上限检查

RewardEscrow
├── 每个 mStock 市场独立部署且只接收该 mStock
├── 接收每次已领取奖励的 80%
├── 按该次领取时间在 56 天内线性释放
├── 解除股票质押或 LP 停止计奖不罚没既有奖励
└── 不允许管理员提前解锁、取消或没收
~~~

V1 另有一个非合约运维组件：Off-chain Execution Worker。它负责读取 Bucket、获取报价、模拟并提交 FeeExecutor 交易、确认结果、重试和告警；它不持有协议资产，也不拥有绕过 FeeExecutor 限制的权限。

## 13. 非目标与风险披露

V1 不提供以下承诺：

- mStock 不代表对应公司的股票。
- mStock 不授予股东权、投票权或股票分红权。
- mStock 不能按照固定比例赎回 Stock Token。
- Ticker Meme/USDC 市场价格不保证跟踪股票价格。
- 首个 LP 价格不代表合理价格或公允价格。
- 官方池不代表全链唯一可交易池。
- 1% 手续费和 LP 激励不保证外部低费池不会出现。
- LP 挖矿 APR 不保证覆盖无常损失或 mStock 价格下跌。
- 挖矿 APR 中的 mStock 排放不等同于真实协议收入。
- Stock Token 国库不等同于 mStock 持有人的个人资产。
- StockTreasuryVault 不构成 mStock 的抵押、价格下限或赎回储备。
- TGARD 回购销毁不保证 TGARD 价格上涨，也不构成价格支撑承诺。
- 卖出侧 mStock 销毁不能阻止当前 Swap 的价格冲击，也不能单独抵消高排放造成的卖压。
- FeeExecutor 可能因余额不足、报价、滑点、流动性、预言机或外部路由异常而延迟执行；未执行 Bucket 不得宣传为已经完成的回购、销毁或国库收入。
- V1 不支持将 mStock 转移到 BSC 或其他链。
- 第三方自行部署的同名 token、包装资产或桥接资产不属于 TickerGarden canonical mStock。
- V1 的 RH 质押仓位、LP 仓位和奖励资格不会同步到其他链。
- 每个 canonical Ticker Meme 的名称和 Symbol 可能在社区执行唯一一次最终命名后发生变化；钱包、DEX、浏览器或第三方索引器可能暂时继续显示旧 Symbol。
- 创建者提交的初始 Symbol 和社区最终 Symbol 都不构成资产身份、股票价格映射、上市公司认可或商标授权；用户必须核对官方合约地址与 `marketId`。

Robinhood Stock Token 具有发行人、司法辖区和交易资格限制。协议保持无许可不代表所有用户在所有地区都具有合法交易资格；正式上线前必须完成证券、代币激励、Vault、Hook、前端准入和市场推广相关法律评估。

## 14. 参数状态

### 14.1 已确定

| 参数 | V1 规则 |
|---|---|
| 部署链 | 协议生产环境仅 Robinhood Chain 主网 4663；开发环境可使用 RH 测试网 46630 |
| 用户侧资产类别 | Ticker Meme |
| 初始 Symbol | 创建者填写 3–8 位 ASCII 英文字母；统一大写、平台内唯一并通过保留词校验 |
| Symbol 历史唯一性 | 当前和历史 Symbol 均永久保留；改名后旧 Symbol 不得被其他市场复用 |
| Token 全称 | 协议自动生成 `<SYMBOL> — <STOCK_TICKER> Ticker Meme` |
| 社区最终命名权 | 永久有效；第一次成功执行后永久消耗，失败提案不消耗 |
| 命名投票 | 7 天投票、10% 已释放供应快照参与率、有效票三分之二赞成、通过后 7 天时间锁、失败后 30 天冷却 |
| 最终命名后的可变性 | `metadataFinalized = true`，名称和 Symbol 永久冻结；Token 地址与全部市场关系不变 |
| 资产身份主键 | Robinhood Chain ID + Asset UID 派生的 `marketId` 及 canonical 合约地址；不得使用 Symbol 作为主键 |
| Ticker Meme Token canonical 发行链 | Robinhood Chain |
| BSC 与跨链 | V1 不启用，V2 另行评审 |
| AMM | Uniswap v4 |
| 官方交易对 | Ticker Meme/RH canonical-bridge USDC |
| RH 主网 USDC | `0x80e0e24718dbfcad49ecaa6f1e6c89a190586ca8`，6 decimals |
| USDC 资产性质 | RH canonical bridge 映射的以太坊 Circle USDC，不宣称为 Circle-native RH USDC |
| 官方池数量 | 每个 Ticker Meme 市场一个 canonical PoolKey |
| 外部池 | 允许，但无官方 LP 奖励 |
| 初始定价 | 首个 LP 用户无许可决定 |
| 平台价格干预 | 无 |
| 预言机用于初始定价 | 不使用 |
| 总有效手续费 | 每笔 Swap 输入资产的 1% |
| 成熟后降费 | 取消 |
| LP 手续费份额 | 成交输入额的 0.60% |
| 协议手续费份额 | 成交输入额的 0.40% |
| 买入侧协议费用途 | 40% Stock Token / 40% TGARD 销毁 / 20% 协议收入 |
| 卖出侧协议费用途 | 100% 对应 Ticker Meme Token 异步销毁 |
| TGARD 回购 | V1 必须实现，由买入侧稳定币协议费提供资金 |
| 后续处理时机 | 用户 Swap 后，由协议外部程序异步触发链上 FeeExecutor |
| Hook 执行边界 | 只收费、记账和归集，不执行回购、销毁、外部 Router 或国库处置 |
| Stock Token 国库 | 每个市场独立部署，且与 Ticker Meme Token 分离 |
| 股票池和 LP 池 | 完全分开 |
| Ticker Meme 最大供应档位 | 创建者只能选择 10 亿、100 亿或 1000 亿；部署后不可修改 |
| Ticker Meme decimals | 18 |
| 总挖矿预算 | 等于最大供应；无预挖、团队份额、空投或额外创世铸造 |
| 股票池 / LP 池总排放预算 | 70% / 30% |
| 排放窗口 | `block.timestamp`；股票池固定 1460 天，LP 延迟 7 天并共享终点；每市场精确起点写入 launch manifest |
| 排放曲线 | 初始 1.5 倍平均速率线性衰减至 0.5 倍；累计 `B × (1.5x - 0.5x²)`，无尾部 |
| 排放期末处理 | 停止新增 ReleasedBudget；未释放额度永久取消；期末前已赚取未领取权益仍可 claim |
| 股票池软门槛 | 创建时按官方 multiplier-adjusted Feed 将 10,000 美元换算为完整 Stock Token 并向上取整冻结；允许任意非零数量质押 |
| LP 池排放起点 | 股票池排放开始 7 天后；与股票池使用同一最终截止时间 |
| LP 挖矿凭证 | 非托管 canonical PositionManager NFT Gauge/Subscriber；不使用 Vault 或 tgLP |
| 可奖励 LP 区间 | canonical PoolId 的精确全区间 |
| LP 有效份额 | 原始 liquidity × 有效订阅时间；按用户 O(1) 聚合 |
| LP 奖励资格 | canonical LP NFT 通过仓位校验并成功订阅；无需持有或质押 Stock Token |
| 奖励领取 | 每来源至少间隔 7 天；每次 20% 立即到账，80% 自领取时起在 56 天内线性释放 |
| RewardEscrow 上界 | 每用户每来源最多 8 个活跃 tranche，成熟槽位结清后复用 |
| 解除质押对归属奖励的影响 | 不罚没、不加速、不重新分配，继续按原时间表释放 |
| RewardEscrow 管理权限 | 不允许管理员提前解锁、取消或没收用户奖励 |
| 已解锁奖励提取 | `releaseVested` 不受普通紧急暂停影响，不依赖管理员或外部 Worker |
| Ticker Meme Token 释放 | 固定终身上限、按秒平滑线性衰减持续释放，无追赶或尾部 |
| 排放额度记账 | `PoolMinted <= PoolReleased <= PoolBudget`；`MintedSupply` 单调递增，burn 不恢复额度 |
| 首笔 LP 最低值 | 实际到账至少 500 USDC，同时提供非零 Ticker Meme 并形成非零 liquidity |
| 首笔 LP 区间 | canonical PoolKey 的精确全区间 |
| 首发 Stock Token | NVDA；部署前必须完成 canonical manifest 校验 |
| 网站架构 | Web/Backend API 分离；数据库聚合走 API，公开无特权的钱包/RPC/canonical v4 服务可由前端直连 |
| LP 价值预言机 | 不使用 |
| 交易量奖励 | 不启用 |

### 14.2 尚待确定

以下内容没有得到产品或安全层面的最终确认，开发者不得自行补默认值。其中第 1–19 项均会影响合约接口、不可变量或部署参数，应在对应模块开工前冻结。

1. **P-002 数学规格签字**：decimals、预算关系、1460/1453 天时间轴、衰减累计函数、错过排放、`PoolReleased/PoolMinted`、`1e27` scaled 会计、7 天 claim cooldown、8 槽 Escrow、软门槛快照与 Bucket 舍入已写入 `V1_MATH_AND_STATE_MACHINES.md` 并有可执行测试；仍须产品与安全负责人对同一版本签字，且每市场精确开始时间留在 launch manifest。
2. **Ticker Meme Token ABI**：数学层已固定 18 decimals、无额外发行和唯一 EmissionController minter 方向；仍须冻结最终技术合约名、mint/burn ABI、EIP-2612 Permit、ERC20Votes timestamp clock、metadata 存储、错误和事件。
3. **Stock Token 兼容性**：软门槛快照已固定为创建时读取 multiplier-adjusted Feed、完整 Token 向上取整且创建后冻结；仍须冻结通用适配器对 rebasing、fee-on-transfer、非标准返回、暂停、Beacon 升级、decimals 变化和资产迁移的接受/拒绝矩阵。该适配不得成为 LP 资格条件。
4. **Subscriber 版本清单**：`CanonicalLPNFTGauge` 最终 ABI、错误和事件，绑定的 periphery commit、PositionManager runtime code hash、PoolManager 关系、回调调用顺序、每个回调的内部 Gas 安全预算和部署 preflight。
5. **LP 奖励受益人与领取权限**：订阅时的 beneficiary/owner 快照、NFT 转移前后待领奖励归属、按用户还是按 tokenId 领取、是否允许 permissionless claim-for，以及收款地址是否必须固定为已登记受益人、不得由调用者重定向。
6. **`syncPosition` 与异常仓位**：permissionless、幂等和 O(1) 约束；发现 subscriber/owner/liquidity 不一致时的奖励截止点；是否只允许停止未来计奖而不得改写历史受益人；重复调用、burn tombstone、零 liquidity 后重新加仓是否需要重新订阅。
7. **Gauge 暂停、逃生和迁移**：`subscribe`、accrual、claim、modify、unsubscribe、transfer、burn、fee collect、`syncPosition` 和 `releaseVested` 的完整暂停矩阵；旧 Gauge 停止新订阅、新旧计奖切点、用户主动迁移及旧奖励持续领取规则。Gauge 不采用可升级代理，迁移不得要求管理员托管 NFT。
8. **完整 PoolKey 与 Hook 会计**：USDC 与 Ticker Meme Token 的 `currency0/currency1` 排序、fee 数值/动态标记、tickSpacing、Hook 权限位、共享或每市场 Hook、PoolId 不可变绑定；exact-input/exact-output 下 gross input、0.60% LP fee、0.40% protocol fee、舍入和 `minAmountOut` 的精确公式，确保只收费一次。
9. **首笔流动性剩余安全参数**：首笔已固定为实际到账至少 500 USDC、非零 Ticker Meme、非零 liquidity 和 canonical 全区间；仍须冻结允许的 `sqrtPriceX96`/tick 边界、Ticker Meme 最低量、deadline/slippage、原子回滚与同交易撤空防护，以及市场长期未初始化时的状态处理。
10. **环境与 NVDA 首发部署清单**：首发资产已固定为 NVDA；仍须为主网、固定区块主网 Fork、RH 公共测试网维护可由脚本读取的 manifest，包含 NVDA Asset UID/canonical 地址/Feed/multiplier、chain ID、依赖地址、版本、代码哈希、部署区块、构造参数和验证状态；测试专用 v4 与 USDC.e 地址不得混入主网。
11. **市场创建与生命周期权限**：P-002 已把主状态缩减为 `REGISTERED/ACTIVE/PAUSED/RETIRED` 并冻结经济行为；仍须冻结创建费用、Factory 版本化、失败回滚、每条转换的 caller/Timelock 与退休条件。
12. **USDC 部署前校验**：主网 USDC 地址虽已固定，仍须冻结 runtime code hash、代理/升级风险接受标准、canonical bridge 映射复核、transfer/approve 返回行为、流动性下限和测试网 fixture；不得按 Symbol 自动发现或替换资产。
13. **TGARD 基础信息**：canonical 合约、供应与铸造权限、真实销毁接口、官方流动性池、允许 Router/路径、最低流动性、报价与滑点保护。
14. **Stock Token 购买规则**：每只股票允许的市场和完整路径、价格源与陈旧价格规则、低流动性/市场关闭处理、MEV 防护、购买输出直达 `StockTreasuryVault` 的原子校验。
15. **FeeExecutor 与 Worker 风控**：调用者、最小执行金额、间隔、最大滑点、deadline、单笔/每日上限、重试、幂等批次、nonce replacement、重组确认深度、Gas 资金、公开执行的 sandwich 风险和是否使用私有交易。
16. **FeeVault 与国库章程**：Bucket 守恒、买卖分桶舍入和失败回滚已冻结；仍须冻结事件、批处理上限、`ProtocolTreasury` 地址与收入用途，以及 `StockTreasuryVault` 在迁移、公司行动、退市、安全事故和协议终止时的接收地址、审批和披露流程。
17. **P-005 权限规格签字与真实地址**：3/5 Protocol Safe、48 小时 Timelock、独立 2/3 pause-only Guardian、7 天退休/国库迁移、Worker 专用函数和永久退出路径已写入 `V1_PERMISSIONS_AND_PAUSE_MATRIX.md` 并有机器检查；仍须产品/安全签字及提供真实 Safe/Guardian/Timelock/Treasury 地址和成员重叠政策。
18. **一次性最终命名实现**：`NamingGovernor` / `NamingExecutor` 最终 ABI、投票锁仓或委托、供应快照口径、7 天到区块数的冻结方式、保留词清单、重复/失败提案状态机、改名事件与第三方缓存刷新；同时统一清理新代码中的 `mStock` 技术命名，Symbol 永远不能成为身份主键。
19. **上线验证**：经济攻击模拟、无 Stock Token 门槛下 LP 排放稀释与多钱包行为模拟、初期流动性与卖压模拟、Hook/Gauge Fuzz 与 Invariant、异步执行故障演练、监控告警阈值、第三方安全审计、首发资产 manifest 和法律/合规上线门槛。
