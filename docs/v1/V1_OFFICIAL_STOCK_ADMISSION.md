# TickerGarden V1 官方 STOCK 准入与质押 Base 选择

> **状态边界（2026-09-04）：** 本文的 Asset `pause`/`unpause`/`retire` 仍然有效；它们是配置级准入控制，不是已部署市场的暂停权。市场永久自治，既有用户的 `rageQuit` 不依赖 Gauge、Indexer 或奖励清理，但本金到账仍以底层 STOCK token 转账成功且实际到账金额精确为前提；发行方暂停、黑名单规则或实现升级可能使该转账回滚。其余旧市场 Emergency 表述不代表当前目标实现。

> 规格状态：`FROZEN / DEPLOYMENT_ELIGIBLE`
> Execution spec：`V1-EXEC-11`
> 点时证据：2026-09-02，Robinhood Chain `4663`
> Stock Vault 架构决策：[V1_MULTI_ASSET_STOCK_VAULT.md](./V1_MULTI_ASSET_STOCK_VAULT.md)

## 1. 已确认的产品规则

TickerGarden 不人为缩小“质押 Base”资产范围。Robinhood 官方 Stock Token 目录中存在 chainId `4663` canonical deployment 的每个资产，都属于 TickerGarden 可准入 STOCK Base 范围。Asset UID 是主身份；symbol、name、ISIN 和价格只用于展示，不能替代身份。Quote 是风险更高的独立资格：不会把全量 Base 自动转为 Quote，只允许少量通过流动性、合约行为和价格参考门禁的 Stock Token 进入追加式 Quote allowlist。

2026-09-02 的点时观测返回194个资产，194个 UID 和 token 地址均唯一，全部为 `ASSET_STATUS_ACTIVE`、18 decimals；同一固定区块上的 `uid()`、`decimals()`、proxy runtime、共享 Beacon 和当前 implementation 指纹检查全部通过。当前194个资产全部可以登记并由市场创建者选择为质押 Base。194只是本次观测数量，不是协议上限；Robinhood 后续新增的官方资产可按同一规则追加。

机器证据见 [`spec/v1_rh_official_stock_catalog.snapshot.json`](../../spec/v1_rh_official_stock_catalog.snapshot.json)，原始官方响应归档见 [`spec/v1_rh_official_stock_catalog.source.json`](../../spec/v1_rh_official_stock_catalog.source.json)，可复跑生成器见 [`spec/generate_v1_rh_stock_catalog.py`](../../spec/generate_v1_rh_stock_catalog.py)。当前快照是点时观测；生产登记前仍须在 finalized 区块重新验证身份和代理实现，但这属于部署取证，不是价格门禁，也不阻塞实现。

链上合约不直接验证 Robinhood 发行方签名，也不调用官方目录；“官方”是治理根据已归档目录与 finalized 链上证据写入 `OfficialStockRegistryV1` 的证明语义。专用 Quote 路径能强制绑定该 Registry 中的 UID、canonical Token、Beacon 与 implementation 指纹，但不能把管理员误登记的任意代理资产在密码学上变成 Robinhood 官方资产。因此生产登记必须保留独立复核、延迟执行和可审计证据，不能只依赖 symbol/name 或管理员口头声明。

## 2. 市场如何选择 STOCK Base

1. 创建 Meme 市场时，创建者必须从 `OfficialStockRegistryV1` 当前 ACTIVE 的资产中选择一个 `assetUid`。
2. 一个市场恰好绑定一个官方 STOCK Base；绑定在创建后不可修改。
3. 同一个官方 STOCK 可以成为任意多个 Meme 市场的 Base。
4. STOCK 持有人在市场 `PoolCreated` 后，自行决定是否把该 STOCK 分配到某个匹配市场，以及分配多少。
5. 用户只能向 Base `assetUid` 相同的市场分配该 STOCK；不能用另一种 STOCK 参与该市场，也不能把市场改绑到另一资产。
6. 一个 Asset UID 只绑定一个 canonical `UserStockVault`，但多个 UID 共享当前 schema 的同一 MultiAsset Vault；每个 Meme 市场对应一个 Gauge。Gauge 只记录权重，不托管 STOCK 本金。

