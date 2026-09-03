# TickerGarden V2 详细开发任务

> 文档状态：`IMPLEMENTATION_ALLOWED`；可以实现产品资金逻辑，deployment gates 关闭前禁止目标网络部署  
> 更新时间：2026-09-03  
> 适用版本：Robinhood Chain，TickerGarden V2 / `V2-EXEC-3`  
> 当前实现状态：`V2_INTERFACE_BASELINE_READY / CI_GATES_READY / QUOTE_FIXTURES_READY / PRODUCT_RUNTIME_IN_PROGRESS / IMPLEMENTATION_ALLOWED`；V1运行时代码已移出工作区，Solidity十九个产品模块（含只读 `LaunchConfigResolver`）、`V2-C-405`状态缺口修复、Indexer重放/对账、Backend只读API、无特权Maintenance Runner及Web的Launch/Curve、Vault与Emergency Recovery本地产品旅程均已实现并由分轨门禁验证；Web资金相关target已由Factory不可变信任根逐次回绑链上Registry。Product为`ACTIVE`、Fork为仅本地固定夹具的`FIXTURES_ACTIVE`、Deployment工具为`ACTIVE`。完整产品运行时仍保持fail-closed：目标链archive Fork、毕业池写旅程、法律文案签字、浏览器E2E、AccessManager安装、审计及生产部署证据尚未完成
> 产品规则：[V2_PROTOCOL_PARAMETERS.md](./V2_PROTOCOL_PARAMETERS.md)  
> 技术架构：[V2_TECHNICAL_ARCHITECTURE.md](./V2_TECHNICAL_ARCHITECTURE.md)  
> 合约架构优化决策：[V2_CONTRACT_ARCHITECTURE_DECISION.md](./V2_CONTRACT_ARCHITECTURE_DECISION.md)
> Stock Vault 优化决策：[V2_MULTI_ASSET_STOCK_VAULT.md](./V2_MULTI_ASSET_STOCK_VAULT.md)
> 执行规范：[V2_EXECUTION_SPEC.md](./V2_EXECUTION_SPEC.md)  
> 机器基线：[`spec/v2_execution_manifest.json`](./spec/v2_execution_manifest.json)、[`spec/v2_abi_surface.json`](./spec/v2_abi_surface.json)、[`spec/v2_permissions_matrix.json`](./spec/v2_permissions_matrix.json)

本文把 V2 文档转换为可分配、可测试、可验收的开发任务。V2 使用全新的合约与接口命名空间，不覆盖 V1 文档、V1 合约或 V1 任务记录。任何任务若需要改变已确认的收费资产、手续费比例、毕业语义、STOCK 本金退出、30 秒激活、24 小时锁定、状态迁移或权限边界，必须先修改规范、机器清单和参考测试，开发者不得在代码中自行补默认值。

## 1. V2 交付目标

V2 要在 Robinhood Chain 上跑通以下闭环：

```text
登记官方 STOCK、Quote、Pons baseline 与 Launch Template
→ 创建 Ticker Meme 或原子 launch-and-buy
→ 创建者从 ACTIVE 官方 STOCK 中选择恰好一种作为该市场不可变 staking base
→ 在 Pons-compatible Curve 上买卖并累计曲线费用
→ 达到 baseline 毕业条件后 sweep、建 Uniswap v4 canonical pool、锁定初始 LP
→ Hook 对毕业池每笔交易按实际收费资产收取 1%
→ 20% donate 给 LP，80% 进入 FeeVault
→ 毕业后用户把对应 STOCK 分配给任意 Meme Gauge
→ 新增份额等待 30 秒激活，整个合并仓位锁定 24 小时
→ 质押者份额按 `min(S,B)/B` 线性释放，`B=10×10^stockDecimals`；S=0时40/0/40/20，S>=B时20/40/20/20
→ Creator、STOCK 质押者、Platform 按同资产领取，Token 侧不转换
→ 普通暂停不阻塞历史领取和到期退出；Gauge 故障时本金可终态逃生
→ Indexer、Backend API、Web、监控和部署清单可独立验证链上结果
```

### 1.1 Definition of Done

只有同时满足以下条件，V2 才能标记完成：

| 编号 | 完成条件 | 验证证据 |
|---|---|---|
| V2-DoD-01 | Pons baseline、Quote、Launch Template、所选官方 Asset UID 和已登记差异全部由不可变 market snapshot 约束 | 配置 manifest、行为参考向量、创建与非法变更测试 |
| V2-DoD-02 | Curve 的 buy/sell/sweep/graduation 与已签字 Pons baseline 等价，所有差异均有显式 ID 和测试 | 差分测试、固定向量、审计记录 |
| V2-DoD-03 | canonical v4 PoolKey、Hook mask `0x2044`、core fee 0、afterSwap 1%、LP donate 20% 和 non-LP take 80% 可逐笔守恒 | 目标链固定 Fork、Fuzz、Invariant 和余额差证明 |
| V2-DoD-04 | 毕业前 Gauge 无仓位；毕业后 30 秒激活、24 小时锁定、`> 0.5 STOCK`、增减仓和迁移在任意调用顺序下正确 | 状态机、边界、差分和 Gas 测试 |
| V2-DoD-05 | Quote 与 Meme 两种奖励资产完全隔离；Creator、Staker、Platform 的负债、历史 beneficiary 和领取均与实际到账一致 | 双资产会计 Invariant、恶意 Token 与转账失败测试 |
| V2-DoD-06 | Curve 完成、Swept、自动毕业失败、permissionless retry、七日 rescue 和 PoolCreated 不产生半完成市场 | native/ERC-20 graduation Fork 测试与故障注入 |
| V2-DoD-07 | 普通暂停不阻塞历史 claim、成熟 pending、到期退出和 free STOCK 提取；Emergency 后本人可不依赖 Gauge 释放本金 | 权限/暂停矩阵、故障演练、终态 Invariant |
| V2-DoD-08 | Recovery snapshot、cap、root、claim 和防重放可唯一验证，错误或未最终确认的 root 不能发放资产 | Merkle 测试向量、cap Invariant、恢复演练 |
| V2-DoD-09 | 每个 mutation selector 的 target、caller、role、delay 和 recipient 与最终编译 artifact 及机器矩阵完全一致 | 自动 selector diff、链上 AccessManager preflight |
| V2-DoD-10 | 单个 STOCK 对应上万个 Meme 时，链上热路径仍有界，Indexer 可从事件重建并正确处理 reorg | 规模/Gas 基准、空库重建和回滚测试 |
| V2-DoD-11 | Web 所有写操作先模拟；显示 canonical pool、实际费用资产、pending/active/unlock、收益来源和风险，不沿用 V1 挖矿叙事 | 浏览器 E2E、人工验收、合规文案签字 |
| V2-DoD-12 | V2 deployment manifest、CREATE2 地址、codehash、角色移交、源码验证、监控、事故手册和独立审计全部完成 | 上线清单、演练记录、最终审计与复审报告 |
| V2-DoD-13 | `V2-GAP-001`～`V2-GAP-012` 全部关闭；V2 artifact/测试/部署证据独立于V1，任何未决或占位字段都不能被绿灯掩盖 | 差距关闭记录、分轨CI、forbidden-import扫描、零占位preflight |

## 2. 开工规则与当前门禁

### 2.1 版本边界

- V2 合约放入新的 V2 namespace；不得把 V1 的 EmissionController、RewardEscrow、StockStakingGauge、LP Subscriber 挖矿或异步回购 Bucket 带入 V2。
- 保留的 V1 历史文档和废纸篓中的可恢复归档只能作为工程模式或安全经验来源，不能进入 V2 编译图，也不能作为 V2 ABI 或经济语义来源。
- V2 固定供应 Meme Token、Factory、Curve、Vault、Gauge、Hook、FeeVault、Graduation 和 Recovery 均需新的接口、实现、测试和部署记录。
- V2 用户安全不能依赖 Indexer、Backend、Web、Keeper 或数据库在线。

### 2.2 已冻结规则的处理

以下经济与执行方向继续作为实现输入，不因本计划重开：

- 实际收费资产不转换；Quote 侧分 Quote，Meme 侧分 Meme。
- 曲线阶段无 STOCK 质押，曲线 non-LP 费用 Creator/Platform 各 50%。
- PoolCreated 后总交易费 1%，LP 固定20%；每市场冻结 `B=stakeSaturationAmount=10×10^stockDecimals`，质押者总 Bucket 按 `min(totalActiveStock,B)/B` 从0线性释放到总费约40%，Creator/Platform 对称承接余量；质押者桶内部按有效 STOCK raw unit 比例分配。
- 新增 STOCK 30 秒后激活，从分配交易起整个合并仓位锁定 24 小时。
- 每个非零市场仓位严格大于 `0.5 STOCK`，不要求 0.5 的整数倍。
- 当前观测的194种 ACTIVE 官方 STOCK 全部可作为 staking base；每个 Asset UID 绑定一个 canonical Vault，但多个 UID 共享当前 schema 的 MultiAsset Vault；一个 Meme 创建时选择且只绑定一个不可变 Asset UID/Gauge，同一 STOCK 可对应任意多个 Meme，用户可在这些 Meme 之间自行分配。
- STOCK 价格、美元名义价值、Chainlink Feed、sequencer 和 backing target 不进入准入、收费或质押分配逻辑。
- 发行行为以活跃 `0x7eD598…` 固定区块为参考，不运行时依赖 Pons；多 Quote 是正式能力。
- 当前 Factory 创建费 immutable 为 `0.0005` 原生资产并精确支付；改费必须新 Factory/Router/Template 和新 `executionSpecId`；atomic launch-and-buy 不设人为的毕业门槛1%首买上限。
- Curve 保留量、真正入池 Meme 和永久锁定 excess 使用两级公式，不把 `reservedTokens` 全部直接注入 LP。

上一轮审查发现 `V2-FROZEN-STATE-ABI-01` 的跨合约写路径尚未闭合。V2-M0 将其视为 `REOPEN_REQUIRED`；这只重开状态权威、组合调用、恢复和 canonical ABI，不授权修改上述经济规则。

### 2.3 未关闭的部署与生产阻塞项

以下现有 ID 保持硬门禁，不得使用占位值绕过：

| ID | 必须关闭的内容 | 最晚关闭时间 |
|---|---|---|
| `V2-G0-PONS-SECURITY-01` | 源码许可、baseline 等价性和独立安全签字 | V2-M7 审计候选前；许可与源码范围在 V2-M0 |
| `V2-G0-LEGAL-01` | 地区准入、收益和风险披露 | V2-M6 Web 文案冻结前 |

`V2-G0-LAUNCH-FEE-GOVERNANCE-01` 已关闭：选择 `APPROVED_IMMUTABLE_PER_FACTORY`，当前封闭 mutation ABI 不增加 setter 或调价事件。`V2-G0-PONS-RUNTIME-VECTORS-01`、`V2-G0-PRODUCTION-QUOTES-01` 和通用数值域已经分别由 runtime evidence、native/USDG 初始配置及 numeric bounds 关闭；`V2-G0-BATCH-01` 通过明确移出 V2 首发范围关闭。

### 2.4 当前实现审查与差距登记（2026-09-02）

本节最初记录的是 2026-09-02 的 V1 代码审查；同日按产品决定，V1 运行时代码、测试、旧部署脚本与旧产品界面已不经改写地移出工作区并保存在可恢复废纸篓目录。当前已建立 `contracts/src/v2/`、`contracts/test/v2/`、Backend、Indexer、Deployment、Maintenance Runner、Web 与 CI 的隔离边界，并已完成十九个产品模块、typed identity/CREATE2共用层、Indexer重放/对账、Backend只读API、无特权Runner以及Web的Launch/Curve、Vault和Emergency/Recovery本地技术旅程。毕业池写旅程、目标链E2E、法律文案签字、审计和生产部署仍未完成；任何 V1 ABI、经济机制、角色、部署清单或前端叙事都不能作为 V2 的已完成实现。删除记录见 `V1_CODE_REMOVAL_RECORD.md`。

| 差距 ID | 严重度/状态 | 当前证据与不符点 | 关闭任务 | 关闭证据 |
|---|---|---|---|---|
| `V2-GAP-001` | `P0 / OPEN (NINETEEN PRODUCT MODULES + ACCESS PLAN COMPLETE)` | V2 namespace、完整生成接口及interface artifact exact diff已存在；十九个产品模块、AccessManager精确配置计划及测试已落地，typed identity/CREATE2与Gauge clone共用层已实现；最终目标链安装与部署证据仍未完成 | V2-E-103～V2-E-105、V2-C-101～V2-C-403 | 所有canonical product module均有artifact、ABI、单元测试和代码哈希，且V2 namespace保持独立编译 |
| `V2-GAP-002` | `CLOSED (V2-C-103 / V2-T-101 DONE)` | 固定供应Token、Factory/Curve构造期循环解除、真实CREATE2部署及Registry/beneficiary原子登记已实现；负向矩阵、14条runtime三方差分、四组件artifact-backed CREATE2实际部署及逐阶段故障注入全部闭合 | V2-C-103、V2-T-101 | 构造/初始化、全量入 Curve、无 mint authority、旧角色不可达的负向测试全部通过 |
| `V2-GAP-003` | `CLOSED (V2-C-106 / V2-T-101 DONE)` | 多Meme Factory、concrete Router及native/ERC-20原子创建首买均已闭合；负向矩阵、runtime差分、LaunchLocker CREATE2实际部署与逐阶段故障注入全部通过 | V2-C-106、V2-T-101 | 同 Asset UID 多 Meme、配置快照、普通创建和两类 Quote 的 launch-and-buy EVM 测试通过 |
| `V2-GAP-004` | `P0 / OPEN (LOCAL RUNTIME + CREATE2 DONE; DEPLOYMENT EVIDENCE OPEN)` | Pons-compatible Curve、多 Quote、tracked reserve、partial fill/refund、reserved/sellable、最终 fee sweep、资产托管、可捕获毕业交接及Factory构造集成均已实现；14条runtime向量已与独立reference和生产Solidity库逐单位一致，Token/Curve/Gauge/LaunchLocker真实artifact-backed CREATE2预测与本地实际部署一致；仍缺目标链最终deployment证据 | V2-C-107、V2-T-101、V2-E-105 | Solidity 与冻结 Pons 向量逐整数单位一致；native/ERC-20、强制转账、尾单、退款及四组件实际部署测试通过 |
| `V2-GAP-005` | `P0 / OPEN (GRADUATION + LOCKER + DISCOVERY READY; FORK OPEN)` | Registry两阶段状态机、Curve exact escrow记录、可捕获自动调用、permissionless retry、七日固定recipient rescue、canonical v4池计划、concrete GraduationExecutor/LaunchLocker、initialize/exact mint+settle/activate/commit、permissionless同仓compound及canonical Router/Quoter交易发现均已闭合；仅剩固定Fork证据 | V2-C-303～V2-C-305、V2-T-302 | 固定 Fork 中 sweep、initialize、mint、锁仓、retry/rescue 和资产守恒逐事件可核对 |
| `V2-GAP-006` | `CLOSED (T201 / T202 DONE; MULTIASSET AMENDED)` | 每 schema 共享 MultiAsset Vault、按 Asset UID 隔离的多 Meme 三层 allocation、本人本金逃生、AllocationManager 六个入口，以及具备32槽activation、24小时整仓锁、双资产accumulator、历史结算和永久Emergency禁用的 concrete Gauge 均已实现；T201状态化Invariant、T202-A激活轮复杂度/Gas及T202-B accumulator全域数值/最大dust证据全部闭合 | V2-C-201～V2-C-204、V2-T-201、V2-T-202 | Vault 本金、跨资产隔离、三层 allocation、激活边界、锁定边界、迁移、force release、6–18 decimals、生命周期overflow与remainder守恒全部通过 |
| `V2-GAP-007` | `P0 / OPEN (HOOK PRODUCT READY; FORK OPEN)` | V1 排放/回购实现已移除；FeeVault已完成Quote/Meme exact-arrival、10 STOCK饱和分桶、Gauge按raw-unit分配、三方负债与固定收款claim，concrete Hook已完成CREATE2地址、pool source生命周期、四象限unspecified资产/base、1%整数计算、pool nonce、canonical feeId、LP donate/non-LP take/exact-arrival原子执行及逐Swap的Slot0 lp/protocol fee fail-closed；仍缺真实v4 PoolManager Fork集成证据 | V2-C-301、V2-C-302、V2-T-301 | 四种 Swap 方向逐笔满足 `T=L+D`、`E=min(S,B)`、同资产到账和三方负债守恒，V1 排放/回购路径不可达 |
| `V2-GAP-008` | `P0 / OPEN (LOCAL EMERGENCY/RECOVERY/ACCESS EVIDENCE COMPLETE; LIVE INSTALL OPEN)` | Registry、Controller、Gauge/Hook终态失效、本人本金逃生、双资产cap、root/claim、全协议AccessManager配置/只读preflight、状态/权限矩阵及故障恢复演练均已闭合；仅目标链AccessManager安装与撤权receipt仍待O701/L802完成 | V2-C-403、V2-T-401、V2-T-402、V2-O-701、V2-L-802 | 全状态乘积、target+selector+role+delay diff、部署者撤权和故障恢复演练通过 |
| `V2-GAP-009` | `P1 / OPEN (ALL PRODUCT ARTIFACTS EXACT; DEPLOYMENT EVIDENCE OPEN)` | 十九个最终Solidity产品artifact均已反向生成并通过ABI/event/runtime hash exact diff，deployment schema及只读live preflight已建立并fail closed；Gauge额外要求clone implementation、runtime与immutable identity回读证据；仍缺目标链CREATE2实际地址/initCodeHash核对、无占位production manifest及部署receipt | V2-E-104、V2-O-701、V2-L-801、V2-L-802 | 最终 product artifact 反向生成 ABI/selector/hash；预测与实际部署一致；V2 preflight 无 placeholder且 fail closed |
| `V2-GAP-010` | `P1 / OPEN (RUNNER + W502/W504 + W505-A LOCAL FLOW DONE)` | Indexer、Backend生成客户端、无特权Runner、compiled ABI钱包层、Launch/Curve、Vault及Emergency本金/Recovery root用户旅程均已实现；Web已把API资金相关地址回绑Factory不可变依赖与canonical Registry并在每次签名前复核，且仍显式要求完整product-runtime health后才开放交易；尚缺W503毕业池写旅程、W505-B法律文案签字和T601真实全旅程E2E | V2-W-502～V2-W-505、V2-S-501、V2-T-601 | 空库重建、真实钱包全旅程与 V2 文案验收通过，V1 service/ABI 无运行时引用 |
| `V2-GAP-011` | `CLOSED (SPEC/CI)` | 四态 readiness 已取代旧 `FROZEN_FOR_IMPLEMENTATION`；当前因 implementation gates 为空且 deployment gates 非空，唯一推导为 `IMPLEMENTATION_ALLOWED`，deployment preflight 继续 fail closed | V2-P-012、V2-T-002 | Python/TypeScript 测试覆盖四态推导、状态/布尔一致性、placeholder 与跨展示面状态 |
| `V2-GAP-012` | `CLOSED (ALL NINETEEN PRODUCT ARTIFACTS EXACT)` | Emergency、创建费、自动毕业、Curve sweep、事件来源、Gauge clone和per-market Locker规范已唯一；十九个产品artifact均已逐selector/event/tuple/runtime hash反向exact diff，生成interface、ABI、权限和产品manifest保持一致 | V2-E-102、V2-E-103、V2-T-002 | 十九个产品artifact逐selector/event/tuple exact diff和生成物stale门禁持续通过；真实部署证据独立保留在`V2-GAP-009` |

关闭规则：`V2-GAP-*` 只有在其关闭任务全部达到 `DONE` 且链接了对应 artifact、命令、测试数量和剩余风险后才能改为 `CLOSED`。文档或 Python 模型存在对应字段不构成 runtime 差距关闭。

### 2.5 当前测试绿灯的正确解释

| 测试轨道 | 当前结果 | 能证明 | 不能证明 |
|---|---:|---|---|
| V1 Foundry | `ARCHIVED / NOT RUN` | 删除记录可证明旧实现被完整移出；历史审查记录为58 passed | 任何当前 V1 或 V2 运行时行为 |
| V2 单项 Python 规格 | 59 passed | 当前 JSON、typed hash、readiness、Emergency/Graduation/Locker ABI、官方 STOCK Base、14条Pons runtime向量与独立reference逐单位一致和生成文件内部一致 | Solidity 产品 ABI 可编译、真实余额路径、重入、回滚、v4 callback 或权限部署 |
| V2 Foundry scaffold | 2 tests | V2 profile、namespace 和 `V2-EXEC-3` compile marker 可用 | V2 的任何链上产品能力 |
| V2 Foundry Product | 272 tests | 十九个产品模块的身份、状态、内容哈希、权限、固定供应、Factory/Curve、Vault/Allocation/Gauge、FeeVault/Hook、Graduation/Locker、MarketController、Recovery、C405真实余额恢复、配置聚合读取及canonical discovery行为 | 目标链身份复核、live Fork、production deployment或生产安全 |
| V2 Foundry shared libraries | 388 tests | typed identity、Pons差分、Vault/Allocation/Gauge、费用、Hook、毕业与Recovery共享状态机、AccessManager角色移交、256项状态乘积、Recovery恢复演练、数值/Gas边界及故障注入 | 目标链live Fork或production deployment manifest |
| V2 Foundry Fork/E2E | 6 fixture tests / 0 live | 固定本地Quote/Pons/恶意资产夹具可复现 | 目标链live replay、端到端产品能力或生产安全 |

CI 总状态必须按轨道报告，不得把 scaffold 绿灯汇总为“V2 passed”。当前 CI 的 `contracts-scaffold` 仅证明隔离边界可编译；未来 production implementation job 在 canonical artifact 未生成或产品 Foundry 测试数量为0时必须明确失败或保持 `NOT_STARTED`，不能显示成功。

## 3. 里程碑与关键路径

估算以 2 名 Solidity 工程师、1 名后端/索引工程师、1 名前端工程师和兼职安全/QA 为参考，只表示相对工作量，不构成日历承诺。所有日历从 V2-M0 关闭后开始。

| 里程碑 | 状态 | 目标 | 工作量参考 | 前置依赖 | 退出门槛 |
|---|---|---|---:|---|---|
| V2-M0 规格与机器边界闭合 | `DONE` | 已关闭状态权威、ABI、恢复、runtime/Quote/通用数值/batch scope、官方 STOCK 身份准入/194项观测、唯一 base 选择与10 STOCK饱和线性手续费分桶；安全与法律保留为后续部署/生产门禁 | 30–40 人日 | 无 | V2-P-001～V2-P-012 与 V2-T-001～V2-T-002 通过 |
| V2-M1 V2 工程与接口基线 | `DONE` | 新 namespace、编译接口、生成 selector、V2 manifest schema、CI | 10–15 人日 | V2-M0 | 编译 artifact 是 ABI/权限的唯一来源 |
| V2-M2 Launch 核心 | `DONE (LOCAL)` | Registries、Token、Factory、LaunchAndBuy、Curve | 35–45 人日 | V2-M1 | Pons 差分、创建和曲线状态机通过 |
| V2-M3 STOCK Vault 与 Gauge | `DONE (LOCAL)` | 本金托管、allocation、激活轮、双资产累加器 | 30–40 人日 | V2-M1、V2-M2 的 Registry/Market 接口 | 本金、权重、锁定和奖励 Invariant 通过 |
| V2-M4 Graduation 与 v4 费用 | `BLOCKED (ARCHIVE FORK)` | FeeVault、Hook、Graduation、LaunchLocker本地实现已完成，退出门槛仍需目标链Fork | 40–55 人日 | V2-M2、V2-M3、V2-T-301/V2-T-302 | native/ERC-20 Fork 毕业与逐笔收费守恒通过 |
| V2-M5 状态、权限与 Recovery 集成 | `BLOCKED (T403/LIVE ACCESS)` | MarketController、Emergency、Recovery及本地Access计划已完成；全协议原子性和目标链安装待证 | 20–30 人日 | V2-M2–V2-M4 | 状态/权限/逃生/恢复演练及全协议原子性通过 |
| V2-M6 Indexer、Backend 与 Web | `BLOCKED (W503/LEGAL/E2E)` | 可重建读模型、API、无特权Runner、钱包及主要本地产品旅程已完成；毕业池、文案签字与真实E2E待完成 | 50–70 人日，可并行 | V2-E-102、V2-T-301/V2-T-302、`V2-G0-LEGAL-01` | 关键用户旅程和 reorg/E2E 通过 |
| V2-M7 硬化、部署与审计 | `BLOCKED (UPSTREAM/EXTERNAL)` | 全量 Fuzz/Gas、部署、监控、事故演练、外部审计 | 35–50 人日 + 外部排期 | V2-M2–V2-M6 | 审计 Critical/High 为 0 |
| V2-M8 灰度上线 | `BLOCKED (AUDIT/LEGAL/PRODUCTION)` | 最终 manifest、角色移交、限范围启动和连续对账 | 10–15 人日 | V2-M7、法律签字 | 至少 72 小时核心账目与告警正常 |

关键依赖：

```text
V2-M0 规格闭合
→ V2-M1 编译接口/工程基线
→ V2-M2 Launch 核心 ─┬─→ V2-M4 Graduation/v4 ─→ V2-M5 总集成 ─→ V2-M7 ─→ V2-M8
                     └─→ V2-M3 Vault/Gauge ────┘

稳定 ABI/事件 ─→ V2-M6 Indexer/API/Web ──────────────────────────┘
```

## 4. V2-M0：规格和执行边界任务

V2-M0 已关闭。后续若改变已冻结行为，必须先升级 execution spec；当前可以按 `V2-EXEC-3` 编写产品资金合约，但不能越过 deployment gates 部署。

| ID | 状态 | 任务 | 主要产物 | 依赖 | 验收标准 |
|---|---|---|---|---|---|
| V2-P-001 | `DONE` | 冻结唯一市场状态权威 | `V2_MARKET_REGISTRY_STATE_MODEL.md`、`MarketRegistryV2` 状态模型、模块写权限、MarketConfig schema、完整迁移图 | 无 | Curve、Graduation、Controller、Hook、Vault、Gauge 只读写同一权威；无双写或隐含共享存储 |
| V2-P-002 | `DONE` | 重建 canonical ABI 与权限词汇 | `V2_CANONICAL_ABI_POLICY.md`、`spec/v2_canonical_abi.json`、`spec/interfaces/IV2MutationSurfaceDraft.sol`、统一 caller/delay/precondition schema | V2-P-001 | 所有 mutation 均可计算 selector；ABI 与权限矩阵 caller/delay 完全相等；七日 rescue 进入机器字段 |
| V2-P-003 | `DONE` | 冻结组合调用与身份传递 | `V2_COMPOSED_CALL_IDENTITY.md`、`depositStockFor`、Factory `createMarketFor` 模块入口 | V2-P-001、V2-P-002 | depositAndAllocate 正确给用户记账；Factory 能认证真实 creator/salt namespace；禁止 `tx.origin` |
| V2-P-004 | `DONE` | 冻结 Creator 历史负债模型 | `V2_CREATOR_REVENUE_EPOCH.md`、beneficiary epoch、Curve sweep 边界、claim/view/event schema | V2-P-001、V2-P-002 | beneficiary 变更只影响未来费用；变更前已产生但未 sweep 的 Curve 费用不会改归属 |
| V2-P-005 | `DONE` | 冻结 Graduation 真实结算算法 | `spec/v2_pons_runtime_evidence.json` 的 native/ERC-20 sweep/pool receipts；Q192/Q128、tick/liquidity、settle、retry/rescue 与锁仓不变量 | 已关闭 | Curve escrow、reservedTokens、poolMemeAmount、lockedExcess、sqrtPrice、tick、liquidity、permissionless caller 和 PoolCreated 均有独立可执行向量 |
| V2-P-006 | `DONE` | 冻结 Emergency 与 Recovery 生命周期 | `V2_EMERGENCY_RECOVERY_LIFECYCLE.md`、snapshot/stateHash、Gauge 一次性失效、root propose/finalize/cancel、cap/view/Merkle 约定 | V2-P-001、V2-P-002 | 错误或未最终确认 root 不可领取；root 不可跨链/市场/epoch/资产重放；本金退出不依赖 root |
| V2-P-007 | `DONE` | 证明累加器数值域 | `spec/v2_numeric_bounds.json` 的 6–18 decimals admission、int/uint/time 上限、full-precision 运算和生命周期证明 | 已关闭 | 通用允许域下 maximum delta/accumulator/headroom 可复算，越界资产与运算 fail closed |
| V2-P-008 | `DONE` | 冻结 ID、哈希、模板和发现接口 | `V2_TYPED_IDENTIFIERS.md`、`spec/v2_hash_schemas.json`、LaunchTemplateRegistry、canonical PoolKey views | V2-P-001、V2-P-002 | 版本化 `abi.encode` 测试向量唯一；expectedEconomics 无自引用；Router 可读取完整 PoolKey |
| V2-P-009 | `DONE` | 消除迁移、救援和计时歧义 | `V2_MIGRATION_RESCUE_TIMING.md`、原子迁移、同额语义、Swept 七日时钟、连续受限计时 | V2-P-001、V2-P-002 | 文档、ABI、权限矩阵和状态测试只有一种执行顺序与时间边界 |
| V2-P-010 | `DONE` | 关闭 V2-M0 规格/参数 G0并登记延后门禁 | runtime、native/USDG Quote、创建费、首买、batch scope、官方全量 STOCK 身份准入、唯一 base 选择与价格无关规则已关闭；security/legal 为后续门禁 | 已关闭 | 所有 implementation 参数均 APPROVED 或移出首发；production 外部门禁有负责人和关闭条件 |
| V2-P-011 | `DONE` | 关闭 canonical ABI、事件与调用入口缺口 | Emergency 单参数/链上计算与 cap-freeze ABI；immutable 创建费；exact Curve 自动毕业/sweep；事件唯一来源；四组件/per-market Locker template/hash/CREATE2 模式 | V2-P-002、`V2-G0-LAUNCH-FEE-GOVERNANCE-01` | 文档、机器 ABI/权限、template/hash schema、参考流程和生成 interface 只有一种 signature/事件/调用顺序；未来 artifact 由 T002 条件门禁校验 |
| V2-P-012 | `DONE` | 建立唯一 readiness 状态模型 | `V2_READINESS_AND_DEPLOYMENT_GATES.md`、manifest 三组 gates、deployment 同源推导/preflight、production placeholder policy | V2-P-011 | 四态不可混用；当前严格为 `IMPLEMENTATION_ALLOWED`；未关闭 artifact、审计或72h soak时对应 deployment/production 门禁失败 |
| V2-T-001 | `DONE` | 扩展 V2 可执行参考规格 | Python 规格测试覆盖 selector/hash/Curve/runtime Graduation/Quote/数值极值、官方194项身份目录、唯一 base 选择、价格无关 ABI 和10 STOCK饱和线性手续费分桶 | 已关闭 | `S=0`、`0<S<B`、`S=B`、`S>B`、rounding、admission、不可改绑和同 STOCK 多市场向量通过 |
| V2-T-002 | `DONE (PRODUCT ARTIFACT EXACT)` | 建立跨文档/机器/artifact 一致性测试 | Markdown Emergency signature/returns、readiness derivation、ABI/权限/event owner、launch fee immutability、template/hash/CREATE2、placeholder、生成接口、编译接口与十九个产品artifact一致性 | V2-P-002、V2-P-011、V2-P-012 | 当前59项规格测试、23项deployment测试、interface与十九个product artifact selector/event/tuple/runtime hash反向exact diff持续通过；production deployment gate仍保持关闭 |

### 4.1 V2-M0 退出检查

- [x] `V2-FROZEN-STATE-ABI-01` 的规范状态以 `V2-STATE-5-FROZEN` 重新冻结；因尚无部署/产品 artifact，预部署基线使用 `V2-EXEC-3`，未来任何不兼容实现偏离必须升级 ID。
- [x] `V2_PROTOCOL_PARAMETERS.md`、`V2_TECHNICAL_ARCHITECTURE.md`、`V2_EXECUTION_SPEC.md` 与机器 JSON 的 P011/P012 范围已由跨载体测试锁定。
- [x] `activateEmergencyExit` 的参数、链上计算责任、返回值和权限在执行规范、ABI surface、权限矩阵与生成 interface 中完全一致；compiled product artifact 仍由后续门禁校验。
- [x] 创建费明确为 current Factory immutable；不存在 setter/event，改费必须新 Factory/Router/Template 与新 `executionSpecId`。
- [x] readiness 使用唯一四态和同源 gate 推导；CI 与 deployment preflight 均 fail closed。
- [x] 所有结构体均有 canonical ABI tuple 且所有 mutation selector 可由机器 surface 生成；十九个当前产品artifact已纳入反向exact diff，生产部署地址/代码/权限的live exact diff仍属于deployment gate。
- [x] MarketRegistry、Creator epoch、Graduation、Recovery、迁移和 rescue 都有唯一执行算法。
- [x] 通用 Stock/Quote admission 数值域下，`INDEX_PRECISION`、remainder、时间和生命周期累计都有整数上界；STOCK 只使用 raw-unit 权重，不需要价格 target。
- [x] Pons runtime、native/USDG Quote、immutable 创建费、launch-and-buy、batch scope、官方全量 STOCK 身份准入、唯一 base 选择与固定手续费分桶已经关闭。
- [ ] `V2-G0-PONS-SECURITY-01` 已确认源码许可、审计范围和审计计划，但保持开放直到 V2-SEC-702 通过。
- [ ] `V2-G0-LEGAL-01` 已确认负责人、审查范围和关闭时间，但保持开放直到 V2-W-505/L-801 的法律门禁通过。
- [x] 产品规则已写入同一 `executionSpecId`；安全、合约 artifact 与生产签字保留在 deployment/production gate。

## 5. V2-M1：V2 工程与接口基线

| ID | 状态 | 任务 | 主要产物 | 依赖 | 验收标准 |
|---|---|---|---|---|---|
| V2-E-101 | `DONE / SCAFFOLD ONLY` | 建立 V2 合约与测试 namespace | `contracts/src/v2/`、`contracts/test/v2/`、mock 和 fixture 边界、独立 Foundry profile | 产品要求先行建立无业务实现 scaffold；生产模块仍受 M0 门禁 | V1 runtime 已不经修改地移出；V2 namespace 可独立编译和测试；无产品合约占位实现 |
| V2-E-102 | `DONE` | 实现接口与机器清单生成器 | `contracts/src/v2/interfaces/IV2Protocol.sol`、`spec/generate_v2_interfaces.py`、`spec/generate_v2_artifact_manifest.py`、`spec/v2_compiled_interface_manifest.json` | V2-E-101、V2-P-002 | 19个模块、80个mutation、54个event、35个required error由Solidity 0.8.26 artifact反向核对；tuple字段、mutability、indexed、selector、topic、caller/delay/precondition/recipient任一漂移均失败 |
| V2-E-103 | `DONE` | 建立 V2 CI 门禁 | `.github/workflows/ci.yml`、`tools/check-v2-ci-tracks.mjs`、对应10项门禁测试；boundary/spec、interface/scaffold、product、fork、deployment、off-chain、website独立分轨 | V2-E-102 | 未启动轨道明确报告 `NOT_STARTED`；Fork允许完整本地fixture层进入`FIXTURES_ACTIVE`，live fork测试启动后固定manifest/RPC仍必须成套；其余部分启动立即fail closed；完整启动层实际执行对应测试 |
| V2-E-104 | `DONE / TOOLING ONLY` | 建立 V2 deployment schema | Schema、结构验证及只读live preflight；覆盖目标链依赖、所有模块、CREATE2、codehash、Pool/Position、Hook、AccessManager、config IDs与角色移交 | V2-E-102 | 错chain/address/codehash/config/selector/sourceVersion/fee/role/receipt时preflight fail closed；当前中央readiness仍先行阻止真实部署 |
| V2-E-105 | `DONE / FIXTURES ONLY` | 建立 Pons/Quote 固定 fixture | 14项baseline行为向量、native/ERC-20与恶意资产mocks、两个固定block/hash快照、确定性fixture hash | V2-P-005、V2-P-010 | 本地、CI和审计复现使用同一输入和hash；不声称live fork或生产资产取证 |

