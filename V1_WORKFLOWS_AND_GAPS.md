# TickerGarden V1 端到端链路与缺口

> 文档状态：V1 编码前评审清单  
> 更新时间：2026-09-02  
> 协议参数：参见 [V1_PROTOCOL_PARAMETERS.md](./V1_PROTOCOL_PARAMETERS.md)  
> 技术架构：参见 [TECHNICAL_ARCHITECTURE.md](./TECHNICAL_ARCHITECTURE.md)

本文将当前项目拆成可核对的端到端链路，并区分“已经确定的产品规则”和“尚未冻结的实现参数”。尚待确定的内容不能在编码时由开发者自行假设。

正式用户侧类别为 **Ticker Meme**。本文件仍出现的 `mStock` 只表示 Ticker Meme Token 的旧技术占位名，不是强制 Symbol。V1 官方结算资产已经固定为 RH canonical-bridge USDC。

仓库当前仍处于“机制文档 + React/Vite 页面原型”阶段；以下链路是 V1 目标设计，不表示对应智能合约、Worker、索引器或真实钱包交互已经实现。

## 1. 当前已经确定的边界

| 主题 | V1 决策 |
|---|---|
| 链 | 仅 Robinhood Chain；BSC 和跨链属于 V2 |
| 市场身份 | 一个 Registry 认证的 Asset UID 对应一个 canonical Ticker Meme 市场；身份按 `marketId` 与合约地址识别 |
| 市场创建 | 对白名单资产无许可创建；创建者设置 3–8 位初始 Symbol，但不获得增发或资金处置特权 |
| Ticker Meme 命名 | 用户侧类别固定为 Ticker Meme；社区拥有一次永久有效的最终命名权，成功执行后永久冻结 |
| 官方市场 | 每个 Ticker Meme 一个 canonical Uniswap v4 PoolKey |
| 结算资产 | RH canonical-bridge USDC；主网地址 `0x80e0e24718dbfcad49ecaa6f1e6c89a190586ca8` |
| 初始价格 | 首个 LP 用户无许可决定，协议不锚定股票价格 |
| LP 挖矿模型 | 非托管 `CanonicalLPNFTGauge` 实现 Uniswap v4 `ISubscriber`；NFT 留在用户钱包，不使用 Vault/tgLP |
| LP 计奖范围 | 只奖励 canonical PoolId 的精确全区间仓位，按 liquidity × 有效订阅时间计奖 |
| LP Stock Token 要求 | 无；LP NFT 通过仓位校验后可直接订阅，不读取股票质押余额 |
| RH v4 支持 | 主网 4663 已有 Uniswap 官方 PoolManager 与支持 Subscriber 的 PositionManager |
| RH 测试网 | RH 网络 46630 可用，但截至 2026-09-01 尚无 Uniswap 官方 v4 部署清单 |
| 首发 Stock Token | NVDA；部署前仍须完成 Asset UID、canonical 地址、代码、multiplier、Feed 与公司行动 manifest 校验 |
| Ticker Meme 最大供应 | 创建者只能从 10 亿、100 亿或 1000 亿三档选择；部署后不可修改 |
| Ticker Meme Token 排放窗口 | `block.timestamp`；股票池 1460 天，LP 延迟 7 天并共享终点；初始 1.5 倍平均速率线性衰减至 0.5 倍，无尾部；精确起点写入 launch manifest |
| 排放期末 | 48 个月结束后未进入 PoolReleased 的额度永久取消；截止前已赚取未领取权益仍可 claim |
| 股票池 / LP 池预算 | 总挖矿额度固定为 70% / 30% |
| 股票池软门槛 | 10,000 美元对应的 Stock Token 整数数量；任意非零数量可质押，释放系数最高为 1 |
| LP 排放起点 | 股票池开始 7 天后；与股票池共享最终截止时间 |
| 首笔 LP | 实际到账至少 500 USDC、非零 Ticker Meme、非零 canonical 全区间 liquidity |
| Swap 手续费 | 产品目标为输入侧 1%、LP/协议约 60%/40%；P-003 发现原生 v4 顺序收费下严格 0.60% + 0.40% 只得到 0.9976%，最终整数公式待 G0-07 签字 |
| 买入侧协议费 | 40% 购买对应 Stock Token、40% 回购销毁 TGARD、20% 协议收入 |
| 卖出侧协议费 | 100% 进入对应市场的 Token Burn Bucket，之后异步销毁 |
| 执行时机 | Hook 只收费和记账；回购、销毁与划拨在用户交易之后异步执行 |
| TGARD | 回购销毁必须在 V1 实现，不能延后 |
| 股票国库 | 每个市场一个独立 `StockTreasuryVault`，与 Ticker Meme Token 合约分离 |
| Token 销毁 | 只降低 `totalSupply`，不降低 `MintedSupply`，不恢复排放额度 |
| 挖矿奖励领取 | 20% 立即到账，80% 自领取时起在 56 天内线性释放 |
| 解除质押与归属奖励 | 不罚没、不加速、不重新分配；继续按原时间表释放 |
| 状态权威 | 合约是余额、奖励、供应量、市场和国库状态的唯一权威来源 |
| 网站架构 | Web 与 Backend API 独立部署；数据库聚合数据走 API，钱包/RH RPC/canonical v4 等公开无特权服务可由前端直连 |

