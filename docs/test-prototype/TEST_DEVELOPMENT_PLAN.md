# TickerGarden Test Prototype 详细开发计划

> 历史归档：本文描述 canonical V1 之前的 Test Prototype；其中对“后续 V1”的表述仅代表当时规划，当前 V1 以仓库根目录文档和 `contracts/src/v1/` 为准。

> 文档状态：执行草案，完成 G0 冻结后进入正式开发
> 更新时间：2026-09-02
> 适用版本：Robinhood Chain 单链 Test Prototype
> 协议规则：[TEST_PROTOCOL_PARAMETERS.md](./TEST_PROTOCOL_PARAMETERS.md)
> 技术架构：[TEST_TECHNICAL_ARCHITECTURE.md](./TEST_TECHNICAL_ARCHITECTURE.md)
> 端到端链路：[TEST_WORKFLOWS_AND_GAPS.md](./TEST_WORKFLOWS_AND_GAPS.md)

本文把 Test Prototype 拆成可以分配、测试和验收的开发任务。计划以“只实现上线必需功能和安全代码”为原则；任何任务若改变供应、排放、收费、资产处置、用户退出或权限边界，必须先更新协议规格和测试，不允许开发者在代码中自行补默认值。

## 1. Test Prototype 完成目标

Test Prototype 的完成目标是在 Robinhood Chain 上，以 NVDA Stock Token 为首发资产，跑通以下闭环：

```text
登记 NVDA Stock Token
→ 创建对应 Ticker Meme 市场
→ 质押 NVDA 并按软门槛系数累计奖励
→ 领取 20% 即时奖励、80% 进入 56 天线性归属
→ 无许可初始化 Ticker Meme/USDC 官方池
→ LP NFT 非托管订阅并独立挖矿
→ 买卖按输入侧收取 1% 有效手续费
→ 协议费进入用途隔离的 Bucket
→ Worker 异步触发股票购买、TGARD 回购销毁、Ticker Meme 销毁和收入划拨
→ 独立 Web、Backend API、索引器和监控完整展示链上结果
```

### 1.1 Test Prototype Definition of Done

只有同时满足以下条件，Test Prototype 才能被标记为完成：

| 编号 | 完成条件 | 验证证据 |
|---|---|---|
| DoD-01 | NVDA 市场的创建、股票质押、奖励领取、归属释放、官方池初始化、LP 订阅、Swap 和手续费后处理全部可用 | 固定区块 RH 主网 Fork 端到端测试及主网部署记录 |
| DoD-02 | 供应档位、48 个月窗口、70%/30% 预算、期末取消未释放额度且保留既得未领取权益均由链上不可变量约束 | 单元、Fuzz、Invariant 测试 |
| DoD-03 | 任意角色都不能越权增发、恢复已消耗额度、任意转出 Bucket/国库资产或阻断用户退出 | 权限矩阵、负向测试、审计报告 |
| DoD-04 | LP NFT 始终由用户持有；零 Stock Token 余额也能订阅；转移、取消订阅、修改和 burn 有明确结算与逃生路径 | canonical PositionManager Fork 测试与 Gas 报告 |
| DoD-05 | 每笔交易的有效手续费只收一次，买卖方向和四类 Bucket 的资产守恒 | Hook 会计证明、差分测试、Invariant 测试 |
| DoD-06 | Worker 停机、报价失败或交易回滚不会阻塞 Swap、claim、withdraw、unsubscribe 或 `releaseVested` | 故障注入和停机恢复演练 |
| DoD-07 | 索引数据库可从链上事件完整重建；独立 Backend API 只提供可追溯、版本化的读模型，后端或索引延迟不会被前端误报为链上失败 | Ponder 回滚/重建、OpenAPI 契约及 Backend API 故障测试 |
| DoD-08 | Web 与 Backend API 可独立构建和部署；Web 不直连 Ponder/PostgreSQL，但钱包、RH RPC 和 canonical v4 公开链上数据可安全直连；所有写操作签名前模拟 | 架构检查、Web/API 集成测试与人工验收 |
| DoD-09 | 独立安全审计完成，Critical/High 问题为 0，Medium 问题已修复或有书面接受理由并复审 | 最终审计及修复复核报告 |
| DoD-10 | 主网 manifest、源码验证、多签/Timelock、监控、告警、对账和事故手册完成演练 | 上线检查单与演练记录 |

## 2. 计划假设与最小化边界

### 2.1 估算假设

本文的日历估算基于以下小型团队，可按实际人力同比调整：

- 2 名 Solidity/协议工程师。
- 1 名 TypeScript 后端工程师，负责 Backend API、Ponder 与 Worker；若三者并行开发则建议增加 1 名后端/运维工程师。
- 1 名前端工程师；前四周可兼职，从真实 ABI 稳定后全时投入。
- 1 名兼职安全评审/QA，不作为合约作者的替代复核人。
- 外部智能合约审计团队独立排期。

在以上配置下，目标为 **13–15 个日历周达到审计候选版本**，外部审计和整改另需约 **4–6 周**。若只有 1 名合约工程师和 1 名全栈工程师，审计前阶段应按 **22–26 周**估算。任何时间估算都从 G0 编码门禁全部关闭后开始计算。

### 2.2 明确不做

Test Prototype 不实现以下内容，也不为其预埋可用权限或占位代码：

- BSC、跨链桥、wrapped Ticker Meme、跨链消息和双链奖励。
- LP Vault、tgLP、自动再平衡、NAV 或 LP 的 Stock Token 资格校验。
- 动态手续费、自动调参、价格锚定、做市机器人或股票价格跟踪。
- 通用治理执行器、通用 Treasury `execute`、任意 Router/任意路径调用。
- 可升级代理、桥接 minter、跨链管理员或第二套供应会计。
- K8s、微服务拆分、消息队列、复杂数据仓库，以及超出前后端分离所需的额外中台、CMS 或管理 API。
- 多个稳定币结算对、多个官方池或多个首发 Stock Token 同时上线。

Test Prototype 保留三个相互隔离的链下服务：Backend API、Ponder 索引器和 Execution Worker。Web 前端独立静态部署，不与 Backend API 打包成同一服务；Backend API 也不与持有受限执行凭据的 Worker 合并。

### 2.3 网站前后端边界

```text
Web 前端
├── Backend API ──▶ Ponder/PostgreSQL：协议历史、聚合读模型、内部元数据
├── RH RPC / v4 Quoter / StateView：公开链上实时数据
└── 用户钱包：本地模拟、签名并直接提交链上交易

Execution Worker ──▶ FeeExecutor：独立私有执行服务，不属于公共 Backend API
```

前后端分离不等于所有请求都必须绕过后端。采用以下判断规则：

