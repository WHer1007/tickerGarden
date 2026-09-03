# TickerGarden 技术架构

> 历史归档：本文描述 canonical V1 之前的 Test Prototype 架构，不是当前 V1 技术架构。

> 文档状态：Test Prototype 技术决策基线
> 更新时间：2026-09-02  
> 已选方案：方案 1——EVM 原生模块化架构  
> 协议参数：参见 [TEST_PROTOCOL_PARAMETERS.md](./TEST_PROTOCOL_PARAMETERS.md)
> 端到端流程与缺口：参见 [TEST_WORKFLOWS_AND_GAPS.md](./TEST_WORKFLOWS_AND_GAPS.md)

## 1. 决策摘要

TickerGarden Test Prototype 仅部署在 Robinhood Chain，不实现 BSC 或其他链支持，也不部署跨链桥、wrapped Ticker Meme Token 或跨链奖励会计。

面向用户的资产类别统一称为 `Ticker Meme`。现有架构中的 `mStock` 是早期技术占位名，不代表 Token Symbol 必须采用 `m<TICKER>`；新合约接口应在编码前统一迁移为 `TickerMemeToken` 等最终技术名称。Test Prototype 结算资产固定为 RH canonical-bridge USDC，不保留可替换的通用稳定币参数。

Test Prototype 采用以下技术方案：

- 智能合约：Solidity 0.8.26。
- 合约开发、测试和部署：Foundry。
- 通用合约组件：OpenZeppelin Contracts 5.x。
- 官方 AMM：Uniswap v4，使用 TickerGarden 自定义 Hook；LP 挖矿采用非托管 PositionManager NFT Gauge/Subscriber。
- Web 前端：现有 React 19 + Vite 6 原型演进为独立部署的 TypeScript 单页应用。
- Backend API：独立 Node.js LTS + TypeScript + Fastify 服务，使用 REST/OpenAPI 向 Web 提供协议历史、数据库聚合读取、内部元数据和索引同步状态。
- 链交互：viem + wagmi；钱包连接层保持可替换。
- 事件索引：Ponder + PostgreSQL，索引数据只作为读取加速层。
- 异步执行服务：Node.js + TypeScript，读取手续费 Bucket、获取报价、模拟并提交受约束的 `FeeExecutor` 交易；不托管协议或用户资产。

网站前后端必须分离构建和部署，但不要求所有公开数据经过后端。Web 不直接访问 Ponder 或 PostgreSQL；协议历史、内部元数据和数据库聚合状态通过 Backend API 获取。钱包连接、用户签名、Robinhood RPC，以及 canonical Uniswap v4 Quoter/StateView 等无需私密凭据且不存在特权写入的公开链上服务可由前端直接访问。Backend API、Ponder 和 Execution Worker 是三个权限、凭据和故障域相互独立的链下服务。

这套方案优先保持协议状态全部在链上、合约模块边界清晰，并复用当前 React/Vite 原型，避免 Test Prototype 同时承担跨链安全和双链运维复杂度。

## 2. Test Prototype 范围

### 2.1 支持范围

Test Prototype 的以下能力全部位于 Robinhood Chain：

- Registry 认证 Robinhood Stock Token。
- 创建一个 Asset UID 对应的 canonical Ticker Meme 市场；创建者提供初始 Symbol，社区保留一次永久有效的最终命名权。
- Stock Token 质押与 Ticker Meme Token 排放；最大供应由创建者从 10 亿/100 亿/1000 亿三档选择且全部作为挖矿预算，无预挖；股票池/LP 池预算为 70%/30%，按 `block.timestamp` 在 1460/1453 天窗口中平滑线性衰减，未释放额度期末永久取消；每市场精确起点写入 launch manifest。
- 股票池采用 10,000 美元对应 Stock Token 整数数量的软门槛；LP 池在股票池开始 7 天后启动，并与股票池使用同一最终截止时间。
- 股票池和 LP 池每次领取均为 20% 立即到账、80% 进入 RewardEscrow 并在 56 天内线性释放。
- 官方 Ticker Meme/USDC Uniswap v4 池；主网 USDC 固定为 `0x80e0e24718dbfcad49ecaa6f1e6c89a190586ca8`；首笔必须实际到账至少 500 USDC、非零 Ticker Meme 并形成非零 canonical 全区间 liquidity。
- 官方 LP NFT 非托管订阅和独立 Ticker Meme Token 奖励；不使用 LP Vault 或 tgLP，不读取或要求任何 Stock Token 质押余额。
- 1% 输入侧有效手续费：0.60% 归当前有效 LP，0.40% 归协议 Bucket。
- 买入侧协议费按 40% Stock Token / 40% TGARD 销毁 / 20% 协议收入记账；卖出侧协议费 100% 进入对应 Ticker Meme Token 销毁 Bucket。
- TGARD 回购销毁、Ticker Meme Token 销毁、协议收入划拨和股票独立国库，均由用户 Swap 结束后的异步执行链路完成。
- Test Prototype 首发 Stock Token 为 NVDA；主网创建前必须通过版本化 manifest 校验 Asset UID、canonical 地址、代码、multiplier、Feed 和公司行动状态。
- 独立 Web 前端、Backend API、钱包连接、交易签名、事件索引和状态展示。