P-002 已形成预算、排放曲线、10,000 美元门槛快照/取整、remainder-safe 奖励会计、RewardEscrow 和 Bucket 状态机参考规格，等待产品与安全签字；LP Subscriber 最终 ABI/事件与 Gas 边界、测试网 v4/USDC fixture、TGARD 地址与回购路径、执行风控参数和治理角色仍未确定，详见第 4 节。

## 2. 系统链路总览

```text
OfficialStockRegistry
        │ 认证 Stock Token / Asset UID
        ▼
TickerGardenFactory
        ├── TickerMemeToken + 初始 Symbol
        ├── NamingGovernor / NamingExecutor
        ├── StockStakingGauge
        ├── CanonicalLPNFTGauge（ISubscriber）
        ├── 该市场专用 RewardEscrow
        ├── canonical Uniswap v4 PoolKey + Hook
        ├── PermissionlessInitializer
        └── 独立 StockTreasuryVault

用户质押 Stock Token ──▶ StockStakingGauge ──▶ 领取：20% 用户 / 80% RewardEscrow
用户持有官方 LP NFT ──PositionManager.subscribe──▶ CanonicalLPNFTGauge
                                                       └── 领取：20% 用户 / 80% RewardEscrow

用户 Swap ──▶ canonical Uniswap v4 Pool ──▶ TickerGardenV4Hook
                                                   │ 0.40% 协议费分类记账
                                                   ▼
                                           ProtocolFeeVault
                                                   ▲
                                                   │ 受约束地消费 Bucket
外部 Execution Worker ──报价/模拟/提交──▶ FeeExecutor
                                                   ├── Stock Token 直达 StockTreasuryVault
                                                   ├── TGARD 回购并销毁
                                                   ├── Ticker Meme Token 直接销毁
                                                   └── 协议收入划至 ProtocolTreasury

所有链上事件 ──▶ Ponder ──▶ PostgreSQL ──▶ Backend API ──▶ Web 读取
                                              └──────────────▶ 运营监控
```

外部 Worker 是异步触发器，不是资产托管人，也不是用户 Swap、领取、解除股票质押、取消 LP 订阅或操作 LP NFT 的依赖。Worker 停机时，未执行资产继续留在 `ProtocolFeeVault`。

网站采用前后端分离，但不做全流量代理：Web 通过独立 Backend API 获取协议历史、内部元数据和数据库聚合读模型，不直接访问 Ponder 或 PostgreSQL；钱包 Provider、Robinhood RPC、canonical v4 Quoter/StateView 等可安全验证的公开链上服务由前端直连。合约写操作也由浏览器钱包本地模拟、签名并直接提交 Robinhood Chain。Backend API、Ponder 和 Execution Worker 独立部署且使用不同凭据。

## 3. 当前项目的端到端流程

### 3.1 股票资产登记

1. 管理角色将 Robinhood Chain 上的 canonical Stock Token 写入 `OfficialStockRegistry`。
2. Registry 记录合约地址、稳定 Asset UID 和资产状态；不保存用于 LP 奖励的 Stock Token 质押门槛。
3. 前端与 Factory 只按链 ID、合约地址和 Asset UID 识别资产，不按 ticker 或名称识别。