### 5.1 V2-M1 可分配子任务

以下 `-A/-B` 子任务是可独立 PR 的工作包，状态继承父任务。父任务只有在全部子任务及父级验收均通过后才能标记 `DONE`。

| 子任务 ID | 父任务 | 工作包 | 产物与验收 |
|---|---|---|---|
| V2-E-101-A | V2-E-101 | `DONE`：创建 V2 Solidity/测试目录和独立 Foundry target | `src/v2`、`test/v2`、fixture/mock 目录与 `profile.v2` 已存在；scaffold 测试独立报告，后续 product 测试必须另行计数 |
| V2-E-101-B | V2-E-101 | `DONE`：建立 V1 归档/V2 runtime 物理边界 | V1 runtime 已移出；静态规则禁止 V2 重新引入 `EmissionController`、`RewardEscrow`、`StockStakingGauge`、V1 Token/Factory/FeeExecutor/旧 Bucket；允许复用项必须为无经济语义的通用库并显式白名单 |
| V2-E-102-A | V2-E-102 | `DONE`：从机器 surface 生成并编译完整 V2 interfaces | 19个模块的struct、enum、error、event、view和mutation进入 `IV2Protocol.sol` 并编译；draft import由boundary check禁止 |
| V2-E-102-B | V2-E-102 | `DONE`：artifact→ABI/selector/topic/permission 生成与反向 diff | 编译源hash、tuple字段、输入输出、mutability、indexed、methodIdentifiers、topic0及80行协议权限逐项一致；CI执行 `check:interfaces` |
| V2-E-103-A | V2-E-103 | `DONE`：拆分 CI 轨道 | `contracts-product`、`contracts-fork`、`deployment` 已从 interface/scaffold 与 off-chain scaffold 中独立；每条轨道写入 GitHub step summary |
| V2-E-103-B | V2-E-103 | `DONE`：增加零实现/零测试硬门禁 | 全空轨道只报告`NOT_STARTED`；产品源/测试/真实source artifact必须成套；Fork的manifest/生成器/本地测试完整后为`FIXTURES_ACTIVE`，live测试出现后必须再有RPC；deployment schema/validator/tests与后续preflight/tests分层成套并实际测试成功，否则非零退出 |
| V2-E-104-A | V2-E-104 | `DONE`：定义 V2 deployment manifest schema | `v2-deployment-manifest.schema.json`、`schema.ts`及测试已覆盖executionSpecId/readiness、外部依赖、19模块、config snapshot、Quote/STOCK身份、四类CREATE2、Hook mask/core fee、80+6权限、测试证据和角色移交；拒绝额外字段、空值、占位及低熵hash |
| V2-E-104-B | V2-E-104 | `DONE`：实现 V2 只读live preflight | 固定同一finalized block核对chain、全部runtime code、关键getter/storage、完整PoolKey/PoolId、StateView core fee、Position NFT→Locker、Hook bits/binding/sourceVersion、80条selector role与事件exact diff、Safe角色delay、部署者撤权及成功receipt；RPC白名单禁止写方法 |
| V2-E-105-A | V2-E-105 | `DONE`：固定 native/ERC-20/恶意资产测试夹具 | 两项首发Quote固定decimals/phantom/threshold及proxy/implementation身份，14项Pons向量和两个block/hash快照原样冻结；8类行为fixture覆盖精确到账、fee-on-transfer、rebase、回调重入、false/no-data/malformed返回和强制转账，compiled runtime codehash与完整fixture hash由生成器验证 |

## 6. V2-M2：Registry、Token、Factory 与 Curve

| ID | 状态 | 任务 | 主要产物 | 依赖 | 验收标准 |
|---|---|---|---|---|---|
| V2-C-101 | `DONE` | 实现 `MarketRegistryV2` | 唯一MarketConfig/runtime存储、canonical discovery及launchPhase/status/sourceVersion语义迁移已完成 | V2-E-102、V2-P-001 | 非授权模块不能写状态；每条迁移原子、单向且事件完整 |
| V2-C-102 | `DONE` | 实现追加式配置 Registries | OfficialStock、ApprovedQuote、PonsBaseline与LaunchTemplate均已实现并通过artifact/test门禁 | V2-C-101、V2-P-010 | 历史 config 不可修改；pause/retire 只影响新市场/新增仓；创建者只能从 ACTIVE 官方 STOCK 中选一个 base |
| V2-C-103 | `DONE` | 实现固定供应 `TickerMemeTokenV2` | 标准 ERC-20、固定18 decimals/totalSupply、无税/rebase/黑名单/后续 mint已完成 | V2-P-010、V2-E-102 | 全量供应按 baseline 一次创建；现有 V1 EmissionController 无任何权限或依赖 |
| V2-C-104 | `DONE` | 实现 `CreatorRevenueRegistry` | beneficiary epoch、未来收入转移、历史查询、原子Curve sweep和事件已完成 | V2-P-004、V2-C-101 | 只有当前 beneficiary 可变更；管理员无 override；历史负债收款人不变 |
| V2-C-105 | `DONE` | 实现 `TickerGardenFactoryV2` | ACTIVE快照/economics、typed identity、codehash固定实现器、真实CREATE2组件、Registry/creator epoch和创建费原子提交 | V2-C-101～V2-C-104 | 任一子步骤失败不留下半市场；所有配置来自 ACTIVE/current snapshot；重复身份失败 |
| V2-C-106 | `DONE` | 实现原子 `LaunchAndBuyRouter` | concrete Router组合native/ERC-20共享付款层，冻结Factory/Quote Registry绑定并保留外层creator身份 | V2-C-105、V2-P-003 | creator/salt 不因 Router 丢失；无1%人为首买上限；收款/refund recipient 明确；失败全部回滚 |
| V2-C-107 | `DONE` | 实现 `PonsCompatibleCurve` | buy/sell、tracked reserve、anti-snipe、native/ERC-20 exact settlement、尾单退款、最终fee sweep、资产托管、markSwept及可捕获毕业子调用已形成concrete模块 | V2-C-105、V2-P-005 | 与 baseline 向量一致；部分成交、退款、极小额、native/ERC-20 和 Swept 终态覆盖 |
| V2-T-101 | `DONE (A/B/C/D)` | Pons 差分与 Launch 状态测试 | Token/Factory负向、多市场组合、14条runtime三方逐单位差分、四组件真实artifact-backed CREATE2实际部署及Launch逐阶段故障注入全部闭合 | V2-C-103～V2-C-107 | 所有继承项等价；所有差异项只表现为已签字差异；无未登记行为偏差 |

### 6.1 V2-M2 可分配子任务

| 子任务 ID | 父任务 | 工作包 | 产物与验收 |
|---|---|---|---|
| V2-C-101-A | V2-C-101 | `DONE`：MarketConfig/runtime存储与只读发现 | immutable Factory独占登记；marketId/Meme Token write-once；ACTIVE Asset/Quote/Baseline/Template交叉验证；初始runtime、完整PoolKey/PoolId、Curve fee source及sourceVersion可由链上唯一重建 |
| V2-C-101-B | V2-C-101 | `DONE`：语义化状态迁移入口 | immutable Curve/GraduationExecutor/MarketController权限；所有允许边单向且时间边界精确，事件与写入同交易完成；编译artifact对canonical接口exact diff |
| V2-C-102-A | V2-C-102 | `DONE`：`OfficialStockRegistryV2` | Asset UID与Stock Token唯一且write-once，Asset-to-Vault绑定write-once，多Asset可共享同schema唯一Vault；冻结经通用数值证明的6–18 decimals与状态；AccessManager 48h admin/即时pause/24h unpause；第195项登记测试证明无硬上限，无价格/Feed/target ABI |
| V2-C-102-B | V2-C-102 | `DONE`：`ApprovedQuoteRegistry` | native/ERC-20 配置逐资产冻结 decimals、phantom、threshold、baseline和economics hash；inactive配置不能创建新市场 |
| V2-C-102-C | V2-C-102 | `DONE`：`PonsBaselineRegistry` 与 `LaunchTemplateRegistry` | baseline/template 追加式；冻结部署模式、implementation/codehash、fee policy、executionSpecId和允许状态迁移 |
| V2-C-103-A | V2-C-103 | `DONE`：固定供应 Token 部署与身份绑定 | `marketId/creator/factory/metadataURI/initialSupply` 冻结；18 decimals标准ERC-20全量供应一次进入predicted Curve；无后续mint、V1角色或管理旁路 |
| V2-C-104-A | V2-C-104 | `DONE`：Creator beneficiary epoch | epoch 从1开始且write-once；变更先按旧epoch从exact Curve原子sweep并确认清零；只有当前beneficiary可追加未来epoch，管理员无重定向入口 |
| V2-C-105-A | V2-C-105 | `DONE`：typed marketId、四类 component salt 和共用 CREATE2 库 | 冻结向量及本地真实CREATE2部署使用同一共用层；Factory/GraduationExecutor最终组件constructor args、initCodeHash与manifest证据由V2-C-105-B/C及Graduation集成闭合 |
| V2-C-105-B | V2-C-105 | `DONE`：Factory 校验、配置快照与多 Meme identity | 四个Registry ACTIVE/current交叉校验、typed expectedEconomics与10 STOCK快照已闭合；同Asset UID可保留多个不同marketId而重复identity失败；实际组件创建与登记由V2-C-105-C原子完成 |
| V2-C-105-C | V2-C-105 | `DONE`：组件部署、初始化、Registry登记原子化 | Token/Curve的codehash固定typed delegate target保持Factory CREATE2 namespace；Gauge使用固定implementation与immutable-args clone；Registry→creator epoch→创建费→事件原子提交；无公开initializer、抢跑窗口或半市场 |
| V2-C-106-A | V2-C-106 | `DONE`：普通创建与 native launch-and-buy | 精确收取创建费；native `msg.value=launchFee+firstBuyAmount`；partial fill退款给creator，recipient只接收Meme；强制历史余额不被扫走，首买或退款失败全流程回滚 |
| V2-C-106-B | V2-C-106 | `DONE`：ERC-20 launch-and-buy | `msg.value=launchFee`；Router从creator精确拉取Quote并只对新Curve设置一次精确allowance；授权、少到账、异常返回、回调、退款或首买失败时全流程回滚；canonical ABI不增加permit入口 |
| V2-C-106-C | V2-C-106 | `DONE`：creator/beneficiary/recipient/salt 身份安全与concrete Router | 禁止 `tx.origin`；creator固定为Router外层`msg.sender`；beneficiary按canonical typed schema参与marketId但不能替换creator，recipient不参与marketId；salt改变market及全部CREATE2 namespace；原子首买recipient豁免仅一次 |
| V2-C-107-A | V2-C-107 | `DONE`：Curve供应分区与tracked reserve | full-precision `reserved=floor(supply*phantom/(phantom+threshold))`、sellable及毕业pool/excess分区守恒；定价只读内部tracked state，强制余额不改变pricing reserve或毕业进度 |
| V2-C-107-B | V2-C-107 | `DONE`：buy/sell/quote整数数学 | 单一纯函数路径的手续费顺序和floor/ceil与baseline逐单位一致；quote/执行可复用同一结果；极小额、最大值与尾段比例滑点已覆盖，native/ERC-20转账及重入由concrete Curve集成验收 |
| V2-C-107-C | V2-C-107 | `DONE`：anti-snipe与受限豁免 | 固定runtime查表而非拟合公式；3秒边界、minimum-net clip、creator/creation beneficiary/认证Router首买recipient和普通地址均有向量与负向测试 |
| V2-C-107-D | V2-C-107 | `DONE`：concrete Curve尾单、partial fill与退款 | native/ERC-20严格到账；不卖穿reserved并永久关闭尾段交易；比例滑点、调用者原路退款、异常Token/拒收/重入/暂停均原子回滚 |
| V2-C-107-E | V2-C-107 | `DONE`：Curve fee sweep、完成信号和毕业交接 | feeId/sweepNonce唯一；实际到账后credit；ready条件只由sellable耗尽触发；重复sweep/重复完成/双重毕业失败 |
| V2-T-101-A | V2-T-101 | `DONE`：Token/Factory负向与多市场测试 | 非Factory错误供应/Curve不能伪造canonical市场；旧mint caller不可达；同Stock与同salt可按完整typed identity创建多Meme，完全重复identity失败；四Registry未知、inactive及字段漂移全覆盖且不消耗身份 |
| V2-T-101-B | V2-T-101 | `DONE`：Pons交易三方差分 | 14条固定runtime向量覆盖Factory供应配置、真实买卖、双fee leg、尾单退款、价格边界回滚、anti-snipe及毕业；Python reference与生产Solidity库逐输出整数单位一致，difference ID登记表为空 |
| V2-T-101-C | V2-T-101 | `DONE`：CREATE2实际部署测试 | Token/Curve/LaunchLocker以真实creation code，Gauge以真实implementation runtime、clone init code与八字段immutable args，结合链/部署者/market/component salt、独立预测地址、actual地址和编译manifest逐项核对；无mock或地址占位替代 |
| V2-T-101-D | V2-T-101 | `DONE`：Launch原子性与故障注入 | 收费、拉币、Token/Curve/Gauge部署、Curve构造初始化、首买、native/ERC-20退款、Market Registry及creator epoch登记逐步故障注入通过；余额、CREATE2组件、identity reservation、market与epoch全部回滚，相同identity可无残留重试；revert交易不保留事件 |

## 7. V2-M3：UserStockVault、Allocation 与 Gauge

| ID | 状态 | 任务 | 主要产物 | 依赖 | 验收标准 |
|---|---|---|---|---|---|
| V2-C-201 | `DONE` | 实现 `UserStockVault` | 版本化MultiAsset身份/Registry绑定、exact-arrival存款、资产分区三层allocation、本人free withdraw及终态force release完整产品模块 | V2-C-101、V2-C-102、V2-P-003 | 每个Asset独立满足`deposited = free + allocated`；跨Asset/market不能混用；只有本人收到本金 |
| V2-C-202 | `DONE` | 实现 `AllocationManager` | 六个canonical caller-only入口、同Asset/Vault迁移、完整门禁与原子回滚产品模块 | V2-C-201、V2-P-009 | 只有 PoolCreated+ACTIVE 可增加；所有动作先结算；迁移无重叠计奖且原子回滚 |
| V2-C-203 | `DONE` | 实现 32 槽激活轮 | 32槽绝对generation、snapshot/refcount、lazy materialization及单pending merge/reset共享状态机 | V2-C-202、V2-P-007 | 29/30/31 秒、槽冲突、跨年空闲、同秒大量用户与已处理未物化状态正确 |
| V2-C-204 | `DONE` | 实现 `MemeStockGauge` 与双资产累加器 | 固定implementation、每市场immutable-args clone、24小时整仓锁、双资产历史结算、claim消费与永久Emergency禁用 | V2-C-203、V2-P-007 | 新份额不取历史费用；两资产及跨clone状态完全隔离；S=0、0<S<B、S>=B分桶及份额比例守恒 |
| V2-T-201 | `DONE` | Vault/Gauge 状态化 Invariant | 4用户×2市场状态化handler覆盖多次存取、增减、迁移、时间推进、pause/reactivate/retire、Emergency激活与本人force release；边界和故障矩阵全部闭合 | V2-C-201～V2-C-204 | allocation 三层等式、权重总和、本金覆盖、单 pending 和本人退出持续成立 |
| V2-T-202 | `DONE` | 激活轮数值与 Gas 测试 | 32槽复杂度、最坏Gas与存储报告、6–18 decimals/supply全域、remainder差分、生命周期overflow与最大dust证明均已冻结 | V2-C-203、V2-C-204 | 单次成本不随用户/历史 generation 增长；永久经济 dust 为0，不超过 V2-M0 上界 |

### 7.1 V2-M3 可分配子任务

| 子任务 ID | 父任务 | 工作包 | 产物与验收 |
|---|---|---|---|
| V2-C-201-A | V2-C-201 | `DONE`：Vault初始化、Asset/Vault与schema绑定 | Vault只接受Registry解析的canonical Stock；每Asset绑定write-once、每schema唯一Vault；Gauge/AllocationManager不持有本金且无可消费用户余额的任意allowance |
| V2-C-201-B | V2-C-201 | `DONE`：deposit/depositFor与实际到账 | balance delta必须等于声明金额；fee-on-transfer、rebase、异常返回值和重入失败；只能给固定用户增加free balance |
| V2-C-201-C | V2-C-201 | `DONE`：free/allocated/market三层账本 | 每个Asset分区保持`deposited=free+allocated`、用户/市场/资产总allocation聚合相等，禁止跨Asset、跨Vault或重复使用同一本金 |
| V2-C-201-D | V2-C-201 | `DONE`：普通withdraw与Emergency force release | 普通提款只用free；force release只作用于`msg.sender`且先回free，不接受任意user/recipient，也不依赖故障Gauge调用成功 |
| V2-C-202-A | V2-C-202 | `DONE`：allocate/increase统一preflight | 目标必须PoolCreated+ACTIVE且Asset允许新增；Quote后续状态不改写历史市场；结果为0或严格`>0.5 STOCK`；只作用于外层调用用户 |
| V2-C-202-B | V2-C-202 | `DONE`：decrease/close与暂停退出 | 先checkpoint/settle再改权重；必须满足24小时锁；减仓后剩余为0或`>0.5`；PAUSED/RETIRED仍允许到期退出和历史claim |
| V2-C-202-C | V2-C-202 | `DONE`：depositAndAllocate身份与原子性 | 用户只授权Vault；Manager不能改beneficiary/recipient；deposit或allocate任一步失败时本金和账本全部回滚 |
| V2-C-202-D | V2-C-202 | `DONE`：migrateAllocation | 顺序固定为checkpoint→settle→源移除→Vault同额移动→目标pending；同用户/Asset/Vault，源已解锁，目标开放，任一步失败全回滚且无重叠计奖 |
| V2-C-203-A | V2-C-203 | `DONE`：32槽generation与聚合bucket | slot=`activationAt%32`且保存绝对generation；同generation聚合，不同generation不能覆盖；每次写最多扫描32槽 |
| V2-C-203-B | V2-C-203 | `DONE`：snapshot/refcount与lazy materialization | processed snapshot不可改；用户物化后refs递减，只有refs为0才清理；空闲多年后成本不随时间或历史数量增长 |
| V2-C-203-C | V2-C-203 | `DONE`：pending创建、合并与重置 | 每用户/市场最多一个pending；再次增仓合并数量并重置30秒，旧active继续计奖；成熟处理发生在当笔新fee credit之前 |
| V2-C-204-A | V2-C-204 | `DONE`：24小时整仓锁 | unlock从分配交易时间起算；增仓/迁入重置目标整仓；`unlockAt-1`失败、`unlockAt`成功；第三方不能用dust延长他人锁 |
| V2-C-204-B | V2-C-204 | `DONE`：Quote/Meme双资产accumulator | 两套index、pool remainder、user remainder和claimable完全隔离；收到什么资产只增加该资产负债，不转换或跨资产补洞 |
| V2-C-204-C | V2-C-204 | `DONE`：有效权重和历史收益结算 | 新pending不领取activation前收益；claim/减仓/退出/迁移均先结算旧active；用户暂时清零后remainder仍归原user/market/asset |
| V2-T-201-A | V2-T-201 | `DONE`：本金与allocation状态化Invariant | 4用户×2市场 handler 随机执行deposit、depositAndAllocate、allocate/increase、时间推进、decrease/close、migrate、pause/reactivate/retire、Emergency激活、force release与本人withdraw；128,000次调用、0 revert持续满足三层等式、Vault余额覆盖、非Emergency Gauge权重总和、固定本人收款域且Gauge/Manager不持有本金 |
| V2-T-201-B | V2-T-201 | `DONE`：时间/门槛/迁移状态机 | `0/0.5/0.5+1 raw unit`、29/30/31秒、`unlockAt-1/unlockAt`、暂停/退休/Emergency、终态本人force release及checkpoint/settle/remove/add/noop/schedule drift/reentrancy等迁移失败注入均已覆盖并保持原子回滚 |
| V2-T-202-A | V2-T-202 | `DONE`：激活轮差分与最坏Gas | 同秒256次正常调度、槽冲突、processed未物化、跨年空闲、结构性满32槽、公开跨秒调度自动checkpoint与N→0清理路径全部覆盖；满轮checkpoint冻结`<2,000,000`阈值，256 refs与1 ref差不超过500，跨年差不超过2,000，256遗弃snapshot物化差不超过500；完整报告见`V2_ACTIVATION_WHEEL_GAS_REPORT.md` |
| V2-T-202-B | V2-T-202 | `DONE`：accumulator数值域与守恒 | 6–18 decimals逐项覆盖S=0、1、B-1、B、B+1；最大supply/reward、四用户任意比例256-run fuzz、pool/user remainder scaled守恒及`2^48-1`生命周期证明均冻结；批准域内uint256仍有1208倍余量，全部fraction持续携带，永久经济dust为0；完整报告见`V2_ACCUMULATOR_NUMERIC_REPORT.md` |

## 8. V2-M4：FeeVault、Hook、Graduation 与锁定 LP

| ID | 状态 | 任务 | 主要产物 | 依赖 | 验收标准 |
|---|---|---|---|---|---|
| V2-C-301 | `DONE (A/B/C/D/E CORE; PRODUCT COMPOSITION AT C402)` | 实现 `ProtocolFeeVault` | `MarketFeeAccounting` 内部库、v4/Curve exact-arrival credit、Creator/Staker/Platform 负债、逐资产 claim | V2-C-104、V2-C-204、V2-P-004 | 会计库只有固定入口且无独立资金权限；每资产余额覆盖总负债；失败不消费 feeId；claim 无任意 recipient；转账失败局部回滚 |
| V2-C-302 | `DONE (A/B/C/D/E)` | 实现 `TickerGardenMemeHook` | EXPECTED binding、mask `0x2044`、afterSwap fee、donate/take、sourceVersion 门禁 | V2-C-101、V2-C-301 | 仅 canonical PoolManager/PoolKey；T=L+D；Hook delta 归零；core fee 非零时全 Swap 回滚 |
| V2-C-303 | `DONE (A/B/C/D + PRODUCT)` | 实现 `GraduationExecutor` | exact Curve `graduateFromCurve`、Graduation Guard、per-market Locker CREATE2、expected pool、initialize、full-range mint、activate、public retry/rescue及concrete产品组合 | V2-C-105、V2-C-107、V2-C-302、V2-P-005 | Guard 验证 caller/阶段/PoolKey/余额/锁仓/source；native/ERC-20 正确 settle；成功原子写 PoolCreated，失败只保留 Curve 已提交的 Swept |
| V2-C-304 | `DONE (A/B)` | 实现 per-market `LaunchLocker` | 单市场绑定、构造期一次冻结、初始 Position NFT 永久锁定、permissionless fee compound、单边余额隔离 | V2-C-303共享核心 | 无提款/approve/任意 execute；费用只增加本 Locker 的 canonical full-range liquidity；一个 Locker 不能接管另一市场 |
| V2-C-305 | `DONE (A)` | 实现 canonical 路由发现视图 | Registry以immutable共享Router/Quoter返回完整PoolKey、预期poolId、Hook、Quote、Token、Gauge、Curve、预测/实际Locker、sourceVersion、生命周期与两类可交易状态 | V2-C-105、V2-C-303 | 标准 Router/Quoter 可从链上唯一重建调用参数；前端不自行猜测 PoolKey |
| V2-T-301 | `BLOCKED (ARCHIVE RPC REQUIRED)` | v4 手续费与 Router/Quoter Fork 测试 | 四种 exact-in/out 方向、native/ERC-20、极值、donate/take 和 slippage | V2-C-301、V2-C-302；外部archive `ROBINHOOD_RPC_URL` | 实际用户收付、Swap log、V4FeeAccrued 和 Vault 余额可逐交易对账 |
| V2-T-302 | `BLOCKED (ARCHIVE RPC REQUIRED)` | Graduation/Locker Fork 与故障测试 | initialize/mint/settle/lock/compound、无流动性、错误 PoolKey、retry/rescue | V2-C-303、V2-C-304；外部archive `ROBINHOOD_RPC_URL` | 不存在未锁定初始 LP、假 PoolCreated、资产余量丢失或 Swept 后双重毕业 |

### 8.1 V2-M4 可分配子任务

| 子任务 ID | 父任务 | 工作包 | 产物与验收 |
|---|---|---|---|
| V2-C-301-A | V2-C-301 | `DONE`：`MarketFeeAccounting`纯会计库 | 对每笔费用满足`T=L+D`和`creator+staker+platform=D`；LP固定20%，按credit时的`E=min(S,B)`执行`floor(D×E/(2B))`，所有整数余数归Platform |
| V2-C-301-B | V2-C-301 | `DONE`：v4 begin/finalize exact-arrival credit | begin后只允许同feeId/source/asset/amount finalize；实际余额增量必须等于D；失败不消费feeId/nonce或留下pending credit |
| V2-C-301-C | V2-C-301 | `DONE`：Curve sweep与Creator epoch credit | Curve阶段无Staker/LP，non-LP按Creator/Platform 50/50；sweep绑定发生时的creator epoch且重复nonce失败 |
| V2-C-301-D | V2-C-301 | `DONE`：Creator/Staker/Platform双资产liability与claim | 每资产Vault余额覆盖总负债；recipient只从epoch beneficiary、固定treasury或staker本人读取；单资产transfer失败不影响另一资产 |
| V2-C-301-E | V2-C-301 | `DONE`：10 STOCK饱和的线性质押分成 | 每市场不可变`B=10×10^stockDecimals`；`S=0` 为总费约40/0/40/20，`0<S<B`线性释放，`S>=B`为约20/40/20/20；每笔按credit时的active STOCK快照确定，Staker桶内部按有效raw-unit比例分配，余数策略有固定向量 |
| V2-C-302-A | V2-C-302 | `DONE`：Hook CREATE2地址、permission bits和PoolManager绑定 | Hook低位精确`0x2044`；只有canonical PoolManager可调用；错误PoolKey、hookData、sourceVersion或未激活binding失败 |
| V2-C-302-B | V2-C-302 | `DONE`：beforeInitialize握手与pool source生命周期 | 只允许expected PoolKey；初始化后绑定一次；disable后旧source永久不能credit或重新激活 |
| V2-C-302-C | V2-C-302 | `DONE`：四象限afterSwap feeAsset与int边界 | exact-in/out × zeroForOne均从unspecified currency实际delta取base；`int128`极值、零费和错误资产处理唯一 |
| V2-C-302-D | V2-C-302 | `DONE`：1% fee、LP donate和non-LP take | `T=floor(base*10000/1e6)`、`L=floor(T*2000/10000)`、`D=T-L`；donate/take/FeeVault credit原子，Hook瞬时delta归零 |
| V2-C-302-E | V2-C-302 | `DONE`：canonical fee fail-closed | PoolKey fee、slot0 lpFee或packed protocolFee任一非零时整笔Swap回滚；无in-range liquidity、donate/take/credit失败均不留nonce或事件 |
| V2-C-303-A | V2-C-303 | `DONE`：Curve sweep、Swept与自动入口 | 最终 Curve 结算/退款/fee sweep/close/`markSwept` 后调用 `graduateFromCurve`；exact Curve caller、`sweptAt` write-once、Curve事件owner；失败只能是未变化或规范定义的完整Swept |
| V2-C-303-B | V2-C-303 | `DONE`：毕业数量推导 | 区分sweptTokens、`poolMeme=floor(sweptTokens*sweptQuote/(sweptQuote+phantom))`和lockedExcess；余额与事件逐项守恒 |
| V2-C-303-C | V2-C-303 | `DONE`：Locker CREATE2、v4 initialize、settle、full-range mint和激活 | predicted Locker 使用 GraduationExecutor deployer；core fee 0、Hook `0x2044`、native/ERC-20 settle正确；Position NFT直接进入Locker；expected pool、lock和PoolCreated同交易提交 |
| V2-C-303-D | V2-C-303 | `DONE`：自动毕业、permissionless retry与七日rescue | exact Curve冻结per-market双资产记录；`graduateFromCurve`只接exact Curve且失败保留Swept；retry只允许Swept+ACTIVE；`now>=sweptAt+604800`后向部署期固定distributor精确rescue，Rescued后不可PoolCreated |
| V2-C-304-A | V2-C-304 | `DONE`：per-market 构造绑定与永久Position NFT锁定 | Locker 地址/marketId/poolId/tokenId/currencies构造期一次冻结；无initializer、withdraw、approve、transfer、任意execute或管理员逃生；creator/platform/staker均不能取走初始LP或locked excess |
| V2-C-304-B | V2-C-304 | `DONE`：permissionless同池compound与余量隔离 | canonical `INCREASE_LIQUIDITY(0)+TAKE_PAIR`先收取fee，再用显式liquidity与`SETTLE_PAIR`增加同一full-range仓位；native/ERC-20、双层allowance归零、单边余量、最大liquidity、错误owner/PoolKey、短扣款、晚期失败、重入与窄化上界全部覆盖，不跨池、不改变ownership |
| V2-C-305-A | V2-C-305 | `DONE`：canonical交易发现 | Registry view返回完整PoolKey/poolId/immutable Router/Quoter/Hook/Quote/Token/Gauge/Curve/Locker/sourceVersion、phase/status及合约推导的Curve/v4交易开关；PoolCreated后实际Locker code、market与locked pool必须同一，否则fail closed；客户端不拼接或猜测 |
| V2-T-301-A | V2-T-301 | v4四象限固定Fork逐笔对账 | 用户实际收付、Swap log、V4FeeAccrued、donate feeGrowth、FeeVault余额和三方liability逐交易一致 |
| V2-T-301-B | V2-T-301 | Hook/FeeVault Fuzz与故障注入 | base极值、rounding、无LP、恶意token、重入、错误source、begin/finalize中断和转账失败不破坏守恒 |
| V2-T-302-A | V2-T-302 | Graduation native/ERC-20固定Fork | sweep→initialize→mint→lock→PoolCreated全链路以及每个外部调用点失败注入均有唯一结果 |
| V2-T-302-B | V2-T-302 | retry/rescue/Locker终态Invariant | Swept最终只到一个PoolCreated或Rescued；不能双重毕业/救援；NFT和excess永远不可流出，compound只增同仓位 |

## 9. V2-M5：状态、权限、Emergency 与总集成

| ID | 状态 | 任务 | 主要产物 | 依赖 | 验收标准 |
|---|---|---|---|---|---|
| V2-C-401 | `DONE` | 实现 `MarketController` | pause/unpause/retire、statusSince、资产/Quote 事件的项目内停盘路径 | V2-C-101、V2-P-009 | 新风险操作与历史 claim/退出严格分离；连续计时规则唯一 |
| V2-C-402 | `DONE` | 实现 Emergency 和 Recovery | Gauge/source 永久失效、cap 冻结、force release、root 生命周期与 claim | V2-C-201、V2-C-301、V2-C-401、V2-P-006 | 本金不依赖 Gauge/root；Recovery 不超 cap；旧 source/Gauge 永不恢复或双领 |
| V2-C-403 | `DONE (LOCAL PLAN + VERIFIER; LIVE INSTALL GATED)` | 配置 `AccessManager` | selector 角色、48h/24h执行延迟、7d业务状态延迟、Guardian、模块直连权限 | V2-E-102、V2-C-101～V2-C-107、V2-C-201～V2-C-204、V2-C-301～V2-C-305、V2-C-401、V2-C-402 | 本地执行与机器矩阵逐项相同；无额外 mutation selector；部署者权限可全部撤销；目标链读取证据归O701/L802 |
| V2-C-404 | `OUT_OF_SCOPE_V2_INITIAL_RELEASE` | 批量 mutation/辅助 Router | 首发不实现 batch；checkpoint/sweep/retry/compound 继续使用各自单市场 permissionless 入口 | `V2-G0-BATCH-01` 已通过 scope removal 关闭 | canonical ABI 与最终 artifact 均不得出现 `batch*`/`claimAll`/`withdrawAllMarkets`/`migrateAll` |
| V2-C-405 | `DONE (LOCAL PRODUCT + REAL-BALANCE INVARIANT)` | P0：关闭 `Emergency × NotGraduated` 状态缺口 | 重开并统一 MarketStatus × LaunchPhase 规范；禁止未毕业 Curve 进入不可恢复的非交易终态，或在终态提交前原子完成未毕业 Curve 的结算/救援；增加真实余额恢复 Invariant | V2-P-001、V2-P-006、V2-C-101、V2-C-107、V2-C-401、V2-C-402 | 使用真实 `PonsCompatibleCurve`，分别在 native/ERC-20 Quote 下形成非零 tracked Quote/Meme 余额；经 PAUSED/RETIRED 与24小时边界后，状态迁移必须原子回滚且保留可达恢复路径，或精确结算/救援并清零对应 tracked 资产；任何路径不得留下“永久不可交易且资产不可取回”的终态，规范、manifest、权限矩阵、artifact 与测试 exact diff 全部同步 |
| V2-T-401 | `DONE` | 全状态机与权限负向测试 | 按各真实入口依赖因子覆盖launchPhase、marketStatus、asset/quote status、sourceVersion、caller/delay组合 | V2-C-401～V2-C-403 | 所有允许边存在，所有未列边失败；退出和历史 claim 不被普通暂停阻断 |
| V2-T-402 | `DONE` | Emergency/Recovery 演练测试 | Gauge 故障、快照、root 修正/最终确认、force release、重复 claim | V2-C-402 | 错 root、超 cap、跨域 proof、他人本金、旧 Gauge claim 和状态恢复全部失败 |
| V2-T-403 | `BLOCKED` | 全协议原子性测试 | create→curve→sweep→graduate→allocate→swap→claim→exit/recovery | V2-C-405、V2-T-101、V2-T-201、V2-T-301、V2-T-302、V2-T-401、V2-T-402 | 任意注入失败只有规范定义的唯一结果，不留下半状态或未覆盖负债 |

### 9.1 V2-M5 可分配子任务

