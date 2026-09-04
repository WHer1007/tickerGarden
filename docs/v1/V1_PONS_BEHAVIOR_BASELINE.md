# TickerGarden V1 Pons 行为参考基线

> 修订说明：Pons链上行为证据仍保留原始版本标识；TickerGarden自身的质押、Treasury、费用与原子毕业差异已按当前`V1-EXEC-10`修订，不再使用旧版10 STOCK线性规则。

> 决策状态：`PRODUCT_DIRECTION_APPROVED / IMPLEMENTATION_ALLOWED / NOT_DEPLOYABLE`  
> 基线标识：`TG-PONS-BEHAVIOR-1`  
> 执行规范：`V1-EXEC-10`
> 决策日期：2026-09-02  
> 适用范围：TickerGarden V1；不覆盖任何 Test Prototype 文档或合约

## 1. 决策

TickerGarden V1 的发行主链路以 Pons V2 当前活跃部署的已确认链上行为为参考。产品层的主要差异只有两类：

1. Pons 的协议/创作者/buyback 手续费路由替换为 TickerGarden 已冻结的手续费分配；
2. 市场进入 `PoolCreated` 后，增加按 Meme 独立 Gauge 分配 STOCK、延迟激活、最短持有和手续费领取。

多资产 Quote、创建费、原子创建并首买、固定供应 Token、phantom-reserve 曲线、尾单部分成交与退款、公式化供应分区、全范围初始 LP 和永久锁定等行为以本基线为参考目标。Pons 的两阶段毕业、permissionless retry 与 owner rescue 仅保留为对照证据；TickerGarden 明确改为最终买入内原子毕业、失败整笔回滚，且不提供终态救援或市场资产接收人。

“参考 Pons”指行为与整数结果兼容，不指：

- 运行时调用或依赖 Pons Factory；
- 直接复制当前无法完整复现活跃字节码的公开仓库；
- 沿用 Pons 地址、管理员、手续费受益人、BuybackVault 或升级权限；
- 把未来 Pons 配置变更自动应用到既有 TickerGarden 市场。

TickerGarden 使用自己的 ABI、Registry、CREATE2 domain、部署 manifest、数学不变量和测试向量。市场创建时冻结 `ponsBaselineId`、`quoteAssetConfigId`、`launchTemplateId`、`feePolicyId` 和 `expectedEconomics`；历史市场不随外部状态改变。

## 2. 参考部署和证据等级

行为参考部署为 Robinhood Chain 上 Pons 官方文档当前列出的活跃 Factory：

```text
chainId                 = 4663
referenceFactory        = 0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e
referenceBlock          = 52,289,586
referenceBlockHash      = 0x9477917aacd098d56b4d5fb375e555a09d1a61b7bf33417429e5c8e4a2e86006
referenceRuntimeHash    = 0x89a27da6f703e0a7cdd4f233e7cb57604ff75b164530962d3ff7cf8483a67d84
referenceLaunchConfigId = 0
```

证据分为三层：

| 等级 | 可作为实现依据的内容 | 不可推导内容 |
|---|---|---|
| 链上已确认 | 地址、runtime hash、getter、selector、事件、真实创建和交易 calldata/receipt | 未暴露的内部算法源码 |
| 公开源码参考 | constant-product、整数舍入、partial fill、毕业分区、状态机和安全检查 | 与活跃 runtime 完全字节码等价 |
| TickerGarden 规范 | 自有 ABI、费用路由、STOCK Gauge、CREATE2、权限与错误处理 | 对 Pons 未来版本的自动兼容 |

Pons 当前公开 `main` 存在 Factory 已传递 `salt`、公开 Deployer 却没有对应字段/CREATE2 实现等不一致，因此不得把它直接标记为活跃部署的 verified source。本基线只选定行为目标；源码许可、差分验证和独立审计仍是部署硬门禁。

## 3. 继承与差异矩阵