- 需要数据库聚合、统一业务语义、内部元数据、分页或隐藏服务端凭据的数据，走 Backend API。
- 钱包 Provider、Robinhood RPC、canonical v4 Quoter/StateView 和链上只读合约等无私密凭据、无特权写入且来源可验证的服务，允许前端直连。
- Web 永远不能直接连接 PostgreSQL，也不直接依赖 Ponder 的内部查询接口。
- 任何直连外部服务都必须固定 chain ID/合约地址或 allowlist，设置超时、校验返回值并提供明确错误状态；不能按用户输入的任意 URL 或 Symbol 动态信任服务。
- 用户私钥和签名只存在于钱包；Backend API 不代签、不托管、不做通用 RPC 代理或交易中继。

## 3. 已冻结的开发基线

下表以 2026-09-02 最新产品确认记录为准。它们需要在 M0 中同步回协议参数和流程文档；若与旧文档中的“尚待确定”冲突，以本表为本次计划输入，但正式编码前仍需完成文档一致性签字。

| 主题 | Test Prototype 基线 | 直接实现约束 |
|---|---|---|
| 部署范围 | 仅 Robinhood Chain；主网 Chain ID 4663 | 不创建 BSC 或 bridge 目录、角色和接口 |
| 首发 Stock Token | NVDA | 上线 manifest 必须固定 Asset UID、canonical 地址、代码哈希、18 decimals、multiplier 和价格 Feed |
| 结算资产 | RH canonical-bridge USDC，主网 `0x80e0e24718dbfcad49ecaa6f1e6c89a190586ca8`，6 decimals | 部署前按地址、代码、`l1Address()`、decimals 和 ERC-20 行为校验 |
| Ticker Meme 最大供应 | 创建者只能从 10 亿、100 亿、1000 亿三个档位选择 | Factory 使用枚举或常量，不接受任意数值；部署后不可修改 |
| 排放预算 | 最大供应的股票池/LP 池预算按 70%/30% 拆分 | 先算 70%，余数归 LP 池；两池共享同一终身铸造上限 |
| 排放窗口 | `block.timestamp`；股票池 1460 天、LP 延迟 7 天并共享终点；初始 1.5 倍平均速率线性衰减至 0.5 倍，无尾部 | P-002 参考实现已完成并进入评审；每市场精确起点由 launch manifest 冻结 |
| 期末处理 | 结束时未进入 PoolReleased 的额度永久取消，不补发、不追赶 | 结束后 ReleasedBudget 增量恒为 0；既得未领取权益仍可在 PoolMinted 上限内 claim；提供 permissionless 最终结算 |
| 股票池软门槛 | 创建时按 multiplier-adjusted 官方 Feed 把 10,000 美元换算为完整 Token 并向上取整冻结 | 运行时系数为 `min(totalStaked / targetStockAmount, 1)`；不足部分不追赶；P-002 已形成参考实现并等待签字 |
| LP 排放开始 | 股票池排放开始 7 天后 | `lpEmissionStart = stockEmissionStart + 7 days`；LP 与股票池使用同一最终截止时间，启动前或零有效 LP 时错过的额度不补发 |
| 首笔 LP | 实际收到至少 500 USDC，并提供非零 Ticker Meme、形成非零 liquidity | 初始化和首笔全区间仓位原子完成；只检查实际到账值，不信任前端 `amountDesired` |
| 奖励领取 | 20% 立即到账，80% 从领取时起在 56 天线性释放 | 两个 Gauge 使用同一个领取分流规则；退出不罚没既有归属 |
| LP 模型 | Uniswap v4 canonical PositionManager NFT Gauge/Subscriber，全区间、非托管 | NFT 留在用户钱包；Gauge 不读取 Stock Token 余额或股票 Gauge |
| Swap 手续费 | 输入侧总有效 1%：LP 0.60%，协议 0.40% | 必须用 Fork 测试证明只收一次；精确 fee 编码在 G0 冻结 |
| 买入协议费 | 40% Stock Token、40% TGARD 回购销毁、20% 协议收入 | 仅记入相应用途 Bucket，不在 Swap 内执行兑换 |
| 卖出协议费 | 100% 进入该 Ticker Meme 的异步销毁 Bucket | 销毁只降低 `totalSupply`，不能降低 `MintedSupply` |
| 股票国库 | 每个市场独立 `StockTreasuryVault`，与 Token 合约分离 | Stock Token 购买输出直接进入对应 Vault，不经过 Worker 地址 |
| 社区最终命名 | 一次成功机会永久有效；7 天投票、10% quorum、2/3 赞成、7 天执行延迟、失败后 30 天冷却 | 一次成功后 metadata 永久冻结，资产身份始终使用 `marketId` 与地址 |
| 网站架构 | Web 与 Backend API 前后端分离、独立构建部署 | Ponder/PostgreSQL 数据只经 API；钱包、RH RPC、canonical v4 等公开无特权服务可由 Web 按 allowlist 直连 |

## 4. G0：生产代码开工门禁

G0 计划在 5 个工作日内完成。G0 期间可以建立空目录、CI 和一次性技术验证，但不得合并依赖未决经济参数的生产合约。每项结论需要同时写入协议文档、接口草案和对应测试条件。

