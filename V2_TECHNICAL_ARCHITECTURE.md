# TickerGarden V2 技术架构

> 文档状态：`IMPLEMENTATION_ALLOWED / NOT_DEPLOYABLE`
> 更新时间：2026-09-04
> 产品与经济规则：参见 [V2_PROTOCOL_PARAMETERS.md](./V2_PROTOCOL_PARAMETERS.md)
> 发行兼容基线：[Pons V2 官方文档](https://docs.ponsfamily.com/v2)
> 行为继承与独立实现：[V2_PONS_BEHAVIOR_BASELINE.md](./V2_PONS_BEHAVIOR_BASELINE.md)
> 机制对比参考：[Pump.fun 费用](https://pump.fun/docs/fees) 与 [Pump.fun Bonding Curve](https://pump.fun/docs/bonding-curve)（只借鉴原则）
> 版本边界：本文只描述 V2，不覆盖或修改 V1 技术架构、接口与代码
> 规范性执行细节：[V2_EXECUTION_SPEC.md](./V2_EXECUTION_SPEC.md)；机器清单位于 `spec/v2_*`
> 合约拆分与合并决策：[V2_CONTRACT_ARCHITECTURE_DECISION.md](./V2_CONTRACT_ARCHITECTURE_DECISION.md)
> Stock Vault 决策：[V2_MULTI_ASSET_STOCK_VAULT.md](./V2_MULTI_ASSET_STOCK_VAULT.md)

本文中的“固定”表示当前 canonical `V2-EXEC-5` 产品/执行语义；明确标注的 `V2-EXEC-3` 仅为历史记录，不再生效或作为部署依据。Pons runtime、首发 native/USDG Quote、通用数值域，以及当前观测194种 Robinhood 官方 STOCK 全量可选为质押 Base 的规则已经取证冻结；STOCK 价格、Feed 覆盖和 backing target 不属于协议输入。当前状态为 `IMPLEMENTATION_ALLOWED`，可以编写产品实现，但未完成 artifact、目标链取证、Fork/E2E、审计和法律门禁前不得部署。

本轮合约架构优化采用“合并读取入口、不合并权威状态；复用代码、不共享市场资金状态”：三个配置 Registry 保持独立并增加无缓存的 typed `LaunchConfigResolver`；Token 与 Curve 继续按市场完整 CREATE2 部署；Gauge 使用一个固定 implementation 和每市场 deterministic immutable-args clone；持有 Position NFT 与余额的 LaunchLocker 继续每市场完整隔离。安全、管理与 Gas 取舍及部署证据要求见上述架构决策文档。

## 1. 架构结论

TickerGarden V2 采用混合式 STOCK 质押架构：

```text
经版本化冻结的 Pons V2 发行栈
+
每个 Vault schema 版本一个共享 MultiAsset UserStockVault
+ 每个 Ticker Meme 一个独立轻量 MemeStockGauge
+ 一个受约束 AllocationManager 原子协调 Vault 与 Gauge
```

产品层仍然表现为“一个毕业后的 Meme 对应一个可用质押池，用户自行决定每个币质押多少”；未毕业 Meme 只展示毕业进度，不提供质押入口。技术层不让每个 Meme 池分别托管 Stock Token 本金。所有资产通过显式 `assetUid` 进入当前 schema 的共享 `UserStockVault`，同一 STOCK 再以不可重复的内部额度分配给多个已开放 Gauge。

该方案在三种候选结构中取得最佳平衡：

| 维度 | 一资产一 Vault + Factory | 分片 MultiAsset Vault | V2：每 schema 单一 MultiAsset Vault |
|---|---|---|---|
| Vault 部署数量 | O(资产数) | O(分片数) | O(schema 版本数) |
| 用户 Token 授权 | 每 Token 各自授权不同 Vault | 每 Token 授权所属分片 | 每 Token 各自授权同一 Vault 地址 |
| 单次存取/分配复杂度 | O(1) | O(1) | O(1) |
| 地址、验证、监控成本 | 随数百资产线性增加 | 中等 | 最低 |
| 本金故障域 | 按资产隔离 | 按分片隔离 | 当前 schema 集中；账本按 UID 隔离 |
| 每 Meme 奖励状态 | 独立 Gauge | 独立 Gauge | 独立 Gauge |
| 推荐 | 否 | 风险预算触发后再评估 | 是 |

## 2. 设计目标与非目标

### 2.1 设计目标

- 一个 `Asset UID` 可以对应上万个 Ticker Meme。
- 用户只授权并存入一次同一种 Stock Token。
- 协议不设置钱包级 Meme 数量上限；用户实际可参与数量受 STOCK 本金、每仓位最低值与 Gas 限制。每个非零仓位必须达到当前 Registry 按 Asset UID 配置的 `minimumAllocation`（允许范围受 canonical numeric bounds 约束），并允许 canonical Stock Token 在 Registry 支持范围内的任意精度。
- 同一份 STOCK 不能跨 Gauge 重复计数。
- 每个 Meme 的 STOCK 质押者手续费独立、按有效 STOCK 比例分配；只有 `launchPhase == PoolCreated` 后才允许形成有效 STOCK 仓位。只要存在 active stake，Staker 固定取得 non-LP 的50%（约总手续费40%）；没有 active stake 时 Staker 为0。取消10 STOCK 饱和与线性释放。Quote 侧分 Quote，Ticker Meme Token 侧分 Meme Token，不做转换。
- 毕业后 LP 固定占总手续费约`20%`；零有效质押时为 `40% Creator / 0% Staker / 40% Platform / 20% LP`，存在任意 Active stake 时为 `20% / 40% / 20% / 20%`。曲线期禁止 STOCK 质押且不存在 LP，固定执行 `50% 创建者 / 50% 平台`。
- 零质押费用不购买 STOCK、不积压给未来质押者，也不部署 `STOCK_PURCHASE`、`FeeExecutor` 或 `ProtocolStockTreasury`。
- 曲线阶段和毕业后阶段共享同一个 `marketId` 与固定 Gauge 身份，但曲线期 Gauge 保持不可分配、无有效仓位；曲线费用不得进入质押者会计。
- 发行、定价、反狙击、部分成交、毕业与永久流动性逐项通过 Pons V2 参考测试；同时采纳 Pump.fun 的极简默认发行、原子 launch-and-buy 与毕业后真实 LP fee 原则。毕业池固定1%总费率，不采用动态成熟度费率档。所有差异必须版本化登记。
- 只有 `PoolCreated` 且市场 ACTIVE 时，`allocate` / `depositAndAllocate` / 增仓才可成功；成功后新增 STOCK 进入唯一 pending 增量，等待 `30 seconds` 才参与收益。旧 active 继续计奖，整个合并仓位从最新分配交易起锁定 `24 hours`。
- 单市场写操作保持 O(1)，不遍历所有 Meme 或所有质押者。
- Gauge、Indexer 或某一市场故障不得永久锁住用户 Stock Token 本金。
- 用户交易热路径不执行 STOCK Swap、任意外部策略或无界操作。

### 2.2 非目标

V2 不实现：

- Stock Token 质押排放 Ticker Meme；
- LP NFT 质押或 LP 挖矿；毕业后总手续费整数额的 `20%` 进入标准 Uniswap v4 in-range fee growth，具体地址按实际流动性份额取得；
- 可转让 Vault 份额 Token；
- Stock Token 借贷、再质押、做市或收益聚合；
- 一人一账户、身份验证或防多钱包；
- 用 Stock Token 价格锚定 Meme 价格；
- 在合约中限制每个钱包参与的 Meme 数量；
- 无界 `claimAll`、`withdrawAllMarkets` 或链上枚举；
- 任意 Router、任意 Token 或任意收款地址。

## 3. 系统拓扑

```text
OfficialStockRegistry
├── Asset UID: NVDA
│   ├── canonical NVDA Stock Token
│   └── UserStockVault schema v2 ─┐
│
└── Asset UID: TSLA
    ├── canonical TSLA Stock Token
    └── UserStockVault schema v2 ─┘（同一 canonical Vault 地址）

TickerGardenFactory
├── Market A ── Asset UID: NVDA
│   ├── TickerMemeToken A
│   ├── Pons-compatible BondingCurve A
│   ├── MemeStockGauge A
│   ├── per-market LaunchLocker（毕业时 CREATE2 部署）
│   ├── shared GraduationExecutor / Guard
│   ├── shared TickerGardenMemeHook
│   └── MarketController / Fee source state A
│
├── Market B ── Asset UID: NVDA
│   └── 独立 Gauge、曲线、费用与市场状态
│
└── Market C ── Asset UID: TSLA
    └── 独立 Gauge、曲线、费用与市场状态

User
→ UserStockVault.deposit(assetUid, STOCK amount)
→ wait until target market launchPhase == PoolCreated
→ AllocationManager.allocate(marketId, amount)
→ MemeStockGauge 在 checkpoint 后记录 pending，30秒后成为 active
→ MarketFeeAccounting 按该 Gauge 的 active total 分桶
→ User 分别 claim 该 marketId 实际收到的 Quote/Meme 手续费资产
```

用户 STOCK 本金只有一条路径：

```text
用户 STOCK → UserStockVault → 只能返还用户
```

毕业后 Hook 对核心 Swap 的 unspecified currency 实际 delta 固定收取1%；其中 `L = floor(T × 20%)` 通过 Uniswap v4 `PoolManager.donate` 增加该池当前 in-range LP 的 fee growth，不进入 `ProtocolFeeVault`；其余 `D = T - L` 以同一 Quote 或 Ticker Meme Token 实际转入 FeeVault 并按同资产分桶。曲线期没有 Uniswap LP，也不允许 STOCK 质押，全部实际手续费作为 non-LP 费用进入 FeeVault，并固定分给创建者和平台。

## 4. 标识与一对多关系

### 4.1 Asset UID

`OfficialStockRegistry` 继续使用稳定 `Asset UID` 与 canonical Stock Token 地址识别股票资产。Robinhood 官方目录中存在 chainId `4663` deployment 的全部资产都可准入；2026-09-02 点时观测为194项，这只是观测数量而非协议上限。每个 ACTIVE `Asset UID` 只绑定一个 `UserStockVault`，多个 UID 可以绑定同一共享 Vault；Registry 同时强制每个 Vault schema 只解析到一个 canonical Vault。每个 UID 可以绑定任意数量的 `marketId`。HTTP/API 只用于离线身份取证，运行时合约不依赖它；生产登记另需 finalized 状态和 Beacon/implementation 指纹。

推荐关系：

```solidity
mapping(bytes32 assetUid => AssetModules) public assetModules;

struct AssetModules {
    address stockToken;
    address userStockVault;
    uint8 tokenDecimals;
    AssetStatus status;
}
```

### 4.2 marketId

V2 删除 `marketIdForAsset(assetUid)` 的一对一语义，改为：

```solidity
// 唯一存放于 MarketRegistryV2；Factory 和其他模块不得保存第二份权威。
mapping(bytes32 marketId => MarketConfig) public markets;
mapping(bytes32 marketId => MarketRuntime) public marketRuntime;
mapping(address tickerMemeToken => bytes32 marketId) public marketIdByToken;
```

`MarketConfig` 至少包含：

```solidity
struct MarketConfig {
    bytes32 assetUid;
    uint256 minimumAllocation;        // Registry-configured per-Asset UID raw-unit floor
    bytes32 ponsBaselineId;
    bytes32 quoteAssetConfigId;
    bytes32 launchTemplateId;
    bytes32 feePolicyId;
    bytes32 expectedEconomics;
    uint256 launchConfigId;
    address creatorRevenueBeneficiary;
    address tickerMemeToken;
    address memeStockGauge;
    address quoteAsset;               // address(0) = Robinhood Chain native asset
    uint8 quoteDecimals;
    address curve;
    address graduatedHook;
    address marketController;
}

struct MarketRuntime {
    bytes32 poolId;
    uint32 sourceVersion;
    uint32 recoveryEpoch;
    uint64 sweptAt;
    uint64 statusSince;
    uint64 restrictedSince;
    LaunchPhase launchPhase;
    MarketStatus marketStatus;
}

enum LaunchPhase {
    NotGraduated,
    Swept,
    PoolCreated,
    Rescued
}
```

`MarketRegistryV2` 是上述不可变快照和可变 runtime 的唯一规范性状态权威。Factory 只通过 `registerMarket` 登记；Curve 只可把自己的市场从 `NotGraduated` 推进到 `Swept`；GraduationExecutor 只可把 `Swept` 推进到 `PoolCreated/Rescued`；MarketController 只可执行 MarketStatus 迁移。Hook 的 PoolBinding、Vault 的 allocation 与 Gauge 的 position 是从属执行状态，不得替代 Registry 门禁。完整 schema、caller、原子顺序和迁移图见 [V2_MARKET_REGISTRY_STATE_MODEL.md](./V2_MARKET_REGISTRY_STATE_MODEL.md)。

`PonsBaselineRegistry` 保存的是 Pons 参考配置的不可变副本，不在市场创建时临时读取外部 Factory：

```solidity
struct PonsBaseline {
    uint256 referenceChainId;
    address referenceFactory;
    bytes32 referenceFactoryCodeHash;
    uint256 launchConfigId;
    uint256 supply;
    uint256 curveFeeBps;
    uint24 poolFee;
    int24 tickSpacing;
    bytes32 behaviorVectorRoot;       // curve/snipe/graduation/fee reference vectors
    bool enabledForNewMarkets;
}

// Pons curve baseline 之外的 TickerGarden 毕业池固定费率策略。
struct FeePolicy {
    bytes32 feePolicyId;
    uint24 hookFeePips;               // fixed 10,000 / 1,000,000 = 1%
    uint16 lpShareBps;                // fixed 2,000 / 10,000 = 20%
    uint24 poolKeyFee;                // fixed 0
    uint160 hookPermissionMask;       // fixed 0x2044
    uint8 feeAssetMode;               // UNSPECIFIED_CORE_SWAP_DELTA
    bytes32 executionSpecId;          // V2-EXEC-5
}

struct QuoteAssetConfig {
    bytes32 ponsBaselineId;
    address quoteAsset;               // address(0) = native; WETH is a distinct ERC-20 Quote
    uint8 quoteDecimals;              // native fixed at 18; ERC-20 snapshotted at approval
    uint256 phantomQuote;
    uint256 graduationThreshold;
    bytes32 economicsHash;
    QuoteAssetStatus status;
}

enum QuoteAssetStatus {
    UNSET,
    ACTIVE,
    PAUSED,
    RETIRED
}
```

同一个 `ponsBaselineId` 和 `quoteAssetConfigId` 的经济与行为字段永不修改；只有 `enabledForNewMarkets/status` 门禁可以按受限状态机变化，并且只阻止新市场，不能改变历史市场的 Quote 或 economics。新 Pons release、Quote economics 或任何 TickerGarden 差异都创建新的 id。原生资产直接使用 Uniswap v4 native currency `address(0)`，不在协议内部静默改成 WETH；WETH 若获批，是另一个独立 ERC-20 Quote。

`expectedEconomics` 必须覆盖 `assetUid + canonical Stock Token + stockDecimals + ponsBaselineId + launchConfigId + quoteAssetConfigId + launchTemplateId + feePolicyId` 及全部不可变展开字段，但不包含只控制新发行的 `status`。动态 `minimumAllocation` 不进入 market hash：它从 OfficialStockRegistry 读取、由治理/管理员延迟更新，并在每次 allocation 变更时按当前值校验；协议不使用10 STOCK饱和或线性释放字段。原生 Quote 的 phantom/threshold 来自冻结的 native LaunchConfig；ERC-20 Quote 的外部来源是 Pons `pairTokenEconomics`，进入 TickerGarden 后统一快照为 `QuoteAssetConfig.phantomQuote/graduationThreshold`。Factory 不得临时读取外部 Pons Factory，也不得把一种 Quote 的数值复用于另一种 Quote。

当前观测194项 ACTIVE 官方资产全部可由创建者选择为市场唯一质押 Base，价格和 Price Feed 覆盖不能缩小集合。市场创建时校验 Asset UID 为 ACTIVE，并把该身份永久写入 MarketConfig；同一 Asset UID 可用于任意多个市场。生产登记前仍需 finalized 身份和代理实现取证，但不读取 STOCK 价格。完整规则见 [V2_OFFICIAL_STOCK_ADMISSION.md](./V2_OFFICIAL_STOCK_ADMISSION.md)。

BaselineRegistry 证明的是所选行为与参数，不证明源码许可或安全性。若 Pons 参考源码不可按适用许可复用，TickerGarden 必须以公开 ABI、链上状态和独立参考向量实现可审计的行为等价版本；不得复制来源或许可不明的代码。Pons 官方文档点时仍把三项审计列为进行中，TickerGarden 的 Curve/Hook/费用差异还必须接受独立审计。

链上不保存并遍历 `assetUid => marketId[]` 的完整动态数组。Factory 发出 `MarketCreated` 事件，Indexer 维护一对多查询。若合约需要验证市场属于某 STOCK，只读取 `markets[marketId].assetUid`，不枚举其他市场。

### 4.3 ApprovedQuoteRegistry

`ApprovedQuoteRegistry` 是创建市场时 Quote 选择的唯一权威。它采用追加式 config，而不是可变的 `quoteAsset => economics` 覆盖映射：

```solidity
mapping(bytes32 quoteAssetConfigId => QuoteAssetConfig) public quoteConfigs;
```

`quoteAssetConfigId` 必须非零且只能创建一次；未登记 mapping 的默认 `UNSET` 绝不能被当作 native Quote。Factory 只接受显式存在且 `status == ACTIVE` 的 config。

原生 Quote 固定表示为 `address(0)`、18 decimals，并沿用 Uniswap v4 native currency；不得使用可配置 sentinel。ERC-20 Quote 在批准前必须验证 canonical 地址、固定 decimals、无 rebasing、无 transfer fee、无 transfer callback 依赖，并通过实际到账与赎回测试。Symbol 和名称只用于展示。

Quote config 可以从 ACTIVE 变为 PAUSED/RETIRED 以阻止新市场；历史市场仍保存创建时快照，不能换币。资产安全事件是否暂停历史市场交易由 MarketController 的独立受限流程决定，不能借 Quote pause 没收已到账费用或阻止 claim。

TickerGarden 可以批准 Pons 现网尚未批准的 Quote，但该资产必须进入版本化差异清单，并独立取得 economics 向量与安全签字；`ApprovedQuoteRegistry` 不能把外部 Pons allowlist 当成会自动同步的依赖。Quote 是否与绑定 STOCK 相同不改变分配公式，也不要求建立 Quote→STOCK 购买路径。

V2 首发批准两个 content-addressed config，机器权威为 [`spec/v2_initial_quote_configs.json`](./spec/v2_initial_quote_configs.json)：native `address(0)`/18 decimals 使用 `phantom=1.68e18`、`threshold=4.2e18`、configId `0xb5a193a9938ac71aa0e78e36c38ea3ad011d894b671a25baaa5ef746f29f8472`；USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`/6 decimals 使用 `phantom=3236000000`、`threshold=8090000000`、configId `0xbbb477fcf5f27a5738e9995055eacd60c468990275919cc0c74c7b01d5f03a67`。两者均满足 `quoteAssetConfigId == economicsHash`。USDG 是可升级代理，部署 preflight 必须在同一 finalized block 重取 proxy/implementation codehash、implementation 地址、decimals 与 exact balance delta；任何漂移都拒绝新市场并触发重新审查。

### 4.4 地址不可变绑定

市场创建后不得修改：

- `marketId`；
- `Asset UID`；
- canonical Stock Token；
- Ticker Meme Token；
- Gauge 的市场归属；
- 该市场唯一的 canonical Quote Asset、`quoteAssetConfigId` 与 decimals；
- `ponsBaselineId` 与该市场的 `expectedEconomics`；
- `launchTemplateId` 与 `feePolicyId`；
- 曲线和毕业后官方交易场所之间的市场身份连续性。

费用源只能按冻结的 Pons `NotGraduated → Swept → PoolCreated / Rescued` 状态机变化，不能由管理员指定任意调用方。`NotGraduated` 最多一个 ACTIVE 曲线源，`Swept` 与 `Rescued` 为零个 ACTIVE 交易源，`PoolCreated` 最多一个 ACTIVE Hook 源；绝不允许同时存在两个 ACTIVE 源。系统保存单调递增的 `sourceVersion`；曲线费用使用 per-curve `sweepNonce`，毕业池费用使用 per-pool `feeNonce` 形成 domain-separated feeId。

## 5. 核心模块

| 模块 | 核心职责 | 明确禁止 |
|---|---|---|
| `OfficialStockRegistry` | 认证 Asset UID、canonical Stock Token、decimals、资产状态及逐Asset动态`minimumAllocation` | 托管用户本金、枚举 Meme、把最低仓位写入不可变market hash |
| `PonsBaselineRegistry` | 冻结参考 release、代码哈希、LaunchConfig 与差异版本 | 静默跟随外部 Pons 配置变化、修改已有 baseline |
| `LaunchTemplateRegistry` | 追加式冻结 Token/Curve/Gauge/Hook/Locker 实现、codehash、feePolicy 与 executionSpec | 修改历史 template、让 status 进入 economics hash、原地升级旧市场 |
| `ApprovedQuoteRegistry` | 版本化批准 native/ERC-20 Quote、逐资产 economics、decimals、状态和资产行为 | 修改历史 config、自动批准 Stock Token、把 native 与 WETH 混为同一资产 |
| `LaunchConfigResolver` | 对三个独立配置 Registry 提供无缓存的强类型聚合读取 | 写配置、缓存配置、成为新的发行权威或强制可用性依赖 |
| `TickerGardenFactoryV2` | 按 baseline 和极简模板创建 Ticker Meme、曲线、不可分配的 Gauge，支持受限原子 launch-and-buy，并登记 marketId | 限制一个 Asset UID 只能创建一个市场、提前开放未毕业 Gauge、接受未匹配 economics 或任意首买豁免地址 |
| `TickerMemeToken` | 固定供应与普通 ERC-20 行为 | 按质押或 LP 持续增发 |
| `PonsCompatibleCurve` | 精确复现 baseline 的 phantom reserve、报价、反狙击、部分成交、费用与 sweep | 自定义毕业金额、出售 `reservedTokens`、接收未获批 Quote 或把用户质押 STOCK 本金作为曲线资产 |
| `GraduationExecutor / Guard` | 按 baseline 校验 `readyToGraduate`、创建永久锁定的 Uniswap v4 池并支持 permissionless retry | 使用自定义 `LaunchAllocation`、修改 Gauge 或 Stock 绑定 |
| `LaunchLocker` | 每市场一个不可变实例，永久持有该毕业池仓位及其 LP fee 权益，并按冻结规则受限复投 | 共享多市场资金账本、提供管理员或创建者提款路径、把 locked LP fee 改分给其他受益人 |
| `ImmutableFeePolicy V2-EXEC-5` | 固定 `PoolKey.fee=0`、afterSwap unspecified 1%、donate LP20%、take non-LP80%；有 active stake 时 Staker 固定取得 non-LP50% | 动态费率、核心费叠加、既有市场原地改费率 |
| `TickerGardenMemeHook` | 以 Hook delta 收取总费，原子 donate LP 份额并把实际 non-LP Quote/Meme 手续费送入 FeeVault | 转换手续费资产、跨市场或跨资产净额结算、失败后改走另一收费路径 |
| `UserStockVault` | 每 schema 一个共享实例；按 Asset UID 隔离托管 canonical STOCK 本金及锁定总量 | 接受调用者指定 Token、参与 Meme 奖励、借贷、做市、任意转账 |
| `AllocationManager` | 校验目标市场和动态最低值，锁定/释放 Vault 额度、协调 Gauge 原子更新及用户级rageQuit | 持有 STOCK、提前开放未毕业市场、替用户逃生、无界遍历或改变市场状态 |
| `MemeStockGauge` | 固定 implementation 与每市场 immutable-args clone；单 Meme active 聚合仓位、最多一个 pending 增量、30秒激活、24小时锁定、Quote/Meme 双资产指数及弃权收益路由 | initializer、可升级实现、共享市场 storage、托管或转移 Stock Token 本金、接受第三种奖励资产 |
| `MarketFeeAccounting` | 作为 FeeVault 的内部库/固定模块，验证收费来源、按实际 feeAsset 计算分桶并更新对应指数 | 托管第二份资产、维护与 FeeVault 重复的负债账本 |
| `ProtocolFeeVault` | 唯一托管 non-LP 可分配 Quote/Meme 手续费；按实际资产原子验收，按 marketId/feeAsset/用途登记负债、弃权reserve并支付 | 托管 LP fee、先记负债后收款、通用提款、策略投资、转换资产或跨资产混用 Bucket |
| `MarketController` | 市场暂停、恢复、退休及协议级Emergency编排 | 改写用户余额、阻止历史领取/正常退出/用户级rageQuit，或把单个用户逃生升级成市场状态变更 |
| `Indexer / Backend` | 事件索引、搜索、排序、分页和聚合展示 | 成为余额、奖励或退出的权威来源 |

## 6. STOCK Vault 与分配会计

### 6.1 Vault 原始余额

`UserStockVault` 按 Asset UID 对各 canonical Stock Token 的原始最小单位独立记账，不使用美元价格作为质押权重，不在奖励热路径调用预言机。调用者只提供 `assetUid`；Token 地址必须由 OfficialStockRegistry 解析并确认仍绑定当前 Vault。

推荐状态：

```solidity
mapping(bytes32 assetUid => mapping(address user => uint256 amount)) deposited;
mapping(bytes32 assetUid => mapping(address user => uint256 amount)) allocated;
mapping(bytes32 assetUid => mapping(address user => mapping(bytes32 marketId => uint256 amount))) allocation;
mapping(bytes32 assetUid => mapping(bytes32 marketId => uint256 amount)) marketAllocated;
mapping(bytes32 assetUid => uint256 amount) totalDeposited;
mapping(bytes32 assetUid => uint256 amount) totalAllocated;
```

始终满足：

```text
allocated[assetUid][user] <= deposited[assetUid][user]
allocated[assetUid][user] = Σ allocation[assetUid][user][marketId]
marketAllocated[assetUid][marketId] = Σ allocation[assetUid][user][marketId]
totalAllocated[assetUid] = Σ allocated[assetUid][user]
totalAllocated[assetUid] <= totalDeposited[assetUid]
free[assetUid][user] = deposited[assetUid][user] - allocated[assetUid][user]
```

Vault 不发行可转让 ERC-20/4626 份额。用户权利由内部原始 STOCK 余额表示，避免份额转移绕过 Gauge 锁定。

### 6.2 实际到账校验

存入必须按实际余额差校验：

```text
balanceBefore = STOCK.balanceOf(vault)
safeTransferFrom(user, vault, requested)
received = balanceAfter - balanceBefore
require(received == requested)
```

Registry 未批准的 fee-on-transfer、rebasing 或异常 transfer 语义不得进入 Vault。

### 6.3 分配不变量

`AllocationManager` 是唯一可以让 Vault 的 `allocation[assetUid][user][marketId]` 增加或整仓清零并同步聚合值的模块。Manager 从 MarketRegistry 取得 canonical Asset UID 后显式传给 Vault，Vault 再复核 market 与 UID 匹配。所有 Gauge 只能由 Manager 更新 STOCK 份额，Gauge 自身不能从 Vault 转币。Vault 的资产/市场级 allocation 是本金占用的权威；不得试图从 Gauge 反推本金。

对用户的每次增加：

```text
require(market.launchPhase == PoolCreated)
require(market.status == ACTIVE)
require(asset.status == ACTIVE)
require(deposited[assetUid][user] - allocated[assetUid][user] >= amount)
allocated[assetUid][user] += amount
allocation[assetUid][user][marketId] += amount
marketAllocated[assetUid][marketId] += amount
totalAllocated[assetUid] += amount
Gauge.settleAndAddPending(user, amount, block.timestamp + 30 seconds)
```

对用户的每次整仓释放：

```text
amount = Gauge.settleAndRemoveFullPosition(user)
require(amount == allocation[assetUid][user][marketId])
allocated[assetUid][user] -= amount
delete allocation[assetUid][user][marketId]
marketAllocated[assetUid][marketId] -= amount
totalAllocated[assetUid] -= amount
```

两个方向必须在同一笔交易中原子完成。任何一步失败都整体回滚，不能出现 Vault 已锁定但 Gauge 未记账，或 Gauge 已清仓但 Vault 仍锁定的状态。退出入口不接受数量参数，从 Manager、Gauge 到 Vault 都只能读取并释放完整仓位。

Vault 的 `allocated[assetUid][user]` 同时覆盖 active 与 pending STOCK；30秒激活只改变 Gauge 内部有效权重，不移动 Token，也不再次修改 Vault。阶段门禁只限制增加方向：`allocate`、`increaseAllocation` 和 `depositAndAllocate` 都必须通过 `PoolCreated` 校验。普通整仓关闭必须满足 `now >= unlockAt`；市场后来 PAUSED/RETIRED 不能阻止到期结算和本金释放。单纯 `UserStockVault.depositStock(assetUid, amount)` 只形成该资产的通用空闲余额，不是市场质押，也不受某个 Meme 毕业状态影响。

## 7. 每 Meme Gauge

### 7.1 部署方式

每个 Meme 创建一个 EIP-1167 类最小代理或等价不可变轻量实例。Factory 可以使用 `CREATE2` 让 Gauge 地址由 `marketId` 确定。

Gauge 初始化后固定：

```text
marketId
assetUid
allocationManager
protocolFeeVault
quoteAssetConfigId
canonical quoteAsset
canonical tickerMemeToken
```

每个 Gauge 恰好支持两种不可变奖励资产：所属市场的 canonical Quote 与 Ticker Meme Token。两套状态固定且有界，不提供动态奖励 Token 列表，也不允许加入第三种资产。

Gauge 不应采用由市场创建者控制的可升级代理。新实现通过版本化 Factory 只服务新市场；旧市场迁移必须有专用流程，不能让管理员在无用户退出窗口的情况下替换逻辑。

Gauge 可以在市场创建时部署并固定地址，但在 `NotGraduated`、`Swept` 或 `Rescued` 状态必须保持不可分配且 `totalActiveStock == 0`。质押开放条件直接由不可逆发行状态机派生，不另设管理员可写的 `stakingEnabled` 开关：

```text
stakingOpen(marketId)
= market.launchPhase == PoolCreated
  && market.status == ACTIVE
  && asset.status == ACTIVE
```

其中 Asset/Market 暂停只影响新增和增加，不影响既有仓位领取、到期整仓关闭与本金退出。毕业交易完成后 `PoolCreated` 使门禁自然成立；`Swept` 尚未建池，不能提前开放，`Rescued` 也永不开放。

### 7.2 Gauge 状态

推荐状态：

```solidity
uint256 public totalActiveStock;
uint256 public totalPendingStock;

struct RewardState {
    uint256 accFeePerShare;
    uint256 indexRemainder;
}

struct UserReward {
    uint256 accumulatorPaid;
    uint256 pendingFee;
    uint256 userRemainder;
}

struct Position {
    uint256 activeAmount;
    uint256 pendingAmount;
    uint64 pendingGeneration; // absolute activationAt timestamp
    uint64 unlockAt;
    UserReward[2] rewards; // 0 = Quote, 1 = Ticker Meme Token
}

struct ActivationSlot {
    uint64 generation;
    uint256 amount;
    uint256 refs;
}

struct ActivationSnapshot {
    uint256 quoteAccumulator;
    uint256 memeAccumulator;
    uint256 refs;
    bool processed;
}

RewardState[2] public rewardStates;
mapping(address user => Position) public positions;
```

每个用户、每个 Gauge 只保存一个 active 聚合仓位和最多一个 pending 增量。再次增仓合并并重置 pending，不创建 tranche 数组。`totalActiveStock` 只包含已经到达激活边界并由到期处理确认的有效份额；未处理的 `pendingAmount` 只计入 `totalPendingStock` 和 Vault allocation。任何会使用权重的操作都必须先处理到期 bucket，因此延迟写入不会改变经济归属。

### 7.3 激活调度

固定参数：

```text
ACTIVATION_DELAY = 30 seconds
ACTIVATION_QUANTUM = 1 second
ACTIVATION_WHEEL_SIZE = 32
MIN_LOCK = 24 hours
```

每个 pending 记录 `activationAt = allocationTimestamp + 30 seconds`，并令绝对 `generation = activationAt`。Gauge 使用32槽按秒聚合的环形 time wheel；`slotIndex = generation % 32`，但 slot 内必须同时保存完整绝对 generation。同一秒到期的 pending 只增加一个 bucket 总量和用户仓位引用数，不保存用户数组。

任何手续费 credit、分配、领取、整仓退出或 permissionless checkpoint 都先扫描恰好32槽，处理 `generation <= block.timestamp` 的 bucket，再进行后续会计：

```text
for slotIndex = 0 .. 31:
    skip empty or future generation
    record Quote/Meme activation accumulator snapshots
    totalPendingStock -= bucket.amount
    totalActiveStock += bucket.amount
    save snapshot by absolute generation with refs
    clear the reusable ring slot
```

用户仓位在下一次本人操作时懒合并：若其 snapshot 已处理，则分别用该 generation 记录的 Quote/Meme 指数结算激活后的收益，再把 `pendingAmount` 合并进 `activeAmount`。snapshot 按引用计数保留，直到所有引用该 generation 的仓位完成懒合并后删除；不得存在环形 slot 内，也不得被 slot 复用覆盖。

新调度前所有成熟 slot 已清除，所以旧未来 generation 只位于 `(now, now + 29]`，新 generation 是 `now + 30`。同时存活的不同 generation 跨度小于32秒，因此不可能具有相同 `% 32`；实现仍必须在目标 slot 非空且 generation 不同时时 `ActivationSlotCollision` 回滚，绝不能覆盖。禁止从 `lastProcessedTimestamp` 逐秒扫描到现在；长期空闲后的第一笔操作仍只扫描32槽。

到期判断使用 `block.timestamp >= activationAt`。在恰好到期的手续费交易中，必须先处理激活再按新的 `totalActiveStock` 分配该笔手续费；到期前的任何手续费都不能归属于 pending。

`totalActiveStock` 包含已处理但用户尚未懒物化的 pending；用户 view 必须区分 stored active 与 effective active。遗弃仓位可能让其绝对 generation snapshot 长期保留，但历史 snapshot 不被扫描，单笔 Gas 不随历史增长。完整数据结构、引用清理和形式化证明见 [V2_EXECUTION_SPEC.md](./V2_EXECUTION_SPEC.md) 第8节。

### 7.4 动态 `minimumAllocation` 校验

Gauge 只读取 Registry 在资产注册时快照并冻结的 `tokenDecimals`，要求 `6 <= tokenDecimals <= 18`：

```text
minimumAllocation = OfficialStockRegistry.minimumAllocation(assetUid)
```

对操作后的目标仓位执行：

```text
targetPosition = activeAmount + pendingAmountAfterOperation
targetPosition == 0 || targetPosition >= minimumAllocation
```

不执行倍数、模运算或产品层取整。所有计算使用 ERC-20 原始整数。已有 `0.6 STOCK` active 时可以新增 `0.1 STOCK` pending；active 与 pending 均为零时不能提交 `0.4 STOCK`，再依靠后续小额追加绕过最低仓位。

### 7.5 `PoolCreated` 后30秒延迟激活

新增仓位或增仓前必须由 `AllocationManager` 验证 `stakingOpen(marketId) == true`；验证通过后：

1. 处理成熟 activation bucket，checkpoint Quote/Meme 两套指数，并按旧 `activeAmount` 结算用户现有权益；
2. Vault 锁定新增 STOCK；
3. 新增数量创建或合并进唯一 `pendingAmount`，尚不进入 `totalActiveStock`；
4. 若原 pending 尚未成熟，先从旧 activation bucket 扣除，再把合并数量登记到新的 `activationAt = now + 30 seconds`；
5. 旧 `activeAmount` 保持不变并继续计奖；
6. `unlockAt = now + 24 hours`，增仓重置整个合并仓位的退出时间。

上述步骤与 Vault `allocated` 更新必须在同一交易原子完成。若旧 pending 已成熟，必须先懒合并为 active，再为新增 delta 创建新的 pending。`depositAndAllocate` 先验证目标为 `PoolCreated` 并验证实际到账，再执行同一流程；任一条件失败则存入和分配整体回滚。单纯 `deposit` 只增加空闲余额，不自动选择 Meme，也不产生收益。

分配与手续费 credit 按链上交易顺序生效，但新增份额必须同时满足30秒边界：到期前即使同一区块存在后续 credit，也仍不计入；到期后的第一笔 credit 先处理激活并使用新的 `totalActiveStock`。

Asset 或 Market 为 PAUSED 时禁止新分配和增仓，但不能据此阻止既有仓位结算、到期整仓关闭或本金退出。

### 7.6 整仓关闭与紧急退出

只有 `now >= unlockAt` 才允许普通关闭。`closeAllocation(marketId)` 不接受数量参数，只能清零该市场完整仓位，顺序固定为：

```text
process matured activation buckets
→ lazily merge user's matured pending
→ checkpoint both reward assets
→ settle user with old effective activeAmount
→ clear the full activeAmount/pendingAmount and reduce Gauge totals
→ require Gauge removed amount == Vault market allocation
→ AllocationManager releases the full STOCK allocation into Vault free balance
```

V2-EXEC-5 不提供部分减仓或跨 Meme 原子迁移。用户若要更换市场，必须先完整关闭 A；本金回到 Vault free balance 后，再单独调用 B 的 allocation 入口。B 重新执行 `stakingOpen`、当前 `minimumAllocation`、30秒激活与24小时锁定校验，A 与 B 不会在同一调用中共享或搬移仓位状态。

`minimumAllocation` 由 OfficialStockRegistry 按 Asset UID 保存，并通过延迟治理权限更新。提高该值不会强退既有仓位；既有低于新值的仓位只能补足、正常全额退出或使用 `rageQuit`。新仓位和增仓后的总仓位按调用时最低值校验，完全退出始终允许。

用户级 `rageQuit` 不改变市场状态：Gauge 原子结算并清除调用者的全部 active/pending 权重，放弃全部未领取 Quote/Meme 收益，并由 Vault 立即返还本金。若退出后仍有其他 Active staker，放弃额按剩余 active stake 重分配；否则按 `marketId + feeAsset` 进入 forfeiture reserve，后续平台 claim 时转为平台收入。协议级 `EMERGENCY_EXIT`/`forceReleaseAllocation` 仍是独立的终止恢复路径。

## 8. 多 Quote 与双奖励资产手续费会计

### 8.1 两阶段费用域

曲线阶段尚无 Uniswap LP，实际收到的 Market Quote 手续费全部记为 `D_curve`。毕业后每笔 Swap 在其实际收费资产中定义：

```text
T_asset = 该笔 Swap 的总手续费
L_asset = 通过 PoolManager.donate 归入同池 in-range feeGrowth 的 LP 手续费
D_asset = PoolCreated 后由创建者、STOCK 质押者与平台分配的非 LP 手续费

base = abs(coreSwapUnspecifiedDelta)
T_asset = floor(base × 10,000 / 1,000,000)
L_asset = floor(T_asset × 2,000 / 10,000)
D_asset = T_asset - L_asset
```

毕业池 `PoolKey.fee = 0` 且 Hook 每笔验证 slot0 `lpFee == protocolFee == 0`。`L_asset` 由 Hook 在 afterSwap 内调用 `PoolManager.donate`，不进入 `ProtocolFeeVault`；`D_asset` 由同一 Hook 调用 `PoolManager.take` 实际转入 FeeVault。exact-input 的 unspecified/收费资产为 output，exact-output 为 input。

毕业池使用两阶段到账证明：

```text
FeeVault.beginV4Credit(marketId, feeAsset, D, sourceVersion, feeId)
→ records exact balanceBefore
Hook calls PoolManager.donate(... L ...) and PoolManager.take(feeAsset, FeeVault, D)
FeeVault.finalizeV4Credit(... base, T, L, D, feeNonce, feeId)
→ requires balanceAfter - balanceBefore == D
→ then and only then credits liabilities and consumes feeId
```

曲线来源通常以 Market Quote 结算。毕业池只允许两种 `feeAsset`：该市场不可变的 canonical Quote Asset 与 Ticker Meme Token。Quote 侧收到什么 Quote 就分什么 Quote，Token 侧收到什么 Meme Token 就分什么 Meme Token；协议不调用 Router、不执行兑换，也不按价格估值替代实际到账。创建者、质押者和平台的该笔负债必须与 `feeAsset` 相同。

`ProtocolFeeVault` 是所有 non-LP Quote/Meme 费用的唯一实际持有人和 Bucket 债务登记人。`MarketFeeAccounting` 只作为其内部库或固定协作模块计算分配，不能再托管一份资金或维护第二套可支付余额。Staker/Platform Bucket 键至少包含 `marketId + feeAsset + bucketType`；Creator Bucket 额外包含不可变归属的 `creatorEpoch`。`feeAsset` 必须严格等于 `MarketConfig.quoteAsset` 或该市场 `memeToken`，不得登记第三种奖励资产。

V4 finalize 必须在同一笔交易中依次完成：

```text
verify msg.sender == activeFeeSource(marketId)
verify sourceVersion == currentSourceVersion(marketId)
verify poolId -> marketId and canonical PoolKey binding
verify feeId built from chainId, PoolManager, poolId, sourceVersion, per-pool feeNonce,
       feeAsset, base, T and feePolicyHash has not been consumed
verify feeAsset == market.quoteAsset || feeAsset == market.memeToken
verify prepared credit and exact actual balance increase D

process all 32 activation slots before current fee
read resulting totalActiveStock
load current active stake and apply fixed non-LP 50% staker attribution
credit exact market-and-feeAsset-scoped liabilities
update only Gauge.rewardState[feeAsset] when applicable
mark feeId consumed
emit FeeDepositedAndCredited(...)
```

原生资产直接保留为 Uniswap v4 native currency，不先包装成 WETH；FeeVault 以原生余额差验证。ERC-20 以 `balanceOf` 差验证。任一步失败时 Hook return delta、donate、take、Bucket 负债、Gauge 指数、feeNonce 和 feeId 一起回滚。V2 不切换为 ERC-6909 claim 或未来补款。

曲线 fee 使用独立 `sweepNonce` 和曲线实际转入 Quote 的原子入口，固定 Creator/Platform 50/50。最终曲线交易必须在提交 `Swept` 前完成最后一次 sweep；曲线 feeId 与 v4 feeId 使用不同 domain，不能复用外部 `tradeId`。

Creator beneficiary 变更前必须在旧 epoch 下原子 sweep Curve 全部累计费用并确认 accrued 为0，之后才推进 epoch；毕业池费用逐笔绑定 credit 当时的 epoch。Creator 历史负债键为 `marketId + creatorEpoch + feeAsset`，详细模型见 [V2_CREATOR_REVENUE_EPOCH.md](./V2_CREATOR_REVENUE_EPOCH.md)。

FeeVault 对每一种实际资产分别维护 `totalLiability[feeAsset]`，并持续满足：

```text
assetBalance(FeeVault, feeAsset)
>= totalLiability[feeAsset]

totalLiability[feeAsset]
= Σ CREATOR_REVENUE liabilities in feeAsset
 + Σ STAKER_REWARD liabilities in feeAsset
 + Σ PLATFORM_REVENUE liabilities in feeAsset
```

`assetBalance` 对 `address(0)` 读取原生余额，对 ERC-20 读取 `balanceOf`。每次 creator/staker/platform 领取时，同额减少对应资产负债。LP fee 从未进入该等式；高精度 Gauge remainder 不是一笔额外资产负债。每个市场两种奖励资产分别守恒，不能用 Quote 余额填补 Meme Token 负债，反之亦然。

### 8.2 热路径限制

用户交易内只允许：

- 验证 marketId、当前阶段允许的至多一个 ACTIVE 收费源、sourceVersion、feeId 与实际 `feeAsset`；
- 读取固定 V2-EXEC-5 fee policy；毕业后精确拆出 `T_asset`、`L_asset` 和 `D_asset`；
- 曲线期直接执行固定 `50/50` 非 LP 分配；`PoolCreated` 后先处理成熟 activation bucket，再读取该 Gauge 的 `totalActiveStock`：为零时 Staker 为0，非零时 Staker 固定取得 non-LP 的50%；
- 给 `marketId + feeAsset` scoped Bucket 记账；
- 当本次 `stakerAmount > 0` 时，只更新该 `feeAsset` 的一次 accumulator；
- 发出事件。

交易热路径不得：

- 购买 Stock Token；
- 转给每个质押者；
- 遍历用户或 Meme；
- 调用任意 Router；
- 读取 Stock USD 预言机；
- 转换 Quote 或 Meme Token 手续费；
- 执行平台币回购；
- 依赖 Worker、Indexer 或 Backend 在线。

### 8.3 `PoolCreated` 后的固定质押者 Bucket

只有 `PoolCreated` 后才可能产生质押者份额。先处理全部成熟 activation bucket，再读取本市场 `totalActiveStock`。定义：

```text
S = totalActiveStock
stakerAmount = 0 if S == 0, otherwise floor(D × 50% )
nonStakerAmount = D - stakerAmount
creatorAmount = floor(nonStakerAmount / 2)
platformAmount = nonStakerAmount - creatorAmount
```

Bucket：

```text
CREATOR_REVENUE += creatorAmount
STAKER_REWARD += stakerAmount
PLATFORM_REVENUE += platformAmount
```

`PoolCreated` 后，LP 始终取得总手续费约`20%`，`D` 是实际进入 FeeVault 的其余 non-LP 数额。`S == 0` 时质押者为零，创建者与平台平分 `D`；`S > 0` 时质押者取得 `floor(D/2)`，余下由创建者与平台平分。若余量为奇数，最后一个最小单位确定性归平台。用户 `i` 在 Staker Bucket 内按 `userActiveStock[i] / S` 分配；到期份额参与边界当笔手续费，未到期份额不进入 `S`，后续进入者不能取得历史手续费。不存在10 STOCK saturation或linear release。

### 8.4 零质押边界

若手续费产生时 `totalActiveStock == 0`，上述统一公式退化为：

```text
creatorAmount = floor(D × 50 / 100)
platformAmount = D - creatorAmount
```

Bucket：

```text
CREATOR_REVENUE += creatorAmount
PLATFORM_REVENUE += platformAmount
```

曲线期由于质押门禁必然是零质押，固定执行 `50% 创建者 / 50% 平台`；毕业后零质押对应总手续费比例约为 `40% 创建者 / 0% 质押者 / 40% 平台 / 20% LP`。两者都不更新任一奖励资产 accumulator，不创建未来质押者可领取的 `unallocatedReward`，也不购买 STOCK。只有 pending、没有 active 时 `S` 仍为零；pending 不提前取得任何质押者份额。`S > 0` 时 Staker 固定取得 non-LP 的50%，再按实际 active STOCK 比例分配；不存在 saturation 或线性 release。

### 8.5 累加器

指数精度固定为 `P = 1e27`。Quote 与 Meme Token 各自维护独立的 `RewardState`。仅当 `S > 0 && stakerAmount > 0` 时，对本次 `feeAsset` 执行池级更新：

```text
S = totalActiveStock

carry = floor(indexRemainder / S)
normalizedRemainder = indexRemainder % S

whole = mulDiv(stakerAmount, P, S)
fraction = mulmod(stakerAmount, P, S)

merged = normalizedRemainder + fraction
rewardState[feeAsset].accPerShare += carry + whole + floor(merged / S)
rewardState[feeAsset].indexRemainder = merged % S
```

`indexRemainder` 是尚未形成一个 accumulator 最小单位的池级 scaled numerator。有效份额改变后，旧 remainder 先以新的 `S` 执行 `div/mod` 归一化，再与本次 `mulmod` 合并。实现不得直接计算可能溢出的 `stakerAmount × P`。

该 remainder 是绝对 scaled reward，不是依赖旧 `S` 的比例。资金守恒恒等式为：

```text
stakerAmount × P + previousIndexRemainder
= accumulatorDelta × S + newIndexRemainder

undistributed reward in feeAsset raw units
= newIndexRemainder / P
```

例如旧 `S = 10` 产生 remainder `9`，新 `S = 1` 时 `carry = 9`，新增的 `9` 个 accumulator 最小单位对一个 share 只代表 `9/P` feeAsset raw unit，恰好等于原池级 Dust，不会放大为 `9` 个资产最小单位。尚未归属用户的池级 Dust 归该 Meme 池所有，并在下一次收到同一种资产的质押者手续费时按当时有效份额继续分配。

用户对每一种固定奖励资产分别结算：

```text
delta = rewardState[feeAsset].accPerShare - user.accumulatorPaid[feeAsset]
whole = mulDiv(activeAmount, delta, P)
fraction = mulmod(activeAmount, delta, P)
merged = user.remainder[feeAsset] + fraction

user.pendingReward[feeAsset] += whole + floor(merged / P)
user.remainder[feeAsset] = merged % P
user.accumulatorPaid[feeAsset] = rewardState[feeAsset].accPerShare
```

`user.remainder[feeAsset]` 表示用户不足一个该奖励资产最小单位的 scaled 权益，始终位于 `[0, P)`。它在 claim 和普通整仓关闭后仍归属于同一用户与同一 marketId；不能转给平台或其他质押者。所有数学使用各资产原始整数，与 decimals 无关；decimals 只用于展示和创建时验证。

市场永久退休后，无法形成一个资产最小单位的用户 remainder 和池级 Dust 永久留在该 `marketId + feeAsset` 的 `STAKER_REWARD` Bucket，不得由管理员 sweep 或重分配。用户已经形成的整数 `pendingReward[feeAsset]` 仍永久可领取。

每个 activation bucket 在成熟时同时记录 Quote 与 Meme 两套 `accPerShare` 快照；用户懒激活时以对应快照作为新增 active 份额的起始 paid index，从而保证等待期内两种资产的历史手续费都不能倒灌。V1 已有相同类型的 accumulator 经验，但 V2 奖励来自实际到账的两种固定资产，不再调用 mint。V2 数学参考实现必须对不同 decimals、原生/ERC-20、池级和用户级 remainder 做差分与资金守恒测试，不能只复制表面公式。

### 8.6 领取

用户直接调用 `ProtocolFeeVault.claimStaker(marketId, feeAsset)` 领取一种固定奖励资产。前端可以为 Quote 与 Meme 连续构造两笔调用，但 `V2-EXEC-5` 不声明额外的 `claimFees` / `claimFeeAsset` 便捷 ABI：

1. 校验 `feeAsset` 只能是该市场固定的 Quote 或 Meme，处理成熟 activation bucket，并懒合并该用户已成熟 pending；
2. Gauge 按 Quote 与 Meme 两套指数结算该用户 active 份额，但本次只消费指定 `feeAsset` 的整数 claimable；
3. 只清零该 `marketId + user + feeAsset` 的整数待领值，另一套资产的待领值不变；
4. 从该 `marketId + feeAsset` 的 `STAKER_REWARD` Bucket 向 `msg.sender` 支付，零余额直接返回；
5. 两种资产的小数 remainder 分别保留供后续累计；
6. 使用 nonReentrant，并对本次资产先改状态后转账。

`claim` 不接收任意 recipient。允许任何人帮助触发的版本也只能支付固定 beneficiary。Quote 或 Meme Token 只要是 ERC-20 就使用 `safeTransfer`；原生 Quote 使用先减负债、后低级 `call` 的 nonReentrant 路径。聚合领取之外必须保留按固定 `feeAsset` 单独领取的兜底，避免一种资产支付失败阻塞同一用户的另一种资产。单个收款地址拒收原生资产只能使它自己的对应 claim 回滚，不能阻塞其他市场分桶或其他用户领取。

## 9. 毕业后 LP fee 与同资产 non-LP 费用

### 9.1 LP fee 会计

`PoolCreated` 后，实际 LP 收益由 Hook 对每笔总手续费切出的 `L_asset` 经 `PoolManager.donate` 增加到 Uniswap v4 fee growth：

- `T_asset = floor(abs(unspecifiedDelta) × 1%)`，`L_asset = floor(T_asset × 20%)`；核心 Pool lpFee 与 packed protocolFee 必须为零；
- LP fee 保持在该 Swap 的实际收费资产中，不进入 FeeVault，不进入 STOCK Gauge，也不参与零质押重分配；
- 外部 LP 按标准流动性份额取得 fee growth，不要求质押 LP NFT，不获得任何代币排放；
- canonical 全范围毕业仓位永久锁定，也按份额取得 fee growth；归属该仓位的费用只能 permissionless compound 回同一 full-range position，单边余额继续按市场锁定。

Hook 的瞬时账满足 `+T return delta - L donate - D take = 0`。测试必须覆盖两个方向、exact-input/exact-output、部分成交、native/ERC-20 和整数边界，并证明 Router 在 unlock 结束时所有 currency delta 为零。

`compoundLockedFees(marketId)` 任何人可调用，但 recipient、PoolKey 和 full-range position 固定；失败只回滚本次 compound，未配对余额留在 Locker。不得出现管理员通用提款或把 locked LP fee 改分给其他 Bucket 的路径。

### 9.2 Token 侧 non-LP 费用

当毕业池在 Ticker Meme Token 一侧产生 `D_asset` 时，在同一收费交易中完成：

1. 依据同资产的 `T_asset` 计算 `L/Creator/Staker/Platform` 原始整数与确定性余数；
2. 先处理所有成熟 activation bucket，再读取 `totalActiveStock`；`S=0` 时 Staker Bucket 为零，`S>0` 时固定取得 non-LP 的50%；
3. 把 non-LP Meme Token 实际转入 FeeVault，并按 `marketId + memeToken + bucketType` 登记负债；
4. 若为 active 池，只更新 Meme Token 对应的 accumulator；Quote accumulator 不变；
5. `feeId` 消费、资产到账、Bucket credit 与 Gauge 更新原子成功或原子回滚。

Token 侧费用不兑换成 Quote、USDC 或其他资产，不需要价格预言机、滑点参数、异步 Worker、历史 entitlement 或转换重试队列。用户领取时直接得到 Ticker Meme Token；这可能带来卖压，但属于已明确的产品经济选择，而不是会计层代为改变结算资产的理由。

## 10. 完整工作流

### 10.1 创建市场

```text
Creator selects ACTIVE Asset UID and ACTIVE quoteAssetConfigId
→ Factory validates canonical STOCK, approved native/ERC-20 Quote and ponsBaselineId
→ loads the simple default launch template, immutable LaunchConfig, FeePolicy and selected Quote economics
→ freezes the selected ACTIVE official Asset UID and canonical STOCK identity into MarketConfig
→ verifies caller-supplied expectedEconomics hash
→ creates full fixed-supply TickerMemeToken directly to PonsCompatibleCurve
→ creates a deterministic 301-byte MemeStockGauge immutable-args clone in allocation-disabled, empty state
→ registers marketId → assetUid/modules
→ registers pre-graduation fee source
→ emits MarketCreated
```

Factory 不检查 `assetUid` 是否已经存在其他市场；只检查本次 Meme Token、marketId 和 Gauge 未重复登记。此时 Gauge 地址虽已固定，但 `NotGraduated` 状态下不得接受任何 STOCK 分配。普通创建界面不允许创建者任意填写曲线参数，也不增加保证金、STOCK 创建资格或地址级限速。

创建费对当前 Factory 和 execution spec 永久冻结为参考 Pons 活跃部署的 `0.0005` 原生资产，普通创建要求精确 `msg.value == launchFee`；没有 setter 或调价事件，改费必须新 Factory/Router/LaunchTemplate 和新 `executionSpecId`。Factory 同时提供 `predictMarketAddresses(creator, params)`，按 [V2_TYPED_IDENTIFIERS.md](./V2_TYPED_IDENTIFIERS.md) 的 TickerGarden CREATE2 domain 在交易前唯一得到 Curve、Token、Gauge 和 per-market LaunchLocker；前三者在创建时部署，Locker 由 GraduationExecutor 在毕业时部署，地址已有代码或实际地址不一致时整笔回滚。

`expectedEconomics`、`marketId`、fee IDs、Emergency/Recovery hash 的 domain、版本和字段顺序，以及 `canonicalPoolKey/canonicalPoolId` 发现接口统一见 [V2_TYPED_IDENTIFIERS.md](./V2_TYPED_IDENTIFIERS.md) 与 `spec/v2_hash_schemas.json`。Router、Indexer 和前端不得自行拼接安全关键 PoolKey。

### 10.2 存入与毕业后配置

```text
User approves canonical STOCK once
→ UserStockVault.depositStock(assetUid, amount)
→ AllocationManager.allocate(marketId, amount)
→ resolves market.assetUid and passes it to the canonical Vault
→ Vault verifies market.assetUid and Registry token/Vault binding
→ verifies market.launchPhase == PoolCreated
→ verifies Market and Asset permit new allocation
→ verifies new position == 0 or >= current Registry minimumAllocation (minimum 414 raw units)
→ locks Vault balance
→ processes matured activation buckets and settles the old active position in both reward assets
→ adds the new amount to the user's only pending increment
→ if an immature pending increment already exists, merges it and resets activationAt
→ activationAt = now + 30 seconds
→ unlockAt = now + 24 hours for the entire combined position
→ pending is locked in Vault but does not increase totalActiveStock or earn fees yet
```

可以提供 `depositAndAllocate` Router，但 Router 不能持有跨交易余额，也不能绕过 `PoolCreated` 门禁或 Vault 实际到账校验。未毕业目标会使组合调用整笔回滚；用户若只想提前准备本金，应单独调用 `deposit`，其空闲余额不计为任何 Meme 的质押。

组合调用的身份传递固定采用模块专用入口：AllocationManager 只可为本次外部 `msg.sender` 调用 Vault `depositStockFor`；LaunchAndBuyRouter 只可把本次外部 `msg.sender` 作为 creator 调用 Factory `createMarketFor`。详细顺序与不变量见 [V2_COMPOSED_CALL_IDENTITY.md](./V2_COMPOSED_CALL_IDENTITY.md)。禁止 `tx.origin` 和公众任意指定 user/creator。

### 10.3 到期激活

```text
block.timestamp >= activationAt
→ any fee credit, claim, allocation change or permissionless checkpoint processes the bucket first
→ snapshots both Quote/Meme accumulators at the activation boundary
→ moves the bucket total from totalPendingStock to totalActiveStock
→ the user's next action lazily merges matured pendingAmount into activeAmount using those snapshots
```

到期不需要后台定时任务，也不需要逐用户遍历；链上状态在下一笔触发交易中结算，但经济生效点仍是 `activationAt`。恰好在边界发生的手续费必须先处理激活，因此由新份额参与；边界前的手续费全部排除 pending。用户在 pending 阶段再次增仓时，旧 pending 与新增数量合并并从新交易重新等待30秒；若旧 pending 已成熟，则先激活旧 pending，再为新增 delta 建立新的 pending。

### 10.4 原子 launch-and-buy

```text
Creator calls launchAndBuy with the selected template and first-buy input
→ Factory creates and registers the market
→ first buy executes against the newly created curve in the same transaction
→ no third-party transaction can be inserted between creation and first buy
→ unused Quote follows the same partial-fill/refund rules
```

只允许真实 creator/beneficiary 与首买 recipient 获得一次性、可公开识别的反狙击例外；创建者不能提交任意团队多钱包豁免名单。非豁免 recipient 的活跃 runtime raw 输出按 elapsed `0/1/2/≥3s` 精确固定为 `9900/618/19/0 bps`；TickerGarden base fee100、creator tax0、minimum net100 的 effective 表为 `9800/618/19/0 bps`。Pons 文档5秒、固定源码默认15秒和 runtime 3秒不一致，因此合约只能查这张整数表，不实现猜测的连续衰减公式。首买不设置人为的毕业门槛百分比上限，实际成交由曲线 `sellableTokens`、partial fill、退款和 `minTokensOut` 限制。native Quote 要求 `msg.value == launchFee + firstBuyAmount`；ERC-20 Quote 只附 `launchFee` 并授权 Router 拉取首买资产。固定区块与交易证据见 [`spec/v2_pons_runtime_evidence.json`](./spec/v2_pons_runtime_evidence.json)。

### 10.5 交易收费

```text
User trades Ticker Meme
→ Pons-compatible curve applies the frozen curve fee and anti-snipe timing
   OR graduated Hook applies fixed V2-EXEC-5 afterSwap fee

curve phase:
    LP = 0
    STOCK staking is closed and totalActiveStock must equal 0
    Creator 50% / Platform 50% of D_curve

PoolCreated phase:
    process all matured activation buckets
    base = abs(core Swap unspecified currency delta)
    total fee T = floor(base × 1%)
    LP L = floor(T × 20%) via PoolManager.donate
    non-LP D = T - L via PoolManager.take to FeeVault
    S = totalActiveStock after processing matured activation buckets
    Staker = 0 if S == 0, otherwise floor(D × 50%)
    Creator = floor((D - Staker) / 2)
    Platform = D - Staker - Creator
    at S=0:  Creator / Staker / Platform / LP ≈ 40 / 0 / 40 / 20
    at S>0:  Creator / Staker / Platform / LP ≈ 20 / 40 / 20 / 20

→ PoolCreated path only: donate credits current in-range LP feeGrowth
→ FeeVault credits the actual non-LP Quote or Meme Token without conversion
→ if stakerAmount > 0, update only the matching fee-asset accumulator
```

### 10.6 领取

```text
User selects one marketId and one of its two fixed reward assets
→ that Gauge/asset settles independently
→ ProtocolFeeVault pays each beneficiary's Quote and/or Meme Token balances in their original assets
```

### 10.7 整仓关闭与提取本金

```text
now >= unlockAt
→ process matured activation and settle both Gauge rewards
→ close the full Gauge position
→ release the equal full Vault allocation into free balance
→ user withdraws free STOCK from UserStockVault
```

用户可以只领取手续费收益而不关闭仓位，也可以整仓关闭后晚些时候再从 Vault 提取本金。24小时从本次 allocate/increase 交易时间开始计算，不从30秒激活时间开始；增仓只能由仓位所有者发起，并重置整个合并仓位的 `unlockAt`。V2-EXEC-5 不提供部分减仓或跨市场批量领取；不同 marketId 与 feeAsset 分别调用，绝不跨资产净额结算。

### 10.8 更换 Meme 市场

```text
transaction 1: require now >= A.unlockAt
→ process activation, settle both assets and fully close A
→ release A principal into Vault free balance

transaction 2: require B.launchPhase == PoolCreated and B accepts new allocation
→ allocate an independently selected free-balance amount to B
→ B pending receives no historical rewards
→ B.activationAt = now + 30 seconds
→ B.unlockAt = now + 24 hours
```

协议不提供 `migrateAllocation` 或 Vault 账本搬移入口。用户可以在 A 完整关闭后自行选择是否及何时将 free balance 存入 B；两笔操作各自原子，且同一份 STOCK 不会在 A、B 重叠计奖。

### 10.9 毕业

```text
sellableTokens == 0 and readyToGraduate() == true
→ curve settles the final partial-fill/refund and final curve fee exactly once
→ curve sweeps all remaining fee balance with a monotonic sweepNonce
→ curve hands real Market Quote reserve and formula-derived sweptTokens to graduation escrow
→ launchPhase becomes Swept; curve trading and curve fee source close permanently
→ Curve emits LaunchSwept
→ Curve try/catches GraduationExecutor.graduateFromCurve(marketId)

graduation subcall:
    verify caller is the exact registered Curve and market is Swept + ACTIVE
    GraduationGuard validates that baseline pool can be seeded
    poolMemeAmount = floor(sweptTokens * sweptQuote / (sweptQuote + phantomQuote))
    CREATE2 deploy and one-time initialize the predicted per-market LaunchLocker
    permanently lock sweptTokens - poolMemeAmount as excess Meme supply in that Locker
    Hook registers EXPECTED canonical PoolKey with fee=0 and mask=0x2044
    PoolManager.initialize triggers Hook.beforeInitialize validation
    GraduationExecutor creates full-range Uniswap v4 position in LaunchLocker
    verify locked position, reserves and canonical poolId
    Hook becomes ACTIVE fee source and sourceVersion increments
    launchPhase becomes PoolCreated
    STOCK allocation gate becomes open and emits StockStakingOpened
```

`reservedTokens` 是曲线不再出售的下限，正常 `sweptTokens` 等于该值；`poolMemeAmount` 才是真正与全部 `sweptQuote` 注入 V4 的 Meme 数量。三者必须在存储、事件和测试中分开。当前 Pons `phantom/threshold=2/5` 的例子中，它们分别对应总供应的 `2/7`、`2/7` 和 `10/49`，另有 `4/49` 永久锁定。

Gauge 不迁移、不重置；由于毕业前禁止分配，此刻必须仍为零仓位、零质押者奖励状态。用户可在 `PoolCreated` 交易完成后自行首次分配 STOCK，协议不得替用户自动质押。

若 Quote 为原生资产，Uniswap v4 PoolKey 使用 native currency `address(0)`，储备在毕业交易中以原生资产直接移交；若 Quote 为 ERC-20，则使用冻结的 canonical token 地址和实际余额差。毕业执行器不得自行 wrap/unwrap 或改成另一 Quote。

正常情况下，上述步骤由完成曲线的买入在同一交易中自动执行。若自动建池子调用失败，外层最终买入、最后 fee sweep、资产托管和 `Swept` 仍然提交，由 Curve 发出 `AutoGraduationFailed`；子调用内的 Locker、EXPECTED pool、initialize、加池、Hook 与 `PoolCreated` 全部回滚。任何人都可在 `Swept + ACTIVE + 未 Rescued` 时 permissionlessly 调用 `retryGraduation` 执行同一个内部算法。只有 Curve 发出 `LaunchSwept/AutoGraduationFailed`，只有 GraduationExecutor 发出 `PoolGraduated/LaunchRescued`，LaunchAndBuyRouter 不发重复摘要事件。成功时，池注册、Hook 启用、`sourceVersion` 增加、`PoolCreated` 状态和质押门禁开放原子完成。若按 baseline 进入七日救援并成为 `Rescued`，不得再启用交易源或 STOCK 质押。

旧 source 在关闭后永久拒绝记账，新 source 在 `PoolCreated` 前不能记账。曲线以 `curve + sourceVersion + sweepNonce` 形成 `curveFeeId`；毕业池以 `poolId + sourceVersion + feeNonce + feeAsset + base + T` 形成 `feeId`。两者均由 FeeVault 防重复消费，不使用外部 `tradeId`。

## 11. 暂停、退休与紧急退出

### 11.1 资产级暂停

当 Registry 将 `Asset UID` 标记为 PAUSED：

- 禁止新市场创建；
- 禁止新 STOCK 存入；
- 禁止新分配和增仓；
- 已经登记的 pending 不取消也不冻结30秒计时，到期后仍可由安全 checkpoint 激活；
- 允许 claim、满足24小时锁定后的整仓关闭和提取用户本金。

不同 Asset UID 的 Vault 与 Gauge 不受影响。

### 11.2 Quote 资产级暂停

当 `ApprovedQuoteRegistry` 将某个 Quote config 标记为 PAUSED/RETIRED：

- 禁止用该 config 创建新市场；
- 不改变历史市场的 quoteAsset、毕业 threshold 或任何已到账负债；
- 不阻止 creator/staker/platform claim 已到账的 Quote 或该市场 Meme Token，也不改变已产生的 LP fee growth；
- 是否暂停历史曲线/池交易必须由受限 MarketController 根据具体安全事件决定，不能由 Registry 状态隐式改写市场状态。

USDC、其他 ERC-20 Quote 和原生 Quote 的状态相互独立。

### 11.3 市场级暂停

市场 PAUSED 时：

- 禁止新分配和增仓；
- 曲线和官方池交易一律 fail closed；毕业 retry 也暂停；
- 暂停前已登记的 pending 继续按原 `activationAt` 到期，不允许管理员重置、延长或提前激活；
- 已产生的 Creator、Staker 和 Platform Bucket 不重分配；
- 用户仍能 claim、满足24小时锁定后的整仓关闭并释放 Vault 本金。

### 11.4 Gauge 故障逃生

`UserStockVault` 提供只在终态 `EMERGENCY_EXIT` 开放的 `forceReleaseAllocation(assetUid, marketId)`。进入该终态前，市场必须已经离开 `NotGraduated`、连续 PAUSED 或 RETIRED 至少24小时，并由延迟 `RECOVERY_ROLE` 原子禁用所有 fee source 和旧 Gauge version、冻结两种资产的 staker recovery cap。Vault 先验证 market 属于显式 Asset UID，再只处理该资产账本。未毕业 Curve 只能暂停后恢复，不能被推进到 RETIRED/Emergency 而永久困住 Quote/Meme。旧 Gauge 和同一 marketId 均不得恢复或原地安装 successor。

`forceReleaseAllocation` 只能：

- 读取并清除 `msg.sender` 在指定 `assetUid + marketId` 的已记录分配；
- 减少同额 `allocated[assetUid][msg.sender]`；
- 让本金变为用户自己的 free balance；
- 发出包含 assetUid、marketId、user、amount、recoveryEpoch 的事件。

它不能指定 recipient、释放他人仓位、调用故障 Gauge 或领取手续费，也不直接转币；释放后用户另行提取 free balance。正常 PAUSED/RETIRED 路径仍遵守24小时最短锁定，只有 `EMERGENCY_EXIT` 可绕过。紧急释放以本金安全优先，不以奖励恢复完成为前提。

若 Gauge 完全不可用，旧 Gauge 普通 staker claim 永久关闭。唯一外部入口是 `activateEmergencyExit(bytes32 marketId)`；调用者不能提交 epoch、snapshot、hash 或 cap。Controller 读取 Registry 后必须先拒绝 `NotGraduated`，再在激活块固定以 `block.number - 1` 为 snapshotBlock，读取 Gauge/FeeVault 状态，计算 stateHash，依次冻结 exact STAKER_REWARD caps、禁用 Gauge、禁用已有 Hook binding，最后由 Registry 复核 phase 并 commit 终态；任一步失败全部回滚。奖励恢复使用该块以前的历史事件重放和独立审计生成 `marketId + recoveryEpoch + feeAsset` Merkle root；root 先由延迟 Recovery 角色 propose，经过48小时挑战期后 permissionless finalize，期间 Guardian 可取消。只有 ACTIVE root 可领取。每资产 declaredTotal 不得超过 Emergency 时冻结的 STAKER_REWARD cap。完整编码和生命周期见 [V2_EMERGENCY_RECOVERY_LIFECYCLE.md](./V2_EMERGENCY_RECOVERY_LIFECYCLE.md)。Creator/Platform 已确定的历史负债仍可按固定 beneficiary 领取。

### 11.5 规范性状态机

状态维度不得合并：

```text
AssetStatus: UNSET, ACTIVE, PAUSED, RETIRED
QuoteStatus: UNSET, ACTIVE, PAUSED, RETIRED
BaselineStatus: UNSET, ACTIVE, PAUSED, RETIRED
LaunchPhase: NotGraduated, Swept, PoolCreated, Rescued
MarketStatus: ACTIVE, PAUSED, RETIRED, EMERGENCY_EXIT
PoolBindingStatus: NONE, EXPECTED, INITIALIZE_SEEN, ACTIVE, DISABLED
```

完整有向迁移、操作门禁和终态规则见 [V2_EXECUTION_SPEC.md](./V2_EXECUTION_SPEC.md) 第11节及 [spec/v2_execution_manifest.json](./spec/v2_execution_manifest.json)。维度独立但状态乘积受约束：`NotGraduated + RETIRED/EMERGENCY_EXIT` 非法。实现不得用单一 `paused` 或 `graduated` bool 推断其他维度，也不得增加清单外的返回边。

## 12. 上万个市场的扩展性

### 12.1 链上规则

- `marketId`、用户仓位和 Bucket 使用 mapping；
- Gauge 按市场轻量部署；未毕业 Gauge 始终为空且不参与质押者费用计算；
- 单个用户参与多少市场，不改变单市场操作 Gas；
- 不在 Vault 中保存需要链上遍历的用户 marketId 数组；
- 不在 Registry 中遍历某 Asset UID 的全部市场；
- 首发 mutation ABI 不含任何 batch 入口；链下服务可调度多个独立单市场调用；
- 永久保留单项入口作为 Gas 与故障兜底。

### 12.2 Indexer 规则

至少索引；`MarketCreated` 必须包含该市场不可变的 Base `assetUid`，`FeeBucketsCredited` 必须记录本笔 active stake 分支：

```text
MarketCreated
MarketGraduated
StockStakingOpened
AllocationPending
ActivationBucketProcessed
AllocationActivated
AllocationUnlockReset
AllocationReduced
RewardAccrued
RewardClaimed
FeeBucketsCredited
V4FeeAccrued
LockedLPFeesCompounded
MarketStateChanged
AssetStatusChanged
QuoteAssetConfigAdded
QuoteAssetStatusChanged
```

Indexer 维护但不成为权威来源：

- 每个 STOCK 下的 Meme 搜索、分页和排序；
- 用户 active/pending/claimable 市场列表、`activationAt` 与 `unlockAt`；
- 最近实际手续费、Quote/Meme 两种历史收益、有效与待激活 STOCK、`totalActiveStock` 与质押集中度；
- 毕业进度和官方池状态；
- 固定1%总费率、每笔 LP donate 与 non-LP credit，以及两种手续费资产的独立 Bucket。

前端默认展示活跃、有流动性或用户已有仓位的市场，不一次加载上万个 Meme。钱包数量只能标注为地址数，不能标注为独立人数。

前端不得把 Read API 返回的地址仅经格式校验后直接作为授权 spender 或交易 target。`TickerGardenFactoryV2.runtimeBindings()`一次返回不可变的OfficialStock、ApprovedQuote、Pons、LaunchTemplate、MarketRegistry、ProtocolFeeVault、AllocationManager和LaunchRouter信任根；Web先核对显式部署配置与这些根，再按需读取`asset`、`quoteConfig`、`baseline`、`launchTemplate`、`market`和`canonicalRoute`。API快照中的STOCK/Vault/Quote/Meme/Curve/Gauge/Router/Quoter/Hook/Locker及生命周期字段必须与链上记录一致，并在报价、approval模拟后、approval确认后和主交易模拟后重新验证；任一漂移都必须在钱包签名前fail closed。

## 13. 安全不变量

生产实现和属性测试至少覆盖：

```text
1. 对每个 Asset UID，`allocated[assetUid][user] <= deposited[assetUid][user]` 始终成立。
2. Σ 用户在同一 Asset UID 下跨 Meme 分配不得超过该资产的 Vault 本金。
3. 同一 STOCK 最小单位只能对应一份 Vault 余额和一份 active 或 pending 分配，不能重复计入多个 Meme。
4. 每个非零目标仓位 `activeAmount + pendingAmount` 必须达到当前 `minimumAllocation`；剩余仓位只能为0或不低于该值。
5. 不限制用户市场数量，但任何单次调用不得无界遍历用户、市场或历史 activation bucket。
6. `launchPhase != PoolCreated` 时，该 marketId 的有效 active、pending、`totalActiveStock` 与 `totalPendingStock` 必须为 0。
7. `NotGraduated`、`Swept`、`Rescued` 必须拒绝 allocate、increaseAllocation 和 depositAndAllocate。
8. 单纯 deposit 可以形成 Vault 空闲余额，但不形成市场仓位、锁定期、奖励或 Gauge 更新。
9. 只有 `PoolCreated` 且 Market/Asset 允许新增仓位时增加方向才可成功；新增份额先进入 pending，不能立即计奖。
10. 每个 user/marketId 同时最多一个未成熟 pending increment；到期前再次增加必须合并并把该 pending 的 `activationAt` 重置为 `now + 30 seconds`。
11. 若旧 pending 已成熟，必须先按原 bucket 快照激活，再为新 delta 创建新的 pending。
12. pending 立即占用 Vault allocated，但在到期 bucket 被处理前不进入 `totalActiveStock`、不参与零质押判断或手续费分配。
13. 旧 active 在新增 pending 等待期间保持原权重并继续计奖。
14. 到期处理后，`totalActiveStock` 必须等于所有用户 effective active 的总和；用户懒合并不能改变已经确定的经济激活时间。
15. `block.timestamp == activationAt` 的手续费 credit 必须先处理激活再切分；边界前的手续费不得归属于 pending。
16. 每次 allocate、increase 或 migrate-in 都设置 `unlockAt = now + 24 hours`；增仓重置整个合并仓位的锁定，且只能由仓位所有者触发。
17. 正常 decrease、close、migrate-out 在 `now < unlockAt` 时全部失败；claim 不延长锁定。
18. 修改 effective active 份额前，必须以旧份额分别结算 Quote 与 Meme 两套 accumulator。
19. allocation 不存在部分减仓或跨市场迁移；普通 close 与 rageQuit 都清除完整市场仓位，Gauge/Vault 返回数量必须完全一致。
20. 市场/资产暂停禁止新增，但不重置既有 pending 的 activationAt，也不阻止 claim、满足锁定后的退出和本金释放。
21. 每个 Meme 的手续费只能进入该 `marketId + feeAsset` 的 Bucket；只有 `PoolCreated` 后 active 质押份额才能进入其 Gauge。
22. 每个市场 Gauge 的奖励资产集合终身固定为 quoteAsset 与 memeToken 两种；不得增加第三种或动态奖励资产。
23. 曲线期对实际 D 固定执行 Creator 50% / Platform 50%，Staker 与 LP 均为 0，Gauge accumulator 不更新。
24. PoolCreated 后按同一收费资产严格满足 LP 约20%；`totalActiveStock == 0` 时为40/0/40/20，`totalActiveStock > 0` 时为20/40/20/20，Staker 固定取得 non-LP 的50%，具体最小单位按固定整数顺序守恒。
25. active 为零但 pending 非零时仍走零质押分支；pending 不提前取得质押者比例，零质押费用不能追溯给之后激活的质押者。
26. 零质押费用不产生 STOCK_PURCHASE，也不创建协议 STOCK 头寸。
27. Quote 侧手续费原样记 Quote，Token 侧手续费原样记该 Meme Token；协议不得转换、估值替代或跨资产净额结算。
28. 同一 fee credit 只更新与实际 feeAsset 匹配的一套 accumulator；另一套指数和 remainder 不变。
29. Gauge 与 AllocationManager 无权把 StockVault 本金转给第三方。
30. `NotGraduated → Swept → PoolCreated / Rescued` 的任何阶段变化都不改变 marketId、Asset UID 或 Gauge 身份；毕业前 Gauge 无仓位和质押者历史权益。
31. 池注册、Hook 启用、sourceVersion 增加、`PoolCreated` 写入与质押开放必须原子成功或原子回滚，管理员不能绕过发行状态机提前开放。
32. 任何 claim/withdraw 不接受可重定向 recipient；所有资产转账入口防重入并遵循 checks-effects-interactions。
33. Gauge、activation buckets、Vault、FeeVault 与 LP fee growth 均可通过事件和链上 view 对账。
34. 创建者、平台和管理员不能把用户 STOCK 当作协议资产使用。
35. 对每一种 feeAsset，FeeVault 实际余额始终不低于该资产全部未支付 Bucket 负债之和；不同资产不能互相填补缺口。
36. 实际 feeAsset 到账、Bucket credit、对应 Gauge 更新和 feeId 消费必须原子成功或原子回滚。
37. 每个 marketId 任一时刻至多一个 ACTIVE fee source；`Swept/Rescued` 可以为零个，任何阶段都不得同时启用曲线与 Hook；sourceVersion 单调递增，旧 source 不能重放。
38. Registry 只接受并冻结 `6 <= StockTokenDecimals <= 18`，运行时不得信任可变 metadata。
39. 每个 marketId 终身只有一个 quoteAssetConfigId；买入、卖出、毕业和 PoolKey 不能改用其他资产。
40. native Quote 只表示为 address(0)，WETH 是独立 ERC-20；任何模块不得静默 wrap/unwrap。
41. 未获批、fee-on-transfer、rebasing 或可变 decimals 的 ERC-20 不能成为 Quote；Meme Token 必须满足固定供应与标准 transfer 语义。
42. 毕业池 FeePolicy 当前固定为 `V2-EXEC-5`：1% afterSwap unspecified fee、LP donate20%、non-LP take80%、PoolKey fee0、Hook mask0x2044；只要存在 active stake，Staker 固定取得 non-LP 50%，不再存在 saturation 或 linear release 参数。历史 `V2-EXEC-3` 的10 STOCK规则不生效。
43. 未登记的 Quote config 保持 UNSET；只有非零 id 且显式 ACTIVE 的 `address(0)` config 才表示原生 Quote。
44. 每笔毕业池费用先在同一 feeAsset 中满足 L + D = T；不同资产的名义金额不能相加冒充 20/80 守恒。
45. LP fee 不进入 FeeVault 或 Gauge，non-LP fee 不得通过 LP fee growth 重复记账。
46. canonical locked position 的本金和 fee growth 均无管理员通用提款路径。
```

## 14. 权限与升级策略

推荐：

- `UserStockVault` 保持不可升级；Registry 强制每个 schema 只有一个 canonical Vault。新 schema 可部署 successor 并服务后续新资产，已有 Asset UID 继续 write-once 绑定；若必须迁移已有资产，使用新的 execution spec、用户可退出和 Timelock 延迟流程。
- `MemeStockGauge` 使用不可升级 clone；Factory 版本决定新市场使用的实现。
- Gauge clone 没有 initializer；八个身份/依赖字段来自 clone runtime，Factory 在部署后通过 `gaugeIdentity()` 复核，position/reward/activation/Emergency storage 仍按市场隔离。
- `AllocationManager` 不提供任意外部调用、通用 delegatecall 或独立质押开放开关；所有增加方向必须读取发行状态机，升级或迁移必须保持 Vault 本金逃生。
- `ProtocolFeeVault` 只允许登记费用源 credit 和固定 Gauge/beneficiary claim；不提供 Executor consume 或通用提款。
- Hook 固定 `V2-EXEC-5` fee policy，不存在运行时 FeePolicyController；治理若要采用新策略，只能部署新 Factory/Hook 并为新市场使用新 `executionSpecId`。
- 使用 OpenZeppelin v5.7.0 AccessManager 按 `target + selector` 授权：Guardian pause 0延迟；unpause 24小时；Recovery 24小时并额外要求市场已暂停/退休24小时；Protocol Admin 48小时。
- 部署期`ADMIN_ROLE`完成selector/guardian安装后，把四个V2 role admin全部固定为`PROTOCOL_ADMIN_ROLE`并最后自撤销；全局selector重配面由此永久锁定，后续只保留48小时治理延迟下的既有V2角色成员增删。
- Hook callback 只认 immutable PoolManager；Pool 注册只认 GraduationExecutor；Vault/Gauge allocation mutator 只认 AllocationManager；FeeVault credit 只认 Registry 当前 sourceVersion 的 active source。
- 创建者无权暂停 Vault、修改手续费策略、修改 Stock 绑定、提取 locked LP 或升级 Gauge。
- 部署 EOA 配置完成后撤销权限；不存在通用 execute、delegatecall、FeeVault withdraw 或任意 recipient claim。

规范性 selector 权限与延迟位于 [spec/v2_permissions_matrix.json](./spec/v2_permissions_matrix.json)，状态迁移与完整 ABI 位于 [V2_EXECUTION_SPEC.md](./V2_EXECUTION_SPEC.md) 和 [spec/v2_abi_surface.json](./spec/v2_abi_surface.json)。实现和部署脚本必须逐 selector 比对，不能只审核角色名称。

## 15. 与当前 V1 代码的关系

当前代码和文档是 V1 基线，不直接修改成 V2。V2 应创建新的接口、实现和测试命名空间，避免旧 ABI 被误认为兼容。

主要变化：

| V1 | V2 |
|---|---|
| `marketIdForAsset(assetUid)` 一对一 | `marketId → assetUid` 多对一，列表由事件索引 |
| 每市场 `StockStakingGauge` 托管并排放 Meme | 每 Vault schema 一个 MultiAsset `UserStockVault` 按 UID 隔离本金，每 Meme `MemeStockGauge` 分该市场实际 Quote/Meme 手续费 |
| `EmissionController` | 删除 |
| `RewardEscrow` | 删除 |
| `CanonicalLPNFTGauge` | 删除 |
| 质押奖励为新铸 Ticker Meme | 奖励为实际到账且不转换的 Quote 或该市场 Meme Token |
| 一个 Asset UID 一个 Meme | 一个 Asset UID 多个 Meme |
| 买卖方向不对称费用用途 | 曲线期固定 Creator/Platform 50/50；`PoolCreated` 后只要存在 Active stake，Staker 固定取得 non-LP 50% |
| 零质押购买 STOCK | 删除；零质押 non-LP 费用由创建者与平台各得 50% |
| LP 挖矿排放 | 删除；毕业后每笔手续费的池级20%只进入真实 in-range fee growth |

可以复用：

- `OfficialStockRegistry` 的 Asset UID 和 canonical 地址理念；
- `ProtocolFeeVault` 的 `marketId + feeAsset + bucketType` 隔离模型；
- `StockStakingGauge` 已验证的 `accRewardPerShare`、`mulDiv/mulmod` 和 remainder 思路；
- 既有“暂停不能扣押用户退出”的权限原则；
- Indexer、Backend 的非托管边界；手续费会计不依赖异步转换 worker。

不得复用旧的排放时间、软门槛、MintedSupply、LP Subscriber、RewardEscrow、FeeExecutor 或 ProtocolStockTreasury 语义。

## 16. 建议的新接口边界

V2 编码前应至少冻结以下接口：

```text
IOfficialStockRegistryV2
IPonsBaselineRegistry
IApprovedQuoteRegistry
ILaunchConfigResolver
ITickerGardenFactoryV2
IUserStockVault
IAllocationManager
IMemeStockGauge
IMarketFeeAccounting
IProtocolFeeVaultV2
IPonsCompatibleCurve
IGraduationExecutor
IGraduationGuard
ILaunchLocker
ILaunchAndBuyRouter
ITickerGardenMemeHook
IMarketControllerV2
```

以上名称只表示模块边界；规范性的函数、事件、caller 和 recipient 已冻结在 [spec/v2_abi_surface.json](./spec/v2_abi_surface.json)。实现不得在这些接口之外增加可转移资金、改变受益人、改写 PoolKey/费率或绕过状态机的 mutation ABI；可以增加不改变状态的 view/pure 查询。

关键用户动作：

```text
depositStock(assetUid, amount)
withdrawFreeStock(assetUid, amount)
launchAndBuy(createParams, firstBuyAmount, minTokensOut, recipient)
allocate(marketId, amount)
increaseAllocation(marketId, amount)
closeAllocation(marketId)
checkpointActivations(marketId)  // permissionless；固定30秒时间轮有界处理
ProtocolFeeVault.claimStaker(marketId, quoteAsset)
ProtocolFeeVault.claimStaker(marketId, memeToken) // 单资产失败隔离；收款人固定为 msg.sender
rageQuit(marketId)
```

关键只读查询包括 `isStockAllocationOpen(marketId)`；它必须从发行阶段与暂停状态派生，不能成为独立可写开关。批量领取已明确移出 V2 initial release；当前及最终 V2-EXEC-5 mutation ABI 都不得出现 batch 入口。

最终 ABI 不应让用户 claim/withdraw 指定任意 recipient。Router 可以组合动作，但不能改变底层固定 beneficiary。

## 17. 验证与测试计划

### 17.1 单元测试

- `0`、当前 `minimumAllocation` 边界，以及 `S=0`、`S>0` 的固定手续费分支；
- Registry 支持精度范围内的任意精度存入与增仓，并只允许整仓清零；
- 多 Meme 分配总和守恒；
- `NotGraduated`、`Swept`、`Rescued` 分别拒绝 allocate、increaseAllocation 和 depositAndAllocate；
- 未毕业时单纯 deposit 成功但余额保持 free，不产生 active 仓位、锁定期或收益；未毕业的 depositAndAllocate 整笔回滚；
- `PoolCreated` 后首次分配进入 pending：29秒仍无权重，恰好30秒的 fee credit 先激活并参与分配；
- 新用户以 activation bucket 的 Quote/Meme 双指数快照开始计奖，不分享分配前及30秒等待期内的历史手续费；
- 已有 active 的用户增仓时，旧 active 在新 pending 等待期间继续计奖；
- 同一用户在 pending 未成熟前连续增仓只保留一个 pending，合并数量并把30秒延迟从最后一次增仓重新计算；
- pending 已成熟后的再次增仓先激活旧数量，再为新 delta 建立独立的新30秒等待；
- 24小时锁定从 allocate/increase 交易时间而非 activationAt 计算；`24h - 1` 失败、恰好24h成功；
- 增仓重置整个合并仓位的24小时锁定；第三方不能替用户增仓或恶意延长其锁定；
- 用户在30秒后但24小时前不能正常 claim/decrease/close/migrate-out；可选择 `rageQuit` 绕过24小时并放弃全部未领取双资产收益；
- 暂停前的 pending 继续到期并可 checkpoint，暂停禁止新 pending 但不阻塞到期退出；
- 更换市场必须先整仓关闭源池，再以独立交易从 Vault free balance 分配到目标池；目标数量 pending 30秒，期间不计奖；
- 两人等额和非等额按 active STOCK 比例分配；
- `PoolCreated` 后首个合格仓位在30秒激活后启用固定的 Staker non-LP 50% Bucket，且只参与激活后的费用；
- 只有 pending、没有 active 时仍走零质押分配，历史手续费不倒灌；
- `S=0` 与 `S>0` 分别执行零质押与固定 Staker 50% non-LP 分支，后者再按 active STOCK 比例分配；不存在 saturation 或线性释放；
- native、6/8/18 decimals ERC-20 Quote 以及不同 decimals Meme Token 最小单位下，曲线固定 `50/50` 与毕业后逐 feeAsset 的固定 Staker 50% 公式整数守恒；
- 曲线手续费永不更新 Gauge accumulator 或 `STAKER_REWARD` Bucket；
- 毕业池 exact-input/exact-output、买卖两方向下，afterSwap unspecified fee 固定1%，`L=floor(T×20%)`、`D=T-L`、Hook 瞬时 delta 归零，且 core lp/protocol fee 非零时整笔回滚；
- native Quote 的 `msg.value` 精确校验、领取失败隔离与 Uniswap v4 native PoolKey；
- ERC-20 Quote 的实际余额差、错误 decimals、fee-on-transfer、rebasing 和异常 transfer 行为拒绝；
- 同一 marketId 无法替换 quoteAssetConfigId，另一 Quote 无法向其 FeeVault Bucket credit；
- native 与不同 ERC-20 Quote 分别完成曲线、尾单退款和毕业参考向量；每个 `PoolCreated` 向量同时覆盖 Quote/Meme 两侧手续费、双资产独立 remainder、聚合 claim 与单 feeAsset 失败隔离领取；
- Quote 等于绑定 STOCK 时仍只作为该市场 Quote 结算，不触发协议 STOCK 购买；
- Quote PAUSED 后禁止新市场，但历史 claim、Gauge 结算和本金退出仍可用；
- totalActiveStock 大幅变化时 remainder 归一化；
- `D`、`S` 和动态 `minimumAllocation` 处于最小整数和极大整数边界时，固定分桶与 accumulator 不溢出，且确定性余数只归一个明确 Bucket；
- Quote/Meme 两种实际手续费分别更新各自 accumulator、Bucket、remainder 和 claim，另一资产状态保持不变；
- Token 侧手续费原样分 Meme Token，不调用 Router/预言机，也不形成 Quote 负债；
- 同一市场的两种固定资产分别 claim；不存在跨市场 batch 或跨资产净额；
- 重复 claim、重复 feeId 和重复毕业重试；
- 原子 launch-and-buy 不可被第三方交易插入，尾单仍正确退款；
- 反狙击只允许受限首买一次性例外，不接受任意豁免地址数组；
- 既有市场不存在费率升降档或动态 fee override，任何核心费或 FeePolicy 改写路径均被拒绝；
- Pons 参考向量逐项相同：买卖报价、费用顺序、反狙击衰减、部分成交、退款、reservedTokens 与毕业池初始状态；
- `NotGraduated → Swept → PoolCreated` 正常与自动毕业失败重试路径；
- 池注册、Hook、sourceVersion、`PoolCreated` 和质押开放原子成功；写入前拒绝质押、成功后允许首次分配；
- 七日救援后 `Rescued` 不可建池、不可恢复交易收费源或开放 STOCK 质押；
- 市场毕业前 Gauge 保持零仓位与零质押者指数，毕业后身份不变并从空状态开始计奖；
- 未毕业、Swept、Rescued 或 PAUSED 目标市场拒绝新的 allocation，且不会影响已完整关闭的其他市场仓位；
- 资产暂停下 claim/退出仍可用；
- canonical locked LP 的 fee growth 不可由创建者、平台或管理员提走。

### 17.2 属性与 Fuzz 测试

- 任意操作序列下 `allocated <= deposited`；
- Manager、Gauge、Vault 均不存在按 amount 部分退出或跨池搬移 selector，不能复制或拆分已锁定 STOCK；
- 任意非 `PoolCreated` 状态下 `totalActiveStock == totalPendingStock == 0` 且增加方向全部失败；
- 任意操作序列下每个 user/marketId 至多一个未成熟 pending，`totalPendingStock` 与 bucket 总额守恒；
- 任意手续费/分配交易排序下，pending 在 activationAt 前权重为零、边界及之后权重唯一生效一次；
- 任意 `0 <= S < B` 下，质押者 Bucket 等于统一整数公式结果；增加 active STOCK 不会降低已存在用户的绝对边际份额，且 `S >= B` 后总质押者比例不超过40%；
- 任意增仓序列下 `unlockAt` 单调重置为最后一次增加交易时间加24小时，非所有者不能改变它；
- 用户领取总和不超过该市场实际 `STAKER_REWARD`；
- 所有 Fee Bucket 总和等于实际到账；
- 曲线阶段 Creator + Platform 等于 `D_curve` 且 Staker Bucket/accumulator 不变；毕业后每种 feeAsset 独立满足 `L + D = T`，FeeVault Bucket 总和等于实际收到的同资产 non-LP 费用；
- claim 顺序、频率和钱包拆分不创造额外 Quote 或 Meme Token；
- 对每种 feeAsset，FeeVault 余额始终覆盖该资产负债；一种资产的余额不能掩盖另一种资产的短缺；
- 市场数量增加不改变已有 Gauge 的会计；
- 恶意 Token、重入、fee-on-transfer、异常 decimals 被拒绝；
- 任意 fee source 不能登记该市场 quoteAsset/memeToken 以外的第三种资产，也不能跨资产转换或冲抵；
- 紧急退出只能释放调用者本金。

### 17.3 Gas 与规模测试

- 单 Gauge fee credit Gas 上界；
- 固定30秒 activation 时间轮在长期运行、同秒大量用户和空槽扫描下仍有确定上界；
- 单用户参与 1、10、100、1,000 个 Meme 时单项操作 Gas 不增长；
- 最终 artifact 不包含 `batch*`、`claimAll`、`withdrawAllMarkets` 或 `migrateAll`；
- 10,000 个市场事件下 Indexer 分页、重放和恢复；
- 大量零质押市场不会增加普通市场交易 Gas；
- CREATE2 clone 部署与创建费覆盖。

## 18. 执行冻结与编码前开放决策

历史 `V2-EXEC-3` 已关闭以下实现选择；当前规则以 `V2-EXEC-5` 为准：

| 已冻结 ID | 结论 |
|---|---|
| V2-FROZEN-V4-FEE-01 | canonical PoolKey/Hook mask/afterSwap 1%/donate20%/take80%/feeId/失败回滚 |
| V2-FROZEN-VAULT-01 | 市场级 allocation 聚合、本金普通释放与终态 force release |
| V2-FROZEN-ACTIVATION-01 | `1s/30s/32槽`、绝对 generation、双 snapshot、`P=1e27` 与 remainder |
| V2-FROZEN-STATE-ABI-01 | 完整状态迁移、AccessManager selector 权限/延迟、ABI、事件和 recovery cap/root |
| V2-FROZEN-LOCKED-LP-01 | locked fee 只能 permissionless compound，同市场单边余额继续锁定 |
| V2-G0-PONS-RUNTIME-VECTORS-01 | 活跃 runtime 的3秒反狙击表及 native/ERC-20 毕业 receipts 已固定并由独立模型复算 |
| V2-G0-PRODUCTION-QUOTES-01 | 首发 native/USDG Quote economics 和 content hash 已批准；USDG 部署前重取指纹 |
| V2-FROZEN-NUMERIC-01 | 6–18 decimals、int/uint/time、full-precision 与 accumulator 生命周期域由 `spec/v2_numeric_bounds.json` 固定 |
| V2-G0-BATCH-01 | batch ABI 移出 V2 首发，单市场入口永久保留 |
| V2-G0-OFFICIAL-STOCK-BASE-01 | 当前观测194项 ACTIVE 官方 STOCK 全部可选为市场唯一质押 Base；使用 raw balance 分配，不依赖价格、Feed 或 backing target |

机器可读清单由 `spec/test_v2_execution_spec.py` 校验。本轮另已确认：活跃 `0x7eD598…` 固定行为 baseline、native + 多 ERC-20 Quote 能力、初始 `0.0005` 原生创建费、atomic launch-and-buy 无人为1%首买上限，以及 TickerGarden 自有 ABI/CREATE2/行为向量。详见 [V2_PONS_BEHAVIOR_BASELINE.md](./V2_PONS_BEHAVIOR_BASELINE.md)。

以下仍是产品实例参数或外部签字阻塞项，不得由实现者自行假设：

| ID | 决策 | 阻塞模块 |
|---|---|---|
| V2-G0-PONS-SECURITY-01 | 确认参考源码/许可、baseline 行为等价，并对 Pons 未关闭审计风险和 TickerGarden 差异取得独立审计签字 | 法律、合约、安全审计、部署审批 |
| V2-G0-LEGAL-01 | Stock Token 质押手续费收益的地区准入、披露和前端措辞 | Web、合规、部署范围 |

实现门禁已经闭合，当前状态为 `IMPLEMENTATION_ALLOWED`。目标链 finalized 身份/实现指纹、最终 artifact/Fork、法律与独立审计签字仍分别属于 deployment/production 门禁；因此不得把 V1 合约直接修改后部署为 V2，也不得把“允许实现”描述成可部署或生产就绪。