| 子任务 ID | 父任务 | 工作包 | 产物与验收 |
|---|---|---|---|
| V2-C-401-A | V2-C-401 | `DONE`：Market pause/unpause/retire与连续计时 | `statusSince/restrictedSince`边界唯一；PAUSED→RETIRED保留受限起点，恢复ACTIVE才清零；reasonHash和事件完整 |
| V2-C-401-B | V2-C-401 | `DONE`：Asset/Quote状态向市场操作的影响矩阵 | 区分禁止新创建、新买卖、新allocation与仍允许的claim/成熟/退出；不依赖Indexer或管理员临时解释 |
| V2-C-402-A | V2-C-402 | `DONE`：Emergency单参数原子激活 | `activateEmergencyExit(marketId)` 返回epoch/snapshot/hash；Controller先读旧状态并计算，FeeVault以自身exact liability冻结Quote/Meme cap，随后禁用Gauge/Hook、Registry最后commit；调用者不得自填epoch/snapshot/hash/cap |
| V2-C-402-B | V2-C-402 | `DONE`：本人本金force release | 不调用故障Gauge、不接受owner/recipient；只释放调用者allocation到其Vault free balance；重复释放和跨market失败 |
| V2-C-402-C | V2-C-402 | `DONE`：Recovery root生命周期 | root绑定chain/market/epoch/asset/snapshot/stateHash；proposal nonce、24h角色延迟、48h挑战、cancel/finalize和不可复用状态完整 |
| V2-C-402-D | V2-C-402 | `DONE`：capped Merkle claim | sorted-pair双哈希；每资产claimed不超过frozen cap；错误、未finalize、重复、跨域proof及transfer失败均安全 |
| V2-C-403-A | V2-C-403 | `DONE`：AccessManager角色和selector安装 | 从19模块最终artifact派生22个角色selector与58个immutable direct selector；execution delay与业务state delay分离，七日rescue不进入AccessManager delay |
| V2-C-403-B | V2-C-403 | `DONE`：管理权限和模块直连边界 | 四个V2角色的admin冻结为48h治理角色；Guardian绑定1/3/4角色；全局ADMIN配置面在移交后永久锁定，治理不能旁路Registry语义入口 |
| V2-C-403-C | V2-C-403 | `DONE (LIVE EVIDENCE DEFERRED)`：角色移交与残余权限清除 | 精确事件回放拒绝额外成员/selector；部署者最后撤销ADMIN_ROLE；错误role admin/guardian/member/delay均由只读preflight拒绝，目标链交易/receipt仍受deployment gates约束 |
| V2-C-404-A | V2-C-404 | `OUT_OF_SCOPE_V2_INITIAL_RELEASE` | 不生成实现或 ABI；后续若重开必须升级 executionSpecId 并重新评审 Gas/原子性/权限 |
| V2-T-401-A | V2-T-401 | `DONE`：全状态乘积生成测试 | 自动枚举256项phase×market×asset×quote状态；sourceVersion与caller/delay按FeeVault和AccessManager真实入口正交验证，避免不存在的全局统一门禁模型 |
| V2-T-401-B | V2-T-401 | `DONE`：权限artifact与链上配置负向diff | 已覆盖额外/缺失selector、错误role/member/execution delay/state delay/recipient/precondition、错误role admin/guardian和部署者残余权限 |
| V2-T-402-A | V2-T-402 | `DONE`：Emergency本金演练 | Gauge永久revert或无code时，用户仍能force release并withdraw；普通暂停在unlockAt-1不能绕24小时锁，Emergency terminal路径可绕过 |
| V2-T-402-B | V2-T-402 | `DONE`：Recovery root修正和cap Invariant | proposal→cancel→新nonce→finalize→claim全流程及256-run cap fuzz通过；跨market/epoch/asset/chain proof、旧Gauge/source/root恢复与双领均失败 |
| V2-T-403-A | V2-T-403 | happy-path全协议EVM场景 | create→launch buy→curve trades→sweep→graduate→allocate→activate→swap→双资产claim→exit逐余额/事件/状态对账 |
| V2-T-403-B | V2-T-403 | 跨模块失败注入与回滚矩阵 | 每个外部转账、Registry写、PoolManager回调、FeeVault credit和Gauge结算点失败时只出现规范允许终态，无半状态/裸资产/未覆盖负债 |

## 10. V2-M6：Indexer、Backend API、Web 与可选维护服务

| ID | 状态 | 任务 | 主要产物 | 依赖 | 验收标准 |
|---|---|---|---|---|---|
| V2-I-501 | `DONE` | 建立 V2 Indexer schema/handlers | market/config、Curve、Pool、allocation、activation、fee、claim、recovery 实体 | V2-E-102、V2-C-107、V2-C-204、V2-C-305、V2-C-402 | 每条记录带 chain/block/tx/log；Swap 与 Hook fee 按日志顺序关联；无链下自造余额 |
| V2-I-502 | `DONE` | 实现 reorg、重放与对账 | checkpoint、空库重建、重复日志幂等、链上 balance/liability 对账 | V2-I-501 | 任意支持范围 reorg 后读模型与链上一致；事件遗漏和余额偏差可告警 |
| V2-B-501 | `DONE` | 实现 V2 Backend 读 API | 市场发现、毕业进度、完整 PoolKey、仓位、激活/解锁、双资产收益和来源区块 | V2-I-501 | API 只读、分页有界、同步状态明确；不持有用户私钥或代签 |
| V2-B-502 | `DONE` | 发布 OpenAPI 与生成客户端 | 版本化 schema、TypeScript client、错误/同步状态类型 | V2-B-501 | Web 不手写响应结构；破坏性 API 变更必须升版 |
| V2-W-501 | `DONE` | 建立 V2 钱包与类型化交易层 | viem/wagmi、RH chain、compiled ABI、模拟/授权/提交/replacement 状态机 | V2-E-102、V2-B-502 | 所有写操作先模拟；错误 chain、拒签、过期报价和 replacement 可区分 |
| V2-W-502 | `DONE (LOCAL PRODUCT FLOW; TARGET E2E GATED)` | 实现 Launch 与 Curve 页面 | Quote/template 选择、launch-and-buy、buy/sell、费用和毕业进度 | V2-W-501、V2-T-101 | 不允许输入任意 economics；资金相关API地址逐次回绑Factory/Registry；实际 Quote、首买豁免和风险披露清楚 |
| V2-W-503 | `BLOCKED (V2-T-301/V2-T-302)` | 实现毕业池交易与流动性页面 | canonical Router/Quoter、PoolKey、Swap fee、外部 LP 与 locked LP 展示 | V2-W-501、V2-C-305、V2-T-301、V2-T-302 | 明确只有 canonical pool 产生 STOCK 质押者收益；最终交易参数来自链上 view |
| V2-W-504 | `DONE (LOCAL PRODUCT FLOW; TARGET E2E GATED)` | 实现 STOCK Vault/分配/收益页面 | deposit、allocate、pending/active、unlock、迁移、双资产 claim | V2-W-501、V2-T-201、V2-T-202、V2-T-401 | STOCK/Vault/Market/Gauge/fee asset与链上Registry一致；毕业前不可分配；30 秒与24小时显示来自链上；不使用“挖矿产币”叙事 |
| V2-W-505 | `BLOCKED (W505-A LOCAL DONE; V2-G0-LEGAL-01)` | 实现暂停、Emergency 与 Recovery 页面 | 状态、本人 force release、root/proof claim、项目内风险说明 | V2-W-501、V2-C-402、`V2-G0-LEGAL-01` | 本金逃生优先；索引延迟不伪装成链上失败；地区与收益文案通过签字 |
| V2-S-501 | `DONE (LOCAL INJECTED TRANSPORT; NO SIGNER/CUSTODY)` | 实现无特权维护 Runner | 逐市场 permissionless sweep/checkpoint/retry/compound、模拟、重试和告警；链下可调度多个单市场调用但不新增合约 batch ABI | V2-E-102、V2-C-202、V2-C-301、V2-C-303、V2-C-304 | 无专用协议角色、不持有用户资产；服务停机不阻塞任何用户安全路径 |
| V2-T-601 | `BLOCKED` | Web/API/Indexer E2E | 创建、曲线、毕业、Swap、分配、领取、退出、暂停和恢复旅程 | V2-I-502、V2-B-502、V2-W-502～V2-W-505、V2-S-501 | Web 不直连数据库；服务分别停机时链上状态和退出不受影响 |

### 10.1 V2-M6 可分配子任务

| 子任务 ID | 父任务 | 工作包 | 产物与验收 |
|---|---|---|---|
| V2-I-501-A | V2-I-501 | `DONE`：V2事件schema与唯一键 | 每条记录保存chainId/blockNumber/blockHash/txHash/txIndex/logIndex；ABI类型由artifact生成，不导入V1事件 |
| V2-I-501-B | V2-I-501 | `DONE`：config/market/curve/graduation投影 | 可从genesis或部署块重建完整market snapshot、进度、PoolKey和终态；不把Symbol当主键 |
| V2-I-501-C | V2-I-501 | `DONE`：Vault/allocation/activation/fee/claim/recovery投影 | 严格按日志顺序处理成熟激活与fee credit；只缓存链上事实，不链下创造余额或收益 |
| V2-I-502-A | V2-I-502 | `DONE`：checkpoint、幂等与reorg rollback | 重复日志无副作用；回滚到共同祖先后重放；空库重建与增量同步结果字节级一致 |
| V2-I-502-B | V2-I-502 | `DONE`：链上对账与漂移告警 | 定期比对Vault本金、Gauge active/pending、FeeVault逐资产liability、sourceVersion和Pool状态；偏差带来源区块 |
| V2-B-501-A | V2-B-501 | `DONE`：市场/配置/毕业/Pool只读API | 有界分页；返回canonical IDs/addresses/PoolKey、Quote和同步高度；不根据旧V1字段推断V2状态 |
| V2-B-501-B | V2-B-501 | `DONE`：用户仓位与双资产收益API | 分别返回free/allocated/pending/active/activationAt/unlockAt及Quote/Meme claimable和来源区块 |
| V2-B-502-A | V2-B-502 | `DONE`：OpenAPI和客户端生成 | schema版本化；Web类型自动生成；ABI/API破坏性变化使兼容测试失败并要求升版 |
| V2-W-501-A | V2-W-501 | `DONE`：钱包、链和交易状态机 | 所有写操作先simulate；错误链、授权、拒签、过期报价、replacement、revert和索引延迟可区分 |
| V2-W-502-A | V2-W-502 | `DONE`：创建/launch-and-buy/Curve交易旅程 | 展示链上`launchFee`（首版初始0.0005 native）、实际Quote、首买、partial refund、curve fee与毕业进度；不允许用户填任意economics或硬编码可变配置 |
| V2-W-503-A | V2-W-503 | 毕业池Swap/LP信息 | 调用参数只来自canonical view；展示1%总费、LP 20%进入pool feeGrowth及外部/locked LP事实，不承诺单地址LP比例 |
| V2-W-504-A | V2-W-504 | `DONE`：Stock Vault与多Meme allocation | 明确只在PoolCreated开放；支持同一Vault分配多个Meme；展示`>0.5`、30秒pending、24小时unlock和双资产claim |
| V2-W-505-A | V2-W-505 | `DONE (LOCAL TECHNICAL FLOW; LEGAL/E2E GATED)`：pause/Emergency/Recovery安全旅程 | 本金force release优先且可直接链上调用；PENDING root显示48小时挑战剩余、permissionless finalize及ACTIVE proof claim均simulate-first并链上读回；说明root是审计/治理输入，Indexer延迟不伪装为链上失败 |
| V2-W-505-B | V2-W-505 | 删除V1产品叙事与合规复核 | 删除“一ticker一mStock”“block-by-block mining”“质押产币”“必须用户组LP”；Ticker Meme非股票权益和收益风险文案签字 |
| V2-S-501-A | V2-S-501 | `DONE`：permissionless维护runner | 只调用公开sweep/checkpoint/retry/compound，先模拟、幂等重试和告警；无私钥特权、无用户资金托管，停机不影响安全路径 |
| V2-T-601-A | V2-T-601 | 全旅程浏览器E2E | 创建、两类Quote、Curve、毕业、Swap、allocate、激活、claim、迁移、退出、暂停和Recovery全部使用真实测试链交易 |
| V2-T-601-B | V2-T-601 | 链下服务故障E2E | Indexer/API/Runner分别离线、延迟和reorg时，Web标注同步状态；用户仍能从链上发现合约并领取/退出 |

## 11. V2-M7–V2-M8：硬化、部署、审计与上线

| ID | 状态 | 任务 | 主要产物 | 依赖 | 验收标准 |
|---|---|---|---|---|---|
| V2-T-701 | `BLOCKED` | 扩展全协议 Fuzz/Invariant | 多用户、多 Stock、多 Meme、多 Quote、长时间和恶意调用序列 | V2-T-403 | 第12节所有不变量持续通过，无未解释 counterexample |
| V2-T-702 | `BLOCKED` | Gas、规模与存储基准 | 32槽最坏情况、上万个 market、单市场 Hook 热路径、遗弃 snapshot、无 batch ABI 断言 | V2-T-701 | 单交易不遍历全局用户/市场/历史；单市场 Gas 上限可进入上线配置 |
| V2-T-703 | `BLOCKED` | 静态分析与人工安全复核 | Slither、编译器告警、逐模块资金/权限检查表 | V2-T-403、V2-T-701、V2-T-702 | 高风险告警关闭；抑制项逐条解释并由非作者复核 |
| V2-O-701 | `BLOCKED` | 实现可复现部署与验证 | dry-run、Hook CREATE2 permission bits、源码验证、角色移交、链上 selector diff | V2-E-104、V2-C-403 | 新环境可复现相同地址/hash；任一 preflight 不符立即停止 |
| V2-O-702 | `BLOCKED` | 建立监控与余额对账 | sourceVersion、protocol fee、Swept 超时、PoolCreated、Vault 本金、FeeVault 负债、root/cap 告警 | V2-I-502、V2-O-701 | RPC/Indexer/Runner 故障、余额偏差和异常权限变更均能及时告警 |
| V2-O-703 | `BLOCKED` | 编写并演练事故手册 | pause/unpause、retry、rescue、Emergency、root 发布、force release、角色泄露流程 | V2-C-402、V2-O-702 | 每个流程在 Fork/测试环境完成演练；人员、延迟和停止点明确 |
| V2-SEC-701 | `BLOCKED` | 冻结审计候选 | commit、executionSpecId、依赖/构建 hash、范围、威胁模型、测试/Gas 报告 | V2-T-601、V2-T-701～V2-T-703、V2-O-701～V2-O-703 | 审计期间只接受修复、测试和不改变行为的澄清 |
| V2-SEC-702 | `BLOCKED` | 外部审计与整改 | Pons 差异、Curve、v4 Hook、Vault/Gauge、FeeVault、Graduation、Recovery 审计与复审 | V2-SEC-701、V2-P-010 | Critical/High 为0；Medium 修复或有书面接受并复审；`V2-G0-PONS-SECURITY-01` 关闭 |
| V2-L-801 | `BLOCKED` | 冻结首发 manifest | baseline、Quote、官方 Stock 身份、templates、模块地址/hash、Safe/Timelock、前端范围 | V2-SEC-702、V2-P-010、`V2-G0-PONS-SECURITY-01`、`V2-G0-LEGAL-01` | 无占位字段；所有链上和法律 preflight 通过 |
| V2-L-802 | `BLOCKED` | 部署、验证与角色移交 | 已验证合约、AccessManager、Safe/Guardian/Recovery、部署者撤权记录 | V2-L-801 | 链上 selector/role/delay 精确一致；部署 EOA 无残余特权 |
| V2-L-803 | `BLOCKED` | 限范围灰度上线 | 有限 Stock/Quote/template、保守 UI 范围、连续监控和每日对账 | V2-L-802 | 至少72小时 Curve、Pool、Vault、Gauge、FeeVault 与 Indexer 对账正常后再扩大范围 |

### 11.1 V2-M7–M8 可分配子任务

| 子任务 ID | 父任务 | 工作包 | 产物与验收 |
|---|---|---|---|
| V2-T-701-A | V2-T-701 | 全协议资金与状态Invariant | 多Stock/Meme/Quote/用户和长时间随机序列持续通过第12节全部不变量；无未解释counterexample或测试过滤 |
| V2-T-701-B | V2-T-701 | 对抗性Token/回调/角色序列 | fee-on-transfer、rebase、ERC777式回调、拒收native、恶意recipient、重入、重复feeId/root/salt和角色切换均fail closed |
| V2-T-702-A | V2-T-702 | 每入口Gas预算 | 为launch、buy/sell、allocate、checkpoint、afterSwap、claim、graduate、retry、recovery设目标链预算和回归阈值 |
| V2-T-702-B | V2-T-702 | 上万个Meme规模验证 | 不在链上遍历同Stock全部market/用户/历史generation；Indexer分页和空库重建在定义规模内完成 |
| V2-T-703-A | V2-T-703 | 自动分析与告警清零 | Slither、solc warning、依赖审计和自定义禁止入口扫描；每个抑制项记录原因、owner和复核人 |
| V2-O-701-A | V2-O-701 | V2独立部署工具 | 不读取V1 manifest、USDC/TGARD回购或V1角色；支持dry-run、resume但不自动替换salt或跳过失败步骤 |
| V2-O-701-B | V2-O-701 | artifact/CREATE2/codehash证明 | 使用最终artifact生成init/runtime hash；Hook地址满足bits；预测、部署、Registry、manifest和浏览器验证地址全部一致 |
| V2-O-701-C | V2-O-701 | AccessManager部署后反向验证 | 逐target+selector读取role/member/delay；Safe/Guardian/Recovery边界正确；部署EOA和临时角色撤销后再允许交付 |
| V2-O-702-A | V2-O-702 | 实时事件、状态和权限监控 | 监控sourceVersion、Swept超时、PoolCreated、unexpected selector/role变更、Hook fee与recovery root生命周期 |
| V2-O-702-B | V2-O-702 | 逐资产余额负债对账 | Vault Stock余额、FeeVault Quote/Meme余额、creator/staker/platform liability和recovery cap按区块对账，偏差立即阻断扩大范围 |
| V2-O-703-A | V2-O-703 | 故障与权限泄露演练 | 每个runbook写清触发条件、可调用角色、链上延迟、允许动作、禁止动作、验证查询和停止点；在固定Fork留存交易证据 |
| V2-SEC-701-A | V2-SEC-701 | 审计证据包 | 固定commit/specId/artifact/hash/manifest、威胁模型、Pons差异、覆盖率、Fuzz seeds、Gas、权限图和所有已接受风险 |
| V2-L-801-A | V2-L-801 | 首发配置零占位检查 | production Quote、Stock、target、template、baseline、安全/法律签字和外部依赖全部具体化；null、示例地址或重复ID失败 |
| V2-L-802-A | V2-L-802 | 部署/验证/移交原子清单 | 每步有前置和回滚/停止条件；源码验证、配置写入、角色移交、deployer撤权及最终manifest hash全部链上可核对 |
| V2-L-803-A | V2-L-803 | 灰度限额和72小时对账 | 明确允许Stock/Quote/template集合和扩大条件；每日复核Curve/Pool/Vault/Gauge/FeeVault/Indexer差异为0后才扩容 |

## 12. 必须持续通过的 V2 不变量

| 类别 | 不变量 |
|---|---|
| 市场身份 | 一个 marketId 只绑定一个 Meme、Asset UID、Quote、Curve、Gauge 和 canonical PoolKey；名称/Symbol/Logo 不是身份主键 |
| 状态权威 | 所有模块只依赖唯一 MarketRegistry；launchPhase、marketStatus、source 与 sourceVersion 不存在双写或不同步 |
| 固定供应 | TickerMemeTokenV2 无后续 mint、税、rebase 或黑名单；V1 排放角色不能调用 V2 Token |
| Vault 本金 | 每个`assetUid`独立满足`deposited[assetUid][user] = free[assetUid][user] + allocated[assetUid][user]`；资产内三层allocation聚合相等；只有本人可收到本金 |
| 仓位门槛 | 任意非零 allocation 严格大于0.5 STOCK；不是 0.5 的整数倍要求 |
| 毕业门禁 | 非 PoolCreated 市场 active/pending 均为0；毕业前费用不追溯给后续质押者 |
| 激活与锁定 | pending 在30秒边界前不计奖；边界当笔先激活；最新分配重置合并仓位24小时 unlockAt |
| 奖励指数 | Quote/Meme 两种 index、remainder、claimable 完全隔离；新份额不取得 activationAt 前的历史费用 |
| 费用拆分 | Curve non-LP 为 Creator/Platform 50/50；PoolCreated 后 `T=L+D`，LP 20%，Creator+Staker+Platform=D，余数归 Platform |
| 实际到账 | FeeVault 每资产余额覆盖全部负债；未实际到账不能 credit；失败交易不消费 feeId/nonce |
| Creator | beneficiary 变更只改变未来收入；历史及变更前已产生费用仍归原 epoch beneficiary |
| v4 | 只有 canonical PoolKey、core lpFee=0、protocolFee=0、ACTIVE sourceVersion 才能成功收费；Hook 瞬时 delta 归零 |
| Graduation | Swept 资产只可成功进入一个 PoolCreated 或终态 Rescued；初始 LP 永久锁定且 fee 只能 compound |
| Emergency | 旧 Gauge/source 永久失效；本人可释放 allocation；Recovery 每资产不超过冻结 cap且不可重放 |
| 权限 | 实际 target+selector+caller+delay 与机器矩阵相等；Guardian、Creator、Runner 或任一 Safe 不能任意转移用户资产 |
| 链下独立 | Indexer、Backend、Web、Runner 全部离线时，链上交易、领取和本金退出语义不改变 |

## 13. 测试矩阵

| 测试层 | 最低范围 | 执行时机 |
|---|---|---|
| V2 存在性门禁 | V2 namespace、全部模块artifact、非零V2 Foundry测试数、无V1 forbidden import | 每次CI；缺失时不得报告V2成功 |
| 规格测试 | JSON schema、canonical tuple/selector、权限精确 diff、状态图、typed hash、参考数学 | 每次规范或 ABI 变更 |
| 跨载体一致性 | Markdown signature、manifest readiness、ABI/权限/event/artifact精确diff、placeholder扫描 | 每次规范、接口或artifact变更 |
| 单元测试 | 每个 public/external 函数的成功、边界、权限、暂停、转账失败和重入 | 每次 PR |
| Pons 差分 | buy/sell/quote、fee、anti-snipe、refund、reservedTokens、毕业与 rescue | Curve/Factory/Quote 相关 PR |
| Fuzz | 金额、decimals、S=0/0<S<B/S=B/S>B、有效份额比例、时间、激活槽、迁移、fee delta、native/ERC-20、Merkle proof | 每次 PR 短集；每日完整集 |
| Invariant | 第12节的本金、权重、费用、状态、source、Recovery 和权限不变量 | 每日及 release candidate |
| Uniswap v4 Fork | 四种 exact-in/out、Router/Quoter、donate/take、initialize/mint/settle/compound | Hook/Graduation 相关 PR |
| 故障注入 | Curve sweep、自动毕业、PoolManager、FeeVault、Gauge、Token transfer、RPC 和 reorg 失败 | 每次集成 release |
| Gas/规模 | Hook 热路径、32槽、批量、上万个市场、长时间 snapshot/remainder | 每周及 release candidate |
| Indexer/API | 重复日志、reorg、断点重建、余额对账、分页、同步状态和依赖故障 | 每次 schema/API release |
| Web E2E | 错网、拒签、授权、模拟、launch、swap、allocate、claim、exit、Emergency 与索引延迟 | 每次 Web release |
| 部署演练 | manifest、CREATE2、codehash、源码验证、AccessManager diff、角色移交、pause/recovery runbook | 每个环境及主网上线前 |

## 14. 任务状态、评审和变更控制

任务状态统一使用：

| 状态 | 含义 |
|---|---|
| `TODO` | 任务可以开始，但尚未分配或实现 |
| `IN_PROGRESS` | 已有负责人并正在工作 |
| `BLOCKED` | 存在明确未关闭依赖，必须记录阻塞 ID |
| `REVIEW` | 实现和自测完成，等待代码、安全、产品或运维验收 |
| `DONE` | 所有验收标准通过，证据和测试结果已经链接 |

执行规则：

- 一个 PR 原则上只完成一个任务 ID；跨任务 PR 必须说明不可拆分原因。
- `-A/-B/...` 子任务可以独立进入 `REVIEW`，但不能独立关闭其父任务；父任务必须链接所有子任务证据并重新执行父级验收。
- 每个任务在开始前必须确认依赖已经 `DONE`，不能把未决规则作为临时常量写进生产合约。
- 合约 PR 必须附测试、Gas 变化、权限变化和不变量影响；资金、状态机、Hook、Recovery 代码必须由非作者复核。
- ABI、事件、错误、角色和 typed hash 只能从最终 Solidity artifact 与 schema 生成，Indexer/API/Web 不手工复制。
- `BLOCKED` 必须指向 `V2-G0-*`、任务 ID 或明确外部输入，不能只写“待确认”。
- 审计候选冻结后，新增功能、权限或 mutation ABI 必须重新评估审计范围并升级 executionSpecId。
- V2 主网核心合约不依赖代理升级解决未决设计；需要不兼容修复时部署新 Factory/spec 版本，并保留旧版本安全退出。

## 15. 当前建议执行顺序

P005、P007、P010～P012 与 T001～T002 均已完成，机器状态已自动进入 `IMPLEMENTATION_ALLOWED`。当前顺序为：

> **P0 前置任务已关闭：** `V2-C-405` 已禁止 `Emergency/Retired × NotGraduated` 不可恢复终态，并以持有真实 native/ERC-20 Quote 与 Meme 余额的 `PonsCompatibleCurve` 恢复 Invariant 验收。下一条协议关键路径是需要archive RPC的`V2-T-301/V2-T-302`；其完成前`V2-T-403`、审计候选和deployment gate继续保持关闭。

1. `V2-E-102-A/B` 与 `V2-E-103-A/B` 已完成：机器 surface 已生成可编译接口和artifact反向exact diff，产品/Fork/Deployment轨道已独立且fail closed。
2. `V2-E-104-A/B`与`V2-E-105-A`已完成；固定夹具层仅为`FIXTURES_ACTIVE`，尚未执行目标链live fork或部署。
3. M1、`V2-C-101`～`V2-C-107`、`V2-C-201`～`V2-C-204`及`V2-T-101-A/B/C/D`已完成；T101-B的14条固定runtime向量已由Python reference与生产Solidity库逐输出整数单位重放且无差异，T101-C已用真实毕业路径闭合Token/Curve/Gauge/LaunchLocker四组件的artifact-backed CREATE2预测与实际部署核对。Factory创建时仍必须冻结唯一ACTIVE官方STOCK base。
4. `V2-C-301-A～E` FeeVault核心与`V2-C-302-A～E` concrete Hook均已完成；Hook逐Swap通过锁定v4-core `StateLibrary`验证PoolKey/slot0 LP/packed protocol fee全为零，完成LP donate 20%、non-LP take、FeeVault exact-arrival、双币种瞬时delta归零及全故障回滚。`V2-T-301`的本地依赖已完成，但仍被目标链archive RPC阻塞，真实PoolManager锁内行为须固定Fork闭合。FeeVault Recovery已由`V2-C-402`组合进最终产品artifact。
5. `V2-C-303-A/B/C/D`、`V2-C-304-A/B`、`V2-C-305-A`与`V2-T-101-C`均已闭合：Curve exact escrow、毕业/救援、canonical v4池计划、Locker真实CREATE2部署、官方PositionManager mint/settle、NFT/position核验、Hook activate/PoolCreated、permissionless同仓compound及immutable Router/Quoter-backed canonical交易发现均进入concrete产品路径。下一步领取固定Fork轨道`V2-T-301`/`V2-T-302`；无目标链RPC时不得用mock结果冒充Fork证据。
6. 最终 artifact、目标链固定区块身份取证、Fork/E2E 与权限 exact diff 全部完成后，才可关闭 deployment gates。

实现必须由冻结向量与不变量驱动；任何新增价格依赖、动态 target 或多 base 语义都属于不兼容产品变更，必须先升级 execution spec。

## 16. 计划维护规则

- 每周更新一次任务状态、实际人日、阻塞项和下一周关键路径。
- 每个 `DONE` 项必须附具体文件、命令、测试数量和剩余风险；仅“代码已写”不能验收。
- 若 V2 文档的冻结项或 G0 ID 变化，本计划必须在同一变更中更新依赖和验收标准。
- 本计划只管理 V2；V1 的状态和历史交付继续保留在 [V1_DEVELOPMENT_PLAN.md](./V1_DEVELOPMENT_PLAN.md)。
- 任何上线范围扩展到新链、桥接、跨链奖励、可升级代理或新的动态费率，均进入后续版本，不得混入当前 V2 任务。

## 17. 执行记录

本节按时间保留历史决策轨迹；较早记录中的状态、价格 target 或 gate 只描述当时版本，当前权威始终是本文件顶部与最后一条 `V2-EXEC-3` 记录。

### V2-P-001（2026-09-02）

- 状态：`DONE`。
- 产物：`V2_MARKET_REGISTRY_STATE_MODEL.md`；同步更新技术架构、执行规范、execution manifest、ABI surface 与权限矩阵。
- 决策：`MarketRegistryV2` 是唯一市场快照/runtime 权威；Factory 不再暴露第二份 MarketView；Curve、GraduationExecutor 与 MarketController 只能调用语义化迁移入口；Hook/Vault/Gauge 仅保存从属执行状态。
- 验证：`python3 -m json.tool` 校验三份机器 JSON；`python3 -m unittest spec/test_v2_execution_spec.py`，14/14 通过。
- 剩余边界：`V2-STATE-2-DRAFT` 将随 V2-P-002～V2-P-009 继续补全 ABI 与组合语义；只有 V2-M0 全部退出检查通过时才升级并重新冻结统一 `executionSpecId`。

### V2-P-002（2026-09-02）

- 状态：`DONE`。
- 产物：canonical ABI/权限词汇规范、67 个 mutation 的展开 tuple 派生清单、可再生 Solidity mutation interface 草案及两套生成器。
- 决策：caller 与 delay 分字段；`PUBLIC_SELF_ONLY`/`*_DELAYED` 等混合词汇删除；七日 rescue 固定为从 `MARKET_RUNTIME_SWEPT_AT` 起算的 `604800` 秒 state delay，AccessManager delay 为0。
- 验证：ABI 与权限矩阵 caller 精确比较、tuple 递归展开、派生 JSON/接口可重复生成；`python3 -m unittest spec/test_v2_execution_spec.py`，19/19 通过。
- 剩余边界：当前接口是 M0 规格草案；V2-E-102 必须从最终编译 artifact 生成真实 selector 并反向 diff，草案不能直接作为部署 artifact。

### V2-P-003（2026-09-02）

- 状态：`DONE`。
- 产物：`V2_COMPOSED_CALL_IDENTITY.md`；ABI/权限中的 Vault 组合入口现为 `depositStockFor(bytes32,address,uint256)`，与 `createMarketFor(address,CreateMarketParams)` 一并进入 canonical ABI 和 Solidity 草案。
- 决策：用户只授权 Vault；AllocationManager 只能为其外层 `msg.sender` 存款。LaunchAndBuyRouter 只能把其外层 `msg.sender` 作为 creator 传给 Factory；beneficiary 和 trade recipient 不改变 creator/salt namespace。
- 验证：组合入口 caller、固定 recipient 与身份前置条件进入机器测试；`python3 -m unittest spec/test_v2_execution_spec.py`，20/20 通过。
- 剩余边界：marketId/CREATE2 的精确 typed hash 由 V2-P-008 冻结；本任务只冻结身份来源和原子调用顺序。

### V2-P-004（2026-09-02）

- 状态：`DONE`。
- 产物：`V2_CREATOR_REVENUE_EPOCH.md`；ABI/权限/事件新增 epoch 初始化、历史 beneficiary view、epoch 级 creator liability 与 claim。
- 决策：epoch 从1开始且 write-once；beneficiary 变更先在旧 epoch 下原子 sweep Curve 并确认 accrued 为0，再 checked 增加 epoch；v4 fee 在逐笔 credit 时绑定 current epoch。
- 验证：旧版无 epoch 的 `claimCreator` 已从 ABI 删除，历史负债键与固定 recipient 进入机器测试；`python3 -m unittest spec/test_v2_execution_spec.py`，21/21 通过。
- 剩余边界：Curve 的精确 Pons 实现仍受 baseline G0 阻塞，但 beneficiary 边界不依赖具体曲线公式。

### V2-P-006（2026-09-02）

- 状态：`DONE`。
- 产物：`V2_EMERGENCY_RECOVERY_LIFECYCLE.md`；ABI/权限增加 Gauge 永久禁用、root propose/cancel/finalize、cap/root views 与完整事件。
- 决策：snapshotBlock 固定为 Emergency 激活块减1，stateHash 由 Controller 计算；Recovery proposal 受24h角色延迟，另有48h公开挑战期，期间 Guardian 可取消，finalize 后不可变；Merkle leaf 双哈希并使用 sorted-pair Keccak。
- 验证：旧的直接 `publishRecoveryRoot` 从 ABI 删除；未激活 root、跨域 proof、挑战期和固定 snapshot 规则进入机器测试；`python3 -m unittest spec/test_v2_execution_spec.py`，22/22 通过。
- 剩余边界：V2-P-008 将为 stateHash/leaf 提供版本化 typed hash 测试向量；本任务已冻结字段与生命周期。

### V2-P-008（2026-09-02）

- 状态：`DONE`。
- 产物：`V2_TYPED_IDENTIFIERS.md`、`spec/v2_hash_schemas.json`、纯 Python Keccak/ABI 固定向量生成器、LaunchTemplateRegistry ABI 与 canonical PoolKey discovery views。
- 决策：全部 hash 使用 bytes32 domain + schemaVersion + `abi.encode`；expectedEconomics 不包含自身或可变身份，marketId 另行绑定真实 creator/beneficiary/salt/元数据；Pons component CREATE2 细节继续由既有 G0 关闭。
- 验证：7类 schema 均有完整 ABI preimage 与固定 Keccak 结果，recovery leaf 验证双哈希；Registry 可直接返回完整 PoolKey 与 expected poolId；`python3 -m unittest spec/test_v2_execution_spec.py`，25/25 通过。
- 剩余边界：V2-E-102 仍须使用 Solidity 编译 artifact/链上库交叉验证 selector 与 PoolId；本任务固定的是 schema，不替代部署前验证。

### V2-P-009（2026-09-02）

- 状态：`DONE`。
- 产物：`V2_MIGRATION_RESCUE_TIMING.md`；MarketRuntime 新增 `restrictedSince`；迁移、rescue、Emergency 的精确顺序、事件、权限前置条件进入机器清单。
- 决策：迁移先结算并从源 active 精确减量，再移动 Vault allocation，最后作为目标 pending 进入30秒等待；目标整仓重锁24h，源锁不重置。七日从 write-once `sweptAt` 起算且使用 `>=`；PAUSED→RETIRED 保留连续受限起点。
- 验证：迁移无重叠权重、同额 Vault 移动、任意 MarketStatus rescue 与 Emergency `restrictedSince` 锚点均进入测试；`python3 -m unittest spec/test_v2_execution_spec.py`，26/26 通过。
- 剩余边界：Pons rescue 的资产结算细节仍属于受 G0 阻塞的 V2-P-005；本任务只冻结状态与时间边界。