### 2.2 明确不属于 Test Prototype

- BSC 合约部署或网络切换入口。
- RH 与 BSC 之间的 mStock 转换。
- CCIP、LayerZero、第三方桥或自研桥。
- wrapped mStock 或第二条链上的原生 mStock。
- 跨链 Stock Token 质押、LP 挖矿、奖励同步或治理。
- 双链官方池、跨链做市、跨链价格同步或套利服务。

如果第三方未经 TickerGarden 授权创建同名 token 或包装资产，前端、Registry 和文档不得将其标记为 canonical mStock。

## 3. 技术栈

| 层级 | Test Prototype 选型 | 职责与约束 |
|---|---|---|
| 链 | Robinhood Chain | 主网 Chain ID 4663；测试网 Chain ID 46630；ETH 支付 Gas |
| 合约语言 | Solidity 0.8.26 | 固定编译器版本和优化参数，构建结果可复现 |
| 合约工具 | Foundry | `forge` 单元、模糊、Invariant 和 Fork 测试；`cast` 运维；`anvil` 本地开发 |
| 安全组件 | OpenZeppelin Contracts 5.x | ERC-20、访问控制、暂停、重入保护等标准能力；只引入实际需要的模块 |
| AMM | Uniswap v4 | canonical PoolKey、PositionManager、非托管 NFT Gauge/Subscriber、PermissionlessInitializer 和 TickerGarden Hook |
| Web 前端 | React 19、Vite 6、TypeScript | 独立静态部署；延续现有原型；生产协议交互代码不继续扩展为无类型 JSX |
| Web3 客户端 | viem、wagmi | 前端完成 RH 链配置、交易模拟、钱包签名、提交、收据和错误解析 |
| Backend API | Node.js LTS、TypeScript、Fastify、REST/OpenAPI | 独立部署；读取 Ponder/PostgreSQL 和必要的链上校验值，向 Web 提供稳定、版本化的协议读模型接口；不代理可安全直连的公开 v4 数据 |
| 索引器 | Ponder、PostgreSQL | 索引市场、质押、奖励、LP、Swap、手续费和国库事件 |
| 异步执行 Worker | Node.js、TypeScript | 读取 Bucket、报价、模拟、提交 `FeeExecutor`、确认、重试和告警；只持有受限执行账户，不持有协议资产 |
| 监控 | RPC 双供应商、结构化日志、指标和告警 | 监测事件缺口、RPC 分叉、排放上限、资金流和管理员操作 |
| CI | 格式化、静态检查、Foundry 测试、Backend API 契约测试、前端构建和测试 | 任一关键检查失败时不得生成生产部署产物 |

具体依赖版本在开始合约实现时通过 lockfile 固定；升级 Solidity、OpenZeppelin、Uniswap v4 或 Foundry 前，必须重新运行完整测试并评估存储、ABI 和 Hook 行为差异。

## 4. 系统结构

```text
React / Vite Web
├── HTTPS REST 读取 ──▶ Backend API ──▶ Ponder / PostgreSQL
│                           └──────────▶ RH RPC（必要的最新链上只读值）
├── RH RPC / canonical v4 Quoter / StateView ──▶ 公开链上实时数据
└── viem/wagmi + 用户钱包：模拟 / 签名 / 提交 ──▶ Robinhood Chain

                                                   Robinhood Chain
Registry → Factory → TickerMemeToken / Stock Gauge / LP NFT Subscriber / RewardEscrow / canonical Pool
                    └→ NamingGovernor / NamingExecutor（一次性最终命名）
                                      │
User Swap → Uniswap v4 Pool → Hook → ProtocolFeeVault
                                      │              ▲
                                      │              │ consume matching Bucket
                                      │       constrained FeeExecutor
                                      │              ▲
                                      │              │ submit after quote/simulation
                                      │       Off-chain Execution Worker
                                      │
                                      └──────────────┬───────────────────────────────┐
                                                     ▼               ▼               ▼
                                            StockTreasuryVault   TGARD / Token    ProtocolTreasury
                                               direct receive        burn             revenue

Robinhood Chain events ──▶ Ponder ──▶ PostgreSQL ──▶ Backend API ──▶ Web read models
```

链上合约是余额、奖励、供应量、PoolKey 和国库状态的唯一权威来源。Backend API 和索引器故障只能影响官方页面的读取或历史展示，不能影响链上余额，也不能成为用户领取奖励、取回质押资产或操作 LP NFT 的协议依赖。

## 5. 合约设计约束

### 5.1 模块边界