| ID | 必须冻结的决定 | 当前推荐值或验证方向 | 责任角色 | 关闭标准 |
|---|---|---|---|---|
| G0-01 | `MaximumSupply` 与挖矿预算关系 | `TotalMiningBudget = MaximumSupply`，无预挖、团队份额、空投或创世分配 | 产品 + 协议 | 三个供应档位均能精确拆为 70%/30%，无额外 minter |
| G0-02 | 48 个月精确时钟与曲线 | 使用 `block.timestamp`；股票池固定 1460 天，LP 从第 7 天开始且与股票池同日结束；两个预算各自在自身有效窗口归一化，采用平滑线性衰减速率，累计函数 `B × (1.5x - 0.5x²)`，`x∈[0,1]` | 产品 + 协议 + 安全 | 给出两池逐秒累计公式、边界、舍入和参考向量；期末累计不超过各自预算 |
| G0-03 | 零份额、软门槛、暂停和错过排放 | 无有效份额或软门槛系数不足时，未实际释放的当期额度永久失效；不积压、不补发；暂停新增风险操作不暂停时间轴 | 产品 + 安全 | 股票池、LP 池分别形成状态表和 Invariant |
| G0-04 | 10,000 美元软门槛快照 | 市场创建时读取 multiplier-adjusted 官方 Feed，按完整 Stock Token **向上取整** 后冻结；不在奖励热路径持续读预言机 | 产品 + 协议 | 明确 Feed、staleness、rounding、异常和 corporate action 处理；产品确认取整方向 |
| G0-05 | RewardEscrow 有界结构 | 每个奖励来源至少 7 天领取冷却；每用户每来源最多 8 个活跃 tranche，成熟记录复用固定槽位 | 产品 + 协议 + 安全 | 任意历史长度下 claim/release Gas 有上界，56 天线性归属守恒 |
| G0-06 | Token 最小规格 | 18 decimals、不可升级、无税/黑名单/rebase、EIP-2612 Permit、ERC20Votes timestamp clock；EmissionController 为唯一 minter | 产品 + 协议 | ABI、角色、`MintedSupply` 与一次性 metadata 状态机冻结 |
| G0-07 | v4 手续费精确会计 | 先做最小 Hook Fork spike；优先将 Test Prototype 限制为 exact-input，证明用户 gross input 的 LP 费与协议费合计恰为 1% | 协议 + 安全 | 买卖方向、舍入、极小额、currency delta 和 `minAmountOut` 参考测试全部通过 |
| G0-08 | PoolKey 与首笔 LP | 冻结 currency 排序、fee flag、tickSpacing、Hook 权限位、每市场/共享 Hook；首笔必须为 canonical 全区间 | 协议 | PoolId 可重复计算；500 USDC 实际到账、非零双边资产、原子初始化和防同交易撤空测试明确 |
| G0-09 | LP beneficiary 与异常同步 | 订阅时固定当前 owner 为 beneficiary；转移先结算旧 owner，新 owner 重新订阅；`syncPosition` 只停止异常后的未来计奖，不改写历史权益 | 协议 + 安全 | 回调表、claim 收款人、零 liquidity、burn tombstone、重复通知和迁移规则冻结 |
| G0-10 | Subscriber Gas 预算 | `notifyUnsubscribe` 目标不超过 150,000 Gas，硬性低于当前 300,000 上限并保留余量 | 协议 + 安全 | RH 主网 Fork 上最坏输入 Gas 报告通过，回调 O(1) 且无外部任意调用 |
| G0-11 | 外部资产 manifest | 固定并链上校验 USDC、NVDA、TGARD、PoolManager、PositionManager、StateView、允许 Router 与路径 | 协议 + 运维 | 机器可读 manifest 和 preflight 脚本能在错误 chain/address/codehash 时 fail closed |
| G0-12 | FeeExecutor 风控 | 每种用途一个专用函数；固定 Router/路径；最小金额、间隔、单笔/每日上限、deadline、slippage、重组确认和幂等批次 | 产品 + 安全 + 运维 | 无通用 `execute`/approve；失败不消费 Bucket；TGARD 真实 burn 路径可验证 |
| G0-13 | 权限与暂停矩阵 | 建议 3/5 Safe + 48 小时普通 Timelock；独立 2/3 pause-only Guardian；国库迁移 7 天延迟 | 产品 + 安全 | 每个函数的 caller、延迟、暂停和退出行为均有矩阵及负向测试 |
| G0-14 | Factory 与市场生命周期 | 建议创建费 100 USDC；状态只保留 `REGISTERED/ACTIVE/PAUSED/RETIRED`；核心合约不可升级、按版本部署新 Factory | 产品 + 协议 | 每次合法/非法状态转换及各状态下用户退出行为冻结 |
| G0-15 | NVDA 首发参数 | 选择 10 亿/100 亿/1000 亿中的一个供应档位、初始 Symbol、股票池开始时间和创建者地址 | 产品 | 生成可审阅的 NVDA launch manifest，不留任意占位值 |

### 4.1 G0 退出检查

- [ ] 本节 G0-01 至 G0-15 全部标记为 `APPROVED`。
- [ ] `TEST_PROTOCOL_PARAMETERS.md` 与 `TEST_WORKFLOWS_AND_GAPS.md` 不再把已确认参数列为未决。
- [x] 合约名称、公共 ABI、错误、事件和角色命名不再使用旧的 `mStock` 占位词；评审基线见 `TEST_CONTRACT_ABI_SPEC.md` 与 `contracts/src/interfaces/`。
- [ ] 已有数学参考实现和至少一组不可变量测试向量。
- [ ] 主网、固定区块主网 Fork、RH 测试网三种环境 manifest 的字段 schema 已冻结。
- [ ] 产品负责人、安全负责人和合约负责人完成同一版本号的规格签字。

## 5. 里程碑与关键路径

下表的“周”是 G0 关闭后的相对日历周。Worker、索引器、Backend API 和 Web 在 ABI/事件稳定后并行进行；合约、安全测试和审计是关键路径。

| 里程碑 | 目标周 | 工作量参考 | 前置依赖 | 退出门槛 |
|---|---:|---:|---|---|
| M0 规格冻结与技术 spike | W0 | 10–15 人日 | 无 | G0 全部关闭；fee Hook、NVDA/USDC/v4 preflight 可验证 |
| M1 工程基线 | W1 | 6–8 人日 | M0 | Foundry/TS 工程、锁定依赖、CI、manifest schema 可用 |
| M2 Token、排放、Escrow、股票池 | W2–W3 | 28–35 人日 | M1 | 核心奖励 Invariant 通过，Stock Token 随时可安全取回 |
| M3 Uniswap v4、Hook、LP Gauge | W4–W6 | 35–45 人日 | M2 的排放接口 | canonical Fork 生命周期、手续费守恒和回调 Gas 通过 |
| M4 FeeExecutor、国库、Worker | W6–W7 | 24–30 人日 | M3 Hook/Vault 事件 | 四类 Bucket 端到端执行与失败回滚通过 |
| M5 Factory、命名治理、权限集成 | W7–W8 | 24–30 人日 | M2–M4 | 单交易创建市场、一次性命名、状态与权限测试通过 |
| M6 Indexer、Backend API 与真实 Web | W5–W11，并行 | 50–65 人日 | 稳定 ABI/事件 | 前后端独立部署，全部用户链路可在 Fork/测试环境操作并正确展示 |
| M7 系统硬化与上线演练 | W11–W13 | 28–38 人日 | M1–M6 | 全量测试、故障演练、可复现部署、审计候选冻结 |
| M8 外部审计与整改 | W14–W19 | 外部排期 + 15–25 人日整改 | M7 | Critical/High 为 0，整改复审完成 |
| M9 NVDA 单市场灰度上线 | 审计后 1 周 | 8–12 人日 | M8 + 法律/运维门槛 | 主网验证、限额启动、连续监控和对账正常 |

### 5.1 任务责任与当前状态

任务前缀即默认主责：`P` 为产品/协议规格，`E` 为工程基线，`C` 为智能合约，`S` 为 Worker，`I` 为索引器，`B` 为 Backend API，`W` 为 Web，`T` 为测试，`O` 为运维，`SEC` 为安全审计，`L` 为上线。安全相关任务仍需非作者复核，前缀不表示可以单人批准。