Factory 的 `CreateMarketParams.assetUid` 已是这一选择的唯一字段，不再增加第二个 `stakingBaseAssetUid`，避免同一市场出现两套身份。MarketConfig 必须永久快照 `assetUid`，并可通过 OfficialStockRegistry 唯一解析 canonical Stock Token、decimals、Vault 和动态 `minimumAllocation`。该最低 allocation 不是创建者输入，且不得低于协议安全下限414 raw units。

## 3. STOCK 作为质押 Base 不需要价格

STOCK 在 V1 中只承担质押 Base、分配权重和社区背书作用，不是 Meme Token 的抵押品，也不决定 Meme 曲线价格、毕业门槛、LP 初始价格或赎回价值。因此协议明确不使用：

- STOCK/USD 价格；
- USD 名义目标；
- `backingTargetStock` 或 `backingTargetConfigId`；
- Chainlink STOCK Price Feed；
- 为 STOCK 质押而设置的 Sequencer Uptime Feed；
- 任何按 STOCK 价格换算手续费或权重的逻辑。

链上只使用 Stock Token 的实际 raw balance 与 decimals。每个 Asset UID 的 `minimumAllocation` 由管理员动态设置，但不得低于414 raw units；手续费权重使用同一 Gauge 内各用户已激活 STOCK 的相对比例。存在 Active stake 时按 Creator40%/Staker30%/Platform30% 分配，无 Active stake 时按 Creator70%/Staker0%/Platform30% 分配。Quote 侧手续费按 Quote 分，Meme 侧手续费按 Meme 分，不转换成 STOCK，也不进行美元净额结算。

此前生成的 Chainlink 目录和 backing-target 工具仅保留为 `V1-EXEC-1` 历史研究证据，不是当前 `V1-EXEC-11` 的质押 Base 协议输入、准入条件或部署门禁；边界见 [`spec/RETIRED_STOCK_PRICE_RESEARCH.md`](../../spec/RETIRED_STOCK_PRICE_RESEARCH.md)。

### 3.1 Stock Token 作为 Quote 时的创建参考

如果某个官方 Stock Token 另行通过 Quote 审查，Robinhood 官方链下 API 可以用于“生成 Quote config 与创建页面估值”，但不能进入链上结算信任路径：

- `/rhj/assets` 提供 Asset UID、chain `4663` canonical 地址、状态和 `currentMultiplier`；
- `/rhj/prices/{symbol}` 提供底层股票 USD `bid/ask`、`generatedAt` 与 `isTradingHalt`，其价格尚未包含 multiplier；
- REST Token 参考价 = 底层股票价格 × `currentMultiplier`；
- Robinhood Chain Chainlink Feed 已返回每枚 Stock Token 的 multiplier-adjusted 价格，不能再次乘 multiplier；
- API 与 Chainlink 只生成/校验一次版本化 raw 参数；市场创建后不会根据股价或 multiplier 变化修改曲线或毕业门槛。

停牌、陈旧报价、pending multiplier、进行中的公司行动、Oracle/Sequencer 异常或 REST/Chainlink 偏差超限时必须停止生成新 config。API 的底层股票成交量不能证明链上 Stock Token 流动性，Quote allowlist 仍需 DEX/RFQ 深度和真实 swap simulation。详见 [`V1_STOCK_QUOTE_PRICE_REFERENCE.md`](./V1_STOCK_QUOTE_PRICE_REFERENCE.md)。

## 4. 毕业后手续费分配

毕业后总协议手续费维持 1%，LP 协议手续费为 0%，Hook 将全部手续费统一转入 FeeVault。存在 Active staker 时按 Creator 40% / Staker 30% / Platform 30% 分配；不存在 Active staker 时按 Creator 70% / Staker 0% / Platform 30% 分配。Staker 与 Platform 份额向下取整，整数余数归 Creator。canonical LP 仍永久锁定，但不获得协议 LP 手续费。取消 donate 与 LaunchLocker collect/compound 路径，可消除即时池价复投/JIT 风险并降低 gas 与 keeper 运维成本。

每笔交易的1%协议手续费全部进入 FeeVault。令 `T` 为实际手续费，`S` 为本次费用入账前、已处理30秒成熟队列后的 `totalActiveStock`：