| 模块/行为 | 决策 | TickerGarden 解释 |
|---|---|---|
| 原生和 ERC-20 多 Quote | 继承为架构能力 | 管理员可追加多个通过风险评估的 native/direct immutable ERC-20 config；创建者从任意 `ACTIVE` 条目中选择，一个市场永久绑定一种 `quoteAssetConfigId` 并单独冻结 decimals、phantom 和 threshold |
| `expectedEconomics` | 继承并扩展 | 除发行参数外，再覆盖 Asset UID、canonical Stock身份、LaunchTemplate 和 TickerGarden fee policy；不包含价格、backing target或可动态更新的`minimumAllocation` |
| 创建费 | 继承金额与支付语义 | 当前 Factory 固定 `0.0005` 原生资产且必须精确支付；无 setter/调价事件，改费必须新 Factory + 新 `executionSpecId` |
| 原子 launch-and-buy | 继承 | 原生 Quote 支付“创建费 + 首买”；获批 ERC-20 Quote 以原生资产支付创建费，并授权所选 ERC-20 首买数量 |
| 首买金额 | 继承 | 不设置人为的“毕业门槛1%”上限；由曲线可售余额、partial fill、退款与 `minTokensOut` 约束 |
| Token 固定供应 | 继承 | 全量初始供应一次性进入 Curve，无后续 mint、无独立 LaunchAllocation |
| Curve 数学 | 继承 | 相同 constant-product、费用顺序、整数向下/向上取整、tracked reserve 和尾单规则 |
| 反狙击 | 定价行为继承、入口收窄 | 采用活跃 runtime 的精确整数输出表：elapsed `0/1/2/≥3` 秒为 raw `9900/618/19/0 bps`；TickerGarden `creatorTax=0`、base fee `100`、`minimumNet=100` 后 effective 为 `9800/618/19/0 bps`。不反推未经验证的公式；只自动豁免真实 creator/beneficiary 和原子首买 recipient |
| 毕业触发与失败 | 部分继承、执行模型不同 | 继承最终 Curve 买入自动触发与永久锁仓；TickerGarden 改为 `NotGraduated -> PoolCreated` 单交易原子提交，任一步骤失败使最终买入整体回滚，不保留 `Swept`，不提供 permissionless retry、owner/terminal rescue 或市场资产接收人 |
| 初始 LP | 继承 | canonical full-range position 直接进入不可提款 Locker |
| Pons fee beneficiary/buyback | 替换 | 统一进入 TickerGarden FeeVault 和已冻结手续费分配；不使用 Pons BuybackVault |
| STOCK 质押 | 新增 | 只在 `PoolCreated` 后开放，一个 Meme 一个 Gauge，收到什么手续费资产就分什么资产 |
| 地址与 Registry | 独立实现 | 使用 TickerGarden 自有 CREATE2 domain、MarketRegistry 和部署 manifest |
| 管理员 takeover/任意资金转移 | 不继承 | 仅保留显式、延时、可审计的状态迁移与用户本金逃生 |

## 4. 多资产 Quote

TickerGarden 采用“一市场一 Quote、平台支持多 Quote”的模型：

```solidity
struct QuoteAssetConfig {
    bytes32 ponsBaselineId;
    address quoteAsset;            // address(0) = native
    uint8 quoteDecimals;
    uint256 phantomQuote;
    uint256 graduationThreshold;
    bytes32 economicsHash;
    QuoteAssetStatus status;
}
```

规则：

1. native 和每个 ERC-20 都是独立 config；不得跨 decimals 复制 raw value；
2. 创建时 config 必须存在且为 ACTIVE；mapping 默认零值不能被解释为 native；
3. ERC-20 批准时和创建时都读取 decimals；异常或变化时拒绝新市场；
4. config 追加而不覆盖；更新 economics 必须生成新 ID；
5. 暂停 Quote 默认只阻止新市场，不改变历史市场资产，也不阻止已到账费用领取；
6. `NATIVE_ETH_V1` 是当前 bootstrap 示例，不是唯一 Quote 或协议上限。管理员可逐项评估并追加普通 ERC-20 config，但只能接受 `proxyKind == NONE` 的不可升级直接合约；Registry 固定 runtime codehash 并在创建市场时复核，部署 preflight 还须证明 implementation/admin/beacon 三个 EIP-1967 槽均为零。已观测 USDG 是可升级代理，因此不符合普通路径。Robinhood 官方 Stock Token 如需成为 Quote，必须走独立的 Asset UID + canonical Token + Beacon/implementation 指纹准入路径；该路径当前为 `IMPLEMENTATION_PENDING`，不构成对任一 Stock Quote 的激活。