- `OfficialStockRegistry` 只按 canonical 合约地址和稳定 Asset UID 认证资产，不能按 ticker 或名称认证。
- `TickerGardenFactory` 负责 Asset UID、`marketId`、初始 Symbol、10 亿/100 亿/1000 亿供应档位和 canonical 市场唯一性校验及标准化部署，不接受任意供应数值，也不获得任意增发、转移质押资产或改变官方池的能力。
- `TickerMemeToken` 只接受最终选定的排放模块授权铸造，创建者和市场管理员不能直接铸造；Token 内置一次性元数据最终确认入口，但不为此采用通用可升级代理。
- 创建者只设置经过格式、唯一性与保留词校验的初始 Symbol；专用 `NamingGovernor` / `NamingExecutor` 只可成功执行一次 `finalizeMetadata`，不能改变 `marketId`、Token 地址、PoolKey、Gauge、余额或供应量。
- `StockStakingGauge` 以 10,000 美元对应的 Stock Token 整数数量作为池级软门槛目标，并与 `CanonicalLPNFTGauge` 独立记账且不存在资格回调；后者实现 Uniswap v4 `ISubscriber`，不托管 NFT，任意通过 canonical 仓位校验的 LP NFT owner 均可直接订阅。
- 每个 mStock 市场独立部署一个 `RewardEscrow`，只承接该 mStock 已领取挖矿奖励的 80%，按领取时间在 56 天内线性释放；解除股票质押和 LP 停止计奖不影响既有归属，管理员不能提前解锁、取消或没收。
- `TickerGardenV4Hook` 只服务登记的 canonical PoolKey，并只做收费、方向分类、Bucket 记账和归集。P-003 已确认严格 gross 0.40% Hook fee 与原生 0.60% LP fee 的组合仅为 0.9976%；生产实现须等待 G0-07 在“精确 1% + remainder 协议费（推荐）”与“严格 0.40% 协议费 + 0.9976% 总费”之间签字，详见 [`TEST_V4_FEE_AND_SUBSCRIBER_SPIKE.md`](./TEST_V4_FEE_AND_SUBSCRIBER_SPIKE.md)。
- `ProtocolFeeVault` 按 `marketId`、`feeAsset`、`bucketType` 隔离资金；不得提供任意资产提取或通用外部调用。
- `FeeExecutor` 只消费用途匹配的 Bucket，并通过专用函数执行股票购买、TGARD 销毁、mStock 销毁或协议收入划拨；不得提供通用 `execute`。
- 每个 `StockTreasuryVault` 独立于 mStock 合约，只接收对应 canonical Stock Token；购买输出必须直接进入该 Vault。
- 链下 Worker 只能决定何时调用受约束的 `FeeExecutor`。其停机或执行失败不得阻塞 Swap、领取奖励、解除股票质押、取消 LP 订阅或操作用户自己的 LP NFT。

### 5.2 不对称手续费与异步执行

用户 Swap 的同步链路为：

```text
校验 canonical PoolKey
→ 从输入资产结算 0.60% LP fee 与 0.40% protocol fee
→ 识别买入或卖出方向
→ 记入 ProtocolFeeVault
→ 完成 Swap
```

协议费采用以下不对称规则：

| Swap 方向 | 0.40% 协议手续费的 Bucket |
|---|---|
| 买入 mStock，输入稳定币 | 40% `STOCK_BUYBACK`、40% `TGARD_BUYBACK`、20% `PROTOCOL_REVENUE` |
| 卖出 mStock，输入 mStock | 100% `MSTOCK_BURN` |

Stock Token 购买、TGARD 回购销毁、mStock 销毁和协议收入划拨均不在 Hook 回调中执行。链下 Worker 在交易完成后读取可执行余额，使用允许的路径获取报价，设置 `minAmountOut` 与 `deadline`，先模拟再调用 `FeeExecutor`。执行失败必须整体回滚，Bucket 资产继续保留在 `ProtocolFeeVault` 中。

卖出侧销毁的 mStock 不得重新出售，也不得被分配到股票国库、TGARD 回购或协议收入。TGARD 回购销毁是 Test Prototype 必备能力，但资金仅来自买入侧稳定币协议费。

### 5.3 供应上限

每个 Ticker Meme 的 `MaximumSupply` 由创建者从 10 亿、100 亿、1000 亿三个固定档位中选择。Factory 不接受任意数值，部署后任何角色都不能修改供应档位。每个市场必须区分：

```text
MaximumSupply  固定的终身排放上限，也是 TotalMiningBudget
PoolReleased   截止时间前已分配给 Gauge 用户的额度，只增不减
PoolMinted     对应池已经由用户领取并实际铸造的额度，只增不减
MintedSupply   两池历史实际铸造量，只增不减
totalSupply    当前链上供应量，可因 burn 下降
```

铸造条件为：

```text
PoolMinted + amount <= PoolReleased <= PoolBudget
MintedSupply + amount <= MaximumSupply
```

转账、托管、销毁以及未来可能增加的跨链锁定，都不能减少 `MintedSupply` 或重新打开排放额度。该约束为 V1 保留安全迁移空间，但 Test Prototype 不包含任何桥接代码或桥接权限。

进入 `RewardEscrow` 但尚未解锁的 mStock 已经属于已发行供应，同时计入 `MintedSupply` 与 `totalSupply`。归属状态只限制用户何时能够转出，不改变供应上限会计。

Ticker Meme 固定 18 decimals，不存在预挖、团队份额、空投或额外创世铸造。股票池精确开始时间写入每市场 launch manifest；全局时间关系固定为：