```text
minimumAllocation = OfficialStockRegistry.minimumAllocation(assetUid) >= 414 raw units
Staker = 0                         if S == 0
         floor(T × 30 / 100)       if S > 0
Platform = floor(T × 30 / 100)
Creator = T - Staker - Platform
```

`S=0` 时为70/0/30/0；`S>0` 时为40/30/30/0。质押者 Bucket 按费用发生时各用户的 `userActiveStock/S` 分配，不设置总质押量饱和点或线性释放。新分配在30秒激活前不参与；增加仓位不会获得历史手续费；24小时锁定从本次 allocation 交易开始计算。每种收费资产使用独立 accumulator 和 remainder，最终整数余数确定性归 Creator。

## 5. 身份、状态与异常处理

身份取证顺序固定为：

1. 从 Robinhood 官方目录取得 Asset UID、chainId、canonical token 和 decimals，并归档原始响应；
2. 在同一个固定区块验证 token 有代码、`uid()` 与目录 UID 一致、`decimals()` 与目录一致；
3. 识别代理结构并固定 Beacon、implementation 与 runtime codehash；
4. 生产登记使用可读取 finalized 历史状态的 RPC 重做上述检查；
5. 把 finalized 区块取证结果编码为 `StockTokenFingerprint`：token runtime codehash、不可变 Beacon 地址与 codehash、当前 implementation 地址与 codehash；
6. 通过48小时延迟的 `PROTOCOL_ADMIN_ROLE` 逐资产调用 `registerAsset(bytes32,address,uint8,address,uint256,StockTokenFingerprint)`；Registry 在执行时重新调用 `uid()`/`decimals()`、解析 Robinhood immutable-beacon runtime，并把链上实测指纹与治理已排队的 calldata 逐字段比较。延迟窗口内任一代码或实现变化都会令登记回滚；声明为 direct token 的 runtime 若包含可执行的 `DELEGATECALL`/`CALLCODE` 也会被拒绝，Beacon 与 implementation 自身同样不得再嵌套未监控代理，避免升级层级逃出指纹边界；
7. Registry 成为合约运行时唯一准入来源，合约不调用 HTTP 或价格服务。

真实 Fork 暴露了一个字节码扫描边界：Solidity 的 CBOR auxiliary metadata 可能偶然包含原始 `0xf2/0xf4` 字节，不能把它们误判为可执行 `CALLCODE/DELEGATECALL`。当前扫描器会跳过 PUSH immediate，并且只在“有效 CBOR 长度/前缀 + `INVALID` 分隔 + 后缀不含原始 `JUMPDEST`”同时成立时排除 metadata；完整 runtime codehash 仍按全字节钉死。任何位于可执行区、可能被跳入的后缀或无法严格识别的字节仍按 fail-closed 拒绝。对应测试同时覆盖 metadata-only、真实可执行 opcode 与 jumpable suffix。

登记后，`assetIdentityCurrent(assetUid)` 会持续比较 token runtime、`uid()`、`decimals()`、Beacon runtime、Beacon 当前 implementation 以及 implementation runtime。Factory 创建市场、Vault 新存款和 AllocationManager 新增仓位都执行该门禁；任一漂移立即 fail closed，但只读 canonical identity 仍保留，因此既有用户的普通退出和 `rageQuit` 不被这个准入门禁拦截。该门禁独立于底层 token 自身的转账控制；若发行方暂停转账、命中黑名单或升级后的实现拒绝/改变转账行为，`rageQuit` 的精确转账检查仍会回滚本次退出。

合法 Beacon 升级必须先由 Guardian 将资产置为 `PAUSED`，再由48小时延迟的治理调用 `acceptAssetImplementation(assetUid,newImplementation,newCodeHash,reasonHash)` 接受经过审计的新实现，最后才可走独立的延迟 unpause。该函数只允许更新 implementation 指纹；token runtime、Beacon 地址或 Beacon runtime 发生变化时不能“原地接受”，只能保持停止新增敞口并退役/重新准入。Indexer/运维应监听 Beacon `Upgraded` 并周期性读取 `assetIdentityCurrent`，告警不具有自动恢复权限。

状态处理：