7. Stock Quote 的链下价格只可用于生成追加式 config 和前端展示。REST `/rhj/prices/{symbol}` 的底层股票价格必须乘一次 `currentMultiplier`；Robinhood Chain Chainlink Feed 已返回 multiplier-adjusted Token 价格，禁止重复相乘。最终上链的是冻结的 raw `phantomQuote` 与 `graduationThreshold`，市场创建后 Curve/毕业不读取 API、Oracle 或动态 USD 目标。完整规则见 [`V1_STOCK_QUOTE_PRICE_REFERENCE.md`](./V1_STOCK_QUOTE_PRICE_REFERENCE.md)。

当前 bootstrap 示例值为（管理员可以按同一规则追加其他配置）：

| 配置 | Quote 地址 | decimals | phantomQuote | graduationThreshold | configId / economicsHash |
|---|---|---:|---:|---:|---|
| `NATIVE_ETH_V1` | `0x0000000000000000000000000000000000000000` | 18 | `1680000000000000000` | `4200000000000000000` | `0x110acc145df286ef871d394b987b4ce12b062dc4d50d75343cdac7986a21e64e` |

Quote economics hash 使用 domain `TICKERGARDEN_V1_QUOTE_ECONOMICS`、schema version `1` 和 `keccak256(abi.encode(domain,schemaVersion,chainId,ponsBaselineId,quoteAsset,quoteDecimals,phantomQuote,graduationThreshold))`。ERC-20 的代码身份另由 Registry 的 append-only runtime codehash 指纹和部署 manifest 固定。

## 5. 创建 ABI 和付款语义

TickerGarden 不追求 Pons 二进制 ABI 相同，保留自己的市场身份与 STOCK 绑定字段：

```solidity
struct CreateMarketParams {
    bytes32 assetUid;
    bytes32 ponsBaselineId;
    bytes32 quoteAssetConfigId;
    bytes32 launchTemplateId;
    bytes32 expectedEconomics;
    address creatorRevenueBeneficiary;
    string name;
    string symbol;
    string metadataURI;
    bytes32 salt;
}

// minimumAllocation 不是 creator 参数，也不写入不可变 MarketConfig/hash；
// AllocationManager 每次变更仓位时从 OfficialStockRegistry 动态读取。

function createMarket(CreateMarketParams calldata params)
    external payable
    returns (bytes32 marketId, address memeToken, address curve, address gauge);

function createMarketFor(address creator, CreateMarketParams calldata params)
    external payable
    returns (bytes32 marketId, address memeToken, address curve, address gauge);

function previewMarketEconomics(CreateMarketParams calldata params)
    external view returns (bytes32 expectedEconomics);

function predictMarketAddresses(address creator, CreateMarketParams calldata params)
    external view
    returns (bytes32 marketId, address memeToken, address curve, address gauge, address launchLocker);
```

`createMarketFor` 只允许 immutable LaunchAndBuyRouter，并由 Router 将最外层 `msg.sender` 作为 creator 传入；禁止 `tx.origin` 和公众任意指定 creator。

初始创建费：

```text
launchFee = 500000000000000 wei = 0.0005 native
```

该值是当前 Factory 的 immutable，不是“初始可治理参数”。当前 ABI 不存在 setter；任何新费率属于新 Factory/Router/LaunchTemplate 和新 `executionSpecId`，旧 Factory 永远返回本值。

普通创建要求：

```text
msg.value == launchFee
```

原子首买：

```solidity
function launchAndBuy(
    CreateMarketParams calldata params,
    uint256 firstBuyAmount,
    uint256 minTokensOut,
    address recipient
)
    external payable
    returns (bytes32 marketId, address memeToken, uint256 tokensOut, uint256 refund);
```

付款规则：

```text
native Quote: msg.value == launchFee + firstBuyAmount
ERC-20 Quote: msg.value == launchFee，并由 Router 从 creator 拉取 firstBuyAmount
```

首买没有额外的1%门槛上限。超出最后可售数量时只成交需要的部分，未使用 Quote 原路退回 creator；`recipient` 只决定 Meme 接收人，不改变 creator、beneficiary、marketId 或 salt namespace。

## 6. Token 和 Curve 接口