缺口：白名单管理者、审核标准、禁用与合约迁移流程尚未冻结。

### 3.2 创建 Ticker Meme 市场

1. 任意用户为已认证资产支付市场创建费并调用 `TickerGardenFactory`。
2. Factory 校验 Asset UID 未创建过市场。
3. 创建者提交 3–8 位英文字母初始 Symbol；Factory 统一转换为大写，并校验保留词及 Registry 中当前和历史 Symbol 的永久唯一性。
4. Factory 标准化部署或绑定 TickerMemeToken、股票质押池、非托管 `CanonicalLPNFTGauge`、该市场专用 RewardEscrow、命名治理、Hook、官方 PoolKey、Initializer 和该市场独立的 `StockTreasuryVault`。
5. Token 全称按 `<SYMBOL> — <STOCK_TICKER> Ticker Meme` 自动生成。
6. 市场进入 `REGISTERED`，此时 PoolKey 已确定，但价格和首笔流动性尚不存在。

缺口：创建费、部署方式、失败回滚细节、初始保留词清单和 Symbol 唯一性并发校验仍须形成最终合约规格。

#### 3.2.1 一次性社区最终命名

1. 社区最终命名权在市场创建后永久有效，不设置到期时间。
2. 任意满足提案条件的参与者可以提交新的 3–8 位 Symbol，或提议确认保留当前 Symbol；同一市场同时只允许一个活动提案。
3. 提案开始时记录历史投票权和已释放供应快照，投票权来自对应 Ticker Meme 的锁定或委托，不能采用一钱包一票。
4. 投票持续 7 天；参与率达到快照供应的 10%，且赞成票达到有效票三分之二时通过。
5. 通过后等待 7 天，由专用 NamingExecutor 执行；失败后进入 30 天冷却期。
6. 失败提案不消耗命名权。第一次成功执行会原子更新名称和 Symbol，并把 `metadataFinalized` 永久设为 `true`。
7. 改名不改变 Token 地址、余额、供应、Stock Token 映射、PoolKey、LP NFT、Gauge、RewardEscrow 或 Treasury；旧 Symbol 永久保留为历史别名，不能被其他市场复用。
8. 索引器记录旧 Symbol 别名，前端在 30–90 天过渡期显示 `NEW_SYMBOL（formerly OLD_SYMBOL）`。

### 3.3 Stock Token 质押与 Ticker Meme Token 排放

1. 用户将该市场的 canonical Stock Token 存入 `StockStakingGauge`。
2. Gauge 先更新全局累计奖励指数，再更新用户份额与 reward debt。
3. 用户随时间累计对应 Ticker Meme Token，并可单独发起领取或解除质押。
4. 股票质押余额变化只影响股票池，不调用 LP Gauge，也不改变 LP 订阅或 LP 奖励。
5. 所有铸造都消耗终身 `MintedSupply` 额度，必须满足 `MintedSupply <= MaximumSupply`。
6. 股票池允许任意非零数量质押；总质押低于 10,000 美元对应的 Stock Token 整数目标时，以 `min(totalStaked / targetStockAmount, 1)` 降低池级释放系数。
7. LP 池从股票池排放开始 7 天后启动，并与股票池使用同一最终截止时间。
8. 每次领取的 20% 立即进入用户钱包，80% 进入 RewardEscrow，并从该次领取时间起在 56 天内线性释放。
9. 进入 RewardEscrow 的 Token 已计入 `MintedSupply` 与 `totalSupply`；解除股票质押或 LP 停止计奖不影响既有归属。
10. 48 个月结束后尚未进入 `PoolReleased` 的股票池和 LP 池额度永久取消；截止前已赚取未领取权益仍可 claim，已经进入 RewardEscrow 的余额继续按原时间表释放。

数学规则已写入 `V1_MATH_AND_STATE_MACHINES.md`：`TotalMiningBudget = MaximumSupply`、18 decimals、按秒 1460/1453 天、平滑线性衰减、错过排放不追赶、门槛快照向上取整、`1e27` scaled 会计、7 天领取间隔与 8 槽 Escrow。仍须产品与安全签字，并由 launch manifest 冻结该市场精确起点。

### 3.4 官方池初始化与首笔流动性