- ACTIVE 且身份/代码检查通过：允许创建新市场并在已毕业匹配市场新增 allocation；
- 官方状态变为 INACTIVE、UID/token/decimals 不匹配或代理实现发生未经复核的漂移：暂停该资产的新市场和新 allocation；
- 暂停或退役不得改变既有市场的 STOCK Base，也不得因该配置状态阻塞历史 Creator/Platform claim、成熟 pending、到期释放或用户 STOCK 本金退出；但用户退出仍依赖底层 STOCK token 转账成功且精确到账，发行方暂停、黑名单或实现升级可能使转账回滚。Staker 正常 claim 仍须满足24小时 `unlockAt`，锁定期内可选择放弃收益的 `rageQuit`；
- 恢复必须重新取证并走既定延迟，Indexer、后端和前端不能自行恢复。

## 6. 不变量

- 194个当前观测 ACTIVE 官方资产全部具有同等“质押 Base”产品准入资格，Feed 覆盖和价格不能缩小该 Base 集合；Quote 资格是独立的小范围 allowlist。
- 每个市场恰好一个 Base Asset UID，并在创建后不可变。
- 同一 Asset UID 可以对应任意多个市场；用户可在这些市场间自行分配。
- `VaultBalance = FreeBalance + TotalAllocated` 且 `TotalAllocated <= VaultBalance`。
- 单个非零用户市场仓位必须达到当前 Asset UID 的 `minimumAllocation`，且该值不得低于414 raw units。
- 曲线阶段不能质押；只有 `PoolCreated + ACTIVE` 才能新增或增加 allocation。allocation 不能部分减仓或跨市场迁移，退出只能整仓执行。
- 30秒前的 pending 不进入 `S`；费用只归发生时已激活的仓位。
- STOCK 本金退出路径不依赖 Gauge、Indexer、后端、Oracle 或价格 Feed 在线，也不等待奖励清理；成功与否仍取决于底层 STOCK token 转账成功且 Vault 减少量、用户增加量精确等于本金。发行方暂停、黑名单规则或实现升级导致的转账失败会使整笔退出回滚。
- 对每个 Asset UID 独立满足 `actual token balance of Vault >= totalDeposited(assetUid)`；任何入账/出账 Token 行为不能形成部分账本更新。fee-on-transfer、异常返回、正向余额漂移等非精确 transfer 必须整体回滚，不能被当作可支持资产。
- 手续费按实际收费资产原币种守恒；存在 Active stake 时按 Creator40%/Staker30%/Platform30% 分配，无 Active stake 时按 Creator70%/Staker0%/Platform30% 分配，再按用户 active STOCK 比例分配。无 Active stake 时 Staker 为0。

## 7. 当前工程状态

`V1-C-102-A` 已实现 `OfficialStockRegistryV1`：Asset UID 与 canonical Stock Token 保持 write-once；每个 UID 的 Vault 绑定也保持 write-once，但不再要求 Vault 地址对 UID 反向唯一。Registry 通过 `vaultIdentity()` 登记 schema 与不可变依赖，并以 `vaultForSchema` 强制每个 schema 只有一个 canonical Vault。Registry 冻结经通用数值证明的6–18 decimals，并把 `uid()`、decimals、token/Beacon/implementation codehash 以及 immutable-beacon 绑定纳入链上准入和运行时健康门禁；经过延迟治理确认的升级只能替换 implementation 指纹。测试明确覆盖真实 OpenZeppelin BeaconProxy 漂移、第195项登记和漂移期间 rageQuit 本金不受阻，协议没有194硬上限。

上述完成状态同时覆盖质押 Base runtime 与 BeaconProxy Stock Quote 专用 admission runtime。`V1-EXEC-11` 的通用 Quote Registry 已允许管理员追加 native 或 direct immutable ERC-20，并由市场创建者从 `ACTIVE` 白名单中选择；native 只是 bootstrap 示例。Stock Quote 的 Asset UID、canonical Token、Beacon/implementation 指纹绑定、身份漂移 fail-closed、部署 preflight 与真实代理 fixed-block Fork 均已验证。194 个 Base 不自动成为 Quote，激活状态为 `NO_ACTIVE_CONFIG`。确定性价格配置生成器、价格证据/产品参数和有限 allowlist 属于 `PENDING_PRODUCT_ACTIVATION`；实际部署后 finalized 复核、审计、法律签字和72小时灰度属于广播后或 production gates。