### V2-T-001（2026-09-02，已由 V2-EXEC-2 收口）

- 状态：`DONE`；`V2-EXEC-2` 删除了不必要的价格与 backing-target 产品逻辑。
- 已完成：canonical mutation selector、event signature/topic0、typed hash、ABI/caller/delay/precondition、供应/曲线/费用/累加器/32槽激活轮、3秒 runtime anti-snipe、native/ERC-20 graduation receipt、native/USDG configs、数值极值，以及194项官方 STOCK 身份目录与唯一 base 选择规则。
- 产物：`spec/v2_canonical_abi.json`、`spec/v2_hash_schemas.json`、`spec/v2_rh_official_stock_catalog.snapshot.json`、`spec/v2_reference_model.py` 及对应生成器/测试；旧价格工具列入 `spec/RETIRED_STOCK_PRICE_RESEARCH.md`，仅保留为 `V2-EXEC-1` 历史研究。
- 验证：`S=0` 和 `S>0` 固定分桶、按有效 STOCK raw-unit 的质押者比例分配、194种当前 ACTIVE 官方 STOCK 等价可选、ABI/事件/hash 无价格字段均进入规格测试。
- 剩余边界：无 implementation blocker；最终 Solidity artifact、Fork/E2E、目标链身份复核与审计仍属于 deployment/production gate。

### 外部 G0 取证（2026-09-02）

- 状态：`OBSERVED_NOT_APPROVED`。
- 产物：`V2_G0_EXTERNAL_EVIDENCE.md`、`spec/v2_g0_external_evidence.json`。
- 发现：Pons 官方文档与官方仓库分别指向两个不同 Factory；固定区块的 runtime codehash、发行开关和 ABI 行为不同。Robinhood Chain 官方资产页列出 USDG 而非 USDC；两个 Factory 均批准 USDG 且给出同一组独立 economics。
- 影响：`V2-G0-PONS-BASELINE-01`、`V2-G0-PONS-QUOTE-01`、`V2-G0-PONS-DIFF-01` 保持 `BLOCKED`；不得把链上观测值当成产品批准值。

### V2-P-010 推荐决策收敛（2026-09-02）

- 历史状态：以下是产品确认前的提案，已由本节后面的“Pons 行为基线确认”取代，不再代表当前方案。
- 状态：`PROPOSED_REQUIRES_PRODUCT_APPROVAL`，任务仍为 `BLOCKED`。
- 产物：`V2_G0_RECOMMENDATIONS.md`、`spec/v2_g0_recommendations.json`。
- 推荐：固定 `0x7eD598…` 行为 baseline；首发仅 USDG；逐项 Pons 差异矩阵；按配置时10,000美元向上取整的 Stock backing target；5 USDG 创建费；首买不超过毕业门槛1%且只豁免 creator；批量上限16且全原子。
- 安全边界：机器状态保持 `PROPOSED`，测试明确禁止在没有产品确认时被静默视为 `APPROVED`。

### V2-M0 阻塞审计（2026-09-02）

- 历史状态：以下结论已由本节后面的重新审计取代。
- 状态：`BLOCKED_BY_PRODUCT_G0_APPROVAL`。
- 产物：`V2_M0_BLOCKER_AUDIT.md`。
- 结论：参数无关的 M0 规格、参考模型与机器校验已穷尽；P005、P007、P010、T001 剩余项及 V2-E-101 都被同一产品确认阻塞。不得以占位值进入生产资金合约。

### Pons 行为基线确认与参考向量（2026-09-02）

- 状态：`PRODUCT_DIRECTION_APPROVED / ENGINEERING_VERIFICATION_REQUIRED`。
- 产物：`V2_PONS_BEHAVIOR_BASELINE.md`、`spec/v2_pons_behavior_vectors.json`；同步更新协议参数、技术架构、执行规范、canonical ABI、typed hash 和纯整数参考模型。
- 决策：除手续费分配和毕业后 STOCK 质押外，发行主链路参考活跃 `0x7eD598…` 固定行为；支持 native + 多 ERC-20 Quote；初始创建费 `0.0005` 原生资产；atomic launch-and-buy 无人为1%门槛上限；使用 TickerGarden 自有 ABI/CREATE2 domain。
- 数学修正：区分 `reservedTokens`、`sweptTokens` 与 `poolMemeAmount`；真正入池 Meme 为 `floor(sweptTokens × sweptQuote / (sweptQuote + phantomQuote))`，余量永久锁定。
- 验证：`python3 -m json.tool` 校验新增/修改机器清单；`python3 -m unittest spec/test_v2_execution_spec.py`，44/44 通过。
- 剩余边界：active runtime 反狙击/自动毕业差分、首发生产 Quote 实例、backing target、batch Gas、最终 artifact initCodeHash、许可和安全/法律签字。

### V2-M0 重新审计（2026-09-02，历史状态）

- 历史状态：`PRODUCT_DIRECTION_APPROVED / BLOCKED_BY_RUNTIME_ASSET_AND_BACKING_INPUTS`；已由本文件末尾的 P005/P007/Quote/batch scope 闭合记录取代。
- P005、P010、T001 转为 `IN_PROGRESS`；P007 继续受生产 Quote 与 backing target 数值域阻塞。
- V2-E-101 仍不得以占位资产或未验证 anti-snipe 进入生产资金合约，但不再被“是否采用 Pons、多 Quote、创建费或首买1%上限”这些产品问题阻塞。

### V2 当前代码审查与任务细化（2026-09-02）

- 状态：`AUDIT_RECORDED / V2_RUNTIME_NOT_STARTED`。
- 范围：检查 `contracts/src`、`contracts/test`、`spec`、deployment draft、Indexer、Backend、Worker 和 Web，并逐项对照 V2 产品参数、Pons 行为基线、执行规范、ABI 与权限矩阵。
- 结论：当前通过的 Solidity 测试属于 V1；V2 当前交付是规范、机器清单和参考模型，不存在可部署 runtime。12项差距已登记为 `V2-GAP-001`～`V2-GAP-012`，其中固定供应、同Stock多Meme、多Quote/Curve、毕业、Vault/Gauge、实际手续费、状态/权限均为P0。
- 新发现：执行规范与机器 ABI 的 `activateEmergencyExit` signature 不一致；创建费“以后可修改”的文字与封闭 mutation surface 不一致；manifest 的 `FROZEN_FOR_IMPLEMENTATION` 与未决 production Quote/backing/runtime/artifact 状态容易造成误判。
- 任务调整：新增 V2-P-011、V2-P-012、V2-T-002 和 `V2-G0-LAUNCH-FEE-GOVERNANCE-01`；将 M1～M8 拆为可独立PR、可量化验收的子任务，并重写当前执行顺序。
- 验证基线：`forge test --summary` 为58/58 V1测试通过；`python3 -m unittest spec/test_v2_execution_spec.py` 为44/44；`python3 -m unittest discover -s spec -p 'test_*.py'` 为75/75。上述结果不关闭任何需要V2 artifact、EVM、Fork或E2E证据的差距。
- 当时边界：该次审查只更新开发计划、尚未修改执行规范或机器清单；这些冲突已在下文 P011/P012/T002 闭合记录中解决，compiled product artifact diff 仍待实现阶段。

### V1 代码移除与 V2 基本脚手架（2026-09-02）

- 状态：`V2_SCAFFOLD_READY / PRODUCT_RUNTIME_NOT_IMPLEMENTED`。
- V1 运行时代码、测试、旧部署脚本、旧产品 Web、生成物与旧模型临时源码共54个顶层目标已原样移出工作区；可恢复位置和范围记录在 `V1_CODE_REMOVAL_RECORD.md`。V1历史文档与模拟工作簿保留但不进入任何编译或运行时路径。
- 合约：新增 `profile.v2`、`contracts/src/v2`、`contracts/test/v2`、mock/fixture/script 目录和仅用于编译的 `V2Scaffold` marker；没有创建任何可部署产品模块。
- 链下：Backend、Indexer、Deployment 和 Maintenance Runner 只暴露 fail-closed scaffold descriptor；Web 是只读状态页，不含钱包、交易、质押、排放或其他旧产品流程。
- 门禁：根级 `check-v2-boundary` 同时校验必需 scaffold 路径、已退役 V1 路径和禁止符号；CI 按 spec、contract scaffold、off-chain 和 website 分轨。
- 解释：V2-E-101 仅以“namespace/scaffold”范围完成；V2-GAP-001 及全部产品合约、ABI artifact、Fork/E2E、部署 schema 和生产安全工作仍保持打开。
- 验证：各 Node 子项目均由 `npm ci` 重建成功；根级 `npm run build && npm test` 通过，包括44项 V2 Python 规格测试、2项 Foundry scaffold 测试、6项链下 scaffold 测试和4项 Sites worker 测试；CI YAML 与社交预览构建产物亦已验证。

### V2-P-011 / V2-P-012 / V2-T-002 闭合（2026-09-02）

- 状态：`SPEC_FROZEN_NOT_DEPLOYABLE`；三项规范/门禁任务完成，但未授权资金逻辑实现或部署。
- Emergency：外部 ABI 唯一为 `activateEmergencyExit(bytes32)` 并返回 epoch/snapshot/hash；Controller 链上读取旧状态、计算 hash，FeeVault 冻结 exact Quote/Meme staker caps，随后 Gauge/Hook 禁用，Registry 最后 commit。
- Graduation：最终 Curve 买入在 sweep/close/`Swept` 后唯一调用 `graduateFromCurve`；失败只保留 Swept，公开 retry 使用同一算法。Curve 与 Executor 的事件所有权分离，Router 不发重复摘要。
- Template：Token/Curve/Gauge 在创建时 per-market CREATE2；LaunchLocker 在毕业时 per-market CREATE2；Hook/Executor/Controller/FeeVault/PoolManager 为共享不可变模块。LaunchTemplate 增加 Locker codehash，hash schema 与四组件向量同步。
- 创建费：`V2-G0-LAUNCH-FEE-GOVERNANCE-01` 选择 immutable per Factory/spec；当前值 `0.0005 native`，无 setter/event。
- Readiness：新增四态机器推导、三组 open gates、production placeholder fail-closed 扫描及 deployment preflight；当前 implementation/deployment/production 三项布尔值均为 false。
- 验证：`python3 -m unittest spec/test_v2_execution_spec.py` 为49/49；`npm --prefix deployments run build && npm --prefix deployments test` 为5/5。未来 compiled product artifact 尚不存在，ABI/event/codehash exact diff 仍作为 deployment gate 打开。

### P005/P007、首发 Quote 与 batch scope 闭合（2026-09-02）

- 状态：`SPEC_FROZEN_NOT_DEPLOYABLE`；P005/P007 完成，P010/T001 只剩 backing target 实例输入。
- Runtime：`spec/v2_pons_runtime_evidence.json` 固定活跃 Factory codehash、3秒 anti-snipe raw/effective 表，以及 native/ERC-20 两条 sweep→PoolCreated receipt；独立模型逐值复算 pool Meme、excess、sqrtPrice、tick 与 liquidity。公开文档5秒、固定仓库源码15秒和 runtime 3秒的冲突保留为证据，禁止反推公式。
- Quote：`spec/v2_initial_quote_configs.json` 批准 content-addressed `NATIVE_ETH_V1` 与 `USDG_V1`；configId 等于 economicsHash。USDG 是可升级代理，部署前必须重取代理/实现指纹，漂移即拒绝。
- 数值：`spec/v2_numeric_bounds.json` 冻结6–18 decimals admission、int128/uint256/uint64 边界、full-precision 运算和最多 `2^48-1` 次 fee credit 的 accumulator 生命周期证明；具体 backing target 仍由逐 Asset G0 冻结。
- Scope：`V2-G0-BATCH-01` 以 `APPROVED_OUT_OF_SCOPE_V2_INITIAL_RELEASE` 关闭；V2-EXEC-2 只允许单市场 mutation，V2-C-404/A 不生成首发实现。
- 机器状态：implementation open gates 精简为 `V2-P-010`、`V2-T-001`、`V2-G0-BACKING-TARGET-01`；统一 `targetUsd18` 是未决经济输入，finalized/sequencer/feed 覆盖是同一门禁下的外部证据缺口，不能据此进入实现。
- 验证：`python3 -m unittest spec/test_v2_execution_spec.py` 为57/57；完整 workspace 验证以本次任务最终执行结果为准。

### V2-EXEC-2：全量官方 STOCK 自选 Base 与价格依赖移除（2026-09-02）

- 状态：`IMPLEMENTATION_ALLOWED / PRODUCT_RUNTIME_NOT_IMPLEMENTED / DEPLOYMENT_GATES_OPEN`。
- 产品决定：当前观测的194种 ACTIVE Robinhood 官方 STOCK 全部等价准入；Meme 创建者在创建时从中选择恰好一种作为该市场不可变 staking base，同一 STOCK 可被任意多个 Meme 选择。毕业后，STOCK 持有者自行决定是否及向哪些匹配市场分配本金。
- 经济决定：STOCK 只作为 raw-unit 份额权重。`S=0` 时 Creator/Staker/Platform/LP 为40/0/40/20；`S>0` 时为20/40/20/20，Staker 桶按 active STOCK 比例分配。仍保留严格 `>0.5 STOCK`、30秒激活、24小时锁定和实际收费资产原币种结算。
- 技术决定：从当前 ABI、MarketConfig、hash schema、事件、权限和参考模型移除 `targetUsd18`、`backingTargetConfigId`、`backingTargetStock`、价格 Feed 与 sequencer 依赖；旧生成器和快照不删除，统一标记为 `V2-EXEC-1` 历史研究。
- Readiness：`V2-P-010` 与 `V2-T-001` 关闭，implementation open gates 为空；下一任务是 `V2-E-102-A/B`。最终 artifact、CREATE2/codehash、目标链资产身份复核、权限 diff、Fork/E2E、审计、法律和72小时 canary 仍阻止部署或生产声明。

### V2-EXEC-3：10 STOCK饱和的线性质押者份额（2026-09-02）

- 状态：`IMPLEMENTATION_ALLOWED / PRODUCT_RUNTIME_NOT_IMPLEMENTED / DEPLOYMENT_GATES_OPEN`。
- 产品决定：`stakeSaturationWholeTokens` 暂时冻结为 `10`。每市场 `B = stakeSaturationAmount = 10 × 10^stockDecimals`，按 `E=min(S,B)` 线性释放 Staker 总 Bucket；这不是价格、USD 名义目标或 backing target。
- 精确分桶：LP 后的 non-LP 费用为 `D`，`staker=floor(D×E/(2B))`，`remaining=D-staker`，Creator取 `floor(remaining/2)`，最终整数余数归Platform。S=0、S=B/2与S>=B分别约为40/0/40/20、30/20/30/20与20/40/20/20。
- 技术决定：Factory 从 Registry decimals 派生 B，创建者不能覆盖；MarketConfig、expectedEconomics、MarketCreated与FeeBucketsCredited都显式冻结/披露B。状态模型升级为 `V2-STATE-5-FROZEN`；FeePolicy固定 `LINEAR_CAPPED`，未来改变10或算法必须新Factory/FeePolicy/execution spec。
- 验证范围：参考模型与规格测试覆盖6/18 decimals的B、`S=0`、`0<S<B`、`S=B`、`S>B`、极值、取整和同资产守恒。旧 `V2-EXEC-2` 记录保留为历史，不再是当前实现基线。

### V2-E-102：编译接口与 artifact 反向清单（2026-09-03）

- 状态：`DONE / INTERFACE BASELINE READY / PRODUCT RUNTIME NOT IMPLEMENTED`。
- 产物：由 `v2_abi_surface.json` 确定性生成 `contracts/src/v2/interfaces/IV2Protocol.sol`；`v2_compiled_interface_manifest.json` 只在 solc 0.8.26 编译成功后从 Foundry artifact 生成。
- 精确门禁：当前19个模块、80个mutation、54个event、35个required error，以及tuple字段名/类型、输入输出、mutability、event indexed、Foundry method identifier、topic0、caller、执行/状态延迟、锚点、前置条件与recipient逐项核对；缺失、额外或陈旧 artifact/manifest 均非零退出。
- CI：根 `npm test` 与 contracts CI 轨道均执行 `check:interfaces`；生产源码若导入 `spec/interfaces/IV2MutationSurfaceDraft.sol`，boundary check 失败。
- 剩余边界：当前产物仅证明接口 artifact 与冻结机器规范一致，不证明任何 concrete product contract、部署地址/codehash、CREATE2 预测或链上 AccessManager 配置；V2-E-104只提供验证工具，真实证据仍由V2-E-105、产品实现及deployment gates关闭。

### V2-E-103：产品、Fork 与 Deployment CI 硬门禁（2026-09-03）

- 状态：`DONE / CI GATES READY / PRODUCT ACTIVE / FORK FIXTURES_ACTIVE / DEPLOYMENT ACTIVE`。
- 分轨：CI 现分别报告 boundary/spec、interface/scaffold、product contracts、Fork、deployment、off-chain 与 website；deployment 不再混在 off-chain scaffold matrix 中。
- 状态语义：轨道完全为空时输出`NOT_STARTED`并写入GitHub step summary，这不是产品绿灯。Fork的固定manifest、生成器和本地行为测试完整时进入`FIXTURES_ACTIVE`且不要求RPC；一旦出现live fork测试，缺少固定manifest或`ROBINHOOD_RPC_URL`会直接失败。Deployment允许先以schema+validator+tests完整进入`SCHEMA_ACTIVE`，后续preflight实现与测试仍必须同时引入。
- 执行保障：product进入`ACTIVE`后由门禁实际调用Foundry；Fork进入`FIXTURES_ACTIVE`即执行本地fixture测试与hash检查，进入`ACTIVE`后再执行live fork测试；deployment进入`SCHEMA_ACTIVE`或`ACTIVE`后实际执行TypeScript build/test。产品artifact必须在metadata中指回对应source与compilation target，不能由同名空目录冒充。
- 验证：10项门禁单测覆盖三轨`NOT_STARTED`、Fork fixture/live分层、deployment分层状态、部分启动失败和完整清单激活；当前product因两个完整Registry artifact及42项测试为`ACTIVE`、Fork为`FIXTURES_ACTIVE`、deployment因schema与preflight层均完整而为`ACTIVE`。`ACTIVE`只表示该轨实际运行，不关闭任何product/Fork/deployment readiness gate。

### V2-E-104-A：V2 deployment manifest schema（2026-09-03）

- 状态：`DONE / STRUCTURAL VALIDATION READY / LIVE PREFLIGHT NOT IMPLEMENTED`。
- 产物：`deployments/schemas/v2-deployment-manifest.schema.json` 固定 Robinhood chain 4663、finalized-block证据、四个外部依赖、19个协议模块及artifact/codehash、config/Quote/STOCK身份、TOKEN/CURVE/GAUGE/LOCKER CREATE2向量、Gauge clone implementation/immutable-args证据、Hook `0x2044` 与core fee零值、80条协议权限、6条AccessManager管理权限、测试报告、七项deployment gate证据和角色移交。
- Fail-closed：`deployments/src/schema.ts` 使用Draft 2020-12严格校验；统一入口随后应用中央placeholder/reference-fixture/低熵值策略。未知字段、缺少模块、非native零地址、错误Hook bits、权限数量或gate证据漂移均失败。
- 验证：deployment包12项测试通过，其中Schema测试与`v2_compiled_interface_manifest.json`、`v2_permissions_matrix.json`和`v2_execution_manifest.json`反向核对模块、权限与gate identity；Ajv锁定到无已知npm audit漏洞的8.18.0。
- 剩余边界：本项自身没有访问RPC、验证链上getter/codehash/角色或构造交易；这些由`V2-E-104-B`的独立只读层完成。

### V2-E-104-B：只读live deployment preflight（2026-09-03）

- 状态：`DONE / PREFLIGHT TOOLING READY / NO LIVE DEPLOYMENT CANDIDATE`；父任务V2-E-104完成，但七项deployment gate仍开放。
- 固定快照：`deployments/src/v2/preflight.ts`只允许`eth_chainId`、固定block的block/code/call/storage/log读取及交易receipt读取；所有状态查询使用manifest的十进制finalized block转换出的明确tag，不读取`latest`，HTTP transport有15秒超时并校验JSON-RPC响应ID。
- 链上核对：对外部依赖、19模块、Hook、AccessManager、Quote/STOCK proxy/Beacon/implementation及四类CREATE2实例执行Keccak runtime codehash；官方STOCK强制核对EIP-1967 Beacon槽和Beacon `implementation()`，ERC-1967 Quote强制核对实现槽。
- 市场核对：从唯一MarketRegistry读取完整PoolKey、canonical PoolId、MarketRuntime与activeFeeSource/sourceVersion；再核对Hook低14位和`hookPermissionMask=0x2044`、poolBinding、StateView的LP/protocol fee均为0、PositionManager NFT owner及Locker记录。
- 权限核对：manifest 80条协议权限与6条AccessManager管理语义先和机器矩阵做diff；链上逐项读取80个协议selector role，并从AccessManager部署块重放`TargetFunctionRoleUpdated`事件形成最终非零权限集合，额外/缺失/旧selector均失败；四个Safe成员、0/24h/48h delay、role admin与guardian逐项核对，并完整回放RoleGranted/RoleRevoked要求最终成员精确等于四个Safe、无残余ADMIN或未知角色。
- 角色移交：每笔handoff及最终deployer revoke transaction必须有成功receipt、block与manifest一致且不晚于finalized block。HTTP客户端在发网络请求前拒绝`eth_sendRawTransaction`等非只读方法；中央readiness在任何RPC前先行阻止当前`IMPLEMENTATION_ALLOWED`状态。
- 验证：deployment包22项测试通过；live preflight负向矩阵覆盖chain/block/code/getter/storage/sourceVersion/protocol fee/残余或额外角色、错误role admin/guardian、额外selector/失败receipt，以及proxy linkage和604800秒业务state delay语义漂移。测试使用注入的只读RPC，不伪造目标网络部署证据。

### V2-E-105-A：Pons/Quote固定测试夹具（2026-09-03）

- 状态：`DONE / FIXTURES_ACTIVE / NO LIVE FORK EVIDENCE`；父任务V2-E-105完成。
- 确定性清单：`spec/generate_v2_test_fixtures.py`从三份canonical JSON和Foundry artifact生成`contracts/test/v2/fixtures/v2-fork-fixtures.json`，固定每个输入文件的SHA-256、mock deployed runtime Keccak-256及整份canonical fixture hash；`--check`对任一漂移非零退出。
- Quote与Pons：清单精确冻结`NATIVE_ETH_V1`和`USDG_V1`的decimals、phantom、threshold、economics/config ID，USDG proxy/implementation runtime身份，以及block 52289586和52495836的blockHash/factory codehash；14项Pons行为向量及launch付款规则直接来自同一机器输入。CREATE2 reference vector明确不是生产部署证据。
- 恶意行为：本地mock覆盖6-decimal精确ERC-20、100 bps fee-on-transfer、rebase余额漂移、transfer callback重入、false/no-data/malformed返回值和强制native转账；严格接收器只接受32字节canonical true和精确balance delta。强制余额变化只证明不能将合约余额等同于业务到账。
- CI分层：Fork轨道在manifest、生成器和本地测试成套后报告`FIXTURES_ACTIVE`并实际执行Foundry与hash检查；只有新增`contracts/test/v2/fork/*.t.sol`后才要求`ROBINHOOD_RPC_URL`并进入`ACTIVE`，避免把本地mock冒充目标链live replay。
- 验证：Foundry夹具6/6、全合约8/8、CI门禁10/10、fixture hash检查通过；生成时fixture hash为`0xf58031f635165ec953b021da2d1f5a0c33f439a27568dfdbc541802f0bba285f`。完成本项时product仍为`NOT_STARTED`，其后由V2-C-101-A启动；deployment tooling为`ACTIVE`。
- 剩余边界：固定block/hash是可复现输入，不表示当前公共RPC具备archive状态，也不证明USDG部署前指纹未漂移；真实fork replay、生产合约结算路径和部署前资产重审仍由后续产品、Fork及deployment gates完成。

### V2-C-101-A：MarketRegistry存储与canonical discovery（2026-09-03）

- 状态：`DONE / PRODUCT SLICE ACTIVE`；本记录的父任务状态已由后续V2-C-101-B完成所取代。
- 权威存储：`contracts/src/v2/modules/MarketRegistryV2.sol`由immutable Factory独占`registerMarket`，将完整16字段`MarketConfig`和8字段初始`MarketRuntime`写入唯一存储；marketId与Meme Token均write-once，同一Asset UID可安全用于多个市场。
- 登记验证：Registry在写入前反查immutable OfficialStock、ApprovedQuote、PonsBaseline及LaunchTemplate registries，要求全部ACTIVE，并核对Quote/baseline/template/executionSpec/controller/hook mask、`quoteAssetConfigId == economicsHash`、`poolFee=0`、tick spacing范围，以及`stakeSaturationAmount = 10 × 10^stockDecimals`。`launchConfigId=0`保持为合法baseline值。
- 初始状态：精确写入`poolId=0`、`sourceVersion=1`、`recoveryEpoch=0`、`sweptAt=0`、`statusSince=block.timestamp`、`restrictedSince=0`、`NotGraduated=0`、`ACTIVE=0`；显式拒绝超出uint64的时间戳。
- 只读发现：`market`、`marketIdByToken`、`canonicalPoolKey`、`canonicalPoolId`及`activeFeeSource`的selector与生成接口一致；PoolKey按地址排序，native保持address(0)，fee固定0，tickSpacing来自不可变baseline，PoolCreated前expected poolId可读但runtime poolId仍为0。
- 验证：本切片完成时专属Foundry测试14/14通过，覆盖完整快照/事件/初始状态、唯一性、非Factory、同Asset多市场、native/ERC-20排序、五字段PoolId、未知市场fail closed、配置状态/身份漂移、Hook bits、uint64边界及历史市场不受后续config status影响。该阶段artifact模板已由V2-C-101-B最终artifact取代。
- 权限与不变量：本切片当时唯一non-view ABI为canonical `registerMarket(bytes32,MarketConfig)`；没有通用setter、任意source setter、delegatecall或治理直写。完整迁移入口和最终artifact见后续记录。

### V2-C-101-B：MarketRegistry语义化状态迁移（2026-09-03）

- 状态：`DONE / FIRST PRODUCT MODULE COMPLETE / PRODUCT ACTIVE`；父任务V2-C-101完成，本记录中的下一任务已由后续V2-C-102-A完成。
- 启动迁移：Curve独占`markSwept`并要求`NotGraduated + ACTIVE`；immutable GraduationExecutor独占`commitPoolCreated`和`markRescued`。PoolCreated只接受由完整canonical PoolKey推导的非零PoolId并checked递增sourceVersion；Rescued以`sweptAt + 604800`为包含端点且保持终态。
- 市场状态：immutable MarketController独占`ACTIVE -> PAUSED -> ACTIVE`、`ACTIVE/PAUSED -> RETIRED`和`PAUSED/RETIRED -> EMERGENCY_EXIT`；连续受限计时不会被Retired重置，Emergency以86400秒包含端点提交，并checked递增sourceVersion/recoveryEpoch。
- 来源语义：`NotGraduated`返回Curve，`PoolCreated`返回Hook；暂停或退役不抹除来源身份，Swept/Rescued/Emergency返回零来源。Registry只信任immutable执行模块对外部binding、LP锁、Gauge/cap/stateHash前置条件的原子验证，不重复保存从属模块状态。
- ABI与产物：实现显式继承`IMarketRegistryV2`，精确暴露8个mutation和4个canonical事件，无通用setter。`spec/generate_v2_product_artifacts.py`从编译artifact反查接口函数形状、mutability、tuple、mutation集合、事件及indexed位，并生成`spec/v2_product_artifact_manifest.json`；当前manifest hash为`0xc563c20d4640cb194e53776d55380c96cce0604cf5d5b7e8caab24e40e055d3a`。
- 验证：专属Foundry测试28/28通过，覆盖固定调用者、全部允许/拒绝边、事件负载、七日/一日精确边界、canonical PoolId、暂停/退役来源语义、终态及uint32/uint64溢出回滚。最终未链接runtime模板10157 bytes、7组immutable引用、Keccak `0x30ff449495fde88eaa11b9c3cae38e6b47c0ef26de03f38d29b4b34a67e5c7c7`；构造参数链接后的部署codehash仍属于deployment evidence。

### V2-C-102-A：OfficialStockRegistryV2（2026-09-03）

- 状态：`DONE / SECOND PRODUCT MODULE COMPLETE / PARENT V2-C-102 IN_PROGRESS`；下一子任务为V2-C-102-B `ApprovedQuoteRegistry`。
- 身份与追加性：每个非零Asset UID只可登记一次，Stock Token和UserStockVault均有反向唯一性保护；Token与Vault必须是互异的已部署地址，`tokenDecimals`冻结在机器数值规范批准的6–18范围。不存在symbol、name、ISIN、价格、Feed、USD/backing target或batch mutation。
- 状态机：精确实现`UNSET -> ACTIVE <-> PAUSED -> RETIRED`，只有ACTIVE可暂停、PAUSED可恢复、ACTIVE/PAUSED可退役，RETIRED为终态；状态迁移只修改status，原始UID/Token/Vault/decimals永久不变，并发出canonical old/new/reason事件。
- 权限：新增共享`ImmutableAccessManaged`适配器，以immutable AccessManager按target+selector授权且不暴露`setAuthority`旁路；零延迟操作可由角色成员直接调用，24h/48h操作必须由AccessManager在schedule到期后通过`execute`调用。
- 范围边界：合约只验证非零、runtime code存在、唯一性与decimals数值域；Robinhood目录、`uid()`、proxy/Beacon/implementation及runtime fingerprint仍由生产登记前同一finalized block的deployment preflight负责。195项连续登记测试证明194只是当前观测，不是协议容量。
- ABI与产物：产品artifact门禁确认5个canonical函数全部匹配、4个mutation无额外旁路、2个事件及indexed位精确；两模块manifest hash为`0x0eba99b2759f3471109392e27515ad7402243898e0a36a294353f025d60d3d3d`。OfficialStockRegistry未链接runtime模板2258 bytes、1组immutable引用、Keccak `0x7938ab6b9699c0dcf72f1efbae3f802f76de5a7be8cd9a0f7570682f5e8a5153`，不是最终部署codehash。
- 验证：专属Foundry测试14/14通过；覆盖真实OpenZeppelin AccessManager 48h注册/退役及24h恢复包含端点、即时Guardian暂停、未授权调用、所有合法与非法状态边、构造权限地址、零值/EOA/同址/decimals边界、UID/Token/Vault重复、事件负载、未知UID零状态及第195项登记。当前Product合计42项测试。

### V2-C-102-B：ApprovedQuoteRegistry（2026-09-03）

- 状态：`DONE / THIRD PRODUCT MODULE COMPLETE / PARENT V2-C-102 IN_PROGRESS`；下一子任务为V2-C-102-C `PonsBaselineRegistry`与`LaunchTemplateRegistry`。
- 内容寻址：每个非零config ID只可登记一次，并强制等于`keccak256(abi.encode(TICKERGARDEN_V2_QUOTE_ECONOMICS domain, schemaVersion=1, chainId, ponsBaselineId, quoteAsset, quoteDecimals, phantomQuote, graduationThreshold))`及config内`economicsHash`；status不进入hash，历史经济字段不可覆盖。
- 资产与数值域：native只允许`address(0)`/18 decimals；ERC-20必须有runtime code且登记时`decimals()`精确匹配；统一限制在机器规范冻结的6–18 decimals，并拒绝零phantom、零threshold及两者加法溢出。fee-on-transfer、rebasing、callback依赖、proxy/implementation/runtime指纹与exact balance delta仍由同一finalized block部署preflight负责。
- 状态与权限：精确实现`UNSET -> ACTIVE <-> PAUSED -> RETIRED`；48h Protocol Admin新增/退役、即时Guardian暂停、24h延时恢复均通过immutable AccessManager按selector授权，RETIRED为终态。
- ABI与产物：产品artifact门禁确认5个canonical函数、4个mutation、2个事件及indexed位精确；三模块manifest hash为`0x030ac36922933651c2977c78c4ad559181c7b04c3b47584dbb0b61e8c951fb3a`。ApprovedQuoteRegistry未链接runtime模板2841 bytes、1组immutable引用、Keccak `0x2a7e85f46118899da91e98ff2f10771aa203242963a38a9c2e0a4428671cd369`，不是最终部署codehash。
- 验证：专属Foundry测试17/17通过；覆盖首发native/USDG冻结向量、ERC-20 live decimals、内容hash、追加不可覆盖、未知配置UNSET、完整状态机、事件、权限与24h/48h精确延迟。当前Product合计59项测试。

### V2-C-102-C：PonsBaselineRegistry与LaunchTemplateRegistry（2026-09-03）

- 状态：`DONE / FOURTH+FIFTH PRODUCT MODULES COMPLETE / PARENT V2-C-102 DONE`；下一任务为V2-C-103-A固定供应`TickerMemeTokenV2`。
- Baseline：非零ID追加且write-once，冻结reference chain/factory/runtime codehash、合法的零`launchConfigId`、正供应、`curveFeeBps < 10000`、`poolFee == 0`、1–32767 tick spacing与非零behavior vector root；登记时核对reference Factory现存runtime codehash，不建立Pons运行时依赖。
- Template：非零ID追加且write-once，冻结Token/Curve/Gauge/Hook/Locker实现与runtime codehash、GraduationExecutor、feePolicy及精确`V2-EXEC-3`；所有组件必须已有代码，Hook低14位精确为`0x2044`。canonical template hash按冻结schema计算且不包含status，固定机器向量已逐字节通过。
- 状态与权限：两个Registry均精确实现`UNSET -> ACTIVE <-> PAUSED -> RETIRED`；48h Protocol Admin新增/退役、即时Guardian暂停、24h延时恢复通过immutable AccessManager按selector授权，RETIRED为终态。
- ABI与产物：五模块manifest hash为`0xa691f179538b1490d82382b6d71cbe5be3f7356e116c70c378a3c677a74679ad`。PonsBaselineRegistry未链接runtime模板2566 bytes、Keccak `0x7ba2e59c315a35d0d0678ede07e1207812971fdf3ec096af9a27b3f707a87015`；LaunchTemplateRegistry模板3686 bytes、Keccak `0x2ce849b273f245899906a97ae2c1a71a8c965a30c11fb306b1eb889b3029a43c`；各1组immutable引用，均非最终部署codehash。
- 验证：PonsBaseline专项14/14、LaunchTemplate专项16/16通过，覆盖canonical selector/event、全部字段边界、runtime codehash、固定template hash向量、追加不可覆盖、未知UNSET、完整状态边及24h/48h精确延迟。当前Product合计89项测试。

### V2-C-103-A：TickerMemeTokenV2（2026-09-03）

