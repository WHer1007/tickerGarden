# TickerGarden V2 官方 STOCK 准入与质押 Base 选择

> 规格状态：`FROZEN / IMPLEMENTATION_ALLOWED`  
> Execution spec：`V2-EXEC-5`
> 点时证据：2026-09-02，Robinhood Chain `4663`
> Stock Vault 架构决策：[V2_MULTI_ASSET_STOCK_VAULT.md](./V2_MULTI_ASSET_STOCK_VAULT.md)

## 1. 已确认的产品规则

TickerGarden 不维护一份人为挑选的“首批 STOCK 白名单”。Robinhood 官方 Stock Token 目录中存在 chainId `4663` canonical deployment 的每个资产，都属于 TickerGarden 可准入 STOCK 范围。Asset UID 是主身份；symbol、name、ISIN 和价格只用于展示，不能替代身份。

2026-09-02 的点时观测返回194个资产，194个 UID 和 token 地址均唯一，全部为 `ASSET_STATUS_ACTIVE`、18 decimals；同一固定区块上的 `uid()`、`decimals()`、proxy runtime、共享 Beacon 和当前 implementation 指纹检查全部通过。当前194个资产全部可以登记并由市场创建者选择为质押 Base。194只是本次观测数量，不是协议上限；Robinhood 后续新增的官方资产可按同一规则追加。

机器证据见 [`spec/v2_rh_official_stock_catalog.snapshot.json`](./spec/v2_rh_official_stock_catalog.snapshot.json)，原始官方响应归档见 [`spec/v2_rh_official_stock_catalog.source.json`](./spec/v2_rh_official_stock_catalog.source.json)，可复跑生成器见 [`spec/generate_v2_rh_stock_catalog.py`](./spec/generate_v2_rh_stock_catalog.py)。当前快照是点时观测；生产登记前仍须在 finalized 区块重新验证身份和代理实现，但这属于部署取证，不是价格门禁，也不阻塞实现。

## 2. 市场如何选择 STOCK Base

1. 创建 Meme 市场时，创建者必须从 `OfficialStockRegistryV2` 当前 ACTIVE 的资产中选择一个 `assetUid`。
2. 一个市场恰好绑定一个官方 STOCK Base；绑定在创建后不可修改。
3. 同一个官方 STOCK 可以成为任意多个 Meme 市场的 Base。
4. STOCK 持有人在市场 `PoolCreated` 后，自行决定是否把该 STOCK 分配到某个匹配市场，以及分配多少。
5. 用户只能向 Base `assetUid` 相同的市场分配该 STOCK；不能用另一种 STOCK 参与该市场，也不能把市场改绑到另一资产。
6. 一个 Asset UID 只绑定一个 canonical `UserStockVault`，但多个 UID 共享当前 schema 的同一 MultiAsset Vault；每个 Meme 市场对应一个 Gauge。Gauge 只记录权重，不托管 STOCK 本金。

Factory 的 `CreateMarketParams.assetUid` 已是这一选择的唯一字段，不再增加第二个 `stakingBaseAssetUid`，避免同一市场出现两套身份。MarketConfig 必须永久快照 `assetUid`，并可通过 OfficialStockRegistry 唯一解析 canonical Stock Token、decimals、Vault 和动态 `minimumAllocation`。该最低 allocation 不是创建者输入，且不得低于协议安全下限414 raw units。

## 3. STOCK 不需要价格

STOCK 在 V2 中只承担质押 Base、分配权重和社区背书作用，不是 Meme Token 的抵押品，也不决定 Meme 曲线价格、毕业门槛、LP 初始价格或赎回价值。因此协议明确不使用：

- STOCK/USD 价格；
- USD 名义目标；
- `backingTargetStock` 或 `backingTargetConfigId`；
- Chainlink STOCK Price Feed；
- 为 STOCK 质押而设置的 Sequencer Uptime Feed；
- 任何按 STOCK 价格换算手续费或权重的逻辑。

链上只使用 Stock Token 的实际 raw balance 与 decimals。每个 Asset UID 的 `minimumAllocation` 由管理员动态设置，但不得低于414 raw units；手续费权重使用同一 Gauge 内各用户已激活 STOCK 的相对比例。只要存在 Active stake，Staker 固定取得 non-LP 的50%。Quote 侧手续费按 Quote 分，Meme 侧手续费按 Meme 分，不转换成 STOCK，也不进行美元净额结算。

此前生成的 Chainlink 目录和 backing-target 工具仅保留为 `V2-EXEC-1` 历史研究证据，不是当前 `V2-EXEC-5` 的协议输入、准入条件或部署门禁；边界见 [`spec/RETIRED_STOCK_PRICE_RESEARCH.md`](./spec/RETIRED_STOCK_PRICE_RESEARCH.md)。