1. Ticker Meme Token 已经有可流通余额后，任意用户调用 `PermissionlessInitializer`。
2. 同一笔交易原子执行 `initialize` 与首笔非零 canonical 全区间 `addLiquidity`。
3. 首笔必须实际到账至少 500 USDC、非零 Ticker Meme，并形成非零 liquidity；最低值按余额实际变化校验，不信任 `amountDesired`。
4. 调用者自行设置初始 Ticker Meme Token/USDC 价格，但首笔仓位区间固定为 canonical 全区间。
5. 初始化成功后市场进入 `INITIALIZED`，不能再次初始化。

缺口：500 USDC、非零双边资产、非零 liquidity 和 canonical 全区间已经确定；仍须冻结精确 PoolKey currency 排序、tick spacing、Ticker Meme 最低量、价格/tick 边界、deadline/slippage，以及防止初始化后同交易抽走流动性的规则。

### 3.5 买入 Ticker Meme Token

```text
用户输入 USDC
→ canonical Pool 执行买入
→ 从输入额结算 0.60% LP fee
→ Hook 收取 0.40% protocol fee
→ ProtocolFeeVault 内部记账：
   40% STOCK_BUYBACK
   40% TGARD_BUYBACK
   20% PROTOCOL_REVENUE
→ 剩余输入参与 Swap
→ 用户收到 Ticker Meme Token
```

整数拆分先计算两个 40% Bucket，剩余值归协议收入，确保该笔 0.40% 协议费完整守恒。

### 3.6 卖出 Ticker Meme Token

```text
用户输入 Ticker Meme Token
→ canonical Pool 执行卖出
→ 从输入额结算 0.60% LP fee
→ Hook 收取 0.40% protocol fee
→ 全部记入该市场 MSTOCK_BURN Bucket
→ 剩余输入参与 Swap
→ 用户收到 USDC
```

卖出侧协议费不参加 Stock Token 购买、TGARD 回购或协议收入分配，并且永远不得重新卖回市场。

### 3.7 手续费异步执行

1. Worker 从链上读取达到执行条件的 Bucket。
2. 对需要兑换的股票或 TGARD Bucket，只查询治理允许的 Router 和路径。
3. Worker 检查最小执行金额、时间间隔和额度，计算 `minAmountOut`、`deadline`，并先执行 `eth_call` 模拟。
4. Worker 提交 `FeeExecutor` 专用函数并等待确认。
5. `STOCK_BUYBACK` 的购买输出以对应 `StockTreasuryVault` 为直接接收者；不能经过 Worker 或中转钱包。
6. `TGARD_BUYBACK` 的输出在同一受约束流程中销毁。
7. `MSTOCK_BURN`（最终事件名待统一）直接销毁该市场 Ticker Meme Token；`PROTOCOL_REVENUE` 划至 `ProtocolTreasury`。
8. Worker 核对事件、Bucket 余额和目标余额，记录成功；失败则重试和告警。

任一步骤在链上失败都必须整体回滚，不能出现 Bucket 已扣减但购买资产未进入国库、代币未销毁或收入未到账的状态。

### 3.8 LP 提供、订阅与挖矿

1. 用户通过 canonical PositionManager 为 canonical Pool 创建 LP NFT；只有精确全区间仓位可以获得官方 LP 排放，其他区间仍可提供流动性和赚取手续费，但不计 Ticker Meme Token 奖励。
2. 用户在保留 NFT 所有权的情况下，直接调用 `PositionManager.subscribe(tokenId, CanonicalLPNFTGauge, data)`；不把 NFT 转入 Gauge，也不授权 Gauge 转移 NFT。
3. `notifySubscribe` 只接受 canonical PositionManager 调用，并从 PositionManager 读取 owner、PoolId、PoolKey、tick、liquidity 与 subscriber 状态，不信任 `data` 中的资格信息。
4. Gauge 只校验 canonical PoolId、TickerGarden Hook、精确全区间、`liquidity > 0` 和未重复登记；不读取 Stock Token 或股票池状态。
5. `notifyModifyLiquidity` 在加减仓时先按旧 liquidity 结算再更新用户聚合 liquidity；LP 手续费始终属于 NFT owner，不进入 Gauge，回调的 `feesAccrued` 也不参与奖励权重。
6. 用户可以在零 Stock Token 余额、未参与股票池或完全解除股票质押的情况下持续获得 LP 奖励。
7. 主动取消订阅、NFT 转移自动取消订阅或 burn 时，Gauge 先结算再停止计奖。NFT 始终在用户钱包，普通暂停不能阻止撤流动性、收取手续费或转移 NFT；若 modify/burn 回调异常，用户以足够 Gas 先 unsubscribe，再执行目标操作。
8. 未领取奖励仍归用户，之后领取时继续执行 20% 即时 / 80% 线性 56 天；已经进入 RewardEscrow 的奖励保持原归属计划。