`TickerMemeTokenV1` 为 18 decimals 的普通固定供应 ERC-20。标准
`name/symbol/decimals/totalSupply/balanceOf/transfer/allowance/approve/transferFrom`
及 `Transfer/Approval` 事件属于 canonical ABI；除这三个标准转账/授权 mutation 外不得增加任何状态修改入口。创建后必须满足：

```text
initialSupply == baseline.supply
balanceOf(curve) == initialSupply
任何地址均无 mint 权限
```

最低附加只读接口：

```solidity
marketId() external view returns (bytes32);
creator() external view returns (address);
factory() external view returns (address);
metadataURI() external view returns (string memory);
initialSupply() external view returns (uint256);
```

Curve 关键 ABI：

```solidity
buy(uint256 quoteIn, uint256 minTokensOut, address recipient)
    external payable returns (uint256 tokensOut, uint256 quoteSpent);

sell(uint256 tokensIn, uint256 minQuoteOut, address recipient)
    external returns (uint256 quoteOut, uint256 fee);

quoteBuy(uint256 quoteIn, address recipient)
    external view returns (uint256 tokensOut, uint256 quoteSpent, uint256 refund);

quoteSell(uint256 tokensIn)
    external view returns (uint256 quoteOut, uint256 fee);

getReserves() external view returns (uint256 quoteReserve, uint256 tokenReserve);
realQuoteReserve() external view returns (uint256);
sellableTokens() external view returns (uint256);
reservedTokens() external view returns (uint256);
readyToGraduate() external view returns (bool);
sweepCurveFees() external returns (uint256 sweptAmount);
```

TickerGarden 的返回值比 Pons 更明确，但定价、实际成交和退款结果必须与冻结行为向量一致。

## 7. 曲线整数数学

令 `B = 10_000`。Constant-product 报价为：

```text
amountInWithFee = amountIn × (B - feeBps)

amountOut = floor(
    amountInWithFee × reserveOut
    / (reserveIn × B + amountInWithFee)
)

amountIn = floor(
    amountOut × reserveIn × B
    / ((reserveOut - amountOut) × (B - feeBps))
) + 1
```

TickerGarden 初版不开放 Pons 的额外 creator tax。买入的基础费和反狙击费均从 gross Quote 扣除后再定价；卖出先得到 gross Quote，再从 Quote 输出扣费。费用受益人不同不能改变曲线价格、舍入顺序或储备变化。

曲线使用内部 tracked accounting，不以可被强制转入的实时余额作为定价储备：

```text
pricingQuoteReserve = phantomQuote + trackedQuote - accruedQuoteFees
pricingTokenReserve = trackedTokens
```

## 8. 供应分区、尾单和 TickerGarden canonical 毕业池公式

初始化时：

```text
reservedTokens = floor(
    supply × phantomQuote
    / (phantomQuote + graduationThreshold)
)

sellableTokens = supply - reservedTokens
```

必须满足：

```text
0 < reservedTokens < supply
trackedTokens >= reservedTokens
```

尾单若普通报价超过 `sellableTokens`：

```text
tokensOut = sellableTokens
netRequired = getAmountIn(tokensOut, quoteReserve, tokenReserve, 0)
quoteSpent = min(
    ceil(netRequired × B / (B - totalQuoteFeeBps)),
    quoteReceived
)
refund = quoteReceived - quoteSpent
```

部分成交时滑点条件按价格比例判断：

```text
quoteSpent × minTokensOut <= quoteReceived × tokensOut
```

毕业条件：

```text
readyToGraduate = !graduated && sellableTokens == 0
```

必须区分以下三个数量：

1. `reservedTokens`：曲线永不出售的 Meme 下限；
2. `sweptTokens`：原子毕业时从曲线实际收到的 Meme，正常情况下等于 `reservedTokens`；
3. `poolMemeAmount`：同一交易中真正注入 V4 池的 Meme。

TickerGarden 真正注入毕业池的 Quote/Meme 由冻结配置决定，而不是由任意交易历史造成的 raw-unit 舍入余量决定：

```text
poolQuoteAmount = ceil(
    sellableTokens × phantomQuote / reservedTokens
)

lockedExcessQuote = sweptQuote - poolQuoteAmount

poolMemeAmount = floor(
    reservedTokens × poolQuoteAmount
    / (poolQuoteAmount + phantomQuote)
)

lockedExcessMeme = reservedTokens - poolMemeAmount
```