```text
lpEmissionStart = stockEmissionStart + 7 days
stockEmissionEnd = stockEmissionStart + 1460 days
lpEmissionEnd = stockEmissionEnd
```

两个池分别在 1460/1453 天有效窗口内使用 `B × (1.5x - 0.5x²)` 累计曲线，按 `block.timestamp` 计算；初始速率为平均速率 1.5 倍并线性衰减至 0.5 倍，无尾部。零有效份额和软门槛不足造成的未释放额度不追赶。期末停止增加 `PoolReleased`，永久取消从未释放额度；期末前已赚取但未领取的奖励仍可在 `PoolMinted <= PoolReleased` 下领取。完整整数公式、remainder 与状态机见 `TEST_MATH_AND_STATE_MACHINES.md`。

股票池允许任意非零数量质押。市场创建时读取 manifest 固定的 multiplier-adjusted 官方 Feed，把 10,000 美元换算为完整 Stock Token 并向上取整冻结；池级释放系数为 `min(totalStaked / targetStockAmount, 1)`。创建时必须检查 Feed staleness、sequencer 宽限、oracle pause 与公司行动门禁；该预言机逻辑不进入奖励热路径、LP 资格或 LP 奖励会计。

### 5.4 奖励归属

- 股票池和 LP 池使用同一规则：每次领取金额的 20% 直接发送给用户，剩余 80% 从领取时间开始在 56 天内连续线性释放。
- 即时金额向下取整，余数进入归属金额，保证领取总额完整守恒。
- 每用户每奖励来源至少间隔 7 天领取，并使用最多 8 个活跃 tranche 的固定槽位；成熟槽位结清后复用，任何领取、查看和提取操作都不得遍历无界历史。
- 用户解除股票质押、取消 LP 订阅、转移 LP NFT 或 LP 停止计奖后，既有归属继续运行且不被罚没或加速。
- `releaseVested` 不受普通紧急暂停影响，用户始终可以提取已经解锁的奖励；暂停只能限制新增风险操作，不能冻结成熟的归属资产。
- RewardEscrow 中的归属权益不可转让、不可再质押；合约不提供管理员没收、提前解锁、通用资产提取或外部调用。

### 5.5 非托管 LP NFT Gauge / Subscriber

Robinhood Chain 主网 Chain ID 4663 已列入 Uniswap 官方 v4 部署清单。Test Prototype 主网绑定以下 canonical 合约，但地址必须来自版本化部署清单，并在部署前重新校验代码与不可变量：

| 合约 | RH 主网地址 |
|---|---|
| PoolManager | `0x8366a39cc670b4001a1121b8f6a443a643e40951` |
| PositionManager | `0x58daec3116aae6d93017baaea7749052e8a04fa7` |
| StateView | `0xf3334192d15450cdd385c8b70e03f9a6bd9e673b` |

Uniswap v4 `PositionManager` 继承 `Notifier`；每个市场的 `CanonicalLPNFTGauge` 实现 `ISubscriber`。用户直接在 PositionManager 上将 tokenId 订阅到 Gauge，NFT 始终保留在用户钱包，Gauge 不需要 NFT approve、transfer 或 custody 权限。

Gauge 的固定规则为：

- 只接受 canonical PositionManager 调用 Subscriber 回调，回调中的 `data` 不作为 owner、PoolId、tick 或 liquidity 的权威来源。
- 只认可该市场 canonical PoolId，并要求 `tickLower/Upper` 精确等于对应 tickSpacing 的最小/最大可用 tick。
- 有效份额使用仓位原始 liquidity；所有可奖励仓位处于同一 PoolId 和全区间，不使用美元价值、预言机、交易量或 Vault NAV。
- 按用户聚合 subscribed liquidity 以 O(1) 结算和领取；Gauge 不读取 `StockStakingGauge`、Stock Token 钱包余额或任何 `MinimumStockStake` 参数。
- `notifyModifyLiquidity` 先按旧份额结算再更新份额；其 `feesAccrued` 参数可被 donation 影响，不得参与奖励权重。`notifyUnsubscribe`、自动转移取消订阅和 `notifyBurn` 先结算再停止计奖。
- Subscriber 回调仅更新有界奖励会计，不铸币、不转币、不收取 LP 手续费、不执行 Swap，也不调用任意外部目标。用户在独立的 `claim` 入口领取 mStock。
- 新增订阅可以暂停，但取消订阅、NFT 转移、撤出流动性、领取 LP 手续费、领取已产生奖励和提取已解锁归属不得依赖管理员或 Worker。

PositionManager 对 `notifyUnsubscribe` 使用固定 Gas 上限；调用交易必须有足够剩余 Gas 通过 `GasLimitTooLow` 检查，此后 PositionManager 才会捕获并忽略回调失败。RH 主网当前部署的 `unsubscribeGasLimit()` 点时读取值为 300,000。因此实现必须让该回调保持常数时间和非重入，在这一上限内保留充足余量，并提供 permissionless `syncPosition(tokenId)` 防御性核对 `subscriber(tokenId)`、owner 与 liquidity。该同步入口用于停止检测到的不一致仓位，不能替代正常回调或依赖 Keeper 才保证日常正确性。