缺口：LP 模型、全区间与 liquidity-time 计奖已经确定；仍须冻结 Gauge 最终 ABI/事件、Subscriber 回调 Gas 上界、permissionless `syncPosition` 的不一致处理、整数边界、普通暂停矩阵，以及 RH 测试网测试专用 v4 地址清单。

### 3.9 股票国库

1. 每个市场只有一个独立 `StockTreasuryVault`，只接收该市场对应的 canonical Stock Token。
2. Vault 与 Ticker Meme Token 合约分离；Token 不持有、不授权也不处置 Stock Token。
3. 国库不跨股票调拨，不用于 TGARD 回购、团队运营、借贷或第三方收益策略。
4. 国库不赋予 Ticker Meme Token 持有人股票所有权、抵押权或固定赎回权。

缺口：公司行动、资产迁移、退市、安全事故和协议终止时的受限处置规则尚未冻结。

### 3.10 索引、Backend API、前端与运维

1. Ponder 索引 Registry、Factory、质押、奖励、LP、Swap、四类 Bucket、回购、销毁、国库和权限事件。
2. 独立 Backend API 使用只读数据库账号查询 Ponder/PostgreSQL，并在必要时执行白名单化 RPC 交叉校验；它向 Web 提供版本化 REST/OpenAPI、游标分页、来源区块和索引同步状态。
3. Web 的协议历史、内部元数据和数据库聚合状态访问 Backend API，不直接访问 Ponder 或 PostgreSQL；钱包、RH RPC、canonical v4 Quoter/StateView 和链上合约只读调用可以直连，但必须使用 manifest 中的 chain ID/地址并处理超时与错误。
4. 合约交易通过 viem/wagmi 在浏览器模拟，由用户钱包签名并直接提交链上，不经过 Backend API 代签或中继。
5. Backend API 不保存用户私钥、不生成链上不存在的余额、不写入 Ponder 读模型，也不暴露 Worker 执行入口；API 故障不得改变链上状态或用户使用合约退出的能力。
6. 页面区分链上确认、公开 RPC/v4 数据源状态、Backend API 可用性和索引同步状态，并区分“已归集”“待执行”“执行中”“已完成”和“失败待重试”；待执行金额不得展示为已回购或已入国库。
7. 奖励页面区分 pending、20% 即时、80% 归属中、已解锁和完全解锁时间；`totalSupply` 包含 Escrow 余额，不能直接显示为可转让流通量。
8. LP 页面必须显示 NFT owner、PoolId、tick、liquidity、当前 subscriber、仓位校验和计奖状态，并把“订阅挖矿”与 NFT 转移授权明确区分；不能再根据 Stock Token 余额禁用订阅按钮。
9. 监控对 Backend API 错误率/延迟、索引高度、供应上限、Bucket 积压、Worker 停机、执行回滚、Subscriber 状态异常、RewardEscrow 余额、国库入账与链上/链下对账差异告警。

### 3.11 管理与紧急流程

1. Registry、参数、Keeper、Timelock 与紧急暂停角色分离。
2. 紧急暂停只覆盖必要的新增风险操作。
3. 用户解除股票质押、取消 LP 订阅、操作自己的 LP NFT 和领取已结算资产的路径不依赖管理员批准。
4. `releaseVested` 不受普通紧急暂停影响，已经解锁的 Ticker Meme Token 始终可以由用户提取。

P-005 已形成 3/5 Safe、48 小时 Timelock、独立 2/3 pause-only Guardian、7 天退休/国库迁移、Worker 专用权限及函数级退出矩阵，详见 `V1_PERMISSIONS_AND_PAUSE_MATRIX.md`；仍须产品/安全签字并提供真实地址、成员与密钥策略。