- 状态：`DONE / SIXTH PRODUCT MODULE COMPLETE / PARENT V2-C-103 DONE`；下一任务为V2-C-104-A Creator beneficiary epoch。
- 供应与身份：构造时冻结非零`marketId`、creator、部署Factory、metadataURI与initialSupply，全部供应只铸造一次并直接进入predicted Curve；Factory与creator均不接收初始余额。
- ERC-20边界：固定18 decimals并采用标准transfer/approve/transferFrom语义；canonical机器ABI已补齐9个ERC-20函数和`Transfer/Approval`事件，三项标准mutation均为PUBLIC且无额外管理mutation。
- 禁止路径：runtime没有mint、burn、tax、rebase、blacklist、pause、metadata setter、AccessManager或V1 EmissionController入口；普通转账与授权不改变totalSupply。
- ABI与产物：六模块manifest hash为`0x3eac8dfb039731c509fda7b43361ef19ff0aec77811a3ad362e43aba10819fe1`。Token未链接runtime模板1986 bytes、4组immutable引用、Keccak `0x52b3ab1ace72aa98aa8eed29586259ef004af73be151e0082ec87da94a6f2a91`；constructor args链接后的CREATE2 initCodeHash与最终部署codehash仍属于Factory/deployment evidence。
- 验证：专项Foundry测试7/7通过，覆盖身份/metadata、18 decimals、全量Curve初始余额、标准事件与转账授权、CREATE2预测及Curve参数绑定、零身份/供应拒绝和禁止selector；当前Product合计96项测试。

### V2-C-104-A：CreatorRevenueRegistry（2026-09-03）

- 状态：`DONE / SEVENTH PRODUCT MODULE COMPLETE / PARENT V2-C-104 DONE`；V2-C-105依赖解除，下一任务为V2-C-105-A typed marketId/component salt/CREATE2库。
- 初始化：immutable Factory只能在MarketRegistry已有market快照后初始化一次epoch 1，且非零beneficiary必须精确等于`creatorRevenueBeneficiaryAtCreation`；未知市场、零epoch、重复初始化和身份不匹配均fail closed。
- 变更边界：只有current epoch beneficiary可追加不同的非零beneficiary；NotGraduated阶段先调用exact registered Curve的`sweepCurveFees()`，所有阶段都在checked递增前确认`accruedCurveFees()==0`，历史epoch永不覆盖。
- 原子与安全：sweep失败或残留accrual会回滚全部状态；`ReentrancyGuard`阻止Curve回调在外层epoch提交前重入覆盖；uint32 epoch不能回绕。管理员、Guardian、Recovery和Factory不存在beneficiary override或batch mutation。
- ABI与产物：七模块manifest hash为`0x1488405f23ca7918919c80de72d568bef92432bd7c222bf7703befcf6e04c4c1`。CreatorRevenueRegistry未链接runtime模板2800 bytes、2组immutable引用、Keccak `0x31ae0c1dd0cf9922bb152493f461ea7c45fc318aa5f9730b88a8618f9bc36234`，不是最终部署codehash。
- 验证：专项Foundry测试14/14通过，覆盖Factory初始化、MarketConfig一致性、权限、事件、zero/no-op与非零sweep、旧epoch观测顺序、失败回滚、Swept/PoolCreated/Rescued边界、历史查询、overflow和回调重入；当前Product合计110项测试。

### V2-C-105-A：typed identity与共用CREATE2（2026-09-03）

- 状态：`DONE / PARENT V2-C-105 IN_PROGRESS`；下一子任务为V2-C-105-B Factory校验、配置快照与多Meme创建。
- Typed identity：`V2Identifiers`逐字段实现schema v1 marketId；字符串入口只负责先做UTF-8 bytes Keccak。四类组件只映射到`keccak256("TOKEN"/"CURVE"/"GAUGE"/"LOCKER")`，component salt固定绑定chainId、Factory和marketId，不编码enum ordinal或caller。
- CREATE2：`V2Create2`统一full creation code+constructor args哈希、EIP-1014预测和实际部署；部署地址已有代码时显式碰撞失败，create2返回零、地址不符或无runtime code时整笔回滚，不存在nonce fallback。
- 验证：专项Foundry测试10/10通过，覆盖冻结marketId机器向量、UTF-8字符串、全部身份字段敏感性、四类kind/salt/address合成向量、chain/factory/market/kind域隔离、constructor args、真实预测/部署一致、碰撞、空代码及Factory/GraduationExecutor deployer差异。该结果只关闭算法与共用层；最终Curve/Token/Gauge/Locker initCodeHash、实际产品地址与production manifest仍属于后续集成及`V2-GAP-009`。

### V2-C-105-B：Factory配置快照与expectedEconomics（2026-09-03）

- 状态：`DONE / PARENT V2-C-105 IN_PROGRESS`；下一子任务为V2-C-105-C组件部署、初始化与Registry登记原子化。
- Schema闭合：补齐此前缺失的`ponsBaselineHash`版本化公式（domain `TICKERGARDEN_V2_PONS_BASELINE`、schema v1、排除可变status）及机器向量；`V2MarketEconomics`按冻结字段实现baseline、fee policy与schema v2 expectedEconomics，所有字符串/creator/beneficiary/salt保持只进入marketId而不污染economics。
- Factory校验：`V2FactoryValidation`从OfficialStock、ApprovedQuote、PonsBaseline与LaunchTemplate四个Registry读取ACTIVE快照，交叉核对Quote→Baseline及Template→FeePolicy/`V2-EXEC-3`，派生`B=10×10^stockDecimals`，并拒绝caller提交的任意economics别名。当前FeePolicy枚举编码冻结为feeAssetMode=1、stakerReleaseMode=1。
- 身份边界：直接创建者只来自`msg.sender`；组合创建只接受immutable Router传入的非零creator，逻辑不读取`tx.origin`。身份保留按marketId而不是assetUid，因此同一官方STOCK可对应多个不同Meme，完全重复身份失败。
- 验证：专项Foundry测试10/10通过，覆盖Pons baseline与expectedEconomics冻结机器向量、ACTIVE门禁、跨Baseline/Template策略漂移、10 STOCK派生、错误economics、零身份、Router认证、同Asset UID多marketId及重复identity。实际Token/Curve/Gauge部署、公开Factory ABI、Creator epoch初始化、MarketRegistry登记及任一步失败全回滚由V2-C-105-C统一实现和验收。

### V2-C-107-A：Curve供应分区与tracked reserve（2026-09-03）

- 状态：`DONE / PARENT V2-C-107 IN_PROGRESS`；由于V2-C-105-C所需Curve/Gauge initCode尚不存在，关键路径先推进可独立验收的Curve实现，下一子任务为V2-C-107-B buy/sell/quote整数数学。
- 供应分区：`PonsSupplyMath`使用OpenZeppelin 512-bit `mulDiv`精确实现`reserved=floor(supply×phantom/(phantom+threshold))`与`sellable=supply-reserved`，拒绝零输入、分母溢出、reserved舍入为零或不小于supply。
- Tracked accounting：初始化只写`trackedTokens=supply`及冻结reserved；sellable、pricing Quote/Token reserve只读取内部tracked state，显式拒绝token低于reserved及accrued fee超过tracked Quote。外部强制转入余额不参与定价、费用或毕业进度。
- 毕业二次分区：同一库实现`poolMeme=floor(sweptTokens×sweptQuote/(sweptQuote+phantom))`和`lockedExcess=sweptTokens-poolMeme`，拒绝零、退化及溢出输入，避免把reserved直接全部注入LP。
- 验证：专项Foundry测试11/11通过并含256轮fuzz；覆盖native/USDG冻结供应向量、毕业pool/excess向量、uint256中间乘积、供应守恒、tracked reserve下限、fee排除、强制余额不影响及全部无效边界。真实Curve initializer仍须在后续模块中核对实际收到的固定供应后再采用此tracked初态。

### V2-C-107-B：buy/sell/quote整数数学（2026-09-03）

- 状态：`DONE / PARENT V2-C-107 IN_PROGRESS`；下一子任务为V2-C-107-C anti-snipe与受限豁免。
- 单一路径：新增`PonsCurveMath`纯函数库实现exact-input `amountOut`与exact-output `amountIn`，后者保留Pons固定的`floor+1`；缩放乘加溢出显式fail closed，分式使用OpenZeppelin 512-bit `mulDiv`。
- 费用顺序：buy对基础费与additional Quote fee分别floor后以net Quote定价；sell先算gross Quote再分别floor扣费。combined fee必须小于10000 bps，creator tax不进入数学接口。
- 尾段数学：统一quote路径限制tokensOut不超过sellable，使用exact-output反算和无加法溢出的ceil得到quoteSpent，随后按最终spent重新计算两个fee leg；refund取未使用Quote，partial-fill滑点用两个512-bit乘积直接比较。该纯计算为V2-C-107-D预置，但真实转账、退款失败回滚与会计状态仍未关闭。
- 验证：专项Foundry测试13/13通过并含256轮fuzz；固定覆盖`AMOUNT_OUT_INTEGER_FLOOR`、buy fee-before-pricing、双fee独立floor、sell fee-after-gross、tail fill/refund及price-bound向量，并覆盖quote/执行同结果路径、极小额、combined fee、reserve、uint256溢出和溢出乘积滑点比较。native/ERC-20 exact-arrival、重入与状态更新只能在concrete Curve中验收，不由纯数学库冒充完成。

### V2-C-107-C：anti-snipe与受限豁免（2026-09-03）

- 状态：`DONE / PARENT V2-C-107 IN_PROGRESS`；下一子任务为V2-C-107-D concrete Curve尾单、partial fill与退款。
- 冻结策略：新增`PonsAntiSnipe`，只查active runtime证据固定的elapsed `0/1/2/≥3` raw表`9900/618/19/0`，不采用文档5秒、源码默认15秒或任何插值公式；current timestamp早于launch timestamp显式失败。
- Clip与费用：`minimumNetBps=100`、`creatorTaxBps=0`写死在策略层；effective取`min(raw,10000-feeBps-100)`，基础费若不能留下minimum net则fail closed。反狙击只作为buy的第二个Quote fee leg进入`PonsCurveMath`，两个fee仍分别floor后再定价。
- 豁免收窄：creator与creation-time beneficiary按冻结地址识别；atomic first-buy recipient仅在caller等于冻结Launch Router且同一原子上下文显式提供recipient时豁免。无数组、管理员写口或`tx.origin`身份；普通caller即使复用首买recipient也不豁免。真实Curve仍须从immutable/MarketConfig取得这些身份，不能接受用户参数。
- 验证：专项Foundry测试13/13通过并含256轮fuzz；逐单位覆盖五项anti-snipe固定向量、elapsed边界及任意≥3值、9800 clip、minimum-net端点、creator/beneficiary/首买recipient/普通地址、假首买caller、零身份、未来launch时间和无插值不变量。真实`block.timestamp`接线及Router/MarketConfig身份来源将在concrete Curve集成时复验。

### V2-C-107-D：concrete Curve尾单、partial fill与退款（2026-09-03）

- 状态：`DONE / PARENT V2-C-107 IN_PROGRESS`；下一子任务为V2-C-107-E最终Curve fee sweep、完成信号和毕业交接。
- 部署闭环：新增产品模块`PonsCompatibleCurve`。其CREATE2 creation code只绑定Factory；构造期间从部署Factory读取按预测Curve地址限定的pending snapshot，随后验证Meme Token的marketId/creator/factory/supply及预测地址已收到exact全量供应。这样解除Token constructor需要Curve地址、Curve又需要Token地址的循环，同时不增加可抢跑的公开initializer mutation。
- 交易与储备：每次quote/buy/sell均回读MarketRegistry并核对exact Curve、Meme、Quote、baseline/config与creation beneficiary；仅`NotGraduated+ACTIVE`可交易。buy按spent增加tracked Quote并单独累计双fee，sell按实际net Quote支出减少tracked余额并累计fee，使`trackedQuote-accruedFees`恰好按gross变动；强制余额不进入任何定价或毕业判断。
- 结算与尾段：native强制`msg.value==quoteIn`，ERC-20强制32-byte true返回以及Curve/recipient双边exact balance delta；异常返回、fee-on-transfer、callback、转账失败均回滚。尾段采用共用full-precision quote，Meme不低于reserved floor，unused Quote只退`msg.sender`，拒收退款回滚Token与全部会计；达到floor后发`CurveCompleted`并永久拒绝后续buy/sell，等待下一子任务原子sweep/close。
- ABI与产物：新增第八个canonical产品模块，mutation严格只有`buy/sell/sweepCurveFees`，事件集合与`IPonsCompatibleCurve` exact diff；产品manifest更新为`0x95c4b274fb683c4d55f0526de5591aecabada32a2da1f0970c5bfc6972ee9c2a`。当前sweep路径已具备nonce/feeId/转账/credit失败全回滚基础，但最终买入自动sweep、MarketRegistry `markSwept`和GraduationExecutor可捕获子调用仍属于V2-C-107-E。
- 验证：专项Foundry测试15/15通过，覆盖native/ERC-20尾单、比例滑点、退款事件和拒收回滚、严格付款、异常返回、fee-on-transfer、重入、暂停/完成终止、sell gross/fee储备守恒、强制余额隔离、认证Router一次首买豁免、基础sweep原子性及canonical selectors。Product测试增至125项；完整workspace结果以本任务最终门禁为准。

### V2-C-107-E：Curve最终sweep、完成信号与毕业交接（2026-09-03）

- 状态：`DONE / PARENT V2-C-107 DONE`；Curve关键路径已闭合。Gauge仍是Factory组件集成的唯一未形成creation code依赖；后续最初实现的每 Asset Vault 已由 V2-C-206 MultiAsset 修订替代。
- 最终交易顺序：尾单先完成精确成交、Meme交付和调用者原路退款，发出唯一`CurveCompleted`；随后内部执行最后一次Curve fee sweep，以checked `sweepNonce`和冻结domain构造feeId，清零accrual并由FeeVault实际到账校验。sweep、退款或后续托管/Registry提交任一步失败均回滚整笔最终买入。
- 托管与状态：Curve只把内部tracked真实Quote及reserved Meme按exact delta转给MarketRegistry绑定的immutable GraduationExecutor；强制转入余额不混入毕业资产。随后exact Curve调用`markSwept`并回读确认`Swept+ACTIVE`，清零Curve tracked余额并发`LaunchSwept`。Swept后buy/sell/sweep均永久关闭，重复完成与重复Curve毕业入口不可达。
- 可捕获毕业：Curve仅对`graduateFromCurve(marketId)`子调用使用`try/catch`。成功路径由Executor原子提交`PoolCreated`；任意revert以`keccak256(revertData)`形成确定性`reasonHash`并发`AutoGraduationFailed`，外层保留已完成的fee归属、资产托管和retryable `Swept`。完整Locker/V4/retry/rescue算法仍由V2-C-303/V2-C-304实现，不在Curve mock中冒充完成。
- ABI与产物：canonical mutation/event集合不变；第八个产品模块manifest更新为`0x85d1caa07dadd7ff6b003e9783f0079f7a0836cf2fce09a30e1675010288ee4b`。Curve构造期snapshot新增并验证GraduationExecutor，且必须与MarketRegistry immutable getter一致。
- 验证：Curve专项Foundry测试19/19通过，新增覆盖native/ERC-20最终fee与双资产托管、feeId字段、自动毕业成功、失败原因哈希与Swept保留、最终sweep失败全回滚、markSwept失败全回滚、零accrual不消费nonce及关闭后重复sweep失败。Product测试增至129项；完整workspace结果以本任务最终门禁为准。

### V2-C-201-A：Vault初始化与Asset/Vault唯一绑定（2026-09-03）

- 状态：`DONE / PARENT V2-C-201 IN_PROGRESS`；下一子任务为V2-C-201-B `depositStock/depositStockFor`与实际到账。
- 历史实现：本子任务最初按“一 Asset 一 Vault”冻结Asset UID和canonical STOCK；该部署拓扑已由V2-C-206替代。现行`UserStockVaultIdentity`只冻结OfficialStockRegistry、MarketRegistry和唯一AllocationManager，并通过每次调用的显式`assetUid`从Registry解析canonical STOCK。
- 现行身份与权限：canonical检查要求OfficialStockRegistry返回的`assetUid -> stockToken/userStockVault`逐地址等于本实例，allocation阶段还要求MarketRegistry返回exact market Asset UID；ACTIVE检查拒绝UNSET/PAUSED/RETIRED。allocation mutator边界只接受immutable AllocationManager，两个Registry/Manager必须有代码且互异；身份层没有Gauge地址、token `approve`、任意execute或管理员本金转移能力。
- ABI边界：最终Vault公开`vaultIdentity()`返回三个immutable依赖及schema ID；Registry通过`vaultSchemaId(vault)`与`vaultForSchema(schemaId)`强制每个schema只登记一个canonical Vault。资产仍由OfficialStockRegistry按UID发现，不增加Token地址型写入口或链上资产枚举。
- 验证：专项Foundry测试7/7通过，覆盖构造期冻结、无initializer、零地址/无代码/依赖别名、未登记和错误Vault绑定fail closed、两个Asset各自独立精确绑定、暂停后身份保留但新增活动关闭、AllocationManager唯一调用者，以及Vault/Manager初始零本金和零allowance。完整workspace结果以本任务最终门禁为准。

### V2-C-201-B：deposit/depositFor与实际到账（2026-09-03）

- 状态：`DONE / PARENT V2-C-201 IN_PROGRESS`；下一子任务为V2-C-201-C free/allocated/market三层账本。
- 存款路径：新增共享`UserStockVaultDeposits`层。`depositStock`固定payer与记账用户均为外层caller；`depositStockFor`只允许immutable AllocationManager，并由后续Manager把其外层`msg.sender`作为固定user传入。两条路径都由Vault直接从user拉取STOCK，Manager不接收本金且不需要用户allowance；实现不使用`tx.origin`或任意recipient。
- 精确到账：存款前先验证Registry exact binding与Asset ACTIVE，再执行严格ERC-20 `transferFrom`。返回值必须为exact 32-byte true，Vault余额增量必须逐单位等于声明amount；零额、零/Vault自身账户、false/no-data/malformed返回、transfer revert、fee-on-transfer、余额正向漂移及callback重入均fail closed。
- 原子会计：只有转账与余额差验证全部成功后才checked增加`deposited[assetUid][user]`和`totalDeposited[assetUid]`，任何失败同时回滚Token allowance、用户余额、Vault余额与该资产内部账本。事件由最终Vault外层在成功后按canonical `StockDeposited(assetUid,user,amount)`发出；共享层不扩张产品ABI。
- 验证：专项Foundry测试8/8通过，覆盖直接调用者记账、组合外层用户传递、公众伪造depositFor、Vault-only allowance、零额/非法账户、PAUSED门禁、fee-on-transfer、正向rebase、三种异常返回、transfer revert和回调重入。完整workspace结果以本任务最终门禁为准。

### V2-C-201-C：free/allocated/market三层账本（2026-09-03）

- 状态：`DONE / PARENT V2-C-201 IN_PROGRESS`；下一子任务为V2-C-201-D普通withdraw与Emergency force release。
- 账本闭环：共享`UserStockVaultLedger`的全部状态先按`assetUid`分区，再维护user、market与asset total聚合。Manager-only lock同步增加四层占用，release同步减少，move只在同一资产的两个market维度搬移，因此始终保持`deposited[assetUid][user]=free[assetUid][user]+allocated[assetUid][user]`、用户市场求和、市场用户求和和单资产总量三组等式。
- 身份边界：Vault identity新增immutable MarketRegistry依赖；每个lock/release/move运行时同时复核OfficialStockRegistry exact UID/Token/Vault绑定及MarketRegistry的exact `marketId -> assetUid`绑定。未知、零或跨Asset市场fail closed；同市场move、零额、零/Vault账户、超过free及超过源市场占用均在写状态前拒绝。市场阶段、状态、最小仓位和Gauge结算仍由后续AllocationManager负责，普通退出不会被Vault的ACTIVE门禁误阻断。
- 本金安全：allocation操作不转移STOCK、不创建allowance，也不把Gauge状态当作本金账本；move保持用户与全局allocated不变，任何检查或算术失败都会原子回滚全部维度，禁止同一份deposit重复占用。
- 验证：Vault共享层专项Foundry测试24/24通过，其中新账本9项并含256轮fuzz；覆盖多用户/多市场聚合、canonical事件post-state、Manager权限、越额/非法输入、未知/跨Asset市场、部分释放、源余额不足、迁移守恒及同市场拒绝。完整workspace结果以本任务最终门禁为准。

### V2-C-201-D：普通withdraw与Emergency force release（2026-09-03）

- 状态：`DONE / PARENT V2-C-201 DONE`；第九个canonical产品模块`UserStockVault`完成，下一子任务为V2-C-202-A allocate/increase统一preflight。
- 普通提款：`withdrawFreeStock(assetUid,amount)`固定用户和收款人均为`msg.sender`，只扣减该资产free范围内的`deposited`与`totalDeposited`，不接受owner/recipient。提款仅复核canonical Asset绑定而不要求ACTIVE，因此Asset PAUSED/RETIRED不能扣押本金；状态effects先写，随后严格要求ERC-20 exact 32-byte true、Vault余额精确减少及用户余额精确增加，任一异常原子回滚。
- 终态逃生：`forceReleaseAllocation(assetUid,marketId)`从MarketRegistry核验exact market Asset UID且只接受`EMERGENCY_EXIT`，读取并清零调用者自己的market allocation，同步减少该资产user/market/global allocated后变为free balance，事件中的recoveryEpoch直接取Registry权威。它没有user/recipient参数，不转STOCK、不调用Gauge、不等待root或奖励恢复；ACTIVE/PAUSED/RETIRED、未知/跨Asset市场、零仓位及重复释放均失败。
- 历史产物：本节记录的单资产Vault ABI与9模块hash已由V2-C-206的MultiAsset ABI及当前十九模块产物替代；旧hash仅用于追溯，不代表现行发布候选。
- 验证：产品专项Foundry测试11/11通过并含256轮fuzz；覆盖free/allocated提款边界、PAUSED/RETIRED提款、异常返回、revert、fee-on-transfer、正向余额漂移、callback重入、三种非Emergency状态、本人/他人隔离、重复/未知/跨Asset释放、事件epoch及先提free再终态释放的本金全额取回。Product测试增至140项；完整workspace结果以本任务最终门禁为准。

### V2-C-202-A：allocate/increase统一preflight（2026-09-03）

- 状态：`DONE / PARENT V2-C-202 IN_PROGRESS`；下一子任务为V2-C-202-B decrease/close与暂停退出。由于concrete Gauge仍属于V2-C-203/C-204，本子任务以可组合共享层和严格Gauge mock闭合Manager边界，不提前发布不完整AllocationManager产品mutation。
- 门禁与身份：新增`AllocationManagerIncreases`，所有入口把user固定为外层`msg.sender`。每次动态读取MarketRegistry，只允许`PoolCreated + Market ACTIVE`，再读取OfficialStockRegistry要求Asset ACTIVE及canonical Token/Vault/Gauge均为有代码且不互相别名；Quote后续PAUSED/RETIRED按V2-EXEC-3只影响新市场，不静默关闭历史PoolCreated市场分配。
- 固定顺序：先在所有外部状态写入前checked计算`activationAt=now+30s`和`unlockAt=now+24h`，随后严格执行Gauge checkpoint、settle、读取仓位并与Vault allocation对账、Vault lock、Gauge addPending，最后再次核对Gauge与Vault结果。任一步revert、no-op或回调重入都会回滚checkpoint、settlement及Vault占用。
- 数值边界：结果仓位按Registry冻结decimals计算`minimum=5×10^(decimals-1)+1 raw unit`，因此exact `0.5 STOCK`失败而多1 raw unit成功；已有合法仓位可增加任意正raw unit。零额、时间越过uint64调度域、Vault free不足及预存Gauge/Vault账本不一致均fail closed。
- 验证：共享层专项Foundry测试13/13通过，覆盖18位与6位decimals端点、四种launch phase、四种market status、Asset PAUSED/RETIRED、精确30秒/24小时调度、连续增仓合并重置、checkpoint/settle/addPending故障、Gauge no-op、余额不足、账本漂移、重入、构造依赖及不存在allocateFor/increaseFor mutation。完整workspace结果以本任务最终门禁为准。

### V2-C-202-B：decrease/close与暂停退出（2026-09-03）

- 状态：`DONE / PARENT V2-C-202 IN_PROGRESS`；下一子任务为V2-C-202-C depositAndAllocate身份与原子性。concrete Gauge尚未完成，因此继续用可组合共享层与具备成熟pending物化、调用顺序和故障注入的严格mock验收Manager路径。
- 退出门禁：新增`AllocationManagerDecreases`，decrease/close均把user固定为`msg.sender`。只接受已进入PoolCreated且尚未进入Emergency的源市场；Market ACTIVE/PAUSED/RETIRED及Asset ACTIVE/PAUSED/RETIRED均允许到期普通退出，Emergency必须改走Vault force release。
- 固定顺序：每次先Gauge checkpoint并settle调用者、核对Gauge active+pending与Vault allocation，再以`block.timestamp >= unlockAt`包含端点校验锁定。之后先调用Gauge remove并核对结果，再调用Vault同额release，最终再次验证双方账本；释放只增加Vault free balance，不向用户或任意recipient直接转STOCK。
- 数值与原子性：partial decrease后的非零剩余仍须严格大于0.5 STOCK，close则读取结算后的全部仓位并清零。零额、超过当前仓位、空仓close、`unlockAt-1`、Gauge/Vault账本漂移、checkpoint/settle/remove失败、remove no-op及重入均在整笔交易中回滚。
- 验证：AllocationManager共享层专项测试25/25通过，其中C-202-B新增12项并含256轮fuzz；覆盖部分/全量退出、canonical Vault事件、精确unlock端点、暂停/退休与Asset状态变化、Emergency和非PoolCreated拒绝、最低剩余仓位、空仓/越额、四种Gauge故障/no-op、账本漂移、重入及不存在decreaseFor/closeFor mutation。完整workspace结果以本任务最终门禁为准。

### V2-C-202-C：depositAndAllocate身份与原子性（2026-09-03）

- 状态：`DONE / PARENT V2-C-202 IN_PROGRESS`；下一子任务为V2-C-202-D migrateAllocation。concrete Gauge尚未完成，因此继续以共享组合层和严格Gauge mock验证跨Vault/Gauge的单交易边界，不提前发布缺少迁移入口的AllocationManager产品模块。
- 身份与本金路径：新增`AllocationManagerDeposits`，公开入口只能把外层`msg.sender`传为user，不存在For/recipient重载。它先验证allocation正额、目标`PoolCreated + Market ACTIVE + Asset ACTIVE`及调度时间，再调用canonical Vault的`depositStockFor(assetUid, user, depositAmount)`；STOCK由Vault直接从用户拉取，Manager始终不持有本金且无需任何allowance。
- 组合与原子性：存款到账后复用C-202-A唯一增仓核心，严格执行Gauge checkpoint、settle、双方账本预对账、Vault lock、Gauge addPending及最终对账。`depositAmount`可小于、等于或大于`allocationAmount`并可消费既有free；存款异常、free不足、最低仓位失败、Gauge任一步失败/no-op、账本漂移或回调重入都会连同Token余额、allowance、Vault存款与分配账本、Gauge状态整笔回滚。
- 验证：AllocationManager A/B/C共享层专项测试37/37通过，其中C-202-C新增12项并含256轮fuzz；覆盖caller身份和两个canonical Vault事件、仅Vault授权、三种存款/分配数量关系、市场与Asset预门禁、零额、最低仓位raw-unit端点、free不足、四种Gauge故障/no-op、账本漂移、uint64时间边界、恶意Token回调、不存在For/recipient mutation，以及Manager零本金。完整workspace结果以本任务最终门禁为准。

### V2-C-202-D：migrateAllocation（2026-09-03）

- 状态：`DONE / PARENT V2-C-202 DONE`；第十个canonical产品模块`AllocationManager`完成，V2-C-203依赖解除，下一子任务为V2-C-203-A 32槽generation与聚合bucket。
- 路由与门禁：迁移固定作用于`msg.sender`，拒绝同市场、零额、空仓、越额、跨Asset、跨Vault及Gauge别名。源只接受PoolCreated且非Emergency，因而PAUSED/RETIRED到期后可迁出；目标必须`PoolCreated + Market ACTIVE + Asset ACTIVE`。目标Registry、Gauge/Vault预账本、目标最低结果及uint64调度时间均在源权重写入前完整验证。
- 固定顺序与计奖：按规范性V2-EXEC-3执行源Gauge checkpoint/settle/成熟pending物化、锁定与最低余仓校验、源Gauge remove、Vault同额move、目标Gauge checkpoint/settle、目标addPending。源非零余仓unlock不变；目标已有active继续计奖，已有未成熟pending与迁入量合并并把generation重置为`now+30s`，目标整仓unlock重置为`now+24h`；迁移量先退出源权重再进入目标pending，不存在重叠或历史奖励倒灌。
- 原子性与ABI：每阶段都核对Gauge/Vault结果；checkpoint、settle、pending未物化、remove/add失败或no-op、Vault移动、错误schedule、锁被篡改及回调重入均回滚双方Gauge和Vault聚合。最终模块精确实现`IAllocationManager`六个mutation和唯一`AllocationMigrated`事件，不存在For/recipient/batch入口，Manager不接收STOCK。
- 验证：产品专项Foundry测试14/14通过并含256轮fuzz；覆盖部分/全量迁移、精确事件与调用顺序、目标active和未成熟pending、源PAUSED/RETIRED/Emergency、目标phase/status/Asset门禁、unlock包含端点、源/目标最低raw-unit边界、跨Asset和Gauge别名、双方全部故障/no-op/schedule漂移、账本漂移、时间溢出、重入、身份旁路及Vault所有聚合与Token余额守恒。产品manifest增至10个模块，hash为`0x4599a90f53e40f587a50f4be6b7bac879c3ca444d5248978a2b8a9ba8420bb34`；完整workspace结果以本任务最终门禁为准。

### V2-C-203-A：32槽generation与聚合bucket（2026-09-03）

- 状态：`DONE / PARENT V2-C-203 IN_PROGRESS`；下一子任务为V2-C-203-B snapshot/refcount与lazy materialization。concrete Gauge需待C203-B/C及C204闭合后发布，因此本子任务落在可组合共享核心，不提前登记不完整产品artifact。
- 固定有界环：新增`MemeStockGaugeActivationWheel`，存储严格为32个`ActivationSlot`；generation是绝对`uint64 activationAt`且调度固定为checked `block.timestamp + 30 seconds`。checkpoint与effective view均只遍历索引0～31，不维护逐秒游标，也不随空闲时长、历史generation或用户数量扩张。
- 聚合与冲突：空槽初始化绝对generation，相同generation累加amount/refs；不同绝对generation命中同一模32槽时显式`ActivationSlotCollision`并保持原状态。unschedule按generation、amount及refs同步扣减，只允许amount与refs同时归零清槽，任何缺失、越额或破坏配对的操作fail closed。
- 成熟与扩展边界：`generation <= block.timestamp`包含端点；处理时清槽并把同额从pending总量迁至stored active总量，再把当前Quote/Meme accumulator及refs交给C203-B的内部snapshot hook。hook失败会回滚槽、总量和处理计数；`effectiveTotalActiveStock`仅投影已成熟未checkpoint的bucket而不改存储。
- 验证：共享核心专项Foundry测试14/14通过并含256轮fuzz；覆盖29/30/31秒、同秒256个引用聚合、绝对generation模32冲突、满32槽分段清理、槽复用不覆盖历史snapshot、snapshot hook故障原子回滚、一年空闲固定成本、uint64时间上界、非法bucket/index、unschedule守恒及非变更effective view。产品manifest保持10个模块及hash `0x4599a90f53e40f587a50f4be6b7bac879c3ca444d5248978a2b8a9ba8420bb34`；完整workspace结果以本任务最终门禁为准。

### V2-C-203-B：snapshot/refcount与lazy materialization（2026-09-03）

- 状态：`DONE / PARENT V2-C-203 IN_PROGRESS`；下一子任务为V2-C-203-C pending创建、合并与重置。concrete Gauge与实际双资产reward/remainder数学仍分别等待C203-C及C204，本步只闭合snapshot与用户权重物化生命周期。
- 绝对snapshot：新增`MemeStockGaugeActivationSnapshots`，以绝对generation为mapping key持久化Quote/Meme accumulator、refs和processed；环形槽清理或32秒后复用不会覆盖旧snapshot。重复写入同一已存在generation会使整次checkpoint回滚，accumulator字段写入后不再变更。
- 惰性物化：共享层冻结完整Gauge position/reward存储形状。用户pending对应snapshot已处理时，先把旧active paid index与pending activation snapshot交给C204结算hook，再把pending合并进active、清除pending字段、精确递减refs并仅在最后一个引用物化后删除snapshot；全局active/pending总量不在用户物化时重复移动。
- 失败与规模边界：未来pending返回未物化；已成熟却缺失snapshot、零refs processed snapshot、非法position编码、active加法溢出及settlement hook失败均fail closed且不消耗引用。用户effective active只在snapshot processed后包含pending；物化通过generation直接读取mapping，不扫描其他用户或历史snapshot，遗弃引用可长期保留而不会放大单笔成本。
- 验证：C203-B专项Foundry测试15/15通过并含256轮1～64用户fuzz；覆盖active/pending两段不同index结算、N→1→0引用清理、重复物化、未来/缺失/非法snapshot、结算失败与溢出回滚、槽复用下旧snapshot保留、processed未物化权重及256个遗弃历史snapshot下固定物化成本。共享测试增至147项；产品manifest仍为10个模块及hash `0x4599a90f53e40f587a50f4be6b7bac879c3ca444d5248978a2b8a9ba8420bb34`，完整workspace结果以本任务最终门禁为准。

### V2-C-203-C：pending创建、合并与重置（2026-09-03）

- 状态：`DONE / PARENT V2-C-203 DONE`；32槽激活轮父任务已闭合并解除V2-C-204依赖，下一子任务为V2-C-204-A 24小时整仓锁与Gauge移除边界。concrete产品Gauge仍待C204三项完成后统一发布。
- 唯一pending：新增`MemeStockGaugePendingPositions`。入口首先固定扫描32槽，再验证Manager提供的generation/unlock严格等于checked `now+30s`/`now+24h`；空仓新增仅创建一个用户pending和一个bucket ref，同秒多用户共享bucket但各自贡献一个引用，不存在tranche或用户数组。
- 合并重置：已有未成熟pending时先从旧绝对generation槽同步撤销全部旧amount和一个ref，再checked合并新增量并登记到当前due；即使同秒old/new generation相同也严格执行同一路径。跨秒旧槽归零即清空，目标槽冲突、旧引用缺失、amount溢出或时间溢出会回滚撤销及全部position状态；每次增仓都把整仓unlock重置为当前时间后24小时，旧active数量保持不变。
- 成熟顺序：旧pending恰好到期或已经跨年空闲时，入口先checkpoint建立snapshot并完成全局pending→active移动，再只物化当前用户，随后仅把本次delta创建为新pending。共享snapshot仍被其他未物化用户引用，不重复移动全局总量；settlement hook或任一后续调度失败会连同checkpoint、snapshot、引用和用户仓位整体回滚。
- 验证：C203-C专项Foundry测试15/15通过并含256轮1～20次连续跨秒reset fuzz；覆盖首次/同秒/跨秒调度、同秒多用户、`activationAt-1`与精确到期、processed共享snapshot只物化当前用户、整仓锁重置、一年空闲、非法caller/amount/Manager时间、uint64锁时间上界、旧引用缺失、合并溢出、目标槽冲突及物化故障原子回滚。C203 A/B/C联合测试44/44，共享测试增至162项；产品manifest保持10个模块及hash `0x4599a90f53e40f587a50f4be6b7bac879c3ca444d5248978a2b8a9ba8420bb34`，完整workspace结果以本任务最终门禁为准。