`notifyModifyLiquidity` 或 `notifyBurn` 失败会回滚对应的 PositionManager 操作，所以两者同样不能被普通暂停阻断，必须保持有界且正常路径不 revert。若 Gauge 异常，用户的最终逃生路径是以足够 Gas 先直接调用 PositionManager `unsubscribe(tokenId)`，确认清除订阅后再修改或 burn；TickerGarden 管理员无权关闭该路径。

RH 测试网 Chain ID 46630 截至 2026-09-01 未列入 Uniswap 官方 v4 测试网部署清单。canonical 协议集成测试使用固定区块的 RH 主网 Fork；如需公共 RH 测试网演练，则使用锁定版本的测试专用 v4 core/periphery 与独立环境地址，禁止把主网地址直接复用到测试网。

上述 Gauge 方向已经冻结，且股票池与 LP Gauge 不再存在资格同步或调用依赖。P-005 已固定订阅时 owner 为 beneficiary、claim 只能由 beneficiary 发起且收款地址不可重定向、全部退出/回调/sync 不受普通暂停影响；仍须在 P-003 冻结最终 Subscriber ABI、零 liquidity/重复回调的精确登记状态、`syncPosition` 奖励截止点和旧/新 Gauge 唯一迁移切点。这些是既定非托管模型的会计规格，不是新增产品功能。