## 4. 缺失项与优先级

### 本轮复审结论

NFT Gauge/Subscriber 方案仍然成立：RH 主网具备官方 v4 PositionManager Subscriber 能力，V1 继续采用非托管、canonical PoolId、精确全区间和 raw liquidity-time 计奖，不改回 Vault、NFT Staker 托管或 tgLP。复审新增的是以下实现边界，不是新增产品功能：

| 复审发现 | 当前结论 |
|---|---|
| V1 结算资产 | 已固定为 RH canonical-bridge USDC；主网地址 `0x80e0e24718dbfcad49ecaa6f1e6c89a190586ca8`，6 decimals；不宣称为 Circle-native RH USDC |
| Ticker Meme 与 `mStock` 混用 | Ticker Meme 是正式用户侧类别；`mStock` 仅为旧技术占位，最终合约/接口/事件命名仍须冻结 |
| LP Stock Token 门槛 | 已取消；StockStakingGauge 与 LP Gauge 不再存在资格回调，零 Stock Token 余额也可直接订阅并持续计奖 |
| 供应与期末处理 | 已固定三档最大供应；48 个月结束后未释放额度永久取消，既得未领取权益保留 |
| Stock 软门槛 | 创建时按 multiplier-adjusted 官方 Feed 换算 10,000 美元，完整 Token 向上取整并冻结；P-002 待签字 |
| LP 启动 | 已固定为股票池开始 7 天后，并共享最终截止时间 |
| 首发资产 | 已固定为 NVDA；canonical manifest 细节仍须验证 |
| NFT 转移、回调失败与 `syncPosition` | 必须冻结历史 beneficiary、claim 收款人和 fail-closed 对账语义，不能把旧奖励自动转给新 owner |
| 首笔 LP 与全区间奖励规则 | 已固定实际到账至少 500 USDC、非零双边资产、非零 liquidity 和 canonical 全区间；其余 PoolKey/价格边界/原子回滚/同交易撤空仍须冻结 |
| Gauge 缺陷、版本迁移或市场退役 | 必须保留旧 claim/unsubscribe/sync 路径，并明确新旧 Gauge 的唯一计奖切点 |

这些项目需要的是少量、明确、有界的状态机和不变量，不授权增加通用执行器、自动做市、复杂治理或跨链占位代码。

### P0：开始合约编码前必须确定