截至 2026-09-02，`P-001`、`E-001` 与 `E-004` 已完成，`P-002`、`P-003`、`P-005`、`E-002`、`E-003`、`C-101`–`C-105` 与 `T-101` 已进入评审，`P-004` 已完成可复现草案但受外部输入阻塞；P-003 已证明 RH canonical Subscriber 可行，但发现严格 0.40% 协议费、0.60% 原生 LP fee 与严格 1% 总费不能同时成立，且固定块 CI 尚缺 archive RPC。E-002/E-003 的本地等价门禁已通过，但当前目录不是 Git 仓库，尚无 hosted CI run 证据。E-004 的 RH draft preflight 已扩展为 fail closed 检查缺失的 Sequencer Uptime Feed。公共 ABI/错误/事件评审基线已建立并通过 7 项专用机器检查；C-101–C-105 共 55 项 Token/排放/Escrow/Registry/Stock Gauge 测试通过，T-101 的 3 条状态化 Invariant 完成 16,384 次随机调用且零 revert，完整 Solidity 回归为 58 项。上述候选仍等待对应 G0 签字和非作者安全复核。G0-FEE-01、G0-NAME-01/02 与 G0-POOL-01 仍未关闭。其余实施任务仍为 `TODO`，生产合约在对应规格签字前不得部署。

#### 5.1.1 执行记录

| ID | 状态 | 完成日期 | 交付证据 | 验收结果 |
|---|---|---|---|---|
| P-001 | `DONE` | 2026-09-02 | `README.md`、`TEST_PROTOCOL_PARAMETERS.md`、`TEST_TECHNICAL_ARCHITECTURE.md`、`TEST_WORKFLOWS_AND_GAPS.md` | 已同步供应档位、48 个月终止规则、Stock 软门槛、LP 延迟启动、首笔 LP、NVDA 首发和网站直连边界；冲突短语扫描无命中，Markdown 围栏成对 |
| P-002 | `REVIEW` | 2026-09-02 | `TEST_MATH_AND_STATE_MACHINES.md`、`spec/reference_math.py`、`spec/test_reference_math.py` | 已冻结推荐的预算、1460/1453 天曲线、错过排放、remainder-safe 奖励、软门槛、8 槽 Escrow、Bucket 与市场状态机；15 个测试（含 1,000 组确定性随机向量）通过，等待产品与安全签字 |
| P-003 | `REVIEW / BLOCKED` | 2026-09-02 | `TEST_V4_FEE_AND_SUBSCRIBER_SPIKE.md`、`spikes/v4-subscriber/` | 9 个 Foundry 测试通过；RH 真实仓位订阅/取消订阅和回调失败逃生均通过，完整 unsubscribe 路径为 68,528 Gas；等待 G0-07 手续费口径选择及 archive RPC 后才能固定块复现并完成生产 Hook delta 验证 |
| P-004 | `IN_PROGRESS / BLOCKED` | 2026-09-02 | `TEST_EXTERNAL_ASSET_PREFLIGHT.md`、`deployments/manifests/robinhood-mainnet.draft.json` | NVDA、USDC、v4 地址/getter/code hash 已点时核验；NVDA 当前公司行动处理中，且 TGARD canonical 信息与两条执行路径未冻结，因此不得标记完成或用于生产部署 |
| P-005 | `REVIEW` | 2026-09-02 | `TEST_PERMISSIONS_AND_PAUSE_MATRIX.md`、`TEST_CONTRACT_ABI_SPEC.md`、`contracts/src/interfaces/`、`spec/permissions_matrix.json`、`spec/contract_abi_surface.json` | 已冻结推荐的 3/5 Safe、48h Timelock、2/3 pause-only Guardian、7d 退休/国库迁移及函数级退出矩阵；接口可编译，9 项权限检查与 7 项 ABI 检查通过；等待产品/安全签字、真实地址及四项开放决策关闭 |
| E-001 | `DONE` | 2026-09-02 | `contracts/`、`website/`、`backend/`、`indexer/`、`services/execution-worker/`、`deployments/` | Web、Backend API、Indexer、Worker 均有独立入口、配置、构建和测试；Backend 2、Indexer 2、Worker 2、Web 4 项测试通过；未引入根级 monorepo 编排器或 V1 目录 |
| E-002 | `REVIEW` | 2026-09-02 | `contracts/foundry.toml`、`contracts/dependencies.lock.json`、`contracts/scripts/sync-dependencies.mjs`、三个服务各自的 `package-lock.json` / `tsconfig.json` | 已固定 Foundry 1.8.1、Solidity 0.8.26、OZ 5.7.0、v4-periphery/core/Permit2 commit、TypeScript 7.0.2 和 Node 22 types；SHA 漂移检查及本地构建通过，等待 hosted CI 复现确认 |
| E-003 | `REVIEW` | 2026-09-02 | `.github/workflows/ci.yml` | actions 与工具版本均固定；本地等价门禁通过 Solidity 58、规格 31、Backend 2、Deployments 6、Indexer 2、Worker 2、Web 4 项测试；工作流无 path skip，依赖升级会运行全套门禁；当前非 Git 仓库，等待首次 hosted run 后转 DONE |
| E-004 | `DONE` | 2026-09-02 | `deployments/schemas/environment-manifest-v0.1.schema.json`、`deployments/src/`、`deployments/test/preflight.test.ts`、`deployments/package-lock.json` | Schema 与只读 viem preflight 已冻结；6 个负向测试覆盖错误 chain、缺字段、codehash/getter 漂移和 RPC 故障；RH live run 完成 44 项检查，已填链上依赖均通过，仅对 TGARD、NVDA 公司行动和显式 blockingChecks 返回预期非零退出 |
| C-101 | `REVIEW / BLOCKED` | 2026-09-02 | `contracts/src/TickerMemeToken.sol`、`contracts/src/interfaces/ITickerMemeToken.sol`、`contracts/test/TickerMemeToken.t.sol` | 12 项单元/Fuzz 测试通过，CI profile 完成 1,000 次 Fuzz；唯一 minter、三档不可变上限、销毁不恢复额度、Permit、timestamp Votes 和一次性 metadata 均验证；runtime 9,074 bytes；等待 G0-01/G0-06 签字及非作者安全复核 |
| C-102 | `REVIEW / BLOCKED` | 2026-09-02 | `contracts/src/EmissionController.sol`、`contracts/src/libraries/EmissionMath.sol`、`contracts/test/EmissionController.t.sol` | 11 项单元/Fuzz 测试通过，CI profile 完成 1,000 次曲线 Fuzz；70/30、1460/1453 天、20/80、Gauge/Pool 绑定、错过排放不可追赶、期末双池 checkpoint 和期后 claim 已验证；runtime 4,648 bytes；等待 G0-02/G0-03 签字、真实 Gauge 集成及非作者安全复核 |
| C-103 | `REVIEW / BLOCKED` | 2026-09-02 | `contracts/src/RewardEscrow.sol`、`contracts/src/interfaces/IRewardEscrow.sol`、`contracts/test/RewardEscrow.t.sol` | 8 项单元/Fuzz 测试通过，CI profile 完成 1,000 次归属 Fuzz；56 天线性归属、固定 8 槽、第 9 次周度 claim 成熟复用、部分结清、公开代领固定 beneficiary 和 O(8) Gas 上界已验证；runtime 2,790 bytes；等待 G0-05 签字、真实 Controller 集成及非作者安全复核 |
| C-104 | `REVIEW / BLOCKED` | 2026-09-02 | `contracts/src/OfficialStockRegistry.sol`、`contracts/src/interfaces/IOfficialStockRegistry.sol`、`contracts/src/interfaces/external/`、`contracts/test/OfficialStockRegistry.t.sol` | 10 项单元测试通过；Asset UID/Token 双唯一、18 decimals、Feed 描述/decimals/codehash、multiplier、公司行动、预言机暂停/陈旧、Sequencer 恢复宽限、Guardian 单向暂停和永久退休均 fail closed；runtime 7,121 bytes；不作为 LP 质押资格；等待 G0-04/G0-11 签字、RH canonical onchain Sequencer Uptime Feed 地址、Beacon 升级漂移策略及非作者安全复核 |
| C-105 | `REVIEW / BLOCKED` | 2026-09-02 | `contracts/src/StockStakingGauge.sol`、`contracts/src/interfaces/IStockStakingGauge.sol`、`contracts/test/StockStakingGauge.t.sol` | 14 项单元/集成/Fuzz 测试通过，CI profile 完成 1,000 次软门槛 Fuzz；实际到账精确校验、fee-on-transfer 拒绝、重入阻断、低于门槛按比例释放、零质押错过、后加入不追溯、O(1) 指数/remainder、7 天领取冷却、20/80 Controller 集成、暂停可退出/领取及退休停止未来释放均验证；runtime 6,127 bytes；等待 P-002/G0-04/G0-05 签字、真实 MarketController/Factory 集成、Stock Token rebase/代理升级兼容策略及非作者安全复核 |
| T-101 | `REVIEW` | 2026-09-02 | `contracts/test/invariant/StockStakingGaugeInvariant.t.sol`、`contracts/.gas-snapshot`、C-101–C-105 单元/Fuzz 测试 | 3 条状态化 Invariant 在 CI profile 下完成 256 runs × 64 depth = 16,384 次随机 stake/withdraw/checkpoint/claim，零 revert；验证本金托管严格相等、用户份额和总额相等、`PoolMinted <= PoolReleased <= Scheduled` 及软门槛 remainder 上界；55 项核心测试 Gas 基线已生成；等待非作者安全复核及真实 Factory/MarketController 端到端后转 DONE |
| C-201 | `BLOCKED` | — | G0-FEE-01、G0-POOL-01、`TEST_CONTRACT_ABI_SPEC.md` | canonical `fee/tickSpacing/Hook` 尚未冻结，且已冻结的 13 模块 ABI 中不存在独立 Pool Registry；在决定 PoolKey 归属模块前不新增隐藏第 14 模块、不硬编码猜测费率。可并行推进不依赖 PoolKey 的 C-203 |