来源：[Robinhood Chain 网络配置](https://docs.robinhood.com/chain/connecting/)、[Uniswap v4 部署清单](https://developers.uniswap.org/docs/protocols/v4/deployments)、[PositionManager](https://github.com/Uniswap/v4-periphery/blob/main/src/PositionManager.sol)、[Notifier](https://github.com/Uniswap/v4-periphery/blob/main/src/base/Notifier.sol)、[ISubscriber](https://github.com/Uniswap/v4-periphery/blob/main/src/interfaces/ISubscriber.sol)。

### 5.6 权限和升级

- 用户资产提取路径不能依赖管理员批准。
- 权限模型以 `TEST_PERMISSIONS_AND_PAUSE_MATRIX.md` 和 `spec/permissions_matrix.json` 为准：3/5 Protocol Safe 只通过 48 小时 Timelock 治理；市场退休和 StockTreasuryVault 迁移使用同一 Timelock 的 7 天 delay。
- 独立 2/3 Guardian 只有 pause/cancel，不能 unpause、配置、增发或移动资产；Execution Worker 只调用 Stock/TGARD 两类专用回购函数。
- Factory、Asset、Market、Execution 四个暂停域相互独立。普通暂停永不阻断 Stock withdraw、Gauge claim、Escrow release、LP unsubscribe/modify/remove/collect/transfer/burn、Subscriber 生命周期回调或 permissionless sync/finalize。
- 核心记账合约优先采用不可升级部署。需要新逻辑时使用版本化实现、Factory 和显式迁移，避免无边界的通用代理升级权限。
- Ticker Meme 的一次性最终命名由专用 `NamingGovernor` / `NamingExecutor` 执行；创建者、Factory 管理员、协议多签和紧急暂停角色都不能直接跳过投票修改 Symbol。
- `metadataFinalized` 一旦写入 `true`，不可升级 Token 代码中不存在恢复、重置或第二次修改路径。
- Test Prototype 不预置桥接 minter、跨链管理员、BSC peer 或占位 Endpoint 地址。

### 5.7 资产识别

- Stock Token、Ticker Meme Token、USDC 和 TGARD 均按链 ID 与合约地址识别，不能只依赖 symbol、名称或 Logo。
- `assetUid` 在协议内保持稳定，合约迁移和公司行动通过 Registry 的显式状态处理。
- `marketId` 由 Robinhood Chain ID 与稳定 Asset UID 派生；初始命名和社区最终命名都不能改变 `marketId`。
- 所有外部地址通过按环境区分的部署清单注入，不在业务逻辑中散落硬编码地址。

Test Prototype 主网固定使用 RH canonical-bridge USDC `0x80e0e24718dbfcad49ecaa6f1e6c89a190586ca8`，6 decimals。该地址由 RH 官方 L2 Gateway Router `0x1E324B9316138CA9a73F960213621AD1aaf01B89` 对以太坊 Circle USDC `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` 计算得到，点时链上读取的 `l1Address()` 与之相符。它属于 canonical-bridge USDC，不是 Circle-native RH USDC；部署脚本必须按地址、代码、L1 映射和 decimals 校验，不能按 Symbol 自动发现。来源：[Robinhood Chain Protocol Contracts](https://docs.robinhood.com/chain/protocol-contracts/)、[Robinhood Chain Bridging](https://docs.robinhood.com/chain/bridging/)、[Circle USDC Contract Addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses)。

### 5.8 Ticker Meme 命名治理

初始 Symbol 在 Factory 创建市场时写入，必须为 3–8 位 `A–Z`，通过大小写规范化、平台内唯一性和保留词校验。Registry 维护永久 `symbolEverUsed` 索引，任何当前或历史 Symbol 都不能被其他市场复用。Token 全称由协议按 `<SYMBOL> — <STOCK_TICKER> Ticker Meme` 生成，创建者不能提交任意长度的完整 Token Name。

每个市场拥有独立的一次性命名治理状态：

```text
currentSymbol
metadataFinalized
activeProposalId
lastFailedProposalBlock
```

`NamingGovernor` 必须使用提案开始区块的历史投票权与供应快照，避免同一份 Token 转移后重复投票。产品层已经确定 7 天投票、10% 已释放供应快照参与率、有效票三分之二赞成、通过后 7 天时间锁和失败后 30 天冷却；部署前应将这些时间换算为固定区块参数并完成边界测试。

成功执行时，`NamingExecutor` 只能调用目标 Token 的一次性 `finalizeMetadata`，原子更新 `name`、`symbol` 和 `metadataFinalized`，并发出至少包含 `marketId`、旧 Symbol、新 Symbol、提案 ID 和执行区块的事件。该调用不得改变余额、供应、铸币权限、PoolKey、Hook、Gauge、RewardEscrow 或 Treasury 映射。失败提案不得写入 `metadataFinalized`。

执行最终命名前，Registry 必须原子占用新 Symbol；旧 Symbol 继续永久指向该市场的历史别名，不得释放给其他市场。占用失败时整个最终命名交易回滚，不能出现 Token 已改名但 Registry 未登记的中间状态。

社区最终命名权不设置过期时间。社区可以在任何后续时点选择新 Symbol，也可以确认保留当前 Symbol；第一次成功执行后，命名状态永久冻结。

## 6. Web 前端、Backend API、索引与 Worker 边界

### 6.1 前端

- Web 前端与 Backend API 使用独立工程、构建产物、域名和部署流程；前端部署物中不得包含数据库凭据、Worker 密钥或服务端私密配置。
- Test Prototype 只注册 Robinhood Chain 主网和测试网配置。
- 用户连接错误网络时，交易按钮应先提示切换到 RH。
- 协议历史、内部元数据、数据库聚合奖励、Bucket/国库历史和索引同步状态通过版本化 Backend API 获取；Web 不直接调用 Ponder 查询接口或连接 PostgreSQL。
- 无需私密凭据、没有服务端特权且可在浏览器安全验证来源的公开服务可以直连。Test Prototype 明确允许钱包 Provider、Robinhood RPC、canonical Uniswap v4 Quoter、StateView 和链上只读合约调用；地址和 chain ID 必须来自已校验 manifest，不按网页返回的 Symbol 或任意 URL 动态信任。
- v4 即时报价、池状态和 LP 仓位当前值优先由前端直接读取 canonical Quoter/StateView/PositionManager；历史曲线和聚合统计仍由 Backend API 提供。前端必须校验响应、设置超时和错误状态，不能把第三方读取失败解释为链上交易失败。
- 所有合约写操作仍由浏览器钱包直接执行：前端用 viem/wagmi 进行链上读取校验和交易模拟，展示合约地址、资产、金额、最小输出、手续费与失败原因，再由用户签名并提交 RPC。私钥和签名不得发送给 Backend API。
- 奖励页面必须分别显示待领取奖励、20% 即时金额、归属中余额、已解锁可提取余额和预计完全解锁时间；`totalSupply` 包含尚未解锁的 Escrow 余额，不能冒充为当前可转让流通量。
- 页面必须区分链上交易确认、Backend API 可用性和索引器同步状态；API 故障或索引延迟不能被展示为链上交易失败。
- 钱包连接器与页面组件解耦，避免将具体钱包 SDK 写入协议业务状态。

前端访问路由固定如下：

| 数据或操作 | 访问路径 | Test Prototype 规则 |
|---|---|---|
| 钱包连接、网络切换、签名 | Web → Wallet Provider | 必须直连；任何密钥或签名不得经过 Backend API |
| 交易模拟、提交与收据 | Web → RH RPC / Wallet | 必须直连；前端展示 simulation 与最终 receipt |
| 当前余额、allowance、pending reward、合约状态 | Web → canonical 合约/RH RPC | 可直连；地址来自部署 manifest，链上值为权威 |
| v4 即时报价、池状态、LP NFT 当前仓位 | Web → canonical Quoter/StateView/PositionManager | 优先直连；校验 chain ID、地址、区块和超时 |
| 市场列表、历史、聚合统计、Bucket/国库历史 | Web → Backend API → Ponder/PostgreSQL | 必须走 API；禁止 Web 直连数据库或 Ponder 内部接口 |
| 协议内部元数据、索引同步状态 | Web → Backend API | 必须走版本化 REST/OpenAPI |
| 公共静态资源 | Web → 受信任 CDN/对象存储 | 可直连；固定 HTTPS 来源并提供完整性/缓存策略 |
| Worker 执行与运维管理 | 私有 Worker/运维平面 | 不属于 Web 或公共 Backend API，禁止公开转发 |

### 6.2 Backend API

Test Prototype Backend API 采用 Node.js LTS + TypeScript + Fastify，并以 REST/OpenAPI 作为 Web 与后端的唯一正式接口契约。它独立于 Web、Ponder 和 Execution Worker 部署。

Backend API 的职责限定为：

- 使用只读数据库账号查询 Ponder/PostgreSQL，提供市场列表、市场详情、地址仓位、奖励、LP、Swap、Bucket、回购/销毁、国库和命名历史。
- 对确实需要服务端交叉校验的字段执行白名单化链上只读调用；响应必须同时返回来源区块、索引高度和同步状态，不能把旧索引结果伪装为最新链上状态。
- 使用游标分页、固定最大 page size、请求 schema 校验、参数化查询、CORS allowlist、速率限制、超时、结构化日志、request ID 和统一错误格式。
- 发布版本化 OpenAPI schema，并由前端生成类型安全客户端；接口删除或破坏性修改必须显式升版。

Backend API 不得：

- 托管用户私钥、请求用户提交私钥/助记词、代替用户签名或作为通用交易中继。
- 生成链上不存在的余额、奖励、价格或已完成回购状态。
- 绕过 Registry、Factory、Gauge、FeeExecutor 或链上暂停与额度限制。
- 使用可写数据库账号修改 Ponder 的链上读模型，或把链下数据库状态当成协议结算依据。
- 暴露通用 RPC 代理、通用 SQL/GraphQL 查询、Worker 管理接口或任意内部运维接口。
- 代理钱包连接、canonical v4 Quoter/StateView 或其他前端可安全直连的公开链上读取，除非存在明确的缓存、限流或兼容性需求并经过评审。
- 成为用户取回质押资产、取消 LP 订阅、领取奖励或提取已解锁归属的链上必要条件。

Test Prototype 不引入用户账号、Session、Redis、消息队列或后台 CMS。Backend API 的公共读接口默认无登录，通过限流和资源上限防滥用；若未来需要管理后台，必须作为独立受保护平面另行评审，不得复用公共 API 权限。

### 6.3 索引器

索引器至少覆盖：

- Registry 资产状态与市场创建事件。
- Ticker Meme 初始命名、命名提案、投票快照、投票结果、时间锁与最终元数据事件；改名后保留旧 Symbol 历史别名。
- Stock Token 质押、解除、奖励累计、20% 即时领取和 80% 归属。
- LP NFT 订阅、liquidity 变化、取消订阅/转移、停止计奖、20% 即时领取和 80% 归属。
- RewardEscrow 归属创建、线性解锁和已解锁奖励提取。
- 官方池初始化、流动性与 Swap。
- Hook 手续费方向、四类 Bucket 的新增与消费、FeeExecutor 执行、StockTreasuryVault 入账、TGARD/mStock 销毁和协议收入划拨。
- 管理员、暂停、参数和权限变更。

索引器必须处理回滚、重复事件、RPC 漏块和从已确认区块重建；数据库字段保留 chain ID、block number、block hash、transaction hash 和 log index。Ponder 是 Backend API 的读模型生产者，不直接暴露给公网 Web；数据库只允许 Indexer 写入，Backend API 使用独立只读账号。

### 6.4 Execution Worker 与服务隔离

异步执行 Worker 须满足：

- 不托管用户资产、协议手续费或回购后的资产。
- 执行账户不能绕过 `FeeExecutor` 的 Router、路径、额度、时间间隔、滑点、deadline 和暂停限制。
- 对同一 Bucket 批次提供幂等标识，完成链上确认、事件与余额对账后才标记成功。
- 报价、模拟、交易提交、链上回滚、RPC 故障和长时间未执行均须形成结构化日志与告警。
- Worker 停机时只造成后续处理延迟，不改变用户交易与资金提取路径。
- Worker 使用独立进程、网络入口、配置和受限执行凭据；公共 Backend API 不得导入 Worker 私钥、调用其内部管理函数或向公网转发执行接口。

## 7. 测试与上线门槛

### 7.1 合约测试

- 单元测试覆盖正常、边界和失败路径。
- Fuzz 测试覆盖金额、排放时间跨度、多人质押、领取顺序和手续费输入。
- Invariant 测试至少验证供应上限、资产守恒、奖励不超发、领取金额 20% + 80% 守恒、归属单调解锁、池间隔离、Bucket 守恒和无权限增发。
- 命名治理测试必须覆盖 3–8 位与字符集校验、大小写规范化、重复/保留 Symbol、历史快照、防重复投票、参与率与三分之二边界、失败冷却、时间锁、保留原 Symbol 的最终确认，以及成功后任何角色都无法再次修改。
- 固定区块的 RH 主网 Fork 集成测试覆盖 Stock Token 适配、Uniswap v4 PoolManager、PositionManager、Subscriber、Hook 和真实 ERC-20 行为；RH 公共测试网只使用经校验的测试专用 v4 地址清单。
- LP Gauge 测试必须覆盖零 Stock Token 余额时直接订阅并持续计奖、股票质押变化完全不影响 LP，以及非法 PositionManager/PoolId/tick、重复订阅、零 liquidity、加减仓、用户多 NFT 聚合、主动取消订阅、NFT 转移自动取消、burn、donation 影响的 `feesAccrued` 不进入权重、回调 Gas 上界、低 Gas 取消订阅回滚、失败后 permissionless 同步、普通暂停与先 unsubscribe 再 modify/burn 的用户逃生路径。
- 双向 Swap 测试必须验证 0.60% / 0.40% 只收一次，以及买入 40% / 40% / 20%、卖出 100% 销毁 Bucket 的精确归属和整数舍入。
- 异步执行测试必须覆盖报价过期、滑点、Router 回滚、部分路径不可用、重复提交和 Worker 重启；失败不能扣减 Bucket。
- 股票购买测试必须验证输出原子地直达对应 `StockTreasuryVault`；mStock 销毁测试必须验证 `totalSupply` 下降而 `MintedSupply` 不变。
- RewardEscrow 测试必须覆盖多次重叠领取、56 天边界、舍入、解除股票质押、LP 停止计奖、排放结束、紧急暂停和无管理员提前解锁路径；单用户操作 Gas 不得随历史领取次数无限增长。
- 静态分析和人工审查不得以测试通过为替代。

### 7.2 Web、Backend API 与索引测试

- 合约 ABI 类型生成和链配置测试。
- 错误网络、拒签、模拟失败、交易替换、交易回滚和索引延迟场景。
- OpenAPI schema/客户端契约测试，保证 Web 只依赖已发布的版本化 API。
- Backend API 覆盖 schema 校验、游标分页、参数化查询、最大响应量、CORS、限流、超时、错误脱敏和只读数据库权限测试。
- Backend API 覆盖 Ponder 延迟、数据库断开、RPC 故障和陈旧区块；失败时必须显式返回不可用或陈旧状态，不能合成成功数据。
- Web 覆盖钱包 Provider、RH RPC、canonical v4 Quoter/StateView 的地址校验、超时、错误响应和降级展示；这些公开读取不得经过 Backend API 才能工作。
- 架构测试或构建检查确保 Web 不包含 PostgreSQL 凭据、不直连 Ponder，Backend API 不包含 Worker 执行密钥或通用交易入口。
- 索引器重放、回滚、断点续扫和幂等性测试。
- 当前网站的 `npm run build` 与 `npm run test:sites` 必须持续通过。

### 7.3 生产上线门槛

1. 协议参数冻结并形成可审阅部署清单。
2. Foundry 全量测试、Invariant、Fork、Backend API 契约/安全测试和 Web 端到端测试通过。
3. 至少一次独立智能合约安全审计完成，高风险问题关闭并复审。
4. 多签、Timelock、暂停角色、RPC 备份和监控告警完成演练。
5. FeeExecutor 限额、Worker 重试、停机恢复、链上/链下对账和回购路径异常完成演练。
6. 合约源码验证、ABI、地址、构建参数和部署交易公开归档。
7. 法律和风险披露完成后再开放主网交互。

## 8. V1：BSC 扩展候选方向

V1 不在当前实现范围内。若后续数据证明 BSC 扩展有真实需求，优先重新评估以下架构：

```text
Robinhood Chain canonical mStock
        │ lock / unlock
        ▼
Chainlink CCIP CCT Token Pool
        │ verified cross-chain message
        ▼
BSC wrapped mStock
        │ mint / burn
```

上图仅记录候选架构和未来评审入口，不代表相关合约、权限或主网通道已经部署。

V1 的初始约束建议为：

- RH 继续是唯一 canonical 发行链和 mStock 排放链。
- BSC 资产与 RH 锁仓 1:1 对应，不在 BSC 独立发行。
- BSC 初期不支持 Stock Token 质押、mStock 排放或跨链奖励资格。
- RH 锁仓量必须始终覆盖 BSC wrapped mStock 总供应量。
- 每个方向配置速率限制、独立暂停、消息状态监控和异常恢复流程。
- 多签、Timelock、Token Pool 权限和前端 canonical 地址映射必须接受专项审计。

在决定启动 V1 前，必须重新验证 RH↔BSC 的 CCIP 主网支持、费用、安全模型、合约接口和服务状态。Test Prototype 的技术决策不得被解释为已经批准或部署任何跨链能力。

## 9. 建议目录结构

开始协议开发时，建议按以下边界组织：

```text
contracts/
├── src/
│   ├── registry/
│   ├── factory/
│   ├── tokens/
│   ├── gauges/
│   ├── amm/
│   ├── emissions/
│   ├── treasury/
│   └── libraries/
├── test/
│   ├── unit/
│   ├── fuzz/
│   ├── invariant/
│   └── integration/
└── script/

website/
├── src/
│   ├── components/
│   ├── features/
│   ├── hooks/
│   ├── lib/web3/
│   └── generated/
└── tests/

backend/
├── src/
│   ├── routes/
│   ├── services/
│   ├── repositories/
│   ├── schemas/
│   └── plugins/
├── openapi/
└── tests/

indexer/
├── src/
└── tests/

services/
└── execution-worker/

deployments/
├── robinhood-testnet.json
└── robinhood-mainnet.json
```

`website/`、`backend/`、`indexer/` 和 `services/execution-worker/` 各自拥有独立入口、配置和部署产物，不把公共 API 与 Worker 合并成一个进程。Test Prototype 不创建 `deployments/bsc-*.json`、`bridge/` 或跨链合约目录；这些内容只能在 V1 决策批准后加入。