1. **USDC 部署前校验**：主网固定使用 RH canonical-bridge USDC `0x80e0e24718dbfcad49ecaa6f1e6c89a190586ca8`；仍须冻结 runtime code hash、代理/升级风险接受标准、L1 USDC 映射、transfer/approve 行为、流动性下限和测试网 `USDC.e` fixture。不得按 Symbol 自动发现或替换资产。来源：[RH Protocol Contracts](https://docs.robinhood.com/chain/protocol-contracts/)、[RH Bridging](https://docs.robinhood.com/chain/bridging/)、[Circle USDC Addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses)。
2. **P-002 数学规格签字**：18 decimals、预算等于最大供应且无预挖、70%/30%、1460/1453 天、衰减曲线、错过排放、`PoolReleased/PoolMinted`、暂停经济语义、`1e27` remainder-safe 会计、7 天领取间隔和 8 槽 Escrow 已有可执行参考；仍须产品/安全签字，并在 launch manifest 固定股票池精确起点。
3. **Token 与 Stock Token 基础规格**：Ticker Meme Token 的 decimals、mint/burn、Permit、metadata、不可升级和最终技术命名；Stock Token 的 canonical 计量单位、公司行动倍率与迁移语义，并明确拒绝或适配 rebasing、fee-on-transfer、非标准返回、可暂停、可升级和 decimals 可变资产。Stock Token 适配不得重新成为 LP 资格条件。
4. **LP Subscriber ABI 与会计**：冻结 periphery commit、PositionManager code hash、最终 ABI/错误/事件、回调调用者校验、生命周期结算顺序、多 NFT O(1) 聚合、reward debt、精度、溢出边界，以及 300,000 `unsubscribeGasLimit` 下更低的内部 Gas 安全预算。
5. **LP beneficiary、claim 与 `syncPosition`**：冻结订阅 owner/beneficiary 快照、NFT 转移前后的历史奖励归属、按用户还是按 tokenId 领取、claim-for 权限和固定收款人；`syncPosition` 必须 permissionless、幂等、O(1)，并明确不一致时的奖励截止点、只停止未来计奖还是还能结算、不得自动改写历史受益人。零 liquidity、重新加仓、burn tombstone 和重复回调也须定义。
6. **Gauge 暂停、逃生与迁移**：逐项定义 subscribe、accrual、claim、modify、unsubscribe、transfer、burn、fee collect、sync 和 `releaseVested` 的暂停行为；Gauge 不采用可升级代理。新版本部署时旧 Gauge 只关闭新订阅，仍保留 claim/unsubscribe/sync，用户自行迁移 NFT，并冻结旧结算点与新起算点，禁止双重计奖。
7. **PoolKey 与 Hook 会计**：P-003 已推荐 V1 只支持 exact-input，并证明严格 gross 0.40% Hook fee 与原生 0.60% LP fee 的组合为 0.9976%；仍须在“精确 1% + remainder 协议费（约 gross 0.402414%）”与“严格 0.40% 协议费 + 0.9976% 总费”之间签字，并冻结 currency 排序、fee 数值/动态标记、tickSpacing、Hook 权限位、PoolId、极小额舍入、部分成交和 `minAmountOut` 公式。
8. **首笔 LP 安全**：实际到账 500 USDC、非零 Ticker Meme、非零 liquidity 和 canonical 全区间已经确定；仍须冻结 `sqrtPriceX96`/tick 边界、Ticker Meme 最低量、deadline、slippage、失败原子回滚和同交易撤空防护，以及市场长期未初始化时的状态处理。
9. **TGARD 基础信息**：canonical 合约、供应与铸造权限、可验证销毁接口、官方流动性池、允许 Router/完整路径、最低流动性、报价和滑点保护。TGARD 回购销毁是 V1 必备，因此不能延后。
10. **FeeVault、FeeExecutor 与 Worker**：Bucket 状态机、事件、Dust、批量上限、重入与重复执行防护；调用者、路径、`minAmountOut`、deadline、最小金额、间隔、单笔/每日上限、重试、幂等、nonce replacement、重组确认、Gas 资金和公开执行的 MEV/sandwich 风险。路径不得再次进入 TickerGarden Hook 形成递归 Bucket。
11. **Stock Token 购买与两类 Treasury**：每只股票允许市场/路径、价格源、陈旧价格和低流动性规则，输出必须原子直达对应 `StockTreasuryVault`；冻结 StockTreasuryVault 在公司行动、迁移、退市、安全事故和终止时的接收地址/审批/披露，以及 `ProtocolTreasury` 地址、收入资产和用途。
12. **Registry、Factory 与市场生命周期剩余项**：主状态与暂停/退出经济语义已冻结为 `REGISTERED/ACTIVE/PAUSED/RETIRED`；仍须冻结白名单兼容矩阵、创建费、唯一性、部署版本、失败回滚、各转换真实 caller 地址和退休条件。
13. **命名治理与权限签字**：仍须冻结 `NamingGovernor` / `NamingExecutor` 最终 ABI、锁仓或委托、供应快照、7/7/30 天到固定时间参数的换算、提案资格、保留词和缓存刷新；P-005 的 Safe/Timelock/Guardian/Worker/退出矩阵等待签字与真实地址，任何角色都不能绕过一次性社区投票改名。
14. **环境与 NVDA 首发 manifest**：首发 Stock Token 已固定为 NVDA；主网、固定区块主网 Fork、RH 公共测试网仍须维护脚本可读的 NVDA Asset UID/canonical 地址/Feed/multiplier、chain ID、依赖地址、版本、代码哈希、部署区块、构造参数与验证状态，并冻结 NVDA 供应档位、初始 Symbol、开始时间和完整 PoolKey。

### P1：测试网上线前必须完成

1. 固定合约接口、事件 schema、错误类型，并分别生成主网、主网 Fork、公共测试网三份机器可读环境部署清单。
2. Foundry 单元、Fuzz、Invariant 和固定区块 RH 主网 Fork 集成测试；覆盖供应、奖励、手续费与 Bucket 资产守恒，并验证 canonical PositionManager 的真实 Subscriber 生命周期。
3. RewardEscrow 的 20% / 80% 守恒、56 天线性解锁、多批重叠领取、解除质押不罚没、排放结束后继续释放、暂停期间提取和 Gas 上界测试。
4. LP Gauge 覆盖零 Stock Token 余额直接订阅、股票质押变化不影响 LP、非法 PositionManager/PoolId/tick、零 liquidity、重复订阅、多 NFT 聚合、加减仓、取消订阅、转移、burn、`feesAccrued` donation、足够/不足 Gas、permissionless 同步和先 unsubscribe 再 modify/burn 的用户逃生；再完成买卖双向手续费、股票购买直达 Vault、TGARD/mStock 真实销毁和销毁不恢复 `MintedSupply` 测试。
5. Worker 的幂等、nonce 管理与 replacement、密钥托管、模拟、重试、崩溃恢复、链重组确认、公开执行 MEV 和链上/链下对账测试。
6. Ponder 的事件回滚、重复日志、漏块恢复、重放与数据库重建测试；覆盖 Token 改名、Registry 迁移和市场退役后旧地址/旧 Symbol/旧 Pool 的历史展示。
7. Backend API 的 OpenAPI 契约、schema 校验、分页、参数化查询、CORS、限流、超时、只读数据库权限、错误脱敏、Ponder/RPC 故障和陈旧区块测试；Web 不得直连 Ponder/PostgreSQL，公共 API 不得包含 Worker 执行权限或无必要地代理公开 v4 数据。
8. 前端钱包、RH RPC、canonical v4 Quoter/StateView 地址校验与故障处理，以及错误网络、授权、签名模拟、奖励归属进度、滑点、交易替换、回滚、Backend API 故障、索引延迟和风险披露流程。
9. 为 Backend API 可用性/延迟、索引高度、Bucket 最大积压时间、Worker 停机时长、执行失败率、供应上限余量、RewardEscrow 负债覆盖率、国库余额偏差、Subscriber 不一致和 Gas 消耗冻结可操作的告警与暂停阈值。
10. 使用明确标记的测试专用 v4 地址完成 RH 测试网部署、源码验证、多签/Timelock/暂停/恢复与 Worker 停机恢复演练；不得把测试地址写入主网清单。
11. 演练 Gauge 关闭与用户自助迁移、市场 `PAUSED/RETIRED` 转换，并证明这些操作不会冻结 claim、unsubscribe、Stock Token 提取或已成熟归属释放。

### P2：主网上线前必须完成

1. 对 Hook、奖励会计、Factory 唯一性、FeeVault/Executor、销毁与用户退出路径完成独立安全审计并关闭高风险问题。
2. 模拟排放、初期流动性、卖压、销毁速度和国库积累的经济结果；销毁不能被当成价格保护。
3. 评估 Stock Token 与 TGARD 低流动性、滑点、MEV、夹子交易和公开执行时机带来的损失，确定私有交易或批量策略是否需要。
4. 完成证券、代币激励、Stock Token 国库、回购销毁、用户地域与市场宣传相关法律评估。
5. 固化可复现构建、合约地址、ABI、部署交易、管理员与权限清单，并公开验证源码。
6. 建立事故响应、RPC 冗余、值班告警、密钥轮换、暂停恢复、用户沟通和资金对账手册。
7. 采用限额和单市场渐进启动；完成审计后评估是否启动 Bug Bounty。

## 5. 建议的 V1 实施关键路径

```text
冻结 P0 产品与安全参数
→ 固定接口、事件和部署清单
→ Registry / Factory / TickerMemeToken / Gauges
→ canonical Pool / Hook / ProtocolFeeVault
→ FeeExecutor / StockTreasuryVault / TGARD burn
→ Off-chain Worker / Indexer / Backend API / Web
→ 测试网与故障演练
→ 独立审计与经济模拟
→ 限额主网上线
```

工程上应坚持 V1 最小化：每个资金用途使用明确专用接口。除每个 Ticker Meme 市场受限且只能成功执行一次的命名投票外，V1 不加入通用治理代币投票、通用执行器、跨链占位权限、收益策略或复杂自动调参。BSC、桥接和跨链奖励是明确延期项，不是本节缺失项。