`poolQuoteAmount` 与 `poolMemeAmount` 创建 canonical full-range position；`lockedExcessQuote` 与 `lockedExcessMeme` 永久进入 Locker，不能给创建者、平台或质押者。Curve 必须证明 `sweptTokens == reservedTokens` 且 `sweptQuote >= poolQuoteAmount`，否则最终买入整体回滚。

TickerGarden 的链上成功证明由同一最终买入交易中的 `CurveCompleted` 与 `PoolGraduated` 组成。`PoolGraduated` 记录 `sweptQuote/sweptTokens/poolQuoteAmount/poolMemeAmount/lockedExcessQuote/lockedExcessMeme`，并可与 per-market Locker 余额、V4 仓位和 Curve tracked accounting 交叉核对。失败交易整体回滚，因此不发出持久的 `LaunchSwept` 或 `AutoGraduationFailed` 事件；Router 不复制毕业事件。

以当前 Pons 原生配置为例：

```text
phantomQuote / graduationThreshold = 2 / 5
reservedTokens / supply            = 2 / 7
sellableTokens / supply            = 5 / 7
poolMemeAmount / supply             = 10 / 49 ≈ 20.4082%
lockedExcessMeme / supply           = 4 / 49  ≈ 8.1633%
```

因此“曲线保留量”和“真正加入 LP 的 Meme 数量”绝不能使用同一个字段或事件值。

活跃 Pons runtime 的反狙击窗口不能从文档或公开源码公式推导：公开文档观察到 5 秒，固定源码 commit `845bd546b37515621e47b08015ce4f9d374f6eca` 的默认值为 15 秒，而链上 runtime 的可复现窗口为 3 秒。因此 TickerGarden 只冻结以下行为表，不把任何一套未验证源码公式写入协议：

| elapsed（秒） | raw runtime bps | TickerGarden effective bps |
|---:|---:|---:|
| 0 | 9900 | 9800 |
| 1 | 618 | 618 |
| 2 | 19 | 19 |
| ≥3 | 0 | 0 |

其中 effective 为 `min(rawSnipeBps, 10000-feeBps-creatorTaxBps-minimumNetBps)`，上表使用 `feeBps=100`、TickerGarden `creatorTaxBps=0`、`minimumNetBps=100`；仅作用于 BUY 的 Quote leg。creator、creator revenue beneficiary 和 atomic first-buy recipient 自动豁免，不存在任意豁免数组。完整区块、交易、runtime hash 和向量见 [`spec/v1_pons_runtime_evidence.json`](../../spec/v1_pons_runtime_evidence.json)。

### 8.1 真实毕业收据与权限语义

两条真实链上 receipt 验证了 native 与 ERC-20 Quote 的成功路径。它们是行为证据，不是 TickerGarden 的部署地址：

| Quote | phantom / threshold | sweptQuote / sweptTokens | poolMeme / lockedExcess | sqrtPriceX96 / tick / liquidity |
|---|---|---|---|---|
| native | `1680000000000000000` / `4200000000000000000` | `4200000000000000157` / `285714285714285714285714285` | `204081632653061226669443287` / `81632653061224487616270998` | `552276925551777199545721453919781` / `176998` / `29277002188455996084176` |
| ERC-20 TTWO (18 decimals) | `10655602752807139311` / `26639006882017848277` | `26639006882017848346` / `285714285714285714289544789` | `204081632653061224642468854` / `81632653061224489647075935` | `219291868843934996861561852956313` / `158524` / `73732842185408371800139` |

对应 poolId 分别为 `0x9f560810ed40e1ed68f099b56138f8217dcce349c23ab060c85aa034aff62ba3` 与 `0x7beaa827d21173074319e8a2f2a1d0f8069b72fe3c44db144d7004bc82fc6173`；两条路径的 full-range ticks 均为 `[-887200, 887200]`。

这些收据证明的是 Pons V2 参考实现的两阶段、permissionless Pool 创建与七日 owner rescue 行为，不是 TickerGarden 当前状态机。TickerGarden 复用其 supply/reserved 分区和 full-range tick 原则，但 pool 数量改为上述配置决定的 canonical 公式，Pons receipt 中因交易历史多出的 Quote 在 TickerGarden 会进入永久 Locker。exact registered Curve 在最终买入中同步调用 Executor，并直接从 `NotGraduated` 提交 `PoolCreated`。若建池失败，整个最终买入回滚；任何外部账户都不能 retry 或 rescue。Pons 事件、区块/交易 hash、gas 和异常语义继续保留在 runtime evidence 中，仅作为差分参考。