### V2-C-204-A：24小时整仓锁（2026-09-03）

- 状态：`DONE / PARENT V2-C-204 IN_PROGRESS`；下一子任务为V2-C-204-B Quote/Meme双资产accumulator。concrete Gauge仍需B/C的实际奖励会计与完整ABI后统一发布，本步闭合锁定和active移除共享边界。
- 双层锁门禁：新增`MemeStockGaugeLockedPositions`。Gauge remove自身仍以固定32槽checkpoint为第一步，再物化调用用户的成熟pending；拒绝零用户、零额、空仓、非法零锁和任何残留pending，并重复执行`block.timestamp >= unlockAt`，与AllocationManager的caller-bound预检形成纵深防御。Manager既有入口固定使用外层`msg.sender`，因此第三方不存在dust增仓并延长他人锁的ABI。
- 结算后减权：移除前把完整旧active权重及当前Quote/Meme accumulator交给C204结算hook，成功后才同步减少用户active与`storedTotalActiveStock`。超过active、全局总量不足、materialization或removal settlement失败均整笔回滚；不会从未来pending直接扣减，也不会重复移动已processed的全局权重。
- 整仓生命周期：partial decrease和部分迁出保留原`unlockAt`，不因退出重新计时；full close清零active与锁，但保留两资产claimable、paid index及user remainder，随后重新分配会创建全新30秒pending和从新交易起算的24小时锁。普通PAUSED/RETIRED退出与Emergency force release的市场职责仍由Manager/Vault边界控制。
- 验证：C204-A专项Foundry测试14/14通过并含256轮fuzz；覆盖`unlockAt-1`失败与精确端点成功、成熟pending先物化、完整旧权重结算顺序、partial/full退出、关闭后重新分配、共享snapshot仅物化当前用户、未来pending拒绝、无效输入/空仓/越额/零锁、双结算hook故障、全局active下溢、重复close、checkpoint首步及跨年空闲原子性。共享测试增至176项，完整Foundry门禁338/338通过，`npm test`、`npm run build`及格式检查通过；产品manifest保持10模块及hash `0x4599a90f53e40f587a50f4be6b7bac879c3ca444d5248978a2b8a9ba8420bb34`。

### V2-C-204-B：Quote/Meme双资产accumulator（2026-09-03）

- 状态：`DONE / PARENT V2-C-204 IN_PROGRESS`；下一子任务为V2-C-204-C有效权重和历史收益结算。concrete Gauge仍待C204-C组合activation/removal/claim完整生命周期后统一发布，本步不提前实现FeeVault转账、feeId消费或Factory回接。
- 双资产池级会计：新增`MemeStockGaugeAccumulators`，Quote与Meme固定使用两套独立`accFeePerShare/indexRemainder`，指数精度严格为`1e27`。每笔credit以固定32槽checkpoint为第一步，使精确成熟份额参加本笔费用；非零奖励在`S=0`时失败，零奖励为no-op，且只修改被选中的资产状态。
- full-precision与变权重remainder：池级更新严格使用OpenZeppelin `Math.mulDiv`与EVM `mulmod`，不直接构造`R×P`；旧pool remainder即使在S改变后不再小于新分母，也先按新S执行`div/mod`归一化，再与本次fraction合并，持续满足`R×P+oldRemainder=accumulatorDelta×S+newRemainder`且成功更新后`newRemainder<S`。
- 用户原语与职责边界：提供不提前改paid index的单term accrual、结算至current index及claimable消费原语；用户`pendingFee/userRemainder/accumulatorPaid`按资产隔离，remainder严格小于P，claim消费只清整数pending而保留paid与fraction。C204-C负责用这些原语组合旧active与activation snapshot两段收益、实现完整claim/remove/migrate生命周期。
- 验证：C204-B专项Foundry测试18/18通过，含池级与用户级各256轮守恒fuzz；覆盖Quote/Meme隔离、事件字段、零奖励、零active、pending-only、精确activation边界快照、非法资产索引原子回滚、S变化后的旧remainder、最大admitted reward/active、accumulator与pendingFee溢出、用户跨P进位、index回退、非法user remainder、claimable消费及另一资产完全不变。共享测试增至194项，完整Foundry门禁356/356通过，`npm test`、`npm run build`及格式检查通过；产品manifest保持10模块及hash `0x4599a90f53e40f587a50f4be6b7bac879c3ca444d5248978a2b8a9ba8420bb34`。

### V2-C-204-C：有效权重和历史收益结算（2026-09-03）

- 状态：`DONE / PARENT V2-C-204 DONE`；concrete Gauge已经形成，解除`V2-C-105-C`、`V2-T-201`与`V2-T-202`依赖。关键路径下一任务为`V2-C-105-C`，统一回接Factory的Token/Curve/Gauge真实creation code、constructor args、initCodeHash与Registry登记。
- 两段历史结算：新增`MemeStockGaugeSettlements`，每次先checkpoint成熟generation，再分别用旧active的user paid index与新active的不可变activation snapshot结算Quote/Meme，最后才把paid推进到current index。增仓物化、减仓、关闭、迁移与claim均在权重或claimable改变前完成结算；full close只清权重和锁，两个资产的整数claimable与用户fractional remainder持续归原user/market/asset。
- concrete身份与ABI：`MemeStockGauge`现由一个固定不可升级implementation与每市场immutable-args clone组成。clone runtime冻结marketId、Asset UID、Quote config、AllocationManager、ProtocolFeeVault、MarketController及固定Quote/Meme资产，无initializer、任意recipient、资产转移或托管入口；position/reward/activation/Emergency storage按clone隔离。Manager独占仓位变更，FeeVault独占credit/consume，settle仅允许二者调用；add在调度完成后再次读取Controller语义门禁，关闭市场会原子回滚整个schedule。native Quote固定表示为零地址，所有资产索引只接受Quote或Meme。
- Emergency：只有冻结Controller可按前一区块的非零snapshot block/stateHash永久禁用Gauge；禁用后add/remove/checkpoint/settle/credit/consume全部失败，重复禁用及非法快照失败。Gauge只冻结从属奖励源，不接触Vault本金，终态本金释放继续由Vault按Registry权威执行。
- 验证：C204-C concrete Gauge专项Foundry测试19/19通过，覆盖无initializer、native Quote、固定调用者、生命周期回滚、effective view、精确activation边界、active/pending双index双资产结算、单资产claim隔离、partial/full close、重新分配fraction保留、多用户比例、非法资产、共享snapshot ref、锁边界及Emergency永久冻结。完整Foundry门禁29 suites、375/375通过，其中产品173、共享194、fixture 6、scaffold 2；`npm test`、`npm run build`及格式检查通过。产品manifest增至11模块，hash为`0x4b77104676c01c9b9cfc7fa5fef0376eb191d3d3f22ad6d24bfdd161ee220346`，canonical mutation/event exact diff通过。

### V2-C-105-C：组件部署、初始化与Registry登记原子化（2026-09-03）

- 状态：`DONE / PARENT V2-C-105 DONE`；Factory关键路径已闭合并解除`V2-C-106`依赖，下一子任务为`V2-C-106-A`普通创建边界与native原子launch-and-buy。目标链部署地址、真实Hook/FeeVault/Controller/Graduation组合及production manifest仍属于后续deployment gates，不能由本地产品测试替代。
- 可部署CREATE2架构：Factory保留Token/Curve两个独立、无状态、codehash硬固定的typed部署实现器，并对其执行固定`delegatecall`，因此CREATE2 deployer仍是Factory。Gauge部署器已收敛为固定`MemeStockGauge` implementation与OpenZeppelin deterministic immutable-args clone；LaunchTemplate的`gaugeImplementation/gaugeCodeHash`绑定共享implementation而不是某个市场clone，Factory预测、部署和回读使用同一八字段参数编码。
- 构造与原子顺序：Factory从四Registry解析ACTIVE snapshot并校验caller提交的exact economics，计算marketId、Token/Curve/Gauge及GraduationExecutor提供的Locker预测。随后按Token→构造期临时Curve snapshot→Curve→清除snapshot→Gauge部署，逐地址核对CREATE2结果；再按`MarketRegistry.registerMarket`→`CreatorRevenueRegistry.initializeCreatorRevenueEpoch`→固定`0.0005 native`平台创建费转账→`MarketCreated`提交。Curve snapshot只允许exact constructing Curve读取，失败由EVM回滚，不存在公开可写initializer或跨交易窗口。
- 身份与失败边界：直接创建固定creator为`msg.sender`，`createMarketFor`只接受immutable LaunchRouter并保留显式creator的marketId/salt namespace；同Asset UID允许多个不同market，重复完整identity失败。Quote可为native零地址或冻结ERC-20；未毕业Gauge虽已部署但Controller语义门禁仍阻止分配。任一快照、模板实现、CREATE2、Registry、creator epoch或最晚创建费收款失败都会同时撤销组件代码、market/token mapping、epoch、预约和事件，同一identity可安全重试。
- 验证：Factory专项Foundry测试15/15通过，覆盖构造依赖、真实预测/部署一致、完整MarketConfig/runtime与creator epoch、逐字段`MarketCreated`、Token全量直接进入Curve、三组件无initializer、同Stock多market、exact fee、Router only身份、错误economics、inactive Registry、template实现漂移、最晚阶段故障全回滚与重试、构造期snapshot不可复用、未毕业Gauge门禁、native/ERC-20 Quote及canonical selectors。完整Foundry门禁30 suites、390/390通过，其中产品188、共享194、fixture 6、scaffold 2；`npm test`、`npm run build`及格式检查通过。产品manifest增至12模块，hash为`0xbee41ab775496058a856d20cc1499011b224110c95be69cf53accef810547869`，Factory canonical mutation/event exact diff通过。

### V2-C-106-A：普通创建与native原子launch-and-buy（2026-09-03）

- 状态：`DONE / PARENT V2-C-106 IN_PROGRESS`；下一子任务为V2-C-106-B ERC-20 launch-and-buy。最终`LaunchAndBuyRouter`产品合约需同时包含native/ERC-20与C106-C身份安全，因此本步只发布可复用native共享层，不把半成品登记为产品模块。
- 原子付款与身份：新增`LaunchAndBuyRouterNative`，具体入口必须把外层`msg.sender`作为creator传入内部路径；先核对Factory runtime及其immutable ApprovedQuoteRegistry绑定，再要求Quote配置ACTIVE且为native。付款严格为`msg.value = launchFee + firstBuyAmount`，Router只把launch fee交给Factory并调用`createMarketFor`，随后把完整首买金额交给新Curve；beneficiary及Meme recipient不替换creator/salt namespace。
- 首买与退款：首买直接调用新Curve的canonical `buy(firstBuyAmount,minTokensOut,recipient)`，不设置1%或其它人为上限。Meme只发送给显式recipient；Curve尾单未使用的native先退给认证Router，再由Router按`firstBuyAmount - quoteSpent`精确退回creator。receive只接受当前Curve的同步退款，交易前强制注入的native余额严格保留，交易后Router不得增加dust。
- 失败边界：零首买、零/Router recipient、非native Quote、错误组合付款在创建前失败；Factory创建、Curve首买、滑点、尾单fee sweep/markSwept/毕业交接或creator拒收退款任一步失败，组件代码、Registry、creator epoch、平台创建费、Router余额和identity reservation全部回滚，同一参数可重试。`ReentrancyGuard`由最终外部入口继承使用；Router不声明或复制Factory/Curve事件。
- 验证：本步完成时Factory真实集成专项23/23，覆盖普通native创建首买、外层creator与任意Meme recipient、100 ether无人工上限尾单partial fill、精确退款与Swept交接、组合付款上下界、无效输入、首买滑点失败后同identity重试、creator拒收退款全回滚及3 ether强制历史余额保留；当时用于证明native helper拒绝ERC-20的过渡测试，已在C106-B组合分派后由完整ERC-20正负向矩阵替代。该阶段完整Foundry门禁398/398通过；当前累计结果见C106-B。产品manifest保持12模块及hash`0xbee41ab775496058a856d20cc1499011b224110c95be69cf53accef810547869`。

### V2-C-106-B：ERC-20原子launch-and-buy（2026-09-03）

- 状态：`DONE / PARENT V2-C-106 IN_PROGRESS`；下一子任务为V2-C-106-C creator/beneficiary/recipient/salt身份安全，并在A/B共享层之上发布唯一concrete `LaunchAndBuyRouter`。机器ABI没有permit参数或selector，因此本步不新增非canonical permit入口；计划中的permit/approve失败按外部标准approve/allowance及Router→Curve授权失败闭合。
- 精确到账与授权：新增`LaunchAndBuyRouterERC20`并复用Factory/Quote Registry、输入和重入门禁。ERC-20路径只接受`msg.value == launchFee`，在市场创建前从外层creator拉取完整`firstBuyAmount`并要求Router余额逐单位精确增加；创建后只对返回的新Curve设置exact allowance，要求授权前为0、授权后等于首买额、Curve返回后重新归零，不保留跨交易授权。
- 首买、退款与余额：Router以完整首买额调用Curve，最大成交继续仅由sellable floor、partial fill和`minTokensOut`决定，不设置人为比例上限。Curve先消耗完整allowance并把unused Quote退给Router；Router核对`quoteSpent + refund == firstBuyAmount`对应余额，再把refund以同一ERC-20精确退回creator。显式Meme recipient只接收Meme；Router结束时本次ERC-20和native余额均为零增量，预先强制存在的Quote余额不被混入或扫走。
- 恶意资产与原子性：transferFrom/approve/transfer必须成功并只接受32-byte canonical true；少到账、fee-on-transfer、false/no-data/malformed返回、余额或allowance漂移、Token回调、显式重入、Curve首买/滑点及creator退款失败均回滚creator余额和原有allowance、三组件代码、MarketRegistry、creator epoch、平台创建费及Router状态。同identity在首买失败后可直接重试。
- 验证：Factory真实集成专项增至34/34，其中C106-B加入12项并替代A阶段的过渡分派测试；覆盖正常ERC-20首买与任意Meme recipient、100单位尾单partial fill和token refund、只附exact launch fee、缺少外部allowance、Router→Curve approve失败、1% fee-on-transfer、三类异常返回、Token callback与canonical mutation重入、退款transfer失败、滑点失败全回滚后重试，以及777 raw-unit历史Router余额保留。完整Foundry门禁30 suites、409/409通过，其中产品207、共享194、fixture 6、scaffold 2；`npm test`、`npm run build`、格式、fixture及product artifact检查全部通过。产品manifest仍为12模块，hash保持`0xbee41ab775496058a856d20cc1499011b224110c95be69cf53accef810547869`。

### V2-C-106-C：组合身份安全与concrete Router（2026-09-03）

- 状态：`DONE / PARENT V2-C-106 DONE`；native与ERC-20付款共享层已组合为唯一产品入口，`V2-T-101`依赖全部解除，下一任务为`V2-T-101-A` Token/Factory负向与多市场组合测试。目标链部署地址、live Fork和production manifest仍属于后续deployment gates。
- concrete Router：新增`LaunchAndBuyRouter`产品模块，构造时冻结predicted Factory与ApprovedQuoteRegistry；为解除Factory↔Router构造循环，允许先以非零预测Factory部署Router，但任何调用前必须确认Factory已有代码且其immutable Registry与Router完全一致。外部mutation仅保留canonical payable `launchAndBuy(CreateMarketParams,uint256,uint256,address)`，按Quote配置分派native/ERC-20路径，不增加permit、代调用、批处理、initializer、任意target或自有事件。
- 身份口径：creator始终是Router的直接外层`msg.sender`，合约调用者测试证明不读取`tx.origin`。beneficiary不能替换creator，但按`V2_TYPED_IDENTIFIERS.md`的canonical typed schema参与marketId，因此改变beneficiary会改变marketId及组件namespace；显式Meme recipient只接收首买Meme且不参与marketId。salt改变marketId以及Token、Curve、Gauge、Locker全部CREATE2 namespace。此前子任务表中“beneficiary不改变marketId”的文字与冻结schema冲突，本次以机器schema和共用`V2Identifiers`实现为权威完成纠正。
- 反狙击与失败边界：creator和creation-time beneficiary继续是冻结豁免身份；任意首买recipient仅在caller为immutable Launch Router且Curve尚未执行过交易时享受一次豁免。同一Router与recipient的后续买入按普通anti-snipe税率执行。Factory/Registry绑定漂移、非法构造依赖、身份覆盖尝试和所有非canonical selector均失败。
- 验证：Factory/Router真实集成专项42/42通过，C106-C新增8项覆盖合约调用者与`tx.origin`分离、beneficiary/recipient/salt四类身份、四组件namespace、一次性首买豁免、零Router事件、禁止身份覆盖/任意执行以及构造和运行时绑定漂移。完整Foundry门禁30 suites、417/417通过，其中产品215、共享194、fixture 6、scaffold 2；`npm test`、`npm run build`、格式、fixture及product artifact检查全部通过。产品manifest增至13模块，hash为`0x82d08dbf35607d77134600dc15bba7eaafb9515a9c8a2a4230d694ae134a6d54`；Router creation/runtime分别为6344/5898 bytes，creation hash为`0x20a19d2bb9b603b749450fa4f668be78182b37ffcd71271cee43186f806089c6`，runtime template hash为`0x36e54c94d972d61c10bbc19fa9f243397e1e3312ef8c3c6d5527fd1744d91a51`，最终部署codehash仍待真实immutable地址和production manifest冻结。

### V2-T-101-A：Token/Factory负向与多市场组合测试（2026-09-03）

- 状态：`DONE / PARENT V2-T-101 IN_PROGRESS`；T101的产品负向基线已闭合，下一子任务为`V2-T-101-B` Pons交易差分。T101-C的最终artifact/CREATE2对应和T101-D的全步骤故障注入仍是独立验收，不能由本步结果替代。
- 非Factory与固定供应：新增off-path Token部署测试，以非Factory namespace、错误Curve和`SUPPLY-1`创建伪Token，证明其不能占用Factory预测Token地址、不能进入MarketRegistry；随后同一canonical market identity仍由Factory成功创建，Token固定`factory`、完整baseline supply及全部余额直接进入预测Curve。新增旧V1式`mint(address,uint256)`调用测试，任意legacy caller不能改变供应或获得余额。
- typed多市场：同一creator、同一ACTIVE Stock、同一salt但不同name/symbol/metadata可按完整typed identity创建两个不同marketId和Token，分别建立唯一反向索引；仅完全相同的identity重复创建触发`MarketIdentityAlreadyReserved`。这明确了salt是marketId输入而不是Asset级或salt-only全局锁。
- 非法配置矩阵：在真实Factory create路径覆盖Asset、Quote、Pons Baseline、Launch Template四类未知ID与inactive状态，Quote economics hash/跨Baseline漂移，Template fee policy/execution spec/content hash漂移及零beneficiary。每项均在组件部署前fail closed；恢复合法配置后原identity成功创建，证明失败不残留reservation或半市场。
- 验证：Factory专项46/46及Token专项7/7通过。完整Foundry门禁30 suites、421/421通过，其中产品219、共享194、fixture 6、scaffold 2；本任务不改生产源码或ABI，因此13模块product manifest hash保持`0x82d08dbf35607d77134600dc15bba7eaafb9515a9c8a2a4230d694ae134a6d54`。`npm test`、`npm run build`、格式、fixture与artifact一致性检查均通过。

### V2-T-101-B：Pons交易三方差分（2026-09-03）

- 状态：`DONE / PARENT V2-T-101 IN_PROGRESS`；下一子任务为`V2-T-101-C`真实CREATE2 artifact/address核对。公共RPC不能提供旧状态`eth_call`，但固定receipt/log与当时可执行的固定块call结果均已本地固化，T101-B的本地门禁不再依赖网络或archive状态。
- Runtime向量：`spec/v2_pons_runtime_evidence.json`新增14条唯一差分向量，覆盖native/USDG Factory供应配置、真实launch buy及amountOut、100/200 bps双Quote fee leg、真实sell、ERC-20尾单partial fill/refund、同固定块边界成功与`SlippageExceeded`回滚、elapsed 0/1/2/3及creator豁免的runtime anti-snipe表，以及native毕业分区。每条runtime观测均绑定合约、block/hash、transaction/hash或call calldata/return/revert data；三条Curve runtime template分别固定codehash。
- Reference与Solidity：Python独立整数模型逐字段重算原14条规范向量及新增14条runtime差分向量；`V2PonsDifferentialTest`通过只读Foundry文件权限直接消费权威JSON，并用生产`PonsSupplyMath`、`PonsCurveMath`、`PonsAntiSnipe`逐单位重放。所有输出一致，显式difference ID登记表为空；没有把不同输入的receipt冒充同一向量。
- 派生物与验证：fixture已重生并通过一致性检查，manifest hash为`0xc187bf0dc0b4a484ba415b86b5e20e3f43d0f18100f32ceda20afc3ba90747b3`。完整Foundry门禁31 suites、428/428通过，其中产品219、共享201、fixture 6、scaffold 2；Python规格57/57通过。`npm test`、`npm run build`、格式、fixture与product artifact检查均通过；未改生产源码或ABI，13模块product manifest hash保持`0x82d08dbf35607d77134600dc15bba7eaafb9515a9c8a2a4230d694ae134a6d54`。

### V2-T-101-C：真实artifact-backed CREATE2部署核对（2026-09-03）

- 状态：`DONE / PARENT V2-T-101 DONE`。没有把`FactoryGraduationExecutorMock.predictLaunchLocker`返回的空地址或历史`0x11/0xbb...`数学向量当作真实部署证据；在V2-C-303/C-304产品模块完成后，第四组件已通过真实GraduationExecutor毕业调用以CREATE2实际部署并纳入同级验收。
- 三组件真实证据：Factory产品集成`test_realArtifactInitCodeSaltPredictionAndActualAddressMatchManifest`直接读取`spec/v2_product_artifact_manifest.json`；Token/Curve确认真实编译creation-code hash，Gauge确认共享implementation runtime hash，并以本次marketId及八字段identity重算clone init-code地址。三者均以`chainId + Factory + marketId + component kind`重算salt并逐项等于Factory返回与实际部署地址，三个actual地址均已有runtime code。
- Locker真实证据：产品集成测试直接拼接`LaunchLocker.creationCode + marketId/registry/positionManager`完整构造参数，以`chainId + registry.factory + marketId + LOCKER`推导component salt，并从GraduationExecutor部署者地址独立预测；预测值与`predictLaunchLocker`及毕业交易actual地址相同，actual地址存在runtime code，且marketId、canonical poolId、锁定tokenId、NFT owner和Registry `PoolCreated`状态全部一致。测试同时读取16模块manifest并核对LaunchLocker真实creation-code hash。
- 边界与后续：产品artifact manifest仍明确标为编译产物而非production deployment evidence；本地四组件CREATE2核对不替代目标链manifest与最终immutable runtime codehash，后者继续由V2-E-105/deployment gates闭合。
- 验证：LaunchLocker CREATE2毕业集成专项1/1通过；完整Foundry门禁51 suites、606/606通过，其中状态化Invariant执行128,000 calls且零revert；Python规格57/57、fixture、V2边界及product artifact exact检查全部通过，16模块product manifest hash为`0x9f2cdf177092104c49815525c042475dc652f05226f61f3e707063933cb04de2`。

### V2-C-301-A：MarketFeeAccounting纯会计库（2026-09-03）

- 状态：`DONE / PARENT V2-C-301 IN_PROGRESS`；C301的前置依赖V2-C-104、V2-C-204与V2-P-004均已完成，因此父任务从过期的`BLOCKED`进入实施。下一子任务为V2-C-301-B v4 begin/finalize exact-arrival credit；本步不提前声称资金到账、liability、claim或recovery已实现。
- 会计边界：新增内部纯库`MarketFeeAccounting`，不持有资产、状态或外部调用权限。`splitV4`要求调用者提供的`L`精确等于`floor(T*2000/10000)`且`D=T-L`，再按`E=min(S,B)`计算`staker=floor(D*E/(2B))`、`creator=floor((D-staker)/2)`，所有non-LP整数余数确定性归platform；零或会使`2B`溢出的饱和值fail closed。`splitCurve`固定Creator向下取半、余数归Platform。
- 边界验证：专项9/9通过，覆盖`S=0`的40/0/40/20、`S=B/2`的30/20/30/20、`S>=B`的20/40/20/20、奇数余数、错误T/L/D、非法B及`uint256.max`总费；两组256轮fuzz分别证明v4三桶逐单位守恒和Curve 50/50余数规则。完整Foundry门禁32 suites、438/438通过，其中产品220、共享210、fixture 6、scaffold 2；Python规格57/57通过。`npm test`、`npm run build`、格式、fixture与product artifact检查全部通过；纯库不改变产品ABI，13模块manifest hash保持`0x82d08dbf35607d77134600dc15bba7eaafb9515a9c8a2a4230d694ae134a6d54`。

### V2-C-301-B：v4 begin/finalize exact-arrival credit（2026-09-03）

- 状态：`DONE / PARENT V2-C-301 IN_PROGRESS`；下一子任务为V2-C-301-C Curve sweep与Creator epoch credit。本步提供最终ProtocolFeeVault可继承的共享信用状态机，不提前发布缺少canonical claim/recovery入口的半成品产品模块。
- 原子信用锁：新增`ProtocolFeeVaultV4Credit`，以`IDLE -> PENDING -> FINALIZING -> IDLE`锁定一笔Hook调用帧。begin要求PoolCreated+ACTIVE市场、非零poolId、exact registered Hook、exact sourceVersion、canonical Quote/Meme asset、非零且不超过int128正域的D及未消费feeId，并冻结实际余额。finalize只接受同一source及完全相同的market/asset/D/feeId，重新验证Registry生命周期与sourceVersion，实际余额增量必须逐单位等于D后才进入下游会计；下游失败会连同转账、pending状态和feeId消费一起回滚。
- Native/ERC-20边界：native `receive`只在PENDING窗口接受immutable PoolManager发送且数额等于D的一次付款；其它直接转账失败。ERC-20通过静态`balanceOf`差值验证，异常返回fail closed；预存余额不参与本次delta。统一`_consumedFeeIds`映射预留给后续Curve与v4共同防重，不使用两套可重放命名空间。
- 验证：专项13/13通过，覆盖native/ERC-20精确到账、预存余额、少付/多付、fee-on-transfer、异常余额返回、重复begin/feeId、非canonical资产、错误caller、phase/status/poolId/sourceVersion漂移、finalize的market/asset/D/feeId/source五项绑定、下游失败和FINALIZING重入。完整Foundry门禁33 suites、451/451通过，其中产品220、共享223、fixture 6、scaffold 2；Python规格57/57通过。`npm test`、`npm run build`、格式、fixture与product artifact检查全部通过；共享层不改变产品ABI，13模块manifest hash保持`0x82d08dbf35607d77134600dc15bba7eaafb9515a9c8a2a4230d694ae134a6d54`。

### V2-C-301-C：Curve sweep与Creator epoch credit（2026-09-03）

- 状态：`DONE / PARENT V2-C-301 IN_PROGRESS`；下一子任务为V2-C-301-D Creator/Staker/Platform双资产liability与claim。本步继续提供最终ProtocolFeeVault可继承的共享层，不提前声称liability、claim或10 STOCK active-weight分配已经完成。
- Curve信用边界：新增`ProtocolFeeVaultCurveCredit`并复用统一credit锁与`_consumedFeeIds`。只有Registry中NotGraduated+ACTIVE市场登记的exact Curve能提交，quote asset与sourceVersion必须匹配；feeId逐字段绑定domain/schema、chain、Vault、Curve、market、sourceVersion、nonce、asset与amount，nonce必须从1严格连续递增。Native要求`msg.value == amount`；ERC-20到账由已登记Curve在同一调用帧执行的发送方/接收方双余额精确差值证明，Vault再要求当前余额覆盖本次金额，不虚构Curve transfer前的Vault快照。
- Epoch与原子性：每次credit读取并验证当时非零creator epoch及其非零beneficiary，Curve阶段不创建LP或Staker桶，金额按Creator向下取半、全部整数余数归Platform。下游记录成功后才消费feeId并退出锁；任何Registry、余额、epoch、nonce或记录失败都会连同Curve转账、nonce和桶更新一起回滚。记录参数收拢为`CurveCreditRecord`，避免编译器栈溢出并为下一步liability实现保留完整审计上下文。
- 验证：专项10/10通过，覆盖ERC-20/native、预存余额、奇数余数、跨两次sweep的epoch绑定、epoch零/beneficiary零、canonical feeId、跳号/重复nonce、已消费feeId重放、caller/phase/status/sourceVersion/asset门禁、缺失到账、错误value及下游失败原子回滚。完整Foundry门禁34 suites、461/461通过，其中产品220、共享233、fixture 6、scaffold 2；Python规格57/57通过。`npm test`、`npm run build`、格式、fixture与product artifact检查全部通过；共享层不改变产品ABI，13模块manifest hash保持`0x82d08dbf35607d77134600dc15bba7eaafb9515a9c8a2a4230d694ae134a6d54`。

### V2-C-301-D：双资产liability与固定收款claim（2026-09-03）

- 状态：`DONE / PARENT V2-C-301 IN_PROGRESS`；下一子任务为V2-C-301-E 10 STOCK饱和的线性质押分成及最终ProtocolFeeVault组合。本步只消费已确定的三桶金额，不提前实现或声称active STOCK快照与capped-linear分桶已经接入v4 finalize。
- 账本与偿付能力：新增`ProtocolFeeVaultLiabilities`，Creator按`marketId + creatorEpoch + feeAsset`独立保存并同步维护market级Creator汇总，Staker/Platform按`marketId + feeAsset`保存，每种实际资产单独维护`totalLiability`。内部credit要求Creator+Staker+Platform逐单位等于实际non-LP金额，增加负债后立即验证Vault实际余额覆盖该资产全部负债；Curve credit现已真实写入epoch级Creator与Platform账本并发出canonical `CurveFeesSwept`。
- 固定收款claim：四个canonical selector均已实现。Creator只能支付CreatorRevenueRegistry中该历史epoch的beneficiary，Platform只能支付构造时冻结的treasury，`claimStaker`只能支付调用者，permissionless `claimStakerFor`也只能支付其固定user；没有recipient overload、批量提款或管理员override。Staker先由该市场固定Gauge结算并消费指定资产，若返回值超过对应Staker liability则整笔回滚；零余额直接返回且不触碰另一资产。
- 隔离与失败语义：所有claim复用统一`IDLE/PENDING/FINALIZING`锁，pending v4 credit期间不能交错领取，ERC-20回调也不能重入另一bucket。每次claim在外部调用前后验证本资产偿付能力，并采用effects-before-interactions；SafeERC20失败、native拒收、Gauge失败或恶意超额消费都会恢复Gauge、epoch/bucket与total liability。Quote领取失败不会阻塞同一epoch的Meme领取；Creator/Platform历史领取不依赖Gauge可操作状态。
- 验证：专项16/16通过，覆盖canonical selectors/events、Curve到liability真实组合、Quote/Meme隔离、历史epoch、固定treasury、caller/fixed-user Staker领取、零领取、非法market/asset/bucket/epoch/user、分桶不守恒、credit与claim前偿付不足、Gauge失败/超额、ERC-20失败、native拒收后的另一资产成功、pending-credit互斥及transfer callback重入。旧Curve/V4 credit专项23/23回归通过。完整Foundry门禁35 suites、477/477通过，其中产品220、共享249、fixture 6、scaffold 2；Python规格57/57通过。`npm test`、`npm run build`、格式、fixture与product artifact检查全部通过；共享层不改变产品ABI，13模块manifest hash保持`0x82d08dbf35607d77134600dc15bba7eaafb9515a9c8a2a4230d694ae134a6d54`。

### V2-C-301-E：10 STOCK饱和线性分成与Gauge落账（2026-09-03）

- 状态：`DONE / PARENT V2-C-301 CORE DONE`；FeeVault费用核心已闭合并解除`V2-C-302`依赖，下一子任务为`V2-C-302-A` Hook CREATE2地址、permission bits与PoolManager绑定。IProtocolFeeVault中的Emergency Recovery状态与入口仍由`V2-C-402`组合进同一最终产品合约，因此本步继续不发布缺少Recovery ABI的半成品product artifact。
- v4身份与顺序：新增`ProtocolFeeVaultV4Accounting`，冻结`V2-EXEC-3`与固定FeePolicy hash，逐笔重新验证market policy、`T=floor(base×10000/1e6)`、`L=floor(T×2000/10000)`、`D=T-L`、完整canonical `feeId`及pool级严格连续nonce。exact arrival之后严格执行Gauge checkpoint、读取`storedTotalActiveStock`快照、capped-linear分桶、绑定current creator epoch、非零Staker桶写入Gauge、三桶liability落账，最后才提交nonce并由外层消费feeId/清除credit锁；任一步失败整笔回滚。
- 饱和与真实分配：每市场使用Factory/Registry冻结的`stakeSaturationAmount = 10×10^stockDecimals`作为`B`，按credit时`S`计算`E=min(S,B)`；`S=0`、`S=B/2`、`S=B`及`S>B`分别验证40/0/40/20、30/20/30/20和20/40/20/20边界，所有整数余数继续确定性归Platform。新增真实`MemeStockGauge`集成，两名各5 raw STOCK用户在精确激活边界共同分得40单位Staker桶并经Vault各领取20，证明pool accumulator、用户raw-unit比例、Vault liability与固定收款claim端到端守恒。
- 编译边界与验证：v4下游记录参数收拢为`V4CreditRecord`，避免Solidity栈深并保持原子上下文。C301-E专项12/12、既有V4 credit 13/13、Curve credit 10/10、liability 16/16全部通过；完整Foundry门禁36 suites、489/489通过，其中产品220、共享261、fixture 6、scaffold 2；Python规格57/57通过。`npm test`、`npm run build`、格式、fixture、interface及product artifact检查全部通过；共享核心不改变当前产品artifact，13模块manifest hash保持`0x82d08dbf35607d77134600dc15bba7eaafb9515a9c8a2a4230d694ae134a6d54`。

### V2-C-302-A：Hook CREATE2权限地址与canonical binding（2026-09-03）