关键路径为：

```text
G0 参数冻结
→ 排放/供应/RewardEscrow
→ v4 Hook 与 LP Subscriber
→ FeeVault/FeeExecutor
→ Factory 总集成
→ RH 主网 Fork 全链路
→ 独立审计与整改
→ NVDA 单市场灰度
```

## 6. 详细工作分解表

### 6.1 M0–M1：规格与工程基线

| ID | 任务 | 产物 | 依赖 | 估算 | 验收标准 |
|---|---|---|---|---:|---|
| P-001 | 把最新确认参数同步至三份核心文档 | 一致的参数、架构和流程基线 | 无 | 1.5 人日 | 全文搜索无相互冲突的供应、门槛、LP 启动和首笔 LP 描述 |
| P-002 | 冻结数学与状态机 | 排放、软门槛、奖励指数、归属、Bucket、市场状态参考规格 | P-001 | 3 人日 | 每条公式有边界值、舍入方向、示例和对应测试 ID |
| P-003 | v4 手续费与 Subscriber spike | 一次性 Foundry Fork 验证 | P-002 | 3 人日 | exact-input/输出策略、fee delta、Subscriber ABI 与 Gas 结论可复现 |
| P-004 | NVDA/USDC/TGARD/v4 资产核验 | 首发 manifest 草案与 preflight 输出 | 无 | 2 人日 | 地址、代码、代理、Feed、multiplier、burn 和 Router/路径均有证据 |
| P-005 | 权限、暂停与退出矩阵 | 函数级角色表和状态转换表 | P-002 | 2 人日 | 任意暂停状态下 withdraw/unsubscribe/claim/release 路径明确 |
| E-001 | 创建最小工程目录 | `contracts/`、`website/`、`backend/`、`indexer/`、`services/execution-worker/`、`deployments/` | G0 | 1 人日 | Web、Backend API、Indexer 和 Worker 有独立入口/配置/构建；不引入 monorepo 编排器或 V1 目录 |
| E-002 | 锁定依赖和构建配置 | Solidity 0.8.26、Foundry、OZ 5.x、v4 commit、TS lockfile | E-001 | 1 人日 | 本地与 CI 的编译产物一致；升级依赖会触发完整测试 |
| E-003 | 建立 CI 最小门禁 | format、build、unit、fuzz smoke、前端 build/test | E-002 | 1.5 人日 | 任一门禁失败不能生成部署产物 |
| E-004 | 建立环境 manifest/preflight 框架 | JSON schema、读取库、链上校验脚本 | P-004, E-002 | 2 人日 | chain ID、地址、codehash、关键 getter 任一不符即停止部署 |

### 6.2 M2：Token、排放、Escrow 与股票池

| ID | 任务 | 产物 | 依赖 | 估算 | 验收标准 |
|---|---|---|---|---:|---|
| C-101 | 实现 `TickerMemeToken` | 不可升级 ERC-20、Permit/Votes、一次性 metadata、`MintedSupply` | G0-01, G0-06 | 4 人日 | 仅 EmissionController 可铸造；销毁不恢复额度；三档上限不可修改 |
| C-102 | 实现排放数学库与 `EmissionController` | 股票/LP 两预算、起止时间、累计曲线、最终取消 | C-101, G0-02, G0-03 | 5 人日 | 任意更新时间/调用顺序下累计不超过预算；期末后增量恒为 0 |
| C-103 | 实现有界 `RewardEscrow` | 20%/80% 分流、56 天线性释放、固定槽位 | C-101, G0-05 | 5 人日 | 历史领取次数不造成无界循环；所有舍入资产守恒 |
| C-104 | 实现 `OfficialStockRegistry` 与最小 Stock 适配 | Asset UID、canonical 地址、状态、Feed/multiplier 配置 | G0-04, G0-11 | 4 人日 | 同一 Asset UID 唯一；错误 Token/Feed/decimals 被拒绝；不参与 LP 资格 |
| C-105 | 实现 `StockStakingGauge` | 存取、软门槛系数、O(1) 奖励、claim | C-102–C-104 | 6 人日 | 使用实际质押余额；系数封顶 1；暂停时仍可提取本金和既有奖励 |
| T-101 | 核心供应与奖励测试 | 单元、Fuzz、Invariant、Gas snapshot | C-101–C-105 | 6 人日 | 覆盖零质押、门槛上下边界、多人顺序、期末、Dust、重入和权限 |