### 8.2 V1 首发不提供批量 ABI

首发 ABI 只提供单市场入口；不提供 batch create、batch buy、batch graduate 或批量 staking/claim。单市场入口为永久兼容面。批量操作明确不属于 V1 initial release，避免把未冻结的数组失败语义、gas 上限和部分成功语义带入协议。

### 8.3 数值域与精度边界

通用数值域见 [`spec/v1_numeric_bounds.json`](../../spec/v1_numeric_bounds.json)。首发实现限定资产 decimals 为 `6..18`；供应、reward/accounting 及 v4 returned delta 均须在 Solidity 对应有符号/无符号边界内。所有乘除、部分成交比较、毕业分区、手续费、V4 价格/流动性和质押累计器使用 full-precision mulDiv；每一步的 floor/ceil 与 residual 归属按机器文件冻结。激活延迟为30秒、最短锁定为86400秒，所有时间加法必须先检查 `uint64` 溢出，失败不得改写状态。

## 9. TickerGarden CREATE2 地址规则

每个市场的 Curve、Token、Gauge 和 LaunchLocker 均可在交易前预测。`marketId` 已绑定 chain、Factory、creator、beneficiary、用户 salt、economics 和元数据哈希；组件 salt 只再加入组件类型：

```text
COMPONENT_SALT_DOMAIN = keccak256("TICKERGARDEN_V1_COMPONENT_SALT")

componentSalt = keccak256(abi.encode(
    COMPONENT_SALT_DOMAIN,
    uint256(1),
    block.chainid,
    address(factory),
    marketId,
    componentKind       // keccak256("CURVE"/"TOKEN"/"GAUGE"/"LOCKER")
))
```

CREATE2 地址使用标准公式：

```text
predicted = last20bytes(keccak256(
    0xff || launchDeployer || componentSalt || initCodeHash
))
```

固定部署顺序：

```text
derive marketId
→ derive/predict Curve
→ Token initCode 绑定 predicted Curve，再 predict Token
→ predict Gauge
→ 使用 GraduationExecutor 作为 CREATE2 deployer 预测 per-market Locker
→ deploy Curve
→ deploy Token，全部供应铸给 Curve
→ deploy/initialize Gauge 为不可分配状态
→ Curve.initialize(Token)
→ assert actual == predicted for all components
→ register Market atomically
→ final buy 同步调用 GraduationExecutor，部署 predicted Locker 并原子提交 PoolCreated
```

要求：

- Curve 构造参数不依赖尚未部署的 Token 地址；Token 构造参数绑定 predicted Curve；
- EIP-1167 Gauge 若使用 initializer，必须和 clone 部署、Market 登记处于同一交易，中间无公开抢初始化窗口；
- LaunchLocker 必须由 GraduationExecutor 在毕业子调用中按静态 constructor init code 直接 CREATE2 部署，并在构造期一次冻结单一 marketId、poolId、prospective Position NFT tokenId 与 canonical currencies；不允许 initializer、公开 setter 或部署后重绑定；
- 目标地址已有代码、任一地址不匹配或任一初始化失败时整笔创建回滚；
- 不允许碰撞后自动换 nonce，否则前端签名地址与实际地址会不一致；
- `predictMarketAddresses` 与部署代码必须调用同一内部库；测试不得分别重写公式；
- Hook、GraduationExecutor、FeeVault 与 PoolManager 为 execution-spec 级共享不可变部署；Token/Curve/Gauge 是创建时的 per-market CREATE2 instance，LaunchLocker 是毕业时的 per-market CREATE2 instance。Hook 单独执行权限位 salt mining，并在 manifest 中冻结地址、salt、initCodeHash 和 runtime codehash。

固定 CREATE2 示例向量位于 [`spec/v1_pons_behavior_vectors.json`](../../spec/v1_pons_behavior_vectors.json)。

## 10. 必须持续成立的数学和状态不变量