- 状态：`DONE / PARENT V2-C-302 IN_PROGRESS`；下一子任务为`V2-C-302-B` beforeInitialize握手、EXPECTED→INITIALIZE_SEEN→ACTIVE→DISABLED生命周期及旧source永久失效。本步建立最终Hook可继承的身份与绑定层，不提前实现四象限delta、1%收费、donate/take或发布缺少B～E逻辑的半成品产品模块。
- 地址与依赖：新增`TickerGardenMemeHookBinding`，构造时要求实际CREATE2部署地址低14位精确等于`0x2044 = BEFORE_INITIALIZE | AFTER_SWAP | AFTER_SWAP_RETURNS_DELTA`，并冻结有runtime code且互不别名的MarketRegistry、PoolManager、ProtocolFeeVault、GraduationExecutor和MarketController；未启用的initialize后、beforeSwap、liquidity及donate callback selector不存在可调用旁路。测试通过真实CREATE2 salt mining部署而非伪造地址，错误地址位、无代码依赖与别名均在构造期失败。
- expected binding：仅immutable GraduationExecutor可为`Swept + ACTIVE + poolId=0`市场登记expected pool；完整五字段PoolKey必须与Registry canonical key逐字节一致，currency严格排序、fee为0、tickSpacing在冻结范围内且hooks为本合约。登记的poolId/keyHash统一为`keccak256(abi.encode(key))`，sourceVersion固定为Registry当前checked next版本，uint32溢出、错误版本、重复登记或生命周期漂移均失败；成功写入`NONE→EXPECTED`且feeNonce从0开始。
- active guard：共享校验原语只接受immutable PoolManager，从实际完整PoolKey重算poolId，要求binding为ACTIVE，并重新核对Registry的`PoolCreated + ACTIVE`、poolId、sourceVersion、Hook及canonical keyHash；任意字段或Registry版本漂移失败。hookData完全不参与market、pool或source识别，伪造内容不能改变绑定。C302-A专项13/13通过；完整Foundry门禁37 suites、502/502通过，其中产品220、共享274、fixture 6、scaffold 2；Python规格57/57通过。`npm test`、`npm run build`、格式、fixture、interface及product artifact检查全部通过，共享层不改变当前13模块product artifact，manifest hash保持`0x82d08dbf35607d77134600dc15bba7eaafb9515a9c8a2a4230d694ae134a6d54`。

### V2-C-302-B：beforeInitialize握手与pool source生命周期（2026-09-03）

- 状态：`DONE / PARENT V2-C-302 IN_PROGRESS`；下一子任务为`V2-C-302-C`四象限afterSwap feeAsset与int边界。本步实现最终Hook可继承的单向生命周期层，不提前实现1%收费、LP donate、non-LP take或发布缺少C～E逻辑的半成品product artifact。
- 初始化与激活：新增`TickerGardenMemeHookLifecycle`。只有immutable PoolManager可用完整PoolKey命中唯一EXPECTED binding；握手逐字段重核Registry canonical key、`Swept + ACTIVE + poolId=0`与checked next sourceVersion，并只允许`EXPECTED→INITIALIZE_SEEN`一次。只有immutable GraduationExecutor可从INITIALIZE_SEEN激活，且激活前仍要求Registry处于同一未提交source；ACTIVE在Registry原子提交`PoolCreated`前不能通过active callback guard，因此中间态不能产生费用。
- 原子与终态：注册、initialize、activate任一后续步骤失败会由同一毕业交易整体回滚，专项覆盖PoolManager.initialize自身失败和激活后毕业末尾失败。只有immutable MarketController可在Registry仍为同pool/source的`PoolCreated + PAUSED/RETIRED`状态将ACTIVE变为DISABLED；ACTIVE市场、Emergency已提交状态、canonical key/hook或source漂移均失败。DISABLED没有任何返回边，不能再次initialize/activate/callback；Registry随后递增sourceVersion后旧source仍永久不可用。
- 验证：C302-B专项10/10、A/B联合22/22通过；完整Foundry门禁38 suites、512/512通过，其中产品220、共享284、fixture 6、scaffold 2；Python规格57/57通过。`npm test`、`npm run build`、格式、fixture、interface、offchain、Web及product artifact检查全部通过；共享生命周期层不改变当前13模块product artifact，manifest hash保持`0x82d08dbf35607d77134600dc15bba7eaafb9515a9c8a2a4230d694ae134a6d54`。

### V2-C-302-C：四象限afterSwap feeAsset、整数边界与feeId（2026-09-03）

- 状态：`DONE / PARENT V2-C-302 IN_PROGRESS`；下一子任务为`V2-C-302-D`真实LP donate、non-LP take、FeeVault exact-arrival与Hook瞬时delta归零。本步只建立最终afterSwap复用的计算/身份层，不把尚未发生实际PoolManager资金动作的共享层登记为产品模块。
- 四象限与整数域：新增`TickerGardenMemeHookFeeCalculation`，从锁定v4-core的packed `BalanceDelta`按`zeroForOne × amountSpecified`唯一选择unspecified currency：exact-input固定为output、exact-output固定为input。base只取核心实际delta，先扩展到int256再取绝对值，因此`int128.min`得到精确`2^127`且不会负值溢出；未选中的另一资产极值不影响收费。零amountSpecified失败，`T=floor(base×10000/1e6)`为0时不推进nonce或创建feeId，T超正int128域则fail closed。
- 分割与身份：同一准备步骤确定`L=floor(T×2000/10000)`及`D=T-L`，用checked pool级uint64 nonce构造schema-v1 canonical feeId，字段逐一绑定chain、FeeVault、PoolManager、pool、market、source、nonce、实际feeAsset、base、T和冻结的V2-EXEC-3 feePolicyHash。feeAsset必须是Registry市场不可变Quote或Meme；第三种资产、非PoolManager、非ACTIVE binding或Registry source漂移都不能推进nonce。真实donate/take/credit失败后的整体回滚仍由C302-D/E在实际afterSwap中闭合。
- 验证：C302-C专项12/12（含256-run fuzz）、A/B/C联合35/35通过；完整Foundry门禁39 suites、524/524通过，其中产品220、共享296、fixture 6、scaffold 2。测试直接使用锁定的Uniswap v4 `toBalanceDelta`编码，覆盖四象限、正负delta、`int128.min/max`、零与99/100最小收费边界、未选资产极值、canonical policy/feeId、nonce连续性/溢出和错误资产。`npm test`、`npm run build`、格式、fixture、interface、offchain、Web及product artifact检查全部通过；共享层不改变当前13模块product artifact，manifest hash保持`0x82d08dbf35607d77134600dc15bba7eaafb9515a9c8a2a4230d694ae134a6d54`。

### V2-C-302-D：LP donate、non-LP take与FeeVault原子执行（2026-09-03）

- 状态：`DONE / PARENT V2-C-302 IN_PROGRESS`；下一子任务为`V2-C-302-E` canonical core fee fail-closed与剩余故障回滚。本步落地最终Hook可继承的收费执行层，但在E完成前不登记为产品模块，也不把严格PoolManager模型测试冒充真实v4 Fork证据。
- 执行与资产槽：新增`TickerGardenMemeHookFeeExecution`，在`afterSwap`内复用canonical准备结果，按`beginV4Credit -> donate(L) -> take(D, FeeVault) -> finalizeV4Credit -> V4FeeAccrued`固定顺序原子执行。L只进入实际feeAsset对应的currency0或currency1槽，D由PoolManager直接发送FeeVault，Hook不接收或暂存资产；最终返回正`T`，与PoolManager动作满足`+T-L-D=0`。T为0时不调用任何外部动作、不推进nonce；L为0时跳过donate但仍精确take/credit D。
- 到账与回滚：专项直接组合真实`ProtocolFeeVaultV4Credit` exact-arrival状态机与严格PoolManager双币种delta模型，分别覆盖ERC-20和native精确到账。donate、take、ERC-20少付、FeeVault下游记录失败均回滚先前donate、转账、pending credit、fee nonce和事件；连续成功Swap使用严格递增nonce及不同canonical feeId，非PoolManager调用失败。测试要求currency0和currency1的瞬时delta均为零，从而不会遗漏非收费侧残留。
- 验证：C302-D专项10/10、A/B/C/D联合45/45通过；完整Foundry门禁40 suites、534/534通过，其中产品220、共享306、fixture 6、scaffold 2；Python规格57/57通过。`npm test`、`npm run build`、格式、fixture、interface、offchain、Web及product artifact检查全部通过；共享执行层不改变当前13模块product artifact，manifest hash保持`0x82d08dbf35607d77134600dc15bba7eaafb9515a9c8a2a4230d694ae134a6d54`。真实PoolManager锁内delta与无in-range liquidity行为仍由C302-E及T301 Fork闭合。

### V2-C-302-E：core fee fail-closed与concrete Hook（2026-09-03）

- 状态：`DONE / PARENT V2-C-302 DONE`；`V2-C-303`前置依赖已解除，下一子任务为`V2-C-303-A` Curve sweep、Swept与自动毕业入口。真实v4 PoolManager、Router/Quoter、in-range feeGrowth及用户收付证据仍归`V2-T-301`固定Fork，不由本地严格模型替代。
- core fee门禁：`TickerGardenMemeHookFeeExecution`改为直接使用锁定v4-core的`IPoolManager`、`StateLibrary`、`PoolId`、`PoolKey`、`Currency`及`IHooks`类型。每次通过active binding后均从真实PoolManager storage读取当前Slot0；PoolKey fee、24-bit lpFee或packed protocolFee任一非零都在任何donate/take/credit前revert。protocolFee的zeroForOne与oneForZero两个12-bit方向均有独立向量，且即使`T=0`也不能绕过门禁。
- 原子与产品组合：严格PoolManager模型按v4 `POOLS_SLOT=6`布局提供`extsload`，在Hook返回前记录core Swap，并要求currency0/currency1最终delta同时为零。无in-range liquidity、donate、take、ERC-20少付或FeeVault finalize失败均回滚core Swap计数、feeGrowth模型动作、take转账、pending credit、feeNonce、feeId记录及事件；清除动态core fee后同一Swap可安全重试。新增concrete `TickerGardenMemeHook`产品模块，只有CREATE2地址低14位精确`0x2044`且五个immutable依赖有效、互不别名时可部署。
- 验证：C302-E新增5项core fee/no-liquidity向量，FeeExecution专项15/15、Hook A/B/C/D/E联合50/50、concrete产品3/3通过；完整Foundry门禁41 suites、542/542通过，其中产品223、共享311、fixture 6、scaffold 2；Python规格57/57、`npm test`、`npm run build`、格式、fixture、interface、offchain与Web检查全部通过。产品artifact生成器确认Hook的8个canonical函数、5个mutation及4个事件无额外旁路；product manifest增至14模块，hash为`0xaa97b670f334d29b8a2e3a2eba2ca9b02462dfac542591beca4e8c5fb392bdc6`，仍是compiled artifact而非production deployment evidence。

### V2-C-303-A：Curve sweep、Swept与自动毕业入口（2026-09-03）

- 状态：`DONE / PARENT V2-C-303 IN_PROGRESS`；下一子任务为`V2-C-303-B`毕业数量推导。本步复核并组合既有Curve/Registry外层流程与新增Executor入口，不提前实现pool Meme公式、Locker CREATE2、v4 initialize/mint、Hook activate、permissionless retry或七日rescue。
- Curve与状态权威：`PonsCompatibleCurve`的最终买入固定按成交与退款、最终FeeVault exact sweep、Curve tracked余额清零、真实Quote/Meme转入immutable Executor、exact Curve `markSwept`、回读`Swept + ACTIVE`、Curve自有`LaunchSwept`、try/catch `graduateFromCurve`顺序执行。MarketRegistry保持`NotGraduated -> Swept`唯一权威，只有登记Curve可写且`sweptAt`只写一次；fee sweep、资产转移或markSwept任一步失败都回滚整笔最终买入，Executor子调用失败则只回滚子调用并由Curve发出deterministic reason hash，完整Swept与托管资产保留。
- Executor入口：新增`GraduationExecutorEntry`，从Registry读取不可变市场快照，只允许exact registered Curve在`Swept + ACTIVE`进入，并以`ReentrancyGuard`拒绝嵌套执行。内部毕业算法返回后再次读取Registry，强制要求phase已原子变为PoolCreated、poolId非零、状态仍ACTIVE、sourceVersion恰好加一、Curve及`sweptAt`未变；静默返回、部分提交或下游revert均整体回滚，不会让Curve误判自动毕业成功。该层不复制launch phase或独立保存可漂移的retryable标志。
- 验证：新增Entry专项5/5；Curve 19项测试已改为经过真实Entry guard/postcondition，Curve + Registry + Entry联合52/52通过，覆盖exact caller、NotGraduated/PAUSED拒绝、完整提交、下游失败、静默半提交、最终fee sweep与markSwept回滚、自动失败保留Swept及事件owner。完整Foundry门禁42 suites、547/547通过，其中产品223、共享316、fixture 6、scaffold 2；Python规格57/57、`npm test`、`npm run build`、格式、fixture、interface、offchain、Web及14模块product artifact检查全部通过，manifest hash保持`0xaa97b670f334d29b8a2e3a2eba2ca9b02462dfac542591beca4e8c5fb392bdc6`。

### V2-C-303-B：毕业数量推导与逐资产守恒（2026-09-03）

- 状态：`DONE / PARENT V2-C-303 IN_PROGRESS`；下一子任务为`V2-C-303-C` Locker CREATE2、v4 initialize/settle/full-range mint与Hook激活。本步只闭合最终Executor可继承的公式和资产消费层，不用全局合约余额猜测某个市场的escrow；每市场amount持久记录、permissionless retry和七日rescue仍由D闭合。
- 数量与配置：新增`GraduationExecutorAssetAccounting`，从MarketRegistry绑定的exact ApprovedQuoteRegistry读取市场冻结配置并逐项重核quoteAsset、ponsBaselineId、economicsHash和phantom。它只接受concrete Executor提供的per-market recorded `sweptQuote/sweptTokens`，复用`PonsSupplyMath.mulDiv`计算`poolMeme=floor(sweptTokens*sweptQuote/(sweptQuote+phantom))`与`lockedExcess=sweptTokens-poolMeme`，零值、退化和分母溢出均fail closed。
- 资产与事件：进入下游前分别确认native/ERC-20 Quote和Meme余额覆盖本市场记录值；下游必须把全部swept Quote、精确pool Meme及全部locked excess从Executor消费，返回后两个资产余额减少量必须逐项exact匹配，预存或强制转入的无关余额保持不变。Locker必须非零且不能是Executor自身；只有完整pool/Locker路径提交后才按canonical字段发`PoolGraduated`，后续Entry再校验PoolCreated、poolId、sourceVersion和sweptAt，任一不符时事件、转账和Registry提交一并回滚。
- 验证：C303-B专项7/7、Curve + Registry + Entry + Pons数学/差分联合77/77通过，覆盖native与ERC-20两条固定runtime数量、向下取整、pool/excess守恒、无关余额隔离、余额不足、少消费、错误Quote binding、零值、无效Locker及PoolCreated全回滚。完整Foundry门禁43 suites、554/554通过，其中产品223、共享323、fixture 6、scaffold 2；Python规格57/57、`npm test`、`npm run build`、格式、fixture、interface、offchain、Web及14模块product artifact检查全部通过，manifest hash保持`0xaa97b670f334d29b8a2e3a2eba2ca9b02462dfac542591beca4e8c5fb392bdc6`。

### V2-C-303-C（阶段1）：canonical v4池计划（2026-09-03）

- 状态：`IN_PROGRESS / POOL MATH DONE`；已闭合C303-C中PoolKey校验、初始价格、全区间tick、流动性与poolId推导。下一阶段继续解决Locker预测地址与毕业时Position NFT tokenId的canonical绑定，再接入真实PositionManager动作编码、initialize/settle/mint、Hook activate及Registry commit；本阶段不提前将C303-C或父任务标为完成。
- PoolKey与资产槽：新增`GraduationPoolMath`，要求currency严格排序并逐字匹配市场Quote/Meme，fee固定为0，tickSpacing限制在v4有效正域，Hook非零且低14位权限精确为`0x2044`。按currency顺序将全部`sweptQuote`和公式所得`poolMeme`映射到amount0/amount1，二者必须非零且位于正`int128`域。
- 价格与头寸：使用锁定v4-core的`FullMath`/`TickMath`/`Pool`及v4-periphery的`LiquidityAmounts`。价格优先按Q192计算，乘法结果超256位时切换等价Q128路径并左移32位恢复Q96；最终sqrtPrice必须严格位于v4上下界内。初始tick由官方`getTickAtSqrtPrice`反推，全区间边界按Solidity向零截断对齐tickSpacing，流动性取官方amount0/amount1结果的最小值并检查每tick最大流动性；poolId固定为`keccak256(abi.encode(PoolKey))`。
- 边界与验证：新增7项专项覆盖native/ERC-20固定runtime数量、Meme位于currency0、Q128大比率路径、`int128.max`价格边界、零值/越界数量及PoolKey每个字段。专项7/7、与AssetAccounting/Pons数学差分联合32/32通过；完整Foundry门禁44 suites、561/561通过，其中产品223、共享330、fixture 6、scaffold 2；Python规格57/57、`npm test`、`npm run build`、格式、fixture、interface、offchain、Web及14模块product artifact检查全部通过，manifest hash保持`0xaa97b670f334d29b8a2e3a2eba2ca9b02462dfac542591beca4e8c5fb392bdc6`。真实v4 Fork、Locker托管和Position NFT所有权仍分别由后续C303-C及T301闭合。

### V2-C-303-C（阶段2）：Locker静态CREATE2与prospective Position绑定（2026-09-03）

- 状态：`IN_PROGRESS / POOL MATH + LOCKER BINDING DONE`；本阶段解除“Factory创建市场时必须预测Locker，但Position NFT tokenId只在未来毕业时确定”的设计冲突。下一阶段继续实现官方PositionManager `MINT_POSITION + SETTLE_PAIR`、mint结果核验、dust路由、Hook activate与Registry commit的原子执行层。
- 地址与tokenId分离：新增`LaunchLockerBinding`。CREATE2 init code只包含marketId、Registry及PositionManager等静态输入，不包含全局递增tokenId，因此Factory预测后即使其它市场先mint，预测地址仍不变化。Locker只可由Registry冻结的exact GraduationExecutor在`Swept + ACTIVE + poolId=0`时部署；构造期间读取当时`nextTokenId`并与canonical poolId一起冻结，零值、溢出前值、错误阶段、错误部署者或无代码依赖全部fail closed。
- 永久托管约束：绑定层没有initializer或外部setter，也不靠ERC721安全回调写身份。最终Executor必须紧接着将该exact tokenId直接mint给Locker，并验证PositionManager计数器只增加1；Locker为后续compound暴露内部所有权守卫，`ownerOf(tokenId)`不存在或不等于自身都会失败。任何initialize回调或异常动作若抢占prospective tokenId，后续核验会回滚整个毕业子调用及CREATE2部署。
- 验证：专项4/4通过，覆盖预测后把`nextTokenId`从1推进到27仍得到同一实际CREATE2地址、构造时冻结27、无NFT/错误owner/exact Locker owner三态、非Registry Executor部署、非Swept状态及零tokenId。与Entry/AssetAccounting/PoolMath联合23/23通过；完整Foundry门禁45 suites、565/565通过，其中产品223、共享334、fixture 6、scaffold 2；Python规格57/57、`npm test`、`npm run build`、格式、fixture、interface、offchain与Web检查全部通过。该共享绑定层不改变canonical ABI，14模块product artifact hash保持`0xaa97b670f334d29b8a2e3a2eba2ca9b02462dfac542591beca4e8c5fb392bdc6`；真实mint/settle与最终Locker compound仍由后续C303-C/C304及T301/T302闭合。

### V2-C-303-C（阶段3）：官方PositionManager exact mint/settle与原子提交（2026-09-03）

- 状态：`DONE / PARENT V2-C-303 IN_PROGRESS`；C303-C的PoolKey、价格、全区间流动性、Locker CREATE2、Position NFT直入Locker、native/ERC-20 settle、Hook握手/激活和Registry提交已经闭合。下一子任务为`V2-C-303-D` per-market escrow持久记录、permissionless retry、七日rescue及concrete GraduationExecutor组合；最终Locker fee compound仍归C304。
- exact mint：`GraduationPoolMath`新增使用官方`SqrtPriceMath`向上取整反算实际mint amount0/amount1，并要求二者非零且不超过输入资产。新增`GraduationExecutorPoolExecution`固定使用官方v4 `PoolManager.initialize`和PositionManager `MINT_POSITION (0x02) + SETTLE_PAIR (0x0d)`；禁止delta-based mint。native只携带精确mint债务，ERC-20分别设置精确ERC20→Permit2及Permit2→PositionManager额度，成功后两层额度归零。
- Locker、dust与核验：Executor从自身CREATE2 namespace按`chainId + Factory + marketId + LOCKER` salt部署静态init-code Locker；mint前Locker prospective tokenId必须等于PositionManager当前计数器，随后保持注册、initialize、mint和NFT核验连续且不向dust recipient发起外部调用。mint后计数器必须恰加1，且`ownerOf`、完整PoolKey、PositionInfo内嵌poolId、tickLower/Upper和liquidity逐项匹配；只有核验通过后才将Quote整数dust路由到构造时冻结的protocol recipient、将`lockedExcess + Meme mint rounding dust`路由到Locker，避免initialize回调抢占tokenId或将NFT留给Executor/管理员。
- 原子生命周期：固定顺序为Locker部署、Hook EXPECTED注册、PoolManager initialize/beforeInitialize、核验INITIALIZE_SEEN、exact mint/settle、NFT与position核验、dust/excess路由、Hook activate、核验ACTIVE、Registry commitPoolCreated。任何晚期失败均回滚CREATE2 code、dust、Permit2额度、NFT、流动性、Hook binding及Registry状态；只有完整提交后外层AssetAccounting才验证本市场Quote/Meme逐项消费并发`PoolGraduated`。
- 验证：阶段3专项4/4、PoolMath/Locker binding/执行联合15/15通过，覆盖ERC-20与native两条完整路径、canonical actions、精确Permit2归零、直接Locker owner、两资产exact-arrival dust、native recipient确认mint先于dust、晚期activate失败全回滚，以及initialize期间抢占prospective tokenId全回滚。完整Foundry门禁46 suites、569/569通过，其中产品223、共享338、fixture 6、scaffold 2；Python规格57/57、`npm test`、`npm run build`、格式、fixture、interface、offchain与Web检查全部通过，14模块product artifact hash保持`0xaa97b670f334d29b8a2e3a2eba2ca9b02462dfac542591beca4e8c5fb392bdc6`。真实官方部署Fork仍由T301/T302闭合，不由严格ABI模型替代。

### V2-C-303-D：per-market escrow、permissionless retry与七日固定路径rescue（2026-09-03）

- 状态：`DONE / PARENT V2-C-303 CORE DONE`；下一子任务为`V2-C-304-A` per-market Locker永久Position NFT锁定。由于最终Executor的CREATE2 init code必须包含C304的concrete Locker creation code，GraduationExecutor与LaunchLocker产品artifact在C304完成后一起组合，当前不发布带占位Locker的半成品模块。
- 精确记录与闭合ABI：`PonsCompatibleCurve`在清零tracked reserve前永久冻结本次实际转给Executor的`sweptQuote/sweptTokens`；该只读记录与双资产exact transfer及`markSwept`位于同一外层交易，自动毕业子调用失败不会擦除，fee sweep或markSwept失败则一起回滚。新增`GraduationExecutorRetryAndRescue`只从Registry绑定的exact Curve读取记录，不从Executor同资产聚合余额推断，因而保持canonical mutation surface关闭且隔离预存/强制转入余额。
- retry与rescue：任意caller可经`retryGraduation`进入与自动入口完全相同的`_executeSweptGraduation`，但仅`Swept + ACTIVE`可执行；下游失败回滚Locker code、NFT、流动性、Hook、Registry和资产，记录保持可重试。`rescueSweptLaunch`接受任意市场状态下的Swept市场，仅在`block.timestamp >= sweptAt + 604800`开放，把记录中的native/ERC-20 Quote与Meme精确发送到Executor部署时冻结的单一distributor，再原子提交Rescued；公开入口无recipient参数，少一秒、错误阶段、余额不足、拒收或非精确到账均不留转账、状态或事件。
- 验证：新增D专项8/8，覆盖构造期固定recipient依赖隔离、permissionless成功retry、PAUSED拒绝retry、晚期失败后同escrow再次成功、七日包含端点、RETIRED rescue、native/ERC-20固定recipient、强制余额隔离、缺失Curve记录不可用聚合余额替代及native拒收全回滚；Curve 19/19新增成功/自动失败记录持久化与前置失败回滚断言。完整Foundry门禁47 suites、577/577通过，其中产品223、共享346、fixture 6、scaffold 2；Python规格57/57、`npm test`、`npm run build`、格式、fixture、interface、offchain与Web检查全部通过。Curve runtime变化已同步Factory锁定的implementation codehash，14模块product artifact hash更新为`0x35ec089ece59a669239fef552ed4d7b61b38d4a0a27a506489d6aab2fae945e3`。

### V2-C-304-A：per-market构造绑定与永久Position NFT托管（2026-09-03）

- 状态：`DONE / PARENT V2-C-304 IN_PROGRESS`；下一子任务为`V2-C-304-B` permissionless同池compound与单边余量隔离。本步只闭合最终LaunchLocker的不可变身份和资产托管边界，不提前加入复投mutation或发布会永久revert的占位产品模块；concrete LaunchLocker与GraduationExecutor在B完成后统一组合。
- 构造与托管域：新增`LaunchLockerCustody`并复用`LaunchLockerBinding`的静态CREATE2构造路径。构造期再次读取Registry market与完整canonical PoolKey，逐项核验严格排序的Quote/Meme currencies、fee=0、graduated Hook和已冻结poolId后，将currency0/currency1永久写入immutable；marketId、poolId、prospective tokenId和两种资产均无initializer、setter或重绑定路径，Registry后续漂移不改变Locker身份。
- 永久锁定边界：生产层只公开canonical两资产的`unpairedLockedBalance(currency)`只读视图，native value仅在canonical native-Quote池可正常接收。不存在NFT/资产withdraw、approve、transfer、任意execute、管理员或recovery入口；所有权守卫持续要求PositionManager的exact tokenId直接归Locker，NFT不存在或离开Locker即fail closed。locked excess、mint dust及未来未配对费用只能留在同一Locker的canonical currency域，如何复投该余额由C304-B闭合。
- 验证：Custody专项6/6、Binding+Custody 10/10、GraduationExecutor共享执行24/24通过，覆盖构造冻结、Registry key漂移、非canonical key拒绝、双资产余额隔离、禁用selector、native/ERC-20接收边界及NFT所有权破坏。完整Foundry门禁48 suites、583/583通过，其中产品223、共享352、fixture 6、scaffold 2；Python规格57/57、`npm test`、`npm run build`、格式、fixture、interface、offchain与Web检查全部通过。本共享层不改变canonical产品ABI或14模块product artifact，manifest hash保持`0x35ec089ece59a669239fef552ed4d7b61b38d4a0a27a506489d6aab2fae945e3`。

### V2-T-202：Gauge 数值、复杂度与守恒门禁（2026-09-03）

- 状态：`DONE`；T201与T202共同关闭`V2-GAP-006`。激活轮结构性满32槽checkpoint冻结`<2,000,000`测试阈值；公开跨秒调度会先自动处理成熟槽，1与256次正常调度的单槽checkpoint差不超过500 gas，空闲一年差不超过2,000 gas，遗弃256个snapshot不放大用户materialize成本。
- 全域与极值：对每个批准STOCK decimals `6..18`逐项派生`B=10×10^decimals`，固定覆盖`S=0/1/B-1/B/B+1`分桶；Gauge accumulator逐项使用对应最小合法仓位与`int128.max` reward验证pool remainder守恒，并覆盖`int128.max` canonical supply。
- Dust与生命周期：新增四用户任意有效比例256-run fuzz，证明reward的每个scaled单位都进入整数claimable、user remainder或pool remainder，永久经济dust为0；Solidity复算`2^48-1`次最坏credit的accumulator上界与P007机器值完全一致，距uint256上限仍有1208倍余量。完整证据见`V2_ACTIVATION_WHEEL_GAS_REPORT.md`与`V2_ACCUMULATOR_NUMERIC_REPORT.md`；最终全量门禁结果以本任务收口验证为准。

### V2-C-304-B：permissionless同仓compound与单边余量隔离（2026-09-03）

- 状态：`DONE / PARENT V2-C-304 DONE / V2-C-303 PRODUCT DONE`；concrete `LaunchLocker`与`GraduationExecutor`已进入16模块产品artifact，解除`V2-T-101-C`的Locker实现依赖，并使`V2-T-302`进入READY。
- 同仓复投：Locker每次先复核不可变market/pool/tokenId、NFT直接ownership、canonical PoolKey、full-range ticks及原liquidity，再用官方`INCREASE_LIQUIDITY(0)+TAKE_PAIR`把两资产fee收回自身；收取动作不得改变key/info/liquidity。随后从真实Slot0和Locker两资产余额计算显式liquidity，以`INCREASE_LIQUIDITY+SETTLE_PAIR`只增加原tokenId，禁止deprecated delta-based action。
- 资产与故障边界：native只作为排序后的currency0携带精确value；ERC-20只给Permit2与PositionManager设置本次精确额度，成功后两层均归零。单边余额或uint128 liquidity饱和时原地保留；实际消耗必须逐资产等于计划值。新增uint128/uint160显式窄化上界，错误owner/PoolKey、短扣款、晚期increase失败与回调重入均整笔回滚，不改变NFT ownership或跨池。
- 验证：新增product专项10/10，覆盖permissionless ERC-20/native双边复投、预存余额合并、单边余量、最大liquidity、两层allowance归零、canonical position不变、错误owner/PoolKey、短扣款、晚期失败及重入；16模块product artifact exact ABI/event检查通过，manifest hash更新为`0x9f2cdf177092104c49815525c042475dc652f05226f61f3e707063933cb04de2`。真实官方PoolManager/PositionManager feeGrowth行为仍由`V2-T-302`固定Fork闭合。

### V2-C-305-A：canonical Router/Quoter交易发现（2026-09-03）

- 状态：`DONE / PARENT V2-C-305 DONE`；MarketRegistry构造时要求共享v4 Router与Quoter均已有code、地址不同且不与GraduationExecutor别名，并将两者永久冻结为immutable。目标链具体地址及codehash仍由deployment manifest/live preflight闭合，不由前端或后端动态配置。
- 单一发现结果：新增canonical `CanonicalRoute`与`canonicalRoute(marketId)`，一次返回完整五字段PoolKey、PoolCreated前即可计算的expected poolId、Router、Quoter、Hook、Quote、Meme Token、Gauge、Curve、GraduationExecutor预测的LaunchLocker、sourceVersion、launchPhase、marketStatus及Registry推导的`curveTradingEnabled`/`poolTradingEnabled`。客户端无需拼接PoolKey、查多个动态配置或自行解释生命周期。
- Fail closed：未知市场、零Locker预测、Hook/资产结构漂移及非零runtime poolId与expected poolId不一致均revert；进入PoolCreated后还必须证明expected poolId已提交、Locker已有runtime code、Locker marketId一致且非零locked tokenId绑定同一pool。仅`NotGraduated + ACTIVE`开放Curve标志，仅`PoolCreated + ACTIVE`开放v4标志；Swept、Rescued、Paused、Retired和Emergency全部由合约返回关闭。
- 验证：MarketRegistry专项32/32通过，覆盖完整字段、native/排序PoolKey既有边界、NotGraduated/Swept/PoolCreated/Paused/恢复/Retired/Rescued/Emergency状态矩阵、未知市场、零预测、缺失或错误Locker、constructor EOA/别名及canonical selector；完整Foundry门禁51 suites、610/610通过，状态化Invariant为128,000 calls零revert，Python规格57/57、fixture/interface/product artifact exact、CI tracks、offchain/Web测试及全量build均通过。16模块product manifest hash更新为`0x1e4c50237b881e07a0149ab6b336b6a45285bb52d72eaee9fb009bdf56ab27c6`。

### V2-T-301-A：Robinhood Chain v4固定Fork前置核对（2026-09-03，等待archive RPC）

- 状态：`READY / EXECUTION ENVIRONMENT WAITING FOR ARCHIVE RPC`；产品依赖已完成，但当前环境没有`ROBINHOOD_RPC_URL`。没有新增`contracts/test/v2/fork`文件，避免CI从`FIXTURES_ACTIVE`切换为要求RPC的`ACTIVE`后用不可重放环境制造假绿灯。
- 官方部署输入：Uniswap chain 4663清单已提供PoolManager `0x8366…0951`、PositionManager `0x58da…4fA7`、V4Quoter `0x8dc1…8f94`、StateView `0xf333…673b`、UniversalRouter `0x8876…0904`与Permit2 `0x0000…BA3`；当前公开RPC latest读取均存在runtime code。正式fixture必须在目标archive RPC上重新固定同一区块的block hash与各runtime codehash。
- 阻塞证据：公开RPC可返回冻结区块`52289586`及预期hash，也可返回当前finalized header `53059260 / 0x7477…f13c`，但对这两个显式block tag执行`eth_getCode`均返回`-32000 metadata is not found`，因此无法创建可复现Foundry fork。只读取`latest`不满足固定Fork验收，不能替代T301/T302。

### V2-C-401：MarketController与状态影响矩阵（2026-09-03）

- 状态：`DONE`；`V2-C-401-A/B`均关闭，`V2-C-402`解除依赖并进入READY。新增concrete `MarketController`后产品artifact为17个模块；Emergency外部selector及原子编排入口保持canonical完整，但cap/root Recovery的产品实现与端到端验收仍归C402，不能由本任务绿灯替代。
- 状态权威与权限：Controller以immutable AccessManager按selector隔离即时Guardian pause、24小时延时unpause与48小时延时admin retire，只调用Registry语义迁移，不保存第二份status或计时。Registry继续唯一写入`statusSince/restrictedSince`：ACTIVE离开时起算、PAUSED→RETIRED保持、回到ACTIVE清零；Controller与Registry分别发出canonical业务事件和带精确时间锚点的权威事件，reasonHash原样传递。
- Asset/Quote影响：`isStockAllocationOpen`只在`PoolCreated + Market ACTIVE + Asset ACTIVE`返回true。Asset PAUSED/RETIRED继续阻止新市场、deposit及allocation增加方向；Quote PAUSED/RETIRED只阻止新市场，不静默暂停历史市场。普通Market/Asset/Quote状态变化不新增对历史claim、pending成熟、到期退出或free STOCK提款的否决路径，历史市场停盘必须显式走Market pause。
- 验证：MarketController专项8/8通过，覆盖真实OpenZeppelin AccessManager的0/24h/48h边界、ACTIVE/PAUSED退役、reason/event转发、非法边原子失败、完整views、Asset-aware allocation矩阵、构造依赖及canonical selectors；MarketRegistry既有32/32继续覆盖精确连续计时和所有非法边。产品manifest更新为17模块及hash `0x2989557ba341c2a994f34d989c24330661e7df74b858533d68c931ea01904c83`，最终全量门禁结果以本任务收口验证为准。

### V2-C-402-A/B：Emergency原子激活与本金逃生（2026-09-03）