### 6.3 M3：Uniswap v4 官方池、Hook 与 LP Gauge

| ID | 任务 | 产物 | 依赖 | 估算 | 验收标准 |
|---|---|---|---|---:|---|
| C-201 | 实现 canonical PoolKey 登记 | PoolKey/PoolId 不可变绑定与环境地址校验 | G0-08, E-004 | 3 人日 | 非 canonical fee/tickSpacing/Hook/币对均不能获得官方状态 |
| C-202 | 实现 `PermissionlessInitializer` | 原子 initialize + 首笔全区间 liquidity | C-201 | 5 人日 | 实际 USDC ≥500、双边非零、liquidity 非零；失败全部回滚；不能重复初始化 |
| C-203 | 实现 `ProtocolFeeVault` | 按 market/asset/type 隔离的四类 Bucket | G0-07, G0-12 | 4 人日 | 存入、消费、Dust 和失败回滚资产守恒；无任意提取/调用 |
| C-204 | 实现 `TickerGardenV4Hook` | canonical Pool 校验、方向识别、0.40% 记账 | C-201, C-203 | 7 人日 | 买卖只收费一次；整数边界、极小额和非法 Pool 全覆盖；Hook 不执行外部兑换 |
| C-205 | 实现 `CanonicalLPNFTGauge` | 非托管 `ISubscriber`、O(1) liquidity-time 奖励 | C-102, C-103, C-201, G0-09 | 8 人日 | 无 Stock 门槛；全区间/canonical 校验；转移、modify、unsubscribe、burn 正确结算 |
| C-206 | 实现 `syncPosition` 与迁移/逃生语义 | permissionless O(1) 对账和停止未来计奖 | C-205 | 3 人日 | 幂等；不改写历史 beneficiary；异常 Gauge 不阻止用户先 unsubscribe 后操作 NFT |
| T-201 | RH 主网 Fork v4 集成与 Gas 测试 | 固定区块测试套件、Gas 报告 | C-202–C-206 | 7 人日 | 真实 PositionManager 生命周期通过；unsubscribe 最坏 Gas 满足 G0-10 |

### 6.4 M4：FeeExecutor、国库与异步 Worker

| ID | 任务 | 产物 | 依赖 | 估算 | 验收标准 |
|---|---|---|---|---:|---|
| C-301 | 实现 `StockTreasuryVault` 与 `ProtocolTreasury` 接口 | 每市场单资产 Vault、受限迁移、收入接收 | G0-11–G0-13 | 4 人日 | 正常状态无 Stock Token 提取/approve/execute；资产迁移受 Timelock 限制 |
| C-302 | 实现专用 `FeeExecutor` | 股票购买、TGARD buy-and-burn、Ticker Meme burn、收入划拨 | C-203, C-301 | 7 人日 | 每函数只消费匹配 Bucket；输出直达目标；失败原子回滚；无通用调用 |
| C-303 | 执行安全测试 | Router/路径、滑点、deadline、限额、重复批次和重入测试 | C-302 | 5 人日 | 报价过期、Router 回滚、重复提交、递归 Hook 路径均不能损失或错记资产 |
| S-301 | 实现 Execution Worker | 读取、报价、模拟、提交、确认、重试与告警 | C-302 ABI | 7 人日 | Worker 不持有资产；幂等批次、nonce replacement、重组和崩溃恢复通过 |
| S-302 | 实现链上/链下对账 | Bucket、Vault、burn、收入余额对账任务 | S-301 | 3 人日 | 可从链上事件恢复状态；异常只告警，不自动执行任意补偿转账 |

### 6.5 M5：Factory、命名治理与总集成

| ID | 任务 | 产物 | 依赖 | 估算 | 验收标准 |
|---|---|---|---|---:|---|
| C-401 | 实现一次性 `NamingGovernor/Executor` | timestamp 快照投票、quorum、2/3、延迟和冷却 | C-101, C-104, G0-06 | 7 人日 | 防重复投票；失败不消耗权利；第一次成功后任何角色都不能再改名 |
| C-402 | 实现 Symbol 永久唯一和历史别名 | Registry 占用、原子 finalize、历史查询 | C-401 | 3 人日 | 并发占用时全交易回滚；旧 Symbol 永不复用；`marketId` 不变 |
| C-403 | 实现 `TickerGardenFactory` | 标准化原子部署、供应档位、模块绑定、创建费；普通模块优先使用简单 CREATE，仅 v4 Hook 在权限地址位需要时使用 CREATE2 | C-101–C-302, G0-14 | 7 人日 | 同一 Asset UID 只能成功一次；任意失败不留下半创建市场 |
| C-404 | 实现市场生命周期和权限 | `REGISTERED/ACTIVE/PAUSED/RETIRED`、角色与 Timelock | C-403, G0-13 | 4 人日 | 状态切换不能冻结本金、历史奖励、LP NFT 或已解锁归属 |
| T-301 | Factory 全市场集成测试 | 从 Registry 到市场创建的端到端测试 | C-401–C-404 | 5 人日 | 三供应档位、重复资产/Symbol、角色撤销、暂停/恢复和失败回滚全覆盖 |

### 6.6 M6：Ponder、Backend API 与真实 Web