## 4. 毕业后手续费分配

每笔交易先按总费用的20%分给 LP。令 `D` 为其余80%的实际到账 non-LP fee，`S` 为本次费用入账前、已处理30秒成熟队列后的 `totalActiveStock`：

```text
minimumAllocation = OfficialStockRegistry.minimumAllocation(assetUid) >= 414 raw units
Staker = 0                         if S == 0
         floor(D × 50 / 100)       if S > 0
remaining = D - Staker
Creator = floor(remaining / 2)
Platform = remaining - Creator
```

`S=0` 时总费近似40/0/40/20；`S>0` 时固定达到20/40/20/20。质押者 Bucket 按费用发生时各用户的 `userActiveStock/S` 分配，不设置总质押量饱和点或线性释放。新分配在30秒激活前不参与；增加仓位不会获得历史手续费；24小时锁定从本次 allocation 交易开始计算。每种收费资产使用独立 accumulator 和 remainder，最终整数余数确定性归 Platform。

## 5. 身份、状态与异常处理

身份取证顺序固定为：

1. 从 Robinhood 官方目录取得 Asset UID、chainId、canonical token 和 decimals，并归档原始响应；
2. 在同一个固定区块验证 token 有代码、`uid()` 与目录 UID 一致、`decimals()` 与目录一致；
3. 识别代理结构并固定 Beacon、implementation 与 runtime codehash；
4. 生产登记使用可读取 finalized 历史状态的 RPC 重做上述检查；
5. 通过48小时延迟的 `PROTOCOL_ADMIN_ROLE` 逐资产调用 `registerAsset(bytes32,address,uint8,address,uint256)`，最后一个参数设置该资产初始 `minimumAllocation`；
6. Registry 成为合约运行时唯一准入来源，合约不调用 HTTP 或价格服务。

状态处理：

- ACTIVE 且身份/代码检查通过：允许创建新市场并在已毕业匹配市场新增 allocation；
- 官方状态变为 INACTIVE、UID/token/decimals 不匹配或代理实现发生未经复核的漂移：暂停该资产的新市场和新 allocation；
- 暂停或退役不得改变既有市场的 STOCK Base，也不得阻塞历史 Creator/Platform claim、成熟 pending、到期释放或用户 STOCK 本金退出；Staker 正常 claim 仍须满足24小时 `unlockAt`，锁定期内可选择放弃收益的 `rageQuit`；
- 恢复必须重新取证并走既定延迟，Indexer、后端和前端不能自行恢复。

## 6. 不变量

- 194个当前观测 ACTIVE 官方资产全部具有同等产品准入资格，Feed 覆盖和价格不能缩小该集合。
- 每个市场恰好一个 Base Asset UID，并在创建后不可变。
- 同一 Asset UID 可以对应任意多个市场；用户可在这些市场间自行分配。
- `VaultBalance = FreeBalance + TotalAllocated` 且 `TotalAllocated <= VaultBalance`。
- 单个非零用户市场仓位必须达到当前 Asset UID 的 `minimumAllocation`，且该值不得低于414 raw units。
- 曲线阶段不能质押；只有 `PoolCreated + ACTIVE` 才能新增或增加 allocation。allocation 不能部分减仓或跨市场迁移，退出只能整仓执行。
- 30秒前的 pending 不进入 `S`；费用只归发生时已激活的仓位。
- STOCK 本金安全不依赖 Gauge、Indexer、后端、Oracle 或价格 Feed 在线。
- 手续费按实际收费资产原币种守恒；只要存在 Active stake，Staker 固定取得 non-LP 的50%，再按用户 active STOCK 比例分配。无 Active stake 时 Staker 为0。

## 7. 当前工程状态

`V2-C-102-A` 已实现 `OfficialStockRegistryV2`：Asset UID 与 canonical Stock Token 保持 write-once；每个 UID 的 Vault 绑定也保持 write-once，但不再要求 Vault 地址对 UID 反向唯一。Registry 通过 `vaultIdentity()` 登记 schema 与不可变依赖，并以 `vaultForSchema` 强制每个 schema 只有一个 canonical Vault。Registry 冻结经通用数值证明的6–18 decimals，并通过 immutable AccessManager 执行追加登记和 `ACTIVE <-> PAUSED -> RETIRED` 状态迁移；测试明确覆盖第195项登记，协议没有194硬上限。当前状态仍是 `IMPLEMENTATION_ALLOWED`，不等于允许部署：目标链 finalized 身份/代理指纹重取、最终权限 diff、Fork/E2E、审计、法律签字和72小时灰度仍是后续硬门禁。