- 状态：`DONE / PARENT V2-C-402 IN_PROGRESS`；Controller在同一交易读取旧Registry/Gauge/FeeVault状态并形成规范16字段stateHash，FeeVault自行冻结Quote/Meme当前Staker liability，随后依次永久禁用Gauge、存在时禁用Hook，最后才提交Registry Emergency终态。任一步失败均回滚完整调用，调用者不能提供epoch、snapshot、hash或cap。
- 不可变依赖循环：FeeVault允许构造时绑定非零、无代码但已预计算的未来Controller地址，且拒绝与其它依赖别名；先部署Vault、再部署到该精确地址的Controller，不需要initializer或可变setter。真实AccessManager集成测试证明24小时角色延迟与24小时连续受限业务延迟同时满足后才可激活。
- 本金路径：既有concrete `UserStockVault.forceRelease`只读取Registry的Emergency终态，仅释放`msg.sender`在指定市场的allocation回其同一Vault free balance，不调用Gauge、不接受owner/recipient；重复、跨市场或非终态调用均失败。
- 验证：RecoveryCaps专项8/8与Controller原子组合1/1通过，覆盖exact双资产cap、冻结不可变、epoch/block/hash/Controller binding、错误状态、重复冻结，以及cap→Gauge→Hook→Registry的严格调用顺序与stateHash逐字段复算；UserStockVault既有11项产品测试继续覆盖本人force release与负向边界。C402-C/D继续闭合root与claim后再发布完整父任务结论。

### V2-C-402-C/D：Recovery root、capped claim与concrete FeeVault（2026-09-03）

- 状态：`DONE / PARENT V2-C-402 DONE`；新增`ProtocolFeeVaultRecoveryRoots`与`ProtocolFeeVaultRecoveryClaims`共享层，并组合为concrete `ProtocolFeeVault`。每个market+epoch+asset只允许`NONE/CANCELLED -> PENDING -> ACTIVE`，取消后nonce严格递增，ACTIVE终态不可替换；proposal使用RECOVERY_ROLE 24小时执行延迟，Guardian即时取消，任何人只能在精确满48小时后finalize。
- Snapshot与Merkle域：proposal与finalize均要求Registry仍为同一Emergency epoch并存在该epoch不可变frozen snapshot；feeAsset只能是该snapshot冻结的Quote或Meme，declaredTotal非零且不超过对应cap。claim使用OpenZeppelin sorted-pair proof与规范双哈希，域包含schema、chainId、Vault、`V2-EXEC-3`、market、epoch、asset、caller和amount，固定支付caller且以market+epoch+asset+user防重领。
- 会计与失败语义：claim先验证ACTIVE root、proof、declaredTotal与cap，再以effects-before-interactions扣减该市场该资产的Staker bucket和全局total liability，执行exact fixed-user payout；ERC-20/native转账失败、偿付能力失败或回调重入均回滚claimed flag、累计额与负债。未声明或未领取部分继续留在原Staker liability，不可转移到Creator、Platform或另一市场。
- 产品与验证：concrete Vault构造支持绑定预计算但尚无代码的未来Controller地址，解决Vault/Controller immutable部署循环且拒绝依赖别名；runtime 16,814 bytes，低于EIP-170上限。Root 6/6、Claim 5/5、产品3/3及Emergency cap/组合9/9专项通过；完整Foundry 57 suites、641/641通过，Invariant 128,000 calls零revert，Python规格57/57、fixture/interface/product artifact exact、CI、offchain、Web与build全部通过。产品artifact增至18模块，manifest hash为`0xaebfa4ff1a0d72983488c29021387bdfdf1a60e09f2c2d3469648ae19bdce49f`。

### V2-C-403：AccessManager精确配置、移交与只读核验（2026-09-03）

- 状态：`DONE (LOCAL PLAN + VERIFIER; LIVE INSTALL GATED)`；C403-A/B/C实现任务已关闭，`V2-T-401`解除依赖并进入READY。中央readiness仍为`IMPLEMENTATION_ALLOWED`，因此本步只产生确定性calldata计划和只读核验器，不广播交易、不伪造目标链receipt；真实安装与最终区块证据继续归`V2-O-701/V2-L-802`。
- selector与延迟：部署计划从18模块compiled manifest精确派生80个mutation，其中22个安装AccessManager角色，58个由immutable caller或public/direct语义约束。角色成员与执行延迟固定为治理Safe 48h、Guardian Safe即时、Security/Governance Safe 24h、Recovery Safe 24h；七日rescue继续仅是`MARKET_RUNTIME_SWEPT_AT`业务状态延迟，不生成AccessManager调度。
- OpenZeppelin管理语义修正：执行级测试证明`setTargetFunctionRole`是框架内建全局`ADMIN_ROLE`操作，不能靠给AccessManager自身selector赋自定义角色来转权。最终顺序改为先安装Guardian与协议selector、授予四个Safe角色，再把四个V2 role admin全部固定为`PROTOCOL_ADMIN_ROLE`，最后由deployer撤销唯一`ADMIN_ROLE`。此后`grantRole/revokeRole`按被管理role的admin语义保留48h治理路径，而`setTargetFunctionRole`、`setRoleAdmin/Guardian`、`updateAuthority`等八个全局管理selector永久锁定。
- fail-closed核验：planner拒绝18模块地址缺失、额外、零地址、模块/AccessManager别名以及deployer与Safe重合。live preflight读取全部80个协议selector、四个role admin/guardian、成员与delay，并从部署块完整回放selector与RoleGranted/RoleRevoked事件，要求最终成员集合精确等于四个Safe且不存在残余ADMIN或未知角色；错误role admin/guardian、额外selector/成员、deployer残余与receipt失败均有负向测试。
- 验证：AccessManager EVM集成3/3、deployment工具22/22通过；完整Foundry 58 suites、644/644通过，其中Product 255、shared 381、fixture 6、scaffold 2，Invariant 128,000 calls零revert。Python规格57/57、fixture/interface/product artifact exact、CI、offchain与Web门禁全部通过；18模块product manifest hash保持`0xaebfa4ff1a0d72983488c29021387bdfdf1a60e09f2c2d3469648ae19bdce49f`。

### V2-T-401：全状态机与权限负向矩阵（2026-09-03）

- 状态：`DONE`；A/B均闭合，下一可领取项为`V2-T-402` Emergency/Recovery演练。各产品入口依赖不同状态因子，因此验收采用真实入口的正交矩阵，不构造一个不存在于协议中的统一全局gate。
- 状态乘积：新增`V2T401StateMatrix`，通过生产`MarketController.isStockAllocationOpen`自动枚举`4 launch phases × 4 market statuses × 4 asset statuses × 4 quote statuses = 256`项，只允许`PoolCreated + Market ACTIVE + Asset ACTIVE`四个Quote正交组合；显式Quote Registry状态证明历史市场allocation gate不因Quote后续暂停/退役被静默改写。
- 其余状态因子：既有真实产品测试继续证明Curve只在`NotGraduated + ACTIVE`交易、FeeVault v4 credit只接受`PoolCreated + ACTIVE + exact sourceVersion + registered Hook caller`、Asset/Quote非ACTIVE阻止新创建但不新增历史claim/成熟/退出否决、PAUSED/RETIRED仍允许free withdraw与到期正常退出、Emergency仅开放本人force release。0/24h/48h caller/delay与Guardian取消由真实OpenZeppelin AccessManager执行级测试覆盖。
- 权限负向diff：deployment preflight现在系统拒绝额外/缺失selector、错误role/member/execution delay/state delay/recipient/precondition、错误role admin/guardian、未知角色成员和deployer残余权限；所有语义漂移在RPC前失败，链上事件/成员漂移在固定finalized block只读回放时失败。
- 验证：新增状态矩阵2/2，FeeVault source/lifecycle定向3/3，deployment工具22/22通过；完整门禁收口结果为Foundry 59 suites、646/646，其中Product 255、shared 383、fixture 6、scaffold 2，Invariant仍为128,000 calls零revert。产品artifact未改变，18模块hash保持`0xaebfa4ff1a0d72983488c29021387bdfdf1a60e09f2c2d3469648ae19bdce49f`。

### V2-T-402：Emergency本金与Recovery root恢复演练（2026-09-03）

- 状态：`DONE`；T402-A/B均关闭。`V2-GAP-008`的本地产品、权限和演练证据已经完整，仅保留目标链安装/撤权证据；下一项不受archive RPC阻塞且依赖已满足的任务为`V2-I-501`。
- 本金演练：在真实`UserStockVault + AllocationManagerDecreases`组合中，两个用户均已锁仓；普通PAUSED状态于`unlockAt-1`仍因24小时锁失败。进入Emergency后，先把Gauge设为checkpoint永久revert，再直接移除Gauge code模拟不可用/自毁终态，两个用户均无需调用Gauge即可分别force release并withdraw全部本人本金，最终Vault总本金与总allocation归零。
- root修正与cap：新增完整nonce 1错误root提案→Guardian取消→nonce 2正确root提案→精确48小时finalize→双用户claim流程；旧root的有效叶、已领取用户重复claim以及ACTIVE后恢复旧root全部失败。新增256-run fuzz持续验证`claimedTotal + remaining staker liability <= frozen cap`，确定性满额路径验证等式和总负债归零。
- 域与旧source：同一有效leaf/root被分别安装或调用到错误market、epoch、fee asset及chainId时均不能领取，且各市场/资产负债不变。既有concrete Gauge one-way disable、Hook disabled binding终态与FeeVault Emergency/sourceVersion测试共同证明旧Gauge全部mutation、旧Hook swap/credit和旧source credit不可恢复。
- 验证：RecoveryClaims由5项增至8项，AllocationManagerDecreases新增1项；专项Claims 8/8、Emergency/旧source联合4/4通过。完整门禁收口目标为Foundry 59 suites、650/650，其中Product 255、shared 387、fixture 6、scaffold 2；product artifact未改变。

### V2-I-501：Indexer事件schema与确定性投影（2026-09-03）

- 状态：`DONE`；I501-A/B/C均关闭，`V2-I-502`与`V2-B-501`解除依赖并进入READY。当前交付是可测试的事件schema与纯投影边界；RPC轮询、持久化adapter、checkpoint、reorg rollback、空库重建和链上对账仍严格归I502，不由内存测试替代。
- Artifact与来源：新增生成器从18个compiled V2 interface artifact产生强类型事件联合，并只从vendored canonical Uniswap v4 `IPoolManager` artifact补入`Swap/Donate`，当前冻结55个唯一完整签名。两个不同参数表的`MarketStatusChanged`按signature分别处理；生成文件stale会使Indexer测试fail closed，不导入或手抄V1事件。
- 投影与链上事实：config、market、Curve、Pool、Vault/allocation、activation、fee/claim及Recovery实体和原始事件均携带chainId、block number/hash、transaction hash/index、log index与emitter。市场键固定为marketId，Curve交易通过Registry已记录的canonical Curve地址归属，不以symbol或展示字段作键；事件只提交hash/局部状态时由`requiredObservations`显式请求同区块MarketView、PoolKey、Curve/Gauge或liability读取，投影不得估算余额、收益或PoolKey。
- 顺序与失败语义：同一chain按block/tx/log严格递增，精确重复日志幂等，复用相同唯一键但blockHash/signature冲突以及非重复乱序均拒绝。每个`V4FeeAccrued`必须匹配同一transaction、同一pool中此前最近且未配对的PoolManager `Swap`；缺失或顺序相反会在写入前失败，FeeBuckets/Staker/V4片段按canonical feeId合并且保留最新来源位置。
- 验证：Indexer生成检查、TypeScript strict build与10/10测试通过，覆盖artifact catalog、完整provenance、config/market/Curve归属、Pool Swap/Hook fee顺序、缺失配对、幂等/冲突/乱序、block-tagged补全、activation、claim及Recovery root全生命周期。全仓门禁保持Foundry 59 suites、650/650，Invariant 128,000 calls零revert，deployment 22/22，Indexer 10/10，Python规格、fixture/interface/product artifact、CI、其余offchain、Web与完整build全部通过；18模块product manifest hash保持`0xaebfa4ff1a0d72983488c29021387bdfdf1a60e09f2c2d3469648ae19bdce49f`。

### V2-I-502：Canonical重放、reorg checkpoint与链上对账（2026-09-03）

- 状态：`DONE`；I502-A/B均关闭，Indexer核心任务完成。支持范围定义为从冻结deployment/start block开始、checkpoint仍保留的完整canonical block journal；新分支必须连接已知共同祖先，超出保留范围或parentHash不连续时fail closed，不用latest状态猜测历史。
- 持久与重放：新增executionSpec绑定且bigint-safe的JSON checkpoint，以临时文件同目录写入后原子rename；只持久化canonical block、原始解码事件与同block observations，重启后从事实日志重建所有materialized projection。branch先在隔离副本完整重建并持久成功后才发布内存状态，避免handler、磁盘或分支验证失败留下半状态。
- 幂等与reorg：block链逐项核验chainId/number/hash/parentHash及event block元数据；相同block payload重复无副作用，相同事件身份若blockHash、signature、emitter或args漂移即冲突。分叉时删除共同祖先之后的raw facts、observations、fee credits和Swap/Hook pairing，再按新分支重放；全部Map按key排序并统一bigint编码，`canonicalStateBytes`用于证明reorg结果与空库canonical重建字节一致。
- 对账：`requiredObservations`扩展到Vault、Gauge、FeeVault、sourceVersion与PoolKey/Binding，所有读取由调用方在事件block tag执行。`reconcileAtTip`支持exact equality及onchain balance至少覆盖projected liability两种比较，缺字段、事件遗漏、余额/liability、active/pending、sourceVersion和Pool状态漂移均返回带indexed tip block number/hash的告警，不自动修补投影。
- 验证：Indexer strict build与16/16测试通过，覆盖checkpoint磁盘恢复、精确block重复、payload/断链拒绝、两层共同祖先替换、空库字节重建、孤儿Swap/fee清理、五域漂移/偿付能力告警及空索引拒绝。全仓门禁保持Foundry 59 suites、650/650，Invariant 128,000 calls零revert，deployment 22/22，Indexer 16/16，Python规格、fixture/interface/product artifact、CI、其余offchain、Web与完整build全部通过；18模块manifest hash不变。下一项按依赖已可领取`V2-B-501`。

### V2-B-501：Backend V2只读API（2026-09-03）

- 状态：`DONE`；B501-A/B均关闭，`V2-B-502`解除依赖进入READY。API只开放GET health、market列表/详情、四类config列表及用户position列表；POST等全部写方法返回`405 read_only`，服务不持有密钥、不签名、不提交交易，默认空repository显式报告`unavailable`而非伪造数据。
- 市场与仓位模型：market返回canonical market/asset/config/baseline IDs、Meme/Quote/Curve/Gauge、sourceVersion与生命周期、Curve real reserve/sellable/reserved/accrued fee/ready/swept状态、poolId、完整五字段PoolKey及Router/Quoter/Hook/GraduationExecutor/LaunchLocker和交易开放标志。position分开返回free/allocated/pending/active、activation/unlock时间、固定Quote/Meme双资产claimable，并逐记录携带chain/block/tx/txIndex/log来源。
- 信任与分页边界：repository仅接受`V2-EXEC-3`且I502 reconciliation alerts为空的snapshot，逐项拒绝非canonical hex、负数/非整数金额、source晚于sync、重复identity、PoolKey Hook/currency与route不一致、route lifecycle漂移、position allocation不守恒或claimable资产不匹配。分页固定1..100、ASCII canonical key排序；opaque cursor绑定endpoint、规范化filter、Indexer revision与last identity，跨filter或reorg后的复用失败。
- 同步语义：每个成功响应显式返回synced/lagging/unavailable、indexed block hash/number、finality、head、lag及revision；entity来源独立保留，不用当前head覆盖历史来源。金额统一十进制整数字符串，不在Backend重算余额、收益或PoolKey hash；poolId/hash真实性由零告警I502 snapshot提供。
- 验证：Backend strict build与6/6测试通过，覆盖health同步状态、asset过滤、两页cursor、limit/cursor/assetUid负向、完整PoolKey/route/Curve/source、config、仓位/双资产、write拒绝及unreconciled/PoolKey/守恒注入拒绝。全仓门禁保持Foundry 59 suites、650/650，Invariant 128,000 calls零revert，Backend 6/6、Indexer 16/16、deployment 22/22，Python规格、artifact/CI、其余offchain、Web与完整build全部通过；下一项为`V2-B-502`。

### V2-B-502：版本化OpenAPI与生成TypeScript客户端（2026-09-03）

- 状态：`DONE`；B502-A关闭，`V2-W-501`前置依赖已满足并进入READY。发布OpenAPI 3.1的五个GET端点，不提供签名、托管、交易提交或任何POST mutation；Backend模型直接复用生成类型，Web无需手写响应结构。
- Schema与精度：规范完整描述market/config/position/health、统一错误envelope、Indexer sync/finality/head/lag/revision和逐实体chain/block/tx/txIndex/log provenance。链上uint保持十进制整数字符串，bytes32/address使用canonical hex pattern，PoolKey、时间和同步字段的nullability显式冻结。
- 生成与兼容门禁：单一确定性生成器同步输出`backend/openapi/v2.json`、`backend/src/generated/v2-client.ts`和fingerprint lock；lock绑定OpenAPI严格SemVer与`V2-EXEC-3`，schema发生任何变化但版本未严格升高即失败，`--check`拒绝陈旧规范、客户端或lock。
- 客户端失败语义：生成客户端只发GET并编码path/query，发送前拒绝错误marketId/assetUid/address及越界limit；HTTP错误统一抛出含status和typed body的`TickerGardenApiError`。Backend 400/404/405全部返回message、sync及规范错误码。
- 验证：Backend生成一致性、测试TypeScript typecheck、strict build与13/13测试通过，覆盖五端点/无写operation、provenance、整数精度、nullability、统一错误、GET URL/查询参数、前置校验、typed API error及SemVer提升门禁。全仓门禁为Foundry 59 suites、650/650，Invariant 128,000 calls零revert，Backend 13/13、Indexer 16/16、deployment 22/22，Python规格、artifact/CI、其余offchain、Web及完整build全部通过；下一项`V2-W-501`已领取。

### V2-W-501：Robinhood钱包、compiled ABI与交易状态机（2026-09-03）

- 状态：`DONE`；W501-A关闭，`V2-W-502`依赖已满足并被领取。当前交付只提供底层钱包/交易能力，现有状态页继续只读；Launch/Curve、毕业池、Vault/收益及Emergency/Recovery界面必须分别由W502～W505验收，不能由本任务冒充完成。
- 链与类型来源：引入viem/wagmi injected wallet配置，Robinhood主网固定chainId 4663、ETH与官方public RPC/Blockscout；十九模块ABI从E102 compiled interface artifact确定性生成并携带逐artifact SHA-256，stale check拒绝手抄或漂移。Backend OpenAPI客户端也由B502产物确定性同步，Web不另写响应类型。
- 状态机与失败语义：统一流程为preflight→simulate→wallet signature→submitted/pending→receipt→fresh chain reconciliation；ERC-20可选approval自身也必须先simulate并确认后才重新验证snapshot并模拟主交易。operationKey合并重复点击，replacement更新最终hash，cancel、revert、timeout、错误chain/account、过期quote、executionSpec/revision漂移、Indexer lagging/unavailable、用户拒签及确认读回失败均为独立错误，不按calldata乐观伪造余额。
- 漂移保护：连接chain/account、quote expiry及可选Indexer revision在初始preflight和每次simulation之后重新验证；receipt成功后必须由调用方执行fresh Registry/Vault/Gauge/FeeVault或reconciled Backend读回才能进入confirmed。生成的`createContractWriteRequest`以compiled ABI约束mutation函数名与参数类型。
- 验证：Web生成一致性、strict TypeScript、9/9交易/ABI测试及4/4 Sites worker测试通过，覆盖18 artifact exact diff、Backend生成类型、simulate顺序、approval、replacement、重复提交、全部关键错误与simulation后漂移；Web production build通过。全仓门禁保持Foundry 59 suites、650/650，Invariant 128,000 calls零revert，Backend 13/13、Indexer 16/16、deployment 22/22、Web 13/13，Python规格、artifact/CI、其余offchain与完整build全部通过。

### V2-C-405：Emergency/Retired × NotGraduated恢复缺口（2026-09-03）

- 状态：`DONE (LOCAL PRODUCT + REAL-BALANCE INVARIANT)`。Registry现在防御性拒绝`NotGraduated`市场进入`RETIRED`或`EMERGENCY_EXIT`，Controller在调用Gauge、Hook、FeeVault等任何Emergency外部副作用之前执行同一前置拒绝；`PAUSED`仍可恢复为`ACTIVE`，因此未毕业Curve不会进入永久停盘且资产不可取回的终态。
- 真实资产证据：`C405CurveRecoveryInvariant.t.sol`分别部署真实`PonsCompatibleCurve`、真实固定供应`TickerMemeTokenV2`以及native/6-decimal ERC-20 Quote，执行真实buy形成非零tracked reserve、accrued fee、Curve Quote余额和Meme余额；ACTIVE直接retire、PAUSED满24小时retire及Emergency commit均原子revert且所有tracked/raw余额不变，随后unpause并再次交易证明恢复路径可达。
- 一致性：`PreGraduationTerminalStateForbidden(uint8)`已从最终compiled artifact反向同步至canonical ABI、权限/执行manifest、接口和Web ABI；产品manifest仍为十八模块，hash为`0x0e00c9aa61efc11bf3fb8cb25639e4ee36b93166f1ff73c9ef916a75224f790e`。
- 验证：C405专项2/2、MarketRegistry 33/33、MarketController 10/10通过；完整Foundry为60 suites、655/655，既有Vault/Gauge状态化Invariant保持256 runs、128,000 calls、0 revert；Python规格58/58及artifact exact/stale门禁通过。目标链v4行为与部署安装不由该本地任务冒充，继续由T301/T302与O701/L802验收。

### V2-S-501：无特权Maintenance Runner（2026-09-03）

- 状态：`DONE (LOCAL INJECTED TRANSPORT; NO SIGNER/CUSTODY)`。Runner只接受`sweep/checkpoint/retry/compound + canonical marketId + triggerId`并映射固定公开模块/selector，不接收任意target或calldata，不内置RPC、私钥、签名器、协议角色或用户资产托管。
- 执行边界：每次提交先simulate；noop、fatal与retryable分离，operation/market/trigger幂等键合并并发和已完成触发，批量调度仅在链下以1..16有界并发调用单市场入口。transport必须原子持久化key并实现`findSubmission`；Runner在simulate前和任何模糊submit结果后查询该来源。广播前显式retryable的durable lookup故障可消耗下一次有界attempt，未知/非retryable故障立即失败；一旦submit可能已广播，后续lookup无论错误类型都终止，绝不触发第二次广播。完成缓存和事件缓冲有界且不暴露内部可变数组；未知请求字段、Proxy/accessor响应、invalid shape及非canonical tx hash首轮fail closed。
- 验证：`npm --prefix services/maintenance-runner test`为11/11，`npm --prefix services/maintenance-runner run build`通过；覆盖固定映射、simulate-before-submit、并发合并、新trigger、retry分类、广播前durable lookup耗尽与恢复成功、广播后lookup失败不重播、跨缓存淘汰/进程重启持久恢复、模糊submit响应、observer隔离、有界缓存/并发、未知字段、恶意响应及无效transport响应。

### V2-W-502 / V2-W-504 / V2-W-505-A：本地Web产品旅程（2026-09-03）

- 状态：W502与W504为`DONE (LOCAL PRODUCT FLOW; TARGET E2E GATED)`；W505-A技术子任务为`DONE (LOCAL TECHNICAL FLOW; LEGAL/E2E GATED)`，W505父任务仍被`V2-G0-LEGAL-01`阻塞。Web运行时只接受五项显式配置、origin-only Read API URL、四个非零canonical合约地址、`V2-EXEC-3`、chain 4663、完整finalized revision和read-only/non-custodial capability；Factory的`runtimeBindings()`进一步把显式Router/AllocationManager/FeeVault及四配置Registry/MarketRegistry锚定到不可变链上信任根。当前versioned Backend仍声明`productRuntimeImplemented:false`，因此完整release gate关闭且任何写按钮不可启用。
- Launch/Curve：配置只能取finalized API的ACTIVE STOCK/Quote/Pons/template，且在preview、allowance和每个签名前用Factory解析出的四Registry逐项核对status、Quote地址、Pons关系及economics；Factory链上读取launchFee并preview绑定economics。Market API的Meme/Curve/Gauge/Quote及Router/Quoter/Hook/Locker、PoolKey和生命周期必须与`MarketRegistry.market/canonicalRoute`一致后才可报价或交易；支持create及native/ERC-20原子launch-and-buy、allowance、partial refund语义、live quote、1% tolerance、buy/sell、receipt事件和fresh reserve/sweepNonce确认。创建回执只接受配置Factory发出的、与本次asset/Quote/Pons/economics逐字段一致的`MarketCreated`。API finalized snapshot与live RPC报价/模拟在UI中明确区分。
- Vault/Recovery：API Asset的STOCK/Vault/decimals/status先与OfficialStockRegistry一致，position关联市场及迁移目标先与MarketRegistry一致，再支持官方Vault approve/deposit、free withdraw、allocate/increase/decrease/close/migrate、deposit-and-allocate及Quote/Meme独立claim；这些绑定会在approval和主交易签名前重复检查。页面严格显示`>0.5 STOCK`、30秒pending和24小时unlock。Asset PAUSED/RETIRED停止新增敞口但不隐藏成熟退出；Emergency本人force release不依赖Gauge。Recovery页在链上绑定市场后读取真实cap/snapshot/root并校验stateHash、快照高度和NONE/PENDING/ACTIVE/CANCELLED字段不变量；输入切换后必须重读，finalize使用最新链上block timestamp，claim receipt绑定准确FeeVault/market/epoch/asset/user/amount并fresh读回claimed total。
- 验证：Web生成ABI/API一致性、strict TypeScript、31/31 unit及4/4 Sites worker测试通过，production build成功且主bundle已拆分为React/Web3/vendor/应用块；测试覆盖Factory不可变binding、API/链上Asset/Quote/Market/route漂移拒绝、Factory preview/请求、canonical Factory receipt来源/字段绑定、伪造日志、native/ERC-20 approval、Curve状态、runtime config、Vault状态/构造器、Paused/Retired退出、Recovery生命周期/claim事件/finalize/claim builder及W501交易状态机。毕业池写旅程、完整浏览器真实交易E2E和法律文案签字继续分别由W503、T601和W505-B关闭。

### V2-T-301 / V2-T-302：archive RPC阻塞复核（2026-09-03）

- 状态：`BLOCKED (ARCHIVE RPC REQUIRED)`。官方公开`https://rpc.mainnet.chain.robinhood.com`返回chainId 4663，且可读取固定block header、历史logs/receipt和latest runtime/state；但在冻结块52289586（hash `0x9477917aacd098d56b4d5fb375e555a09d1a61b7bf33417429e5c8e4a2e86006`）及52495836（hash `0xe0465f331be5fb0c4fa98e32e533864d71c9a687fdd18df80dc56c5f3f127f2a`）执行历史`eth_getCode`、`eth_call`或`eth_getStorageAt`均返回`-32000 metadata is not found`。
- 结论：公开端点是历史状态裁剪节点，`latest`或仅有logs/receipt不能满足固定Fork验收。解除阻塞必须提供通过环境变量注入、可读取上述固定高度历史state/code/storage的archive `ROBINHOOD_RPC_URL`，或已从genesis完成同步的本地archive节点；凭据不得提交仓库。在此之前不创建会把Fork轨道伪装为ACTIVE的假测试，T403、W503及后续安全/部署任务保持阻塞。

### 当前本地验证快照（2026-09-03）

- 当前权威本地计数：Python规格59/59；Foundry 61 suites、668/668，其中Product 272、shared 388、fixture 6、scaffold 2，状态化Invariant 128,000 calls、0 revert；Backend 13/13、Indexer 17/17、Deployment 23/23、Maintenance Runner 11/11、Web unit 31/31与Sites 4/4。十九模块当前product artifact manifest hash为`0x7d067fd53b7d187920bba90ce4fb44bd4c47dd9bc51de938d84b45cb52e520dc`。
- 这些绿灯只证明本地实现、生成物和分轨CI边界。Fork仍为`FIXTURES_ACTIVE`，readiness仍为`IMPLEMENTATION_ALLOWED`；archive RPC、法律、安全复核、独立审计、生产manifest、AccessManager实际安装/撤权、部署receipt、浏览器真实E2E和72小时灰度对账不得由本快照替代。

### V2本地收口硬化：decimals域、API链上绑定与Runner重试（2026-09-03）

- 数值域：机器权威、OfficialStockRegistry、MarketRegistry防御检查、AllocationManager增加路径、Web Vault和文档已统一为官方STOCK `6..18` decimals；边界测试接受6/18并拒绝5/19。此前实现/文档中的1..36会把未获批准的资产放入缺少完整accumulator寿命证明的域，现已关闭。
- Web信任边界：Factory新增只读`runtimeBindings()`且不扩展mutation surface；Web只从该不可变根解析Registry，所有会进入Quote、approval spender、Gauge/Vault/FeeVault或交易target的API地址均与链上Asset/Market/CanonicalRoute精确比较，并复用交易执行器的freshness checkpoint在签名前再次验证。被篡改API最多导致fail-closed，不能单凭格式合法把资金导向另一地址。
- Runner可用性：广播前明确retryable的durable幂等查询故障按`maxAttempts`恢复；未知错误仍立即失败，广播后任何查询故障仍终止且提交次数保持1，兼顾liveness与防重复广播。
- 验证：Factory专项51/51、Python规格59/59、Maintenance Runner 11/11、Web unit 31/31与Sites 4/4已通过；完整全仓计数以本节上方最终快照为准。Factory只读ABI、decimals runtime及本次Resolver/Gauge clone变化已重新生成compiled interface、Web ABI与十九模块product manifest，当前hash为`0x7d067fd53b7d187920bba90ce4fb44bd4c47dd9bc51de938d84b45cb52e520dc`。

### V2-C-205：Meme发行合约架构收敛（2026-09-03）

- 状态：`DONE LOCALLY / DEPLOYMENT EVIDENCE OPEN`。最终结构和取舍记录于 [V2_CONTRACT_ARCHITECTURE_DECISION.md](./V2_CONTRACT_ARCHITECTURE_DECISION.md)：三个配置Registry保留独立权威状态，以无缓存typed `LaunchConfigResolver`统一运维读取；Token/Curve保留完整CREATE2实例及各自typed helper；Gauge改为固定implementation加每市场OpenZeppelin immutable-args CREATE2 clone；持有Position NFT和余额的LaunchLocker继续每市场完整隔离。
- Gauge安全边界：八字段`GaugeIdentity`写入301-byte clone runtime，无initializer或升级入口；预测期允许尚无代码的predicted Meme地址，实际部署期强制Token、非native Quote、AllocationManager、FeeVault和Controller均有代码。Factory部署后回读完整identity hash；implementation、错误长度实例、别名依赖、错误资产、重复salt和跨clone storage/Emergency污染均由负向测试拒绝。
- 管理与部署证据：`LaunchConfigResolver`拒绝零地址、无代码地址和Registry别名；Factory不依赖Resolver可用性。canonical ABI、compiled interface、product artifact和Web ABI增至19模块。Deployment schema区分`FULL_CREATE2`与`ERC1167_IMMUTABLE_ARGS_CLONE`，并要求Gauge implementation地址/codehash、clone runtime/init-code/salt/immutableArgsHash、`gaugeIdentity()`回读及Resolver三Registry getter证据一致。
- Gas：旧Gauge每市场runtime 10,055 bytes，新clone为301 bytes，仅code-deposit由2,011,000降至60,200 gas，减少1,950,800（约97.0%）；共享implementation当前runtime 10,361 bytes且只部署一次。Factory代表性创建测试由5,968,776降至3,998,762 gas，减少1,970,014（约33.0%）。这些是本地solc 0.8.26/optimizer 200/Cancun基准，RH Testnet仍须重新固定交易与区块证据。
- 本地验证：Factory 51/51、Gauge 23/23、Resolver 6/6，完整 Foundry 61 suites、668/668 通过；Python 规格 59/59、Deployment 23/23、Backend 13/13、Indexer 17/17、Maintenance Runner 11/11、Web unit 31/31 与 Sites 4/4 全部通过，相关 build 均成功。canonical 产品 artifact 为 19 模块，hash `0x7d067fd53b7d187920bba90ce4fb44bd4c47dd9bc51de938d84b45cb52e520dc`。目标链 archive Fork、AccessManager 安装、实际部署 receipt、独立审计和 canary soak 仍是硬门禁。

### V2-C-206：Stock Vault 收敛为版本化 MultiAsset 架构（2026-09-03）

- 状态：`DONE LOCALLY / DEPLOYMENT EVIDENCE OPEN`。现行拓扑由“每Asset部署一个相同Vault”改为“每Vault schema版本一个共享MultiAsset Vault”；当前schema为`keccak256("TickerGarden.UserStockVault.MultiAsset.v1")`。`OfficialStockRegistryV2`保存`vaultSchemaId(vault)`与`vaultForSchema(schemaId)`，同一schema的第二个地址登记失败；Asset UID与Vault绑定仍write-once，新实现不使用代理或initializer。
- 资产隔离：所有deposit/withdraw/lock/release/move/force-release入口和全部余额getter显式接收`assetUid`。Vault只从OfficialStockRegistry解析Token，不接受调用者提供Token地址；`deposited/allocated/allocation/marketAllocated/totalDeposited/totalAllocated`均以Asset UID为第一层key，MarketRegistry再次验证`market.assetUid`，跨资产迁移和市场混用fail closed。
- 规模边界：Vault不保存资产数组，不提供batch或链上枚举，新增到数百种Stock不会改变单次用户操作的O(1)复杂度。194资产仅runtime code-deposit从旧架构约301,864,000 gas降至单实例约1,564,200 gas，节省约300,299,800（99.48%）；该数字不含constructor、登记、calldata或目标链定价。当前夹具中deposit/withdraw/force-release中位数分别为109,233/71,573/92,342 gas，只作为本地参考。
- 风险边界：共同代码缺陷在两种拓扑中都存在，但共享地址会扩大单次故障、错误依赖或跨资产账本缺陷的blast radius，因此安全性并非完全相同。实现以canonical UID解析、逐资产聚合、exact token balance delta、immutable Manager权限、无管理员sweep/任意recipient/任意execute及PAUSED/RETIRED可退出约束风险；跨资产测试覆盖两个真实Token在同一Vault内的余额和allocation隔离。若未来风险预算要求分片，必须用新schema/execution spec显式引入，不能因资产数量增长在同一schema下静默增加Vault。
- 跨层产物：canonical ABI、权限矩阵、compiled/product artifact、AllocationManager、Web构造器和链上读取、Indexer事件与`assetUid+user+marketId`投影键、execution manifest及文档已同步；十九模块product manifest hash为`0x7d067fd53b7d187920bba90ce4fb44bd4c47dd9bc51de938d84b45cb52e520dc`。
- 验证：完整Foundry为61 suites、668/668，状态化Invariant为256 runs、128,000 calls、0 revert；Python机器规格59/59、Indexer 17/17、Deployment 23/23、Web unit 31/31与Sites 4/4通过。目标链archive Fork、真实部署manifest、AccessManager安装、浏览器E2E、独立审计与灰度观察仍不得由本地结果替代。