| ID | 任务 | 产物 | 依赖 | 估算 | 验收标准 |
|---|---|---|---|---:|---|
| I-501 | 建立 Ponder schema 与处理器 | 市场、质押、奖励、LP、Swap、Bucket、国库、命名实体 | 稳定事件 schema | 7 人日 | 每条读模型都能追溯到 chain/block/tx/log；无链下自造余额 |
| I-502 | 实现回滚、重放和健康检查 | checkpoint、重建脚本、RPC/漏块监控 | I-501 | 4 人日 | 空库可完整重建；重复日志幂等；reorg 后结果与链上一致 |
| B-501 | 建立独立 Backend API | Node.js/TypeScript/Fastify、配置、健康检查、REST/OpenAPI | I-501 | 4 人日 | 可独立构建部署；使用 PostgreSQL 只读账号；不包含 Worker 密钥或交易入口 |
| B-502 | 实现协议读模型接口 | 市场、地址仓位、奖励、LP 历史、Swap、Bucket、国库、命名查询 | B-501, I-501 | 6 人日 | 游标分页、固定最大 page size、来源区块和索引同步状态完整；参数化查询 |
| B-503 | 实现 API 安全与可观测性 | schema 校验、CORS allowlist、限流、超时、错误格式、request ID、日志和指标 | B-501 | 4 人日 | SQL 注入、超大分页、错误泄露和资源滥用测试通过；API 故障不返回伪造成功状态 |
| B-504 | 发布类型安全 API 客户端 | 版本化 OpenAPI schema 与生成客户端 | B-502, B-503 | 2 人日 | Web 不手写响应类型；破坏性接口变更必须升版 |
| W-501 | 将 Web 迁移到 TypeScript 分层交互 | viem/wagmi、RH chain、typed ABI、生成 API client、交易状态机 | 稳定 ABI, B-504 | 6 人日 | 数据库读模型走 API；钱包/RH RPC/canonical v4 公开数据按 allowlist 直连；各失败状态可区分 |
| W-502 | 实现市场创建与股票质押页面 | 创建、approve、stake、withdraw、claim、release | W-501, B-502 | 6 人日 | 所有写操作先模拟；展示软门槛系数和 20%/80% 明细 |
| W-503 | 实现官方池与 LP 页面 | 初始化、加流动性、subscribe、sync、unsubscribe、逃生指引 | W-501, C-202/C-205 ABI | 7 人日 | 即时 v4/仓位数据直读 canonical Quoter/StateView/PositionManager；历史数据走 API；零 Stock 余额可操作 |
| W-504 | 实现 Swap 与手续费状态页面 | 按 G0-07 冻结的 Swap 类型、v4 直连报价、费用拆分、Bucket/回购/销毁/国库状态 | W-501, B-502 | 6 人日 | Quoter 地址来自 manifest；最终交易本地模拟；待执行不得显示为已完成 |
| W-505 | 实现命名与风险披露页面 | 提案/投票/执行、历史 Symbol、资产地址与风险说明 | W-501, B-502 | 4 人日 | Symbol 不作为身份主键；改名期间显示旧别名；风险确认可测试 |
| T-401 | Web/API/Indexer 端到端测试 | 浏览器关键链路、OpenAPI 契约、公开服务直连、API 故障、Ponder 延迟与重建 | I-501, I-502, B-501–B-504, W-501–W-505 | 7 人日 | Web 不直连 Ponder/PostgreSQL；API 不代理无必要的 v4 数据；所有构建与测试通过 |

### 6.7 M7–M9：硬化、审计与上线

| ID | 任务 | 产物 | 依赖 | 估算 | 验收标准 |
|---|---|---|---|---:|---|
| T-501 | 扩展全协议 Fuzz/Invariant | 长时间、多用户、多市场、恶意调用序列 | 全部合约 | 7 人日 | 第 7 节全部不可变量持续通过，无未解释 counterexample |
| T-502 | 静态分析与人工安全复核 | Slither/编译器告警、逐模块检查表 | 全部合约 | 4 人日 | 高风险告警关闭；抑制项逐条给出理由 |
| O-501 | 部署与源码验证脚本 | dry-run、v4 Hook CREATE2 地址/权限位预测、角色移交、验证、回滚停止点 | E-004, 全部合约 | 4 人日 | 新环境可一键 dry-run，但生产每一步仍需人工核对和多签确认 |
| O-502 | 监控、告警和事故手册 | RPC、Backend API、Indexer、供应、Escrow、Bucket、Worker、国库、Subscriber 告警 | S-302, I-502, B-503 | 6 人日 | API/Indexer/Worker 分别停机、RPC 故障、积压、权限变更和余额偏差演练成功 |
| T-503 | 测试环境/固定 Fork 全链路演练 | 部署、创建 NVDA 测试市场、前端/后端分离部署和完整用户旅程 | O-501, B-504 | 6 人日 | 测试专用地址与主网 manifest 隔离；Web/API/Indexer/Worker 故障域独立；退出与恢复路径均可执行 |
| SEC-501 | 冻结审计候选版本 | commit、构建哈希、范围、威胁模型、测试报告 | T-501–T-503 | 2 人日 | 审计期间除审计修复外不再加入功能 |
| SEC-502 | 外部审计和整改 | 审计报告、修复 PR、回归测试、复审 | SEC-501 | 外部排期 | Critical/High 为 0；修复未引入新功能或新权限 |
| L-501 | NVDA 主网 launch manifest | 最终参数、地址、时间、角色、Router/路径、限额 | SEC-502, G0-15 | 2 人日 | 无占位地址或未决数值；所有 preflight 通过并由多人复核 |
| L-502 | 部署与角色移交 | 已验证合约、Safe/Timelock/Guardian 权限 | L-501 | 2 人日 | 部署者放弃不需要的角色；源码、ABI、构造参数公开可核对 |
| L-503 | NVDA 单市场灰度 | 只启用 NVDA，执行限额和连续监控 | L-502 | 3–5 人日 | 至少 72 小时供应、质押、LP、Bucket、Worker 和国库对账正常后再解除灰度限额 |

## 7. 必须持续通过的安全不可变量

| 类别 | 不可变量 |
|---|---|
| 供应 | `PoolMinted <= PoolReleased <= PoolBudget`；`MintedSupply <= MaximumSupply`；burn 不恢复额度；排放结束后 ReleasedBudget 增量恒为 0，claim 只能铸造既得额度 |
| 预算 | 股票池累计铸造不超过 70% 预算；LP 池不超过 30%；两池与期末取消额之和不超过最大供应 |
| 排放 | LP 在股票池开始前及其后 7 天内无排放；错过排放不追赶；调用频率和顺序不能改变总累计曲线 |
| 软门槛 | 股票池系数始终位于 `[0,1]`；总质押低于目标时只降低释放速率，不改变用户间按份额分配 |
| 奖励 | 用户累计领取、未领取、Escrow 未释放和已释放奖励守恒；解锁量随时间单调不减；退出不罚没 |
| Gas | claim、release、Subscriber 回调和 `syncPosition` 的成本不随历史记录或全局用户数无界增长 |
| LP | 只有 canonical PositionManager + PoolId + 全区间 + 非零 liquidity 能计奖；Stock Token 状态永不影响 LP 资格 |
| NFT 权益 | 转移前奖励只属于旧 beneficiary；新 owner 重新订阅后从新起点计奖；异常同步不重写历史权益 |
| 手续费 | 对任一成功 Swap，LP fee + protocol fee 等于冻结的 1% 有效输入费；同一资产单位不能被重复收费 |
| Bucket | Bucket 增量、已消费额和余额逐笔守恒；用途不混用；失败执行不减少 Bucket |
| 国库 | Stock Token 购买输出直接进入匹配市场 Vault；不同股票不混用；正常状态无任意提取、approve 或外部调用 |
| 权限 | 创建者、Worker、Guardian、多签或 Timelock 任一单独角色都不能任意增发、改供应、转用户资产或改历史奖励 |
| 用户退出 | 普通暂停下 Stock Token withdraw、LP unsubscribe/transfer/remove/collect、既有 claim 和 `releaseVested` 始终可用 |
| 链下独立性 | Worker、Indexer、Backend API、数据库和 Web 全部离线时，链上余额、奖励和用户退出能力不改变 |
| 前后端边界 | Web 不直连 Ponder/PostgreSQL；Backend API 不持有用户/Worker 私钥、不代签、不写链上读模型；允许直连的外部服务仅限经 manifest/allowlist 校验的公开无特权数据源 |