1. 创建完成时 Curve 实际收到全量初始供应，且不存在后续 mint 权限。
2. `reservedTokens + initialSellableTokens == initialSupply`。
3. 曲线存续期间 `trackedTokens >= reservedTokens`；尾单不能卖穿该下限。
4. 强制转入 Curve 的 Quote/Meme 不改变 tracked pricing reserve、毕业进度或池初始价格。
5. 每笔买卖的 gross、fee、net、spent/refund 和储备变化逐整数单位守恒。
6. native 买入必须 `msg.value == quoteIn`；ERC-20 买入必须 `msg.value == 0` 并以实际 balance delta 为收到数量。
7. 未截断买入满足普通 `tokensOut >= minTokensOut`；截断尾单满足价格比例不等式。
8. 最终买入一旦使 `sellableTokens == 0`，必须在同一交易中成功提交 `PoolCreated`；若失败则整笔回滚，不存在可持续观察的 ready/pending 状态。
9. 计划金额满足 `poolQuoteAmount + lockedExcessQuote == sweptQuote` 与 `poolMemeAmount + lockedExcessMeme == sweptTokens`；四者均非负，且可建池时两种 pool amount 均大于0。LP mint 的整数舍入 dust 也必须转入同一永久 Locker。
10. `circulatingMeme + poolMemeAmount + lockedExcessMeme + burnedMeme == initialSupply`。
11. 唯一毕业迁移是 `NotGraduated -> PoolCreated`，且 `PoolCreated` 是终态。
12. Curve、Hook 任一已提交状态至多一个是 ACTIVE fee source；原子切换不产生持久的无来源阶段。
13. STOCK allocation 仅在 `PoolCreated` 后增加；毕业前累计手续费不得追溯给之后的质押者。
14. Quote/Meme 手续费按实际收费资产独立守恒，不跨资产估值、兑换或补洞。
15. `predictMarketAddresses` 的每个结果必须等于实际部署地址，且相同输入跨客户端得到相同结果。

## 11. 测试向量和上线门禁

机器向量至少覆盖：

- native 18 decimals 与 ERC-20 6/8/18 decimals 的供应分区一致性；
- `amountOut`、`amountIn`、基础 fee、反狙击 fee 和最小整数舍入；
- buy、sell、尾单部分成交、退款和部分成交价格滑点；
- `reservedTokens`、`poolQuoteAmount`、`poolMemeAmount`、`lockedExcessQuote`、`lockedExcessMeme` 的守恒关系；
- native/ERC-20 的创建费与 launch-and-buy `msg.value`；
- ERC-20 实际到账不足、decimals 变化、暂停和非标准 transfer；
- 自动毕业成功，以及 Pool 初始化、LP mint、Locker dust、Hook 激活或 Registry 提交失败时最终买入全回滚；
- CREATE2 Curve/Token/Gauge/LaunchLocker 固定地址；地址已有代码、deployer 或 initCodeHash 变化；
- TickerGarden 手续费差异和毕业后 STOCK Gauge 不改变 Pons 曲线输出。

以下仍是部署门禁，而不是产品方向未决：

1. 生产登记 STOCK 质押 Base 前使用 finalized-state RPC 重新验证官方 Asset UID、canonical token、decimals、状态及代理实现；Base 准入不读取 STOCK 价格，也不按 Feed 覆盖筛选；
2. 从最终 Solidity artifact 重新生成真实 ABI、selector、initCodeHash 和 CREATE2 向量；
3. 完成 Pons 参考许可审查、TickerGarden 独立审计和目标链 fork 验证；
4. 普通 ERC-20 Quote 上线前证明其为不可升级直接合约，并固定 runtime/implementation 指纹与零 EIP-1967 槽证据；官方 Stock Quote 上线前则必须实现并审计专用 Beacon/implementation 准入、价格参考生成器和真实资产行为测试；
5. 完成权限、监控、源代码可复现和法律门禁。

本基线随当前`V1-EXEC-10`保持`IMPLEMENTATION_ALLOWED / NOT_DEPLOYABLE`。反狙击runtime、管理员准入的 native/direct ERC-20 多 Quote 能力、通用数值域、原子毕业成功/失败语义、当前观测194项官方STOCK全量可选为质押Base、动态最低仓位、`S=0/S>0`固定质押者份额，以及 V1 Treasury 接口边界均已冻结。最终artifact/fork、目标链身份取证、安全审计、许可与法律仍约束部署和生产上线。