## 8. 测试矩阵

| 测试层 | 最低范围 | 执行时机 |
|---|---|---|
| 单元测试 | 每个公共/外部函数的成功、边界、权限、暂停和失败路径 | 每次 PR |
| Fuzz | 金额、时间、供应档位、质押人数、调用顺序、舍入、tick、liquidity、fee delta | 每次 PR 的短集；每日完整集 |
| Invariant | 第 7 节全部资产、供应、预算、退出和权限不可变量 | 每日及 release candidate |
| RH 主网 Fork | USDC、NVDA、v4 PoolManager/PositionManager/Subscriber、Router 和真实 ERC-20 行为 | v4/资产相关 PR 及 release candidate |
| 差分测试 | Solidity 排放、归属和手续费结果对照 TypeScript/Python 参考向量 | 数学逻辑变更时 |
| Worker 集成 | 报价、模拟、nonce replacement、重组、重复提交、RPC 故障、崩溃恢复 | 每次 Worker release |
| Ponder 集成 | 重复日志、reorg、漏块、断点续扫、空库重建 | 每次 schema/handler 变更 |
| Backend API | OpenAPI 契约、schema、分页、参数化查询、只读 DB、CORS、限流、超时、错误脱敏、依赖故障 | 每次 API release |
| Web 集成 | API client、钱包/RH RPC/v4 直连 allowlist、错网、授权、拒签、模拟失败、replacement、API/索引延迟、关键旅程 | 每次 Web release |
| 前后端 E2E | Web 与 API 独立部署、API 版本兼容、Ponder 不对 Web 暴露、Worker 凭据隔离、各服务故障降级 | 每次 release candidate |
| 部署演练 | manifest preflight、dry-run、源码验证、Safe/Timelock 角色移交、暂停/恢复 | 每个环境及主网上线前 |

## 9. 分支、评审与变更控制

- 每个任务使用上表 ID；一个 PR 只解决一个可独立验收的问题。
- 合约 PR 必须包含测试和不变量影响说明；资金或权限代码至少由一名未参与编写的合约工程师复核。
- 供应、排放、fee、Bucket、Treasury、用户退出和角色变更必须先修改规格，再修改实现。
- ABI/事件冻结后，Indexer、Worker、Backend API 和 Web 从构建产物生成合约类型；Web 的业务读模型从 Backend API OpenAPI schema 生成客户端，不手工复制响应类型。
- 审计候选版本冻结后只接受审计修复、测试增强和文档澄清；任何功能变更都重新进入评审和审计范围确认。
- 主网合约不采用代理升级。发现缺陷时部署新版本并使用明确迁移状态；旧 Gauge 继续保留 claim、unsubscribe 和 sync 等退出路径。

任务状态统一使用：

| 状态 | 含义 |
|---|---|
| `TODO` | 依赖已满足但尚未开始 |
| `IN_PROGRESS` | 已有负责人和正在进行的工作 |
| `BLOCKED` | 有明确未关闭依赖；必须记录阻塞 ID |
| `REVIEW` | 实现完成，等待代码/安全/产品验收 |
| `DONE` | 验收证据已链接且所有门禁通过 |

## 10. 上线前外部阻塞项

以下事项不应被开发团队用占位值绕过：

| 阻塞项 | 最晚关闭时间 | 说明 |
|---|---|---|
| NVDA canonical Asset UID、地址、codehash/proxy、Feed、multiplier 与 corporate action 状态 | M0 | 错误资产会直接破坏质押和软门槛计算 |
| NVDA 首发供应档位、初始 Symbol、股票排放开始时间 | M0 | 属于不可变 launch manifest 参数 |
| TGARD canonical 地址、真实 burn 接口、官方池和允许路径 | M0 | TGARD 回购销毁是 Test Prototype 必备，不能先上线后补 |
| 多签成员、阈值、Timelock、Guardian 和最终 Treasury 地址 | M7 前 | 必须在部署演练中使用真实控制结构 |
| Worker 执行限额、滑点、积压和停机告警阈值 | M7 前 | 不能只存在于链下配置，链上需有安全上限 |
| 独立安全审计档期 | M5 前预订 | 避免审计排期成为完成开发后的长期阻塞 |
| 法律、地域准入、Stock Token 国库和回购宣传评估 | M8 结束前 | 未完成不得开放主网前端交互 |

## 11. 上线顺序

1. 冻结审计后的 commit、编译器、依赖、构建哈希和主网 manifest。
2. 在固定主网 Fork 使用同一脚本完整部署，并执行全部 preflight 和 smoke test。
3. 主网部署 Registry、核心共享模块和受限权限合约，立即验证源码。
4. 将权限从部署地址移交给 Safe、Timelock 和 Guardian，并撤销部署者多余角色。
5. 登记 NVDA，创建唯一首发 Ticker Meme 市场；暂不开放其他 Stock Token。
6. 复核三档供应中的最终选择、10,000 美元软门槛快照、股票池开始时间和 LP 开始时间。
7. 开放股票质押；7 天后按既定时间轴开放 LP 排放。首笔 LP 仍由任意用户无许可完成。
8. 对 Hook、Bucket、Worker 和 Treasury 使用保守的单笔/每日限额；连续 72 小时人工加自动对账。
9. 只有供应、Escrow、LP Subscriber、Bucket、burn 和国库对账全部正常，才解除灰度限额并考虑登记第二只股票。

发生异常时只暂停新增风险操作。不得通过暂停阻止 Stock Token 本金取回、LP NFT 退出、历史奖励领取或已解锁归属释放。

## 12. 计划维护规则

- 每周更新一次里程碑状态、实际人日、风险和下一周关键路径。
- 每个 `BLOCKED` 项必须指向 G0、任务 ID 或外部阻塞项，不能只写“待确认”。
- 任何新增 Test Prototype 功能都必须说明它是否是 DoD 必需项；若不是，默认移入 Test Prototype.1/V1 backlog。
- 实际开发顺序可以根据并行人力微调，但不得绕过 G0、M7、M8 和主网上线门禁。
- 本计划只管理 Test Prototype。BSC 和跨链方案继续保留在架构文档的 V1 章节，不进入本计划的工期和验收范围。
