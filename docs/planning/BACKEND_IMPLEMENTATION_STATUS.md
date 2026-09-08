# Go 后端实施与验收记录

第一版范围更新（2026-09-06）：用户明确 B11、B12、B13、B14、B16 为必要功能，必须完成后上线。详见 [第一版范围](BACKEND_V1_RELEASE_SCOPE.md)。原 P1 标签仅表示开发顺序，不表示这些项可从第一版删除。

目标：逐一完成后端架构方案的全部后端服务任务。本文记录当前证据，不把子模块通过测试等同于全部完成。

范围以 `BACKEND_REQUIREMENTS_AND_ARCHITECTURE.md` 的 B01–B19、M0–M5 和 V1 canonical spec 为准。P2 也保留在目标中；B19 仅贡献分析，不包含发行代币。现有 TypeScript 用于测试对照，不作为 Go 服务隐藏运行时。外部网络部署、资金操作、Root 发布与审核仍遵守对应权限/批准边界。

## 当前逐项状态（B11–B16 最近核对：2026-09-07）

| ID | 已有实施证据 | 未完成的验收工作 |
| --- | --- | --- |
| B01 | Go chainId 配置、journal 创世块绑定；hash-pinned runtime 核验；Factory/Registry/Quote Registry 的 14 项核心绑定核验与 CLI | 真实部署清单、动态实例/路由/实现模板/权限完整核验、能力 API、多网络实际证据 |
| B02 | chainrpc + journal；逐交易回执与 filter 交叉核对、SQL 回执、历史补核对；Factory/Registry 历史块市场发现；持久游标/原子批次/主链视图；Registry 认证的资产/Vault 动态绑定；独立持续 worker | receipt root 密码学验证（若采用该信任模型）、Locker/Hook 发现、真实部署起始范围验收 |
| B03 | 原始主链重组；快照 schema/来源校验；77 个 ABI 事件严格解码；Go 业务事实投影内核、增量行与持久 worker；市场/曲线/Gauge/Vault/FeeVault/Holder Treasury 区块末补读；已发现 Vault 账户每块刷新及合计检查；本金、负债与偿付局部检查；Quote/Baseline/Template 完整配置补读；PoolKey/路由与毕业 Hook/Locker 观察；TS 逐步对照 | 完整补读探针、独立对账、自动 publication |
| B04 | 五类 GET 中市场/配置；revision 分页、TS golden 对照 | 自动目录输入、metadata 展示信息与身份绑定 |
| B05 | Go 内容服务、完整图片解码/像素限制、共享配额、原子存储、历史导入工具、本地备份恢复演练 | 生产历史库存迁移、用户所有权/细分配额、对象存储/CDN 和生产恢复验收 |
| B06 | Go 仓位 DTO 与快照不变量；Gauge 仓位/激活快照与 Vault 本金/市场 allocation/退出截止点补读；账户本金快照与 GET /v1/users/{address}/accounts、生成 SDK | 完整覆盖与独立总和对账、账户自动快照生产/刷新失效联动、钱包页面闭环 |
| B07 | Go Quote/Meme 领取 DTO；Creator 历史 epoch 受益人/双资产负债补读；FeeVault 四角色负债与余额局部检查 | Holder epoch、完整角色/资产收益账本、历史领取、独立自动对账 |
| B08 | TS conversion planner 与事件目录；Go 用户/历史 Creator 候选规划、报价摘要与 TS golden/独立 CLI；固定新鲜区块的权限/奖励额度观察及实时候选/报价绑定、固定调用模拟与假设退款分配、直接转换路径身份认证及同块池状态读取、FeeVault 资产覆盖检查、签名参考价策略核验与有界 HTTP 获取、完整核验证据本地原子留档及数据库记录/分页查询、链上路径自动报价与重新模拟/参考价核验、持久核验任务及独立后台调度、固定交易意图/角色隔离/nonce 与费用准备、签名前新鲜授权/一次性外部签名及未知结果恢复、提交前独立新鲜授权与持久单次发送、回执规范性/最终性观察与审计历史、最终回执事件与签名批次匹配、交易调用跟踪及根返回值绑定、Gauge 拉取/退款调用金额与全 Staker 分配公式核对、编译布局及部署代码双重绑定的 Creator 负债差异/实际拉取与混合批次公式核对、FeeVault 四角色桶与跨市场总负债净变化核验、Gauge 克隆/实现及参与者仓位、全局激活表/总量与激活快照存储核验、cohort 与全局余量/递延没收变化核验、ERC-20/native 余额净变化与负债覆盖核验 | Go 实际 settlement worker、观察与执行绑定、独立价格校验、批次/原币退出表与 API、退款验证 |
| B09 | Go Treasury DTO；Holder/Treasury 状态观察；Go TWAB/尾差分配/Merkle 候选数据集计算；journal Transfer 读取与候选命令 | 普通 Treasury 注册发现、完整领取/服务 credit 历史、完整 Transfer 数据供给、proof HTTP、独立对账与 root 任务 |
| B10 | TS maintenance 核心；Go 固定调用模拟、租约、nonce、意图与签名保存，以及 fresh simulate 后持久化单次提交、回执历史、RPC 最终性观察、显式原交易重发及五类后置状态验证、已提交任务自动巡检及显式范围去重及全市场/已投影账户持久扫描及原子交易准备及后台调度及外部签名器适配及固定意图授权恢复/未知结果导入及持久自动签名/提交调度及累计 Gas 提交预算/最终回执执行 Gas 费用观察及后台调度 | 费用替换/取消、完整费用对账、生产签名设施与完整运行验收 |
| B11 | 全目录名称/symbol/地址/STOCK/阶段/时间查询；ID、创建时间、名称、阶段排序及条件绑定稳定分页；市场页改接服务端查询；130 条完整页面分页/搜索/故障恢复；排序键预计算及 5 万条内存基准；快照身份批量 SQL 校验、有限字节校验缓存与 5,000 市场 PostgreSQL→HTTP 全目录分页/八路并发/失效恢复验收 | 持续负载与数据库读取/索引优化、自动快照生产和真实部署数据验收 |
| B12 | Curve/Pool 精确金额与价格、来源与费用配对；完整历史范围和内部兑换关联；分页成交活动及 K 线 HTTP/SDK；无成交桶与费用口径；交易页组件及受控浏览器验证；Curve/Pool PostgreSQL→HTTP→SDK/前端校验、24 小时空桶与覆盖失效恢复 | 完整交易页与真实部署/RPC 联合验收、长期历史和生产负载；用户身份活动不能把 Pool sender 当作钱包 |
| B13 | STOCK/Quote 成交、费用与小时序列聚合；同快照数据库读取与 HTTP/SDK；市场持有人重建分页、全局/按 STOCK 地址去重及协议排除；首页/统计页/交易页组件；真实 PostgreSQL→HTTP→前端 SDK/校验器验证 overview、holders、24 小时 series 及不完整历史 503；正式统计页 130 市场、三类统计及故障清空/同 revision 恢复浏览器验收；首页市场链接与全局统计故障恢复 | 交易页完整成功与重连联合验收、生产负载及全量历史重建性能验收 |
| B14 | Go RH REST 展示参考价适配器、后台缓存及 HTTP 查询；OpenAPI/SDK、来源/时间/过期/null、定点 multiplier 一次性计算；创建/交易页提示 | 生产价格提供方与运行验收；正式创建/交易页受控 Go 配置/价格、RPC 元数据及失效恢复已验证 |
| B15 | 用户事件归属内核、活动持久索引（迁移 66）、完整批次/回执校验读取与分页 HTTP/SDK；原始日志/回执；五类交易状态及执行结果内核；创世块/新鲜度/主链/回执摘要绑定的数据库读取；RPC 待打包/入块查询及一致性协调；交易状态 HTTP/SDK；数据库+受控 JSON-RPC HTTP+正式 API+SDK 联合验证 | 补齐命令的真实部署历史验收、真实提供方/重组及生产负载验收；Rewards 活动页已接入，尚未完成真实钱包联合验收 |
| B16 | 更新轮询 HTTP/SDK、代次隔离、过期 reset、分页恢复与 PostgreSQL 新鲜度/窗口测试；统计组件请求合并与暂停；活动页独立 revision 轮询、分页保留/失效及失败退避；正式市场页通过 Go 故障夹具验证清空旧卡片和同 revision 补读；正式统计页同 revision 故障恢复及旧汇总清理；首页旧卡片清理与恢复、poller stop/start 完整重读；PostgreSQL publication→HTTP→SDK 的受控分支失效与重新发布恢复 | 真实 publication/链重组、多页以及钱包切换、交易/奖励页联合验收 |
| B17 | 进程分离、日志、探针、API 请求 Prometheus 指标、Go CI、临时 DB 测试、内容本地 pg_dump/restore 演练 | 任务/索引指标与告警、任务审计、生产备份恢复验收、负载/故障演练、角色监测 |
| B18 | 无 Go 私有账户模块 | 钱包所有权验证、偏好/运营内容及权限隔离 |
| B19 | 原始链历史 | 版本化贡献分析、finalized 限制、申诉记录；不发币 |

## 验证证据与限制

上一阶段可复验命令：`make -C services/backend-go verify`、`contract-check`、`ANVIL="$HOME/.foundry/bin/anvil" make -C services/backend-go smoke-chain`。覆盖原始链日志、快照发布、API 查询和 TS 响应相容性；不覆盖自动业务对账、交易 workers、Treasury 或完整前端流程。

Go 服务实际使用的部署清单/历史起点与网络运行配置尚未冻结；仓库已有 Arbitrum Sepolia 部署/激活材料，尚未作为 Go 生产运行输入完成验收。可继续实现本地验证和配置校验，不能生成虚构部署地址或把 runtime template hash 当部署 runtime hash。Docker/远端 CI、生产数据库与 RPC 运行验收也不能由本地测试替代。

所有阶段仍待整体验收：M0 未冻结真实部署输入；M1 尚缺自动投影/对账；M2–M4 尚有上述业务缺口；M5 尚未切换/负载/备份/全链路验收。保持完整目标，不将“兼容 GET”或“原始日志可采集”重新定义为全部后端完成。

2026-09-06 新验证：77 个事件全部模块解码、uint256 与 signed padding、按块固定状态读取、runtime codehash 错误拒绝；真实 Anvil + PostgreSQL/CLI 回归通过。此解码与核验层尚未连接成自动业务投影流水线，B01/B03 仍不标记完成。工作区新增 Arbitrum Sepolia（421614）与第 4 个迁移，已对齐新 identity 校验与烟测。

2026-09-06 回执链路：新迁移保存交易身份/状态/日志及 receipts_verified 标记；逐块读取全部交易回执，与 eth_getLogs 对照；历史补核对不移动索引高度，发现不一致不静默修复。快照覆盖区间缺回执核对时不宣告 synced。动态发现、自动业务投影与独立业务对账仍未完成。

2026-09-06 核心部署关系：新增 `verify-deployment --core-bindings`，在代码身份核验后按同一 finalized hash 检查 14 项关系，并重查 canonical 区块。逐边错配、缺失/歧义模块、零地址/脏 padding/异常长度、RPC 失败及观察后重组覆盖于测试。该范围单独输出 `coreBindingsVerified`，不把它提升为完整 `protocolBindingsVerified`；没有对 stakingEnabled=false 市场施加非零 gauge 要求，市场实例发现仍未实现。

本轮验证通过：`make verify`（格式、vet、race、所有命令构建）、`make contract-check`、`ANVIL=/Users/dear/.foundry/bin/anvil make smoke-chain`（隔离 PostgreSQL、迁移、API、索引器、发布器、合成 EVM 核心绑定 CLI 正反例）、Linux amd64 无 CGO 构建、`git diff --check`、V1 boundary 检查。没有运行远端 CI、Docker 或真实协议部署验收。

2026-09-06 市场发现：`verify-deployment --discover-block BLOCK_HEX MANIFEST` 针对 finalized 历史块执行核心绑定、回执完整性检查、Factory 创建事件与 Registry 20 字段记录/反向 Token 索引对照，观察 Token/Curve/可选 Gauge 实例 runtime hash。记录是区块末状态，支持无质押与同块毕业；实例权威来自已绑定 Factory/Registry，而非自行把观察到的代码哈希认定为源码审计证据。尚未接入持久游标及自动投影，B02/B03 保持未完成。

市场发现验证：Go race/vet/build、事件/DTO/TS API 生成对照均通过；MarketView 字段顺序直接对照编译 ABI；覆盖质押开关、同块毕业、伪造 emitter、事件/记录/反向索引错配、实例地址复用、空代码、异常 ABI 和末次重组。隔离 PostgreSQL/Anvil 烟测通过真实交易回执中的合成 Factory 日志驱动 CLI 发现，并验证空结果及未 finalized 高度拒绝。保留合成测试与真实协议部署验收的区别。

2026-09-06 持久发现：第 6 个迁移新增 checkpoints/batches/markets 和主链视图；discovery-worker 支持 once/run，以独立数据库凭据读取 journal 的 finalized 区块，冻结清单指纹与起始高度。共享链锁串行化索引、发现、发布；来源比对、跨块市场身份去重、批次与游标原子提交。重启续跑，finalized checkpoint 失效硬停止，孤块记录保留但不进入主链视图。没有自动重建或跳过出错块。

本轮实测：6 个迁移幂等；Go race/vet/build、生成对照、Linux amd64 构建通过；隔离 PostgreSQL/Anvil 覆盖共享锁 busy、新进程续跑、来源错配回滚、跨块重复身份拒绝、清单重排与修改、主链失效视图、空闲幂等及 SIGTERM。CI 已加入此 Anvil 持久发现烟测，但远端 CI/容器仍未运行。自动财务投影与对账、其余 B01–B19 缺口仍保持未完成。

2026-09-06 Go 事件投影内核：internal/projection 移植现有 TypeScript projector 的业务事实规则，覆盖配置/市场、仓位事件、退出状态、费用记录与 Swap/Hook 配对；其余已知事件保留事实记录。精确重复幂等，重复来源或观察变化拒绝；暂存行在全部语义/观察检查成功后才提交，失败不会留下部分事件。Replay 重建调用者选定的主链事件序列；仍由调用者负责地址身份与主链分支选择，尚未接入持久 worker、自动补读、独立对账及 publication。

投影验收对照生成器执行真实 TS applyV1Event，逐步比较全部表并覆盖 77 个签名。provenance 按已声明接口规范化，去掉 TS runtime spread 附带的未声明 args/signature/observations；事件事实中的参数和签名仍完整比较。另覆盖最大 uint256、负数 Swap、多 Swap 配对、退出顺序、观察失败回滚、来源冲突/乱序/混链及回放一致性。业务事实不是已对账余额，不把本轮标记为完整 B03 或 M1。

本轮验证通过：94 步 TS/Go 中间状态对照、Go 全量 race/vet/build、全部生成文件检查、PostgreSQL/Anvil 原有链路回归、Linux amd64 全包构建及 V1 boundary 检查。集成烟测尚不驱动新的投影内核；数据库投影 worker 接入仍是下一项开发工作。

2026-09-06 持久投影：第 7 个迁移新增 projection_inputs/rows/checkpoints 与主链视图；projection-worker 在 discovery 完成后认证当前区块 emitters，处理 ABI 事件和市场身份补读，原子提交输入/变化行/游标。按清单、起点与投影版本冻结范围；重启检查输入摘要/数量/原始日志并回放，持续进程复用缓存，区块失败丢弃缓存。所有表仍是业务事实，不代表已对账余额，不自动发布 API 快照。全历史恢复内存与吞吐仍需 M5 验收。

持久投影验收通过：7 项迁移与幂等重跑、94 步增量行重建对照、Go 全量 race/vet/build、生成文件对照、Linux amd64 无 CGO 全包构建、V1 boundary 与 diff whitespace 检查。隔离 PostgreSQL/Anvil 烟测实际驱动 projection-worker，覆盖区块内后续事件失败后的整块回滚、新进程回放、输入摘要和数量异常拒绝、空闲幂等及 SIGTERM；发现、索引、快照发布和 API 的完整本地烟测最终通过。烟测使用新 finalized revision 刷新合成快照，保留生产过期保护；此合成快照不代表投影已自动完成财务对账。远端 CI、Docker 与真实协议部署验收未运行；下一阶段仍需完整状态补读、独立对账及自动 publication。

2026-09-06 区块末补读：`market-curve-v1` 范围按块去重刷新认证事件触及的市场和发出事件的 Curve。市场不可变字段、反向 Token 身份与发现记录校验；允许正常毕业但拒绝已毕业发现记录的运行态倒退。曲线读取十项 getter，区分含 phantom 的价格储备与实际 Quote 储备，检查 Quote/Creator tax 绑定。第 8 项迁移独立保存带区块身份的观察批次与结果，固定应读/实读数量、范围和摘要；与事件事实及游标同事务提交，不将末状态重复应用到同块交易。投影版本提升为 v2-market-curve，旧版本需独立重建验证后切换，迁移不删除历史。

该补读范围仍不覆盖 Vault/Gauge、FeeVault、完整 PoolKey/配置、时间驱动刷新和独立财务对账；不自动发布 synced 快照，B03/M1 保持未完成。

区块末补读验收通过：Go 全量 race/vet/build、Linux amd64 无 CGO 构建、生成文件对照、V1 boundary 与 whitespace 检查。新增测试覆盖按块去重、最大 uint256、正常毕业、已毕业状态倒退、不可变身份/反向索引/Quote/税率错配、非法 ABI、未知 emitter、空块及末次重组；错误不返回部分观察。隔离 PostgreSQL/Anvil 全链路烟测通过 8 项迁移、补读失败后的事件与观察整块回滚、观察数量/主链视图、重启回放、API 就绪状态和 SIGTERM。曲线 getter 正反例由 Go RPC fixture 验证；Anvil 持久链路本轮驱动市场补读，尚不等于真实协议的完整财务验收。远端 CI 与 Docker 未运行。

2026-09-06 Gauge 补读：当前 `market-curve-gauge-v1` 范围覆盖事件触及的启用质押市场，验证发现记录 runtime hash 与 GaugeIdentity 的七项绑定。独立保存 stored/effective active、pending 总量、双资产奖励累积器与 deferred forfeiture；有 user 的市场事件补读 positionOf，pendingGeneration 对应 activationSnapshot 按代去重。存储 active 与合约预览 claimable 保持不同语义，不将 Gauge 奖励权重提升为 Vault 本金。第 9 项迁移扩展观察类型，投影版本为 v3-market-curve-gauge；旧版本继续通过独立重建和验证切换。

本轮 Go 全量 race/vet/build、Linux amd64 构建、生成对照及原有 PostgreSQL/Anvil 链路通过。新增测试覆盖七项绑定错配、runtime 变化、跨市场事件、ABI 溢出/非法布尔、晚期 getter 失败、uint256 上界、用户和激活快照去重，并直接对照编译 manifest 的 GaugeIdentity/PositionView 顺序。仍缺 Vault 本金/偿付读取、FeeVault 独立对账、跨空块/时间刷新和自动 publication，B03/B06 不标记完成。

Gauge 持久链路验收：新增 make smoke-gauge，启用质押的合成 EVM Getter fixture 经真实 Anvil 交易发现并由 projection-worker 保存 Gauge 观察，核验 stored/effective active 区分、uint256 累积器和未虚构用户仓位。该场景与无质押 smoke-chain 最终均通过；CI 已配置两条轨道，远端 CI/Docker 尚未运行。用户仓位与激活快照本轮由 Go RPC fixture 覆盖；真实协议 Gauge 全链路与独立财务对账仍待后续验收。

2026-09-06 Vault 本金与偿付：第 10 项迁移扩展 asset/vaultSolvency/vaultPosition/vaultMarket/vaultAllocation 观察。Registry 认证的历史资产配置、当前注册事件和市场 UID 共同确定资产范围；注册和首次存款同块时先解析 Vault 身份，再认证其日志。检查 AssetRegistered 的 token/Vault/decimals、Registry identity-current、v6 schema 正反向映射、四字段依赖、Vault/Token runtime hash；资产身份绑定 chain/blockHash，不能跨块复用。资产 fingerprint 的 beacon/implementation 模型沿用已认证 Registry 的历史判定，没有提升为独立源码审计。

每块包括空块刷新已知资产总存入/总分配/实际 Token 余额、已知市场分配/有效奖励权重/cohort epoch。用户事件触发 deposited/allocated/free、市场 allocation 与 rage-quit 截止点读取。大整数局部检查显式记录成功或失败；偿付不足不抹去风险证据，RPC/身份/ABI 异常回滚区块。全用户/市场总和对账尚未完成，fullReconciliation=false，也不自动发布 synced。逐块读取量随资产/市场范围增长，M5 吞吐和超时预算仍待验收。

合成 EVM 夹具修正：返回数据移至全部执行代码之后，避免数据末尾 PUSH 字节使后续 JUMPDEST 无效；依赖错配测试改用两项相同 STOP runtime 的配置根，保留代码身份通过但关系不通过的原测试意义。生成对照发现新增管理员操作文档引起来源指纹更新，77 项事件本身无变化。

Vault 阶段最终验证：Go 全量 race/vet/build、Linux amd64 无 CGO 构建、10 项迁移、smoke-chain/smoke-gauge/smoke-vault 三条隔离 PostgreSQL/Anvil 链路通过。无市场资产在同块注册与存款后可持久化用户本金，新进程在下一个空块继续刷新偿付观察。新增测试覆盖身份/schema/代码错配、暂停/退役读取、失败偿付检查留存、uint256 上界、晚期读取失败及跨块身份拒绝。工作区并行执行 TickerGarden 命名迁移时，已对齐后端测试 selector 与生成产物并重跑上述验证；后续仅文档/产物清单指纹变化另行刷新。远端 CI、Docker、真实协议部署和完整财务验收未运行。


2026-09-06 FeeVault 负债与 Creator epoch：第 11 项迁移增加 feeLiability/feeSolvency/creatorEpoch，范围升级为 market-curve-gauge-vault-fees-v1，投影版本为 V1-EXEC-11:business-facts-v5-fees。每块（含空块）刷新全部已知市场的四角色 bucket 与 forfeitureReserve，准备金仅计一次；按资产比较已知市场总和、totalLiability 和真实余额。原生币与 ERC20 余额固定 blockHash，全部金额使用大整数。Creator Registry 绑定与历史受益人经核验，各 epoch 双资产负债之和与 Creator bucket 比较。

单块跨市场 Creator epoch 总预算为 1024，超过时失败且不提交部分结果，后续需分页任务及负载验收。财务检查失败保留风险证据，RPC/ABI/身份/区块一致性失败回滚事件、观察及游标。Holder epoch、完整市场覆盖、独立财务对账和自动 publication 仍未完成，fullReconciliation=false，B03/B07 不标记完成。旧投影版本需独立重建验证后切换。

FeeVault 阶段最终验证：Go 全量 race/vet/build、Linux amd64 无 CGO 构建、生成对照、11 项迁移、smoke-chain/smoke-gauge/smoke-vault 三条隔离 PostgreSQL/Anvil 链路、V1 boundary 和 whitespace 检查通过。覆盖历史 epoch、准备金计数、偿付不足、原生余额编码与禁止 latest 回退、失败回滚和重启恢复。生成清单刷新前确认仅部署门槛文档来源指纹变化，77 项事件未变；远端 CI、Docker、真实协议部署与完整财务验收未运行。

2026-09-06 Holder/Treasury 观察：第 12 项迁移、v6-holder 投影版本接入创建时启用 Holder 分成的已知市场。Factory/Registry/Token/Treasury/FeeVault 关系与 Token 发现代码身份核验后，每块读取当前与历史 epoch、窗口、root/请求/领取状态、双资产 Holder 负债；Treasury 入账扣除已领取金额，已滚存旧 epoch 计零，Quote 与服务费总负债共同检查余额。财务失败检查保留证据，RPC/ABI/身份或区块变化回滚整块。

Holder epoch 每块总预算 2048，超限失败而非部分求和。普通 Treasury 市场、重置 epoch 后不可从当前视图枚举的旧服务费资产、完整 service-credit 用户/领取账本、Transfer 历史与 TWAB/Merkle/proof 仍未完成；fullReconciliation=false，B03/B07/B09 均不标记完成。smoke-holder 已通过隔离 PostgreSQL/Anvil 链路；最终检查结果见下文。


工作区 Treasury 源码同期将周期从 30 天改为 7 天，并改用 TRANSFER_LOG_TWAB_7D_V1。检查确认事件 ABI 未改变，但属于实质性周期/schema 变化；观察器读取并保存链上 EPOCH_DURATION/TWAB_SCHEMA/currentEpochId/epochWindow，不硬编码周期或由服务端时钟推断 epoch。此轮仅记录这些输入，尚不生成 Merkle proof。

Holder 阶段最终验证通过：Go 全量 race/vet/build、Linux amd64 无 CGO 构建、生成产物对照、12 项迁移、smoke-chain/smoke-gauge/smoke-vault/smoke-holder 四条隔离 PostgreSQL/Anvil 链路，以及 V1 boundary/whitespace 检查。新增测试对照 Treasury 编译 ABI 字段，覆盖 CLAIMING/ROLLED_OVER 剩余金额、Quote+service 共同偿付、历史服务费资产、失败检查留存、绑定/代码错配、非法 status/原生余额、预算超限、晚期失败和区块变化；Holder 烟测验证新进程在空块继续刷新两类历史观察。远端 CI、Docker、真实协议部署验收与完整财务对账未运行或未完成。


2026-09-06 Treasury 计算内核：Go treasury-worker 新增 --input 本地候选计算，规范整数/策略/窗口/source 验证，Transfer 顺序与窗前余额重建、7 天时间加权余额、确定性最大余数分配、零分配过滤、排序 Merkle proof 和合约双重叶子域哈希。dataset hash 按 TS 规范字段顺序和十进制格式编码。输入显式 reviewed-rollover 才允许空资格输出；该选项并不是历史完整性证明。CLI 输出 candidate_unverified_history，始终不声称历史已核验或允许交易提交。

六组真实 TypeScript oracle 对照和 Solidity ClaimLeaf 执行通过，新增数值溢出、缺失余额、重复日志、同块时间冲突、越过 source、策略/窗口错误、边界时刻、顺序确定性、proof 跨 epoch 重放、严格 JSON 和 CLI 测试。计算功能已实现，但从发行起的完整 canonical Transfer 数据源、持久请求队列、数据集/审查存储、proof API 和 publisher/reviewer 流程未接通，B09/M3 仍未完成。

Treasury 计算阶段最终验证：Go 全量 race/vet/build、Linux amd64 无 CGO 构建、生成文件对照、6 组 Solidity ClaimLeaf 执行、现有 TypeScript 8 项测试、V1 boundary/whitespace 均通过；实际编译的 treasury-worker 二进制对全部 6 组输入输出与 TS oracle 一致。此次不改变数据库或链索引语义，未重复上一阶段四条数据库烟测。生成 catalog 刷新前确认只有 docs/v1 文档来源指纹变化、事件 ABI 未变。远端 CI/容器未运行，计算结果仍是未核验历史的候选数据集。


2026-09-06 链上时间基础：第 13 项迁移新增可空 block_timestamp；RPC Header 与按 hash 获取的回执区块核验时间一致性。索引器优先补读旧主链缺失时间，不用数据库/墙上时间补造，不推进 tip，回执和日志一致后同事务提交。已记录时间漂移、相邻块时间倒退或晚期读取变化失败。discovery/projection worker 仅处理时间已补齐的块，并从 journal 传递时间到核验链路。该输入尚未接成 Treasury 完整 Transfer 数据集，B09/M3 保持未完成。

链上时间阶段验证通过：Go 全量 race/vet/build、Linux amd64 无 CGO 构建、生成文件对照、13 项迁移、四条隔离 PostgreSQL/Anvil 烟测、V1 boundary 与 whitespace。集成测试实际将旧行 timestamp 置空，验证重新读取、RPC 失败无部分提交、同 hash 时间变化拒绝、时间序列倒退拒绝且 tip 不变；RPC 测试覆盖缺失/非法 quantity/范围溢出与 receipt block 时间错配。远端 CI/容器及真实网络部署验收未运行。


2026-09-06 Treasury journal 输入链路：treasury-worker --journal 使用独立只读 DSN，从一致性快照载入 canonical Transfer 并接到 Go Generate。验证 finalized source、发现范围/唯一市场、MarketCreated 原始来源、连续区块时间、receipt 标记，双向比较目标 token 的回执与过滤日志，并要求创建交易中唯一初始 mint 至绑定 Curve。缺失初始发行不能当成空资格。输出 journalEvidence 记录范围和初始发行量；RootRequested/策略尚未链上核验，独立 receipt-root 证明未实现，historyVerified 仍 false，不具备发布授权。同步加载预算为 100 万块、10 万 Transfer、64 MiB，后续需持久分页/增量任务。

Treasury journal 阶段验证通过：Go 全量 race/vet/build、Linux amd64 无 CGO 构建、生成文件对照、隔离 PostgreSQL/迁移/API 烟测及 V1 boundary/whitespace。数据库测试覆盖两向 Transfer 缺失、两处均无初始 mint、缺时间/回执核验、错误 source/hash/time/token、断链及独占写锁冲突，失败不输出部分输入；--journal 命令使用独立连接实际输出与直接 Generate 相同的 root，并保留 historyVerified=false。未改索引器、合约或观察语义，本轮没有重复四条 Anvil 烟测；远端 CI、容器和真实协议部署验收未运行。


2026-09-06 Treasury 请求状态核验：新增 --request-manifest（要求 --journal），固定 finalized 区块验证显式清单中的 Treasury runtime、Factory/Registry 绑定、canonical 市场、REQUESTED 状态/资金/有效 publication window、epoch 窗口与历史 source。候选所有 claim-domain 字段、金额、时间与 exclusion policy 和链上快照匹配后输出 requestEvidence，journalEvidence.rootRequestVerified=true；仍无交易提交或发布授权，historyVerified 保持 false。发布时需要另做 fresh simulation 和审查，持久任务/数据集/proof API 未接通。

Treasury 请求核验阶段验证：Go 全量 race/vet/build、Linux amd64 无 CGO 构建、生成文件对照、隔离 PostgreSQL 回归、V1 boundary/whitespace 通过。RPC fixture 覆盖显式 pin 缺失、runtime、status、过期、funding/source/hash/time 与晚期 reorg；候选对照覆盖全部 claim-domain 字段及 exclusion 列表错配。复用现有编译 ABI 字段对照。未在真实部署或新 Anvil 场景中完成 --journal + --request-manifest 全流程验收，远端 CI/容器未运行；后续持久任务与 proof 服务仍是未完成项。


2026-09-06 Treasury 候选持久化：第 14 项迁移新增 treasury_candidates，按完整 payload 摘要生成 ID，保存输入、root/proofs 和两层观察证据；--store 要求 --journal/--request-manifest 及独立写入 DSN。写入复算结果、核验来源，重复内容幂等且不覆盖。读取复核摘要/索引/计算，主链 source 或 request 失效则拒绝当前读取，保留历史记录。状态仍为候选，无 root 发布授权；自动队列、proof HTTP、审查和发布工作流仍未完成。

Treasury 存储阶段验证：14 项迁移、Go 全量 race/vet/build、Linux amd64 无 CGO 构建、生成对照、隔离 PostgreSQL 烟测、V1 boundary/whitespace 通过。实际数据库覆盖重复写入、重新读取、错误计算 root 拒绝、内容摘要损坏、索引损坏（包括幂等写入时拒绝）、请求块孤立后读取拒绝。--store 命令已接线，完整真实网络 request-manifest/store 流程尚待端到端验收；远端 CI/容器未运行，B09/M3 未完成。


2026-09-06 Treasury proof HTTP：新增前端约定的 /v1/treasury/markets/{marketId}/epochs/{epochId}/claims/{account}，通过 TG_TREASURY_PROOF_MANIFEST 可选启用。固定 latest block hash 验证部署和 CLAIMING 域，按链上 datasetHash 查询不可变候选，复算/比对 root、leafCount、TWAB、金额、来源与 policy；本地 Merkle 校验后读取索引和账户两道领取保护，检查剩余额度及晚期 reorg。返回 uint256 十进制字符串、proof[]、观察 blockHash/number；未进入 CLAIMING/已领取返回 409，窗口过期 410，缺失叶子/数据 404，配置/来源/节点异常 503，不返回内部异常信息。两个并发校验名额、10 秒查询预算及 120 秒 latest 新鲜度边界；不声称 latest 已 finalized，不能保证随后交易成功。

proof 阶段验证：Go 全量 race/vet/build、Linux amd64 无 CGO 构建、生成对照、14 项迁移与隔离 PostgreSQL/HTTP 烟测通过。数据库检索测试覆盖 chain/market/epoch/dataset 域隔离；完整服务 RPC fixture 覆盖 hash pinning、成功查询、两类已领取、领取耗尽状态、缺候选、失败/取消/过期节点及 late reorg；纯函数对照全部 6 组 Go/TS dataset，HTTP 测试覆盖 wire 字段、路由、状态码、CORS 和 no-store。现有 REQUESTED 观察回归通过。尚未完成真实部署的 request→publish→finalize→HTTP→claim 端到端验收；此次未运行远端 CI/容器或全仓无关合约/前端套件。独立完整历史证明、自动队列、reviewer/publisher 及其他 B09/M3 项目仍未完成。

2026-09-06 Treasury 持久任务：第 15 项迁移增加 treasury_jobs；新增 treasury-jobs 命令，支持冻结请求人工入队、状态查询、单次处理及持续运行。输入和完整 core/Treasury 清单规范化后生成不可变 job ID，重复入队不重置状态；worker 按 chain/manifest hash 隔离领取。数据库 120 秒租约、随机领取令牌、SKIP LOCKED 与带有效期的条件更新阻止旧进程覆盖新结果；60 秒处理预算、最多 5 次尝试、退避重试、过期最后一轮及损坏 payload 终止。处理路径已接到 finalized request 核验、journal 加载、Generate、候选存储及任务关联。任务 succeeded 只代表候选完成，不代表发布或历史独立验证。

队列阶段验证：15 项迁移、Go 全量 race/vet/build、Linux amd64 无 CGO 构建、生成对照与隔离 PostgreSQL/HTTP 烟测通过。真实数据库测试覆盖 8 个并发领取者唯一胜出、manifest 隔离、重复入队不重置、租约到期恢复、旧令牌失败/完成被拒绝、正确候选关联、错误请求候选拒绝、退避/5 次耗尽、最后一次崩溃恢复、payload 损坏隔离、处理器 RPC 失败持久化，以及 CLI 独立连接 enqueue/status。尚未完成真实部署的队列成功计算至链上发布/领取端到端验收；自动 RootRequested 入队、dead 运维修复、尝试审计历史、分页历史作业与 reviewer/publisher 仍未完成，B09/M3 及总后端目标保持未完成。未运行远端 CI/容器，本轮未改链索引器或合约，未重跑无关全仓合约/前端套件。


2026-09-06 Treasury 请求自动发现：第 16 项迁移新增 treasury_request_discovery，treasury-jobs --discover/--policies 从 canonical finalized journal 自动读取 RootRequested。成功回执唯一包含该日志、部署身份及当前请求字段匹配后，按显式 chain/market/policyHash/exclusions 清单入队。未知策略记 awaiting_policy、策略内容改变后可恢复，历史失效请求记 inactive；默认不授权空资格 rollover。最多 10 条/60 秒，链共享锁与 manifest 独占锁下将队列和发现记录原子提交；--run 重读策略文件并继续处理既有任务，RPC/数据异常不产生半批任务。

发现阶段验证覆盖实际 PostgreSQL + RPC fixture 的 RootRequested→未知策略等待→补充策略入队→journal 历史回放→候选持久化→任务 succeeded 全路径，候选 root 与直接生成一致；包含缺 receipt、事件/服务费矛盾、末次区块重组导致任务和发现记录一并回滚、事件幂等重放、已发布请求 inactive。该 RPC 使用固定 ABI 夹具，仍不是实际部署上的发布/领取验收；receipt-root 独立证明、尝试审计与 dead 修复、reviewer/publisher、运维负载验收及其他 B01–B19/M0–M5 未完成项仍需继续。


自动发现阶段最终验证：Go 全量 race/vet/build、Linux amd64 无 CGO 构建、事件/模型/API/投影/Treasury 生成对照、16 项迁移、隔离 PostgreSQL 集成与 HTTP/关闭烟测、V1 boundary/whitespace 通过。策略 JSON 重复键/未知字段/空与缺失数组/哈希错误、排序规范化、请求所有承诺字段及新 CLI 组合均有回归覆盖。未运行远端 CI、容器或真实部署发布/领取全流程；链索引器及合约未变，本轮未重复四条 Anvil 模拟链烟测。


2026-09-06 Treasury 任务审计与恢复：第 17 项迁移增加数据库事务内状态审计、恢复记录及 recoveryCount。新增 --history/--after 查询和独立 operator DSN 的 --retry；恢复绑定稳定 operation ID、理由及预期代数，校验冻结 payload/索引并重新核验 finalized 有效请求后原子复活。旧尝试完整保留，每代仍最多 5 次；重复操作幂等返回既有恢复结果，旧操作不能复活后续代数。数据库触发器拒绝缺恢复记录/错误代数的 dead→ready，并拒绝审计及恢复记录的普通修改/删除；登录 actor 从 session_user 取得。生产 DB owner/superuser 仍是显式信任边界，实际部署角色/权限验收尚未完成。

审计恢复集成测试在真实 PostgreSQL 中完成两轮耗尽、两次恢复后最终候选成功，25 项审计顺序保留；覆盖按游标读取、数据库 actor、审计不可变、直接复活拒绝、RPC/冻结输入错配拒绝、旧 lease 拒绝、操作幂等/内容复用拒绝、恢复版本冲突及 succeeded 拒绝恢复。RPC 仍为 ABI fixture，真实部署发布/领取、外部备份审计与独立 reviewer/publisher 仍待完成；总 B01–B19/M0–M5 目标保持未完成。

审计恢复阶段最终验证：Go 全量 race/vet/build、Linux amd64 无 CGO 构建、生成文件对照、17 项迁移、隔离 PostgreSQL/HTTP 烟测及 V1 boundary/whitespace 通过。新增 CLI 参数、Unicode 原因边界、独立 operator DSN 不回退及历史查询独立连接测试；未运行远端 CI、容器及真实部署恢复/发布验收。原任务尝试审计从第 17 项迁移生效，旧状态仅 imported，不能推断旧尝试已有明细证据。


2026-09-06 Treasury 审核与发布准备：第 18 项迁移保存新候选数据库作者及不可变审核决定；旧作者保持未知，不误记迁移身份。新增 treasury-review 导出输入/报告模板、独立复算比对、历史来源声明、审核 journal 再次重放及批准/拒绝记录。数据库登录隔离阻止创建者自审，review operation ID 使重试幂等并避免新观察块将旧批准重新排到拒绝之后。完整历史声明明确是 reviewer attestation，receiptRootVerified=false。新增未签名发布准备，要求最新批准与独立 publisher DB 身份，新鲜请求域、显式 publisher from 的 hash-pinned eth_call 和末次区块/审核复核；输出 simulated_unsigned，不进行签名/广播。

集成测试使用独立 PostgreSQL reviewer 登录验证身份隔离、过期观察/复算错配拒绝、批准后拒绝及旧批准重试不覆盖（包含观察时间改变）、记录不可修改、操作 ID 复用拒绝；发布准备覆盖模拟成功、同一 reviewer 拒绝准备、revert/晚期 reorg/最新拒绝阻止输出。全部 6 组 Treasury golden 新增来自实际编译 ABI+viem 的 publishRoot calldata 对照。发布/审核角色在真实 Safe/AccessManager 上的部署隔离、签名 transport/outbox、cancel/finalize 监控及真实部署端到端验收仍未完成，总目标保持未完成。

审核发布准备阶段最终验证：Go 全量 race/vet/build、Linux amd64 无 CGO 构建、生成文件对照、18 项迁移、独立 reviewer 数据库登录、隔离 PostgreSQL/HTTP/关闭烟测与 V1 boundary/whitespace 通过。RPC 单测确认只发送 hash-pinned eth_call、显式 from/value=0，零/非法 sender、revert 和非法返回均拒绝。新增 CLI 已构建并检查 help；本轮未调用任何公开链写方法，未进行真实部署广播、远端 CI 或容器验收。

### 2026-09-06 Treasury ROOT_PENDING 生命周期准备

- 增加严格的 pending epoch 观察，保留链上绑定、资金、历史源块和 canonical hash 校验；支持普通根和明确的空分配 rollover 根，publication deadline 不再错误限制 pending 阶段。
- 新增 `treasury-lifecycle` inspect/cancel/finalize CLI：等待时间与 finalize 结果观察、带显式 root/dataset/reason 的取消模拟、绑定最新独立批准及候选的 finalize 模拟；模拟后复查 canonicality 与审核。
- 不签名、不广播。持续监控/告警、交易 outbox、广播不确定性恢复及其他 B01–B19 未完成项仍保留；本阶段不构成完整 B09 或后端完成。
- 验证：`make verify`、`make contract-check`、Linux amd64 无 CGO 构建、隔离 PostgreSQL `make smoke`、V1 boundary 和 whitespace 检查通过。新增测试使用真实 PostgreSQL 审核记录和合成 RPC 夹具，覆盖等待期边界、审核拒绝、候选不匹配、未知根取消、过期观察、错误 sender、模拟 revert 与后置 reorg；取消/finalize calldata 与编译 ABI + viem 的六组向量一致。未验证公共网络广播、真实 AccessManager 执行或远端 CI。

### 2026-09-06 B05 Go 元数据服务实现

替换 content-worker 占位入口，提供独立 launch-metadata POST/GET 和健康探针。迁移 19 增加不可变内容对象与共享容量/小时配额，图片与 JSON 同事务写入、哈希检验、去重重试；支持完整 PNG/JPEG/WebP 解码、字节和像素限制、上传并发限制、精确 Origin、严格字段类型与重复字段拒绝。新增 x/image v0.45.0 解码依赖。

B05 尚未全量完成：存量 TS 内容迁移、生产备份恢复演练、用户所有权/细分配额、对象存储/CDN 适配与部署验收仍需继续；没有切换前端生产流量。B01–B19 总目标继续保留。

本阶段验证通过：`make verify`（vet/race/build）、`make contract-check`、Linux amd64 无 CGO 构建、迁移 19 的隔离 PostgreSQL 回归与 `make smoke`。新增验证包含真实 PNG/JPEG/WebP 与截断图片拒绝、重复字段/错误类型、跨连接持久读取、八路重复写入仅计费一次、容量不足整笔回滚、小时限额、不可变 SQL 约束，以及 content-worker 实际进程上传/重启取回/SIGTERM。修正了子代理测试中用重复字段掩盖非法字段值的案例。V1 boundary 与 whitespace 检查通过；没有运行远端 CI 或生产恢复演练。

### 2026-09-06 B05 历史内容导入及本地恢复链路

增加 `content-import` CLI，预览逐文件清单后以摘要绑定原子导入；严格文件哈希、完整图片、JSON 语义和同 origin 图片引用校验，保留 JSON 原始字节及已存在 URI。迁移 20 增加不可变导入审计，记录数据库操作者；共享配额和提交不确定性幂等重试适用。目录限制 1000 个文件/128 MiB，拒绝未知文件、符号链接、缺图、摘要漂移。

本阶段增加真实本地 pg_dump/pg_restore 到新数据库的恢复路径，验证内容进程重启及恢复后原 URI 对应的 JSON/图片字节；不等于生产历史库存已经迁移，也不等于生产备份/RPO/RTO 已验收。B01–B19 与生产切换、用户所有权/配额等未完成项继续保留。

本阶段最终验证：Go 全量 vet/race/build、contract-check、Linux amd64 无 CGO 构建通过；20 项迁移及真实 PostgreSQL 导入/上传混合并发、配额失败原子回滚、审计幂等与 actor/不可变约束通过；独立 CLI 预览/两次同摘要导入、pg_dump/pg_restore 新库、恢复后 JSON/图片原 URI 字节一致验证通过。修复导入/上传锁序反转风险，内容事务在对象写入前统一加事务 advisory lock。子代理测试已复核，符号链接案例改为独立目录目标，避免被无关未知文件拒绝掩盖。V1 boundary、whitespace 检查通过；未运行生产导入、远端 CI 或生产灾备验收。

### 2026-09-06 B11 市场目录查询基础

现有市场快照支持按 STOCK assetUid、marketId、memeToken、launchPhase 进行 AND 筛选，先查全目录再分页；支持稳定 marketId 升降序，游标绑定规范化条件、排序与 revision。Go/TS 实现和 OpenAPI 2.1.0、版本锁、两端生成客户端同步，新增枚举与整数参数的客户端运行时校验。旧默认排序/assetUid 游标兼容；未知和重复查询参数拒绝。

B11 保持未完成：当前可信市场 DTO 尚无 meme 名称/symbol/创建时间，后续需补链上投影来源后实现相关搜索；统计排序还依赖成交/价格投影。当前全目录查询仍读取已发布完整快照，没有改成 PostgreSQL 搜索索引；大目录性能验收与自动快照发布仍待继续。

本阶段验证通过：Go 全量 verify/contract-check、20 项迁移与内容恢复 smoke、Linux amd64 无 CGO 构建；TS backend 24 项测试、前端全套测试/类型检查/构建；Go/TS 新查询结果与降序 cursor 字节的差分向量、错误响应 schema 验证、130/150 条完整目录筛选与无重复遗漏分页、条件与排序切换拒绝。复核并加强了子代理测试，确保 late market 确实位于第 100 条之后、组合筛选非空且有准确结果数量、升降序跨页顺序实际验证。V1 boundary 与 whitespace 检查通过。前端构建仅有既有大 chunk 提示；未切换界面搜索行为或部署。

### 2026-09-06 B11 链上名称与部署时间观察

新增 `ObserveMarketIdentity` 与 `verify-deployment --market-identity`：以 finalized/hash-pinned 核心部署、Registry 市场/reverse lookup 和 token marketId/factory 为身份链，读取 name/symbol/metadataURI/deployedAt，记录 token runtime hash，最后复查 canonicality。新增有界严格 ABI 动态字符串解码，拒绝 malformed offset/length/padding、非法 UTF-8 与 bytes32 冒充字符串；不读取远端 metadataURI。

B11 尚未完成：本阶段提供可运行的链上观察命令，尚未接入持久化投影、版本化 DTO 和名称/时间目录查询。已部署 token 超出当前显示字段预算时会显式失败，不能当作空名称继续。整体 B01–B19 目标仍保留。

本阶段验证：Go 全量 vet/race/build、contract-check、20 项迁移/内容备份恢复 smoke、Linux amd64 无 CGO 构建通过；严格字符串解码覆盖空串、UTF-8、32/33 字节边界、65536 字节最大预算、超限/截断/填充/offset/长度字高位拒绝。观察测试覆盖 Registry reverse、token market/factory 错配、空 runtime、异常 name/URI ABI、未来 deployedAt 和最后 getter 后重组，失败无部分结果。V1 boundary/whitespace 通过。这里的链调用验证使用合成 RPC；未声称真实部署身份已通过，也未发布新增字段快照。

### 2026-09-06 B11 市场身份持久同步

新增 market-identity-worker --once/--run，按现有 discovery manifest 与 finalized journal 对缺失市场逐个补读创建区块身份。迁移 21 提供不可变市场显示信息、SHA-256 payload 摘要及 canonical 视图；部署时间必须等于创建块时间，token/runtime 必须匹配发现记录。内部 LoadAt 按 snapshot block hash 限制创建时间并验证摘要与索引，拒绝不可用/失效来源。无需 latest 回退或远端 metadataURI 获取。

B11 尚缺版本化 DTO、快照发布接线和 HTTP 名称/symbol/创建时间搜索，以及数据库搜索索引/统计排序；不能把这个来源层同步命令称为完整搜索服务。其他 B01–B19 未完成任务保持原范围。

本阶段验证通过：全量 Go verify/contract-check、Linux amd64 无 CGO 构建、21 项迁移及内容备份恢复 smoke；真实 PostgreSQL 配合 RPC 夹具验证创建时间错配不落库、重复 Step idle、链锁 busy、按快照读取、未知/旧快照拒绝、manifest scope 切换隐藏、孤立区块隐藏及不可变约束。market-identity-worker --describe 已验证。payload 上限预留 JSON 控制字符转义膨胀。V1 boundary/whitespace 通过；未运行真实部署 archive RPC 同步，也未发布带名称字段的新快照。


### 2026-09-06 B11 身份快照与名称/时间 HTTP 查询

OpenAPI 2.5.0 增加向后兼容的可选 identity，Go/TS/两端 SDK 同步。publish-snapshot 可显式补全全目录，既有 identity 不允许覆盖错配；发布在链锁内再次检查 canonical 来源，读取时失效来源不能继续宣告可用。HTTP 支持名称/symbol/标识符字面子串、含端点创建时间区间、时间升降序及同时间 marketId 升序；查询条件绑定游标，完整目录缺身份返回 503。

本次完成上述接线，不代表 B11 或全部后端完成：数据库搜索索引、大目录性能、统计排序、自动对账快照生产和线上切换仍待继续。旧快照和 ID 查询保持兼容。

本阶段验证通过：Go 全量 race/vet/build、生成契约检查和 Linux amd64 无 CGO 构建；真实 PostgreSQL 的身份补全、伪造拒绝、发布读取与 manifest 失效测试，以及 21 项迁移/内容备份恢复 smoke；TS backend 26 项测试及构建、前端全套测试/构建与最终生成客户端类型检查。Go/TS 差分覆盖响应 schema、创建时间分页、Unicode/特殊字符查询的游标字节及错误响应；复核子代理测试并校正完整目录数量和降序同时间 tie-break 断言。V1 boundary/whitespace 检查通过。前端保留已有大 chunk 提示；没有真实 archive RPC 同步或线上发布。


### 2026-09-06 B03 完整配置观察

第 22 项迁移及 v7-config 投影范围接入全部事件发现的 Quote/Baseline/Template 配置，每块刷新（含空块）。记录完整静态字段；Quote 补存 Stock 绑定和 Registry identityCurrent；Template 重算 v2 域哈希并观察五组件 runtime 身份。每批最多 1024 配置/45 秒，严格 ABI、状态、来源与哈希错误不返回部分结果，事件/配置/游标同事务提交。身份检查 false 保留证据等待独立对账，不误报通过。旧版本必须独立重建验证后切换。

B03 仍需 PoolKey/路由等完整探针、独立对账与自动 publication；本次配置来源层不替代上述验收。

本阶段验证通过：Go 全量 race/vet/build、生成契约与 Go/TS 对照、Linux amd64 无 CGO 构建；22 项迁移和本地备份恢复；Anvil + PostgreSQL 的 smoke-chain、smoke-holder、smoke-vault 全部通过。新增基线事件从真实本地 EVM 回执进入 journal/投影/配置观察，并验证无新事件的 finalized 空块刷新。三类配置单元测试覆盖 ABI/status、目标预算、Quote false 身份证据、Template v2 哈希及后续失败不返回部分结果；复核子代理用例并补齐 Quote/Template 与预算测试。夹具明确等待回执/finalized、推进 worker 到 idle，未弱化生产时间或来源校验。boundary/whitespace 通过；未进行真实部署配置同步或生产切换。


### 2026-09-06 B03 路由和池绑定观察

新增 --market-route 只读入口及每块持久观察。复算 PoolKey ID，对照 Registry canonicalPoolId/route、币种/阶段/交易开关/sourceVersion/费用来源；毕业后独立读取 Hook poolBinding 和 Locker marketId/lockedPosition。迁移 23、v8-route 保存完整观察并与投影事务同步，旧版本需独立重建。池创建前的预测 ID 和 MarketRuntime.poolId=0 保持不同语义。

B03 尚未完成：底层 PoolManager/NFT 流动性、全部路由部署依赖与权限、独立财务对账、自动 API 快照生产仍需继续。未据此声称完整 protocolBindingsVerified。

本阶段 Go 全量 race/vet/build、生成契约检查和 Linux amd64 无 CGO 构建通过；23 项迁移、内容备份恢复及本地 Anvil+PostgreSQL 的 Holder/Vault/Gauge 回归通过。curve/graduated 两阶段 ABI 夹具验证成功与币种、哈希、阶段、费用来源、Hook/Locker 错配拒绝，晚期重组不返回部分观察；子代理初始测试只覆盖非法输入，主代理补齐上述有效及交叉绑定场景。独立 CLI 已在合成 EVM getter 图验证，持久化覆盖 poolKey 与 canonicalRoute。未进行真实部署池或实际 NFT 流动性验收。


### 2026-09-06 B03/B06 历史 Vault 账户刷新

v9-vault-accounts、迁移 24 将 canonical 投影中已发现的本金账户/allocation 重新接入每块补读，解决空块只刷新总额而用户读数停留在旧交易块的问题。重复账户去重、跨资产/市场身份拒绝、超过 10000 历史输入失败。新增已知用户 deposited/allocated 之和、已知市场 allocated 之和与链上总额比较，并记录每市场已知用户 allocation 合计。失败检查保留，不将差额抹平；fullReconciliation=false。

仍需证明事件起始范围与账户枚举完整性、Gauge 全账户覆盖、独立事件本金账本重算、持久 reconciliation plan/run/probes 与自动 publication。已知合计相等不构成全部对账完成。

本阶段验证通过：Go 全量 race/vet/build、生成契约和 Linux amd64 无 CGO 构建；24 项迁移及本地备份恢复；Anvil/PostgreSQL smoke-vault、smoke-gauge 回归。Vault 夹具覆盖同块注册/存款、重启与无新事件的账户刷新，明确验证已知用户本金 90 与链上总本金 100 的检查为 false；没有修改数据使其虚假配平。复核子代理历史账户去重/非法身份测试，并补充合计及 fullReconciliation=false 的精确断言。boundary/whitespace 通过；无生产运行或快照切换。


### 2026-09-06 B03/B06 Gauge 历史账户刷新

迁移 25、v10-gauge-accounts 持久刷新启用质押市场及历史 gaugePositions 用户，包含空块/重启场景。规范身份、账户预算和去重后读取 positionOf 与激活快照；按 processed 归类尚未物化 pending，保存已知 stored-active 与未处理 pending 合计及与链上总额的差异。保留 effective 总量和奖励预览的独立语义，fullReconciliation=false。

该覆盖增强不能证明历史集合完整，也不替代独立事件账本、Gauge/FeeVault 金额对账或自动 publication。

本阶段验证通过：Go 全量 race/vet/build、生成契约检查、Linux amd64 无 CGO 构建；25 项迁移和备份恢复；本地 Anvil/PostgreSQL smoke-gauge 与 smoke-vault。新增 Gauge 事件实际进入 journal/持久用户投影，空块与进程重启后重读奖励和激活快照。单元测试覆盖 processed/unprocessed pending 归类、去重、非法账户、空市场刷新和 uint256 奖励精度。boundary/whitespace 通过；未据此启用自动快照生产或生产部署。


### 2026-09-06 B03/B06 事件本金账本

迁移 26 / v11-principal 从 canonical 持久事件输入独立重放 Vault 本金，检查来源摘要/原始日志/数量，覆盖存款、提款、allocation 增减与事件后余额检查点。rage quit 通知不重复扣本金；失败事件不修改账本，重放失败使投影事务回滚。新增逐账户/逐 allocation 的事件余额及与 getter 的比较结果，getter 不能覆盖事件余额。

现阶段限 100000 输入/64 MiB 全量重放，historyComplete=false；仍需可信起始范围、独立持久增量账本、完整对账计划/记录和 publication。未将局部相等判断提升为完整财务对账。

本阶段验证通过：Go 全量 race/vet/build、生成契约检查及 Linux amd64 无 CGO 构建；26 项迁移、备份恢复、本地 Anvil/PostgreSQL smoke-vault 与 smoke-gauge。Vault 夹具验证事件本金 90/allocated 0 保持独立，而 getter allocated 50 明确不匹配；空块重放也保留差异。复核子代理测试后改用真实 AllocationRageQuit 通知，并加强准确终态、多资产、锁定本金不可提取、累计 uint256 溢出及失败不变性断言。boundary/whitespace 通过；未启用自动财务快照发布或生产运行。


### 2026-09-06 B03/B06 本金账本增量检查点

迁移 27 / v12-principal-checkpoint 将本金每块全历史重放改为恢复不可变父检查点并应用当前块输入。摘要绑定链、区块、清单、版本、起点和累计输入数量；恢复校验规范编码、账户唯一性、本金守恒与 allocation 合计。父检查点缺失或完整性不符时停止。检查点与输入、观察批次和游标同事务提交。

本阶段仅改善本金输入回放；每块完整账本序列化和存储、通用投影冷启动历史回放仍存在。旧版本需独立重建验证。历史完整性证明、完整 reconciliation 和自动 publication 尚未完成，historyComplete=false。

本阶段验证通过：Go 全量 race/vet/build、生成契约检查、Linux amd64 无 CGO 构建；27 项迁移与内容备份恢复；本地 Anvil/PostgreSQL smoke-gauge、smoke-vault。覆盖本金快照恢复后存款/释放继续执行、错误守恒/合计与非规范编码拒绝，检查点不可更新、父块衔接、重启与空块刷新；在检查点已写入事务后注入观察批次失败，确认本金检查点与事件输入一起回滚。测试首次匹配了数据库内部异常文案，已修正为服务返回的批次持久化错误，并完整重跑通过。boundary/whitespace 检查通过；未进行生产部署或发布切换。


### 2026-09-06 B03/B06 持久本金对账计划与结果

迁移 28 / v13-principal-reconciliation 保存有序本金计划、逐项事件值/getter 值和 matched/mismatch/missing 结果，记录应查/完成/失败/缺失数量。计划从账本账户及 allocation 枚举产生；getter 缺失、非法金额或重复记录不能缩减应查数量。不可变对账表与本金检查点、投影观察和游标同事务提交，canonical 视图排除失效主链或 tip。

当前部署 Manifest 缺少可证明采集起点的部署区块锚点，不能证明本金历史完整。零项计划和全部匹配均保持 historyComplete=false、publicationEligible=false。本阶段未完成全域对账、历史覆盖证明或自动快照生产。

本阶段集成验证通过：28 项迁移、内容备份恢复、Anvil/PostgreSQL smoke-vault 与 smoke-gauge；确认本金对账 3 项已完成、2 项不匹配（allocated 事件值 0/getter 50），未将差异抹平；探针行数等于计划总数，零项报告不允许发布，报告/探针不可删除，投影 tip 失效后 canonical 视图为空。批次故障注入确认对账与本金检查点、输入共同回滚。Go 全量 race/vet/build、生成契约检查、Linux amd64 无 CGO 构建及 boundary/whitespace 已通过；远端 CI、生产部署未执行。

复核子代理本金计划测试，并补充部分 getter 缺失、uint256 溢出/非规范金额、全匹配仍不允许发布的断言；最终本金模块 race 测试通过。


### 2026-09-06 B03/B06 资产级事件本金与偿付对账

迁移 29 / v14-principal-solvency 新增事件账本按资产合计，每用户本金只计一次，多市场 allocation 不重复进入存入合计。对账计划 vault-principal-v2 增加 totalDeposited/totalAllocated 相等检查和实际 Token 余额覆盖事件本金的 atLeast 检查，逐项持久 comparison 并由数据库验证数值关系。合计使用任意精度整数，跨账户异常大数不截断。

该范围仍仅覆盖事件账本已知资产，不证明注册资产枚举与采集起点完整。historyComplete/publicationEligible 均保持 false；全域对账和自动发布仍未完成。

本阶段验证通过：Go 全量 race/vet/build、生成契约、Linux amd64 无 CGO 构建；29 项迁移、备份恢复、本地 smoke-vault/smoke-gauge、boundary/whitespace。Vault 持久报告 6 项完成、4 项不匹配，事件总本金 90 对链上总存入 100 记录 mismatch，实际余额 100 对事件本金 90 按 atLeast 记录 matched。单元测试覆盖不足/相等/多余余额的数值比较、额外计划的缺失计数；既有回滚、不可变和 canonical 失效测试继续通过。无生产发布或部署。

复核子代理资产合计测试，并补充同用户两个不同市场 allocation 的精确终态，确认两用户总存入 150、分配 50、free 100；另覆盖多资产排序、空集合和两个 uint256 最大账户的无截断合计。最终本金模块 race 通过。


### 2026-09-06 B03/B06 对账证据只读检查入口

新增 reconciliation-inspect，独立只读 DSN、30 秒超时、repeatable-read 与链共享锁。按链/区块读取当前 v2 报告，核对摘要和清单/版本/起点等来源绑定，从本金检查点及观察批次重新计算计划与结果，再比对报告 payload、SQL 计数和全部探针。缺失、篡改、锁忙或失效 canonical tip 时不输出部分报告。

入口用于存储证据一致性检查，不重新读取 RPC、不证明完整历史，不允许据此发布；完整后端目标继续进行中。本轮无需新迁移或投影版本变化。

本阶段验证通过：Go 全量 race/vet/build、生成契约与 Linux amd64 无 CGO 构建；本地 smoke-vault 覆盖新 CLI 正常核验 6 项/4 差异报告，修改探针、修改报告并重新计算其摘要、失效 canonical tip 均拒绝且无部分 stdout。29 项迁移、内容备份恢复和既有投影链路继续通过。--describe 独立运行通过，boundary/whitespace 通过；未新开远端服务或执行发布。

独立只读复核未发现具体 schema/编码兼容错误；主代理进一步将观察 scope 提取为 projector 共享常量，检查入口显式校验该范围，避免仅间接依赖版本与重算结果。


### 2026-09-06 B03/B06 已配置历史范围连续性核验

reconciliation-inspect 在同一只读事务中增加起点至目标的区块与本金检查点链检查，逐高验证主链/回执标记、时间戳、parentHash 和 checkpoint parent。输出明确的范围与计数；中间断块、回执失效或父关系冲突时失败，即使末端 tip 仍 canonical。预算上限 1000000 块，超限不截断。

范围完整性与部署起点证明分开：deploymentStartVerified=false，historyComplete/publicationEligible 不变。仍需部署锚点或可验证期初状态，以及其他资金模块对账；整体后端目标未完成。

本阶段验证通过：Go 全量 race/vet/build、生成契约、Linux amd64 无 CGO 构建、boundary/whitespace；smoke-vault 隔离 PostgreSQL/Anvil 验证准确范围计数，并在 tip 保持有效时分别注入中间断块、未验证回执、错误区块父哈希、时间戳倒退和错误本金检查点父哈希，全部拒绝且不输出部分结果，恢复记录后再次成功。29 项迁移和内容备份恢复继续通过，无生产执行。


### 2026-09-06 B03/B06 对账检查中的独立事件重放

reconciliation-inspect 从配置起点重新读取持久投影输入，与原始日志逐项核对摘要、内容和链/区块/日志位置，拒绝 removed 日志，按顺序独立重算本金。目标 checkpoint 累计输入数量和完整 ledger 编码必须匹配；成功报告 eventReplayVerified/replayedInputs。只读重放预算 100000 输入/64 MiB，不改变 projector 增量算法。

此证据仅证明已存输入与检查点一致，部署起点与 RPC 日志完整性未证明，historyComplete/publicationEligible 仍为 false。无需新迁移或投影版本变化。

本阶段 Go 全量 race/vet/build、生成契约、boundary/whitespace 与 smoke-vault 通过。隔离链路覆盖删除历史输入、仅修改原始日志、同时修改原始日志与输入并重算正确摘要三类故障；后者将本金改为 89，仍因与 checkpoint 90 不同而被拒绝，且无部分结果输出。恢复后完整核验成功。29 项迁移、备份恢复和既有投影/对账故障注入继续通过，无生产执行。


### 2026-09-06 B03/B06 市场 allocation 合计

迁移 30 / v15-principal-markets、vault-principal-v3 在每 assetUid/marketId 聚合所有用户 allocation，与 marketAllocated 比较。零余额历史市场保留，市场合计不重复进入用户存入/free。计划持久化并由检查命令独立重放核验；旧版本需独立重建，historyComplete/publicationEligible 不变。

本阶段集成验证通过：30 项迁移、备份恢复、smoke-gauge 与 smoke-vault；合成 EVM 新增 AllocationLocked 发出路径，存款 90、锁定 40 进入真实 journal/投影/检查点，最终报告 8 项完成、6 项差异，marketAllocated 事件合计 40 对 getter 60 明确 mismatch，独立事件重放通过。Go 全量 race/vet/build、生成契约、Linux amd64 无 CGO 构建、boundary/whitespace 通过。未进行生产部署或快照发布。

已复核子代理市场合计测试，覆盖多用户求和、同资产多市场与同市场跨资产隔离、排序、完全释放后零目标保留及存款不加入市场合计；最终本金模块 race 通过。


### 2026-09-06 B17 流水线只读运行状态

新增 backend-status --once/--describe，独立只读 DSN，聚合 journal/discovery/projection/publication 高度、存储 finalized、进展时间与本金失败/缺失计数。按 latest journal 与 finalized discovery 的真实边界计算 lag，检查 canonical 标记、manifest 一致性、陈旧进展和缺失状态。阈值可配置，JSON 报告+0/2/1 退出码可由外部监控采集。

当前不查询实时 RPC head、不发送通知，也不替代 readiness 或财务验收；productionReadinessVerified=false。B17 的全面 worker/RPC 指标与生产告警接收端仍未完成，无新迁移。

本阶段验证通过：Go 全量 race/vet/build、生成契约、Linux amd64 无 CGO 构建；smoke-vault 调用真实 backend-status 进程，验证 attention/检查失败退出码、latest 与 finalized 分离、陈旧进展、manifest 不一致、canonical 失效、未初始化链及连接配置不泄露。复核子代理单元测试后补齐超阈值一块、finalized 锚点失效与输入不被修改的断言，最终 operations race 通过。30 项迁移与备份恢复继续通过。


### 2026-09-06 B17 可选实时 RPC 状态

backend-status 增加 TG_STATUS_RPC_URL：检查 chainId/genesis 与 journal 绑定，复查 latest/finalized 指定高度哈希，比较已存 finalized 锚点，报告实时采集积压、finalized 积压、链头落后、finality 回退与锚点变化。数据库事务结束后再进行网络读取，保留两个观测时间；RPC 不可用或身份/内部一致性失败时无部分输出、不降级，退出 1。

仍为单 RPC 只读信号，不执行交易、推进游标或发布；生产 readiness 与外部告警接收端未完成。

本阶段验证通过：Go 全量 race/vet/build、生成契约、Linux amd64 无 CGO 构建、boundary/whitespace；Anvil/PostgreSQL smoke-vault 覆盖身份/锚点匹配、新增两块后的实时 backlog、游标未改动、genesis 不符和不可达 RPC 的无部分输出/无 URL 泄露。复核子代理测试后补齐 finalized 指定高度哈希改变、链头落后无无符号下溢及生产标记强制 false 的断言，operations race 通过。--describe 显示可选 RPC 能力。无生产执行。


### 2026-09-06 B07 累计已领收益投影

迁移 31 / v16-fee-claim-totals 增加按市场、feeAsset、角色、受益人和 beneficiaryEpoch 隔离的累计领取额/次数。保留逐笔 feeClaims 和首笔来源，仅 FeeClaimed 增加已领；转换与未领不混入。本金表不受该金额累计影响。Go 与 TS 参考状态/重放快照同步，旧投影版本需独立重建验证。

历史范围仍未完整证明，historyComplete=false；该结果尚未接通完整未领/已领/待转换 API 财务生产，B07 与全后端目标继续进行中。

本阶段验证通过：最终 Go 全量 race/vet/build、生成契约及 Go/TypeScript golden 一致性、Linux amd64 无 CGO 构建、TypeScript build 与 32 项测试、boundary/whitespace。31 项迁移、备份恢复、smoke-vault 与 smoke-gauge 通过；合成 EVM 两笔 FeeClaimed 各 7，经真实 journal/投影得到累计 14、次数 2，重启与空块不重复累计。复核并补充单元测试，覆盖受益人/角色/资产/epoch/市场隔离、首笔来源保持、重复事件去重以及累计超过 uint256。无生产部署或快照发布。


### 2026-09-06 B07/B08 Creator 原币退出状态

v17-creator-exit 在 creatorEpoch 观测中加入 rawRewardExitAt、rawRewardExitReady 与 observedAtTimestamp。按市场/受益人读取 pinned block getter，同一受益人跨 epoch 共享该退出请求，但各 epoch 的 liability 仍分别保留。仅非零时间且观测区块时间达到延迟时标记 ready；不依赖服务器当前时间，uint256 时间不截断为 uint64。缺失 getter 或非法区块时间使整个观测失败，不把缺失值当作零。

ready 仅表示原币退出延迟满足，不证明余额、偿付能力或交易可执行；Quote 不受该 Meme 退出延迟限制。当前未增加公共收益 API，Staker 的退出状态、完整收益对账和财务发布仍需继续开发。无新迁移，投影版本改变后旧数据需在独立数据库重建验证。

本阶段验证通过：Go 全量 race/vet/build、生成契约、Linux amd64 无 CGO 构建、boundary/whitespace；smoke-vault 与 smoke-gauge 在隔离 PostgreSQL/Anvil 中验证新字段持久化及 31 项迁移、备份恢复、既有本金/领取链路。复核子代理测试并确认十六进制 ABI 输入的十进制输出，覆盖未请求、未到期、恰好到期、已到期、uint256 极大值、受益人隔离、缺失 getter 与非法区块时间；最终 deployment race 通过。无生产操作。


### 2026-09-06 B07/B08 Staker 原币退出状态

v18-staker-exit 在 gaugePosition 中加入 rawRewardExitAt、rawRewardExitReady 与 observedAtTimestamp。通过已认证 Gauge identity 中绑定的 ProtocolFeeVault，按市场/用户在同一个 block hash 读取退出 getter，与 positionOf 的 Quote/Meme 预览收益共同持久化；历史用户在空块仍刷新，取消请求后不保留过期 ready。缺失/畸形 getter 或非法观测时间使整批失败，不返回部分收益。

rawRewardExitReady 仅表示 Meme 原币退出延迟已满足，不代替余额、偿付能力、完整历史与交易执行检查。未领取余额不因等待到期而被删除，也不提前计入累计已领。公共收益 API、完整对账与发布仍未完成。无新迁移；旧投影需按 v18 在独立数据库重建验证。

本阶段验证通过：Go 全量 race/vet/build、生成契约、Linux amd64 无 CGO 构建、boundary/whitespace；smoke-gauge/smoke-vault 验证新字段、空块刷新、既有领取/本金对账与 31 项迁移及备份恢复。已复核子代理测试并补充取消请求与非法时间拒绝；最终 deployment race 覆盖零/未来/恰好到期/过去/uint256 最大值、缺失/畸形 getter 和取消后的刷新。无生产部署或发布。


### 2026-09-06 B07 区块末统一收益记录

迁移 32 / v19-reward-positions 新增 rewardPosition：以 market/feeAsset/role/beneficiary/epoch 为键，将 Creator liability 或 Gauge positionOf 预览的 unpaidAmount、事件累计 observedClaimedAmount/observedClaimCount、首笔领取来源和原币退出状态汇总。Quote/Meme、Creator epoch 与 Staker epoch 0 分开；不将已领与未领相加，不把 Meme 未领直接等同于待转换或立即可领。未发现领取事件时观测累计为 0，historyComplete/publicationEligible 始终 false。

当前块事件更新、收益记录、观测批次及游标处于同一事务。每次从最多 100000 条 feeClaimTotals 读取累计，校验存储键；不能匹配观测的 Creator/Staker 领取、重复身份、资产冲突、区块时间混用或错误 ready 都使整批失败。已领取累计使用任意精度，单项未领遵守 uint256。旧版需独立重建；公共收益 API、独立完整收益对账与待转换状态仍待完成。

本阶段最终 Go 全量 race/vet/build、生成契约、Linux amd64 无 CGO 构建及 boundary/whitespace 通过。32 项迁移、备份恢复和 smoke-gauge/smoke-vault 通过；真实持久化链路验证 Creator 已领 14/2 次与 getter 未领 1 分别保留、Staker Quote 未领 7/已领 0，空块及重启不重复累计。复核并补强收益单元测试，逐项核验资产/epoch/角色金额、任意精度累计、uint256 未领边界、孤立/重复领取、混合区块时间、错误键与资产冲突。无生产操作。


### 2026-09-06 B07 用户收益观测查询 API

Go API 新增 `GET /v1/users/{address}/rewards?limit=50&cursor=...&revision=...`，OpenAPI 2.6.0 与 Backend/Web 生成客户端提供 `listUserRewards`。返回按完整收益身份排序的 items、nextCursor 和 source（chainId/blockNumber/blockHash/revision/finality），每页最多 100。游标绑定用户和当前投影 revision；投影前进后旧游标返回 400，客户端重新从第一页读取。

API 通过 TG_DATABASE_URL 只读 repeatable-read 事务和共享链锁，读取当前已确认投影观测批次；检查当前投影版本/范围、主链和回执状态、finalized 高度、journal 120 秒新鲜度、批次摘要和计数，再从保存的 Creator/Gauge 观测重算收益记录并逐项比对。数据缺失、过期、损坏或数据库不可用返回 503，不能用空数组伪装不可用；仅在有效观测中无该用户记录时返回空数组。单次请求 5 秒超时，不进行 RPC 或交易。

这是观测数据接口，未完成独立领取事件历史证明或完整收益对账；historyComplete/publicationEligible 始终 false，不代表生产可领取/可转换金额。未修改已有快照发布门槛。Go API 数据库只读角色需增加 projection_checkpoints、chain_blocks、chain_journal、projection_observation_batches 的 SELECT；现有 TypeScript 快照服务不实现该 Go 数据库查询路径。无新迁移或投影版本变化，仍为 32 项迁移/v19。

本阶段验证通过：Go 全量 race/vet/build、最终 HTTP/rewards race 和生成契约检查、Linux amd64 无 CGO 构建、TypeScript 后端 26 项测试、Web generated/typecheck/build、boundary/whitespace。smoke-gauge 与 smoke-vault 启动真实 API 进程，验证两页收益、钱包隔离、无记录空页、旧 revision 400、摘要损坏与 canonical 失效 503、恢复后可读，以及 32 项迁移和备份恢复。复核子代理 HTTP 测试并补齐真实生成游标跨钱包拒绝、revision 失效；收益重算测试拒绝篡改未领、发布标记和缺失记录。无生产部署。


### 2026-09-06 B07/B08 转换候选状态

v20-reward-conversion / OpenAPI 2.7.0 在统一收益记录及 GET rewards 中增加 conversionStatus 与 conversionCandidateAmount。Quote 为 not_applicable；Meme 依次区分 no_rewards、not_graduated、rage_quit_pending、raw_exit_ready、candidate。仅 candidate 保留原始 Meme 未领金额作为候选额，其他状态为 0；不会把候选金额加到 unpaidAmount，也不估算 Quote 收入。

使用每块已认证 canonicalRoute.launchPhase；Gauge 同区块补读 AllocationManager.rageQuitSettlementPending(market,user) 及 principal。getter 缺失/畸形拒绝整个观测。原币退出等待期间仍允许形成转换候选，到期后禁止；Staker rage quit 未结算阻止候选。缺少 route 或结算状态时不推断默认可转换。

candidate 仅通过本阶段观测资格检查，不是已排队或可广播交易；操作者权限、资产偿付能力、报价/流动性、32 项批次上限、期限与 minimumQuote 仍属于实际执行验证。historyComplete/publicationEligible=false。前端生成客户端同步；无新迁移，仍 32 项，旧投影须按 v20 独立重建。

本阶段验证通过：Go 全量 race/vet/build、最终 rewards/deployment race、生成契约、Linux amd64 无 CGO 构建、TypeScript 后端 26 项测试及 Web generated/typecheck/build、boundary/whitespace。smoke-gauge/smoke-vault 通过 32 项迁移、备份恢复与真实 HTTP 查询，确认未毕业 Meme 候选额 0、Quote 不参与转换。复核子代理状态测试后补齐无退出请求的候选、目标存在断言及 Creator epoch 独立归属；getter 测试覆盖 pending/principal 和缺失/畸形 bool 拒绝。无生产执行。


### 2026-09-06 B08 转换事件批次守恒

迁移 33 / v21-conversion-batches 在当前块内按交易/FeeVault/市场配对 RewardConverted 与 RewardBatchConverted。检查逐项用户/epoch 唯一、最多 32 项、批次非零 nonce、同块 nonce 不重复、资产匹配 canonicalRoute，以及逐项 MemeSpent/QuoteReceived 大整数精确合计。孤立项、空批次、跨交易配对或不守恒使整个区块事务回滚。rewardConversionBatch 保留逐人事件键、原始数量与 epoch、交易/发出方、批次 nonce，空块不重复生成。

校验范围为已认证事件内部守恒及市场资产归属，不证明完整转换执行资格、历史 nonce 连续性或实际转账。原始 maximumMeme 和 refund 未包含在这些事件中，因此不凭空推断退款或请求额；holder 转换另属独立流程。事件转换不计入 FeeClaimed 累计。historyComplete/publicationEligible=false；当前未添加批次查询公共端点。旧投影需独立重建。

本阶段 Go 全量 race/vet/build、生成契约、smoke-gauge 与 smoke-vault 通过，含 33 项迁移、备份恢复和真实合成 EVM 同交易两条日志落库；批次 7 Meme/11 Quote、用户 epoch1 归属、重启/空块稳定及累计已领不变均验证。复核并修正测试触发路径，覆盖 32 项成功/33 项失败、相同用户跨 epoch 成功、重复 user/epoch、重复 nonce、孤立/空批次、跨交易及金额/资产不一致。无生产执行。


### 2026-09-06 B07 查询时独立重放已领历史

GET rewards 不再从汇总记录反推领取输入作为最终验证。只读事务内从投影 start_block 到当前 tip 重放 projection_inputs，与 chain_logs 逐条比对原始日志、摘要、链/区块/日志位置，检查主链已验证区块覆盖计数及 checkpoint.input_count；仅 FeeClaimed 进入累计，RewardConverted 等不进入。重算的角色/受益人/epoch/资产累计再与 rewardPosition 全量比对，汇总自洽但不符合已存事件也拒绝。

OpenAPI 2.8.0 / SDK 的 source 增加 observedClaimHistoryVerified=true 和 replayedInputCount（十进制字符串）。该标记仅表示已保存输入与汇总相符，不证明 RPC 采集完整性、部署起点或所有收入负债守恒；historyComplete/publicationEligible 仍 false。验证预算 100000 输入、64 MiB、1000000 区块及原 API 5 秒超时，超限返回 503；大规模历史仍需经验证的增量缓存/检查点以支持生产性能。

API 只读数据库角色还需 projection_inputs、chain_logs 的 SELECT 权限。无迁移或投影版本变化，仍 33 项迁移/v21。

本阶段 Go 全量 race/vet/build、生成契约、Linux amd64 无 CGO 构建、TypeScript 后端 26 项测试及 Web generated/typecheck/build、boundary/whitespace 通过。smoke-gauge/smoke-vault 验证 API 返回独立重放标记，输入摘要破坏、checkpoint 数量错误、将累计金额改为 999 并重新计算合法批次摘要均返回 503；恢复后正常读取。单元覆盖重复/removed 领取、epoch 分离、超 uint256 累计与转换事件不算领取。33 项迁移、备份恢复和既有转换事件链路继续通过，无生产操作。


### 2026-09-06 B07 领取历史区块连续性

领取历史重放从单纯区块计数升级为逐高度验证：范围内 canonical 区块高度连续、回执已验证、父哈希连接前一区块、时间戳非空且不倒退，并以当前投影 tip 哈希结束。Creator/Gauge 观测的 observedAtTimestamp 还必须等于所绑定区块的实际时间；即使重算批次摘要也不能改变退出/转换判断的时钟来源。

此校验仍只覆盖配置的已保存范围，首块父节点在范围外，不构成部署起点证明。API、OpenAPI 2.8.0、33 项迁移与 v21 投影版本不变；完整历史/生产发布标记不变。保持现有 1000000 区块与请求时间预算。

本阶段 Go 全量 race/vet/build、生成契约、Linux amd64 无 CGO 构建、boundary/whitespace、smoke-gauge/smoke-vault 通过。真实 HTTP 测试保持有效 tip 和区块数量，注入中间父哈希错误及时间倒退，均拒绝；将所有收益观测时间改为区块时间加一并重新计算合法摘要也返回 503，恢复后正常。既有独立领取重放、转换批次、33 项迁移及备份恢复继续通过，无生产操作。


### 2026-09-06 B07 同一可见快照复用验证结果

收益 Store 增加单项、最多 16 MiB 的进程内验证缓存。键包含 pg_current_snapshot（xid8 可见范围）、服务器启动时间/地址/端口、恢复状态、数据库 OID、用户以及链/投影版本/scope/revision/批次摘要。仅在只读 repeatable-read 事务中使用；缓存命中仍先执行当前 metadata、canonical/finality、新鲜度、批次摘要和 revision 检查。

设计依据为 PostgreSQL 的事务可见快照定义（https://www.postgresql.org/docs/14/functions-info.html）。此实现以精确快照相等作为保守复用条件；任何已提交写入导致可见快照变化时重新验证，即使投影 revision 未变。服务器/数据库身份变化也不复用。失败结果不缓存，返回值从序列化副本解码，调用者不能修改缓存中的已验证金额。无需迁移、公共 API 或权限变更。

这减少同一稳定数据库状态下分页/重复查询的历史重放，不解决首次读取或持续写入下的大历史重放成本；缓存不等于持久增量检查点，也不改变 historyComplete/publicationEligible 标记。生产吞吐与长期历史扩容仍待验证。

本阶段 Go 全量 race/vet/build、生成契约、Linux amd64 无 CGO 构建、boundary/whitespace、smoke-gauge/smoke-vault 通过。每套隔离数据库实测连续 5 次缓存命中；提交输入数量破坏后，同 revision 也不复用旧结果，返回 unavailable。单元 race 验证并发访问、不同 key 拒绝及嵌套返回对象与缓存隔离。原有父哈希/时间/摘要/汇总篡改检测、33 项迁移、备份恢复和转换链路保持通过。无生产操作。


### 2026-09-06 B07 领取历史流式累计

首次读取及缓存未命中时，领取历史改为按数据库行验证后立即累计，不再保留整个范围的 decoded projection.Input 列表。每条输入仍校验原始日志、摘要、位置和 ABI；非领取事件验证后释放，仅保存领取事件去重键及按市场/资产/角色/受益人/epoch 的累计。金额维持任意精度，首条领取来源不变；异常输入不产生部分成功响应。

保留 100000 输入、64 MiB 累计读取字节、1000000 区块与 5 秒请求预算。此改动减少对完整解码历史的持有，但内存仍随领取事件去重键和收益身份数量增长，不声称常数内存或已达到生产吞吐。API、OpenAPI 2.8.0、33 项迁移、v21 投影版本及 historyComplete/publicationEligible=false 不变。

本阶段 Go 全量 race/vet/build、生成契约、Linux amd64 无 CGO 构建、boundary/whitespace、smoke-gauge/smoke-vault 通过。新增并复核增量快照、返回值隔离、畸形 ABI/日志位置、重复及 removed 输入不污染累计，以及 1000 条转换事件不保留领取状态的测试，最终 rewards race 通过。两套隔离 PostgreSQL + Anvil 链路继续验证篡改拒绝、缓存失效、33 项迁移、备份恢复及转换不重复计入已领；未执行生产操作。


### 2026-09-06 B07/B08 领取锁定条件

v22-claim-conditions / OpenAPI 2.9.1 为收益 API 增加 claimStatus、claimCandidateAmount、positionUnlockAt 和 positionLockSatisfied。Staker 使用同一区块 positionOf 的 activeAmount、pendingAmount、unlockAt：有本金时必须有非零 unlockAt，时间达到（含相等）才满足锁定条件；无本金时不受残留锁定时间限制。rage quit 待结算阻止两种资产领取。Creator 不使用 Gauge 仓位锁。

Meme 原币领取必须先请求退出并等到 rawRewardExitAt；Quote 不受该等待期影响。状态优先级为 no_rewards、rage_quit_pending、position_locked、raw_exit_required、raw_exit_waiting、candidate。仅 candidate 返回原始未领金额作为 claimCandidateAmount；候选不证明偿付能力、实际调用模拟或转账成功。转换仍按独立资格计算，不因仓位尚未解锁而被排除。

缺失或畸形 Staker 锁字段、存在本金但 unlockAt 为 0 时拒绝整批。旧投影需按 v22 独立重建；无数据库迁移（仍 33 项）。完整历史与生产发布标记仍为 false；生成 Backend/Web 客户端同步，未改动钱包交易流程。

本阶段 Go 全量 race/vet/build、Linux amd64 无 CGO 构建、最终 rewards/readmodel/httpapi race、生成契约、TypeScript 后端 26 项测试、Web generated/typecheck/build、boundary/whitespace 通过。复核并补强测试覆盖 active/pending 锁、解锁相等边界、无本金残留锁、字段缺失/畸形/溢出、零奖励、Creator Quote 与 Meme 原币等待区别及转换资格独立性。smoke-gauge/smoke-vault 通过真实 HTTP 新字段返回及重新计算合法摘要后的领取状态篡改拒绝，33 项迁移、备份恢复与原链路继续通过。无生产操作。


### 2026-09-06 B10 Go 维护调用模拟

maintenance-worker 从纯 --describe 脚手架升级为 --preview 单次维护模拟。固定支持 sweep、checkpoint、flush-forfeiture、settle-rage-quit、treasury-activate；调用者只能提供 operation/market/trigger/user/from，不能指定任意目标、selector 或 value。根据 Registry 市场状态及 Factory Treasury 绑定解析目标，要求目标有显式 manifest runtimeCodeHash，并验证 core bindings、市场反向映射及 Treasury reciprocal Registry。

所有读取和 eth_call 固定到同一个 canonical latest 区块哈希（并非 finalized 数据接口），要求区块时间在过去 120 秒内且未来偏差不超过 5 秒；显式 from、value=0，模拟后再次核对区块哈希和时间。返回按合约 ABI 解码的 sweptAmount、activatedAmount/processedBuckets、quoteForfeited/memeForfeited/redistributed 或空返回。RPC 回退、畸形返回、部署绑定错误或重组均拒绝，不把模拟失败推断成 noop。

输出 status=simulated、executionComplete=false、transactionSubmission=false。key 绑定链/Genesis/发送者/目标/操作/市场/用户/trigger，是请求身份，不是持久预留记录；不表示已排队、已签名或已执行。五类维护的持久任务、nonce/签名提交、未知提交恢复、回执及后置状态确认仍待实现；执行前必须重新模拟。本阶段无需迁移或公开 API 变化。

```sh
# cwd: services/backend-go；TG_CHAIN_ID 与 manifest 一致，TG_RPC_URL 指向目标 RPC
./bin/maintenance-worker --describe
./bin/maintenance-worker --preview --manifest /absolute/deployment.json \
  --operation settle-rage-quit --market "$MARKET_ID" --trigger "$TRIGGER_ID" \
  --from "$OPERATOR_ADDRESS" --user "$BENEFICIARY_ADDRESS"
```

本阶段 Go 全量 race/vet/build、生成契约、Linux amd64 无 CGO 构建、最终 deployment/maintenance CLI race/vet 及 boundary/whitespace 通过。单元覆盖五类操作精确 ABI 和目标解析、无 manifest/错误 codehash/反向市场错误/过期区块拒绝、模拟回退/畸形返回/重组拒绝、Treasury reciprocal Registry，以及 CLI 禁止隐式执行。smoke-gauge/smoke-vault 在合成 EVM 上运行真实 maintenance CLI：settle 返回 7/9/true，checkpoint 返回 4/1，flush 空返回，发送者 nonce 不变；既有 33 项迁移、备份恢复、收益、转换与投影链路继续通过。未执行生产操作。


### 2026-09-06 B10 维护请求与模拟记录持久化

迁移 34 新增 maintenance_jobs / maintenance_simulations。--preview --record 在运行时绑定验证与模拟成功后，使用 TG_MAINTENANCE_DATABASE_URL 原子保存固定调用身份及完整模拟记录。相同结果摘要重试返回同一 sequence；同一触发在新区块模拟时追加记录。行锁与唯一约束支持多进程去重；同一链/Genesis/发送者/操作/市场/用户/trigger 改指另一个目标时拒绝，避免把目标变化当作同一任务继续执行。

--history JOB_KEY [--after SEQUENCE] 以只读 repeatable-read 事务读取最多 100 条升序记录，供进程重启后审查；未知任务、链不符、摘要或固定调用身份不一致返回错误。记录校验包含 selector/参数、zero value、状态标记及返回值 ABI 类型；历史区块无需仍在实时新鲜度窗口内。记录只证明保存的模拟结果及其身份一致，不替代历史链状态独立重放或后续 fresh simulate。

持久化成功仍是 simulated，不是 queued/submitted/completed。尚未加入执行租约、nonce 预留、签名/广播、未知提交恢复或回执/后置状态确认。维护写入角色需两表 SELECT/INSERT、maintenance_jobs 行锁所需 UPDATE 权限及 identity sequence 使用权限；历史读取角色仅需 SELECT。应用不更新已有模拟，但数据库管理角色仍能修改表；摘要检查不抵御拥有完整数据库写权限的主动伪造。

```sh
# 在原 --preview 命令上加 --record；DSN 指向已执行迁移 34 的维护数据库
./bin/maintenance-worker --history "$JOB_KEY"
./bin/maintenance-worker --history "$JOB_KEY" --after "$LAST_SEQUENCE"
```

本阶段 Go 全量 race/vet/build、生成契约、Linux amd64 无 CGO 构建及 boundary/whitespace 通过。smoke-gauge/smoke-vault 执行 34 项迁移并通过原集成链路，真实 CLI 重复 record 返回相同记录、新进程 history/after 查询稳定；专用隔离数据库测试验证 12 并发去重、追加模拟、目标冲突、跨链拒绝、损坏记录拒绝且不被重试覆盖。复核 envelope 单元测试，覆盖固定调用身份、执行标记、数量编码、返回类型/范围及历史时间读取；最终 deployment/maintenance/CLI race/vet 通过。无生产操作。


### 2026-09-06 B10 维护准备租约

迁移 35 新增 maintenance_leases 和 maintenance_lease_events。每次获取租约先锁定 maintenance_jobs 行并核验保存的调用/模拟摘要，再以数据库 clock_timestamp 判定过期。TTL 为 10–300 秒；同一任务只能有一个当前有效租约。获取绑定 owner 与非零 bytes32 token，相同 token 在有效期内重试返回同一租约，不延长期限；过期、释放或被替代后该 token 不再用于获取。

新的获取递增 generation。续租和释放必须同时匹配当前 owner/token/generation；过期租约不可续活，旧 worker 无法续租或释放接管者租约。续租使用原 TTL；同一已释放租约重复释放返回原结果。获取/续租/首次释放分别写入事务内审计事件，数据库失败不返回成功。

CLI 使用 --lease acquire|renew|release --job KEY --owner WORKER --token TOKEN，获取可带 --ttl，续租/释放必须带 --generation。DSN 沿用 TG_MAINTENANCE_DATABASE_URL；写入角色另需两表 SELECT/INSERT、租约表 UPDATE 及事件 sequence 权限。owner/token 是去重和 fencing 身份，不替代数据库角色授权。

这仍是准备阶段租约，不包含 nonce 或交易预留，也不授权广播。后续签名/提交状态机必须在同一事务内验证有效 generation，并阻止已有或未知提交任务因租约过期而重新签名；目前没有签名提交实现，executionComplete/transactionSubmission 继续 false。

```sh
./bin/maintenance-worker --lease acquire --job "$JOB_KEY" --owner worker-1 --token "$ACQUIRE_TOKEN" --ttl 60
./bin/maintenance-worker --lease renew --job "$JOB_KEY" --owner worker-1 --token "$ACQUIRE_TOKEN" --generation "$GENERATION"
./bin/maintenance-worker --lease release --job "$JOB_KEY" --owner worker-1 --token "$ACQUIRE_TOKEN" --generation "$GENERATION"
```

本阶段 Go 全量 race/vet/build、生成契约、Linux amd64 无 CGO 构建、最终 maintenance/CLI race/vet 与 boundary/whitespace 通过。smoke-gauge/smoke-vault 通过 35 项迁移及原链路；专用数据库测试覆盖 12 并发单赢家、获取重试不延长、续租/释放、过期接管、版本递增、旧 token/owner/generation 拒绝、跨链拒绝及审计事件计数。真实 CLI 跨进程获取重试、续租、释放通过，sender nonce 保持不变。复核并加强 CLI 参数测试，要求精确参数拒绝原因，避免缺失 DSN 造成假阳性。无生产操作。


### 2026-09-06 B10 维护 nonce 持久预留

迁移 36 新增按 (chainId, genesisHash, sender) 隔离的账户游标和每任务唯一 nonce reservation。--preview --reserve-nonce 在保存绑定验证后的模拟记录之后，检查 owner/token/generation 及数据库时间下的有效租约，锁定账户行，读取 RPC pending nonce，取其与本地 next_nonce 的较大值并原子递增。账户/nonce 唯一约束防止多个任务冲突；RPC 链 ID、Genesis、模拟区块哈希/时间再次核验，网络等待之后再次检查租约与模拟新鲜度。支持范围受 PostgreSQL bigint 限制，达到上界时拒绝继续分配。

预留绑定 simulation_digest 和 generation。相同有效租约重试返回原 nonce 与原模拟引用，不因 pending nonce 变化分配第二个；--reservation JOB_KEY 可以在租约过期后读取原记录。已有 reservation 的任务禁止新 token 自动获取准备租约，释放或过期不会回收 nonce。这是后续未知提交恢复的保守前置边界，尚无取消/替换或 nonce 缺口补偿实现。

输出 status=nonce_reserved，仍 transactionSubmission=false、executionComplete=false。没有估算 gas/fee、签名或广播，也不将预留解释为链上占用。投入实际发送前需独占该发送账户，或把所有使用该账户的任务接入同一个 nonce 协调器；当前表不能协调其他数据库、钱包或其他服务自行发送的交易。签名前仍需 fresh simulate、有效 fence、交易意图验证及持久提交状态。

沿用 TG_MAINTENANCE_DATABASE_URL，写入角色需账户表 SELECT/INSERT/UPDATE、预留表 SELECT/INSERT；reservation 检查复用任务行锁，亦需 maintenance_jobs 的行锁权限。无新公开 HTTP API 或投影版本变化。

```sh
# 在与租约 job 完全相同的 --preview 命令上增加：
# --reserve-nonce --owner worker-1 --token "$ACQUIRE_TOKEN" --generation "$GENERATION"
./bin/maintenance-worker --reservation "$JOB_KEY"
```

本阶段 Go 全量 race/vet/build、生成契约、Linux amd64 无 CGO 构建、最终 chainrpc/maintenance/CLI race/vet 及 boundary/whitespace 通过。smoke-gauge/smoke-vault 通过 36 项迁移和原集成链路；隔离数据库验证 8 个任务并发分配 5–12 且无重复、重试不受新 pending 值影响、pending 前进至 100、RPC 身份错误回滚、旧 fence 拒绝及租约过期后保留 reservation/禁止重新获取。真实 CLI 使用 Anvil pending nonce，跨进程预留重试和查询一致，sender 链上 nonce 不变。RPC 单元覆盖准确 sender/pending tag、零地址与畸形/溢出 quantity；CLI 验证互斥模式和必填参数。无生产操作。


### 2026-09-06 B10 固定未签名交易意图

迁移 37 新增 maintenance_transaction_intents，每个 nonce reservation 只保存一个固定意图。--preview --prepare-intent 要求当前 owner/token/generation 与显式十进制 gas-limit、max-fee-per-gas、priority-fee-per-gas（wei）。采用 EIP-1559 type=0x2 参数，包含固定 from/to/data/value=0、预留 nonce、链/Genesis、模拟区块及摘要；maximumGasCost 为 gasLimit × maxFeePerGas，使用任意精度计算并限制 uint256，表示该 gas 预算上限而非费用报价或全部链特定费用。

准备时核验已有 reservation 与模拟记录、租约有效性、RPC 链/Genesis 和 pending nonce 未超过预留值，随后将 gas/fee/nonce 全部传入 hash-pinned eth_call。返回 ABI 和数值须与同块预览一致；回退、结果变化、重组或网络等待后租约过期均不保存意图。gas 必须至少 21000、最大费用非零、priority 不高于 max；不自动猜测预算或 gas。

并发准备只产生一份记录，同参数重试返回原摘要；更换 gas 或费用上限不会覆盖原意图。--intent JOB_KEY 在租约过期后仍能读取并校验原记录。输出 status=intent_prepared、transactionSubmission=false、executionComplete=false；digest 是规范生成 JSON 记录的 Keccak 摘要，不是 Ethereum 签名摘要或交易哈希，也不包含签名或可广播字节。尚未接入签名器、广播、替换或回执恢复；后续签名前必须重新验证预算、nonce 和链状态。

写入角色另需意图表 SELECT/INSERT；检查路径沿用任务行锁权限。无公开 HTTP API 或投影版本变化。

```sh
# 在与 reservation 相同任务的 --preview 命令上增加：
# --prepare-intent --owner worker-1 --token "$ACQUIRE_TOKEN" --generation "$GENERATION" \
# --gas-limit "$GAS_LIMIT" --max-fee-per-gas "$MAX_FEE_WEI" --priority-fee-per-gas "$PRIORITY_FEE_WEI"
./bin/maintenance-worker --intent "$JOB_KEY"
```

本阶段 Go 全量 race/vet/build、生成契约、Linux amd64 无 CGO 构建、最终 chainrpc/maintenance/CLI race/vet 与 boundary/whitespace 通过。smoke-gauge/smoke-vault 通过 37 项迁移及原链路，真实 Anvil eth_call 包含明确 gas/fee/nonce，CLI prepare/retry/inspect 跨进程一致且发送者 nonce 不变。隔离数据库测试验证失败模拟不落库、8 并发请求仅一次成功模拟/一份意图、预算修改和错误 fence 拒绝、损坏记录拒绝及租约过期后只读保留；费用单元覆盖十进制规范、priority/max 关系和 uint256 成本溢出，RPC 测试核对完整调用及 canonical hash pin。无生产操作。


### 2026-09-06 B10 已签名交易校验与保存

迁移 38 新增 maintenance_signed_transactions；引入 go-ethereum v1.17.5 的 core/types 解析签名交易并恢复发送者。按 EIP-1559（https://eips.ethereum.org/EIPS/eip-1559）只接受规范编码 type 2：链 ID、nonce、gas、maxFee/maxPriorityFee、目标、data 和零 value 必须逐项等于固定意图。拒绝合约创建、非空 access list、其他交易类型、错误发送者或不合法签名（含 high-S）。原始字节最多 16 KiB，重编码必须保持一致。

--attach-signed HEX_FILE 要求 job、固定 intent-digest 以及有效 owner/token/generation。事务内重新验证 reservation/intent 与签名；相同字节重试返回同一结果，已有签名字节不被另一份交易覆盖。--signed JOB_KEY 可跨进程读取，读取时再次恢复签名与核对意图，不信任数据库保存的 sender/transactionHash 标签。

本阶段接受外部签名器产生的 0x 十六进制文件，不读取生产私钥、不自动调用生产签名器，也不广播。status=signed_stored 只表示校验后的签名字节持久化；transactionSubmission/executionComplete 仍 false。transactionHash 此时是实际已签名交易哈希，intentDigest 仍是 JSON 意图记录摘要。后续发送需要新的链状态检查、持久提交记录、未知提交恢复与回执/后置验证，不能凭保存成功判断执行完成。

写入角色另需新表 SELECT/INSERT。签名原文是可广播交易材料，应由维护操作角色读取；当前无公开 HTTP 端点。现有 nonce/租约过期不自动重新分配规则继续保留。依赖版本固定并同步 go.mod/go.sum。

```sh
./bin/maintenance-worker --attach-signed /absolute/signed.hex --job "$JOB_KEY" \
  --intent-digest "$INTENT_DIGEST" --owner worker-1 --token "$ACQUIRE_TOKEN" --generation "$GENERATION"
./bin/maintenance-worker --signed "$JOB_KEY"
```

本阶段 Go 全量 race/vet/build、生成契约、Linux amd64 无 CGO 构建、最终 maintenance/CLI race 与 boundary/whitespace 通过。smoke-gauge/smoke-vault 通过 38 项迁移和原链路；使用本地 Anvil eth_signTransaction 产生真实签名，CLI attach/retry/read 一致，交易哈希与 web3_sha3 一致，非零 value 的有效签名被拒绝，发送者 nonce 不变。保存前租约复查改动后再次运行 smoke-vault 通过。单元覆盖错误链/nonce/gas/fee/tip/value/目标/data、错误签名者、high-S、access list、合约创建、legacy、尾随字节及大小边界；复核 CLI 模式精确拒绝测试。仅使用公开测试密钥或隔离 Anvil 测试账户，未执行生产签名或广播。

### 2026-09-06 B10 广播与回执 RPC 传输

新增 chainrpc.SendRawTransaction 单次调用：先从原始签名字节计算交易哈希，仅接受一致的节点确认。传输失败、RPC 错误（包括 already known）、null、畸形响应和错误哈希均返回本地哈希及 ErrSubmissionUnknown，不能推断未发送或回收 nonce。原始材料限制 1–16 KiB；调用者仍须先验证签名意图并持久化提交记录。

TransactionReceipt 对显式 null 返回未观察到回执，缺失 result 或 RPC 错误仍报错；校验交易身份、块字段、执行状态、日志归属/顺序、topics 和 reverted 无日志约束。它不证明 canonical/finalized，也不证明业务后置条件。共享 RPC call 的既有读路径继续拒绝 null，只有该回执方法显式启用 nullable 响应。协议依据：https://ethereum.org/developers/docs/apis/json-rpc/ 。

验证：Go 全量 vet/race/build、生成契约、Linux amd64 无 CGO 构建、boundary/whitespace 和 smoke-gauge 通过。定向 race 覆盖未知结果、服务端已收请求但响应丢失、非法大小、错误哈希、回执/null/错误区别及畸形日志。新的 TestIsolatedAnvilSubmission 启动并清理独立本地 Anvil，完成真实签名广播、等待回执、成功状态/块哈希核对和 nonce 增长；不接受外部 RPC 地址。最初测试假设广播后立即有回执，被实际 pending 结果否定，已改为有界等待；故障注入测试的服务退出等待已修复并复测。

本阶段完成传输基础，未连接 maintenance CLI 或提交 outbox。CLI transactionSubmission/executionComplete 继续 false；持久提交状态、未知结果恢复、最终性及业务后置验证仍待完成。未生产签名或广播，整体 B01–B19 目标保持未完成。

### 2026-09-06 B10 持久提交记录与单次发送

迁移 39 新增 maintenance_submissions，绑定 job/intent/签名交易 hash/最新模拟 digest。Submit 在锁内复核保存的完整意图与签名、原租约、fresh preview、链/genesis、pending nonce、精确 gas/fee 模拟和观察块；提交 submission_unknown 记录后释放事务，再调用 RPC。确认 hash 匹配才写 acknowledged；网络失败、确认写入失败或取消保留未知。并发调用或跨进程重试返回原记录，不自动再次发送、不更换 nonce。原租约过期也能读取已有记录，但不能创建新提交。

CLI 新增独立 --submit 模式（manifest/request/from、transaction-hash、owner/token/generation 必填）和 --submission JOB_KEY。submit 不与 preview/attach/lease/history/fee 模式混用；首次发送前重新认证 manifest 与合约关系。unknown 尽可能输出可恢复 job/hash/status 并非零退出；inspect 不需要 RPC 或有效租约。describe stage=submission、submissionImplemented=true；没有执行任何操作的 describe 仍 transactionSubmission=false，executionComplete=false。

数据库集成测试证明发送前记录已对另一事务可见，8 并发仅一次 send；覆盖响应丢失、错 hash、发送后 context 取消导致确认无法保存、错误 fence/hash、模拟失败不创建记录、过期重试不发送、拒绝重新分配 nonce 及损坏记录读取拒绝。CLI 精确错误断言由子代理补充，主代理已复核并运行 race。

Go 全量 vet/race/build、生成契约、Linux amd64 无 CGO 构建及 boundary/whitespace 通过。smoke-gauge 通过 39 项迁移和新 CLI 真实本地广播、跨进程 retry/read、成功回执与 nonce 仅增加一次。新增广播最初影响旧投影 fixture 的严格块数，现将广播场景置于独立 Anvil snapshot 分支，测试后 revert 并确认回执消失，再继续原有投影回归；这也说明 acknowledged 本身不保证 canonical/finalized。另一次重跑在既有启动步骤遇到本地 RPC 502，进程已终止后重新运行通过。

尚未实现回执持久化、最终性和业务后置验证、未知结果再广播策略、取消/替换或生产 signer；submission_unknown 也可能是落库后发送前崩溃，不能视为已广播。整体后端任务保持未完成，未做生产签名或广播。

最终 smoke-vault 也通过：39 项迁移、同套单次提交/恢复读取测试、无市场 Vault 本金链路、奖励缓存与转换、回滚/重启和健康检查均通过。此前读取能力的缺失历史与 publicationEligible=false 边界保持不变。

### 2026-09-06 B10 回执恢复与 RPC 最终性观察

迁移 40 新增 maintenance_receipt_observations（单条 JSON 证据最多 64 KiB，摘要、追加 sequence、job 外键）。--observe-receipt JOB_KEY 验证完整签名/意图/submission 后检查 RPC chain/genesis、最新链头、finalized 和交易回执；存在回执时再次读取规范块并通过原 Observe 整块回执/日志交叉检查，结束前复查回执块和 head/finalized 锚点，链头时效 120 秒。任何失败不落部分证据。该操作不依赖原准备租约存活，不广播、不释放 nonce、不改变接收确认状态。

状态区分 not_observed、mined_success/reverted、finalized_success/reverted。最终性来自配置 RPC 的 finalized 声明与规范块一致性，不是 receipt-root 或独立共识证明；业务后置条件仍未核实。executionComplete=false、postconditionsVerified=false。--receipt-history JOB_KEY [--after SEQUENCE] 返回最多 100 条历史记录，重验摘要/身份/状态，标注 historical=true；后来的 not_observed 可以跟在先前入块证据之后，保留重组前记录而不声称其仍然有效。

验证：Go 全量 vet/race/build、生成契约、Linux amd64 无 CGO 构建、boundary/whitespace 与 Gauge/Vault 两套 smoke 通过。40 项迁移、真实隔离 Anvil 提交后观察入块、回滚 snapshot 后观察缺失、跨进程历史与分页一致均通过。数据库用例覆盖租约过期后观察、五条状态历史、错误链、非规范块、整块回执失败、晚期 reorg、过期链头拒绝与损坏历史拒绝；失败不追加记录。子代理补充纯状态边界测试，主代理审阅并修正 fixture 后再次定向 race 验证。chainrpc 的原回执字段校验提取为可复用函数，RPC 既有行为和测试保持通过。

尚未接入未知交易再广播、业务后置验证、自动维护调度和生产签名器。历史只是当时观察证据；整体 B01–B19 目标保持未完成。没有生产广播。

### 2026-09-06 B10 显式原交易重发恢复

迁移 41 新增 maintenance_rebroadcasts，以 job+attempt-id 幂等记录每次显式恢复请求。--rebroadcast 重新认证 manifest 与 fresh preview，绑定已保存交易 hash，验证完整 reservation/intent/signature/submission；只允许发送保存的原始签名字节。无需原准备租约继续有效，维护 DB 操作角色授权的是同一交易恢复，不是新签名或新 nonce。

初次执行恢复 ID 时，检查 RPC chain/genesis、回执缺失、确认 nonce、精确 gas/fee 模拟与规范块时效。NonceAtHash 使用 EIP-1898 blockHash+requireCanonical 查询确认状态（对应本机固定 go-ethereum 1.17.5 ethclient.NonceAtHash 的调用结构，并增加 requireCanonical=true）。pending nonce 变大可能仅代表原交易仍在队列，不单独阻止同字节重发；确认 nonce 已消耗或观察到回执则拒绝，并要求回执核对。

attempt 的 submission_unknown 在网络发送前提交，之后匹配 hash 的确认仅更新本 attempt 为 acknowledged。并发同 ID 只发一次；相同 ID 重试只读取，即使结果未知或条件改变也不再次发送。新的网络尝试需要显式新 ID；不同 ID 可请求相同字节多次，但仍为同一交易 hash。--rebroadcast-attempt JOB_KEY --attempt-id ID 可无 RPC 读取并校验。原 submission 与回执观察不被改写。

验证：Go 全量 vet/race/build、生成契约、Linux amd64 无 CGO 构建、boundary/whitespace 和 Gauge/Vault 两套 smoke 通过 41 项迁移。数据库验证过期准备租约后恢复、发送前另一事务可见 attempt、8 并发一次 send、pending 增长仍允许、回执/确认 nonce 消耗/模拟失败/错误链拒绝且不落库、未知结果重试不发第二次、改 hash 与损坏记录拒绝。真实隔离 Anvil 在 snapshot 回滚原交易后，CLI 重发同 hash 并再次入块，跨进程 retry/read 一致，nonce 仅增加一次；恢复分支随后回滚，原投影回归保持通过。子代理补充 CLI 与 hash-pinned nonce 边界测试，经主代理复核、补充精确混合模式拒绝后定向 race 通过。

未实现费用替换/取消、业务后置条件、自动维护调度与生产签名器；explicit recovery 不自动循环重发。executionComplete=false。整体后端目标未完成，未生产广播。

### 2026-09-06 B10 五类后置状态验证

从实际合约实现提取条件：Curve accruedCurveFees=0；Gauge deferredForfeiture quote/meme 均 0（内部 catch 可让失败 flush 仍成功返回）；AllocationManager pending=false/principal=0；Treasury activatedAt 非零且不晚于块时间并绑定规范 tokens；checkpoint 检查完整 32 槽，无到期非空项且字段一致。允许未来激活项存在。抽取 maintenanceTarget 复用原部署与市场认证，历史后置检查不再次模拟已完成操作。

迁移 42 / maintenance_poststates 保存状态证据及摘要，以 job+receipt sequence 组合外键约束回执归属。--verify-poststate JOB_KEY --manifest FILE 先执行 fresh receipt observation，只接受 finalized_success，再读回执区块的已认证目标状态并复查 finalized 锚点；只有 satisfied=true 时单任务输出 executionComplete/postconditionsVerified=true。条件未满足保存 false，RPC/ABI/身份错误不保存后置结果。完成判定是当时规范区块末尾的任务状态，不保证未来状态或独占因果；整体目标仍未完成。

验证：Go 全量 vet/race/build、生成契约、Linux amd64 无 CGO 构建及 Gauge/Vault smoke 通过；最终组合 FK 和未最终确认拒绝测试在 Vault 复测通过 42 项迁移。合成 Anvil settle 交易最终确认后 pending/principal 清零，首次取得单任务完成输出；未最终确认时拒绝，回滚分支后历史仍保持一致。子代理提供五类基础测试，主代理补齐实际缺失的 flush/settle 非零、Treasury 零/未来时间与 token 错配、未来/非法/缺失激活槽等用例，并定向 race 复测。此为合成 runtime 集成验证，不声称真实部署端到端完成。

B10 自动调度、生产 signer、完整合约运行验收和其余 B01–B19 项仍待完成，未生产广播。

### 2026-09-06 B10 已提交任务自动巡检

迁移 43 增加 maintenance_reconciliation_queue。新 maintenance-reconciler --once/--run 从同链 submission 登记任务（每步最多 100 条），用 SKIP LOCKED、120 秒认领租约和 generation 处理一个到期任务。先核对配置链/genesis，再执行 fresh receipt observation；finalized_success 复用同一观察做后置验证，避免重复观察。等待态 30 秒复查、失败从 60 秒指数退避到 1 小时、完成/最终回滚态每小时复查。成功清除失败计数，过期旧 generation 不能覆盖新结果。

每步 60 秒超时，轮询间隔默认 5 秒、配置范围 1s..1m；支持 SIGINT/SIGTERM。--once 任务不可用会输出已调度的失败状态并非零退出，--run 保持运行。一个失败任务不会永久占据队首。队列是操作状态与证据引用，不是替代回执和后置证明的资金权威。该进程接口只含查询能力，不签名、不改变 nonce、不提交或重发；新业务维护请求自动发现/准备仍待开发。

验证：Go 全量 vet/race/build、生成契约、Linux amd64 无 CGO 构建、boundary/whitespace 及 Gauge/Vault smoke 通过 43 项迁移。数据库用例验证 8 并发唯一认领 4 个任务、活跃任务不重复获取、过期 generation 回收/旧 fence 拒绝、失败退避、未来到期时间、RPC 失败 Step 持久调度。真实隔离 Anvil+PostgreSQL 验证从 submission 自动发现到 verified_complete、跨进程再次运行 idle、--run SIGTERM 清洁退出，原回执/恢复/投影回归保持通过。子代理提供 CLI 参数与区间边界测试，主代理复核并运行定向 race。

尚未完成新任务发现/准备、生产 signer、完整部署运行验收及其余后端任务。整体目标保持未完成，未生产广播。

### 2026-09-06 B10 显式市场维护工作发现与去重

迁移 44 增加 maintenance_work_scopes。maintenance-worker --discover-work 接受显式 market/operation/from（settle 还需 user），在已认证的最新区块读取五类后置条件；满足时返回 not_needed，不新建任务。需要工作时模拟固定调用，将 scope、稳定 generation trigger、任务与模拟记录原子提交，返回 prepared。scope 绑定 chain/genesis/sender/request，重复和并发调用复用已有任务；旧任务尚未通过 fresh finalized receipt 与后置验证时返回 awaiting_existing，不分配新的任务代次。

已有任务校验与 scope 身份一致。嵌套后置验证前释放数据库锁与连接，验证后重新锁定并核对 generation，避免连接池耗尽和并发覆盖。接口不接受调用者 trigger、目标或交易内容，不预留 nonce、不签名、不发送。not_needed 仅表示当前无需工作，不等于已有任务执行完成；awaiting_existing 也可能表示旧任务证据暂不可用，需继续巡检。过期未发送任务仍保留，不自动放弃或替换。

验证：Go 全量 vet/race/build、生成契约检查及 Linux amd64 无 CGO 构建通过；最终定向 maintenance/deployment/CLI race 通过。Gauge/Vault 隔离 PostgreSQL+Anvil smoke 通过 44 项迁移，覆盖无工作不建任务、需要工作生成一条模拟、4 并发复用同一 generation、nonce 不变。最终 Gauge 复测包含 scope payload 篡改、绑定其他合法任务、恢复后幂等及非法 sender/trigger 拒绝。CLI 拒绝缺失参数及混入提交/租约/预览参数。集成使用合成 runtime；尚未在本轮覆盖完成后 generation 递增的正向端到端链路。

当前入口逐个检查显式范围，全市场/全账户游标扫描及自动准备编排尚未接入。B10 和整体后端任务仍未全部完成，未生产广播。

### 2026-09-06 B10 全市场持久扫描

迁移 45 / maintenance_scan_queue 与 maintenance-scanner --once/--run 自动从 canonical finalized discovered markets 枚举四类市场级维护操作。每步最多登记 100 个新组合，认领一个到期组合，复用 DiscoverWork 的链上认证、固定模拟和任务去重。先检查 RPC chain/genesis、数据库 genesis 与 discovery checkpoint；失效 checkpoint 不产生扫描认领。发现清单可扩展市场 runtime，不以候选数据代替现态认证。

队列按链实例/sender/market/operation 隔离，SKIP LOCKED、120 秒租约和 generation 保证并发认领及过期 fencing。正常 60 秒重查，失败从 60 秒指数退避到 1 小时；缺失目标清单或不适用操作作为单组合 unavailable 处理。--once 输出失败状态并非零退出，--run 继续且支持 SIGTERM；不依赖进程内游标，不签名或发送交易。

Go 全量 vet/race/build、生成契约检查与 Linux amd64 无 CGO 构建通过。Gauge 隔离 PostgreSQL+Anvil 链路通过 45 项迁移：四类操作自动发现、跨进程 idle、既有 sweep 复用、nonce 不变、SIGTERM；数据库测试验证 8 并发只认领 4 个不同组合、活跃租约不重复、过期恢复 generation+1、旧 generation 拒绝、失败退避及 discovery checkpoint 失效拒绝。CLI 测试由子代理补充，经主代理逐项复核。Vault 完整复测通过，包括最终 scanner race 集成测试。首次 Vault 测试暴露断言错误：失败计数已有历史值，已改为验证在原值上递增并检查租约释放，复测通过。最终 maintenance/CLI 定向 race、boundary 与 whitespace 检查通过。

尚未自动枚举 settle-rage-quit 用户账户，也未接入自动 nonce/意图/签名编排。全后端 B01–B19 目标仍未完成，未生产广播。

### 2026-09-06 B10 已投影账户自动发现

迁移 46 为维护扫描队列增加 user_address 并扩展组合主键；非账户操作必须为空 user，settle-rage-quit 必须为规范非零账户。扫描器每步从规范 gaugePositions 登记最多 100 个新账户，复核规范市场来源；每次认领要求账户来源仍存在。选择、认领 generation 与结果提交均绑定用户。已有市场队列保持兼容。

不依赖投影 pending 标志作维护判定，而是遍历已知账户并复用 DiscoverWork 的实时认证与 pending/principal 检查。候选来源只是提示，不是交易授权。范围受 finalized projector 已处理账户限制，未声称覆盖未索引账户。自动 nonce/意图/签名编排及其余后端任务仍未完成。

验证：Go 全量 vet/race/build、生成契约检查、Linux amd64 无 CGO 构建及最终定向 maintenance/CLI race 通过。Gauge/Vault 两套完整 smoke 通过 46 项迁移，包含真实隔离 PostgreSQL+合成 Anvil 的双账户隔离、投影 pending=true 但实时无需处理时不建任务、重复调用 idle、规范账户来源删除后不认领，以及原市场并发/generation 回归。首次 Vault 在原费用转换场景发生本地 RPC HTTP 502、进程已失败退出；新隔离环境完整重跑通过。boundary/whitespace 检查通过。测试未替代真实协议部署端到端验收，未生产广播。

### 2026-09-06 B10 原子交易准备入口

抽取 lease/nonce/intent 的事务内实现，原公共方法保持独立提交语义；Store.Prepare 复用同一事务记录 preview、认领租约、预留 nonce、执行完整 gas/fee 模拟并保存固定 intent。模拟失败不会留下本次部分准备或推进 nonce 计数。新 --prepare-atomic CLI 使用显式 request、owner/token、TTL 和费用上限，先执行部署认证与 fresh preview；不接受混用执行模式。无需第 47 项迁移，当前仍为 46 项。

同有效 token 并发重试只保存一个 intent；不同参数不能改写已固定交易。未自动绕过过期租约或既有 nonce reservation，仍须使用现有检查/恢复边界。此入口不自动签名、广播或判定执行完成；后台自动调度和 signer 适配仍待完成。

验证：Go 全量 vet/race/build、生成契约及 Linux amd64 无 CGO 构建通过。Gauge/Vault 完整 smoke 通过，最终 Vault 将整个隔离 maintenance 数据库测试组改为 -race 并复测通过。覆盖精确模拟失败后 job/lease/reservation/intent 均不落库、nonce 不跳号、8 并发同 token 只一次成功模拟且同一 digest、费用改写拒绝、真实合成 Anvil CLI 跨进程重试结果一致，以及所有原分步租约/nonce/意图/签名/提交/恢复回归。测试初稿的共享发送者 nonce 和 CLI 缺少 operation 已修正后重跑。子代理 CLI 缺参/互斥/describe 测试经主代理复核，定向 race 通过。boundary/whitespace 通过，未生产广播。

### 2026-09-06 B10 后台交易准备调度

迁移 47 / maintenance_preparation_queue 和 maintenance-preparer --once/--run 从当前 work scope 任务中按 chain/genesis/sender 登记候选，最多 100 条/步。SKIP LOCKED、120 秒认领和 generation fence 处理单任务；无 intent 时复查最新认证状态及时间，再 fresh simulate、原子保存 300 秒准备租约/nonce/intent。显式 gas/fee 配置，不自动估价，不签名广播。

已保存 intent 的任务直接校验读取并结束准备调度，包括 intent 提交后队列提交前崩溃的情况；该恢复不新分配 nonce，也不恢复过期签名授权。无工作每 60 秒重查，失败从 60 秒退避至 1 小时。变更费用配置不覆盖已固定交易。旧任务/nonce 的签名恢复仍属后续工作，整体目标未完成。

验证：Go 全量 vet/race/build、生成契约、Linux amd64 无 CGO 构建通过；新增 CLI 测试经主代理复核、定向 race 通过。Gauge/Vault 完整 smoke 通过 47 项迁移，含发现的 sweep 自动准备、跨进程 idle、SIGTERM、链上 nonce 不变，以及数据库 crash-window 恢复后 digest/nonce 不变、准备租约过期仍仅读取旧意图、活跃认领不重复、过期接手 generation+1、旧 fence 拒绝和失败退避。隔离 maintenance 测试开启 race，既有投影/回执/恢复链路保持通过。boundary/whitespace 通过。集成仍使用合成 Anvil runtime，未生产广播。

### 2026-09-06 B10 外部签名器与单次签名请求

迁移 48 / maintenance_sign_requests 在执行前保存任务/intent digest/准备 generation。Store.Sign 验证固定 intent 和租约，提交未知请求后调用 Signer；并发与后续重试不会再次调用。有效返回字节先持久保留，再按原 AttachSigned 检查授权并登记。若签名期间过期，返回 signed_available 保留证据，不登记为 signed_stored；无可验证结果保留 signing_unknown。读取已签交易不续租。

ExecSigner 使用绝对路径程序、stdin 版本化 JSON、stdout 原始 hex；不拼 shell，不传私钥，不执行广播。30 秒超时、有限输出、stderr 隔离、完整固定字段与签名恢复校验。--sign-with CLI 只接受 job/digest/lease fence；异常结果非零退出。生产签名设施、自动签名调度及授权恢复仍未完成。

验证：Go 全量 vet/race/build、生成契约、Linux amd64 无 CGO 构建通过。Gauge/Vault 完整 smoke 通过 48 项迁移；最终 Vault 以 race 验证签名请求在调用前可被另一事务观察、8 并发只调用一次、unknown 重试不签、租约过期返回字节持久保留且不附加。真实隔离 Anvil 已签测试字节经外部程序适配保存，第二进程重试时程序改为失败仍返回原交易，原提交/回执/恢复链路通过。ExecSigner 单测覆盖正确字节、非法输出、退出失败、输出超限、取消、超时及相对路径；子代理 CLI 精确拒绝/describe 测试经主代理复核。boundary/whitespace 通过。均为本地测试程序与公开测试密钥，未生产签名广播。

### 2026-09-06 B10 固定意图授权恢复

迁移 49 / maintenance_authorization_recoveries 与 --recover-authorization 显式接收恢复 ID、固定请求/digest/原 fence。仅对过期且未释放、没有 submission 的原 intent，fresh 部署认证/preview 后检查完整调用模拟、chain/genesis/规范块/时效和 nonce 可用性。未知签名且没有可验证返回字节时拒绝。事务内保留新模拟/审计、按原 TTL 恢复原 owner/token/generation，不改 intent、nonce 或费用。同 ID 重试只读原结果，不延长窗口。

恢复 signed_available 后 Sign 只保存原字节，不能再次调用 signer。未请求签名的过期 intent 也支持此显式恢复。现有 ChangeLease 对普通过期租约仍拒绝，恢复不绕过 released 状态。签名未知结果导入、自动签名调度、生产设施与完整协议运行验收仍待完成。

验证：Go 全量 vet/race/build、生成契约、Linux amd64 无 CGO 构建通过。Gauge/Vault 完整 smoke 通过 49 项迁移；隔离 race 数据库测试覆盖 unknown 拒绝、released 拒绝、精确模拟失败/错误链/nonce 消耗拒绝且无恢复审计落库、同 ID 同结果不延长、恢复后登记原签名字节且签名器总调用仍为 1、intent digest 与 nonce 不变。CLI 真实合成 Anvil 流程覆盖未签名后台任务的过期授权恢复、跨进程相同 ID 重试和链上 nonce 不变。子代理必填/互斥/describe 测试经主代理复核并定向 race；boundary/whitespace 通过。均为本地测试环境，未生产签名广播。

### 2026-09-06 B10 未知签名结果导入

迁移 50 / maintenance_signature_imports 与 --import-signature 接收恢复文件、显式 expected hash 和原 fence。必须有既有 sign request，验证固定 intent/nonce/generation、签名及全部字段；返回字节和首次导入审计原子提交，session_user 由数据库提供。同结果幂等，不能覆盖另一份已固定字节。

导入仅保存证据，不续租、签名或广播。对过期 unknown 请求，导入后可走上一阶段的 fresh authorization recovery，再保存同一签名字节；实际 signer 调用次数保持 1。主动释放仍不能恢复。外部文件应取自原签名设施记录，系统只验证与固定意图的匹配，不宣称能证明外部设施没有自行重签。

验证：Go 全量 vet/race/build、生成契约、Linux amd64 无 CGO 构建通过。Gauge/Vault 完整 smoke 通过 50 项迁移；最终 Vault 隔离 race 测试覆盖没有 sign request、错误 hash/fence/签名字节拒绝且无审计记录；8 并发导入只一条 session_user 审计；导入后 lease 仍过期、signed 表仍无记录；随后恢复授权和保存签名成功，signer 调用次数仍为 1。CLI 跨进程相同文件导入幂等，原链路保持通过。子代理 CLI 必填/互斥/describe/文件错误测试经主代理复核，补充空字节及边界超长 raw 检查；定向 race 与 boundary/whitespace 通过。仅本地测试，未生产签名广播。

### 2026-09-06 B10 持久自动签名调度

迁移 51 / maintenance_signing_queue 与 maintenance-signer --once/--run 接入后台已准备的 active scope 任务。按 chain/genesis/sender 隔离，每步最多登记 100 条，以 SKIP LOCKED、120 秒认领和 generation fence 逐项处理。核验固定 intent、reservation 和 maintenance-preparer 原授权后调用现有单次 Sign 流程；不创建 nonce、不改费用、不自动续租、不广播。

签名结果未知或字节已返回但未授权登记时，每 60 秒读取恢复状态，不再次调用签名设施；已保存结果停止调度。一般错误持久退避至最多 1 小时。显式导入/授权恢复后可继续登记原结果。签名保存与队列完成之间崩溃，重启可在租约过期后复用原签名。配置要求绝对可执行文件路径，启动前拒绝缺失文件、目录和无执行权限文件；默认 scratch 镜像所需原生程序/解释器边界已记录。

验证：全量 Go fmt/vet/race/build、生成契约检查、Linux amd64 无 CGO 构建和 boundary/whitespace 通过。Gauge/Vault 两套完整 smoke 均通过 51 项迁移及隔离 PostgreSQL/合成 Anvil 验证：过期授权不创建签名请求，8 并发只调用一次签名器，未知结果复查不重签，sender 隔离、领取过期与旧 generation 拒绝，原结果导入后队列排空，签名已保存但队列未完成的重启恢复，以及 CLI idle/SIGTERM 和链上 nonce 不变。子代理 CLI 测试已复核并补充不可执行路径场景。期间修正迁移数量更新误改 readiness 断言及 smoke 变量名错误，修正后完整重跑通过。

本阶段验收仅覆盖本地合成链环境；未使用生产签名设施、未进行生产广播。自动提交编排、真实协议端到端、生产设施与其余 B01–B19 验收仍待完成，不将本阶段视为全部后端完成。

### 2026-09-06 B10 持久自动提交调度

迁移 52 / maintenance_submission_queue 与 maintenance-submitter --once/--run 接入 active scope 的自动签名结果。按 chain/genesis/sender 隔离、每步最多登记 100 条、SKIP LOCKED/120 秒领取/generation fence。首次发送前检查固定签名和原准备授权，fresh 部署认证并完整参数模拟，经现有 Submit 提交持久 outbox 后仅发送一次。一般故障退避至 1 小时，过期授权保留显式恢复状态，不自动续租。

已有 submission 先于 RPC 调用读取；acknowledged/unknown 均停止自动提交，由 reconciler 与显式恢复入口处理。响应丢失及提交后队列未完成的崩溃不会再次发送。节点接受不代表链上执行成功，不修改 nonce/fee、不重新签名。费用替换/取消、预算策略、生产设施及真实协议完整运行验收仍未完成。

验证：最终全量 Go fmt/vet/race/build、生成契约检查、Linux amd64 无 CGO 构建、boundary/whitespace 通过。Gauge/Vault 完整 smoke 通过 52 项迁移。隔离 race 测试覆盖过期授权无 submission 写入、8 并发仅一次网络发送、发送前另一连接已可读取 unknown outbox、响应丢失/原租约过期后的无 RPC 恢复、sender 隔离、认领超时/generation 旧写拒绝、unknown 不再次调度。CLI 覆盖队列处理、已接受结果与持久记录一致、跨进程 idle/SIGTERM；命令行描述/错误配置测试由子代理补充并经主代理复核。提交测试仅发生在本地合成 Anvil；没有生产广播，也不宣称该节点接受状态是最终执行成功。

### 2026-09-06 B10 累计 Gas 提交预算

迁移 53 为 chain/genesis/sender 新增配置、配置变更审计及每 job 唯一预算占用。所有首次 Submit 必须配置单笔/累计最高 Gas 承诺上限；按固定签名 gasLimit × maxFeePerGas 用 uint256 整数计量。预算行锁、allocated、charge 与 submission outbox 同一事务提交，任一超额/缺失/授权过期全部回滚，无网络发送。重试读取既有 outbox 不重复占用；后台提供 budget_required/budget_exceeded 状态。

maintenance-budget 使用独立 operator DSN 显式设置/检查。配置 request ID 幂等，审计 revision/session_user，不清零已占用额度；不能降至占用以下。费用承诺不因失败、未知或成功自动释放，无时间重置，不宣称是实际费用、每日开销或完整历史。旧 submission 不补造 charge；生产切换需盘点历史并落实列级最小权限。费用替换/取消、真实费用独立对账和生产验收仍待完成。

验证：最终全量 Go fmt/vet/race/build、生成契约检查、Linux amd64 无 CGO 构建和 boundary/whitespace 通过。Gauge/Vault 完整 smoke 通过 53 项迁移。隔离 race 数据库测试覆盖预算缺失/单笔超限不发送、8 个不同 job 争用仅一笔额度时只有一次发送且只有一条 outbox/charge、未知结果仍占用、同 job 重试不再扣记、配置幂等/同 ID 改参数拒绝、不能降至已占用以下、提高额度保留占用并允许下一笔，以及 session_user 审计。CLI 配置重试和 inspect 经真实隔离数据库验证；子代理参数测试已复核。修正旧巡检测试固定四个任务的假设后，两套完整环境重新跑通，现逐项核对所有提交而保留重复/过期领取检查。没有生产额度配置或广播。

### 2026-09-06 B10 最终回执执行 Gas 费用观察

迁移 54 / maintenance_gas_observations 与 maintenance-gas --observe/--history 提供整数费用证据。链身份/规范块/全块回执一致性/RPC finalized 验证后读取 gasUsed/effectiveGasPrice；缺字段、回执身份不一致、再次检查时重组、Gas/费率超过固定签名上限均拒绝。来源 receipt sequence/digest、intent digest、实际执行 Gas 乘积和最高预算承诺一起保存，分页历史重新核对记录摘要和来源。

只统计执行 Gas，totalNativeFeeKnown=false；不证明网络额外费用完整性或 receipt root/共识。重复观察不得相加，历史不作当前规范性证明。预算保持不变，不自动释放或结清，不声明操作完成。旧 journal 编码不变。自动费用巡检、完整费用独立对账、费用替换/取消与生产验收仍待完成。

验证：全量 Go fmt/vet/race/build、生成契约检查、最终 Linux amd64 无 CGO 构建和 boundary/whitespace 通过。Gauge/Vault 完整 smoke 通过 54 项迁移；Gauge 最后阶段暴露自动提交新增区块而旧脚本假设 idle，修为有界追平后重跑通过。隔离数据库测试覆盖成功/回退费用、未最终回执、缺字段、Gas/费率超上限、基础回执不一致、费用读取期间重组拒绝、分页和篡改拒绝，以及观察前后预算完全一致。RPC 单测覆盖缺字段/非法数量/交易身份和明确 null，CLI 单测已复核。真实本地 Anvil 费用与 receipt gasUsed×effectiveGasPrice 一致；回滚链后 fresh observe 拒绝而历史记录保留且明确 historical。没有生产读取配置、签名或广播。

### 2026-09-06 B10 后台执行 Gas 费用观察

迁移 55 在 reconciliation_queue 中增加独立 gas 状态/sequence/失败计数，并以 job+receipt_sequence+gas_sequence 复合外键绑定当前同源证据。Reconciler 的 RPC 接口明确要求费用读取，复用本次 fresh receipt；最终成功/回退都观察执行 Gas，15 秒子上下文限制费用调用。费用失败不掩盖原业务状态，--once 对费用 unavailable 非零退出，--run 继续。

独立费用退避首 60 秒、最多 1 小时，与业务巡检取较早时间，恢复清零。旧 generation 不能覆盖状态；后续回执缺失/未最终会清空当前费用引用，保留 historical 记录。预算不动，不重新发送。完整网络费用与独立结清对账、费用替换/取消及生产验收仍未完成。

验证：全量 Go fmt/vet/race/build、生成契约检查、Linux amd64 无 CGO 构建、最终定向 maintenance/reconciler race 和 boundary/whitespace 通过。Gauge/Vault 完整 smoke 通过 55 项迁移，CLI 自动费用记录与业务结果的 receiptSequence 相同，独立手动观察仍有独立历史/分页证据。隔离数据库测试覆盖最终回退但费用不可用时保留业务状态、费用失败 60 秒调度且不立即重取、恢复后记录同源费用、后续回执缺失清空当前 gasSequence/失败计数、预算前后完全一致；现有认领过期/generation 测试继续通过。仅本地合成链验证，未生产运行或广播。

### 2026-09-06 B08 Go 奖励转换候选规划

新增 internal/settlement 与 settlement-worker --request/--plan，保留 Staker epoch=0/历史 Creator epoch 边界，按地址排除已成熟 raw exit、排除零金额、拒绝重复 user+epoch。限制最多 32 人与单批/总 Meme cap；uint256 十进制和累计溢出检查。quote 绑定 chain/market/顺序/角色/金额 SHA-256 摘要，30 秒有效期，deadline 0..300 秒，0..100 bps 整数最小到账。单报价单批，不自动拆分。纯候选不能证明 fresh 状态或价格真实性。

CLI 严格输入、1 MiB 上限及 request/plan 两步；planningImplemented=true、executionImplemented=false，明确候选/链上/价格未验证且无提交。没有增加 RPC、数据库或签名依赖。Go 比 TS 对零地址、uint256/安全整数范围和缺失集合更严格；有效计划保持现有 TS wire contract。

fresh operator/市场/用户归属与额度校验、独立价格/流动性、实际执行与公平调度仍未实现，不能标记 B08 完成。

验证：全量 Go fmt/vet/race/build、生成契约（新增 settlement golden）、Linux amd64 无 CGO 构建、最终定向 planner/CLI race、boundary/whitespace 通过。7 组 TS 对照包含空批次、混合角色、raw exit 时间边界、32 项、uint256 最大值和零滑点；负例覆盖报价陈旧/未来/摘要变更、重排/epoch/金额变更、退出状态变更、人数/金额上限和舍入为零。跨进程 smoke-settlement 全部计划与 TS 一致，unsupported 执行拒绝。子代理 CLI 测试经复核并修正未知字段/真正超过 1 MiB 的边界断言。Gauge/Vault 两套完整回归均通过现有 55 项迁移。

检查期间制品 manifest 来源摘要变化；核对事件定义完全一致后，仅重新生成 Go catalog 的来源摘要，最终 contract-check 通过。没有奖励转换链上执行、生产签名或广播。

### 2026-09-06 B08 奖励转换链上状态观察

新增 ObserveRewardConversionState 与 settlement-worker --observe-state/--manifest。固定最新区块哈希，校验 120 秒/未来 5 秒时效、chain/genesis、明确部署 runtime、core graph、FeeVault/Creator registry 关系、operator、已毕业市场/token/fee policy/gauge identity；读取历史 Creator beneficiary/liability、Staker 预览奖励和 rage quit pending。支持多市场实例清单，最多 32 个唯一 user+epoch。成熟 raw exit 按地址排除所有角色，禁用 staking/待结算 rage quit/零奖励返回明确原因；绑定、ABI、RPC、重组错误整次拒绝，不输出部分状态。

输入不接收调用者提供的金额，输出包含区块及 eligibility/availableMeme。stateObserved 仅表示配置 RPC 的状态观察，不证明独立价格、流动性、偿付能力或执行许可，也没有自动绑定候选计划。原 request/plan 保持 candidateOnly。无数据库迁移、签名或广播；实际执行与公平调度等 B08 剩余项继续保留。

验证：Go 全量 fmt/vet/race/build、生成契约检查、Linux amd64 无 CGO 构建、定向 deployment/CLI race、TS 对照 smoke-settlement 及 boundary/whitespace 通过。Gauge/Vault 完整烟测通过既有 55 项迁移；新增临时快照内的合成 Anvil CLI 验证两类角色、禁用 staking、错误 operator 拒绝及 nonce 不变，结束恢复快照。单元测试覆盖多个市场实例、退出成熟/未来边界、pending rage quit/零奖励、错误受益人/identity、短 ABI、最终重组、链不匹配、未毕业和输入边界，失败无部分输出。子代理初稿复核后发现异常测试被旧时间提前短路，已改用完整新鲜成功 fixture 并补齐逐项失败与角色测试。测试仍为合成 getter，不代表真实协议结算端到端或生产验收。

### 2026-09-06 B08 实时观察绑定候选请求与计划

新增 settlement.ObserveCandidate 与 --observed-request/--observed-plan。输入只提供 operator、市场、用户/epoch/选择金额上限、批次上限和报价策略；链身份、时间、额度和退出状态由显式 manifest + fresh RPC 提供。每次命令独立读取完整认证状态，按 min(选择上限,可用奖励) 构造候选，eligible=false 即使有余额也排除；保留顺序/角色并校验对应关系。评估时间取墙钟和块时间的较大值，处理观察后退出成熟，输出 evaluatedAt。

计划重新读取后的金额摘要必须匹配报价；链余额减少或选择上限变化使旧报价失效。返回状态与请求/计划证据，但 candidateOnly=true，价格/偿付能力未验证，无执行、签名、提交或数据库迁移。还需独立行情/流动性、偿付能力、执行模拟/持久授权、退款对账和公平调度；B08 与全后端目标保持未完成。

验证：全量 Go fmt/vet/race/build、生成契约、Linux amd64 无 CGO 构建、TS 对照 smoke-settlement、boundary/whitespace 通过。Gauge/Vault 完整烟测通过 55 项迁移；真实子进程在合成 Anvil 验证实时请求/计划、Staker 余额裁剪、Creator 选择上限、禁用 staking、旧报价在选择或链余额变化后拒绝、新请求使用更新余额，以及发送者 nonce 不变。单测覆盖正余额不合格排除、观察后退出成熟、时间/身份/顺序不一致、报价金额摘要变化和数据无别名；子代理初稿的时间编码与测试隔离问题经复核修正。CLI 拒绝调用者提供 now/chainId/rawExitAt/state/availableMeme。没有真实部署结算端到端或生产广播。

### 2026-09-06 B08 固定结算调用模拟与假设分配

新增 PreviewConversion / settlement-worker --preview。重新完成实时候选与报价绑定后，只编码已认证 FeeVault 的 settleRewards 固定 ABI，明确 operator from、value=0、观察块哈希和 requireCanonical；仅非空单批，按块时间检查 5 分钟期限。严格解码两个 uint256，验证 0<spent<=total、received>=minimumQuote，并按当前 Solidity 累计 floor 规则推导每人消耗/退款/Quote 分配，检查总量守恒与正消耗零 payout 拒绝。模拟后重新核对块、观察/报价时效和 deadline。

输出 simulated_unsigned/hypotheticalAllocations=true，仅是假设结果。未证明实际部分成交退款或权益到账，不将合约内检查宣称为独立价格/流动性/偿付能力证明；相关 verified 字段保持 false。无持久执行、签名、广播或迁移。价格/路径认证、真实执行和最终事件对账等 B08 及总后端目标仍未完成。

验证：Go 全量 fmt/vet/race/build、生成契约、Linux amd64 无 CGO 构建、TS 计划对照 smoke、定向 settlement/CLI race、boundary/whitespace 通过。Gauge/Vault 完整烟测通过既有 55 项迁移。合成 Anvil 中实际 CLI eth_call 成功，固定 from/to/value、分配合计/退款和 nonce 不变；模拟后代理注入规范块变化，确认调用已发生后整次拒绝；零/超额消耗、低于最低到账、短 ABI 返回均拒绝。子代理累计分配用例复核后将零 payout 负例补成总量一致的独立场景。Go calldata 通过项目清单指定的编译 IProtocolFeeVault ABI + viem 独立对照；首次使用默认 contracts/out 发现旧制品缺少 settleRewards，已改用权威清单 out-v1 路径并重新跑通两套完整烟测。仍非真实部署结算端到端或生产验收。

### 2026-09-06 B08 直接奖励转换路径身份认证

新增 ObserveRewardConversionRoute，并作为 --preview 的必经检查。PoolManager 外部地址/runtimeCodeHash pin 必须显式提供，TickerGardenMemeHook 必须是部署 manifest 中认证的对应实例。固定同一新鲜区块核对市场/PoolKey/PoolId、币种排序、零 fee/有效 tickSpacing、hook Registry/FeeVault/PoolManager 与 FeeVault PoolManager 绑定、hook 0x2044 权限位和声明、active poolBinding market/keyHash/sourceVersion、activeFeeSource。缺失、矛盾、代码不匹配或重组整次拒绝，不能降级到旧模拟。

输出 preview.route 与 routeIdentityVerified=true；认证范围是奖励转换直接使用的 FeeVault→Hook→PoolManager，不误用普通 swapRouter/quoter 路径作证明。操作者配置仍是信任锚，不证明外部共识、价格或流动性；priceReferenceVerified/solvencyVerified 保持 false。无数据库/签名/发送改动。独立行情、池状态/偿付能力、持久执行及实际退款对账仍未完成。

验证：Go 全量 fmt/vet/race/build、生成契约、Linux amd64 无 CGO 构建、TS smoke-settlement 和 boundary/whitespace 通过。Gauge/Vault 完整烟测通过 55 项迁移；临时合成 Anvil 提供完整直接路径，原模拟/ABI 对照/模拟后重组测试继续通过，错误 PoolManager hash 在模拟前拒绝，nonce 不变。单测复核并补充显式语义变更：成功路径、缺 hook manifest、外部 runtime/hash、hook/vault 的 manager 边、hook vault 边、binding 状态、市场 poolId、active version、hook runtime/权限、短 ABI、陈旧与最终重组均覆盖，失败无部分输出。缺 PoolManager pin 在任何 RPC 之前拒绝。仍非真实部署奖励结算端到端或生产验收。

### 2026-09-06 B08 同块池状态与转换手续费边界

已认证 PoolManager 增加 hash-pinned extsload：按固定 v4 StateLibrary 的 pools slot=6、liquidity offset=3 读取 slot0 和活跃流动性。输出整数 sqrtPriceX96、有符号 tick、protocolFee/lpFee、uint128 activeLiquidity、stateSlot。严格 ABI 长度/保留位及 TickMath 范围检查；非零手续费拒绝，与当前 reward conversion callback 一致。模拟前同时限制 total Meme<=int128.max。当前活跃 liquidity 为零不单独拒绝，不将该值等同跨 tick 深度。

此为同池瞬时状态，仍不证明独立价格、可成交深度或偿付能力；不做 decimals/法币换算或 tick-price 数学复算。价格/深度/实际执行和退款对账等 B08 及全后端目标继续保留。

Go 全量 fmt/vet/race/build、生成契约、Linux amd64 无 CGO 构建、TS smoke-settlement、boundary/whitespace 已通过。新增 conversion-solidity-check 在临时目录执行仓库固定 StateLibrary，确认槽位、负 tick、fee 位和最大 uint128 liquidity；1 项 Solidity 测试通过。Go 单测覆盖 Q96、最小价格正例、最大价格拒绝、负 tick、tick 越界、双 fee、padding、短/长 ABI 与零/最大流动性；子代理初稿复核修正后补齐明确边界正例。

Vault 完整烟测通过 55 项迁移。Anvil 使用真实 SLOAD runtime 和设置存储验证 slot/value，代码 pin 不变而 LP fee 非零时拒绝，原路由/ABI/模拟后重组检查继续通过。Gauge 首次在既有 Reward HTTP 场景遇到非 JSON 错误响应；测试诊断已增加实际 HTTP 状态，保留原拒绝语义，无生产服务行为修改。

最终 Gauge 完整重跑通过，包括此前失败的 Reward HTTP 阶段及其余数据库/HTTP/关闭检查，未复现该响应异常；首轮原因未确认，不把重跑通过宣称为生产问题修复。没有生产网络配置、签名或广播。

### 2026-09-06 B08 FeeVault 同块余额覆盖核对

新增 ObserveConversionCoverage，作为 --preview 必经检查；RPC 接口明确要求 hash-pinned BalanceAt。重新认证 core/市场/反向映射/FeeVault Registry/Meme manifest 后，在同一块对 Meme 和 Quote 读取总负债与余额，原生使用 eth_getBalance、ERC20 使用 balanceOf。余额不足整次拒绝，恰好覆盖允许；Meme 总负债还须覆盖候选总额。uint256/规范十进制/严格 ABI，结束复查块与时效，无部分结果。

输出 assetCoverage 的 balance/totalLiability/surplus 及 vaultCoverageObserved=true。仅观察已认证 FeeVault 自身暴露的总负债，不能代替完整负债历史独立复算或未来/全协议偿付证明，solvencyVerified 保持 false。无迁移、签名、广播；独立价格、完整对账和持久执行等 B08/总后端目标仍待完成。

验证：Go 全量 fmt/vet/race/build、生成契约、Linux amd64 无 CGO 构建、定向 deployment/settlement/CLI race、TS smoke-settlement 与 boundary/whitespace 通过。Gauge/Vault 完整烟测通过既有 55 项迁移；Anvil 真实原生余额与 ERC20 getter/全局负债读取一致，原生余额降到负债以下时模拟前拒绝，nonce 不变，原池/路径/ABI/模拟后重组检查继续通过。单测涵盖 ERC20/原生、恰好覆盖/盈余、两种资产不足、异常 ABI/非规范或超 uint256 原生数量、RPC 失败、缺 Meme manifest 与最终重组，失败无部分输出。子代理原生正例失败定位为夹具将十六进制 ABI 的 0x20 与十进制 25 比较，已统一 20/25 并增加实际数值断言后通过。仍非真实部署奖励转换端到端或生产验收。

### 2026-09-06 B08 签名参考价与流动性策略核验

新增 ReferencePolicy/ReferencePrice/SignedReference/CheckReferences 和 --reference-check。独立 operator 环境文件绑定 chain/genesis/market/assets、2..8 个不同来源 ID/Ed25519 公钥、1..60 秒有效窗口、0..100 bps 偏差和该市场活跃 liquidity 阈值。所有来源必须有效；候选不能提供策略替代信任锚。签名域固定版本及有序 JSON，覆盖资产对、请求摘要、时间与最小资产单位有理价格。拒绝缺失/重复、签名错误、域不符、陈旧/未来/过期、非法数量及阈值异常。

以完整整数交叉乘法核对模拟 received/spent 与每个参考价的偏差，并检查 minimumQuote 对本次模拟 spent 的下界。只否决，不改 calldata/minimumQuote；保留部分模拟成交，但不推断未来全额成交价格保证。输出签名核验/模拟价格策略结果、来源、时刻、最低到账及策略/签名参考数据快照。providerIndependenceVerified=false，真实来源审核和自动提供方适配仍未完成；旧 --preview 为未核验参考价的诊断，不是执行许可。没有使用 B14 展示价格作为链上结算输入，没有交易签名或广播。

验证：Go 全量 fmt/vet/race/build、生成契约、Linux amd64 无 CGO 构建、定向 settlement/CLI 检查、TS smoke-settlement、boundary/whitespace 通过。Gauge/Vault 两套完整烟测通过 55 项迁移；Node 生成仅进程内短期测试密钥，跨进程签名/Go 核验成功，篡改签名拒绝；全部数据明确是合成参考源。单测覆盖正确与部分成交、精确时效/价格边界、零偏差、同 key/ID、缺响应、所有域变化、签名/时间/比率/最低到账/liquidity/策略scope 错误，失败不输出部分结果。子代理草稿编译及密钥/价格方向问题由主代理重写 fixture 并补齐负例后通过。真实提供方独立性、行情自动获取、完整对账及持久执行等 B08 与总后端目标继续保留。

### 2026-09-06 B08 有界签名参考价 HTTP 获取

新增 FetchReferences 与 --fetch-reference-check。可信 policy 指定 source endpoint，默认 HTTPS；URL userinfo/query/fragment 拒绝，显式测试开关仅允许 IP 字面量 loopback HTTP。所有配置预检后最多 8 个并发 POST，请求仅含版本/chain/genesis/market/assets/requestDigest。每源一次、单请求 15 秒/整体 20 秒、64 KiB/严格单 JSON、HTTP 200/application-json；不跟随重定向、不重试、不降级来源。任一失败取消并等待其余结束，不返回部分证据，错误不泄露端点/响应内容。

来源 ID 必须与请求目标对应，结果继续走原签名/时间/价格/流动性策略；CLI 获取后再复核观察块和原报价/deadline。fetch 模式不混用输入 references，返回 referencesFetched=true。普通手动模式保留。此为通用签名协议客户端，实际提供方、鉴权适配、独立性审核仍未接入；没有价格真实性/生产执行宣称或交易发送。

验证：Go 全量 fmt/vet/race/build、生成契约、Linux amd64 无 CGO 构建、TS smoke-settlement、boundary/whitespace 通过。Gauge/Vault 完整烟测通过 55 项迁移，真实 CLI 对本地两个端点各一次 POST，并用既有 Node 签名完成 Go 策略核验。单测覆盖 HTTPS、loopback opt-in、配置错误零请求、HTTP status/content type/格式/未知字段/超限/尾随数据、来源不匹配/签名错误、重定向零跟随、调用前和进行中取消；HTTP/解析错误与签名错误分别断言，无部分结果。子代理草稿重复 URL/返回同一来源问题由主代理重写测试后修正。取消测试首轮 client 已返回但 httptest.Server 因未读取请求体卡在 Close，堆栈确认后补充读取/显式测试清理，最终定向与全量回归通过。生产供应方和持久执行等 B08 与全后端目标继续保留。

### 2026-09-06 B08 核验证据本地原子留档

两种 reference-check CLI 新增可选 --evidence-dir，仅在完整模拟、签名策略和最终区块/时效复查后写入版本化 manifest/result 快照。SHA-256 覆盖实际文件字节；输出绝对路径及摘要。要求现有真实目录，0600 临时文件先 fsync，再以 hard link 原子不覆盖发布，目录 fsync；相同内容复用，既有损坏内容/符号链接拒绝，失败无成功 JSON。没有执行输入导入路径，不将快照变成签名或交易授权。

验证：定向 CLI race（12 路并发相同内容、摘要/信封/权限、临时文件清理、重复内容、既有损坏与符号链接、缺目录/非法 JSON、未核验模式拒绝）、Go 全量 fmt/vet/race/build、生成契约、Linux amd64 无 CGO 构建、TS smoke-settlement、boundary/whitespace 通过。Gauge/Vault 两套完整烟测通过既有 55 项迁移；真实 CLI 获取签名参考价后生成文件，Python 独立摘要/manifest/result 对照一致；错误签名不生成新文件。没有生产广播。

范围为可信本地目录中的审计留档，不承诺防管理员篡改、远程存储或崩溃后的自动垃圾清理；发布后 fsync/输出失败可能留下完整文件。真实来源、数据库执行任务、自动报价、签名/提交/回执及完整退款对账仍未完成，全后端目标继续保留。

### 2026-09-06 B08 数据库核验记录

第 56 项迁移增加 settlement_checks：chain/genesis/market/request/block 身份、唯一内容摘要、完整版本化 manifest/result、固定 checked_unsigned 状态及查询索引。VerifyConversion 将完整实时核验集中到单一入口，产生包外不可构造有效内容且不暴露可变底层字节的核验值。Store.Record 仅接收此值；事务内插入/重复检查、逐字段和字节校验。两种 CLI 核验模式增加 --record，独立 TG_SETTLEMENT_DATABASE_URL；--check-history 提供 100 条上限的链/创世块/市场/序号分页及内容/身份一致性核查。

这是执行前观察记录，不是已授权执行队列；不导入旧证据、不签名/发送。应用只插入/读取，数据库管理员仍可修改表；数据库与可选文件导出不是跨存储事务。后续仍须增加执行生命周期、实时重核验、角色独立签名、gas/nonce/未知提交恢复和回执/退款对账。

验证：Go 全量 fmt/vet/race/build、生成契约、Linux amd64 无 CGO 构建、跨进程 TS smoke-settlement 与 boundary/whitespace 通过。Gauge/Vault 完整烟测通过 56 项迁移；CLI 实时核验写入、文件留档和历史读取闭环通过；隔离 PostgreSQL 的 12 路并发相同记录返回同一序号，分页/异链/异 genesis/异市场隔离、空核验值拒绝、元数据和内容损坏检测通过。首轮失败为旧集成断言仍期待 55 项，更新后重跑通过。只读子代理复核指出数据库直接修改权限及历史语义核对边界：前者已明确文档范围，后者补充逐字段检测及负例。仍非实际协议奖励转换生产验收。

最终 Gauge 完整补验也通过：错误签名同时带 --record/--evidence-dir 时无成功输出，文件列表及数据库历史均未新增。未执行生产签名或广播。


### 2026-09-06 B08 链上路径自动报价

QuoteConversion/--quote 在完整实时权益、固定块路径、池状态和资产覆盖认证下，通过正数 minimumQuote=1 的只读 eth_call 获取实际 spent/received，输出绑定请求摘要的报价及来源块。探测不接受调用方 quote/references，输入滑点仍须合法。VerifyAutoConversion/--auto-reference-check 再次读取权益、以操作者真实滑点生成最低到账并模拟，之后走所有签名参考价及最终块/时效检查；不降级到探测结果，候选摘要变化整次拒绝。原始探测参数不作为交易授权，两个阶段均未发送交易。

输出完整 quoteObservation 并支持既有数据库/文件审计。仍需实际来源、持久执行任务、角色签名、提交恢复和回执/退款对账，不宣称 B08 或全后端目标完成。

验证：Go 全量 fmt/vet/race/build、生成契约、Linux amd64 无 CGO 构建、TS smoke-settlement、boundary/whitespace 通过；Gauge/Vault 两套完整烟测通过 56 项迁移。合成 Anvil 的 RPC 转发器直接捕获探测/最终 eth_call 参数，确认最低到账依次为 1/99；自动报价实际输出 100、消耗 7，签名来源仍全部通过。探测零消耗、最终到账 98<99、第二轮权益变化导致摘要不符均拒绝，且没有继续请求参考来源；显式输入 quote 也在 RPC 前拒绝。定向 race 覆盖冲突输入/缺 pin/非法滑点，以及新增 CLI 模式拒绝导入状态/执行标志。独立只读复核未发现当前流程的具体缺陷；测试仍使用合成链和签名提供方，不替代真实部署执行验收。

最终 Gauge 完整补验通过，包括独立 --quote 的候选/未核验标记、单次 minimum=1 探测及输出 100，以及原有自动核验与数据库/文件历史回归；发送账户 nonce 保持不变。


### 2026-09-06 B08 持久核验任务调度

第 57 项迁移增加 settlement_work；--enqueue 固定 runId/selection/manifest/独立 policy，--work-once/--work-run 按 chain/genesis/operator 领取任务并重新自动报价和核验。每市场单活动任务、到期/入队顺序、SKIP LOCKED、120 秒租约与代次栅栏；最多五次尝试，失败指数退避，最后一次崩溃在后续调度中终结。成功证据及 checked_unsigned/checkSequence 在同一事务提交，过期持有者不能完成；不读取旧 JSON 作为执行许可。

配置快照不能在同 runId 下改变，已完成任务重入复用；新周期显式新 runId。worker 使用领取时 deadline（30..120 秒）和实时状态，而非排队时效。暂无自动参与者发现/完整轮转、交易签名/提交/回执等实际执行模块，整个后端目标继续保留。

验证：Go 全量 fmt/vet/race/build、生成契约、Linux amd64 无 CGO 构建、TS smoke-settlement、boundary/whitespace 通过。Gauge/Vault 完整烟测通过 57 项迁移；真实 CLI 入队、独立 --work-once 自动报价/双模拟/签名参考/落库成功，同任务重入返回已完成状态，再次运行 idle；--work-run 空闲 SIGTERM 正常退出。隔离 PostgreSQL 验证 12 路重复入队及并发单领取、市场活动任务排他、同 runId 内容冲突、异操作者隔离、模拟租约到期后的代次接管/旧持有者拒绝、退避、五次终止、第五次中断收尾、原子证据关联及重复完成拒绝。子代理只增配置单测，主代理复核有效基线和负例后通过。链、参考源及租约到期操作均为测试夹具；没有生产签名或广播，仍非实际协议端到端执行验收。


### 2026-09-06 B08 固定交易意图与 nonce/费用准备

第 58 项迁移增加转换 nonce/意图及共享账户角色。维护 nonce 分配接入角色登记，转换发送账户与维护账户在同一协调数据库内互斥，旧维护账户回填。--prepare-intent 对已核验任务重新自动报价和核验，串行分配 nonce、累计已准备意图最大 Gas 成本与原生余额比对，再按完整 nonce/Gas/费用字段模拟固定调用，要求返回 spent/received 一致；结束复查 nonce/块/报价和参考时效。新鲜证据、意图及 nonce 在同一事务提交。--intent 可读回并核对作用域/摘要/证据/固定调用，重试保持原意图，不改费用或刷新期限。

仍无签名/发送，重读意图只是审计恢复；后续必须实现 signer/submitter 新鲜复核、取消/替换、回执和成本释放。角色表不约束独立物理数据库或外部钱包，生产须配置共享协调数据库和独立角色凭据。全后端目标继续保留。

验证：Go 全量 fmt/vet/race/build、生成契约、Linux amd64 无 CGO 构建、跨进程 TS smoke-settlement、boundary/whitespace 通过。Gauge/Vault 完整烟测通过 58 项迁移；转换改用独立合成发送账户，完整费用字段 eth_call 成功，三次调用最低到账为 1/99/99。精确模拟返回改变、原生余额不足、pending nonce 在准备期间变化均拒绝，无成功输出；后续成功和重复读取保留同一 nonce/意图，数据库 next_nonce 仅增加一次，修改费用拒绝。隔离 PostgreSQL 验证双向维护/转换角色冲突、异发送者读取拒绝及意图损坏检测；既有维护流程继续通过。

子代理费用单测复核后由主代理补充合法 fee 值相乘产生 uint256 溢出的独立负例；定向 race 通过。另增加从第 57 版带维护 nonce 数据升级至第 58 版的集成测试，角色回填为 maintenance 且原 next_nonce=7 保持，通过。当前没有生产签名、发送、费用核销或真实部署奖励结算验收。

最终包含已有数据升级用例的 Gauge 完整重跑通过，迁移、转换、维护、数据库/HTTP 与进程关闭回归全部通过。


### 2026-09-06 B08 新鲜签名授权与一次性签名恢复

第 59 项迁移保存不可变签名请求/证据摘要与可恢复原始交易。首次 --sign 重新核验当前权益、固定最低到账的模拟、签名参考、池状态、资产覆盖、Gas 余额、pending nonce 和规范块，保留原意图的全部调用/费用字段。授权期限受原 deadline、30 秒检查窗口、块新鲜度及所有参考价期限约束。授权和 signing_unknown 在调用外部签名器之前提交；并发或重试只读取已有结果，未知结果不自动重签。

外部可执行签名器采用 settlement-sign-v1 JSON stdin、单行 hex stdout，检查请求/证据摘要，限时及限制输出。--signed 仅读取；--import-signed 仅恢复已有请求，严格匹配 EIP-1559 发送者、链、nonce、目标、value、calldata、Gas/费用，拒绝 access list 与 legacy，重复相同结果幂等。历史证据按原检查时刻验证，过期恢复不续期、不广播。没有真实签名设施或生产广播；提交前复核、提交恢复、回执/实际退款、取消及成本释放尚待完成，B08 与全部后端目标保持未完成。


验证：Go 全量 fmt/vet/race/build、生成契约检查、Linux amd64 无 CGO 构建、TS 跨进程 settlement 对照、V1 boundary/whitespace 通过。Gauge/Vault 两套完整烟测通过 59 项迁移，包含从带旧维护 nonce 数据的第 57 版升级；CLI 签名前精确模拟变化拒绝且未调用签名器，成功时两次模拟最低到账保持 99/99，重复签名请求及审计读取保留相同原始交易且签名器只调用一次，转换发送者链 nonce 不变。隔离 PostgreSQL 覆盖未知结果不重签、恢复导入/重复导入、错误字节/异发送者/请求损坏拒绝。真实签名测试只使用本地合成 Anvil 账户，未广播转换交易。

签名字节单测覆盖有效 EIP-1559 基线及字段错配、实际签名 access list/legacy 拒绝；主代理修正子代理测试中的摘要夹具，使负例真正进入目标检查，并验证启动标记、运行中取消及 stdout 边界。测试不替代真实部署奖励转换与外部签名设施验收。


### 2026-09-06 B08 提交前授权与持久单次发送

第 60 项迁移新增 settlement_submissions。--submit 要求调用者提供预期交易哈希，读取并核对固定意图及原签名交易，首次发送前重新进行权益/固定调用/参考价/池状态/资产覆盖/Gas 余额/pending nonce/规范块核验。共享的授权证据验证逻辑区分 settlement-sign-v1 与 settlement-submit-v1，提交使用独立证据域，不把旧签名核验当作当前发送权限。

新鲜证据及 submission_unknown 在网络发送前持久提交；只尝试一次发送，匹配 RPC 哈希才保存 acknowledged。调用失败、回应丢失或保存回应失败保留 unknown；重复 --submit 仅读记录，不再次发送。--submission 无需 RPC，核验范围、签名、授权和证据摘要。acknowledged 不代表收录/最终性/实际成功，回执和退款对账、显式重发、替换/取消及费用释放仍未实现。本地 Anvil 可用于发送测试；没有生产网络发送，B08 和全后端目标继续保留。


验证：全量 Go fmt/vet/race/build、生成契约、Linux amd64 无 CGO 构建、TS settlement 对照、V1 boundary/whitespace 通过；Gauge/Vault 完整烟测通过 60 项迁移。真实本地合成 Anvil 固定原交易得到成功回执；精确模拟改变时拒绝且没有发送，成功前两次模拟最低到账保持 99/99。Vault 正常回应保存 acknowledged；Gauge 在 Anvil 接收后主动丢失 HTTP 回应，保存 submission_unknown，跨进程重试没有再次调用发送。隔离数据库覆盖两种既有状态的无 RPC 重试、错误预期哈希、异发送者及授权载荷损坏拒绝。主代理修正子代理测试的 fixture 选择/名称并补齐实际篡改断言，确保被烟测选中执行。CLI 缺少预期哈希在数据库访问前拒绝。

额外 Gauge 回归验证：RPC 转发器在向 Anvil 转交原始交易前，启动独立 CLI 读取提交，必须已能读到 submission_unknown；测试据此核对先落库后发送的顺序。回执仅由测试读取，不代表已实现后端回执/退款业务对账，也不替代真实协议部署执行验收。


### 2026-09-06 B08 结算回执观察与审计历史

第 61 项迁移新增 settlement_receipt_observations。--observe-receipt 对已存提交（含 unknown）按固定签名交易哈希观察，核对链/创世块、head/finalized、回执身份及整块回执/日志一致性，并复查回执块和 head/finalized 的规范块、head 时效。明确 null 保存 not_observed；其他合法状态分为 mined/finalized 的 success/reverted。RPC 错误、链错配、回执缺失/重复/不一致、读取期间重组或过期 head 拒绝，失败不追加记录。

--receipt-history 按工作作用域与 jobKey 分页，逐条检查摘要、身份及状态，返回 historical。观察不修改提交状态或释放 nonce/费用；RPC 最终性不是独立共识或 receipt-root 证明，成功回执尚未证明实际分配/退款。仍需协议事件与实际退款对账及后续调度，B08 和全部后端目标保持未完成。


本阶段定向测试覆盖五种状态、非法头/回执、finalized 高度/时间倒置、回执高于 head 和同高度哈希错配。隔离数据库由真实 CLI 提交/回执建立基线，随后用明确合成 RPC 夹具验证错误链/创世块、规范块变化、整块观察失败、目标回执缺失/重复/不一致、读取期间重组及过期 head 均拒绝且不追加历史；另覆盖状态转换、游标、异发送者和历史载荷篡改。首轮真实烟测暴露摘要函数与新表格式不一致，已改为 SHA-256 的 64 字符小写摘要，写入与读回统一；未放宽链检查或数据库约束。子代理状态测试初稿语法错误，主代理重建并验证有效基线与全部负例。


最终验证：Go 全量 fmt/vet/race/build、生成契约、Linux amd64 无 CGO 构建、跨进程 TS settlement 对照、V1 boundary/whitespace 通过。修复摘要后，Gauge/Vault 两套完整烟测均通过 61 项迁移，包含带旧维护 nonce 数据的升级；真实本地 CLI 提交后读取回执并留档，新进程历史查询与原记录一致。Gauge 原提交回应丢失仍能按哈希观察成功回执，且未重发。以上仅为隔离 PostgreSQL、合成 Anvil 合约及可控 RPC 夹具的验证，没有生产读取配置或生产交易，也未完成真实协议分配/退款验收。


### 2026-09-06 第一版范围确认与 B08 回执事件绑定

按用户要求，将 B11/B12/B13/B14/B16 明确列为第一版必需，新增 BACKEND_V1_RELEASE_SCOPE.md 并在架构和实施文档顶部引用，保留原完整 B01–B19 目标，不以基础列表/当前报价/原始日志替代搜索排序、K 线、聚合和实时更新。只读复核确认链接与范围一致。

新增 --receipt-events，仅读取指定作用域/任务的已存 finalized_success 回执及固定签名意图。核对原调用数据、FeeVault emitter、市场、参与者数量与顺序、用户/epoch、逐项支出上限、零支出与到账关系、批次唯一性、资产、正 nonce、整数总和及固定最低到账。输出绑定回执 sequence/digest 和 intent digest 的历史匹配结果，不签名或广播，仍保留 refundsVerified/executionComplete=false。事件不包含实际拉取总额，不能将请求上限减支出推断为退款；下一步须补足执行时拉取量及实际退款/权益证据。


本阶段测试：有效两参与者部分支出基线，以及未 finalized、缺事件、异 emitter、用户/epoch/顺序错配、单项超额、最低到账不足、总额不符、资产错误、重复批次、固定 calldata 变化和回执日志交易身份错误。单项超额用例同步调整批次总额，确保独立验证上限而非被总和检查提前掩盖。隔离 PostgreSQL 使用真实签名/提交/回执关联，再注入明确标识的合成事件证据测试读取绑定、跨发送者隔离和摘要损坏拒绝；合成 Anvil 原始无事件成功回执不能通过核对。合成正例不替代真实协议事件与退款验收。


最终验证：Go fmt/vet/race/build、生成契约检查、Linux amd64 无 CGO 构建、TS settlement 跨进程对照、Gauge/Vault 两套完整烟测和 V1 boundary/whitespace 均通过。迁移仍为 61 项；本轮没有生产交易，新增匹配入口本身不签名、不广播、不改变任务完成状态。


### 2026-09-06 B08 有界执行跟踪与根调用绑定

检查合约确认 Creator 的实际拉取量为执行时 liability 与 maximum 的较小值，Gauge consumeForConversion 返回实际消耗、creditConversion 接收退款/Quote，相关内部负债变更没有逐项退款事件。因此不能从上限或区块末余额推断实际退款。

新增 chainrpc.TransactionCallTrace 和 --receipt-trace：新鲜最终回执与事件匹配后，仅请求一次 callTracer，限制时间/载荷/递归深度/帧数/字节并校验帧结构；按本机依赖 Geth callFrame 的 output omitempty 语义接受无返回值调用。根调用须匹配固定签名 from/to/data/value、无根错误，严格两 uint256 返回与回执批次金额一致，读取后复查回执与规范块/时效。traceRootMatched 仅说明根绑定；内部调用、Creator 执行前状态、实际退款及权益对账仍未完成，refundsVerified/executionComplete 继续 false。跟踪需要支持历史 debug_traceTransaction 的 RPC，不支持即拒绝；跟踪树暂不独立落库，无生产操作。


本阶段验证覆盖 callTracer 请求参数、无返回值帧、保留失败子帧、null/不支持方法、非法地址/字节/数量/类型、深度/载荷和 4096 帧边界、取消及不重试；独立启动的本地 Anvil 实际提交后跟踪读取通过。根调用逐字段和返回金额错配拒绝。隔离数据库使用明确合成的协议事件/跟踪测试完整绑定、跟踪后重组拒绝、返回值不符拒绝；这不替代真实协议退款验收。静态复核确认 CLI 保持退款/业务完成标记为 false。


最终 Go fmt/vet/race/build、生成契约、Linux amd64 无 CGO 构建、TS settlement 对照、Gauge/Vault 完整烟测和 V1 boundary/whitespace 通过。迁移仍为 61 项。本轮只在独立本地 Anvil 测试发送，新增业务入口只读链并保存回执观察，不发送生产交易。实际退款、内部权益变化及完整后端目标仍待完成。


### 2026-09-06 B08 Gauge 调用金额核对

新增 receipt-accounting，在新鲜最终回执、签名意图及根跟踪绑定后，核对 FeeVault 直接成功调用的 consumeForConversion/convertRewards/creditConversion：角色地址、签名最大值、用户、执行顺序、一次性数量、实际拉取返回、Hook 总输入输出和退款/Quote 入账参数。逐项 pulled=spent+refund，actual pulled 为正且不超上限；全 Staker 批次复算两级累计向下取整，与事件金额逐项一致。

状态观察保存已认证 Gauge 地址供后续绑定，旧证据缺失时不从跟踪地址猜测。Creator 内部实际拉取仍未观测，mixed/Creator-only 返回 unresolvedCreators，不推断逐项退款，不将 allInputsObserved 或 allocationFormulaMatched 设为 true。全 Staker 的调用/公式匹配也不证明内部存储写入，refundsVerified/executionComplete 继续 false；任务整体继续进行。


测试覆盖两 Staker 的部分拉取/成交/退款（最大值 5/7、实际拉取 3/6、支出 1/2、退款 2/4），以及调用目标/来源/错误/type、缺失/重复/顺序、最大值/超额拉取、退款/Quote、Hook 总量/输出、累计分配公式错配和缺 Gauge 身份。混合 Creator 保持 unresolved。只读复核确认两级累计取整与合约一致；随后增加拒绝隐藏在嵌套调用中的额外 FeeVault 扣减/转换/退款，允许 Gauge clone 的 DELEGATECALL 实现帧，递归检查有界。

隔离数据库夹具改为按实际批次角色构造调用，覆盖 Gauge 与 Creator-only 路径，避免原 Creator-only 假设漏掉 Staker。全量验证中已有 signer 取消测试偶发未在两秒内看到启动标记，改为独立的 10 秒启动等待并及时报告提前退出；进程启动后的两秒取消时限和生产签名时限保持不变。

最终全量 Go fmt/vet/race/build、生成契约、Linux amd64 无 CGO 构建、TS settlement 对照、Gauge/Vault 完整烟测及 V1 boundary/whitespace 均通过。迁移仍为 61 项；没有生产发送。Creator 执行前内部状态、权益存储写入验证及完整退款验收仍待完成，第一版 B11/B12/B13/B14/B16 必需范围和完整目标保持不变。

### 2026-09-06 B08 交易执行前状态及存储差异适配

新增 chainrpc.TransactionState：对原交易读取 prestateTracer 完整访问前状态和差异，设置总/节点超时及响应、账户、槽位预算；验证代码哈希，拒绝 null 账户、不完整结果和两份数据的执行前槽位冲突。StorageTransition 仅基于明确出现的执行前槽位解释不变、零值写入及清零，拒绝缺失前值、账户创建/删除和代码变化。

隔离 Anvil 部署 SSTORE 合约验证真实零→非零→零变化；单元测试覆盖缺槽、前值矛盾、代码/哈希变更、格式和预算异常。全量 Go fmt/vet/race/build、生成契约、Linux amd64 无 CGO 构建、TS settlement 对照及 Gauge/Vault 完整烟测通过。

本阶段是内部证据适配层，没有新增 CLI 或迁移，尚未绑定结算交易的规范回执、编译存储布局与部署代码身份，也未核对 Creator/Gauge 权益槽位。RPC 跟踪不是状态根证明，refundsVerified/executionComplete 仍不得置为 true。下一步继续布局/运行时代码绑定及实际负债变化核对；B11/B12/B13/B14/B16 仍为第一版必要功能。

### 2026-09-06 B08 Creator 存储核验接线

新增 --receipt-creator-storage，将最终回执/签名批次/调用金额核验与同交易前状态/差异连接，完成后重新检查回执、规范区块及 head/finalized 时效。新奖励观察保存 FeeVault 完整 runtimeCodeHash；跟踪代码必须同时匹配该部署身份与编译模板。生成器从同一 Forge 产物读取运行时代码、immutable 范围和 Creator mapping 布局，contract-check 校验未过期，不以模板替代部署授权。

按 epoch 核对 Creator MEME 负债净减少、QUOTE 负债净增加，基于执行前负债与签名上限重建实际拉取及退款，合并 Gauge 拉取返回值后验证 Hook 总量、全部项目累计取整分配。零分配不伪造 Quote 余额，并拒绝未分配 Quote 的异常存储增加。缺少旧证据代码哈希、编译版本不符、缺槽、金额冲突和规范性变化均拒绝。

纯 Creator/混合批次、部分成交、签名上限、零份额、代码 immutable 完整身份、异常金额/公式及跟踪后回执重检有测试；槽位使用独立 cast index 向量对照。状态随诊断结果返回，仍未单独持久化。Gauge 内部权益、聚合负债/资产余额变化、真实协议完整执行和生产运行仍待完成，refundsVerified/executionComplete 保持 false。迁移仍为 61 项，第一版必要范围不变。

本阶段验证通过：Go fmt/vet/race/build、编译存储布局及其他生成契约检查、Linux amd64 无 CGO 构建、7 组 Go/TS settlement 对照、Gauge/Vault 隔离 PostgreSQL+Anvil 烟测、V1 boundary 与 whitespace 检查。完整烟测仍使用既有合成协议 getter 图，不构成真实 FeeVault Creator 结算成功的证据。

### 2026-09-06 B08 FeeVault 聚合负债核验

新增 --receipt-liabilities，串联既有 Creator/调用/最终回执核验，并在同份状态跟踪中按角色汇总已匹配事件的支出与到账，核对 MEME/QUOTE 的 Creator、Staker 桶变化、Platform/Holder 不变，以及跨市场总负债净变化。编译器布局生成器同时校验 bucket mapping 的 uint256[4] 结构和 total mapping；沿用完整部署代码哈希与编译模板双重绑定。

非零变动缺失执行前槽位、总额不符、角色间错误分配、Platform/Holder 异常变化均拒绝。零变动且未访问的槽位不伪造余额，valuesObserved=false；这依赖完整 RPC 差异观察，不是状态根证明。再次复核回执/规范区块/时效后返回诊断，无生产发送、迁移或预算释放。

测试覆盖混合与单角色批次、角色错配但总和相同、缺槽、错误代码、无关桶改动、零值首次入账及独立 cast index 槽位向量。Gauge 源码复核确认 consumeForConversion 在消耗前执行 activation checkpoint、pending materialization 和双资产 accumulator/remainder 结算；下一步须覆盖这些权益状态，不能直接以执行前 pendingFee 代替实际可消耗奖励。资产余额与真实完整协议验收仍待完成，refundsVerified/executionComplete 保持 false。

本阶段 Go fmt/vet/race/build、生成契约与编译存储布局检查、Linux amd64 无 CGO 构建、7 组 Go/TS settlement 对照、Gauge/Vault 隔离烟测及 V1 boundary/whitespace 通过。烟测的协议 getter 图仍是合成夹具；新聚合核验的金额/存储场景由单元测试覆盖，尚不构成真实完整结算验收。

### 2026-09-06 B08 Gauge 仓位重放与 Solidity 差分验证

新增内部仓位计算层：双资产 accumulatorPaid/pendingFee/userRemainder，未到期 pending、已处理及本次到期激活快照，active/pending 转换、快照引用减一/清除、消耗和退款/Quote 入账。两段奖励共用余量，保持锁时间；使用全宽整数乘积并检查 Solidity uint256 最终存储边界，拒绝累计器回退、非法余量、缺桶及快照冲突。

新增 8 组持久 JSON 向量及 gauge-solidity-check，在隔离临时 Forge 工程调用仓库真实 MemeStockGaugeSettlements._settlePosition，Go 和 Solidity 均核对最终仓位、快照及拉取量。覆盖共享小数进位、最后一个快照引用、512 位合法乘积等边界；额外 Go 异常用例覆盖溢出、缺桶、退款超拉取和零拉取。夹具的消耗/退款语句复现 Gauge 算法，不是完整生产克隆/FeeVault 执行验收。

该模型尚未绑定真实 prestate 槽位、克隆/实现代码身份和存储后值，也未覆盖其他激活桶的聚合变化及 orphaned remainder/cohort 状态。没有新 CLI、迁移或生产发送，不改变 refundsVerified/executionComplete。下一步完成可信状态装配与真实存储核对；第一版 B11/B12/B13/B14/B16 必需范围和完整 B01–B19 目标保持不变。

本阶段验证通过：8 组真实 Solidity 结算层向量、Go fmt/vet/race/build、生成契约与 FeeVault 编译布局检查、Linux amd64 无 CGO 构建、V1 boundary/whitespace。本次没有修改 HTTP、数据库或外部交易流程，未重复既有完整 Gauge/Vault 烟测。

### 2026-09-06 B08 Gauge 参与者存储核验

新增 --receipt-gauge-storage，串联 Creator、FeeVault 聚合负债与回执/调用核验后，使用同份 prestate/diff 对 Gauge 参与者进行模型重放和存储后值匹配。新观察保存 Gauge 完整运行时代码哈希，核对固定克隆格式、内嵌市场/FeeVault/资产及实现地址；实现执行前代码匹配本地编译产物，拒绝代码更改与缺失身份。布局生成器验证实际使用的根槽、成员 packing 和数组步长，纳入 contract-check。

核验九槽仓位中的 active/pending/generation/unlockAt 与双资产 paid/pendingFee/remainder，实际拉取返回、参与者激活桶清除和共享快照最终引用/删除。计算使用回执块时间，读取后复核完整块头和最终回执；缺失槽位不按零处理。测试覆盖 8 组 Solidity 已对照的模型向量、旧/新激活共享快照的双用户顺序、错误代码/身份、缺槽和错误权益/锁/快照/桶变化。

范围仍为参与者权益：其他激活桶的汇总、cohort 与全局孤立余量、资产余额变化、独立证据持久化和真实完整 Gauge/FeeVault 执行验收尚未完成，refundsVerified/executionComplete 保持 false。旧证据缺少新 Gauge 哈希时拒绝，不改写签名意图；没有迁移或生产发送。

本阶段 Go fmt/vet/race/build、Gauge/FeeVault 编译布局及生成契约检查、Linux amd64 无 CGO 构建、7 组 Go/TS settlement 对照、Gauge/Vault 隔离烟测、V1 boundary/whitespace 通过。新存储核验使用合成 trace fixture；完整烟测仍是既有合成 getter 协议图，不是生产部署或真实完整结算验收。

### 2026-09-06 B08 Gauge 全局激活核验

扩展现有 --receipt-gauge-storage，核验全部 32 槽 generation、空/未来槽不变、到期桶清空，以及 active/pending 总量的等额增减。新布局字段由编译器验证 uint256 类型和根槽。非零变化缺前值拒绝；未访问且应不变的字段不伪造余额。

所有新激活桶（包括本批次无参与者的桶）均核对空的前快照、新累计器和最终引用数；引用按实际 materialized 参与者扣减，全部消费时要求清除。覆盖快照同交易创建后删除而 diff 为空、遗漏 generation、未来/空桶修改、桶残留、快照冲突、总量错配及引用不足等场景。

真实 Solidity _settlePosition 新增全表场景，与 Go 夹具独立核对两个到期桶、一个未来桶的总量和引用结果，gauge-solidity-check 共 9 项通过。cohort/全局孤立余量、资产余额、独立证据持久化及真实完整协议联合执行仍待完成，没有新增 CLI、迁移或生产发送，refundsVerified/executionComplete 保持 false。

本阶段 Go fmt/vet/race/build、生成契约与编译布局检查、Linux amd64 无 CGO 构建、7 组 Go/TS settlement 对照、Gauge/Vault 隔离烟测和 V1 boundary/whitespace 通过。真实 Solidity 校验覆盖计算/激活层，存储装配及完整烟测仍使用合成 trace/getter 图；不将这些结果称为真实完整协议执行验收。

### 2026-09-06 B08 Gauge cohort 与孤立余量核验

扩展 receipt-gauge-storage，按每次 consume 的嵌套调用核对克隆绑定 Manager 的 cohort/eligible 查询、精确市场与 uint256 返回、短路分支及最终 observed cohort。回收时复算两种资产的 index/precision 余量与递延没收余额增量；未回收时要求相关槽无变化。重复回收只产生一次有效增量，拒绝额外的未建模 Gauge 修改调用与累计器变化。生成器验证新增槽和 precision 数组布局。

测试覆盖同批次保留、批次切换、后续切换、重复空批次、目标/市场/type/顺序错误、缺失状态、错误进位/递延金额及溢出。真实 Solidity _collectForfeitedReward 检查进位、清零和重复回收，Solidity 验证器连同此前仓位/激活场景共 10 项通过。

资产余额、独立证据持久化与真实完整协议联合执行仍未完成。调用跟踪和存储差异是 RPC 观察，不是状态根证明；保持 refundsVerified/executionComplete=false，不新增 CLI、迁移或生产发送。

本阶段 Go fmt/vet/race/build、生成契约及编译布局检查、Linux amd64 无 CGO 构建、7 组 Go/TS settlement 对照、Gauge/Vault 隔离烟测及 V1 boundary/whitespace 通过。10 项 Solidity 测试覆盖仓位、激活和余量计算；存储/调用装配及完整烟测仍为合成 trace/getter 图，真实完整协议执行验收保持未完成。

### 2026-09-06 B08 资产余额变化核验

现有 receipt-gauge-storage 增加 balances。ERC-20 核对 FeeVault 转换前两次和转换后按实际非零退款/到账决定的 balanceOf 次数、只读调用身份及阶段读数一致性。MEME/QUOTE 实际余额净变化必须匹配支出/到账，且前后覆盖跨市场总负债；不以外部代币存储布局假设替代其真实 balanceOf 结果。

原生 QUOTE 从同交易 prestate/diff 的 FeeVault 原生余额核对。新增 ContractBalanceTransition：明确前值、匹配可选 pre balance，省略 post 表示不变、显式零值表示清零，拒绝代码变化和账户创建/删除。本地独立 Anvil 验证实际原生转入导致 0→7→14 变化；合成资产场景覆盖 ERC-20/native、缺/额外读数、错误身份/金额、负债不足及零退款/到账。

完整证据独立持久化和真实完整 Gauge/FeeVault 联合执行仍待完成，RPC 观察不构成状态根证明，refundsVerified/executionComplete 保持 false。没有迁移或生产发送。

本阶段 Go fmt/vet/race/build、生成契约与编译布局检查、Linux amd64 无 CGO 构建、7 组 Go/TS settlement 对照、Gauge/Vault 隔离烟测及 V1 boundary/whitespace 通过；另执行含真实原生转入的 Anvil chainrpc 测试。协议层资产装配仍用合成 trace 场景，完整烟测仍为合成 getter 图，不能据此宣称真实完整协议验收通过。

### 2026-09-06 B08 执行证据持久化与历史重放

新增第 62 项迁移及记录/单条/分页历史 CLI。保存完整 ReceiptGaugeStorage（含回执块头），关联原始 intent digest 和 receipt sequence，限制 8 MiB 并校验 SHA-256。记录前重新采集、逐层重放并复核规范回执和完整块头；历史查询采用只读可重复读事务，核验原始材料及回执绑定，再重新计算事件、调用、Creator/Gauge、激活、余量、负债及余额结果。页长最多 5，仅返回摘要；按 sequence 可取完整证据。

已验证 Creator-only 合成完整证据的 JSON 往返和篡改拒绝、PostgreSQL 存储往返及唯一/摘要/非空/外键约束、CLI 无效输入。全量 Go fmt/vet/race/build、生成契约一致性、Linux amd64 无 CGO 构建、Go/TS settlement 对照、Gauge/Vault 隔离烟测及 V1 boundary/whitespace 通过。迁移升级覆盖 57→62。

尚未完成真实协议交易从 RPC 采集、存储到历史查询的联合验收；本阶段数据库测试不替代该验收。refundsVerified/executionComplete 保持 false，没有生产发送。B11/B12/B13/B14/B16 仍为第一版必需，全部后端尚未完成。

### 2026-09-06 B08 真实 FeeVault 执行证据组件验收

新增 smoke-execution-evidence 命令及 CI 门禁。隔离 Anvil 部署当前原始 ProtocolFeeVault 创建字节码，使用测试注册表/代币/兑换 Hook 和预置历史负债；分别执行 ERC-20、原生币 Quote 的 Creator 部分成交。实际上限 5、提取 3、花费 1、退款 2、到账 100。Go 经真实 RPC 获取回执及调用/状态跟踪，完成 runtime 身份、事件、Creator 状态、分类/总负债、余额和 JSON 往返重放核验。真实证据中修改余额、调用返回、Creator 后值或 runtime 均被拒绝。

两类隔离执行测试和 Go 全量验证通过。没有新增迁移或生产发送。该证据强于合成 JSON，但外围协议模块仍为测试替身、历史负债经隔离链预置；尚未覆盖真实 Gauge/AllocationManager、正式兑换路由，以及带原始签名材料的数据库 Store 全链路，不能据此关闭 B08 联合验收或整体后端目标。

### 2026-09-06 B08 真实 Gauge 克隆与到期激活验收

将真实字节码 smoke 扩展为六场景矩阵：Creator、Staker 未来激活、Staker 到期激活，各覆盖 ERC-20/原生币 Quote。Staker 部署原始 MemeStockGauge 实现和标准七参数克隆，FeeVault 实际调用 consume/credit。后端核对真实代理和实现 runtime、持仓前后值、激活桶、快照、全局总量、余量和资产负债，并完成整体重放。到期激活验证 active 1→2、pending 1→0、快照创建并耗尽删除；锁保持，MEME 奖励余量为 2、Quote 为 110。实际 Gauge 奖励后值被修改时拒绝。

六场景及全量 Go 验证通过，现有 CI 命令包含全部场景。迁移仍为 62 项，无生产发送。AllocationManager、注册表和兑换路由仍为测试替身，历史状态预置；正式签名材料到 Store 记录/查询、完整协议路由仍未验收。整体 B01–B19 目标和第一版 B11/B12/B13/B14/B16 必需范围不变。

### 2026-09-06 B08 只读历史查询的锁冲突修复

全链路检查发现 ExecutionEvidenceHistory 的只读事务经 receiptMaterial 调用任务加载器时执行 FOR UPDATE，PostgreSQL 会拒绝，原有纯重放与底层存储测试未覆盖此入口。将任务材料加载显式区分加锁/不加锁：证据历史读取不加行锁，记录及原写入流程保留行锁，原材料/摘要/签名/提交授权检查不变。

新增隔离 PostgreSQL 公开 API 验证，使用烟测实际生成的任务、检查快照、意图、签名和提交授权，确认空历史成功、错误操作人和缺失记录拒绝。全量 Go 验证及 Gauge/Vault 隔离烟测通过。没有新迁移或生产发送。该测试修复读取入口的真实缺陷，但仍不代表非空真实交易证据 Store 写入/查询全链路已完成；该联合验收继续开发。

### 2026-09-06 B08 非空签名证据与记录/查询数据库验收

新增隔离 PostgreSQL 测试：生成独立 EIP-1559 测试签名和双签名参考价格，构造原始意图、签名/提交授权，经正式材料校验后读取七条完整证据，验证单条精确往返、5+2 分页和结束游标。修改核算结果且重算摘要后，单条和整页均拒绝。

进一步以受控 RPC 回执/跟踪调用正式 RecordExecutionEvidence，并经 ExecutionEvidence/History 读回验证。成功记录不改变任务状态或 nonce，缺失状态跟踪不会产生执行证据。测试使用合成历史数据和 RPC 替身，未把真实 FeeVault/Gauge 交易、准备/签名/提交及 Store 串成同一全链路，不能替代该联合验收。

Go 全量验证、Gauge/Vault 隔离烟测及 V1 边界/whitespace 通过。无新迁移、无生产发送，整体开发目标继续。

### 2026-09-06 B08 真实签名交易、RPC 与证据数据库联合验收

打通此前分离的真实 FeeVault/Gauge 与数据库测试。smoke-gauge 在独立 Anvil 执行到期 Staker ERC-20 交易，smoke-vault 执行原生币 Quote Creator 交易；读取实际 EIP-1559 签名与调用参数，经正式签名材料校验，再通过真实 chainrpc 调用 RecordExecutionEvidence，公开查询/分页完整读回并重放。失败状态跟踪不产生执行证据；任务状态和 nonce 不变。

Go 全量检查、真实六场景、Gauge/Vault 隔离链+数据库烟测及 V1 boundary/whitespace 通过。没有新迁移或生产发送。

测试历史授权/参考价格材料仍在成交后重建，尚未执行从原始入队、参考源抓取、执行前模拟、外部签名器到提交的同一端到端流程；外围注册表、AllocationManager、兑换 Hook/PoolManager 仍为测试替身。因此 B08 完整协议流水线验收和其余 B01–B19 待办继续保持开放，第一版 B11/B12/B13/B14/B16 必需范围不变。

### 2026-09-06 B14 Go 展示参考价服务与 HTTP 入口

新增 displayprice 独立包、固定 RH REST 适配器、后台缓存刷新及 GET /v1/prices/references，通过 TG_DISPLAY_PRICES_CONFIG 配置 1–16 个唯一链/Token/UID/symbol 目标。读取不触发上游请求；每 30 秒刷新，四并发、单请求 5 秒/2 MiB、整轮 25 秒，不重定向/重试。API 显式 displayOnly/provider_reported，并带原始时间、过期时间、抓取时间、单位、来源及状态。60 秒到期返回 stale/null；错身份、缺字段、非 ACTIVE、待生效乘数、未完成公司行动、停牌及 HTTP 失败均 unavailable/null。

按当前 Robinhood 官方 API 文档处理 assets、quotes、corpActions。REST 底层股票 bid/ask 只乘一次 currentMultiplier，big.Int 精确定点乘法，不以浮点计算。测试覆盖超浮点安全整数及 36 位小数结果、过期边界、身份/字段/状态错误、429/超大响应、配置约束、取消和 HTTP 路由。全量 Go fmt/vet/race/build 与 V1 boundary/whitespace 通过。

本阶段没有接入结算/配置生成，没有新迁移。链上身份/Oracle 交叉核验、OpenAPI/TS SDK、前端联调、实际生产提供方与刷新运行验收仍未完成；B14 保持未完成且第一版必需。B08 完整执行前授权和真实兑换路由验收仍在原待办中，未缩减完整 B01–B19 目标。

### 2026-09-06 B14 OpenAPI 与 TypeScript SDK

OpenAPI 2.10.0 新增 GET /v1/prices/references 的 DisplayPriceReference/Response/Error 契约，生成 listDisplayPriceReferences() 并同步 Go 内嵌契约和 apps/web 客户端。声明 displayOnly/provider_reported、整 Token USD 单位、来源时间及 nullable 十进制字符串。available 必须非空，stale/unavailable 不得携带有效 bid/ask；不支持 snapshot revision 或任意查询参数。旧 TS 服务未实现该 Go 路由。

Go HTTP 响应契约验证、非法状态/价格组合拒绝、SDK 精度/null/错误保留测试通过；全量 Go 验证、30 项 backend-api 测试、生成产物检查和前端类型/构建通过。页面实际接入、生产提供方和运行验收继续待办，B14 仍为第一版必要且未整体完成。

### 2026-09-06 B14 创建/交易页面展示接入

创建页在已识别 Quote 配置选择后、交易页在规范市场加载后，通过生成 SDK 请求 Go 展示参考价。独立提示显示每个完整 Quote Token 的 USD bid/ask、Robinhood 来源和时间，明确 Display estimate only。响应先检查链/Token、UID/symbol 格式、source/unit、精确十进制顺序及时间有效性；不重复应用 multiplier，不参与交易报价或创建权限。

控制器每 30 秒刷新、8 秒请求超时，本地每秒检查到期，恢复页面时重新检查。资产切换立即清空并取消旧请求，以 generation 防止旧响应覆盖新资产；失败/缺价显示不可用，过期不保留有效数字。

前端 60 项测试、类型与构建、V1 boundary/whitespace 通过。浏览器检查创建和交易页面缺价状态，创建页提示布局正常。有效配置/真实价格的浏览器联调和生产提供方、运行验收仍未完成，B14 继续保留第一版必需状态；B08 和其余待办范围不变。

### 2026-09-06 B14 一次性运行检查与真实来源抽查

新增 `cmd/display-price-check`，配置文件及目标链显式必填，复用展示服务一次刷新、并发及超时边界，输出逐资产状态和检查时间；有效、缺价/取消、配置/输出错误分别对应退出码 0/1/2。它是只读展示可用性检查，没有部署批准或执行授权含义。

真实 Robinhood assets 与发布清单精确地址匹配到 53 个主网股票资产；本次仅抽查 16 个，8 available、5 provider_unavailable、2 corporate_action_pending、1 invalid_timestamp，总体未通过。原始目标和结果存于 `outputs/reviews/backend-display-price/`，不自动写入生产配置，也不将主网同名资产映射到测试网。

新增有效/过期/身份不匹配/公司行动、取消和 CLI 参数测试，目标包 race 测试、vet 与命令构建通过。B14 仍缺完整目录覆盖（现配置上限 16）、非股票来源、公共上游请求复用与运行稳定性、有效价格浏览器联调；该抽查不算生产验收通过。B11/B12/B13/B14/B16 继续为第一版必需。

### 2026-09-06 B14 公共来源查询复用

将每轮刷新中的资产目录与公司行动查询改为轮次内共享，使用同步一次性加载，成功及失败均共享；不同轮次不复用旧数据。单独 Provider.Fetch 仍保持独立抓取行为。逐资产价格查询、身份和公司行动校验、四并发、25 秒总预算及陈旧价格清空规则保留。16 个正常目标的上游请求上限由 48 次降至 18 次。

新增八并发公共观察/失败共享/下一轮恢复测试；displayprice、httpapi、检查命令的 race 测试及相关 vet 通过。公共来源复用已实现，未证明生产稳定性，亦未解决配置 16 项上限、非股票提供方和有效价格浏览器联调；B14 和完整后端目标继续开放。

### 2026-09-06 B14 全目录容量与跨层契约

配置限制扩展至 64 项，OpenAPI 2.11.0、Go 内嵌契约、生成客户端和前端响应校验同步。新增完整 64 项刷新测试，验证逐项身份/价格和顺序保留、共享请求各一次、65 项配置拒绝；前端与 HTTP 契约验证 64 项接受/65 项拒绝。

本次真实请求精确匹配的 53 项发布股票资产，结果 28 available、17 provider_unavailable、8 corporate_action_pending，结果和目标保存在 `outputs/reviews/backend-display-price/full-catalog-*.json`。仍采用四并发和 25 秒总预算，无生产配置写入；上游失败及预算影响尚需后续诊断，不能宣布生产运行验收通过。

61 项前端测试、30 项 backend-api 测试、Go 相关包 race、vet、前端构建、生成产物与 V1 boundary 检查通过（前端仍有既有 bundle 大小提示）。B14 剩余非股票价格来源、运行稳定性和有效价格浏览器联调；其余 B01–B19 未完成项继续保留。

### 2026-09-06 B14 缺价诊断与请求节奏

细分上游 HTTP、单请求超时、刷新预算、取消、网络和响应解析错误，按接口阶段给出固定 reason，不泄露原始网络错误或正文。失败时间修正为结束时观察时间。新增每轮价格请求 100 毫秒预约间隔，仍维持四并发与 25 秒总预算。

53 项真实诊断为 40 available、8 corporate_action_pending、5 prices_rate_limited；节奏控制后的检查为 37 available、8 corporate_action_pending、8 prices_rate_limited。结果保存在 `outputs/reviews/backend-display-price/{diagnosed,paced}-result.json`。限流仍存在，未证明稳定性改善；不将公司行动资产强行判为有效，也不将这种只读检查称为部署许可。

新增错误分类、正文不泄露、请求间隔和取消测试；相关 Go race 与 vet 通过。后续仍需处理生产来源配额/稳定性、非股票价格与有效价格浏览器联调，B14 和完整后端目标不关闭。

### 2026-09-06 B14 批量价格来源接入

根据官方文档及实际只读请求确认 `/rhj/prices` 无 symbol 入口可返回全目录报价（实测 194 条、74737 字节）。多目标 Service 刷新改为一次共享批量价格查询，因此每轮公共请求最多三次；单目标沿用 symbol 专用入口。批量结果限制 1024 条/2 MiB，按 symbol 恰好匹配一条，保留逐资产链/部署、币种、停牌、乘数、精度与过期校验。批量失败不放大为单资产重试。

64 项目录测试更新为断言恰好三次请求；新增批量缺失、重复、错误链、限流、null 和超量响应拒绝/失败共享测试。相关 race/vet 通过。真实两轮分别为 assets_timeout 53 项，以及 available 45 项/corporate_action_pending 8 项；证据为 `bulk-first-result.json`、`bulk-recheck-result.json`。后一轮无价格限流，不足以消除持续运行与提供方稳定性验收要求。B14 仍有非股票来源与有效价格浏览器联调，完整目标继续开放。

### 2026-09-06 B16 版本补读与缓存失效后端契约

新增 Go `GET /v1/updates?since=`，初始/过期版本 reset，当前版本 unchanged，保留期版本 changed 并比较 markets/configs/positions 三组快照内容；返回失效组、当前 sync 和 5 秒轮询建议。只接受 synced/finalized 当前状态，存储失败 503，无缓存；既不将 head 当 finalized，也不将旧版本失效当作未变化。价格/奖励/Treasury 独立刷新边界明确。

OpenAPI 升级 2.12.0，Go 内嵌契约、TS SDK 和前端生成客户端同步。HTTP 测试覆盖初始、相同、变化、过期、数据库错误、head 拒绝和非法查询，并验证响应契约及 no-store。B16 尚未完成：前端轮询、断线重连、固定 revision 补读后统一应用与缓存失效验收仍待继续；本次接口不是完整实时功能交付。

### 2026-09-06 B16 前端刷新协调器

新增 `apps/web/src/v1/snapshotUpdates.ts`：校验更新响应的目标链、finalized、区块/revision 一致性及 reset/changed/unchanged 缓存语义；串行轮询、15 秒超时、取消、请求代次隔离。补读必须先暂存，返回同步 commit 回调，只有当前请求才能应用并推进 revision。失败保留最后成功 revision；恢复强制完整重读，即使服务端返回 unchanged。AbortSignal 不被底层遵守时也能结束等待并安排下一轮。

新增响应拒绝、迟到结果隔离、失败保留版本/恢复重读、超时测试，前端 65 项测试通过。本阶段是可复用协调器，尚未在 app.ts 启动，也没有宣称页面已具备自动刷新；下一步需把 Foundation/页面补读改为统一暂存提交，再接入 online/pageshow 等事件和浏览器验收。B16 保持未完成，整体目标不变。

### 2026-09-06 B16 页面轮询接线与浏览器恢复检查

将 app.ts Foundation 读取拆为无全局写入的 prepareFoundation，配置与市场按更新响应 revision 暂存后提交；人工加载与轮询通过代次检查隔离。提交时作废旧 Trade quote、Launch preview 和奖励请求代次，保留独立链上逃生入口。轮询使用可取消客户端，交易/钱包操作和前台加载期间暂停；接入 online/offline、visibilitychange、pagehide/pageshow（bfcache），初始化失败也启动恢复。失败清空 Foundation 并关闭依赖写入口，未成功应用不推进版本。

65 项前端测试、类型和构建通过。使用一次性本地只读模拟 API，在实际 Markets 页面验证 revision 1 自动更新到 2、503 显示重连、同 revision 2 恢复正常；没有钱包连接或真实交易。该检查是空目录市场页，不替代真实 Go/数据库、多市场分页、钱包切换中请求及 Trade/Rewards 的完整联合验收。Foundation 统一提交已接线，页面详情仍通过各自代次保护重新加载，B16 整体仍待这些验收。

### 2026-09-06 B16 目录异步渲染与缓存竞态修复

复核页面轮询后发现首页/市场页异步 metadata 可在新快照后追加旧卡片，且 metadataCache 仅按 marketId 缓存。新增 renderGeneration：同时绑定本轮渲染代次与快照身份，首页卡片、市场筛选完成后检查再写 DOM。统计页按 revision 与渲染代次检查翻页及异步元数据，旧轮退出；现有 appendMarketPage 仍按 Foundation 对象身份拒绝迟到分页。

metadataCache 改为 chain/revision/marketId，并在快照失效时清空；失败 promise 仅能删除自己对应的缓存项。市场资产筛选列表按新快照重建，合法选择保留，移除资产不继续滞留。人工 Foundation 替换同样使旧派生请求失效。

新增迟到渲染、筛选覆盖、失效后恢复同对象等测试；67 项前端测试、类型/构建、边界与 whitespace 检查通过。该阶段修复并验证渲染保护原语与接线编译，尚未完成真实 Go/PostgreSQL 多页目录及钱包/Trade/Rewards 浏览器联合验收，B16 和整体目标继续保持开放。

### 2026-09-06 B16 多页目录 HTTP 联合测试

新增 updates_paging_test.go，经 httptest HTTP 服务实际请求更新和分页接口：130 条市场按 100/30 分页，发布新 revision 后验证 markets/configs/positions 删除失效、旧 cursor 携带新 revision 必须拒绝、旧 revision 保留期内可继续原分页。历史过期后更新返回 reset，旧页面拒绝，新目录不含删除市场。503 恢复后相同 revision 返回 unchanged，由前端协调器的恢复逻辑触发重读。

该测试采用受控 Reader，不冒充 PostgreSQL 发布验收；聚焦 Go 路由、更新比较、cursor 绑定及恢复契约的联合行为。单项 race 通过，B16 未整体关闭，完整后端任务范围保留。

### 2026-09-06 B16 PostgreSQL 发布与历史保留联合验证

在 integration/snapshot_test.go 现有真实数据库发布测试中接入 updates HTTP 响应及 OpenAPI 验证，使用实际 readmodel.Store.Publish/Load：初始 reset、相同版本 unchanged、新发布 changed；回执覆盖缺失、发布器/索引器超过新鲜度窗口、当前块失去 canonical 均返回 503；恢复健康后相同版本重新可读。发布 34 个版本后，早期版本超出 32 版本可读窗口，updates 返回完整 reset，审计历史仍全部保留。

`TestPostgresMigrationAndReadiness -race -count=1` 使用本机 PostgreSQL 的独立临时数据库通过，迁移和现有集成检查同时通过，临时库由测试清理。首次 socket 形式 DSN 被测试 URL 校验拒绝，随后使用经只读连接验证的本机 TCP URL 成功；未修改生产数据。

这证明了真实数据库读写与 HTTP 新鲜度/保留规则的联合行为；链观察仍为测试夹具，不代表真实 RPC 持续索引验收。B16 剩余钱包切换和 Trade/Rewards 等浏览器联合验收，完整 B01–B19 目标继续开放。

### 2026-09-06 B16 钱包切换与轮询暂停边界

复核发现 canPoll 原先只在请求开始时生效，钱包/交易操作在等待期间开始时仍可能进入 prepare/commit。协调器现于更新读取后及暂存完成后重新检查，暂停时保留已应用 revision，不提交、不清空健康状态；超时和错误回调亦不扰动暂停中的操作。SnapshotRefreshSuperseded 标记钱包/人工加载取代的刷新，安排恢复而不误报 API 故障。

钱包连接、断开及 accountsChanged/chainChanged 引发的失效现在立即递增旧读取代次，清除报价、预览、奖励与旧账户 directEscape 状态，刷新按钮门控；directEscape 仅在账户变化时被清除，普通 API 故障仍保持独立链上逃生能力。

新增请求期间开始操作、prepare 期间开始操作、上下文取代后恢复测试。70 项前端测试、类型和构建通过；这仍是协调器测试和页面接线验证，实际钱包浏览器联合操作验收未完成，B16 和其余完整后端目标保持开放。

### 2026-09-06 B12 Curve 成交金额与价格口径

对照 TickerGardenCurve.buy/sell 的 emit 与 CurveMath 计算：CurveBuy.quoteIn 是实际 quoteSpent（排除 refund），CurveSell.quoteOut 是净收到 Quote。新增 internal/analytics/curve.go，在已认证事件之上归一化：买入曲线金额=现金流-fee-tax，卖出曲线金额=现金流+fee+tax，分别保留全部原始字段。tax 保留事件合并口径，不冒充全部 Creator 收入。价格用约分整数分子/分母表达 QUOTE_PER_WHOLE_MEME_EXCLUDING_FEES，Meme 18 decimals，Quote 6–18 decimals，不使用浮点。

测试覆盖买卖不对称费用口径、超 JS 安全整数、退款事件拒绝、缺字段/零量/负结果/uint256 溢出/无效 decimals。analytics race 与 vet 通过。该函数不认证 emitter、不将 CurveSell 自动认定为用户成交；内部奖励转换分类、持久投影接线、Pool、K 线与 HTTP 仍待开发，B12 保持首版必需且未完成。

### 2026-09-06 B12 持久 Curve 事实读取适配

新增 analytics.LoadCurveObservation，从 canonical_projection_rows 的 events/curveTrades 同键同块记录联合读取，连接区块号/hash/timestamp；要求块时间存在、每份 payload 不超过 64 KiB。比较完整来源、eventKey、参数一致性，验证市场及地址格式，再调用金额归一化。复用现有按规范区块、回执及 finalized 投影检查点过滤的视图，不新建重复事件账本。Quote decimals 必须由调用者传入已核验配置，尚未接线配置解析器。

输出显式 classification=unclassified、actorConfidence=contract_caller_not_verified_wallet，不将 Curve caller 自动当作真实钱包，也不把奖励兑换混入用户统计；不声称当前价格/readiness。新增金额/来源/键/市场/账户冲突以及退款事件拒绝测试，analytics race/vet 通过。数据库查询适配器已实现但尚未做本模块真实 SQL 联合测试或 HTTP/worker 接线；Pool、交易分类与 K 线仍待完成，B12 和完整目标继续开放。

### 2026-09-06 B12 Curve 读取真实 PostgreSQL 验证

新增 integration/analytics_test.go，在隔离数据库建立链/发现/投影检查点及 Curve 事件行，实际执行 LoadCurveObservation SQL。验证 6 decimals Quote 的价格 97/200、区块时间、来源和未分类标记；缺失区块时间、失去 canonical、回执未验证、finalized 高度低于投影、事件与投影金额冲突、错误链均拒绝。各条件恢复后记录重新可读。

集成检查接入 TestPostgresMigrationAndReadiness，在本机 PostgreSQL 上以 race/count=1 运行通过，复用迁移与临时数据库自动清理。事实行是受控 SQL 夹具，因此该验证证明实际查询与规范视图过滤，不代表从真实 RPC 索引到分析接口的端到端完成。Quote 配置解析、内部兑换分类、Pool/K 线与 HTTP/worker 接线继续待办，完整目标保持开放。

### 2026-09-06 B12 市场与 Quote 配置自动解析

LoadCurveObservation 已移除调用方 decimals 参数，在同一 SQL 快照联合规范市场与 Quote 配置行，核对 marketId、quote configId/kind、Curve emitter、Quote 地址；解析 6–18 decimals，原生 Quote 必须 18，Meme 地址非零。返回 Quote/Meme 地址、配置 ID 与 decimals 供后续按资产聚合。历史读取不要求配置当前 ACTIVE，因此停用配置不会抹除既有成交。

真实 PostgreSQL 集成测试新增自动读取 decimals、停用配置仍可读、无效 decimals、错误 Curve、缺失配置引用、Quote 不匹配及零 Meme 拒绝，并验证恢复正常。隔离数据库 race 集成测试、analytics race/vet 通过。交易分类、Pool/K 线、HTTP/worker 接线仍未完成，B12 与完整后端目标保持开放。

### 2026-09-06 B12 内部奖励兑换活动分类内核

核对 FeeVault 源码确认 settleRewards/settleHolderRewards 均要求 Pool 阶段；逐用户 RewardConverted 是批次权益分配，随后 RewardBatchConverted 才是整批汇总。新增 NormalizeConversionSummary，将批次与 Holder 汇总分别标记 internal_reward_conversion/internal_holder_conversion，保留资产、market、nonce/epoch 和实际 spent/received 原始整数。逐用户分配及非汇总事件返回 ErrNotConversionSummary，不能再作为另一笔兑换。

测试验证两类活动、原生 Quote、超过 JS 安全整数、零/非法金额、同资产、nonce/epoch 边界、错误模块与逐用户事件排除；analytics race/vet 通过，签名与冻结事件目录一致。本阶段仅分类已认证汇总事件，不自动推断交易中所有 Swap 都是内部兑换；实际 Swap 关联、持久查询、Pool/K 线和 HTTP 接线仍待继续。B12 及完整目标保持开放。

### 2026-09-06 B12 Pool 核心成交与 Hook 费用归一化

对照本地 Uniswap PoolManager（Swap 在 afterSwap 前发出）、Hooks.swapDelta-hookDelta 及 TickerGardenMemeHookFeeCalculation/Execution，新增 NormalizePoolAmounts。按规范 Currency0/1 与 Meme/Quote 绑定解析 int128 正负号，保留核心成交原始金额和精确有理数价格；本协议仅接受零 core pool fee。提供唯一配对的 V4FeeAccrued 时核对市场/池/feeAsset/base/LP+nonLP 合计，再从对应 caller delta 扣 totalFee。没有费用事件时 fee 与 caller delta 均为 null，不假装免手续费。

测试覆盖买卖、两种资产顺序、Meme/Quote 收费共八组组合，以及方向、溢出、core fee、错误池/资产/基数/费用拆分拒绝。analytics race/vet 通过，事件签名与冻结目录一致。绑定认证与费用事件唯一配对仍由上层提供；该内核不把 sender 认作钱包，也未完成内部兑换 Swap 关联、数据库接线和 K 线接口。B12 及整体目标继续开放。

### 2026-09-06 B12 Pool 持久配对读取适配

新增 LoadPoolObservation，联合 canonical_projection_rows 的 Swap 事件、swaps 投影及 hookFeeEventKey 指向的费用事件，并读取规范区块时间。SQL 拒绝多个 Swap 引用同一费用事件；解码层核对完整 Swap 来源/参数、同区块同交易同交易序号、费用日志在后、feeId 和 uint64 nonce，再调用 Pool 金额内核。已配对但事件缺失必须失败，未配对保持费用与 caller delta 未知。

新增成功/无费用、缺失费用、错误顺序、跨交易、feeId/Pool 不匹配和参数冲突测试，analytics race/vet 通过。PoolBinding 仍由上层认证传入，真实 PostgreSQL 配对 SQL 验证、绑定自动解析与内部转换 Swap 关联尚未完成，不把整笔交易所有 Swap 自动标为内部兑换。B12 和完整目标继续开放。

### 2026-09-06 B12 Pool 配对真实 PostgreSQL 验证

新增 integration/pool_analytics_test.go，复用隔离 analytics 链/检查点/区块，实际执行 LoadPoolObservation SQL：验证正常配对的来源、时间、核心成交与扣费后 delta；删除配对费用事件、多个 Swap 指向同一费用事件、失去 canonical 均拒绝，恢复后重新可读。移除配对字段时返回未知费用，即使同交易中仍存在费用事件也不猜测关联。

真实 PostgreSQL 的 TestPostgresMigrationAndReadiness race/count=1 通过，包含既有迁移和读模型检查。测试使用受控投影行而非实际 RPC Swap 采集，PoolBinding 自动解析、实际协议费用链路/内部兑换关联与 K 线接口仍待开发，B12 与完整目标继续开放。


### 2026-09-06 B12 Pool 绑定自动解析

LoadPoolObservation 不再接受外部 PoolBinding：在同一 SQL 快照联合规范市场、按市场 ID 保存的 PoolKey、不可变 Quote 配置和成交记录，要求唯一匹配；校验资产顺序、Quote 精度、零核心费率、正 tickSpacing、graduatedHook，并重算 keccak256(abi.encode(PoolKey)) 与 Swap poolId 比较。配对费用 emitter 必须等于绑定 Hook。结果补充 Quote/Meme 地址、配置 ID 和精度。历史 Quote 配置退休不阻止历史读取。

真实 PostgreSQL 集成用独立 ABI encoder 生成 PoolId，覆盖正常/退休配置、资产顺序、tickSpacing、fee、Hook、配置引用/精度/资产、费用来源和重复市场拒绝，以及此前的缺费用、重复费用关联、canonical 失效/恢复。测试是受控持久投影输入，不代表实际 RPC 全链路或生产验收；内部兑换与 Swap 关联、活动流、K 线和 HTTP/SDK 仍未完成。

### 2026-09-06 B12 内部兑换 Swap 关联内核

新增 LinkConversionSwaps，输入要求为完整、规范、回执核验且已认证模块/地址的单笔交易日志，以及认证后的市场 Pool/Hook/FeeVault/PoolManager 绑定。按日志顺序将 Hook sender 的卖出 Swap 与后续对应 FeeVault 汇总一对一关联，校验市场、资产、核心成交金额和来源；普通 router Swap、RewardConverted 分配事件不作为内部兑换。拒绝缺失/重复、乱序/跨交易、金额或来源不符，支持同交易连续奖励批次和 Holder 兑换。

合约依据：TickerGardenRewardConversion.unlockCallback 直接 manager.swap；冻结的 v4 Hooks.sol 在 sender 等于 Hook 时跳过 before/afterSwap，故这条已认证路径的核心 delta 等于实际 spent/received，无普通 Hook 费用事件。关联结果明确标注 hook_self_call_bypasses_callbacks，不将通用缺失费用推断为零。

analytics race 测试与 vet 通过，涵盖两种资产顺序、两种摘要、普通成交/分配排除和异常拒绝。当前为独立关联内核，尚未接完整交易的持久读取与实际协议 RPC 端到端验收，不能据此宣告内部兑换活动流或 B12 完成。

### 2026-09-06 B12 内部兑换持久交易证据读取

新增 LoadConversionLinks，在 repeatable-read 只读事务读取成功回执，要求 canonical/receipts_verified、投影覆盖与 finalized 高度约束；验证回执交易/区块身份与递增日志顺序。批量读取对应 projection_inputs，核对 digest、链身份及逐日志与回执一致性，用已记录模块重新解码后交给关联内核。已绑定协议地址的已知事件缺少投影输入必须失败；限定回执/输入总字节和日志数量。

真实 PostgreSQL TestPostgresMigrationAndReadiness race/count=1 通过：规范输入产生单一奖励兑换关联；删除 Swap 输入、错误 digest、改写输入但重算 digest、失去 canonical、回执日志乱序均拒绝；恢复后重新可读。analytics race/vet 同步验证。测试直接编码合约事件并写入隔离数据库，尚非 RPC 完整采集验收。

部署/市场 ConversionBinding 仍由已认证上层传入；自动解析这组绑定、HTTP/SDK、活动流/K 线和实际协议全链路测试继续开放，不把存储读取接通等同 B12 完成。

### 2026-09-06 B12 内部兑换绑定自动解析

LoadConversionLinks 改为接收服务器部署 Manifest 与交易哈希，不再接受调用方组装的 ConversionBinding。按 projector 相同的地址排序计算清单摘要，要求 projection/discovery 检查点摘要、起点与链 genesis 一致；FeeVault/PoolManager 从清单唯一解析。根据回执涉及的市场/Pool 查询规范市场、PoolKey 和 Quote 配置，在同一 repeatable-read 事务重算 PoolId 并校验资产、精度和 Hook，关联内核继续拒绝重复市场/Pool。即使绑定解析为空，也检查清单核心地址的已知事件是否缺少投影输入。

真实 PostgreSQL race/count=1 通过，新增清单摘要错配、缺少 PoolKey、非法 Quote 精度拒绝及恢复。analytics race/vet 通过，清单测试覆盖顺序无关、调用方不被修改、缺失及歧义核心模块。当前依赖既有认证 projector 的持久结果；该读取不重新进行链上 runtime 核验，也未完成实际 RPC 采集到 API 的全链路验收。活动流、K 线和 HTTP/SDK 继续开发。

### 2026-09-06 B12 精确 K 线聚合内核

新增 BuildCandles 与 Curve/Pool observation 转换函数，按区块、交易序号、日志序号确定开收盘，使用 big.Int/big.Rat 计算价格与累计成交量，不经过浮点数。支持 1m/5m/15m/1h/4h/1d、对齐的 [from,to) 范围、最多 2000 桶/100000 成交；空桶 OHLC=null、volume=0，不填造 carry-forward 成交。价格与总量明确使用 Curve 排除 fee/tax 或 Pool core 口径；内部奖励/Holder 转换纳入真实成交价格并单列数量和金额，unclassified 不标成用户成交。

analytics race/vet 通过：精确 OHLC、输入乱序但链顺序稳定、无成交桶、边界、uint256 大额累计不溢出、重复来源/混合分支/时间倒退/市场资产精度错配和非法分类拒绝；调用方输入不被排序修改。当前聚合输入必须已完整覆盖区间，内核不能证明覆盖；持久区间读取必须在公开零成交桶前完成此证明。尚未接 HTTP/SDK、数据库区间聚合或端到端验收，B12 保持未完成。

### 2026-09-06 B12 数据库时间区间覆盖校验

新增 VerifyRangeCoverage，供成交查询在同一个 repeatable-read 事务调用。核对部署摘要、发现/投影起点、genesis、finalized/发现高度和投影 tip；要求 from 前存在锚点、to 或之后存在已投影区块，检查从投影起点到 tip 的区块连续、父哈希连接、回执核验、时间非空且不倒退。返回边界与检查点身份，不允许把证据复用于另一数据库快照。扫描暂限 100000 个高度跨度，超限拒绝而非抽样；后续需持久覆盖证明或分段验证以支持长历史。

真实 PostgreSQL race 集成通过：有效边界、末端尚未覆盖、起点不足、缺规范区块、回执失效、空时间、时间倒退、父哈希错配及 finalized 不足。测试促使验证扩至完整投影区间，防止仅验证首个到达 to 的区块而漏掉后续时间倒退。当前是覆盖校验组件，尚未与成交区间读取/K 线 HTTP/SDK 接线，不宣告 B12 完成。

### 2026-09-06 B12 数据库成交到 K 线接线

新增 LoadMarketCandles：从规范市场/Quote 配置解析身份和精度，在同一 repeatable-read 事务执行覆盖证明、候选事件读取、Curve/Pool 归一化、Pool 交易回执与内部兑换关联及 BuildCandles。既有单条读取接口保留，共用支持事务的内部函数，避免子查询另开快照。按交易缓存关联结果；单次最多 10000 成交，超限拒绝。输出资产/精度、区间、覆盖检查点和精确 OHLCV。

真实 PostgreSQL race/count=1 通过，实际查询 Curve 97/200 价格及 970000 核心 Quote 量；Pool 奖励兑换价格 10、内部成交数和 Quote 量单列；覆盖不足或存在事件但缺少 Curve 成交投影时拒绝。analytics race/vet、diff 检查通过。测试为隔离数据库受控事件/回执，尚非实际 RPC 到前端验收。

当前依赖认证 projector 已持久化完整事件；成交逐条归一化读取需继续批量优化，覆盖扫描有 100000 高度跨度上限，尚未开放 HTTP/SDK、长历史/负载验收或活动流。B12 与完整开发目标继续开放。

### 2026-09-06 B12 K 线 HTTP 与运行配置

新增 GET /v1/markets/{marketId}/candles，严格校验 interval/from/to、重复/未知参数、十进制规范形式、范围对齐和 2000 桶限制；服务端 10 秒截止时间。400 表示参数错误，503 表示未配置/覆盖不足/读取失败，不泄露数据库错误，不把缺失数据输出为空行情。响应增加 chainId/displayOnly，保留市场资产、覆盖来源与精确价格/量。TG_ANALYTICS_MANIFEST 绑定数据库与服务链，启动解析并构建 CandleStore。

HTTP 参数/方法/未配置/错误脱敏测试与 PostgreSQL 到真实路由测试覆盖 Curve 970000 核心 Quote 量。OpenAPI/SDK 尚未同步，批量性能、长历史、前端及生产验收仍待完成，B12 保持开放。

### 2026-09-06 B12 K 线 OpenAPI 与 SDK

OpenAPI 升至 2.13.0（新增第 9 个 GET 路径），定义 CandlePrice/Candle/CandleCoverage/CandleSeries/MarketCandlesResponse/CandleError，明确分数价格、raw 整数字符串、空 OHLC、内部成交人口径与覆盖限制。生成 getMarketCandles，from/to 使用规范十进制字符串，纳入 503 analytics_unavailable 错误类型；同步前端客户端及 Go 内嵌规范。

backend-api 测试通过，新增 SDK 路径/参数、前导零拒绝与错误类型测试。真实 PostgreSQL 到 HTTP 路由的响应通过冻结 MarketCandlesResponse JSON Schema 验证。前端构建验证生成客户端相容性；尚未实现前端 K 线展示、活动流或生产/负载验收，B12 继续开放。

### 2026-09-06 B12 前端小时 K 线接入

交易页左栏新增 Price history，读取 getMarketCandles 的 24 个完整小时（预留最近一小时给最终性），提供手动刷新、加载/无成交/暂不可用状态；市场切换取消旧请求并用代次拒绝过时响应。SVG 按精确有理数计算相对坐标，最后仅将有界像素值转 Number；空小时不画假蜡烛。响应校验链/市场/资产/精度、区间/覆盖来源、OHLC 顺序、成交数及内部量边界，行情明确包含内部兑换且仅展示用途。

72 个前端测试与构建通过，新增超浮点精度价格的顺序/缩放、空区间与身份错配拒绝测试。未完成浏览器实际图形/移动布局/异步切换验收；完整 OHLC 可访问表格和历史范围选择仍待补充。后端长历史/批量性能、活动流和生产验收继续开放，不把前端初次接线当作 B12 完成。

### 2026-09-06 B12 K 线数据表与组件浏览器验收

新增折叠每小时数据表：UTC、OHLC、Meme/Quote 整币成交量、内部 Quote 量及总/内部成交数；bigint 格式化原始量，保留到 token 最小单位，不经过浮点。价格说明最多 8 位小数并向下截断，空小时显示 No trades。表头/行头使用语义表格，滚动区域可键盘聚焦；无成交响应也可查看 24 行零量表。

Chrome 中使用 tests/browser/candles.html 受控夹具运行真实组件，检查正常蜡烛及空小时、无成交、503 后移除旧图表/表格；桌面截图检查通过。390x844 检查发现坐标文字缩小，已改为最小 600px 图表加内部横向滚动；复验图表和 Enter 展开表格，24 行完整，表格区域 clientWidth=316/scrollWidth=1074。临时 viewport 恢复、测试 tab 和 Vite 4393 服务已关闭。

73 个前端测试与构建通过。上述为组件夹具与 mock HTTP，不能替代实际交易页完整样式、真实 Go/RPC 数据、钱包/市场异步切换端到端验收；活动流、长历史与批量性能等 B12 缺口继续开放。

### 2026-09-06 B12 成交活动读取与 K 线共用来源

抽出 LoadMarketTrades 与 TradeActivity，在同一数据库快照内读取已覆盖时间区间、归一化 Curve/Pool 成交并附内部兑换分类，按区块/交易/日志倒序返回。活动保留来源、时间、方向、资产、精度、核心金额、分数价格及费用/税口径；Curve actor 标记为合约调用者而非已验证钱包，Pool actor/recipient 暂为 null。RewardBatch/Holder 汇总不另建成交活动。LoadMarketCandles 复用这些已验证执行记录，避免活动与 OHLCV 用两套金额算法。

真实 PostgreSQL race 集成验证 Curve actor/fee/tax/970000 核心 Quote 量，以及 Pool 内部奖励兑换只产生一条成交、保持未知钱包身份；既有 K 线 HTTP/schema 验证仍通过。analytics race/vet 与 diff 检查通过。当前返回有界完整区间，未开放 trades HTTP/SDK 和分页；Pool sender 认证归因、非成交活动、批量性能及端到端验收仍待完成，B12 保持开放。

### 2026-09-06 B12 成交分页与 HTTP

新增 PageTrades 与 GET /v1/markets/{marketId}/trades，参数 from/to、可选 limit=1..100（默认50）及 cursor。游标绑定 chain、market、时间区间、limit、完整结果 SHA-256 摘要和末条 eventKey；严格 JSON/base64 形式及范围匹配。完整数据或覆盖检查点变化返回409 trade_page_changed，要求丢弃旧页并从头查询；参数/游标错误400，覆盖不足503。与 CandleStore 共用部署配置，未配置时保持 nil 接口而非 typed-nil。

205 条记录分页单测覆盖100/100/5、末页无游标、范围/市场/链/limit错配、数据变化及空列表；HTTP错误映射与真实 PostgreSQL -> trades HTTP 的内部兑换单条记录验收。当前每页仍读取和核验完整有界区间，尚未数据库分页优化，也未同步 trades OpenAPI/SDK；不据此宣告 B12 或性能验收完成。

### 2026-09-06 B12 成交 OpenAPI/SDK 同步

OpenAPI 2.14.0 新增第10个GET路径与 listMarketTrades，定义完整 TradeSource/TradeActivity/MarketTradesResponse/TradeError。保留事件来源、金额与价格精度、actor/recipient/fee/tax 的显式 null、账户可信度和内部兑换分类；明确分页范围一致性与409丢弃旧页重查。生成并同步 backend-api、前端 SDK 与 Go 内嵌规范。

SDK 测试新增参数编码、limit超限拒绝及409错误类型；真实 PostgreSQL -> HTTP 的 Curve 和 Pool 内部兑换响应均通过 MarketTradesResponse schema 校验。backend-api 32 项测试与前端构建通过。前端成交列表、数据库分页优化、实际协议与生产全链路验收仍未完成，B12 继续开放。

### 2026-09-06 B12 前端成交列表初次接线

交易页新增 Recent executions，调用 listMarketTrades，显示 UTC 时间、venue/side、经济分类、Meme/Quote 核心量、价格与调用者身份可信度。采用24个已完成小时范围、每页50项、手动刷新和加载更多；市场切换取消旧请求，代次隔离过时响应；409或读取失败清空旧页并提示重新刷新，避免混页。

新增运行时响应校验：市场/链/资产/精度、覆盖区间及revision、来源eventKey、时间范围、精确金额与分数价格等式、费用/actor空值语义、成交倒序与跨页去重。内部转换不标为用户交易，Pool未知身份不补钱包地址。75项前端测试及构建通过；新增翻页连续性、revision变化、重复来源、错误价格/时间/身份拒绝测试。

本阶段未完成成交列表浏览器多页/409/切换验收，仍待实际协议数据、数据库分页性能和长历史覆盖；不把 UI 接线提升为 B12 完成。

### 2026-09-06 B12 成交列表组件浏览器分页验收

新增 tests/browser/trades.html 受控夹具，Chrome 验证50条首屏 + 1条第二页共51条；旧游标409后列表清空为0并提示重查。Slow market A 请求故意延迟且不响应 abort，立即切换 Market B 后等待旧请求返回，仍保留50条B记录及B价格20，未被A价格10覆盖。桌面截图核对分类与未知身份；390px截图发现长列表占满页面，改为最多480px内部滚动，完整页面截图确认刷新/加载更多按钮仍在列表下方。

75项前端测试与构建通过。上述仅组件与受控HTTP数据，不代替真实Go/RPC和交易页完整样式验收；几何 evaluate 两次超时后使用截图确认布局，未重复触发业务操作。浏览器临时 viewport 已恢复、测试tab及4393 Vite进程已关闭。B12长历史、数据库分页性能和生产联合验收继续开放。

### 2026-09-06 B12 覆盖验证数据库聚合与长历史测试

VerifyRangeCoverage 改用 PostgreSQL window/aggregate 验证从投影起点到 tip 的数量、连续高度、父哈希、规范哈希、回执核验与非空单调时间，仅返回验证布尔值及两个边界 hash。保留同一 repeatable-read 事务和范围锚点要求，移除原 100000 高度跨度硬拒绝，避免把整个链区间传回 Go。bool_and 的 NULL 显式视为失败。

真实 PostgreSQL 测试扩展至 tip=100003（100004个区块），有效历史通过，第99999块 receipts_verified=false 拒绝；各自设置10秒上下文超时，观测耗时约1.58s/1.94s。原缺块、时间倒退、空时间、父哈希错配等拒绝用例保留。analytics race/vet、32项API测试通过；OpenAPI 2.14.1 同步移除旧硬上限描述。

数据库仍需扫描完整历史，未新增增量覆盖证明或数据库成交分页。此优化不代表百万区块/并发生产负载达标，10秒请求预算与10000成交区间限制仍有效；B12保持开放。

### 2026-09-06 B12 成交与绑定查询索引

新增迁移63，分别为 Curve 事件 emitter、Pool Swap id、市场 poolId、Swap hookFeeEventKey 建部分表达式索引，匹配规范投影查询谓词。索引不改变认证/分类/金额语义；Down 删除新增的四个索引。升级计数及旧 nonce 角色迁移测试同步至63，保留幂等启动和已有账户数据验证。

真实 PostgreSQL 2万条分散 emitter/Pool 事件上执行 EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)：经 canonical_projection_rows 的选择性查询在未关闭 seqscan/未强制计划时分别使用 projection_curve_execution_lookup / projection_pool_execution_lookup，查询结果身份一致。四索引存在性及完整 TestPostgresMigrationAndReadiness race/count=1 通过（包含100004区块覆盖和Curve/Pool HTTP/schema测试）。

仅证明选择性路径使用索引，不宣告整体性能目标达标。完整区间重读、逐成交归一化、数据库分页与增量覆盖证明仍待优化，生产迁移尚未执行；B12保持开放。

### 2026-09-06 B12 Pool Swap sender 来源接线

normalizePoolRows 从事件/投影已一致的 Swap args 读取规范非零 sender，缺失或畸形地址拒绝。PoolObservation 保存 sender，TradeActivity.actor 传递为 contract_caller_not_verified_wallet；recipient 仍为 null，既不从 emitter 推断，也不把 Hook/router 认定为用户钱包。前端接受该明确的调用者可信度，保留旧的 unavailable/null 兼容显示。

真实 PostgreSQL 集成通过，内部奖励兑换的活动 actor 等于 Swap sender Hook 地址0x...03；普通 Pool 样例补充并核对事件来源。analytics race/vet、新增缺失/畸形sender与活动归因测试通过；76项前端测试与构建通过，拒绝伪造 verified_wallet 可信度。当前仍未解析最终钱包或接收者，不声称具备用户级交易归属证明。B12数据库分页、长历史性能及真实协议全链路验收继续开放。


### 2026-09-06 B13 按资产成交统计内核

新增 AggregateAssetTrades：按 STOCK assetUid 与 Quote 地址分组，累计市场数/有成交市场数、成交数、内部与未分类成交数、核心 Quote 量及内部 Quote 量。不同 Meme 数量不合并；fee/tax 按真实费用资产地址与精度单独累计，UnknownFeeTradeCount 表达缺失费用观察，避免把未知当零。Curve税保留原税口径，不冒称全部为Creator收入；储备、持有人、用户钱包数不从成交推断。

输入要求同一完整覆盖快照和已认证的市场资产绑定，拒绝重复市场/事件、跨快照/精度/金额错误及不支持分类。analytics race/vet通过：三市场7000000 Quote量与内部4000000、不同Quote分组、独立Meme费用资产、无成交市场计数和各拒绝路径。本阶段仅聚合内核，资产绑定自动读取及HTTP/SDK尚未接线；B12未完成的性能/协议验收继续保留，B13同样保持开放。


### 2026-09-06 B13 资产统计持久读取

新增 LoadAssetStatistics，在同一 PostgreSQL repeatable-read 只读事务内验证区块覆盖、解析注册 STOCK 身份及精度、枚举绑定市场并读取规范成交，复用聚合内核生成按 Quote 分组的结果。覆盖验证每次资产查询只执行一次；已退役资产允许查询历史。拒绝未注册资产、异常精度及不完整市场绑定，避免静默遗漏。每资产最多1000个市场、总计100000条成交，各市场仍受10000条限制，超限报错而不截断统计。

真实 PostgreSQL 集成验证 Curve 与 Pool 两种 Quote 独立分组、Curve 核心成交量970000及费用10000/税20000、内部兑换量10000及未知费用计数，并覆盖错误精度、缺失市场元数据、未注册资产的拒绝路径。完整 TestPostgresMigrationAndReadiness race/count=1 通过（42.849秒），analytics race/vet 和 git diff --check 通过。

本次完成持久读取层；统计 HTTP/SDK、持有人存量、首页接线及生产负载验收仍未完成。B11、B12、B13、B14、B16 继续作为第一版必要项，不能以本阶段通过替代整体上线验收。


### 2026-09-06 B13 统计 HTTP 与 SDK

新增 GET /v1/assets/{assetUid}/statistics，必填 from/to，采用半开时间区间；严格拒绝重复、未知、非规范或倒置参数。复用 TG_ANALYTICS_MANIFEST 的数据库服务，10秒请求上下文、no-store 和 displayOnly；读取失败、缺失服务及返回身份/范围不匹配均返回503，不暴露内部错误。按 Quote 分组及按实际费用资产分别累计的语义保持不变。

OpenAPI升级2.15.0，新增三个统计响应类型及 getAssetStatistics SDK，并同步Go模型、嵌入契约与前端SDK。真实 PostgreSQL -> HTTP -> AssetStatisticsResponse schema 验证通过；完整集成 race/count=1 通过（117.353秒，包含长历史测试与数据清理），Go httpapi/analytics/app race、vet、33项API测试、前端构建和差异检查通过。SDK覆盖参数编码、非法资产ID及503结构化错误。

本次完成单资产成交统计接口；持有人余额投影、全局/首页聚合展示和生产负载验收仍待开发，不能据此将B13或第一版后端标为完成。


### 2026-09-06 B13 持有人余额重放内核

核对 TickerMemeTokenV1：部署时向Curve一次性铸造固定初始量，后续仅Treasury可销毁自身余额。新增 RebuildHolderBalances，按规范来源排序重放Transfer，校验初始铸造、拒绝后续铸造/非Treasury销毁/负余额/重复事件/冲突区块，使用uint256整数并检查最终余额总和等于剩余供应量。零额转账不制造持有人，自转账仍要求充足余额。

结果保留所有非零余额地址，明确返回排除地址清单及排除标记；排除策略仅影响included地址数，不改变供应量和余额，也不将地址数称为用户数。analytics race/vet及差异检查通过；测试覆盖乱序复算一致、转出归零、Treasury部分和全部销毁、零额/自转账、最大uint256及错误历史拒绝。

这是要求调用方提供已认证完整历史的纯计算内核，不能自行证明历史完整性或finalized状态。接下来仍需读取并核验完整Token回执历史、来源快照与市场绑定、HTTP/SDK和前端持有人展示；现有Treasury历史核验可供复用，但本次未将其根请求上下文直接挪用为公开持有人接口。B13保持未完成。


### 2026-09-06 B13 Transfer 回执双向核对

新增 DecodeHolderTransfers，将完整回执集合与Token过滤日志双向核对，再通过协议ABI解码为余额重放输入。核对区块/交易/日志来源、失败交易无日志、每块交易索引及全日志索引连续、唯一交易和区块高度/哈希对应；拒绝删除、重复、改写或removed日志。最多100000条回执/日志与64MiB序列化处理预算，超限报错。

解析输出保留chain/block/transaction/log/emitter/eventKey，不从Trade或奖励分配推断转账。与RebuildHolderBalances串联的初始铸造测试通过；缺失任一方向、重复记录、失败回执携带日志、交易索引缺口、金额改写及removed日志均拒绝。analytics race/vet和差异检查通过。

该解析器仍要求调用方认证完整回执集合；索引连续不能证明末尾交易未被遗漏。持久读取需要进一步绑定市场创建记录、规范区块覆盖及回执完整性证据，当前尚未提供公开holders端点。不能将本阶段称为完整持有人服务。


### 2026-09-06 B13 回执集合承诺与持久区间读取

迁移64为chain_blocks增加receipt_count/receipt_set_hash，初始NULL保留未知状态。Journal观察时对有序回执集合生成带版本域的SHA-256摘要，与回执同事务写入；旧区块通过RPC重新观察并核对已有过滤日志后补齐，不从现有回执行自行宣告完整。已有摘要冲突时拒绝覆盖。该摘要是本地观察完整性证据，不是Ethereum receipts root或独立提供方证明。

新增DecodeCommittedHolderTransfers和ReadCommittedTransferRange：读取同一事务的连续规范/已finalized区间、父哈希/时间、回执数量及摘要，核对回执行身份后与Token日志双向比对。删除末尾回执及对应日志、改写计数但未匹配摘要、旧NULL承诺均不能通过。调用者仍需绑定manifest/genesis、真实Token及市场创建起点，任意有效区间不能等价于完整Token历史；公开holders接口尚未完成。

chainrpc/analytics race与vet通过；真实PostgreSQL的journal子测试通过（27.024秒），覆盖64项迁移、承诺补齐不前移tip、冲突拒绝、数据库读取成功及删除回执后拒绝。analytics和journal改为可独立选择的子测试，默认完整执行仍包含二者。

完整集成尚未通过：第一次因100004区块夹具清理耗尽两分钟总上下文而失败，整体预算调至五分钟，单次查询十秒预算未改；重跑长历史覆盖查询耗时10.075秒并超过十秒限制。此前1.6秒级结果不能代表当前负载稳定达标。B12长历史性能问题保持开放，后续需定位与优化，不能以本次journal单项通过替代完整集成验收。


### 2026-09-06 B12 长历史超时与区块清理查询优化

定位完整历史覆盖查询中的逐行hash正则开销，将两个固定格式哈希检查改为等价的length/left/translate判断。保留全部区块、父哈希、回执核验、时间单调及NULL拒绝规则，不缩短校验范围、不放宽10秒查询上下文。数据库对照覆盖非法前缀、大小写、长度、换行和非ASCII字符。临时表100004个哈希的反向顺序对照观测：字符集检查0.769秒，正则1.816秒；该微基准不代表整体生产负载。

进一步查明区块删除时projection_rows外键检查缺少(chain_id,block_hash)索引：EXPLAIN显示一次无匹配查询扫描772个数据页，耗时1.258毫秒，十万次父行检查会放大开销。迁移65新增projection_rows_block_lookup，真实2万行夹具下未强制执行计划即使用该索引。迁移升级计数同步65，保留Down。

替换正则后的完整PostgreSQL集成先通过（126.774秒）；加索引后的最终完整race/count=1再通过（61.216秒），包含65项迁移、100004区块成功证明、深处未核验区块拒绝、摘要/持有人区间读取及HTTP契约验证。analytics race、相关包vet与差异检查通过。此前本地集成失败已得到复验闭合，但增量覆盖证明、百万区块/生产并发性能仍未完成，不将一次通过视为生产容量承诺。


### 2026-09-06 B13 市场持有人完整历史绑定

新增LoadMarketHolders与CandleStore.Holders：在同一repeatable-read事务中核对manifest/discovery/projection/genesis、规范发现记录、Factory地址及精确MarketCreated签名、源日志与完整回执、Token/Curve运行时代码观察。以创建区块为起点读取到已finalized投影检查点，初始铸造必须位于同一创建交易且先于MarketCreated，Token/Curve与创建事件一致，再调用已承诺回执读取及余额重放。

输出包括市场/Token、创建和快照区块、快照hash、finalized标记、KNOWN_PROTOCOL_ADDRESSES_V1排除策略及明确清单。Curve、Treasury、FeeVault、PoolManager、Factory、Token自身、已配置Gauge/Hook作为已知协议地址；所有非零余额仍返回，排除只影响included地址数，不能视为独立用户数或奖励领取资格。

真实PostgreSQL夹具核对创建时100单位铸造并全部转给用户后的100供应量、一个非零且计入统计地址、来源区块/hash；错误manifest、Token改写、缺失回执摘要均拒绝，恢复后可读。最终数据库测试通过（36.366秒，选journal子测试并执行现有其余共享数据库用例，跳过重型analytics子测试）；analytics race/vet与差异检查通过。

公共holders HTTP/SDK、分页与前端仍未完成；此处仅完成绑定与可复算持久读取。百万区块/十万回执预算及并发性能仍需后续处理，B13继续开放。


### 2026-09-06 B13 持有人分页 HTTP/SDK

新增 GET /v1/markets/{marketId}/holders，默认50/最多100个地址，地址升序，保留协议排除标记及完整快照的供应量/地址总数。游标绑定chain/market/limit及全量结果摘要，源区块、余额或排除策略变化即409 holder_page_changed，要求丢弃此前页面重新开始。参数重复/非法/未知返回400，未配置读取器或不完整历史503；10秒上下文与no-store/displayOnly保持。

OpenAPI升级2.16.0，共12个GET路径；Go模型、嵌入契约及前端SDK同步，新增listMarketHolders及错误类型。205地址100/100/5分页无重复，改变chain/limit拒绝，区块/余额变化拒绝旧页，非法游标与空结果行为通过。真实PostgreSQL创建历史 -> HTTP -> MarketHoldersResponse schema通过；目标数据库集成4.401秒（跳过analytics重型子测试），Go analytics/httpapi/app race/vet、34项API测试与前端构建通过。

当前每页仍重建完整受预算约束的历史，不保留旧快照或宣告数据库分页性能完成。持有人前端、全局与首页统计、实际运行负载验收继续开放；B13尚未完成。


### 2026-09-06 B13 持有人前端接线

交易页新增Holder balances，显示18位精度余额、finalized区块/hash、总供应量、全量/排除协议后的地址计数及明确排除地址清单；单页50条、刷新/加载更多、请求取消与代次隔离、409/503清除旧表格。不会将地址数呈现为用户数或奖励资格。

前端校验链/市场/Token、区块和revision、地址排序与去重、排除标记、计数与整数范围。跨页保持相同快照，最后一页核对累计余额=总供应量及完整地址计数；错误/不完整数据拒绝展示。79项前端测试及构建通过。

新增受控tests/browser/holders.html，Chrome实测50+1共51条，409后表格清空并提示重查，空快照显示0，503显示不可用。桌面截图核对1.000000000000000001精度及协议地址标记，390x844截图确认表格在面板内滚动、刷新/更多按钮可见。临时viewport已恢复、测试tab及4393 Vite进程已关闭。该组件夹具不代替完整交易页样式、真实Go/RPC或市场切换竞态浏览器联合验收；B13首页/全局和生产性能仍待继续。


### 2026-09-06 B13 全局统计读取与HTTP/SDK

新增LoadGlobalStatistics，以一个repeatable-read快照校验覆盖并读取完整有界市场目录、注册STOCK身份及各市场成交。市场/注册数量对应projection检查点，流量对应[from,to)；注册数量包含退役项。按assetUid+Quote分组，零assetUid明确标记binding=unbound，不宣称是注册STOCK；不同Meme数量或Quote资产不隐含相加。缺失市场绑定、引用未知STOCK、不完整成交或预算超限均失败，不能通过静默跳过降低统计。

新增GET /v1/stats/overview与SDK getGlobalStatistics；OpenAPI2.17.0共13个GET路径，Go/TS及前端客户端同步。响应提供覆盖、市场总数、绑定/未绑定市场数、注册STOCK身份与分组成交量/费用/内部兑换。严格查询参数、10秒上下文、no-store/displayOnly保持。仍未提供USD估值、储备或跨市场持有人合计。

真实PostgreSQL验证两市场/一注册STOCK、970000 Curve核心量与10000内部Pool兑换、未绑定市场单列及异常绑定拒绝；最终完整TestPostgresMigrationAndReadiness race/count=1通过，包含全局HTTP响应schema。Go analytics/httpapi/app race/vet、35项API测试、前端构建及差异检查通过。首页展示、stats/series、全局持有人去重/存量口径、实际协议及生产负载验收继续开放，B13尚未完成。


### 2026-09-07 B13 首页与统计页全局数据接线

首页及stats页新增独立Global execution statistics组件，调用getGlobalStatistics；首页分组明细默认折叠，统计页展开。显示快照市场数、包含退役项的STOCK注册数、绑定/未绑定市场数，按STOCK和Quote显示24个已完成小时的原始成交量、内部兑换、各费用资产费用/税及未知费用观察计数。现有Curve储备区域保持明确独立口径，不把储备称为成交量；首页装饰果实未调整。

新增运行时校验：链/覆盖区间和哈希、目录计数守恒、注册绑定、唯一分组、资产精度、整数金额、交易分类和费用字段。刷新清空旧结果、取消请求并隔离旧代次；错误不显示零值。82项前端测试（含既有首页果实约束）及构建通过。

受控Chrome组件验证原始量3、内部1、费用0.000005和税0.000002、空目录0及503不可用；390px截图确认地址换行、内容与刷新按钮可见。viewport已恢复，测试tab和4393 Vite已清理。此为组件验收，完整首页/统计页样式与真实API联合验收尚待继续；stats/series、全局持有人去重与生产负载仍开放，B13未完成。


### 2026-09-07 B13 全局流量时间序列内核与数据库读取

新增BuildGlobalFlowSeries/LoadGlobalFlowSeries，将完整认证成交区间一次分桶，按STOCK/Quote输出成交数、核心Quote量、内部兑换数/量、费用资产明细及未知费用数。支持1m/5m/15m/1h/4h/1d，要求区间对齐，最多2000桶；市场数乘桶数最多100000，超预算明确失败，不采样。各桶不输出历史市场数、余额、价格或储备，避免将当前目录数量解释为历史存量。

Global overview与series共用loadGlobalSnapshot，一次repeatable-read事务完成覆盖、注册、绑定及成交读取后，使用不可变结果进行内存计算。先对完整区间做去重与金额校验，避免重复事件被拆入不同桶掩盖；每个已有资产组的无成交桶保持零流量/空费用数组，不生成交易。

单元测试覆盖60/120/180边界、240空桶、内部兑换4000000和未知费用计数、跨桶重复事件拒绝、右边界排除、空目录、非法间隔及输入不变。完整PostgreSQL集成race/count=1通过（35.330秒），验证真实Curve/Pool两组时间序列并回归已有overview/holders与迁移；analytics race/vet及差异检查通过。时间序列HTTP/SDK和前端仍未接线，B13及生产性能验收保持开放。


### 2026-09-07 B13 全局时间序列HTTP与SDK

新增GET /v1/stats/series，interval/from/to必填，支持1m/5m/15m/1h/4h/1d，对齐半开区间且最多2000桶。非法、重复、未知参数400；读取失败或返回范围/间隔/桶数不一致503。复用analytics清单与数据库服务，10秒上下文、no-store/displayOnly保留。

OpenAPI升级2.18.0，共14个GET路径；GlobalFlowSeriesResponse/Point/Group和SDK getGlobalFlowSeries生成同步至Go与前端。分桶只含流量字段，不带历史市场数或价格，空桶策略明确ZERO_FLOW_NO_SYNTHETIC_EXECUTIONS。

完整PostgreSQL集成race/count=1通过，包含真实Curve/Pool时间序列HTTP响应schema及现有overview/holders回归；Go analytics/httpapi/app race/vet、36项API测试、前端构建与差异检查通过。前端时间序列展示、全局持有人合计/去重、真实页面和生产负载验收仍待继续，B13保持开放。


### 2026-09-07 B13 统计页小时流量时间序列

统计页新增Hourly execution volumes，调用getGlobalFlowSeries读取24个已完成小时，选择STOCK/Quote组后显示逐小时核心Quote量、内部转换量/数量、成交数、按真实费用资产分别列示费用/税及未知费用计数。空时段保留0和No executions，不合并不同资产、不引入价格/储备。刷新取消旧请求并清空旧结果，错误显示不可用。

前端校验覆盖范围、24个连续桶、跨桶一致资产组、绑定类型、单位精度、整数金额与成交分类、无成交桶不得携带金额/费用。85项前端测试及构建通过。

受控Chrome组件确认25个表格行（表头+24小时）、两种Quote组切换、3单位内部成交及1.000000000000000001精确量；503后表格清空。390px截图确认内部滚动和刷新按钮，修正长分组选项为首尾缩写以便区分，表格说明保留完整身份。viewport已恢复、测试tab及4393 Vite已关闭。完整stats页面/真实API联合验收、全局持有人去重和生产负载仍待继续，B13保持开放。


### 2026-09-07 B13 全局持有人去重与同快照读取

新增AggregateHolderSnapshots，核对同一source区块/hash、finalized、市场和Token唯一、余额/供应量守恒、地址计数和排除标记后，分别统计市场-地址持仓关系数、全局去重地址数及按STOCK去重地址数。不合并不同Meme余额，不将地址数量称为人数。排除策略为所有市场已知协议地址的并集，避免市场A的协议地址在市场B被算入调整后数量；返回完整排除清单及UNION_OF_KNOWN_PROTOCOL_ADDRESSES_V1。

LoadGlobalHolderCounts在一个repeatable-read事务中读取完整有界发现目录与每个市场完整历史，绑定manifest/genesis/投影检查点和STOCK注册；LoadMarketHolders拆出同事务内部读取以供复用。额外核对STOCK assetUid与Factory创建事件一致，防止仅更改发现记录造成资产归属错误。最多1000市场/1000000持仓关系，现有单市场历史预算继续生效。

三个市场六个持仓关系得到四个唯一地址、全局协议排除后为三个；按STOCK分别去重，输入顺序不影响结果。混区块/hash、重复市场/Token/余额、供应量/计数/标记错配均拒绝。analytics race/vet与差异检查通过；最终真实PostgreSQL目标集成通过（4.225秒，跳过analytics重型子测试），验证单市场持久全局计数和未知STOCK绑定拒绝，并回归已有holder HTTP。

全局持有人HTTP/SDK、统计页展示尚未接线；跨市场全量重建的性能与生产验收仍开放。B13保持未完成。


### 2026-09-07 B13 全局持有人 HTTP 与 SDK

新增 GET /v1/stats/holders 和 SDK getGlobalHolderCounts，返回同一 finalized 快照的市场数、市场-地址持仓关系数、全局去重地址数、排除已知协议地址后的数量，以及按 STOCK 分组的去重数量。响应明确区块/hash、displayOnly 和 UNION_OF_KNOWN_PROTOCOL_ADDRESSES_V1 排除清单；地址数量不代表人数或空投资格。接口不接受查询参数，10 秒读取上下文，no-store；历史不完整或读取失败返回 503。

OpenAPI 升级 2.19.0，共 15 个 GET 路径，Go/TypeScript 模型及前端 SDK 已同步。真实 PostgreSQL 完整 TestPostgresMigrationAndReadiness race/count=1 通过（39.190 秒），包含全局持有人 HTTP 响应 schema 验证；analytics/httpapi/app race/vet、37 项 API 测试、前端构建及差异检查通过。

本次完成数据接口交付；全局持有人前端展示、完整页面与真实 API 联合验收、跨市场全量历史重建的生产性能验收仍开放，B13 尚未全部完成。B11、B12、B13、B14、B16 保持首版必要范围。


### 2026-09-07 B13 全局持有人统计页接线

统计页新增 Global holder addresses，接入 getGlobalHolderCounts；显示全局去重地址数、协议排除后数量、市场-地址持仓关系数及各 STOCK 独立去重数量。显示 finalized 区块/hash 和可展开的全局协议排除地址清单，明确地址不是人数或空投资格，跨 STOCK 分组存在重叠而不能相加。

前端核对链、快照、排除策略、地址和分组排序/唯一性、市场及持仓关系计数守恒、全局与分组去重数量上下界。刷新取消旧请求并隔离代次；非法响应和 503 清空旧明细，不显示为零。88 项前端测试、生成产物检查、类型检查、构建及差异检查通过。构建仍有既有大 chunk 提示。

Chrome 受控组件验证 6 个持仓关系、4 个全局地址、排除后 3 个地址及两个重叠 STOCK 分组；空快照显示 0，非法计数和服务失败清空明细。390x844 截图确认长地址换行和刷新按钮可见。viewport 已恢复，测试页及临时 Vite 已关闭。完整 stats 页与真实 Go API 联调、生产负载验收仍未完成；B13 保持开放。


### 2026-09-07 B13 完整统计页接线缺陷修正

顶部持有人卡片改由全局持有人组件更新，显示同一 holder 快照的去重地址数及区块说明；移除旧 renderStats 的 Not exposed 覆盖。刷新/失败清空卡片，避免与独立快照明细冲突。

修正 Quote 元数据失败时默认按 18 位小数展示的问题：未知或非法精度只显示 raw 整数，已知精度保持完整整数定点格式；ERC20 标签带完整地址，避免同名资产混淆。覆盖 RPC 失败、非法精度、6/18/0 位精度及 native 1 wei，90 项前端测试通过。

完整 stats 页在未配置 Read API 时，阶段和 Quote 区域改为明确不可用，清除错误的持续 Loading/空记录提示；目录分页失败同样拒绝显示局部总量。Chrome 验证完整页面未配置状态，以及持有人组件卡片正常 4/503 后清空。真实 Go API 成功路径联合验收与生产性能仍开放，B13 未完成。


### 2026-09-07 B16 统计组件接入快照更新

首页/统计页的 global overview、全局 holders 和小时 series 接入现有 5 秒 finalized 快照更新器。快照提交或重连补读后调用组件 refresh；新增合并调度器，将读取期间的多次更新合并为一次后续读取，避免每个通知取消正在进行的统计请求。统计响应仍显示自己的来源区块，不假称与目录响应原子一致。

快照读取失败、断网、隐藏页面或 pagehide 时取消统计调度与在途请求，清除明细和持有人摘要；恢复由原有 reconnect/reset 触发补读。小时序列在刷新后保留仍存在的资产选择。93 项前端测试通过，新增覆盖更新突发、取消后的迟到完成、失败后重试调度；Chrome 受控组件验证暂停后卡片/明细清空及快照刷新恢复。

本次不代表 B16 全量闭合：真实 Go API/浏览器跨模块重连验收、生产统计读取性能及其他必要功能仍待继续。


### 2026-09-07 B13 PostgreSQL → Go HTTP → 前端 SDK 联合校验

新增可选 TG_TEST_WEB_INTEGRATION=1 验证链路：现有隔离 PostgreSQL 夹具启动 loopback Go HTTP 服务，Node 使用前端生成 SDK 发起真实 fetch，再执行展示层 runtime validator。没有替换 fetch 响应或使用手写成功 JSON。验证 overview 两市场/一 STOCK、970000 的 6 位 Quote 核心量、10000 的 18 位内部兑换量，以及全局/单市场 holder 同一区块、供应量和余额均为 100。

移除 holder 历史的 receipt commitment 后，通过同一真实 HTTP/SDK 路径验证 503 类型错误；成功和失败响应均验证 no-store。完整 PostgreSQL TestPostgresMigrationAndReadiness race/count=1 通过（37.662 秒），三条前端链路均实际执行并输出 PASS。README 已记录 Node 22+ 前提、启用命令及未启用时的覆盖边界。

该验收证明数据库至前端校验器的真实 HTTP 契约，不等于完整浏览器/真实链 RPC/生产负载验收；小时序列的 24 小时真实响应与完整页面重连联合测试仍开放。B13、B16 未全部完成。


### 2026-09-07 B13 24 小时时间序列真实 HTTP 联合验收

将隔离数据库既有认证成交夹具设置为完整 [3600,90000) 时间窗口，Go 读取 24 个小时桶，再经真实 HTTP、前端生成 SDK 和 validateGlobalSeries 核对。首桶保留两种 Quote 分组：Curve 核心量 970000、费用 10000、税 20000；Pool 内部兑换 10000 和一个未知费用观察。其余 23 桶保留对应分组、零成交/零流量和空费用数组。夹具完成后恢复原时间，回归原有短窗口用例。

把窗口右侧覆盖块移到 89999 后，数据库读取拒绝，真实 HTTP/SDK 返回 503；不将最后一小时缺失解释成零成交。完整 PostgreSQL race/count=1 通过（39.113 秒），overview、series、series-unavailable、holders、unavailable 五条 Node 联合检查全部执行。Go integration vet 与差异检查通过。

更新顶部 B13/B16 状态表，去掉已完成的前端接线缺口。受控数据库时间夹具不是实际链负载或完整浏览器验收；剩余生产性能与页面联合验证保持开放。


### 2026-09-07 B12/B13 历史分析接口并发保护

为成交/K线/市场持有人/资产统计/global overview/global holders/global series 七类历史分析接口增加单实例共享四个执行名额；超额立即返回既有 503 analytics_unavailable、Retry-After: 5，不建立应用等待队列。GET 以外的方法保持原有 405 行为，健康探针与普通读取不经过该门控。原有 10 秒读取上下文及历史数据预算继续保留。

受控并发测试占满四个名额，验证七条路由均拒绝额外查询、livez 仍为 200；异常 panic 和取消后名额释放。Go httpapi/app race/vet、37 项 API 测试、生成产物同步、前端构建及差异检查通过。OpenAPI 2.19.1 记录共享限额与重试语义，复用原有错误枚举。

此变更限制单进程同时执行的昂贵请求，不解决全历史重建算法成本，也不保证数据库连接完全隔离或多副本全局限流。生产吞吐/内存压力测试仍是未完成项，未据此声明 B12/B13 生产就绪。


### 2026-09-07 B13 持有人聚合分配基准与优化

新增 BenchmarkGlobalHolderAggregation，覆盖 10/100/1000 市场及重叠/独立地址，最大 100 万条持仓关系。每次运行校验全局去重数与关系总数；计时和分配统计排除输入构造。Apple M2、Go 1.27、本地单次基准中，1000 市场/100 万独立地址基线为 728 ms、253946160 B/op、3021601 allocs/op；复用 uint256 解析 scratch 和分组地址表引用后为 658 ms、213955096 B/op、1022601 allocs/op。累计分配减少约 40 MB（15.7%），次数减少约 66%；单次时间数值不作为稳定吞吐结论。

解析仍使用原 canonical 十进制规则和 256 位范围检查，不降低金额验证；增加最大值/溢出/零/非法字符串之后再次使用 scratch 的回归。原全局去重和余额守恒测试继续通过。analytics race/vet、完整 PostgreSQL race/count=1（启用五条真实 HTTP→前端 SDK 校验）及差异检查通过。

这些数值仅为内存聚合累计分配，不包括数据库、回执重建、输入驻留或进程峰值。跨市场全历史读取与生产并发容量仍未验收，不能据此宣称 B13 已完成。README 已提供复现命令。


### 2026-09-07 B13 聚合阶段请求取消

全局持有人数据库读取将 HTTP 上下文继续传入内存聚合，避免 SQL 完成后仍忽略取消执行百万条去重。保留既有纯函数入口供离线复算；在线路径在市场边界、每 256 个余额/地址记录及排序前后检查取消。取消只返回错误和空结果，不返回部分市场/地址计数；排序仍为有界同步操作，不宣称严格墙钟超时。

新增确定性取消测试：进入前取消、单市场余额循环内取消、全局地址统计和分组地址统计阶段取消，并验证后续未取消请求仍完整返回 1024 个地址。analytics/httpapi race/vet 通过；真实 PostgreSQL holder HTTP→SDK 联合目标回归通过（跳过 analytics 重型子测试），差异检查通过。生产全历史性能和完整浏览器联合验收仍开放。


### 2026-09-07 B11 名称与生命周期全目录排序

核对当前市场页选项发现前端已有名称/阶段排序，但后端此前仅有 ID/创建时间排序。新增 /v1/markets sort=name_asc、launchPhase_asc：名称仅折叠 ASCII A-Z，之后按 UTF-8 字节顺序排列；阶段按 launchPhase 排列，不代表当前交易是否可用；两者均以 marketId 升序打破平局。名称排序需完整身份覆盖，否则 503。

排序键使用名称字节的十六进制和前缀安全分隔符，避免冒号、斜杠、NUL 或非 ASCII 名称扰乱游标。130 条全目录分页测试覆盖同名大小写、名称前缀、特殊字符及中文；名称/阶段排序全量顺序与独立比较器一致，切换排序拒绝旧游标。Go HTTP race/vet 及生成产物/前端构建通过，OpenAPI 2.20.0 与 SDK 新增枚举同步。

这一步完成后端能力，市场页仍需改接服务端查询，不能将现有浏览器局部排序标为 B11 全站排序已完成。大目录性能和自动快照生产也仍开放。


### 2026-09-07 B11 市场页服务端全目录查询接线

市场页搜索、STOCK 筛选、生命周期筛选以及创建时间/名称/阶段排序改为生成 SDK 的 /v1/markets 查询，绑定当前 finalized revision；移除浏览器对 foundation 已加载记录的局部筛选和排序。独立目录状态保存匹配结果及其游标，新增 Load next matching markets；原 foundation 下一页按钮只保留给 rewards。状态文案仅报告已加载匹配数量，不虚构全站总数。阶段按钮明确 phase，而非交易可用性筛选。

名称展示优先使用同一快照的 identity。查询切换取消在途请求、隔离迟到响应；分页验证 revision、重复市场、重复/空游标和页面大小，失败清除内部分页状态；快照失效和 pagehide 重置目录。缓存命中也取消其它在途查询，防止返回旧筛选时被迟到的新查询污染。

97 项前端测试、生成产物/类型检查、构建及差异检查通过。新增用例覆盖 100+30 条匹配记录、完整筛选参数转发、缓存与迟到结果、不同 revision、重复行/游标、查询失败后的无游标重试。完整浏览器真实 API 成功/重连路径与大目录性能仍待验收，B11 未标为全部完成。


### 2026-09-07 B11 完整市场页真实 Go 路由浏览器验证

移除市场目录每页逐 Token 的名称/Quote 元数据 RPC 调用；目录名称和 symbol 使用响应 identity，Quote 显示链上地址（native 为 ETH）。避免已认证身份仍因大量可选 RPC 延迟而阻塞搜索、排序和分页。交易页等其它用途的元数据读取不受此次变更影响。

新增可选、有 120 秒上限的 Go 浏览器测试服务 TestMarketDirectoryBrowserFixture，使用真实 HTTP router、CORS、全目录查询和游标，但数据为 130 条合成快照，不代表链上实际部署。首次夹具 revision 与 blockNumber/hash 不一致，被正式前端拒绝；修正夹具后 Chrome 正式 markets.html 显示 100 条，加载下一页得到全部 130 条。搜索 Market 127 返回原目录第 128 条；名称排序与 Pool phase 联合查询返回 65 条，开头为 Market 001、003。

本轮已实际验证完整页面成功链路；尚不包含数据库 publication、真实 RPC、重连/重组和大目录负载验收。移动端仅捕获截图，未据此声明完整排版验收通过。临时 viewport 已恢复、tab/Vite/Go 夹具均已关闭。97 项前端测试和构建通过，Go HTTP race/vet 及差异检查通过。


### 2026-09-07 B11/B16 市场页服务失效清理与同 revision 恢复

在真实 Go router 合成快照夹具中加入原子 unavailable/recover 故障切换。Chrome 正式 markets.html 实测发现：更新接口返回失败后虽显示 Reconnecting，旧 100 张卡片和加载下一页按钮仍可见。修复快照失效的 DOM 清理：取消目录请求、清除卡片/旧数量、隐藏分页、显示等待可信目录提示；pagehide 和隐藏页面同样清理该目录。

修复后再次实际切换服务：失效时 0 张卡片、无分页按钮；恢复时无需刷新浏览器，即使 revision 仍相同，也自动回到 100 条结果及可用分页按钮。两次夹具达到其 120 秒上限后以 timeout 退出（不是测试断言全部通过的声明）；上述浏览器状态在服务仍运行时读取并确认。浏览器 tab/Vite 已关闭，夹具自动清理 URL 文件。

97 项前端测试、构建、Go HTTP race/vet 与差异检查通过。本轮覆盖受控路由服务故障恢复，不代替真实数据库 publication、链重组、钱包/交易/奖励页联合验收或大目录性能验收。


### 2026-09-07 B11 全目录分页内存优化

基准确认通用 paginate 在每次排序比较时反复构造名称/时间 key，并复制大型记录数组。改为每条记录计算一次 key、排序紧凑索引，再二分定位游标和提取当前页；无筛选的 queryMarkets 直接复用输入只读切片，避免再增长复制完整目录。输入顺序不变，游标版本/内容及错误契约不变。

新增 BenchmarkMarketSortedPage（1000/10000/50000 条），测量 queryMarkets+paginate；新增 key 调用次数、输入不变、连续分页/尾页和空数组测试。Go HTTP race/vet 和差异检查通过，既有配置/仓位/市场分页及 golden 测试继续通过。

Apple M2 本地单次 5 万条无筛选排序基准：名称排序由 176 ms / 292013920 B/op 降到 14.1 ms / 6118944 B/op；创建时间排序由 238 ms / 374573336 B/op 降到 14.9 ms / 8119000 B/op。该结果为合成输入的内存排序分配，不含数据库快照读取、JSON 解码、HTTP、输入驻留；没有扩大生产快照预算，不代表端到端支持 5 万市场的吞吐验收。数据库索引/负载及实际 publication 路径仍开放。


### 2026-09-07 当前后端全量回归核对

当前工作树执行 go test -race ./... 与 go vet ./...：29 个有测试包通过，25 个包无测试文件。普通命令中的 opt-in 数据库/部署验收不可据此算完成；另以 TG_TEST_DATABASE_URL 和 TG_TEST_WEB_INTEGRATION=1 显式执行完整 TestPostgresMigrationAndReadiness，最终通过，耗时 120.522 秒，包含当前五条真实 HTTP→SDK 校验。检查过程中确认测试进程仍活跃，没有因耗时重启同一任务。

38 项 API 测试和 97 项前端测试通过，生成产物和类型检查随脚本执行。最近数据库完整回归约 36–39 秒，本轮约 120.5 秒；未归因到具体代码或数据库瓶颈，也不据此推算生产吞吐。生产负载、运行稳定性及慢查询定位仍开放。

顶部 B11/B12/B16 更新为当前已有证据，移除已实现的 HTTP/SDK/组件接线缺口，保留真实部署/数据库 publication、链重组和跨页面验收。下一项尚缺实质实现的首版功能包括 B15 交易状态与用户活动 API；原始回执保留不等于这些接口已完成。整体 B01–B19 目标保持未完成。


### 2026-09-07 B15 交易状态判定内核

新增 internal/transactions，将经调用方认证的 head/finalized、canonical/orphan receipt 和显式 pending 观察转为只读状态。receipt 缺失不推断 pending；执行 succeeded/reverted 与 confirmed/finalized 独立，回滚的交易也可以已最终确认。无主链回执但保留孤块回执时为 reorged；显式重新进入待打包时为 pending；重新入块后恢复确认状态并保留孤块历史。

校验网络/哈希、finalized 不超过 head、边界高度/hash 一致、同交易回执身份与日志、唯一主链回执、重复孤块、pending 与已入主链冲突；确认数按 head-height+1 计算为整数字符串。孤块历史排序确定，错误不返回部分状态。三组测试覆盖全部状态、最终确认但 reverted、重组/重入块、非法观察和历史顺序，race/vet 与差异检查通过。

此内核不自行认证链/创世块、观察新鲜度、祖先链或历史完整性；这些必须由下一步数据库/RPC reader 提供。尚无公共交易状态 endpoint，用户活动索引也未实现；B15 保持未完成。


### 2026-09-07 B15 交易状态持久读取

新增 transactions.Store.Load，以 repeatable-read 读取固定网络/创世块的 journal，要求最近 120 秒观察、head/finalized 完整、索引起点至 tip 的连续 canonical 父链及 receipt verification。目标交易最多 128 个历史区块；逐区块读取完整回执集，核对列与 JSON、连续交易索引、交易/区块身份及持久 receipt_count/receipt_set_hash，累计回执预算 64 MiB，单块 16384 回执。

结果明确 source=indexed_journal、indexedFrom、observedAt、pendingLookup=not_performed；确认数相对索引 tip，不冒充 live RPC head。未找到交易只表示本索引未观察到，不能证明不在 mempool。RPC pending 观察与公开 API 尚未接线。

真实隔离 PostgreSQL 目标测试覆盖 confirmed→finalized、孤块 reorged、重新入块且 reverted、unknown、创世块错配、过期 journal、断裂父链、回执列/JSON 改动及摘要冲突拒绝。最终使用 journal|transactions 子测试选择器（保留共享夹具前置 journal）通过，4.421 秒；首次仅选择 transactions 因缺少共享 journal 前置数据失败，未算作通过。transactions race、transactions/integration vet 及差异检查通过。

该检查依赖本地持久回执摘要与单源观察，不是 Ethereum receipts root 证明。没有新数据库迁移或生产写入，B15 的 RPC、HTTP/SDK、用户活动接口和真实部署验收继续开放。


### 2026-09-07 B15 RPC 交易查找适配器

chainrpc 新增 TransactionByHash，使用 eth_getTransactionByHash。只有显式 JSON null 表示节点未找到；缺少 result、传输或 RPC 错误保持错误。非空结果要求请求 hash 匹配、from/to 地址与 nonce 格式有效，blockHash/blockNumber/transactionIndex 三个字段必须实际存在且同为空或同为合法入块信息；不能把缺字段当 pending。合同创建的 to=null 单独允许。

适配器返回提供方观察，不宣称签名验证、主链入块或最终性；调用方仍须绑定网络/创世块并核验 receipt/block。测试覆盖 pending、included、创建交易、哈希错配、缺字段、混合入块字段、非法地址/nonce，以及 null 和 RPC 错误区分；chainrpc/transactions race/vet 与差异检查通过。

下一步仍需将数据库已索引状态与固定网络的 RPC 观察协调，处理两次读取间的入块/重组竞态，再公开 HTTP/SDK。当前 journal reader 的 pendingLookup=not_performed 尚未改变，B15 未完成。


### 2026-09-07 B15 索引与 RPC 协调读取

新增 transactions.Service：读取 journal 后核对 RPC chainId/创世块、live head/finalized、finalized 高度对应 canonical hash、索引 tip 对应 canonical hash，再交叉检查 transaction lookup 与 receipt。已入块交易核对其高度的 canonical header；索引现有主链回执与 RPC 不一致、pending 与 receipt 冲突、RPC 引用索引孤块均失败。

使用 live RPC head 计算确认数，单独返回 journalHeadNumber/hash、journalObservedAt 和 rpcObservedAt。索引尚未追上但 RPC 已验证入块时允许 confirmed；孤块历史保留。读取结尾再次核对同一 RPC head 及不变 journal 状态，10 秒上下文内发生冲突/切换不拼接结果，而返回 unavailable 供重查。该方式仍依赖提供方一致性，不构成跨系统原子快照或独立共识证明。

测试覆盖 unknown/pending、超出索引 tip 的入块、错误网络/创世块、RPC head 变化、journal 变化、lookup 错误、pending/receipt 冲突、非 canonical block、索引回执缺失或执行结果冲突、重组后 pending 的历史保留。transactions/chainrpc race/vet 及差异检查通过；公共 HTTP/SDK 和真实 RPC 联合验收仍未接线，B15 保持开放。


### 2026-09-07 B15 交易状态 HTTP/SDK 与启动接线

新增 GET /v1/transactions/{txHash} 和 SDK getTransactionStatus，OpenAPI 2.21.0 共 16 个 GET 路径，Go/TypeScript/前端生成产物同步。返回 displayOnly、执行/确认状态、RPC head/finalized、索引 tip/观察时间及孤块历史；未知状态不意味着未提交。严格小写 hash、禁止查询参数，10 秒上下文、no-store，响应 schema 不一致或读取失败 503。

API 通过 TG_TRANSACTION_STATUS_MANIFEST 独立启用，要求数据库和 RPC URL，部署清单 chainId/genesis 与配置绑定；未启用时路由 503。纳入八条历史/交易读取共享四个并发名额，超额沿用 analytics_unavailable + Retry-After: 5。

HTTP 用例覆盖成功、非法参数未调用服务、错误隐藏、坏响应 schema、未配置与 POST；配置用例验证缺数据库时拒绝启动；共享并发测试涵盖新路由。Go httpapi/app/transactions race/vet、39 项 API 测试、前端构建、生成对照及差异检查通过。首次 API 路径列表测试因预期字典顺序错误失败，修正后全部通过。

现有真实 PostgreSQL store 与 RPC 适配器测试分别已通过，但新 endpoint 尚未完成数据库+RPC+HTTP/SDK 一体化真实传输验收；用户活动索引与接口也仍未实现，B15 保持未完成。


### 2026-09-07 B15 数据库/RPC/API/SDK 一体化联调

扩展真实隔离 PostgreSQL 交易夹具：RPC HTTP 服务提供固定网络/header/transaction 响应，receipt 来自实际持久表；协调服务使用正式 chainrpc HTTP 客户端、transactions.Store 和 httpapi router。Go 通过 HTTP 校验响应 schema，Node 生成 SDK 再通过 HTTP 校验状态字段。

成功路径确认同一交易已重新进入当前主链、execution=reverted、confirmed=1 个确认，并保留一个孤块回执；来源为 indexed_journal_and_rpc，displayOnly=true。将第二次 latest header 改为另一 hash，真实 API 与 SDK 均返回 503，不拼接不稳定观察。

启用 TG_TEST_WEB_INTEGRATION=1 的 journal|transactions 目标数据库回归通过（Go 总输出 8.180 秒），包括 transaction 和 transaction-unavailable 两条 Node 检查；integration vet 与差异检查通过。此处 RPC 是受控 HTTP 提供方，不是外部实链或真实部署验收。B15 用户活动索引、前端交易状态接线和生产运行仍开放。


### 2026-09-07 待确认交易的后端观察展示

钱包恢复栏新增手动“Query backend status”：通过生成 SDK 查询 Go 交易状态 API，校验 chain/hash、确认数、最终性边界、孤块回执与来源后显示五类状态，执行 reverted 与 confirmed/finalized 分开表达。unknown 明确不等于 dropped，观察时间可见。此展示不清除 executor pending、不提交交易，钱包回执恢复按钮仍负责确认结果。

请求使用 no-store、10 秒超时；重绘、钱包断开/账户或链切换、pagehide 取消请求并清空显示。失败替换先前结果，停止后的迟到响应不更新。新增状态及组件生命周期测试；真实 PostgreSQL + 受控 RPC + Go HTTP + SDK 的交易场景也接入该前端校验器，目标 race 集成通过（5.506 秒）。前端 107 项测试、类型检查、生成文件对照、生产构建与 git diff --check 通过；构建仍提示应用主包超过 500 kB。

只覆盖待确认交易恢复栏的手动观察，没有完成全部交易历史页或真实钱包/外部 RPC 重组验收；首发 B11/B12/B13/B14/B16 必需范围不变。


### 2026-09-07 B15 用户活动事件归属内核

新增 internal/useractivity：从静态 ABI 事件提取地址角色，覆盖金库存取、分配/退出/结算、Curve/Pool 调用者和收款人、转账/授权、奖励与 Treasury 等业务事件。合约/代币配置地址不自动计入用户活动；零地址不是用户；相同地址在同一事件内合并角色，按地址排序。记录包含完整事件签名、参数和区块/交易/log 来源，ID 包含 blockHash，重组分支不会覆盖为同一条事件。

FromEvent 要求日志与成功回执逐字段一致。生产提取入口 FromVerifiedReceipt 使用 deployment.Verified 绑定的链/区块/运行时代码身份，按整份回执线性处理；未知 emitter 不归属，已绑定事件解码失败整体报错，取消请求不返回部分结果。所有角色均标记为 event_address_reference_not_verified_initiator，不将 router/PoolManager caller 推断为最终钱包，也不将活动事件条数或金额作为成交量。

验证覆盖当前 catalog 全部选定地址字段、self-transfer、mint/burn、buyer/recipient 分离、成功回执一致性、真实 Verify 入口的链/区块/合约约束、迟发解码错误不泄漏部分记录、取消与分支标识/输出隔离。useractivity、deployment、events、projection race 测试和 useractivity vet 通过。

本阶段未新增迁移或 HTTP 路由。活动持久索引、旧数据补齐、规范链/完整历史覆盖校验、分页 API 与完整交易历史页仍未完成；尚不能对外宣称用户历史接口可用。


### 2026-09-07 B15 活动索引持久化

迁移 66 新增 user_activity_blocks 和 user_activity_records，记录部署清单摘要、提取器版本、回执集合摘要、活动数与活动摘要；地址历史索引按 block/transaction/log 排序。IndexBlock 验证完整且有序的持久回执集合，要求规范 finalized 区块与 deployment.Verified 身份绑定，设置数量/字节预算后在调用方事务内批量写入。重复执行原子替换同一分支批次；删除源区块级联清理批次/记录。

投影器在保存事件后、提交区块之前调用 IndexBlock，后续业务观察失败会一并回滚。Verified.CheckScope 补齐空回执/空批次的身份检查，避免只依赖逐 log 验证。已有投影历史不在迁移中伪造批次；旧区块补齐和读取覆盖门槛仍待专门实现。

真实隔离 PostgreSQL 定向验证通过（4.507 秒）：57→66 升级、重复运行、回滚、活动字段、回执篡改拒绝、孤块拒绝、新旧分支并存与删除级联。Go 全量 race/vet 通过。完整本地链烟测另行记录最终结果，不以单函数数据库测试替代投影 worker 验收。


本轮最终本地链联合验证：PATH 包含 Foundry 后，完整 smoke-chain 退出 0，覆盖临时 PostgreSQL、66 项迁移、Anvil 日志到投影 worker、费用领取的两条 beneficiary 活动记录、后续空块稳定性、观察失败时活动表一起回滚、重启重放、发布与 API/进程关闭。此烟测使用合成 getter/事件与本地链，不替代真实部署验收。

过程中两次缺 Foundry 可执行文件（先 Anvil、再嵌套 Forge），已修正 README 命令；随后三轮在 conversion 后空块追赶出现 RPC transport failed，Anvil 存活且未触发投影总超时，根因未定。新增安全的传输错误分类（不带 URL/凭据）、子进程 stderr 和 Anvil 故障日志；最后一次完整复跑通过，并非宣称已证明或修复此前间歇性故障。活动历史补齐、覆盖验证、分页读取与生产负载仍开放。


最后一轮 Go 全量回归曾遇到 docs/v1/V1_PROTOCOL_PARAMETERS.md 来源哈希不匹配；随后复核时目录已与当前工作区一致（events/modules 均未变化、changed sources 为空），生成器 --check 通过。未回退协议文档；这是验证期间工作区来源发生变化的迹象，最终测试需以再次执行结果为准。


验证期间事件目录又由 77 扩展至 79（CreatorRevenueBeneficiaryProposed / CreatorRevenueBeneficiaryTransferCancelled），导致旧数量断言失败。再次检查时工作区中的两个断言及 golden fixture 已同步到 79；本轮没有回退这些并行改动。新增的提议/取消事件没有直接领取或资金转账语义，当前活动角色清单不会将其推断为资金活动。


最终当前工作区的 go test -race ./...、go vet ./...、generate_events.py --check 和 git diff --check 均退出 0（79 事件目录）。本地链完整烟测通过发生在本轮并行协议目录同步之前；其活动持久化/原子回滚检查已通过，不据此扩大为新增协议功能的链上验收。


### 2026-09-07 B15 活动完整性读取与分页 API

新增 useractivity.Store.Load：同一 repeatable-read 内验证网络/创世块、journal 新鲜度、从配置起点到 finalized 的连续主链、全部活动批次的 manifest/version/receipt commitment，重新核对回执内容、活动来源日志/角色/参数与批次摘要。任一地址的记录缺失或篡改都会阻止返回“空历史”。分页按 block/transaction/log 倒序，cursor 绑定地址和整个历史 revision；新增 finalized 空块也改变 revision。

新增 GET /v1/users/{address}/activity，limit 默认 50、最大 100；非法 cursor 400、历史变化 409、不可用或不完整 503。HTTP 校验输出 schema 和账户归属，加入九条历史/交易路由共享四个并发名额。通过 TG_USER_ACTIVITY_MANIFEST 与 TG_USER_ACTIVITY_START_BLOCK 可选启用，规范化清单摘要与投影器一致，缺数据库拒绝启动。OpenAPI 2.22.0，17 个 GET 接口，生成客户端新增 listUserActivity，前端同步生成。

真实隔离 PostgreSQL + 正式 HTTP + Node SDK 验证三条事件的逐页顺序、地址隔离、缺失空块批次、409 历史变化、活动/回执篡改、版本和 manifest 失配；HTTP 单元测试覆盖参数、错误隐藏、输出账户/链与 displayOnly 检查，39 项 API 测试和前端构建通过。API 首次测试仅因版本预期尚为 2.21.0 失败，更新为本轮 2.22.0 后通过。

当前读取有明确全范围预算，不能当作生产规模历史索引的负载验收；旧历史补齐、前端完整活动页、真实部署与重组验收仍开放。迁移数保持 66。


补充边界用例后，启用 TG_TEST_WEB_INTEGRATION=1 的 journal|useractivity_read 数据库 race 回归再次通过（33.798 秒），包括非法游标、过期 journal、孤块区间与另一地址活动遗漏拒绝。相关 Go race/vet、API 二进制构建、生成契约检查和 git diff --check 通过；没有执行本轮生产部署或声称完成生产负载验收。


### 2026-09-07 B15 Rewards 活动页接线与验证

Rewards 新增 Activity 标签，可通过 rewards.html#activity 打开；使用 Go 活动 API 的生成客户端，展示 finalized 活动、事件角色、交易哈希和原始参数，支持刷新及分页。明确角色只表示事件引用地址，金额保留合约原始单位。前端校验账户/链、记录标识、来源区块、倒序、角色参数和分页 revision；409 或读取失败清空旧列表。钱包切换、断开、标签切换和页面隐藏会取消请求并隔离迟到结果。当前活动页采用手动刷新，不据此宣称 B16 自动更新整体完成。

真实隔离 PostgreSQL → Go HTTP → Node SDK → 前端校验器的 journal|useractivity_read race 验证通过（7.020 秒）。浏览器验证正式 Rewards 的 #activity 入口与未连接状态；合成组件夹具验证分页 409 清空、钱包地址切换与断开，390px 宽度下地址和交易哈希换行。此夹具不等同于真实钱包提供方或完整部署联合验收。

前端测试、生成产物检查、类型检查与生产构建通过；构建保留既有大于 500 kB 的 chunk 提示。旧活动历史补齐、生产规模读取性能和真实部署/钱包/重组验收仍待完成；B11/B12/B13/B14/B16 的首版必要范围保持不变。


### 2026-09-07 B15 活动历史补齐任务

projection-worker 新增 --backfill-activity-once / --backfill-activity-run，Makefile 提供 activity-backfill-once / activity-backfill-run。沿用链事务锁与历史部署验证流程，每步检查完整 discovery 区间，选取最早缺失或 manifest/extractor/receipt 摘要过时的批次，核对历史核心绑定与动态 emitter、完整回执后提交活动记录。不会初始化、推进或重放业务 projection checkpoint、事件事实或业务观察。连续模式在当前 discovery 范围无待补批次时退出，锁忙或来源未就绪时等待，可中断恢复。

历史资产候选改从目标高度及以前的 Registry 注册事件取得，并在目标 blockHash 重新核验；避免当前覆盖写的配置行将后注册资产带入旧区块。补齐选择检查缺块、缺 discovery 批次、父哈希连续性与创世块边界。每步最多扫描 100 万区块，最多 1 万资产候选，单步仍有命令超时；生产长期历史吞吐尚未验收。idle 只代表当前范围批次元数据匹配，不能替代 API 的内容/摘要完整性校验；内容损坏但批次元数据未变化不会由该命令自动识别修复。

真实隔离 PostgreSQL 全套集成测试通过（37.294 秒）：非空活动、逐块补齐与恢复、旧版本修复、历史代码失配拒绝、链锁互斥、复制记录失败后的批次回滚、缺源/缺 discovery/父哈希错误拒绝，以及既有匹配批次和业务游标不变。首轮烟测拾取了仍在编辑的新夹具，因外键插入顺序错误失败；修正为先区块、再 discovery checkpoint、最后批次后通过上述回归。补充了后注册配置不得影响旧块的用例，最终本地链验证另记。


第二轮完整烟测通过数据库回归（14.790 秒）和新增本地链补齐断言后，在费用领取的后续空块追赶中再次遇到 RPC 传输错误，诊断为 syscall errno 49（本机 EADDRNOTAVAIL）。新增受控 HTTP 并发波次测试，证实默认连接池在八轮四路读取中创建 18 条连接；RPC 改为共享独立 Transport，保留每主机 8 条空闲连接，同一测试只创建并复用 4 条连接。chainrpc 完整 race 测试通过（2.214 秒）。这验证并修复了连接反复创建问题，不能仅凭错误码证明此前所有间歇性故障都由它导致；最终完整烟测另记。


最终验证：修正连接池后完整 smoke-chain 退出 0，覆盖新增旧活动批次删除/重建且业务游标不变、本地链 journal/discovery/projection、费用领取、奖励转换、重启、空块追赶、发布与进程关闭；其数据库回归为 18.951 秒。补充“补齐后进入 useractivity.Store.Load 全范围完整性读取并返回原始金额 7”的集成回归通过（79.817 秒）。当前 Go 全量 race/vet、二进制构建和 git diff --check 均通过。迁移仍为 66 项，没有生产部署或生产交易。真实历史部署、完整钱包/重组联调和生产负载仍为未完成项。


### 2026-09-07 B16 活动历史自动刷新与恢复

活动 revision 独立于发布快照，Rewards Activity 采用完成一次请求后等待 30 秒的轮询，仅在标签可见、页面可见、网络在线且钱包已连接时运行。相同 revision 核对首屏完整内容（忽略 observedAt 和 JSON 键顺序），保留已加载分页和展开的事件详情；revision 变化替换为新第一页。内容在同 revision 下变化也会拒绝。刷新与分页不重叠，钱包/标签/页面切换或 offline 会取消旧请求；online 恢复并合并在途刷新。

失败清空旧记录，按 60/120 秒退避，成功恢复 30 秒；10 秒请求期限使用独立 abort race，底层请求迟迟不结束也会释放刷新流程，迟到结果不会覆盖新数据。定时器可注入以确定性测试轮询、分页保留、版本变化、退避恢复、暂停恢复、超时和迟到隔离。117 项前端测试、生成产物/类型检查与生产构建通过；仍有既有大 chunk 提示。完整钱包提供方、真实 publication/链重组和生产负载联合验收仍待完成，B16 不整体关闭。


浏览器合成活动夹具验证：切换服务端历史后，不点击刷新按钮，默认轮询将范围从 1–3 更新至 1–4；切换为 503 后自动清空两张旧卡片；恢复 API 后可立即重读相同版本，断开钱包后显示连接提示并禁用刷新。此验证覆盖真实组件/浏览器定时器和受控响应，不冒充真实钱包、Go 发布或链重组的联合验收。git diff --check 通过；本轮未修改后端协议或执行链上交易。


### 2026-09-07 B14 展示价格请求期限与 Go HTTP 浏览器联调

修复展示组件在底层请求忽略取消时仍接受超时迟到响应的问题：8 秒期限现在通过独立 abort race 结束等待，下一轮刷新可继续；目标代次检查继续阻止旧资产覆盖新资产。请求显式 no-store，stop 清掉缓存价格并立即显示 unavailable。回归测试使用受控计时器，覆盖超时释放、下一轮成功、迟到旧值拒绝和停止后清价。

新增 opt-in TestDisplayPriceBrowserFixture 与 tests/browser/display-prices.html，使用正式 Go HTTP 路由和生成客户端、受控 Reference 来源。真实浏览器验证 available 显示 $26.68125–$26.68375 per AAPL token（multiplier 0.125 不重复乘算）、来源和时刻；stale 与 503 隐藏价格；恢复后重新显示；清除选择后不可用。夹具受 180 秒期限约束并显式关闭，测试通过（80.927 秒）。这不是实时提供方价格，也不替代正式 Create/Trade 页、钱包和部署联调。

118 项前端测试、生成产物检查、类型检查及生产构建通过；Go 价格 HTTP race 测试通过（2.574 秒）。本轮无后端生产行为/数据库迁移改动、无生产部署。B14 和完整开发目标仍保留生产来源/运行及整页联合验收待办。


### 2026-09-07 B14/B16 正式创建页 Quote 身份失效与价格联调

发现并修复页面级价格残留：invalidateSnapshotReads 清空价格目标，初始/手动 foundation 加载失败也调用统一失效；loadTradeMarket 在解析市场 ID 或检查前置条件之前清掉旧 market/metadata/quote/参考价并刷新按钮状态，避免无效输入提前返回仍保留旧交易报价。

扩展 Go 价格浏览器夹具的 TG_TEST_PRICE_FULL_PAGE=1 模式：从当前 release catalog 提取 AAPL 标识/精度/原始经济参数，提供合成已启用 Quote 配置和独立可故障的快照 Reader。正式 create.html 经正常 Foundation、Quote picker、生成客户端和 Go 路由加载，选择 AAPL 显示有效价格；保持价格接口正常但令快照接口失败后清价；恢复同 revision 后重新显示；切换至待激活 ETH 后清价。测试时钱包未连接、合约地址配置为空，Launch token 全程禁用；合成启用配置不代表生产注册表已启用。

118 项前端测试、类型/生成产物检查与生产构建通过。首轮完成浏览器状态检查后，夹具因 180 秒期限先于手动关闭而退出失败，已另行重跑确认正常关闭。正式交易页成功路径、真实部署/提供方/钱包与生产负载验收继续开放。


### 2026-09-07 B14/B16 正式交易页价格与完整目标失效

扩展 TG_TEST_PRICE_FULL_PAGE=trade：Go 返回受控市场和匹配 Quote 配置，目录中的 NVDA/AAPL 地址仅用于前端现有 RPC name/symbol/decimals 读取；市场本身是合成记录，不是真实可交易部署。正式 trade.html 成功通过 Foundation、getMarket、元数据、价格 SDK 路径，显示 AAPL 参考价并保持提交按钮禁用。

浏览器检查发现无效市场输入虽然清价和禁用提交，旧名称/路由/质押链接仍残留。新增 clearTradeMarketState，统一清除市场对象、元数据、报价、参考价、K 线/持有人/成交组件、摘要和市场专属链接。在新目标加载前、详情失败、快照失效和 health 读取失败时调用；恢复按输入框市场 ID 重新加载。无效 ID、快照失败后的全量清理及同 revision 恢复均纳入正式页面验证。

118 项前端测试和生产构建通过；期间 ABI 生成检查发现工作区来源已更新，重新生成桥接文件后通过。价格 HTTP race/vet 通过（3.221 秒）。首轮夹具在修改/复测期间触发原 180 秒期限，故将整页模式限定为 10 分钟，组件模式仍为 180 秒，并重跑后显式关闭。有效价格是受控来源；完整真实部署交易、历史组件成功路径、链重组与生产价格/负载验收仍开放。


### 2026-09-07 B11 快照身份批量读取与一致性

原 verifyIdentities 对目录中每个市场执行一次 LoadAt。新增 marketidentity.LoadManyAt，在单条 SQL 中取得请求集合，逐项复用原摘要/字段/创建时刻/代码哈希/UTF-8 校验，拒绝重复 ID、缺失成员、重复规范身份、来源 Token 不一致和取消，不返回部分结果。请求上限 5 万身份、读取原始数据 64 MiB、整批 5 秒期限。EnrichIdentities、Publish 和 Load 均接入批量路径。快照 Load 改为只读 repeatable-read，快照字节、主链状态与身份核验共享同一事务视图；不会缓存失效的身份。

真实隔离 PostgreSQL 创建 1,000 个身份并逐项对照旧 LoadAt：查询次数由 1,000 降为 1，结果一致；混合缺失成员、末项 Token 失配、取消、未知 anchor、创建晚于 snapshot、错误 discovery manifest 和孤块全部拒绝。集成测试事务回滚这些容量行，不改变持久业务数据或迁移。

初版仍重复连接嵌套 canonical views，两轮耗时分别约 127/434 ms 与 499/318 ms（批量/单条合计），不能据第一次结果认定延迟稳定改善。随后展开等价主链/discovery/checkpoint/回执谓词，消除重复视图连接；最终本机 race 模式为 87.187 ms / 310.202 ms，定向集成回归 4.763 秒通过。原有整套集成也已通过（47.937 秒），最终 Go 回归另记。以上是受控局部容量证据，不是生产 SLA；完整快照仍有 16 MiB 限制，数据库目录搜索索引、完整 HTTP 负载及自动发布/真实历史验收继续开放。


最终当前工作区 go test -race ./...、go vet ./...、go build ./cmd/... 和 git diff --check 均通过。没有新增迁移、生产数据库改写或链上交易；B11 及完整开发目标继续保留尚未完成的端到端/生产验收。


### 2026-09-07 B11 完整目录 HTTP 容量与字节校验缓存

新增 opt-in TestDirectoryHTTPCapacity：独立创建/迁移并删除测试数据库，保存完整合成回执、来源日志、发现记录和身份，经 EnrichIdentities 与 Publish 实际写入 1,000 市场、1,828,358 字节快照；通过真实 HTTP 遍历十页名称排序（无重复/遗漏）、全目录大小写搜索、八路并发阶段筛选，并验证来源 manifest 失效导致旧 revision 拒绝、最新响应 sync=unavailable，以及恢复后同 revision 可读。首轮夹具被跨字段校验拒绝，因为 Pool 阶段仍配置 Curve 路由；已补齐匹配的 PoolKey/路由状态后通过，没有放宽校验。

优化前本机 race 模式十页中位 990.446 ms、最大 1.221 秒（整个容量测试 22.605 秒）。发现同一快照每次重复完整 JSON 唯一键、Schema 和跨字段验证，新增 Store 内最多 32 项 chain+SHA256 的校验记录，只缓存“这些字节曾通过验证”；每次仍重新计算/核对持久摘要、重新解码成独立 maps/slices，并在数据库事务中核对 journal、主链和批量身份。新字节、不同链不能复用校验，不缓存任何链状态或已解码对象。

新增缓存测试覆盖新无效字节、摘要失配、跨链拒绝、修改返回对象不影响下一次结果、并发对象隔离和 FIFO 上限。优化后同夹具十页中位 317.278 ms、最大 1.206 秒（冷校验仍保留），容量测试 11.910 秒通过，八并发、失效和恢复检查不变。该结果是本机受控容量证据，不是生产 SLA；仍需数据库目录查询索引、更大目录与长期压力、自动快照生产和真实部署验收。无新迁移。

最终验证：go test -race ./...、go vet ./...、go build ./cmd/... 全部通过；独立 PostgreSQL TestPostgresMigrationAndReadiness race 回归通过（63.860 秒）。B11 本轮容量与缓存开发完成，真实部署与生产负载验收仍未完成。

### 2026-09-07 B11/B16 完整快照请求并发准入

目录与更新请求此前没有共享准入限制，完整快照解码、排序、比较和序列化可能同时保留大量对象。现在每个 API 实例的 /health、/readyz、/v1/updates 及快照读取路由共享 8 个名额，持有到响应处理结束；超额不排队，返回 503 snapshot_unavailable、Retry-After: 5 和 Cache-Control: no-store。更新请求可能同时保留两个快照，因此这是请求数量保护，不是精确内存上限。/livez 与既有独立 analytics 准入不受影响，非 GET 仍走原方法检查。

路由测试以阻塞 Reader 实际填满名额，验证跨路由拒绝、探针存活、POST 405 和释放后重新进入；另覆盖 panic/cancellation 后名额释放。go test -race ./...、go vet ./...、go build ./cmd/... 通过。真实隔离 PostgreSQL 的 1,000 市场完整 HTTP 容量测试仍通过（19.325 秒），包括八路并发、失效和恢复；与全量编译/测试并行时分页中位 732.905 ms、最大 2.483 秒，说明本机延迟受竞争影响，不能把上一轮数值作为 SLA。生产负载、自动 publication 和真实部署验收继续开放。

### 2026-09-07 B03/B11 自动目录输入的逐块完整观察

确认事件触发 ObserveBusinessBlock 不保证安静区块含全部市场/曲线读数。新增 ObserveDirectoryBlock，复用原完整身份、固定 hash、getter 解码与末次主链校验，但将全部发现市场/Curve 加入读取集合；最多 1,000 市场，超限在 RPC 前拒绝。projection-worker 已接入，版本升级 v23-directory-observations，烟测版本断言同步。旧检查点拒绝混用，必须受控重建派生数据，未自动改写任何已有数据库。

新增无日志市场仍生成 market/curve、缺少 getter 丢弃整批以及超限无需 RPC 的测试。Go race 全量、vet、命令构建通过。RPC 成本增加且仍需容量验收；尚未实现全快照组装和独立财务对账，因此不会自动发布。

最终验证：PostgreSQL 完整 race 集成回归 65.385 秒通过；完整 Anvil+PostgreSQL smoke-chain 通过，覆盖投影批次回滚、重启回放、发现、收益读取及 publisher/API。首次烟测缺少 FORGE 显式路径，补齐后发现旧合成 Curve 缺少完整 getter；补齐受控 getter 并增加观察数量断言后重跑全链路通过，没有放宽生产校验。Python 夹具编译与 git diff --check 通过。

### 2026-09-07 B03/B11 路由执行器字段来源

组装字段审查发现 Read API CanonicalRoute 必需 graduationExecutor，但观察 route ABI 不包含它。ObserveMarketRoute 现在另从相同固定区块的 MarketRegistryV1.graduationExecutor() 读取并严格解码非零地址，确认代码非空，将地址写入 canonicalRoute、哈希写入 routeRuntime。保留最后主链重查与整批失败，不从前端环境变量补默认值。版本升级 v24-route-executor，旧检查点继续要求显式重建。

新增成功字段/哈希、缺失 getter、零地址、脏 padding、空代码测试；合成 Anvil Registry 夹具补 getter，并检查持久化哈希与该历史区块代码一致。执行器代码是观察证据，不代表编译实现或权限完整核验。快照组装、独立对账及自动发布仍开放。

最终证据：go test -race ./...、go vet ./...、go build ./cmd/... 通过；显式 FORGE/ANVIL 的完整 smoke-chain 通过（其中 PostgreSQL 集成 62.590 秒），包含新执行器字段和历史代码哈希落库断言、投影回滚/恢复、API 与进程关闭。git diff --check 通过。没有生产数据库修改或生产广播。

### 2026-09-07 B03/B11 市场候选快照组装

新增 readmodel.BuildMarketCandidate，将一个区块的 market、curve、canonicalRoute、poolKey、routeRuntime 观察映射成 MarketReadModel。金额保持原始十进制字符串，版本/阶段/fee/tickSpacing 转换检查位宽；校验集合数量、重复键、链/来源高度及同高度区块哈希、市场与曲线/路由身份一致性，要求执行器等运行时哈希存在。Curve 阶段 API poolId/poolKey 为 null，Pool 阶段输出配对字段。最后通过现有 Snapshot Schema 和跨字段校验，任何错误返回零值而不是部分市场。

这是纯候选组装器，没有数据库读取或发布副作用；临时校验 envelope 不会被返回或保存，不能作为 finalized/已对账证据。调用方仍须验证持久批次和回执来源、完整集合及独立财务对账；Source 指向来源事件，不意味着所有区块末观察发生在该交易时刻。配置/仓位组装、持久批次读取与完整发布接线仍待完成。

测试覆盖 Curve/Pool 字段对照、大额整数精度、输出隔离、计数/重复/链/来源错误、缺失费用/执行器、Quote/路由矛盾、uint32 与 int24 溢出、异常对象类型及 PoolKey 错配。定向 race 通过，全量验证另记。

最终验证：go test -race ./...、go vet ./...、go build ./cmd/... 与 git diff --check 均通过。本轮仅增加纯组装函数和测试，不涉及迁移、数据库写入或广播；没有把候选组装器标记为自动发布完成。

### 2026-09-07 B03/B04 配置候选组装

新增 BuildConfigCandidate，支持 quote/baseline/template 三类持久观察结构的纯映射。Quote 的 stockQuoteBinding 四字段展开到 flat values；quoteDecimals、poolFee、tickSpacing 转为有界 JSON 整数，uint256 经济参数和 referenceChainId 保留规范十进制字符串。状态只接受观察层支持的 1/2/3，identityCurrent 与 componentCodeIdentityCurrent 为 false 时原样保留，不升级可用性。必须具备完整字段、批次数量/唯一键、链和来源高度/同高度 hash，最后执行 ConfigReadModel Schema 校验；不复制嵌套对象或忽略缺少的必需字段。

Quote、Baseline、Template 成功映射、逐字段删除、大额精度、输出隔离、负 tick spacing、uint/int 位宽溢出、异常对象、重复和来源错配均通过。全量 go test -race ./...、go vet ./...、go build ./cmd/... 通过；随后新增的 Baseline/Template 测试定向 race 通过（1.944 秒），git diff --check 通过。没有迁移或数据库写入。资产/Vault 配置仍需要连接本金观察，完整候选集合、数据库来源校验、独立对账及自动发布继续开放。

### 2026-09-07 B03/B04 资产配置候选与最小 allocation 来源

发现既有资产状态观察缺少 minimumAllocation。DiscoverAssets 已增加固定区块 Registry getter，按 uint256 解码并要求 >=414，失败不返回部分资产集合；投影版本升至 v25-asset-minimum，旧检查点拒绝继续混用，必须显式重建派生状态。无自动数据库重建。

BuildConfigCandidate 支持 asset 观察的 asset/fingerprint/vaultRuntimeCodeHash 嵌套结构，显式展平 API 标量；Token 精度要求 6–18，Token/Vault 非零且不同，最小值保持十进制字符串并复核下限，完整五项指纹与 Vault 哈希不可缺少。状态 2/3 原样保留，不把配置身份观察当作完整本金/偿付对账。

测试覆盖 getter 成功/缺失/低于下限，配置成功/缺字段/413/精度越界/地址冲突/指纹缺失。初次新增测试传参类型不匹配，改为 DiscoverAssets 要求的 map 集合后全量 race、vet、命令构建通过。质押路径 Anvil 烟测结果另记。仓位组装、持久批次来源核验、独立对账和自动 publication 仍开放。

最终 smoke-gauge（显式 FORGE/ANVIL、启用质押）完整通过，覆盖资产/Vault 发现、投影持久化与回滚、收益、恢复及 API；git diff --check 通过。本轮仅操作隔离测试服务，没有生产广播或数据库变更。

### 2026-09-07 B03/B06 仓位候选组装

新增 BuildPositionCandidate，复用同块市场候选校验，连接 asset Vault 身份、vaultPosition、vaultAllocation 与 gaugePosition。校验用户/资产/市场/Gauge/Vault 一致性，重算 deposited=allocated+free、单市场 allocation 不超过账户 allocation、市场 allocation=Gauge stored active+pending；拒绝缺失金额、错误类型、非规范整数、来源链/高度/hash 错配及未完成 rage quit settlement。Free 为资产账户空闲余额，Allocated 为单市场 allocation，不混淆其他市场本金。

按实际合约 positionOf/activationSnapshot 语义：未处理 pending 保留 pendingGeneration 作为 activationAt；已处理尚未 materialize 的 pending 并入有效 active 并清空 activationAt。未处理快照 refs 可为 0，已处理且还有 pending 时必须非零。quoteClaimable/memeClaimable 使用同块 positionOf 的预览值，不表示交易一定可领取；无本金可保留预览奖励，unlockAt=0 映射 null。有本金要求非零 unlockAt。没有写入或发布副作用。

测试覆盖大额精度、两种激活状态、无本金/其他市场 allocation、输出不改输入、余额/本金矛盾、身份错误、缺失/零引用快照、缺失奖励、uint64 溢出、来源错误和未完成退出。最终全量 Go race、vet、构建通过；补充未处理 refs=0 用例后定向 race 通过（2.214 秒），git diff --check 通过。完整账户集合/持久批次来源读取、独立全局对账、退出特殊状态与自动 publication 继续开放，不能把单仓位候选检查当作完整本金证明。

### 2026-09-07 B03 观察候选持久批次读取

新增 ObservationStore.LoadCandidateBatch：10 秒期限、read-only repeatable-read 事务；绑定 chain/genesis/manifest/projector version/scope/start，投影和发现 tip 均需 canonical+receipts_verified，投影不超过发现且发现不超过 finalized，journal 新鲜度 120 秒/未来 5 秒。完整 payload 限 16 MiB，计数最多 10 万，核对摘要、区块/链/scope/数量并拒绝重复 JSON 键和未知批次字段。

在同一事务逐行对照 projection_block_observations 与 payload 的 kind/key/value，使用 UseNumber 避免 JSON 整数精度丢失；缺行、多行、重复观察键和内容差异均拒绝，行原始字节累计限制 16 MiB。只返回完整批次，不返回部分结果。这里证明本地持久层与当前规范来源一致，不证明完整历史回执、全账户覆盖或财务对账，尚未授权自动发布。

新增 opt-in TestObservationCandidateStore，独立创建/迁移/删除 PostgreSQL 数据库。实际验证有效大额字符串读取、row mismatch、陈旧、孤块、回执未核验、manifest、摘要、重复 JSON 自洽摘要、错误 genesis/version/start、缺行以及恢复。最终定向 race 2.725 秒通过；全量 Go race、vet、构建及 git diff --check 通过。无新增迁移、生产数据库改写或广播。完整候选集合组装、历史证据/独立对账与 publication 接线继续开放。

### 2026-09-07 B03 候选集合批量组装与交叉引用

新增 BuildCandidateSet，将同一批次中的市场、四类配置与 Gauge 仓位全部映射，要求来源清单与待输出对象恰好匹配。核验市场 Quote 的资产/Baseline、Baseline/Template/非零资产配置存在、模板 Hook/Executor 与市场路由相符，拒绝没有对应仓位的 Vault allocation 和 Vault account。仅有空闲本金的账户目前不能由市场仓位 DTO 完整表达，因此明确拒绝而不是静默丢弃；账户级 API 仍需完成。

候选集合按 ID/key 排序，不受观察行顺序影响。输出 CandidateSet 不包含 SyncStatus，并明确 publicationEligible=false，不能直接作为发布快照。数量限制为 1,000 市场、4,096 配置、10,000 仓位及原 100,000 观察；当前复用单项校验，批量性能尚未验收。完整性仅相对传入批次与来源 inventory，不代表链历史和全账户枚举完整。

成功用例覆盖市场+四类配置+仓位并验证输入反序输出一致；负例覆盖缺少/多余来源、Quote 不一致、缺 Baseline/Template、模板路由冲突、孤立 allocation、未覆盖账户和仓位来源高度。全量 Go race、vet、构建及 git diff --check 通过。持久事件来源清单生成、完整历史/独立对账、空闲本金账户模型及自动 publication 继续开放。

### 2026-09-07 B06 账户级本金候选与分配总和

新增 AccountCandidate / BuildAccountCandidate，独立表达 user、assetUid、Vault、deposited、allocated、free 和来源；复用完整资产配置校验，要求账户身份与 Vault 一致、规范 uint256、deposited=allocated+free，以及来源链/高度/hash。它是内部候选模型，不改变现有公共 API Schema。

BuildCandidateSet 增加 accounts 集合和 account:<asset>:<user> 来源键，排序稳定、最多一万账户。纯空闲本金账户现在会完整保留，不再因为没有市场仓位而拒绝；孤立市场 allocation 仍拒绝。另按账户汇总所有输出市场仓位 Allocated，必须等于账户 Allocated，避免局部正确但漏市场本金。完整性依然只相对观察集合，不能替代全链历史账户枚举和独立对账。

新增大额纯空闲账户与既有仓位共存、数据隔离、余额差额、分配覆盖差额、缺金额/身份/Vault/来源错配、负数及 uint256 溢出测试。全量验证结果另记。公共账户查询 API、候选持久来源清单、历史完整性与自动 publication 仍未完成。

最终 go test -race ./...、go vet ./...、go build ./cmd/... 与 git diff --check 全部通过。没有迁移、生产数据库写入或链上广播。

### 2026-09-07 B03 持久投影回放生成候选来源

新增 ObservationStore.LoadCandidateSet，把批次读取提取为同事务私有方法，在 30 秒只读 repeatable-read 中完成当前批次验证、历史投影输入回放与候选组装。逐项核对 projection_inputs 摘要、原始 chain_logs、chain/block/hash/log index、removed=false 和规范块回执标记；拒绝带额外 input.Observations 的注入视图，使用真实投影 State.Apply 重新构建来源。最多 10 万输入、64 MiB 输入/原始日志及 64 MiB 回放快照。

来源由重建的 markets/configs/gaugePositions/stockPositions provenance 生成，调用者不再手工传 SourceBlock。所有重建的这四类对象必须出现在候选输入清单，遗漏也拒绝。批次、输入、原始日志和检查点共享同一 MVCC 视图。尚未独立重新认证每个 emitter，也未完成全部原始回执历史与财务对账，候选仍不可发布。

真实隔离 PostgreSQL 验证空批次/零输入、输入计数缺失及恢复；新增 ABI AssetRegistered 事件回放→配置来源→候选成功路径，检查交易哈希和 minimumAllocation 精度；空观察批次遗漏已知资产、原始日志篡改均拒绝。定向 race 3.283 秒通过，全量验证另记。没有迁移或生产写入。

最终全量 go test -race ./...、go vet ./...、go build ./cmd/... 和 git diff --check 通过。独立财务对账、完整回执历史及自动 publication 继续开放。

### 2026-09-07 B03 候选历史区块与回执完整性

LoadCandidateSet 在输入回放前验证配置起点至当前候选的连续区块、父哈希、非递减时间、末尾 hash 及 verified 回执标记；起点为 0/1 时额外绑定 genesis。最多 100 万区块；更晚起点仅证明配置范围连续，不声称此前整链历史已重验。

读取范围内全部回执并核对交易序号/身份/状态和日志，按块重新计算 ReceiptSetCommitment，与持久 receipt_count/receipt_set_hash 一致；日志索引从 0 连续，逐项匹配 chain_logs 内容及 emitter 列，缺行、多行和修改均拒绝。最多 10 万回执/日志，回执与原始日志累计 64 MiB，单块仍沿用回执集合上限。所有读取在同一只读事务/30 秒总期限内。这是本地回执集合承诺验证，不是 Ethereum receipts root 或独立提供方真实性证明。

隔离 PostgreSQL 覆盖空集合、非空资产注册回执与候选、缺失回执、错误集合摘要、genesis 父哈希、缺失区间起点、跨块时间倒退及修复后恢复。最终定向 race 2.810 秒通过；全量 Go race/vet/build 和 git diff --check 通过。独立 emitter 认证、财务对账、生产历史/负载与自动 publication 仍开放。

### 2026-09-07 B03/B06 候选本金资产汇总核对

BuildCandidateSet 新增 verifyCandidatePrincipal：按资产汇总全部账户 Deposited/Allocated，与 vaultSolvency 的 totalDeposited/totalAllocated 比较；要求 Token balance 覆盖存款、allocated 不超过 deposited，并绑定资产 UID、Vault 和 Token。单账户的市场分配和校验仍先执行，因此形成市场→账户→资产三级金额核对。重复 Token 的多个资产配置、缺失/孤立 solvency 记录拒绝。

只从金额重新计算，不信任观察内 checks 的 true/false；余额有额外 Token 可以通过，余额少于负债拒绝。它验证候选与同块观察的本金总额关系，不构成独立 RPC 认证或所有收益/手续费负债的完整偿付证明，publicationEligible 仍为 false。

测试覆盖匹配/额外余额、账户汇总少于 Vault 存款/分配、余额不足、缺观察、错误 Token/Vault、非规范金额和重复资产 Token。隔离 PostgreSQL 资产注册回放候选已补齐零本金 solvency，同路径 race 4.119 秒通过。全量验证另记；独立 emitter 认证、奖励/费用对账与自动 publication 仍开放。

最终全量 Go race、vet、构建通过；完善重复 Token 负例后定向 race 9.832 秒通过，git diff --check 通过。无迁移、生产数据库写入或广播。

### 2026-09-07 B03 修复真实 MarketCreated 回放观察兼容性

核对 projector 实现发现 MarketCreated 会写入一份 discovery-backed market observation；此前候选回放一律拒绝 input.Observations，因而会阻断真实市场创建历史。已修复为严格白名单：只有 MarketCreated 可携带且必须恰好一份 market 观察，其 key、值与该创建日志绑定的 canonical discovery 记录完全一致，并核对事件中的资产/Token/Curve/Gauge/Quote/配置字段。其他事件仍禁止附带观察。

同事务预读 canonical_discovered_markets，限定配置历史范围、最多 1,000 市场/64 MiB，核对表中 marketId/block/log index 与 payload 及原始日志；所有发现市场都必须在回放的 markets 中出现，防止删除创建输入并同步改小 input_count 后遗漏市场。这里重新核对本地发现来源，不代表独立 RPC codehash/Registry 认证完成。

ABI 创建事件测试覆盖合法观察、缺发现/缺观察、重复观察、错误 kind/key/value/source，以及观察与发现同步修改但违背事件字段；其他事件注入观察拒绝。隔离 PostgreSQL 既有候选/历史回归 race 5.280 秒通过；全量验证另记。独立 emitter 认证、完整奖励/手续费对账及自动 publication 继续开放。

最终全量 Go race、vet、命令构建和 git diff --check 通过；无迁移、生产写入或链上广播。

### 2026-09-07 B04/B16 LaunchTemplate ABI 状态索引修复

对照当前 IV1Protocol.LaunchTemplate 与生成 ABI，确认共 13 个字段、status 位于索引 12。前端 assertCanonicalLaunchBindings 的数组回退路径仍读取 13，使有效模板被误判为非安全整数；已改为 12，具名对象路径保持正常。

新增直接依据生成 ABI tuple components 构造数据的回归用例。旧代码下复现 launch template.status is not a safe unsigned integer；修复后数组/具名对象可通过，0/2/3 与选中状态不一致以及缺失 status 均拒绝。完整前端 119 项测试、生成物检查、类型检查及生产构建通过；构建保留已有大 chunk 提示，git diff --check 通过。无链上交易、后端迁移或生产发布。

本轮修复了检查中发现的跨层 ABI 错配；独立事件 emitter/RPC 认证仍未接入候选流水线，完整奖励/手续费对账和自动 publication 继续开放。

### 2026-09-07 B03 可执行只读候选检查命令

新增 candidate-inspect --describe/--once 和 make candidate-inspect。使用 TG_CANDIDATE_DATABASE_URL 独立凭据、TG_DEPLOYMENT_MANIFEST、TG_PROJECTION_START_BLOCK；从 manifest 读取 chain/genesis，按现有 worker 规则排序计算 scope hash，并绑定当前版本与观察范围。执行候选 Store 全链路，30 秒期限和信号取消；验证失败不输出候选。无 RPC、签名、迁移、数据库写入或发布逻辑。

JSON 输出显式标注 readOnly=true、transactionSubmission=false、independentEmitterAuthentication=false、fullFinancialReconciliation=false，CandidateSet 仍 publicationEligible=false。--describe 不读取环境，非法参数/起点无输出失败。

新增 TG_TEST_CANDIDATE_CLI=1 联合测试：隔离数据库构造 manifest 对应 scope，实际运行 go run -race 命令，校验非空资产候选及状态边界；篡改日志后再次运行必须非零退出且 stdout 为空。联合 race 测试 9.152 秒通过，全量 Go race/vet/build 与 git diff --check 通过。可执行检查命令完成，独立 emitter 认证、完整财务对账和自动 publication 仍未完成。

### 2026-09-07 候选事件地址绑定

candidate-inspect 将部署清单传入候选 Store，并校验 chain/genesis/排序后的 manifest hash 与 checkpoint scope 一致。静态事件必须匹配清单地址与模块；市场实例必须来自清单 Factory 的创建事件，拒绝跨市场实例地址复用、模块冲突和创建区块之前的日志；Vault 通过对应 Registry 的 AssetRegistered 建立地址绑定，拒绝未注册、零地址和模块冲突。

成功的命令输出 candidate.emitterAddressBindingsVerified=true。该字段仅表示本地清单和创建/注册日志的地址绑定，不表示历史 RPC runtime code 独立认证；independentEmitterAuthentication、fullFinancialReconciliation、publicationEligible 继续为 false。未提供清单的内部 Store 不声明地址绑定已验证。

单元回归覆盖合法注册、未知地址、冒用模块、Vault 冲突/零地址、时间边界、动态市场实例绑定与复用拒绝。实际 CLI 与隔离 PostgreSQL 联合 race 测试通过（7.818 秒），全量 Go race、vet、命令构建通过。无迁移、生产写入或链上广播。独立链上认证、完整财务对账和自动发布仍待完成。

### 2026-09-07 候选协议事件完整性反查

候选 Store 在同一只读 repeatable-read 事务中，从已对照完整收据集合的 chain_logs 反向核对 projection_inputs。绑定地址上属于冻结 ABI 的每个事件都必须有对应 blockHash/logIndex/module 输入；未知地址与未声明 topic 不进入协议投影，已知 topic 的非法编码不能当作未知事件忽略。检查沿用 10 万条日志与 64 MiB 预算。

candidate-inspect 成功结果增加 candidate.protocolEventInventoryVerified=true；只有提供并验证部署清单、完成地址绑定和反查才置 true。该标记证明本地绑定范围内的输入覆盖，不证明独立 RPC 来源、收据 trie 或财务结算正确，publicationEligible 仍为 false。

回归覆盖遗漏、错误模块、跨区块/日志索引、非法编码、未知 topic/地址与创建前事件。隔离 PostgreSQL + 实际 CLI 测试保留完整收据，删除投影输入和全部派生观察、将计数同步改成零，仍必须非零退出且 stdout 为空；恢复后通过。该联合 race 测试通过（7.136 秒）。

最终全量 Go race、vet、命令构建与 git diff --check 通过。没有生产写入或广播；独立链上认证、完整财务对账、自动 publication 及其他未完成发布项继续保留。

### 2026-09-07 候选 Vault 注册预解析与区块顺序一致性

对照 projector.Worker 的整块注册解析顺序，候选 Store 现在先从同一已验证收据历史和只读事务读取 Registry 注册日志，建立带注册高度的 Vault 绑定，再按日志顺序回放投影输入。这样同一区块中日志索引早于注册日志的 Vault 事件可以被识别，注册前区块的事件仍拒绝。该规则与投影器的区块末状态观察一致，不声称交易时点的 Registry 状态证明。

预解析拒绝重复 assetUid、地址/模块冲突、非法 ABI，并限制 10 万日志/64 MiB；后续收据反查仍要求注册事件本身存在投影输入，不能通过预解析绕过遗漏检查。

新增同块较早日志、前一区块、缺少注册及重复资产测试。Vault 共享规则随后按合约修正，见下文。隔离 PostgreSQL 与实际 CLI 联合 race 测试通过（8.073 秒）。独立 RPC 认证、完整财务对账和自动 publication 仍未完成。

### 2026-09-07 共享 Vault 规则修正与资产事件值交叉校验

对照 OfficialStockRegistryV1.registerAsset，确认多个资产可以共享已注册 Vault，唯一性约束作用于 assetUid 与 stockToken。撤销上一轮错误的 Vault 唯一性限制，改为拒绝重复 stockToken；共享 Vault 保留首次注册高度。测试明确接受两个不同代币资产共用 Vault，并拒绝重复代币或资产。

候选 Store 现在将当前资产观察中的 stockToken、userStockVault、tokenDecimals、status 与收据事件回放后的配置值逐项对照，避免只有正确 Source 指针却替换实际资产值。有 minimumAllocation 更新事件时同时对照其值；缺少该事件不声称独立认证 getter。独立 RPC 认证与完整财务对账仍待完成，自动发布继续关闭。

上述回归、隔离 PostgreSQL + CLI 联合 race（7.443 秒）、全量 Go race、vet、命令构建与 git diff --check 均通过。无迁移、生产写入或广播。

### 2026-09-07 四类配置事件值交叉校验

候选 Store 的资产事件值核对扩展为 asset/quote/baseline/template 四类配置。所有类别核对 ID、kind 与事件回放后的最终 status；quote 核对 quoteAsset、tickerGardenBaselineId、economicsHash；baseline 核对 behaviorVectorRoot，并将事件 factoryCodeHash 对应 getter 的 referenceFactoryCodeHash；template 核对 templateHash、executionSpecId。资产已有身份及可用 minimum 事件检查保留。

校验范围以当前冻结 ABI 的 Added/Registered 事件字段为准，不将事件中未提供的 getter 字段声明为已认证。回归覆盖字段篡改、状态不一致、缺失行、错误类别/ID；自动发布门槛保持关闭，独立 RPC 认证和完整财务对账继续开放。

本轮配置回归、隔离 PostgreSQL 与 CLI 联合 race（8.696 秒）、全量 Go race、vet、命令构建及 git diff --check 均通过。没有生产写入或广播。

### 2026-09-07 市场候选创建记录与运行状态交叉校验

候选 Store 现在逐项校验 market 观察中的 17 个不可变 MarketConfig 字段与创建 discovery 一致，并检查类型；字段范围对应 deployment.marketFields 的前 17 项。poolId/sourceVersion/launchPhase 则与事件回放后的市场运行状态核对。不能只凭市场、Curve 和 canonicalRoute 彼此一致，就接受它们一起被替换后的地址、配置或阶段。

新增 17 个不可变字段篡改、三项运行状态篡改、缺失创建记录、缺失回放、错误市场 ID 回归；合法初始状态和有对应回放的毕业状态均允许。本地创建记录与回放仍需独立 RPC 认证，自动 publication 继续关闭。

本轮市场字段单元回归、既有隔离 PostgreSQL/CLI 联合 race（8.862 秒）、全量 Go race、vet、命令构建和 git diff --check 均通过。联合数据库夹具仍以资产候选为主，尚未证明真实市场全链路上线验收；无生产写入或广播。

### 2026-09-07 候选静态合约 RPC 核验入口

candidate-inspect 增加 --once --verify-static-rpc，使用独立 TG_CANDIDATE_RPC_URL，复用 deployment.Verify。先核对候选本地地址/事件覆盖标记，再在候选区块 hash 上读取清单静态合约代码，核对 chain/genesis、finalized 高度、同高 finalized hash、候选高度/hash 与读前读后区块一致性。失败无候选输出，沿用命令 30 秒总期限。

结果新增 staticRuntimeAtCandidateVerified；只在显式启用且通过时为 true。不将静态候选区块核验扩大为动态实例或全历史 emitter 认证，independentEmitterAuthentication、fullFinancialReconciliation、publicationEligible 均继续为 false。

受控 Observer 回归覆盖有效代码、错误链/创世块、未最终确认、区块高度/hash 错配、核验中重组、RPC 失败、空代码、代码哈希不符与未绑定候选。没有向生产 RPC 发起本轮验收请求；真实 RPC 联合验收与完整历史认证仍待完成。

命令单元回归、既有隔离 PostgreSQL/CLI 联合 race（9.219 秒）、全量 Go race、vet、命令构建及 git diff --check 通过。未执行生产写入、签名或广播。

### 2026-09-07 候选 CLI / PostgreSQL / HTTP RPC 联合回归

将 --verify-static-rpc 接入隔离 PostgreSQL + 实际 go run -race CLI 联合测试。使用本地 HTTP JSON-RPC 夹具和真实 chainrpc.Client，严格检查 eth_getCode 的清单地址、候选 blockHash 与 requireCanonical=true；默认本地模式必须零 RPC 请求。连续验证正常代码、错误代码、历史状态 RPC error、恢复正常四种情况，失败必须非零退出且 stdout 为空，成功仍不得声明全历史 emitter 认证或 publicationEligible。

该联合 race 测试通过（12.230 秒）。这是受控 HTTP 传输联合验收，并非公共链或生产 RPC 验收；动态实例和完整历史认证继续未完成。无生产写入或广播。

全量 Go race、vet、命令构建及 git diff --check 同样通过。

### 2026-09-07 候选资产与 Vault RPC 身份核验入口

candidate-inspect 增加 --once --verify-assets-rpc，复用 DiscoverAssets 的核心部署关系、Registry 身份谓词、Vault 双向身份/schema、Vault runtime hash 与代币指纹核验，在候选区块哈希读取。将资产状态、minimum、精度、地址、完整指纹和 Vault hash 通过现有配置构造器规范化后，与候选逐项匹配；拒绝缺失/额外/重复资产和链/区块错配。动态读取前后都执行静态及 finalized 检查，总期限仍为 30 秒。

成功标记 assetIdentitiesAtCandidateVerified=true，范围仅为候选内的资产身份；不代表市场动态实例、全历史 emitter 或完整财务认证，publicationEligible 继续为 false。新增资产匹配单元回归覆盖篡改/遗漏/重复等路径；尚未完成该新模式的完整 RPC/数据库成功路径联合验收。

命令单元回归、既有 PostgreSQL/静态 HTTP RPC/CLI 联合 race（10.559 秒）、全量 Go race、vet、命令构建和 git diff --check 通过。无生产写入或广播。

### 2026-09-07 资产 RPC 模式完整受控联合验收

扩展隔离 PostgreSQL / HTTP JSON-RPC / 实际 CLI 夹具，提供完整九项核心清单与 Factory/Registry 关系、Vault schema/双向绑定、代币指纹和代码响应。清单按实际 CLI 规则排序计算 scope hash；eth_call 与 eth_getCode 均严格要求候选 blockHash 和 requireCanonical=true，不接受未声明调用。

实际执行 --verify-assets-rpc，连续验证正常身份、assetIdentityCurrent=false、链上 minimum 与候选不一致、恢复正常。失败必须非零退出且 stdout 为空；成功要求静态及资产核验标记为 true，publicationEligible 保持 false。该模式的受控成功路径联合验收通过，联合 race 总计 12.420 秒。公共链/生产提供方验收、市场动态实例与全历史认证仍待完成。

全量 Go race、vet、命令构建和 git diff --check 通过。没有生产写入、签名或广播。

### 2026-09-07 候选 Vault 本金 RPC 对账

--verify-assets-rpc 扩展为在资产身份验证后重读候选账户 deposited/allocated/freeBalanceOf，逐项比对并验证 deposited=allocated+free；随后重读每个资产 totalDeposited/totalAllocated 和 token.balanceOf(Vault)，要求账户总和与链上总额一致、分配不超过存款、代币余额覆盖存款。所有读取固定候选 blockHash，最后再次确认静态身份及 finalized 状态；账户预算 1 万，仍受命令 30 秒总期限约束。

成功结果增加 vaultPrincipalAtCandidateVerified=true。它只覆盖候选资产范围内的 Vault 本金，不扩大为 Gauge/手续费/Treasury 全部负债证明；fullFinancialReconciliation 和 publicationEligible 继续为 false。

新增超安全整数范围金额、余额盈余/不足、账户值不符、free 不符、总额不符、遗漏有余额账户和 RPC 缺失回归。受控 HTTP/数据库/CLI 联合测试增加链上 totalDeposited 大于候选总和的拒绝路径。

本金单元回归、隔离 PostgreSQL/HTTP RPC/CLI 联合 race（14.276 秒）、全量 Go race、vet、命令构建和 git diff --check 通过。未进行生产写入或广播。

### 2026-09-07 候选逐市场 Vault allocation RPC 对账

本金 RPC 对账增加每个候选 position 的 allocation(assetUid,user,marketId) 读取与金额比较，再按账户求和对照账户 allocated；按市场求和对照 marketAllocated(assetUid,marketId)。验证 market/asset/account 关联，拒绝重复仓位与缺失账户，市场预算 1,000、仓位预算 10,000。只有明确的零 assetUid 非质押市场可以省略 Vault；未知非零资产不能跳过核验。

新增准确参数编码、分配变化、市场总额变化、遗漏仓位、遗漏账户、重复仓位、市场资产错配与 RPC 失败回归。这仍是 Vault 分配本金范围，不证明 Gauge 激活/奖励状态或完整财务负债；自动发布继续关闭。

逐市场单元回归、既有资产 HTTP RPC/数据库/CLI 联合 race（18.427 秒）、全量 Go race、vet、命令构建及 git diff --check 通过。既有联合夹具尚无市场仓位，逐市场路径当前由单元回归验证；完整市场联合验收继续保留。无生产写入或广播。

### 2026-09-07 多账户多市场本金 HTTP 验收

新增真实 chainrpc.Client + 本地 HTTP JSON-RPC 测试，包含两个账户、两个市场、四笔 allocation。成功路径严格核对 15 次读取的目标地址、完整 ABI 参数、候选 blockHash 和 requireCanonical=true。篡改用例将四笔分配从 10/20/40/30 改为 20/10/30/40，使每个账户、每个市场及全局总额均不变，仍必须逐笔拒绝；另覆盖遗漏仓位、市场总额变化和非 32 字节 ABI。

该受控 HTTP 测试通过（race 2.226 秒），弥补此前逐市场逻辑仅使用函数回调的验证范围。尚不等于完整数据库市场流水线或公共链验收，自动 publication 仍关闭。

全量 Go race、vet、命令构建及 git diff --check 通过。无生产写入或广播。

### 2026-09-07 候选市场路由 RPC 核验接线

--verify-assets-rpc 在本金检查后，对候选全部市场调用 ObserveMarketRoute；复用其核心身份、Registry 反向市场映射、canonicalPoolId/PoolKey、activeFeeSource，以及毕业 Hook/Locker 关系检查。比较候选 route 地址、token/quote/curve/gauge、sourceVersion/launchPhase、交易开关及毕业 PoolKey。验证期间固定候选区块，最终仍检查 finalized 与静态代码身份。

结果增加 marketRoutesAtCandidateVerified=true，不扩大为所有动态实例代码身份、历史日志认证、池流动性或交易报价证明。新增 Curve/Pool 合法映射、路由/版本/PoolKey 错配、缺失与重复观察的单元回归；既有资产数据库/HTTP/CLI 联合测试通过（13.723 秒），其市场目录为空，完整非空市场路由联合验收仍待完成。

全量 Go race、vet、命令构建通过，补充路由回归也通过；git diff --check 通过。无生产写入或广播，publicationEligible 仍为 false。

### 2026-09-07 非空 Curve/Pool 路由 HTTP 验收

从现有 deployment.routeFixture 导出可复现的两组 RPC 夹具，使用实际 chainrpc HTTP 客户端运行 ObserveMarketRoute，再进入候选匹配。覆盖非空 Curve、毕业 Pool 成功路径及候选 Router 被替换的拒绝路径，state reads 必须固定 blockHash/requireCanonical。夹具来自受控 ABI 测试，不是公共链快照。

HTTP route race 测试通过（1.779 秒）。此轮验证了非空路由观察器与候选匹配的连接，尚未替代完整市场数据库→CLI 或公共链部署验收；发布门槛保持关闭。

全量 Go race、vet、命令构建和 git diff --check 均通过；无生产写入或广播。

### 2026-09-07 候选非资产配置 RPC 对照

--verify-assets-rpc 接入 ObserveConfigBlock，在候选区块重读 quote/baseline/template。按 MaxConfigReads=1024 分批处理最多 4096 个配置，拒绝重复与未知类别；通过 BuildConfigCandidate 规范化后比较完整 values 和 status，覆盖超安全整数范围金额及 identityCurrent/componentCodeIdentityCurrent。链上返回 false 的身份状态可被一致性核对保留，不代表该配置可执行。

输出增加 configValuesAtCandidateVerified；只说明候选值与这次链上查询一致，不改变全历史认证和发布门槛。新增金额、状态、缺失/额外观察、身份结果与 source 错配回归。非空配置的完整 HTTP/数据库联合验收仍待完成。

配置单元回归、既有资产 PostgreSQL/HTTP/CLI 联合 race（14.783 秒）、全量 Go race、vet、命令构建和 git diff --check 均通过。没有生产写入或广播。

### 2026-09-07 非空三类配置 HTTP 验收

提取现有 quote/template 配置夹具供生成器和原测试共享，并导出包含 quote/baseline/template 的可复现 JSON RPC 证据。实际 chainrpc HTTP 客户端、ObserveConfigBlock 与候选值比较连接运行，保留 quote identityCurrent=false 与 template status=3，验证修改报价金额、基线代码哈希、模板哈希均被拒绝。全部状态读取检查 blockHash/requireCanonical。

该受控 HTTP race 测试通过（3.089 秒）。它补齐非空配置观察到候选比较的验收，不等同于配置事件数据库→CLI 或公共链验收；完整发布工作仍未完成。

全量 Go race、vet、命令构建和 git diff --check 通过。没有生产写入或广播。

### 2026-09-07 候选 Curve 进度 RPC 对照

--verify-assets-rpc 在 Registry 路由核验后，读取 Curve 代码与 quoteAsset，并逐项比较 realQuoteReserve/sellableTokens/reservedTokens/accruedCurveFees/readyToGraduate。固定候选 blockHash，拒绝重复 Curve、空代码、ABI 非规范编码、缺失 getter 和任何值不一致，最后沿用静态/finalized 再检查。

结果新增 curveProgressAtCandidateVerified；仅代表进度值一致及当前地址有代码，不扩大为 Curve 模板代码审计或完整历史认证。新增五项进度、quoteAsset、空代码、缺失读取及 bool=2 的回归。非空 Curve 进度完整 HTTP/数据库联合验收仍待完成。

命令单元回归、既有资产 PostgreSQL/HTTP/CLI 联合 race（14.044 秒）、全量 Go race、vet、命令构建和 git diff --check 通过。无生产写入或广播。

### 2026-09-07 Curve 进度 HTTP RPC 验收

将 CurveProgress 的全部成功/失败用例同时通过实际 chainrpc.Client 和本地 HTTP JSON-RPC 执行，严格检查 blockHash/requireCanonical 选择器。成功路径要求完成代码、quoteAsset 和五项进度共 7 次读取；覆盖值错配、空代码、RPC error 和 bool=2 非法 ABI。

该受控 HTTP race 测试通过（2.138 秒），补齐 Curve 进度接口到真实 HTTP 客户端的连接验证。完整非空市场数据库→CLI 和公共链验收仍未完成，发布门槛不变。

全量 Go race、vet、命令构建和 git diff --check 通过。没有生产写入或广播。

### 2026-09-07 Gauge 仓位 RPC 核验与共享激活解释

提取 NormalizeGaugePrincipal，供现有 BuildPositionCandidate 和 RPC 验证共用。按 activationSnapshot.processed 解释 pending，拒绝 processed/refs=0、非法 generation/unlock、uint256 溢出；不按墙钟猜测激活。原候选构造回归保持通过。

--verify-assets-rpc 增加 Gauge 身份字段、代码存在性、positionOf、activationSnapshot 和 AllocationManager.rageQuitSettlementPending 读取。核对市场/资产/QuoteConfig/核心合约绑定，有未结算退出时拒绝普通仓位；比较有效 active/pending、activationAt/unlockAt、分配本金总额及 quote/meme claimable。输出 gaugePositionsAtCandidateVerified，仍不代表全历史实例代码认证或奖励总负债对账。

新增未处理/已处理激活、错误身份、待结算退出、领取额错配、解锁错配及非法 refs 回归。非空 Gauge 的完整 HTTP/数据库联合验收仍待完成，publicationEligible 保持 false。

Gauge/命令单元回归、既有资产 PostgreSQL/HTTP/CLI 联合 race（15.361 秒）、全量 Go race、vet、命令构建和 git diff --check 通过。无生产写入或广播。

### 2026-09-07 Gauge 仓位 HTTP RPC 验收

提取共享只读 state HTTP 夹具，将 Gauge 的未处理/已处理激活、身份错配、待结算退出、领取额错配、解锁错配和 processed/refs=0 用例通过真实 chainrpc.Client 执行。所有请求严格绑定候选 hash/requireCanonical；合法待激活及已处理路径均完成代码、身份、positionOf、退出结算、激活快照共 5 次读取。Curve 原 HTTP 用例同时回归通过。

定向 race 测试通过（4.190 秒）。该结果覆盖 Gauge 解释逻辑与实际 HTTP 客户端衔接，不等于完整仓位数据库→CLI 或公共链验收；Gauge 奖励总负债及发布门槛仍待完成。

全量 Go race、vet、命令构建和 git diff --check 通过。无生产写入或广播。

### 2026-09-07 Gauge 全部候选用户本金总额核对

将 Gauge 身份检查移至市场预遍历，涵盖没有候选仓位的非零 Gauge；拒绝重复市场、Gauge 复用及重复用户仓位。逐仓位经共享激活解释后累计 Active/Pending，与 storedTotalActiveStock/totalPendingStock 对照，防止遗漏用户或整个列表。只有明确零 Gauge 才跳过。

新增 Active/Pending 总额不符、遗漏用户、合法空 Gauge、重复用户测试，并通过真实 HTTP 客户端执行：有 pending 的合法路径现为 7 次读取，空 Gauge 为 4 次读取。该对账范围是 Gauge 本金，不扩大为奖励总负债或全历史认证。

Gauge 定向 HTTP/race、既有资产 PostgreSQL/HTTP/CLI 联合 race（15.476 秒）、全量 Go race、vet、命令构建和 git diff --check 均通过。无生产写入或广播，完整发布目标仍未完成。

### 2026-09-07 已知市场 FeeVault 费用偿付 RPC 核验

candidate-inspect 的资产 RPC 模式新增同区块 FeeVault 核验：逐市场读取四类角色负债与 forfeitureReserve，按资产累加并严格匹配 totalLiability，再检查 ERC-20/原生余额覆盖。拒绝重复市场、无效资产、大整数溢出、RPC/ABI 错误及负债或余额不符；原生余额要求规范 uint256 十进制。沿用外层静态身份绑定与最终性复核。

新增 11 类定向测试，覆盖两个市场共享资产、超过 JavaScript 精确整数范围的金额、盈余、欠款、遗漏/重复市场、RPC/ABI 故障和原生余额异常。ERC-20 分支通过实际 chainrpc HTTP 客户端执行，正常路径 24 次 hash-pinned 读取；原生分支通过接口夹具验证。全量 Go race、vet 和命令构建通过。

成功字段为 knownMarketFeeCoverageAtCandidateVerified。核验仅覆盖候选市场涉及的资产，不证明市场目录完整、用户/epoch 权益或 Treasury 全量对账，也不授权 publication。第一版必要功能及自动发布的剩余验收仍按上表执行。

既有资产 PostgreSQL→HTTP→CLI 隔离数据库回归通过（19.738 秒），git diff --check 通过。该数据库夹具不含市场，本次费用市场核验的证据来自上述专用 HTTP 测试；未进行生产部署或广播。

### 2026-09-07 Creator 历史 epoch 未领取负债 RPC 核验

candidate-inspect 资产 RPC 模式增加 Creator Registry 当前身份关系核验、全范围 epoch 非零受益人读取与 Quote/Meme 未领取负债合计。分别匹配 Creator 费用桶；全市场共享 1024 个 epoch 预算，零 epoch、预算超限和任何缺失读取均失败。允许受益人在多个 epoch 重复出现。

12 类接口及真实 chainrpc HTTP 测试通过（定向 race 1.820 秒），涵盖大整数、重复受益人、空受益人、Registry/Factory/manifest 不一致、epoch 数量异常、双资产负债偏差和 RPC/ABI 故障；正常单市场双 epoch 路径为 14 次同 hash 读取。

成功输出 creatorEpochLiabilitiesAtCandidateVerified；这仅证明当前未领取 epoch 合计与 Creator 桶一致及当前绑定关系，不证明历史权益变更、已领取历史、市场目录完整性或 Holder/Treasury 对账。完整财务和 publication 标记保持 false。

全量 Go race、vet、命令构建与 git diff --check 通过；既有资产 PostgreSQL→HTTP→CLI 隔离回归通过（18.112 秒）。该数据库夹具没有市场，Creator 市场核验证据来自专用 HTTP 测试；尚无真实部署验收。无生产写入或广播。

### 2026-09-07 已知市场 Holder/Treasury 偿付核验

增加 VerifyKnownHolderCoverage 并接入 candidate-inspect 资产 RPC 模式。先核验核心部署，在同区块重读 Registry market 及 token 反向索引，对当前 Holder token runtime 取 hash 后交给既有模式观察器。按 manifest 支持 epoch Treasury 与连续 24 小时 Holder，要求返回批次范围和计数一致，并拒绝任意 false 会计检查；读取结束重核区块 hash。

新增两种模式下共 16 项测试：正常、余额不足、总负债偏差、错误反向索引、缺失记录、重复市场、关闭 Holder 分享，以及已领取/已支付超过资金。当前代码身份不等同于创建时的历史认证；用户领取历史、完整市场发现、Merkle/TWAB 和服务费用全量账本仍不在此标记内，完整财务与 publication 均保持 false。

全量 Go race、vet、命令构建及 git diff --check 通过；既有资产 PostgreSQL→HTTP→CLI 回归通过（17.663 秒）。新增 Holder 覆盖通过部署观察器接口夹具验证，尚未形成含 Holder 市场的数据库→HTTP→CLI 联合证据；未进行生产写入或广播。

### 2026-09-07 Holder 偿付真实 HTTP 客户端验证

将两种 Holder 模式的覆盖测试同时通过生产 chainrpc 客户端执行。HTTP 服务器严格校验 eth_call/eth_getCode/eth_getBalance 使用候选 blockHash 和 requireCanonical；响应以精确目标及 calldata 查找。新增读取期间区块改变、RPC unavailable、非规范原生余额 quantity 三类拒绝路径，合计两种模式各 11 个场景。

首次 race 检查发现复用的测试夹具 CallAt 计数器在核心绑定并发请求下竞争，HTTP 响应改为读取固定映射后定向 race 通过（2.176 秒）。这是测试基础设施修正，未改变生产验证器行为。

此证据覆盖真实 HTTP 传输、同区块选择器、原生余额及两种模式的错误处理；仍不等于包含 Holder 市场的数据库→CLI、公共链或用户领取端到端验收。

deployment 与 candidate-inspect 包 race、vet、命令构建及 git diff --check 均通过。此次仅修改测试和记录，未重复执行无关数据库回归，未进行生产写入或广播。

### 2026-09-07 Creator 候选权益与 RPC 逐轮绑定

发现并补齐原 Creator 检查仅核验 RPC 内部总和、候选输出未包含逐 epoch 权益的缺口。CandidateSet 新增 creatorEpochs，从持久观察批次生成、按市场/数字 epoch 排序；校验市场引用、资产、非零受益人、规范 uint32 epoch 和 uint256 金额，并拒绝重复、孤立及超预算记录。

Creator RPC 核验现在要求候选完整覆盖 1..currentCreatorEpoch，逐项比较受益人、Quote/Meme 资产和未领取金额；额外、缺失及重复权益拒绝通过。新增总额不变但轮次金额互换、受益人改动、缺失和额外轮次的实际 HTTP 拒绝测试，以及 7 类候选构建测试。初次构建测试发现通用 raw 解析接受前导零，已在新权益构建边界补充规范十进制比较。

creatorEpochs 是当前候选区块的未领取权益，不提供历史领取或公开 Rewards API，publication 仍为 false。既有资产数据库→CLI 回归通过（15.227 秒），该夹具不含 Creator 市场；含市场的持久化联合验收仍待补齐。

修正后全量 Go race、vet、全部命令构建和 git diff --check 通过。无生产写入或广播。

### 2026-09-07 Creator 原币退出状态候选绑定

Creator 候选权益新增退出截止点、就绪状态和观察区块时间，构建与 RPC 核验共享 CreatorExitReady 规则：规范 uint256 截止点、uint64 区块时间，非零且截止点不晚于区块时间才就绪。RPC 从候选高度重读并匹配 Header hash/number，逐 epoch 读取 market/beneficiary 的 rawRewardExitAt，拒绝候选截止点、就绪值或时间不符。

增加 8 个时间边界/格式测试及等待中、恰好到期、退出值/观察时间/就绪值被改动的实际 HTTP 测试。正常双 epoch Creator 路径现在为 17 次请求（包含 Header）。候选构建与 CLI 包 race 通过。就绪字段不等于领取模拟或交易执行成功，完整发布目标仍未完成。

全量 Go race、vet、命令构建及 git diff --check 通过；既有资产 PostgreSQL→CLI 回归通过（15.717 秒），不扩大为含 Creator 市场的数据库联合验收。无生产写入或广播。

### 2026-09-07 Creator 候选本地账本完整性

候选构建新增逐市场从 1 开始的连续 epoch 检查，并与 Quote/Meme feeLiability 中的 creatorEpochCount 和 Creator 桶金额核对。存在 epoch 时必须同时存在两类费用桶；存在费用桶但无对应 epoch 也失败。同一批次观察时间必须一致，同市场同受益人的 rawRewardExitAt 必须一致，累积负债不得溢出 uint256。

新增 10 个账本测试，覆盖逆序稳定输出、缺失首/末/全部 epoch、缺少费用桶、数量/金额偏差、时间及退出状态冲突。该本地证据不能发现攻击者同时删去全部相关 epoch 和费用桶；独立 RPC 全范围核验仍是必要门槛，publication 保持 false。

全量 Go race、vet、全部命令构建、git diff --check 与既有资产 PostgreSQL→CLI 回归（16.895 秒）通过。Creator 含市场持久化联合验收仍未完成；无生产写入或广播。

### 2026-09-07 Creator 观察时间绑定数据库规范区块

LoadCandidateSet 在原只读 repeatable-read 事务内，按 chainId/高度/hash/canonical/receipts_verified 精确读取 block_timestamp，并核对全部 Creator 候选的 observedAtTimestamp 与退出就绪状态。之前本地构建仅保证各条时间一致，现在也要求与规范区块一致；RPC 模式继续独立读取 Header 复核。

新增 6 类规范时间测试，覆盖时间偏差、错误就绪状态、恰好到期、已到期、未申请及非规范退出时间。该步骤不扩展为时间来源的独立链认证；候选历史仍使用既有回执和区块证据，完整发布门槛保持未完成。

全量 Go race、vet、全部命令构建、git diff --check 和既有资产 PostgreSQL→CLI 回归（14.448 秒）通过。该回归验证新增规范区块查询接入；含 Creator 市场的持久化故障注入仍待完成。无生产写入或广播。

### 2026-09-07 Creator 候选 PostgreSQL 存取与篡改恢复

新增 opt-in TestCreatorCandidatePostgres，在独立创建并完成迁移的数据库中存入完整市场/配置/仓位候选观察批次及两个 Creator epoch。通过正式 LoadCandidateBatch 再 BuildCandidateSet，验证超过 JavaScript 精确范围的金额和退出就绪状态；只修改 observation 明细由持久化一致性检查拒绝，同步重算 payload/digest 后删除 epoch 由候选账本检查拒绝，恢复记录后重新成功。

首次测试使用自定义 scope 被数据库约束拦截，改为当前正式观察 scope 后通过，未修改数据库约束。该测试使用夹具 SourceBlock，覆盖 PostgreSQL→观察批次→候选构建，尚不覆盖 LoadCandidateSet 的全事件重放、独立 RPC 或完整 CLI 市场流程；不扩大为生产验收。

最终包含恢复路径的 PostgreSQL race 测试通过（8.469 秒），readmodel vet 和 git diff --check 通过。此次仅新增测试和文档，未重复无关全量构建；测试数据库已清理，无生产写入或广播。

### 2026-09-07 Holder 市场模式候选输出

CandidateSet 新增 holderMarkets，通过可选 continuous/epoch 结构隔离两种机制。连续模式以定点整数保存 funded/paid/outstanding 和 24 小时周期、lastFundingAt；epoch 模式保存当前轮次、epochDuration、activatedAt、非零 eligibilityPolicyHash/TWAB schema。要求市场 creatorFeesToHolders 明确，启用市场不可缺失 Holder 行，禁用市场不可混入，拒绝重复、资产或分配器不符、错误模式、非规范时间及 paid 超过 funded。

新增两种模式各 8 个测试。首次回归发现旧市场夹具缺少 creatorFeesToHolders，已补充明确 false，没有放松生产校验。当前为市场状态候选输出；已知链上偿付检查仍独立执行，新增字段与 RPC 的逐项绑定、epoch 明细及用户权益仍待完成，publication 保持 false。

修正夹具后全量 Go race、vet、全部命令构建、git diff --check、Creator PostgreSQL 候选回归（4.941 秒）及既有资产数据库→CLI 回归（14.418 秒）通过。无生产写入或广播。

### 2026-09-07 Holder 市场候选与 RPC 逐项绑定

将 Holder 覆盖验证提取为 ObserveVerifiedKnownHolders，原 VerifyKnownHolderCoverage 保留为兼容包装。新入口在所有身份/偿付/最终区块检查通过后返回 Holder 观察与 Registry market 记录，失败只返回空批次；临时 combined scope 不作为 worker 持久化 scope。

资产 RPC 模式用同一 BuildHolderCandidates 规范化这些链上值，检查 chain/hash/height/scope/count 后逐项匹配候选 holderMarkets。新增两种模式各 8 个候选篡改测试，包含缺失/额外记录、分配器/模式/时间改变，以及连续模式 funded/paid 同增而 outstanding 不变。既有 22 场景实际 HTTP 测试改为检查返回证据范围和失败不泄露部分批次。

这一步绑定市场级候选字段，不扩展为每个 Holder 用户权益、epoch 明细或完整财务发布授权。

全量 Go race、vet、全部命令构建、git diff --check 及既有资产 PostgreSQL→CLI 回归（22.453 秒）通过。新增 Holder 对比以专用候选测试和实际 HTTP 观察器测试验证，含 Holder 市场的完整数据库→CLI 联合验收仍待完成。无生产写入或广播。

### 2026-09-07 Holder epoch 明细候选与 RPC 比较

EpochHolderCandidate 新增 entries，从第 1 轮连续覆盖 currentEpoch，按数字顺序输出，所有市场合计受 2048 轮预算约束。明细以固定字段集合保留金额、状态、请求/领取时间、sourceBlock/hash、Merkle root、dataset hash、窗口和 Holder 双资产负债；整数保持规范十进制字符串并按原 ABI 位宽验证。

构建重新检查窗口顺序、claimed≤committed、非 rollover 的资金覆盖/承诺一致及 outstanding，rollover 要求资金清零；拒绝未知状态、缺失/重复/孤立 epoch。既有 Holder RPC 规范化比较自动包含全部 entries，根信息变化及缺失轮次会失败。新增 9 类 epoch 账本测试并扩充 RPC 候选篡改测试。

根哈希的同块匹配不是 Merkle/TWAB 数据集证明；用户领取历史和完整上线验收仍待完成，publication 保持 false。

全量 Go race、vet、全部命令构建、git diff --check 及既有资产 PostgreSQL→CLI 回归（22.253 秒）通过。epoch 候选新增逻辑由专用构建/比较测试验证，含 Holder epoch 的完整持久化→RPC 联合证据仍待补齐。无生产写入或广播。

### 2026-09-07 Holder HTTP 观察输出与候选跨模块验证

增加显式 fixture 生成器：由生产 chainrpc HTTP 客户端执行 ObserveVerifiedKnownHolders 后导出 epoch/continuous 两种批次，不手工拼装候选字段。readmodel 读取这些真实观察器输出，验证连续模式 funded/paid/outstanding，以及 epoch 模式已部分领取（status=3、outstanding=7）和 rollover（status=4、outstanding=0）的字段兼容。

新增两种模式正常及篡改验证：rollover 后恢复资金、连续 paid 超过 funded 均被拒绝。夹具仅本地合成链状态，不是公共链证据；不替代 Holder 市场完整数据库→CLI 或用户领取验收。

deployment/readmodel/candidate-inspect 三个相关包 race、vet 和 git diff --check 通过。此次仅新增测试与夹具，未重复无关构建或数据库回归；无生产写入或广播。

### 2026-09-07 Holder 两模式 PostgreSQL 候选存取和恢复

扩展既有独立数据库测试，在同一迁移完成的临时数据库中分别验证 epoch/continuous Holder 候选。观察器导出夹具的市场身份适配到完整候选市场/配置/仓位批次，LoadCandidateBatch→BuildCandidateSet 后逐字段比较 holderMarkets（含 epoch entries）。此身份适配是测试数据组合，不是原导出部署的历史重放。

验证三类异常与恢复：仅篡改 Holder 明细由批次/镜像一致性检查拒绝；同步重算摘要后删除 epoch 或让 paid 超过 funded 由领域检查拒绝；恢复完整批次重新成功。包含 Creator 与两种 Holder 模式的 PostgreSQL race 套件通过（11.349 秒），临时数据库清理完成。

该证据覆盖真实 PostgreSQL 存取与候选构建，不扩大为 LoadCandidateSet 全历史来源核验、独立 RPC→CLI、Merkle 证明或真实用户领取验收。无生产写入或广播。

### 2026-09-07 B17 API 请求运行指标

新增 GET /metrics，使用标准库和既有 chi 响应包装器输出 Prometheus 文本格式：请求计数、六个有限延迟桶及 +Inf、duration sum/count、实时 in-flight。以路由模板/规范方法/状态码类别聚合，不包含钱包、查询参数或错误内容；未知路径统一 unmatched，抓取自身不改变统计，慢抓取不持有请求统计锁。指标不读取数据库或快照。

测试覆盖 40 个并发不同钱包请求的同路由聚合、参数不泄露、抓取幂等、panic 归类 5xx 和阻塞请求 in-flight。隐私测试初始误期望 5xx，实际未知查询参数按现有 API 规则返回 4xx，已修正测试预期；未改变接口校验行为。

仅补齐 API 请求指标；任务指标、索引/发布延迟、告警规则及生产抓取验收仍待完成，不代表 B17 整体验收通过。

指标定向 race、HTTP 包 race、修正后的全量 Go race、vet、全部命令构建及 git diff --check 通过。未进行生产部署或抓取配置。

### 2026-09-07 B17 就绪监控信号

API metrics 增加最近一次完成 GET /readyz 的结果和观察时间。初始 ready=-1/timestamp=0 明确表示未观察；任何非 200 结果（包括恢复后的 panic 响应或容量拒绝）记为 0，200 记为 1。值与时间在同一统计锁下更新/复制，避免读取到不一致组合。抓取指标本身不访问数据库或快照，也不刷新就绪时间。

增加未探测、数据未就绪、恢复、数据库故障、再次恢复和 panic 转换测试，并确认指标抓取不调用快照读取。采集器需要独立探测 /readyz，告警必须检查观察时间，不能将历史 ready=1 视为实时可用性。生产抓取与告警配置仍未完成。

指标定向 race（2.025 秒）、HTTP 包 race（4.152 秒）、vet、全部命令构建和 git diff --check 通过。无生产部署或外部监控写入。

### 2026-09-07 就绪指标并发顺序保护

以单调发起序号保护 readiness 值和时间，较早请求迟到时不覆盖已完成的较新探测。指标语义明确为“已完成探测中发起顺序最新的结果”；请求计数与耗时依然记录所有请求。新增两种可控交错测试，分别验证旧 200 不覆盖新 503、旧 503 不覆盖新 200，观察时间与 in-flight 一并校验。

HTTP 包 race（4.892 秒）、vet、全部命令构建和 git diff --check 通过。生产告警及其余上线验收仍待完成；无生产写入或广播。

### 2026-09-07 B17 Prometheus 抓取示例及告警规则

新增 monitoring/prometheus.yml、blackbox.yml、五条 API 告警规则及 promtool 时序测试。示例独立通过 blackbox GET /readyz，避免仅抓取 metrics 导致就绪值长期不更新；包含 API down、readiness stale/not-ready、业务 5xx 比例和 p95 延迟告警，低于 1 request/s 不触发比例/延迟告警。告警阈值为待生产基线调整的初值，健康探测不混入业务比例。

本机 Docker daemon 未运行、未预装 promtool；临时下载官方 Prometheus 3.14.0 工具并校验发布 SHA-256，仅提取到 /tmp，无全局安装。Prometheus 配置、五条规则和触发/恢复/低流量场景均通过 promtool；Makefile 新增 monitoring-check 并执行通过，git diff --check 通过。

README 记录主机/容器地址差别和故障处理。没有启动采集服务、没有生产目标/Alertmanager 接收端、没有发送通知；blackbox 运行时与生产告警投递仍待验收。此次配置变更未重复无关 Go 测试。

### 2026-09-07 就绪告警缺失指标与时钟异常

补齐 PromQL 在输入序列缺失时返回空结果造成的监控缺口：对 up=1 的每个 job/instance，ready 或 observed timestamp 任一缺失持续 2 分钟即告警；up=0 仍由 APIDown 处理。增加观察时间超前采集器 30 秒并持续 2 分钟的 ClockSkew 告警，避免异常未来时间长期被误判为新鲜。

新增多实例缺失 ready/缺失 timestamp/健康/down 隔离、缺失后恢复、时钟异常及恢复时序测试。全部七条规则和测试经官方 promtool 的 monitoring-check 通过；git diff --check 通过。仅修改本地配置，未部署或发送通知，生产采集与投递验收仍待完成。

### 2026-09-07 API 实际 HTTP 指标与 Prometheus 解析集成

新增 TestMetricsPrometheusCompatibility：启动本地 httptest HTTP API，使用真实 HTTP 客户端访问 /livez、/readyz、未知路径和 /metrics，再将实际响应送入官方 promtool check metrics。覆盖未观察、未就绪、就绪、故障及恢复，检查 ready 值、无私有路径/钱包参数标签、解析成功且无 lint 警告。

新增 make monitoring-integration-check，可与 monitoring-check 一起运行。使用受控数据库/快照依赖，不连接生产服务；此证据验证 HTTP 输出与 Prometheus 解析器兼容，不扩展为实际远端抓取或告警投递。

七条告警规则/时序测试、Makefile HTTP→promtool race 集成（1.882 秒）、integration vet 和 git diff --check 通过。此次仅新增测试、命令与文档，未重复无关 Go 构建；无生产部署或通知发送。

### 2026-09-07 Blackbox Exporter 实际就绪探测

新增 TestBlackboxReadinessIntegration 和 make monitoring-probe-check。临时启动真实 Blackbox Exporter 进程，绑定 loopback 临时端口并加载仓库 blackbox.yml，探测本地实际 API 的 /readyz；验证 false→true→false→true 对应 probe_success=0/1、HTTP 503/200，并检查探测更新了 API readiness metric。

使用官方 Blackbox Exporter 0.28.0，下载后校验发布 SHA-256，临时提取到 /tmp，未全局安装。测试进程在退出时停止，独立端口和日志位于测试临时环境。首次 race 运行通过（2.230 秒），Makefile 入口复跑及 integration vet、git diff --check 通过。

本轮完成本地 blackbox 运行时配置和 API 探测衔接验收；仍不等于生产网络抓取、Prometheus 常驻采集或 Alertmanager 通知投递。没有生产部署或发送通知。

### 2026-09-07 本地 Prometheus→Blackbox→API 完整采集验证

新增 TestMonitoringStack 和 make monitoring-stack-check：启动真实 Prometheus 3.14.0 与 Blackbox Exporter 0.28.0，使用 loopback 临时端口、临时 TSDB，以及仓库配置的临时目标/抓取间隔替换副本。源配置与告警阈值不修改。API 使用可控数据库/快照依赖。

通过 Prometheus 查询 API up、Blackbox probe_success 和 API ready，验证 false→true→false→true 四次状态收敛；同时检查七条告警规则成功加载且 health=ok。首次进程级 race 通过（10.543 秒），并通过 Makefile 入口复跑。各进程与存储随测试退出清理。

该结果完成本地实际采集链路，告警触发时序另由 promtool 测试覆盖；没有生产目标、Alertmanager 接收端或通知投递。生产网络、运行负载及外部告警验收仍未完成。

Makefile 进程级 race 复跑（8.641 秒）、integration vet 和 git diff --check 通过。此次仅新增测试、命令与文档，未重复无关构建；无生产部署或通知发送。

### 2026-09-07 B17 后台管线 Prometheus 输出

复用既有只读 backend-status 增加 --once --prometheus，JSON 默认输出保持。格式化四阶段存在性/高度/规范性/滞后、stored finalized、journal 进度、观察时间、本金对账计数，以及可选 RPC 观察。固定阶段名和链 ID 标签，拒绝未知/重复阶段、非规范数值、负计数，缺失高度与计数省略，绝不伪造零。

保留 0/2/1 退出码语义（2 为完整 attention 报告）。Formatter 先构造完整缓冲区再输出，读取或编码失败无指标报告。新增缺失、恶意标签、重复、负计数、RPC 及配置不足测试，正常/缺失/RPC 输出通过官方 promtool check metrics。该 CLI 不直接接入 API 抓取，也未部署常驻管线 exporter；后续采集必须检查观察时间并接收退出码 2。

真实隔离 PostgreSQL→operations.Run --prometheus 测试通过：未发布状态返回 2，projection 存在、publication 缺失信号准确；扩展数据库 race 套件通过（14.283 秒）。operations race、operations/readmodel vet、全部命令构建和 git diff --check 通过。无生产写入或广播。

### 2026-09-07 B17 管线指标原子 textfile 交付

backend-status 新增显式 `--once --metrics-file /absolute/path.prom`。完整报告先编码，再写入目标同目录的非 .prom 临时文件，经文件刷盘、关闭、原子 rename 后交付；stdout 留空，数据库与 RPC 保持只读。退出码 0/2 都更新指标，读取、编码或替换前写入失败返回 1 并保留旧文件。目标目录需预先创建，每文件单一写入进程；保证原子可见性，不承诺断电后的目录项持久性。

验证覆盖正常与 attention 报告替换、无效报告保留、目标为目录时替换失败与临时文件清理、非法路径/参数拒绝，以及真实隔离 PostgreSQL CLI 的退出码 2 文件交付、数据库不可用后内容保留。operations race（1.879 秒）、隔离数据库 race（7.556 秒）、operations/readmodel vet 与全部命令构建通过。

本次完成文件交付能力；尚未安装 textfile collector、定时调度、生产目标或管线 freshness 告警。采集必须识别观察时间缺失、过期、未来时间，不能把旧文件当作当前成功。B11/B12/B13/B14/B16 仍是首版必要功能，其未完成验收项保持开放；本次不代表首版整体完成。

### 2026-09-07 B13/B16 正式统计页故障与恢复

新增限时、仅 loopback 的 TestStatisticsBrowserFixture，合成 Reader 接正式 Go HTTP 路由，正式 stats.html 使用生成 SDK 和运行时校验器。Chrome 实测显示 130 市场（完整分页）、65/65 阶段、3 distinct holders/排除后 2、成交 3/内部转换 1、24 小时序列及无成交桶。

浏览器发现实际缺陷：/v1/updates 返回 503 时 analytics widgets 已清空，但顶部市场数、Quote 资产组数、阶段分布和 Quote 储备仍残留。app.ts 抽取 clearStatsSnapshotView，在 snapshot invalidation 与 analytics pause 时清理汇总并使旧渲染 generation 失效。修复后浏览器确认旧值全部清空，POST recover 后无手动刷新、revision 不变，汇总/完整目录/三类统计自动恢复。

验证：正式 Chrome 成功→故障→恢复；有界夹具 race 147.061 秒正常 stop；httpapi 全包 race 5.218 秒与 vet；前端 119 项测试、生成检查、typecheck、Vite build 通过。构建仍有既有 >500 kB chunk 提示。该浏览器链路使用受控 Reader，不是数据库/真实链 publication 或重组验收；首页/交易/奖励、多钱包、生产负载和其他首版必要项仍未完成。临时 Go/Vite 进程已停止。

### 2026-09-07 B13/B16 首页失效清理与轮询恢复

app.ts 增加首页市场视图清理：snapshot invalidation、analytics pause 与无 foundation 渲染时移除旧市场卡片、隐藏 loading/empty、显示等待已验证数据。同步使 home render generation 失效，旧异步 metadata 结果不能重新插卡。正式 index.html 通过受控 Go HTTP 夹具在 Chrome 中完成 10 个市场链接/全局统计成功→503 清空→同 revision 自动恢复，无页面刷新。

Snapshot poller 的 stop 现在保留 recovering 标记，使后续 start 遇到 unchanged 仍按 reset 重读全部 scope。新增 stop/start 恢复已清空视图（重复 start 不增加请求）、取消后旧 fetch 迟到不覆盖新 generation 两项测试。前端 121 项测试、生成检查、typecheck 与生产构建通过；既有大 chunk 提示保留。Go 浏览器夹具 race 正常结束，临时进程已清理。

范围仍为受控 HTTP 与页面生命周期。真实 publication/重组、交易/奖励页、多钱包及生产负载尚待验收；不把此次修复标为 B16 或首版整体完成。

### 2026-09-07 B16 更新接口身份一致性

/v1/updates 原先只检查 revision 的字符串格式，没有将其绑定到返回的 blockNumber/blockHash；历史 reader 成功返回无效身份时会退回 reset。本次增加当前/历史 SyncStatus 的链、synced/finalized、非空区块身份与 revision 精确配对校验。损坏身份返回 503，只有 ErrRevision 保持缓存过期 reset 语义；不将存储损坏隐藏为正常更新。

新增当前/历史两层 16 个身份反例（缺失/错配 blockNumber、blockHash、链、finality、status、revision），检查 503、no-store、错误响应 schema 及无效当前值不触发历史读取。客户端同时拒绝 mode/invalidated 中的 JSON 数组，取消隐式字符串转换接受非字符串值的路径，覆盖六个序列化反例。该工作完善 HTTP 交付边界，不替代底层 canonical publication 或真实重组验收。

验证：Go httpapi 全包 race（6.200 秒）、vet、API 构建通过；前端 122 项测试、生成检查、typecheck、生产构建及 git diff --check 通过。尚未完成真实 publication/重组、交易/奖励页与生产负载联合验收，B16 与整体目标保持开放。

### 2026-09-07 B16 持久 publication 恢复至前端 SDK

扩展 testReadSnapshots：每次更新断言在 TG_TEST_WEB_INTEGRATION=1 时额外启动 loopback 正式 Go HTTP，调用生成 SDK 与 validateSnapshotUpdate，验证 no-store、HTTP 503 或合法 reset/changed/unchanged 及 revision。覆盖首次发布、相同 revision、后续发布、回执覆盖不足、生产者/indexer 过期、32 版本保留窗口失效。

在既有孤块失败后，测试直接写入受控 canonical 替代分支 34→35，并更新 journal 的 finalized 信息。仅修复链视图仍返回 503，正式 Store.Publish 发布高度 35 后，旧孤块 revision 返回完整 reset，新 revision 返回 unchanged。独立 Store.Load 确认旧孤块不能 pin，数据库保留全部 35 条不可变 publication 审计记录。

实测 TG_TEST_WEB_INTEGRATION=1 的完整 TestPostgresMigrationAndReadiness race 通过（40.777 秒），integration vet 与 git diff --check 通过；独立临时数据库已清理。测试真实使用数据库、publication、HTTP、生成 SDK 和前端校验器；分支由测试安排，不覆盖外部 RPC 重组发现、自动业务财务对账/发布或浏览器钱包操作。B16 与全部后端目标仍保持开放。

### 2026-09-07 B11 五千市场数据库目录容量

TestDirectoryHTTPCapacity 新增 TG_TEST_DIRECTORY_MARKETS，默认 1,000、允许 200–8,000，非法或非规范整数在数据库操作前拒绝。目录名称/符号末项搜索与预期 ID 随规模计算，保留 100 条分页完整排序、无重复/遗漏、八路阶段筛选并发、manifest 失效及同 revision 恢复；补充分页 p95 日志。

实际 5,000 市场 race 运行通过（105.480 秒），快照 9,144,358 字节，身份补齐与正式 Publish 14.481 秒。真实 HTTP 完整 50 页：中位 1.415 秒、p95 1.537 秒、最大 4.934 秒；八路并发、末项搜索、失效/恢复均通过。未放宽身份查询/HTTP 超时、16 MiB 快照限制或新鲜度保护。integration vet、git diff --check 通过，独立数据库已清理。

此结果是本机合成目录容量证据，不是生产 SLA 或持续压测；后台完整补读/候选核验仍限制 1,000 市场。B11 尚缺持续负载/数据库优化、自动生产和真实部署验收，整体目标保持开放。

### 2026-09-07 B11 非 race 性能基线与 CPU 采样

完成两个真实隔离数据库目录 profile 运行：默认 1,000 市场测试 25.377 秒；5,000 市场测试 57.469 秒。后者保留全部 50 页排序/完整性、搜索、八路并发、manifest 失效/恢复断言，快照仍为 9,144,358 字节。非 race、启用 CPU profile 的分页中位 387.8 ms、p95 488.0 ms、最大 672.3 ms；身份补齐及发布 1.730 秒。该结果与先前 race 中位 1.415 秒区分记录，不将检测工具开销归结为服务固有延迟。

5,000 市场 profile 总采样 6.29 秒、覆盖墙钟 56.94 秒；Store.Load 累积 CPU 约 3.67 秒，其中 parsePersisted 约 1.96 秒。采样包括建库/迁移/发布/读取全测试，不包含 PostgreSQL CPU，不能据此直接证明 SQL 慢点。保留每次读取的 digest、canonical/freshness 和身份校验，没有引入绕过验证的缓存。README 已提供独立非 race 采样命令；SQL 执行计划、持续并发与自动生产仍未完成。

两次测试均成功结束并清理独立数据库，git diff --check 通过。本轮新增可复验性能证据与运行说明，未修改业务语义或声称 B11/整体完成。

### 2026-09-07 B11 目录数据库查询分段证据

增加 test-only directoryQueryTrace，由 TG_TEST_DIRECTORY_TRACE=1 显式启用，复用正式 pool 配置并只在目录读取阶段计时。固定 snapshot/identities 两类查询，互斥保护并发统计；只打印次数、驱动错误数与平均/最大时间，不打印 SQL/参数/连接信息。恢复校验后对捕获的真实只读 SQL 执行 EXPLAIN ANALYZE BUFFERS，报告数据库执行与缓存统计，保留传输/行消费和服务器执行的区别。

实际 5,000 市场非 race 运行通过（30.200 秒），50 页中位 414.0 ms、p95 430.7 ms、最大 463.7 ms。两类查询各 62 次，驱动错误均为 0：snapshot 平均 10.31 ms、最大 37.89 ms；identities 平均 300.73 ms、最大 400.53 ms。热态 EXPLAIN：snapshot 执行 0.052 ms/1 行，identities 执行 125.576 ms/5,000 行、shared hit blocks 55,568，无磁盘读取或临时文件。数据指向批量身份查询/消费路径为后续优化重点，不构成生产 SLA 或放宽校验的依据。

200 市场 trace 并发 race 复跑、integration vet 与 git diff --check 通过；两次数据库夹具正常清理。生产查询/校验语义未改，持续负载、自动 publication 及其余必要功能保持未完成。

### 2026-09-07 B11 批量身份共享 anchor 优化

LoadManyAt 将同批共用的 checkpoint/manifest、journal finalized、tip 与 anchor 条件集中到 materialized CTE，仍在同一 SQL statement 中读取；保留每个身份的 canonical/receipts_verified、创建不晚于 anchor、发现/token/digest 绑定和完整成员集合校验，5 秒/64 MiB/数量限制不变。测试 tracer 同时识别新 SQL 形态，不涉及迁移或生产配置。

5,000 市场非 race trace 验收通过（27.363 秒）：50 页中位 396.83 ms、p95 413.55 ms、最大 431.07 ms，八路并发/完整目录/末项搜索/失效恢复全部通过。身份查询平均 269.14 ms、最大 335.84 ms；热态 EXPLAIN planning 1.472 ms、execution 116.660 ms、shared hits 15,465。相对于前轮 300.73 ms 平均、125.576 ms execution、55,568 hits，减少重复公共状态连接成本；单次对比不能作为稳定生产性能承诺。

真实隔离 PostgreSQL + 前端 SDK 完整回归通过（39.307 秒），含 1,000 身份批量/逐项结果对照、缺失/重复/Token 错配、未知或早于创建的 anchor、manifest 错配、孤块和取消拒绝；publication/更新失效恢复也通过。独立数据库已清理。整体 B11 仍缺持续负载、自动目录生产和真实部署验收。

最终检查：readmodel/httpapi race、marketidentity/readmodel/httpapi/integration vet、全部命令构建和 git diff --check 通过。

### 2026-09-07 B11 连续八客户端读取验收

目录容量增加 TG_TEST_DIRECTORY_ROUNDS（默认 1、规范整数 1–10），八个客户端统一起跑，每客户端连续执行 rounds 次固定 revision 的 phase=1/ID 降序查询。逐次检查 synced、revision、100 项精确 ID 顺序、阶段与身份；只在全部请求成功后报告完整吞吐，任何异常均使测试失败。增加并发阶段吞吐/median/p95/max，保留随后的 manifest 失效与同 revision 恢复。

5,000 市场、10 轮非 race 运行通过（40.399 秒）：前置 50 页无遗漏/重复，分页中位 402.14 ms；并发 80 请求共 10.949 秒、7.31 请求/秒，中位 1.255 秒、p95 1.425 秒、最大 1.454 秒。没有刷新 producer/journal 时间或放宽超时。该负载为固定八客户端闭环、相同筛选页的重复读取，不是开放到达率或长时间 soak；生产负载与自动快照输入仍未完成。

200 市场/10 轮的同路径 race 复跑通过（6.205 秒），integration vet 和 git diff --check 通过；两次隔离数据库均清理。整体目标保持开放。

### 2026-09-07 B12 Curve/Pool 历史至前端校验

扩展既有 PostgreSQL analytics coverage 夹具，在受控 24 小时时间窗中启动正式 Go HTTP，生成 SDK 读取两种市场的 trades/candles，运行实际前端校验器。独立断言 Curve Quote=970000、fee=10000、tax=20000；Pool Quote=10000、internal_reward_conversion；两者 actorConfidence 均为 contract_caller_not_verified_wallet。每组 24 个小时桶首桶一笔，其余 OHLC 全 null 且成交量零，不合成价格。

响应交给另一个市场 identity 必须被两个校验器拒绝，保证错误市场数据不能通过渲染前验证。隔离数据库撤销区块 receipts_verified 后，两市场 trades/candles 均经真实 SDK 返回 503；恢复后全部断言再次通过。窗口在局部测试退出时恢复，原短窗口 Go 回归继续执行。

TG_TEST_WEB_INTEGRATION=1 的完整 TestPostgresMigrationAndReadiness race 通过（44.097 秒），integration vet、git diff --check 通过，独立数据库已清理。此轮未改前端业务实现，验证的是 HTTP/SDK/校验边界；完整 trade.html 的切换/迟到请求、真实 RPC 与生产历史负载仍未完成，B12/B16 与整体目标保持开放。

### 2026-09-07 B12 成交枚举严格类型

新增 JSON 往返反例证明 validateTradePage 原先接受 side=["buy"]（测试先以 Missing expected exception 失败）。取消 side/classification 的 String() 隐式转换，要求字段本身为字符串且属于固定枚举，拒绝数组伪装的方向/分类。回归覆盖 buy/sell 与三类 execution classification；不改变合法响应、费用或 caller 身份口径。

前端 123 项测试、生成检查、typecheck 与生产构建通过。此修复仅关闭渲染前类型校验缺口，不等于完整交易页切换/钱包/真实 RPC 联合验收。

最终真实 PostgreSQL→HTTP→SDK 集成 race 回归通过（49.464 秒），覆盖两类市场成交/K 线成功、覆盖不足 503 和恢复；隔离数据库已清理。git diff --check 通过，整体任务保持开放。

### 2026-09-07 B12/B16 成交与 K 线生命周期

新增自动浏览器夹具 history-lifecycle.html，实际导入 mountTrades/mountCandles 并使用真实浏览器 DOM。受控 fetch 故意忽略 AbortSignal，以单独验证 generation 拒绝迟到结果。首次实测在 initial render 后失败：stop 仅取消请求但残留成交表和 K 线。

修复 stop：清空表/图、市场身份与分页状态，显示暂停提示，旧响应不能重新插入；刷新按钮不再复用已暂停市场。Candles 无 identity 的早退路径同时释放 controller 引用。app.ts 的统一 pauseAnalytics 也暂停两个历史组件，覆盖页面隐藏与数据失效流程；恢复由重新选择/加载市场显式驱动。

Chrome 六项自动 DOM 断言全部 PASS：初始渲染、暂停清空、刷新不复活旧 identity、市场 A 迟到不覆盖 B、暂停后迟到无渲染、重新 setMarket 恢复。前端 123 项测试、生成检查、typecheck、生产构建与 git diff --check 通过，临时 Vite 已停止。本轮组件数据受控，未声称完整 trade.html/钱包/外部 RPC 验收；误启动的全仓测试已停止，未作为通过证据。B12/B16 与整体目标保持开放。

### 2026-09-07 B13/B16 持有人生命周期一致性

扩展 history-lifecycle.html 为成交/K 线/持有人三组件联合回归，市场 A/B 使用不同可辨认余额，逐个检查实际 DOM。首次 Chrome 运行在 initial render 后失败，确认 holder.stop 仍残留旧地址、余额、供应量及区块标签。

holder.stop 现清空列表/分页和 market identity、恢复按钮状态并提示暂停；app.ts 的统一 pauseAnalytics 同步暂停 holderWidget。三组件共用 generation 防迟到逻辑：切换市场后返回 A 数据不覆盖 B，暂停后返回的数据不恢复旧视图，刷新按钮不复用已暂停 identity，显式重新选市场可恢复。

Chrome 六项联合场景全部 PASS，前端 123 项测试、生成检查、typecheck、生产构建及 git diff --check 通过，临时 Vite 已停止。受控 fetch 不替代完整 trade.html/RPC/钱包验收；B13/B16 及整体目标保持开放。

### 2026-09-07 B17 管线 textfile 告警

新增可选 pipeline-alerts.yml 五类告警：采集器离线、成功 scrape 缺必需指标、观察超过五分钟、未来时间超过 30 秒、当前 attention。均需持续两分钟；attention 按 job/instance/chain_id 匹配新鲜时间并要求 collector up=1，避免旧文件继续充当当前异常证据。指标缺失按实例检查，多个链共享实例前需增加预期链清单规则。

九组官方 promtool 时序场景覆盖离线/两项缺失/分别缺失、过期保留文件、未来时间、异常及恢复、健康、实例隔离；默认七项 API 告警回归同时通过。Makefile monitoring-check 已纳入新规则及测试。新规则为可选文件，默认 Prometheus 配置未添加尚未部署的 collector，未安装调度或配置外部通知；生产采集与告警送达验收仍未完成，整体目标保持开放。


### 2026-09-07 候选 Staker 收益与负债覆盖

`candidate-inspect --verify-assets-rpc` 的 FeeVault 检查新增同市场、同资产的候选用户可领取收益合计上界校验：Quote/Meme 分别不得超过区块哈希固定的 Staker 负债桶（bucket 1），其他市场或 Creator/Platform/Holder 桶的余额不能补足此缺口。Gauge 仓位逐项 RPC 核验仍先于此检查。精度尾差和待处理没收允许桶内余量，不强制相等；没有增加 RPC 次数。

拒绝重复用户仓位、未知市场、缺失或错配的收益种类/资产、非规范或负数量、单项及合计 uint256 溢出，以及空市场但存在仓位的输入。回归先复现旧检查接受超额收益，再验证修复；覆盖两个市场共享 Quote、超过 JavaScript 精确整数范围、余量/恰好覆盖与受控 HTTP RPC。`go test -race ./cmd/candidate-inspect -count=1`、对应 vet、所有命令构建通过。

此检查只覆盖候选中已知仓位的下界，不证明用户/市场历史完整性、独立奖励累计复算或自动财务发布。`fullFinancialReconciliation=false` 与候选不可发布门槛保持。未执行生产部署、签名或广播。


### 2026-09-07 持久候选 FeeVault 财务一致性门槛

`ObservationStore.LoadCandidateSet` 在候选装配后、只读事务提交前新增 `verifyStoredFeeCoverage`：每个市场必须有 Quote/Meme 的 feeLiability，且资产必须有 feeSolvency；同一 FeeVault 身份、四角色桶加 forfeitureReserve、持久化 subtotal、跨市场总负债及 knownMarketLiabilitySum 必须一致，balance 必须覆盖总负债，候选 Staker 可领取合计不得超过对应桶。多余、重复、缺失及错配观察失败；数量遵守规范 uint256 字符串。检查自行复算，不以 observations.checks 布尔值作为证明。没有市场时只允许空费用观察库存。

回归包括双市场共享资产、大整数、合法盈余、各类缺失/错配、假阳性 checks，以及真实隔离 PostgreSQL 中同时重写 payload/digest/mirror 后的错误余额、总额、Staker 与 subtotal 拒绝。后者覆盖 ObservationStore 读取后的同一财务校验函数，不替代包含市场的完整 CandidateStore→RPC 联合验收。readmodel race 全包、隔离 PostgreSQL 专项、readmodel/candidate-inspect vet 和所有 CLI 构建通过。

这是观察数据之间的一致性校验，不是独立历史证明或自动发布授权；候选 publicationEligible 与 fullFinancialReconciliation 门槛不变。未增加迁移、RPC 或链上写入。

本轮追加 PostgreSQL integration race 回归通过（35.966 秒），开启 ObservationStore、candidate CLI 与前端 SDK 集成标记；该候选 CLI 夹具为无市场资产路径，不提升为完整市场财务端到端证据。


### 2026-09-07 含市场及仓位的数据库候选回放验收

扩展隔离 PostgreSQL 专项：持久化 AssetRegistered、QuoteAssetConfigAdded、TickerGardenBaselineAdded、LaunchTemplateAdded、MarketCreated、StockDeposited、PendingScheduled 的真实 ABI 编码日志、同交易回执及 receipt-set commitment、projection inputs 和市场发现记录，直接调用 `ObservationStore.LoadCandidateSet`。市场观察只通过对应 MarketCreated 的发现记录参与回放，配置/账户/Gauge 事件没有注入观察或来源行。

验证输出含 1 个市场、4 项配置、1 个本金账户、1 个仓位和 2 个 Creator epoch，并检查市场/账户/仓位的实际事件 logIndex 与 Meme 可领取值。回执标记失效、完整 payload/digest/mirror 中删除 feeSolvency、错误 Staker 桶或余额均拒绝；逐项恢复后重新读取成功。此前只有无市场资产路径的完整读取覆盖，现在增加含市场的本地日志→回执→投影回放→候选装配→费用门槛证据。

该夹具使用合成状态金额和受控日志，仅证明数据库读取/绑定/一致性门槛，不证明这些金额已由完整真实协议历史复算，也未进行此市场的 RPC 身份核验、CLI 或真实网络验收。publicationEligible 保持 false；没有更改运行时门槛或增加迁移。


### 2026-09-07 持久 Holder/Treasury 偿付门槛

`ObservationStore.LoadCandidateSet` 新增 `verifyStoredHolderSolvency`。连续分红使用 funded-paid 后的 outstanding，epoch 模式汇总已校验各 epoch 的 outstandingQuoteAmount，按 distributor+Quote 资产聚合，要求对应 treasurySolvency 恰好存在一条且身份匹配。重新核对 knownHolderMarketOutstanding、总 Quote 负债下界、Quote+Service 负债合计和 balance 覆盖，不相信 checks 标志。其他 Treasury 市场可能共享分发合约，因此 totalQuoteLiability 可以高于已知 Holder 合计；不将此局部覆盖误报为全 Treasury 历史完整对账。

覆盖 continuous/epoch 两种实际观察器导出的 golden：缺失/重复、键/资产/分发合约错配、错误合计/服务费/所需余额、余额不足、非规范数字、误导性 checks、共享及隔离分发合约、合法盈余和其他 Treasury 负债。隔离 PostgreSQL 测试纳入 treasurySolvency，验证一致 payload/digest/mirror 中余额不足拒绝及修复恢复。持久化专项通过 ObservationStore 批次读取及同一校验函数验证两种 Holder 模式；含 Holder 的完整日志回放/RPC 联合验收仍待完成。

无迁移、签名或广播；候选不可发布和独立历史证明边界保持。

验证：开启 TG_TEST_CREATOR_CANDIDATE 的 readmodel 全包 race（39.362 秒）、Holder 专项 race、readmodel/candidate-inspect vet、全部 CLI 构建与 git diff --check 通过；临时数据库自动清理。


### 2026-09-07 Holder 完整候选读取及规范区块时间上界

将 epoch/continuous 两种 Holder 观察器 golden 适配到含市场、配置、账户、Gauge 和 Creator 的隔离 PostgreSQL 回放夹具。市场创建发现及其投影输入共同绑定 creatorFeesToHolders=true，直接调用 `ObservationStore.LoadCandidateSet`；验证 Holder 模式/库存、缺失 treasurySolvency、余额不足及逐项恢复。观测身份和部分时间值按夹具修改，不代表该合成金额来自真实协议执行历史。

新 `verifyHolderCandidateTime` 绑定数据库 canonical 区块：连续模式 lastFundingAt、epoch activatedAt/requestedAt 不得晚于区块时间，epoch sourceBlockNumber 不得超过候选高度。源码确认 Treasury 的 CanonicalBlockClock 与 receipt/RPC 区块域一致。publishBy/finalizeAfter/claimUntil 是未来截止点，不按已发生时间误拒。新校验位于只读候选事务提交前；覆盖边界相等、未来、非规范字符串、缺项、合法未来截止时间及数据库未来时间/来源高度的拒绝与恢复。

这增加了含 Holder 的数据库完整读取证据；RPC 身份联合验收、来源区块哈希独立验证、epoch 时间表完整复算、真实资金历史及自动 publication 仍待完成。未新增迁移或链上写入。

验证通过：启用隔离 PostgreSQL 专项的 readmodel 全包 race（42.853 秒）、readmodel/candidate-inspect vet、全部 CLI 构建、git diff --check；临时数据库已由测试清理。


### 2026-09-07 Holder epoch 来源区块身份检查

`ObservationStore.LoadCandidateSet` 在同一 repeatable-read 事务内验证 Holder epoch 的 sourceBlockNumber/sourceBlockHash。先按高度去重并拒绝冲突，最多沿用 2048 个 epoch 的总预算，再单次批量读取 chain_blocks/chain_journal：来源必须是相应高度的 canonical、receipts_verified 且已 finalized 记录。来源在本地历史中缺失时失败，不以当前高度足够或观测字段彼此一致作为证明。

根据 Treasury 合约 reset 行为，NONE 状态的来源高度/哈希和 requestedAt 必须清空；REQUESTED 到 ROLLED_OVER 必须保留非零来源哈希。高度字符串规范化、int64 数据库域、状态范围及哈希格式均检查。连续分红没有 epoch 来源，不增加其 SQL 请求。

新增来源库存正反例与完整隔离 PostgreSQL Holder 回放中的冲突哈希、所有 epoch 共同使用错误来源哈希及恢复用例。错误共同哈希由数据库查询拒绝，不能仅靠记录间比较通过。此验证绑定本地已核验的规范链 journal，仍不等于外部独立 receipt-trie 证明或完整奖励历史复算；未开启自动 publication。

验证通过：开启隔离 PostgreSQL 专项的 readmodel 全包 race（43.616 秒）、readmodel/candidate-inspect vet、全部 CLI 构建及 git diff --check；临时数据库由测试自动清理。


### 2026-09-07 Holder epoch 时间表复算

候选 canonical 时间检查新增 `verifyHolderEpochSchedule`，按 Treasury `_currentEpochId`/`_epochWindow` 的整数公式复算当前 epoch、每个 epoch 的起止窗口，并要求已请求及后续状态的 requestedAt 不早于窗口结束且不晚于候选区块时间。激活、周期、编号及窗口溢出均拒绝；当前尚未结束的 UNREQUESTED epoch 合法。计算使用观察到的周期，周期与实际部署常量的真实性仍由 RPC 配置核验负责。

新增精确周期边界前后、窗口错位、当前编号错位、提前/未来请求、当前周期请求、uint64 溢出、零值和非规范字符串测试。完整 PostgreSQL 回放的合成 epoch 夹具调整为 50 秒周期、第一周期已请求/第二周期未请求，避免先前随意组合时间字段；50 秒只用于合成测试，不修改正式合约的 7 天周期。数据库中改变周期长度但保留窗口时必须拒绝，恢复后读取成功。

这补齐 epoch 算术关系，不证明完整请求事件历史、部署延迟参数和审核/发布流程，亦未开启自动 publication。无数据库迁移或链上写入。

验证通过：启用隔离 PostgreSQL 的 readmodel 全包 race（47.740 秒）；将数据库负例收紧为仅修改周期后的专项 race（19.208 秒）；readmodel/candidate-inspect vet、全部 CLI 构建及 git diff --check。


### 2026-09-07 Holder epoch 状态机字段一致性

候选时间检查接入 `verifyHolderEpochLifecycle`，依据 Treasury 合约请求/publish/finalize/rollover/reset 行为约束已通过类型及金额校验的 epoch：UNREQUESTED 清空请求字段；已请求记录具备非零请求者、服务费及 Quote 承诺；REQUESTED 尚无 root/领取/确认字段；ROOT_PENDING 尚无领取；root 的 dataset/leafCount/totalTwab 组合合法，空资格 root 使用合约定义的 Keccak 常量；CLAIMING 已满足确认时间且具有非空 root 与领取窗口；ROLLED_OVER 区分空资格确认与领取窗口过期两条路径。

允许请求已过期但尚未调用 expire、pending 已过确认时间但尚未 finalize、CLAIMING 已过领取期但尚未 rollover；不把自然时间推进当成链上状态自动改变。只检查可由状态推导的关系，不猜测缺失的发布时间或部署 review/claim 延迟。

新增各状态正反例和数据库候选中将 CLAIMING root 清零后的拒绝/恢复。合成完整回放 fixture 的请求者/服务费及重置记录同步调整为合法状态。此校验不是 Merkle proof、历史领取复算或 root 审核授权；自动 publication 仍未开启。

验证通过：含 PostgreSQL 专项的 readmodel 全包 race（42.582 秒）；追加数据库 root 故障用例后的状态/时间/数据库专项 race（19.635 秒）；readmodel/candidate-inspect vet、全部 CLI 构建、git diff --check。


### 2026-09-07 Treasury 历史及当前服务费资产覆盖修复

发现并先复现持久偿付门槛的兼容性缺陷：epoch 引用的非 Quote 服务费资产记录被当成多余而拒绝，删掉该记录反而通过。现在派生所有历史非零 serviceFeeAmount 涉及的 distributor+asset，要求对应偿付观察存在；REQUESTED/ROOT_PENDING 的服务费按资产求和作为 totalServiceLiability 下界。已 finalize 的历史费用已转为可提现 credit，可能全部提现，因此不继续把历史费用相加为当前未付。

观察器还读取当前 rootServiceFee 资产，即使其尚无 epoch。允许已知 epoch Treasury 的这类额外资产，但同样核对资产格式、已知 Holder 合计（无对应市场则为零）、Quote/Service 负债及余额覆盖；未知分发合约仍拒绝。当前服务费配置未被候选单独保存，故本阶段无法单独证明当前费用资产库存完整性，不将接受额外记录宣称为该完整性证明。

新增非 Quote/native 服务费、缺失记录、待付不足、多个 pending 求和、已结算并提现、当前额外资产测试，以及完整 PostgreSQL 候选中缺少历史 native 费用记录失败、添加合法零负债记录恢复。无迁移或链上写入。

验证：修复前测试复现合法记录拒绝及缺失记录误接受；修复后 readmodel 全包 race（37.203 秒），追加当前资产及完整 PostgreSQL 历史资产场景后的专项 race（22.072 秒）、vet、全部 CLI 构建和 diff 检查通过。


### 2026-09-07 Holder epoch 与 FeeVault 桶精确对账

依据 ProtocolFeeVault `_creditHolderFee`/`_debitHolderFee` 同时更新 epoch 明细与 Holder 桶的行为，`verifyStoredFeeCoverage` 新增每市场 Quote/Meme 的全部 Holder epoch 负债合计，要求与 feeLiability.holder 精确相等。两者不是 Staker claimable 的精度下界关系，不接受桶多于或少于 epoch 合计；非 epoch 的连续分红不套用该账本等式。

修复前用例已复现 Quote/Meme 错配仍通过；修复后覆盖单/多 epoch、大整数、错误金额、非规范字符串、溢出，完整 PostgreSQL 候选中仅修改 holderMemeLiability 的一致 payload/digest/mirror 也被拒绝，恢复后重新可读。没有增加 RPC、迁移或链上写入。

此项绑定已观察的 FeeVault/Holder 明细，不证明原始收费历史复算或自动财务发布条件全部满足。

验证通过：启用隔离 PostgreSQL 专项的 readmodel 全包 race（45.499 秒）、readmodel/candidate-inspect vet、全部 CLI 构建及 git diff --check；临时数据库由测试自动清理。


### 2026-09-07 当前 Treasury 服务费配置绑定

Holder epoch 观察保留同块 rootServiceFee 的 currentServiceFeeAsset/currentServiceFeeAmount，EpochHolderCandidate 携带并校验资产及非零 uint128 金额，candidate-inspect 的 Holder RPC 比较自动包括这两个字段。Treasury 偿付检查派生当前费用资产库存并要求记录存在，同一分发合约跨市场的当前策略必须一致；不再宽泛接受任意已知分发合约的额外资产。历史费用资产及未结算服务费下界继续保留。

修正数字校验以支持 uint128（不能交给只支持至 uint64 的 strconv.ParseUint）；覆盖完整 uint128 上界、溢出、非规范/零/缺失字段、当前资产记录缺失、跨市场策略冲突及 RPC 策略错配。通过真实受控 HTTP 观察器重新导出 epoch golden，未手工伪造导出字段。合成 PostgreSQL 夹具同步映射当前费用资产并通过完整读取。

无迁移或公开 API 合约变更；旧观测缺少新字段时不可作为当前候选，需重新运行观察器补读。该补读不改变日志投影语义。当前费用配置库存缺口已在候选范围内闭合，独立完整收费历史、生产运行与自动 publication 仍待完成。

验证通过：含隔离 PostgreSQL 的 readmodel 全包 race（44.752 秒）、deployment race（3.084 秒）、更新旧夹具后的 candidate-inspect race（3.891 秒）、uint128 上界专项 race、三个包 vet、全部 CLI 构建及 git diff --check。


### 2026-09-07 Holder 历史领取与候选累计对账

`LoadCandidateSet` 在已通过日志/回执身份检查的 projection input 回放中解码 TreasuryClaimed，按 distributor+market+epoch 汇总实际领取金额，最终与 Holder epoch claimedAmount 精确比较。非零累计必须有对应历史事件；同账户/leafIndex 在同 epoch 重复、零 amount/twab、错误分发合约及未知 epoch 均拒绝；沿用 100000 条输入预算并检查 uint256 合计。普通非 Holder Treasury 市场的合法领取不作为 Holder 候选输出。

完整隔离 PostgreSQL Holder 夹具加入 ABI 编码领取日志、receipt commitment 和投影输入，验证真实回放累计；保留完整回执/原始日志但删除领取投影输入并同步 input_count 时，候选仍拒绝非零 claimedAmount，恢复输入后通过。覆盖累计不符、缺失、错误 emitter、重复 leaf/account、多次合法领取、未知 epoch 和零金额。

这将本地已存回执历史与 getter 累计绑定；完整事件库存/独立 emitter 认证仍依赖原有 manifest 及历史范围证明，未将局部领取相等提升为完整独立对账或 publication 许可。无迁移、签名或广播。

验证通过：启用隔离 PostgreSQL 专项的 readmodel 全包 race（46.957 秒）、readmodel/candidate-inspect vet、全部 CLI 构建及 git diff --check；数据库由专项自动清理。


### 2026-09-07 连续 Holder 注资/领取历史对账

`LoadCandidateSet` 回放 HolderRewardsDistributorV1 的 HolderStreamFunded/HolderStreamClaimed，按分发合约+市场累计 funded/paid，并与连续 Holder 候选精确比较。注资正数、合约 uint128 累计上限、注资时间顺序、领取资产及 paid<=funded 都检查；根据事件 end-86400 复算最后注资时间。Idle restart 不被误计为新注资；同账户多次领取合法，不套用 epoch 的一次领取规则。

新增合法多次领取、遗漏注资/领取、累计及资产/合约/时间错配、超额领取、零注资与时间倒退用例。完整 PostgreSQL 连续 Holder 回放增加真实 ABI 注资日志、完整回执承诺和投影输入；保留原始日志/回执但移除注资投影输入及同步计数时拒绝，恢复后通过。该数据库夹具 paid=0；非零 paid 与重复账户领取由独立 ABI 事件回放用例验证，尚非真实链资金流程验收。

仍依赖原有历史范围/事件库存与 emitter 绑定边界，不等于完整外部状态证明；没有签名、广播、迁移或自动 publication。

验证通过：开启隔离 PostgreSQL 的 readmodel 全包 race（46.093 秒）、readmodel/candidate-inspect vet、全部 CLI 构建及 git diff --check；数据库由专项自动清理。


### 2026-09-07 连续 Holder 注册来源绑定

连续 Holder 历史回放纳入 HolderStreamMarketRegistered：同一 distributor+market 只能注册一次，市场/Token/Vault 非零且 Token 不等于 Quote；注资和领取必须在注册之后。候选 Meme/Quote 必须与注册事件身份相同，领取资产也必须等于注册 Quote。已注册但尚无资金的市场可以合法返回零 funded/paid/lastFundingAt。

完整 PostgreSQL 回放增加独立注册日志及回执承诺，保留原始回执/日志但分别删掉注册或注资 projection input、同步 input_count，均拒绝；恢复相应输入后通过。新增重复/缺失注册、候选 Token 错配、零资金注册等单元覆盖。仍没有独立证明注册 Vault 的部署身份；RPC/manifest 绑定及完整历史范围信任边界不变，不标记自动可发布。

验证通过：含隔离 PostgreSQL 的 readmodel 全包 race（46.259 秒）、注册零资金补充专项 race、readmodel/candidate-inspect vet、全部 CLI 构建及 git diff --check。


### 2026-09-07 Holder 事件与区块时间/领取索引边界

候选回放 SQL 同时读取每条输入所属 canonical 区块的 block_timestamp，连续注资事件要求 end-86400 恰好等于该时间；不能仅靠事件推导的 lastFundingAt 与候选 getter 相等来通过。保留注资时间单调性及候选区块时间检查。epoch 领取历史另外保留最大 leafIndex，并要求小于相应 epoch 的 leafCount，复现 Treasury 合约索引范围检查。

新增首笔注资时间不匹配及 leafIndex 等于 leafCount 的拒绝测试，多笔合法领取按正确 leafCount 继续通过。完整 PostgreSQL 用例同时更新区块时间和 Creator observedAt（避免由旧 Creator 时间检查提前拒绝），但保留原注资 end 与 lastFundingAt，仍必须失败；恢复区块时间和观测后通过。

无新增 RPC 或迁移，只在既有只读回放查询增加区块时间列。未验证 Merkle 路径本身，完整部署/事件库存认证与自动 publication 仍待完成。

验证通过：启用 PostgreSQL 的 readmodel 全包 race（44.026 秒）、补充区块时间数据库负例后的专项 race（23.590 秒）、vet、全部 CLI 构建和 git diff --check。


### 2026-09-07 epoch 历史领取时间窗口

TreasuryClaimed 回放接收同一 SQL 结果中的 canonical block_timestamp，保留每 distributor+market+epoch 的最早/最晚领取时间，并要求不早于 finalizeAfter、不晚于 claimUntil。截止时间相等仍合法，符合合约 `block.timestamp > claimUntil` 才拒绝的条件。另拒绝 account 等于分发合约自身的领取，复现 Treasury claim 的地址限制。

新增确认下界/截止上界相等、提前/逾期、自身领取用例。完整 PostgreSQL 回放中将仍为 CLAIMING 的 claimUntil 设为事件时间 100 时成功，设为 99 时失败，恢复 200 时成功；该负例不依赖状态机自动结转或当前时间判断。没有新增 RPC、数据库迁移或广播。

finalizeAfter 只是可确认的时间下界，不是实际 RootFinalized 事件时间；完整 root 发布/确认事件顺序及 Merkle 路径认证仍待完成，不提升 publication 许可。

验证通过：启用隔离 PostgreSQL 的 readmodel 全包 race（47.982 秒）、readmodel/candidate-inspect vet、全部 CLI 构建和 git diff --check。


### 2026-09-07 Holder 实际 RootFinalized 与领取顺序绑定

Treasury 回放纳入 RootFinalized，按 distributor+market+epoch 保留确认 root、claimUntil 和实际确认区块时间；领取必须在已观察确认之后，且 root 非空资格领取截止点。CLAIMING/ROLLED_OVER 候选必须匹配确认事件的 root/claimUntil，实际确认时间不能早于 finalizeAfter；其他状态不得残留确认记录。拒绝重复确认、未确认先领取、空资格确认后领取、候选改写 root/截止字段。

完整 PostgreSQL fixture 增加实际 RootFinalized ABI 日志，位于同块领取之前；在原始回执仍完整的情况下删掉确认投影输入并同步计数，候选拒绝，恢复后成功。早期仅比较时间界限时允许单独将 claimUntil 改为 100 的合成测试，现在必须拒绝，因为实际确认事件声明的是 200；精确截止边界继续由独立 ABI 回放测试覆盖。

这绑定实际确认及后续领取，尚未证明 RootRequested/RootPublished/取消与重试的完整事件链或 Merkle 路径。未增加迁移、RPC、签名或自动 publication。

验证通过：含 PostgreSQL 的 readmodel 全包 race（50.320 秒）、新增实际确认顺序用例专项 race、readmodel/candidate-inspect vet、全部 CLI 构建及 git diff --check。


### 2026-09-07 Holder RootPublished、取消与确认绑定

候选历史回放纳入 RootPublished 与 PendingRootCancelled：确认必须有尚未取消的发布，root 一致且实际确认时间达到发布的 finalizeAfter。发布的审核截止必须晚于实际发布区块时间；ROOT_PENDING/CLAIMING/ROLLED_OVER 候选逐项绑定 root、datasetHash、totalTwab、leafCount、finalizeAfter，并核对发布时间处于候选 requestedAt/publishBy 区间。拒绝重复发布、空/非空资格与确认截止不匹配；空资格须使用合约哨兵 root。取消清除待确认发布，允许后续重发，已确认 root 不可取消。

新增独立 ABI 单测覆盖发布缺失、内容不一致、审核时间、取消重发、空资格及 pending 状态。完整 PostgreSQL Store 夹具扩展早期块中的发布与较晚块中的确认/领取；删除发布 projection input 并同步 input_count 后仍拒绝，恢复后成功。这是合成的本地回执历史校验夹具，不是 EVM 执行或真实链上协议生命周期证明。

尚未绑定 RootRequested/RootRequestExpired 及取消退款和重新申请的完整生命周期，未验证部署审核时长参数或 Merkle 路径。没有新增迁移、RPC、签名、广播或 publication 许可；B11/B12/B13/B14/B16 仍为第一版必要功能。

验证通过：含隔离 PostgreSQL 的 readmodel 全包 race（46.500 秒）、新增发布专项 race（1.537 秒）、readmodel/candidate-inspect vet、全部 CLI 构建和 git diff --check。


### 2026-09-07 Holder RootRequested、过期与重新申请绑定

历史回放增加 RootRequested/RootRequestExpired。发布必须有有效申请，实际发布区块时间位于申请至 publishBy 的闭区间；申请必须在 epoch window 结束之后（含边界），拥有非零 quoteAmount/serviceFeeAmount/requester/source hash，publishBy 晚于实际申请区块时间。候选非 UNREQUESTED 状态逐项绑定实际请求的 requestedAt、requester、window、sourceBlockNumber/hash、quoteAmount、服务费资产/金额及 publishBy；UNREQUESTED 不得残留申请。重复申请拒绝。

过期必须严格晚于 publishBy，且还未发布，事件 requester 必须等于原申请者。过期和 PendingRootCancelled 均清除申请；取消后仅重发不再合法，必须先有新的 RootRequested。这纠正了上一阶段仅清除 publication 的不完整状态机。历史服务费资产不能通过额外 solvency 行改写：完整 Store 测试现要求这种伪造仍被拒绝。

PostgreSQL 合成历史夹具加入真实 ABI 格式请求日志，位于发布之前；保持完整原始回执并删除请求投影、同步计数后，候选仍拒绝，恢复通过。独立 ABI 测试覆盖字段绑定、重复/缺失申请、过期边界、错误申请者、发布后过期、过期重试以及取消后缺少新申请。夹具仍是受控本地历史，不是完整 EVM 执行证据。

尚未核验取消/过期形成的 service credit 与实际提款，也未绑定部署 finalityDelaySeconds/Blocks、rootPublicationWindow/rootReviewDelay 的确切参数或申请当时 canonical source 的时钟关系；当前 source 校验仍以现有候选 canonical block 范围为准。Merkle proof 和完整 financial reconciliation 继续未完成，publicationEligible=false。没有迁移、广播或生产配置变更。

验证通过：含隔离 PostgreSQL 的 readmodel 全包 race（49.736 秒），申请/发布专项 race（1.633 秒），readmodel/candidate-inspect vet、全部 CLI 构建及 git diff --check。


### 2026-09-07 Holder 服务费历史负债下界与提款总额

Treasury 历史按 distributor+asset 累计 RootRequested 收取的服务费，RootFinalized/PendingRootCancelled/RootRequestExpired 仅将金额转为可提款总额，不消除总负债。ServiceCreditWithdrawn 必须为正数，且不超过历史收取剩余额及已转为可提款的余额；提款后同步扣减这两项。候选 treasurySolvency.totalServiceLiability 不得低于累计收取减累计提款，相关历史资产缺少观察时失败。此检查已接入 ObservationStore.LoadCandidateSet。

单测覆盖 pending/确认/取消/过期、重新申请后旧退款债务保留、提款、尚不可提款、超额/重复/零额提款、观察缺失和负债不足。PostgreSQL 回放在确认后将服务费负债改为零，同时调整 requiredBalance 保持余额公式正确，仍必须失败；恢复真实观察后通过。

这是分发合约/资产维度的总额约束，尚未按 beneficiary 认证 serviceCredit（确认收益还需绑定 rootServiceTreasury），也不证明真实代币/原生币转账。对未纳入历史的其他 Treasury 市场保留负债下界，不宣称精确全账对账；历史范围或历史服务费资产观察不完整会拒绝候选，旧资产发现/观察仍需继续补齐。申请时 source clock、部署参数和 Merkle proof 仍未完成，publicationEligible=false。没有新增迁移或生产发送。

验证通过：含隔离 PostgreSQL 的 readmodel 全包 race（46.938 秒）、Holder 历史专项 race（1.753 秒）、readmodel/candidate-inspect vet、全部 CLI 构建及 git diff --check。


### 2026-09-07 Holder 服务费提款归属与 immutable 金库观察

Epoch Holder observer 在同一区块哈希下读取 rootServiceTreasury()，拒绝读取失败、零地址及分发合约自身地址；字段写入 holderMarket 和 EpochHolderCandidate，并参与已有 RPC 候选深度比对。同一 distributor 的多个 Holder market 必须使用相同金库。旧观察缺字段会失败，需要重新观察；连续奖励模式不增加该读取。已通过 observer 重新导出 epoch golden。

服务费历史记录确认/取消/过期的 credit 归属及提款顺序。确认归属观察到的 immutable rootServiceTreasury，取消/过期归属原 requester。按 distributor+asset+beneficiary 回放，每次 ServiceCreditWithdrawn 必须等于该收款人当时的完整信用余额，防止总额足够时仍冒领他人退款、申请人提走金库收入或只提一部分（合约 withdrawServiceCredit 为全额提款）。总额下界校验继续保留。

新增归属/部分提款/正确金库提款专项测试、observer 金库缺失/零/自身地址测试、RPC 候选金库变更拒绝测试。当前归属仍基于候选观察及现有 RPC 验证范围，不是独立存储证明；尚未将未提款 credit 与 serviceCredit(asset,beneficiary) 实时读值逐项核对，也未证明实际资金转账或补齐取消历史遗留资产的观察。publicationEligible=false，没有新增迁移或广播。

验证通过：readmodel（含隔离 PostgreSQL，50.884 秒）、deployment（4.936 秒）、candidate-inspect（8.475 秒）三包全量 race；对应 vet、全部 CLI 构建、observer golden 导出与 git diff --check。


### 2026-09-07 serviceCredit 同哈希 RPC 核对

服务费回放在归属与负债检查通过后导出稳定排序的 ServiceCreditCandidate 清单（distributor/asset/beneficiary/amount），已提款的零余额仍保留。ObservationStore.LoadCandidateSet 生成清单及 serviceCreditHistoryVerified；该标记仅代表配置范围内的本地历史回放，不是独立事件认证或完整链上枚举。直接 BuildCandidateSet 不会赋予该标记。清单超过 4,096 项失败，不能截断后当作完整结果。

candidate-inspect 的资产 RPC 验证阶段，在 Holder distributor/immutable 金库比对后逐项读取同一 blockHash 的 serviceCredit(address,address)，要求与回放余额精确相等；最后沿用已有 finality/header 再检查。Epoch Holder 缺本地历史标记、重复/未知分发合约/非法地址或金额、预算超限、RPC 失败/畸形 ABI/余额差异均失败。未新增可发布开关。

PostgreSQL 全回放验收确认实际导出一条服务金库 credit=1；历史专项测试验证 pending 不产生 credit、取消重试保留旧退款及零余额输出。RPC 测试覆盖超过 JS 安全整数的金额、零余额、读取失败、ABI/区块/重复/预算/归属等失败路径。

该步骤验证已回放库存中的实时信用余额，不证明未知收款人不存在，也不证明实际转账。取消后遗留的历史服务费资产仍需补齐发现与偿付能力观察；申请时 source clock、部署参数、Merkle proof 及完整财务/生产发布门槛继续未完成。没有迁移、生产配置修改或广播。

验证通过：readmodel（含隔离 PostgreSQL，52.344 秒）与 candidate-inspect（4.296 秒）全包 race；serviceCredit RPC 专项 race（1.592 秒）；相关 vet、全部 CLI 构建和 git diff --check。


### 2026-09-07 历史服务费资产发现与偿付能力观察

projection-worker 从保留的 RootRequested 投影事件提取去重的 distributor/serviceFeeAsset 清单，并加入 Holder observer。查询绑定 chain_id，只使用 canonical 且 receipts_verified 的源块；超过 4,096 项失败。当前费率/epoch 清零不再是资产发现的唯一依据。Observer 对匹配当前 Treasury distributor 的历史资产同哈希读取 totalQuoteLiability、totalServiceLiability 和余额，合并去重到 treasurySolvency；连续分发机制不增加 epoch Treasury 读取。

候选 StoredHolderSolvency 仅在历史请求回放证明资产存在时接受额外资产库存，并继续要求完整观察和余额覆盖。缺历史依据的额外资产、缺少旧资产观察或旧资产余额不足仍拒绝。candidate-inspect 从已回放 serviceCredits 提取历史资产，传入既有独立 Holder 观察/检查路径，避免 RPC 复核再次遗漏退款资产。

新增 observer 测试覆盖旧 ERC20 费资产、缺余额、余额不足、目标非法与预算；readmodel 测试覆盖有/无历史依据的资产库存及漏项；真实 PostgreSQL（全部迁移）测试验证请求去重、源块 canonical/receipts_verified 过滤。初始 DB 夹具缺少 chain/discovery/projection 初始化记录导致失败，已按真实外键与链约束修复并通过；没有放宽生产逻辑。

这是已投影请求范围的发现，不证明历史请求完整或未知独立 Treasury 全库存，也不是完整取消→链上退款→生产发布的 EVM 联合验收。申请时 canonical source clock、部署参数、Merkle proof、完整生产财务门槛继续未完成。没有迁移、广播或生产配置变更。

验证分别通过：含隔离 PostgreSQL 的 readmodel race（49.034 秒）、deployment race（6.846 秒）、candidate-inspect race（8.993 秒），修复夹具后的 projector PostgreSQL race（2.591 秒）；相关 vet、全部 CLI 构建和 git diff --check。


### 2026-09-07 Treasury 部署时序参数与历史窗口绑定

同哈希 Holder observer 新增 finalityDelaySeconds、finalityDelayBlocks、rootPublicationWindow、rootReviewDelay、claimWindow 五项 immutable getter；拒绝零参数和 finalityDelayBlocks>255，保留合约 uint32/uint16 ABI 边界。字段加入 EpochHolderCandidate 并参与现有 RPC 深度比对；旧观察缺字段须重新采集，连续奖励不增加这些读取。已从 observer 重新生成 epoch golden。

历史另保存每次申请/发布/确认的时序检查，取消/过期重置不能擦除旧尝试。实际申请时间距 windowEnd 至少 finalityDelaySeconds；publishBy-requestedAt 必须等于 rootPublicationWindow；finalizeAfter-实际发布时间必须等于 rootReviewDelay；非空资格的 claimUntil-实际确认时间必须等于 claimWindow。空资格确认仍允许 claimUntil=0。同一 distributor 跨市场的参数必须一致，使用先比较后减法避免 uint64 溢出。

单测覆盖各窗口差异、申请等待不足、空资格、非法/冲突参数与遗留历史尝试。完整 PostgreSQL Store 用例分别篡改等待秒数、发布窗口、审核期、领取期后拒绝，恢复通过；observer 和 RPC 候选测试增加非法参数及政策差异。

已检查 CanonicalBlockClock：本项目 Nitro 链通过 ArbSys 使用与 canonical RPC/receipt 一致的 L2 区块域。此阶段 finalityDelayBlocks 仅读取/验证范围，尚未与每次请求事件区块和 sourceBlockNumber 的精确差值绑定，也未完成完整请求时 source hash/EVM 生命周期验收。Merkle proof、完整财务与生产发布门槛继续未完成，publicationEligible=false。无迁移或生产发送。

验证通过：readmodel（含隔离 PostgreSQL，64.905 秒）、deployment（3.996 秒）、candidate-inspect（4.587 秒）三包全量 race；对应 vet、全部 CLI 构建、observer golden 导出及 git diff --check。


### 2026-09-07 请求区块与历史 source 身份绑定

RootRequested 回放保留每次实际 canonical receipt 区块号、sourceBlockNumber/hash 和 distributor。校验 requestBlock>finalityDelayBlocks 且 sourceBlockNumber=requestBlock-finalityDelayBlocks；使用先比较后减法。请求日志区块号要求规范 hex，存储范围限定 int64 可表示区块。全部尝试均保留，包括后来取消/过期的记录。

候选同一事务内的 source block 查询合并当前 epoch 和历史请求来源；即使 epoch 已清零，仍要求原 source hash 对应数据库中 canonical、receipts_verified 且处于 finalized 范围的块。冲突 hash、缺块或不匹配均失败。

重构完整 PostgreSQL 夹具为三块：第 1 块创建/config/账户事实，第 2 块请求与发布（source=1），第 3 块确认与领取；不再把请求放在合成 genesis 块。修正测试 persist 闭包固定使用初始 hash 的问题，现使用传入 batch 身份。夹具仍是合成 ABI/回执，并非实际 EVM 生命周期重放。临时错误定位代码已移除。

新增未来/错误差值/过早块及遗留请求单测，数据库验证修改 finalityDelayBlocks 会失败、恢复成功；直接同事务查询验证清零 epoch 的遗留来源及错误/缺失 hash。该项完善本地历史与 observed immutable 参数的一致性，仍不等于独立 receipt trie 或完整部署身份/EVM 联合证明。Merkle proof、完整财务及生产发布门槛继续未完成，publicationEligible=false。无迁移或广播。

验证通过：readmodel 全包 race（含隔离 PostgreSQL，57.914 秒）、时序/区块专项 race（4.157 秒）、readmodel/candidate-inspect vet、全部 CLI 构建及 git diff --check。


### 2026-09-07 候选 root 产物与历史领取 Merkle 绑定

ObservationStore.LoadCandidateSet 导出已回放的已知 epoch Holder TreasuryClaims（distributor/market/epoch/index/account/TWAB/amount）及独立 treasuryClaimHistoryVerified 标记。该标记代表本地配置范围内领取历史检查，不是独立链上证明。未将未知独立 Treasury 的领取混入已知 Holder 清单。

candidate-inspect 的 --verify-assets-rpc 阶段新增 mandatory Treasury artifact 检查：对每个当前 ROOT_PENDING/CLAIMING/ROLLED_OVER epoch 从现有 treasury_candidates 查询产物，复用 CandidateStore 的 digest、canonical source/request 及生成结果核验，再将确定性数据集绑定到候选 chain/distributor/market/epoch/token/eligibility/window/source/quoteAmount/root/datasetHash/TWAB/leafCount。逐笔历史领取匹配叶子 index/account/TWAB/amount，重新计算 HashLeaf 并验证 Merkle 路径。缺产物、上下文/root/数据集不一致、未知领取或叶子不匹配都会失败；空资格数据集亦纳入检查。

最多 2,048 个 root、100,000 条领取，沿用 CLI deadline；校验后再运行 static/finality 检查。成功输出新增 treasuryDatasetsAtCandidateVerified，仍保持 fullFinancialReconciliation=false、publicationEligible=false。只读候选生成本身不强制具备产物，资产验证模式会因缺产物失败，不能静默跳过。

测试复用全部六组 Treasury golden（含空资格），覆盖缺产物、错 root/域、篡改产物、领取金额/索引/未知 epoch 及缺历史标记。初始空资格篡改测试把 0 改成 0，已修正为确实改变字段后通过。完整 PostgreSQL 回放验证领取清单与标记输出。

当前检查保证已保存确定性产物与已知候选 root/领取一致，不证明 Transfer 输入完整、未知市场不存在或实际资金转账，也未完成真实 EVM→DB→CLI 全链路验收。生产发布门槛继续未完成；没有新增迁移或广播。

验证通过：readmodel 全包 race（67.696 秒）及最新领取导出 PostgreSQL 专项 race（46.874 秒）；treasury 全包 race（4.556 秒）；修正用例与独立标记后的 candidate-inspect 全包 race（4.365 秒）；相关 vet、全部 CLI 构建及 git diff --check。


### 2026-09-07 Treasury 产物保存/读取重验 Transfer journal

此前 validateCandidate 能验证产物摘要和确定性计算，checkCandidateSource 只验证 source/request 块仍 canonical；不能证明产物 Transfer 列表仍与当前 journal 相同。将 LoadJournalInput 拆为保留原接口的事务包装与内部 loadJournalInputTx，SaveCandidate/ReadCandidate 在自身 snapshot 内重新加载创建至 source 的完整既有历史校验，并逐项比较 Input（含 Transfer）及 JournalEvidence。RootRequestVerified 继续由原请求校验负责，不让历史加载器自行提升该标记。

保存使用 RepeatableRead 并保留链级排他 advisory lock，读取沿用 RepeatableRead/只读并复用历史 shared lock；没有嵌套连接/事务。伪造 Transfer 后重算出自洽数据集不能保存；保存后日志与回执不一致不能读取；恢复原历史后可再次读取。ProofService、review/lifecycle 与 candidate-inspect 的既有 CandidateStore 读取路径因此同时受保护。

PostgreSQL 集成新增自洽伪造输入、历史日志篡改/恢复和等价 JSON 输入用例。初次测试因把 JSONB 当 bytea 拼接失败，已修正测试写入方式；生产校验未放宽。使用全量迁移的 TestPostgresMigrationAndReadiness 已通过，涵盖现有 Treasury job/review/lifecycle 流程。

该检查仍验证本地 journal/discovery/receipt-row 的一致性，不构成独立 receipt-root 证明，也不保证远端 Transfer 历史无遗漏。重复扫描较大历史的性能仍需生产负载验收。完整财务与生产发布门槛未完成，fullFinancialReconciliation/publicationEligible 保持 false；没有迁移、广播或生产配置变更。

验证通过：Treasury 全包 race（4.160 秒）、candidate-inspect 全包 race（7.015 秒）、PostgreSQL 全迁移/就绪与现有集成 race（41.991 秒）；相关 vet、全部 CLI 构建及 git diff --check。


### 2026-09-07 候选区块 RPC 回执根校验

chainrpc.VerifyReceiptRoot 读取完整区块头并重算 header hash，按区块交易顺序获取所有回执，验证身份、索引、状态、日志 bloom 与累计 gas，再以回执共识编码重建 trie 并比较 receiptsRoot；结束时按区块号复查 canonical hash。上限 16,384 笔、累计回执 JSON 64 MiB，并受调用方 deadline 限制。缺失、编码不支持、数据差异或重组均失败。

candidate-inspect --verify-assets-rpc 在 Treasury 产物核验后执行此检查，随后再次运行既有 static/finality 检查；成功输出 candidateReceiptRootVerified。该标记仅表示本次从 RPC 取得的候选块回执与其完整区块头一致，**不表示数据库 journal 已逐项绑定到这些回执、不覆盖所有历史块，也不通过独立节点或共识认证区块头**。交易 hash 元数据尚未通过 transaction trie 认证。历史 JournalEvidence.ReceiptRootVerified 仍保持 false；fullFinancialReconciliation、independentEmitterAuthentication 和 publicationEligible 不提升。

支持现代 legacy、Ethereum 类型 1–4 及 Nitro 0x64/65/66/68/69/6a 编码；0x78 和未知类型明确拒绝。legacy JSON 可省略 type；类型化回执省略 type 后根不匹配仍失败。Nitro 编码依据官方 fork 的 core/types/receipt.go（https://github.com/OffchainLabs/go-ethereum/blob/master/core/types/receipt.go）；不据此宣称所有 Nitro 版本均兼容。trie 引入现有 go-ethereum 的间接依赖，go mod tidy 未升级直接依赖或 Go 工具链。

单测覆盖 legacy/typed/Nitro/空块、错误 root/header/branch/bloom/gas、重组、未知类型与缺失 typed type。测试网只读 live 检查通过：block=0x6d41038，hash=0x34b960a61ad3027308acb82730d3cdab42b159778df7ea0f0a8dd2ecd813c3c0，receiptsRoot=0x34f976f30b166718f7a2d28e20fabeb0743f218e0e4261e73b05ae592082a08f，2 笔回执。此为单块兼容性证据，非生产全链路验收。

验证通过：chainrpc 全包 race（2.531 秒）、candidate-inspect 全包 race（4.299 秒）、上述 live race（3.534 秒）、相关 vet、全部 CLI 本机及 Linux amd64/CGO_DISABLED 构建。没有迁移、交易发送或部署。后续仍需历史 receipt commitment 与本地 journal 的完整绑定及生产负载验收。


### 2026-09-07 索引入库绑定 root-verified 回执集合

VerifyReceiptRoot 现在同时返回通过回执根验证的简化 Receipt 集合的 ReceiptSetCommitment。新增 RootVerifiedClient，先取得现有完整 observation（逐笔回执与 filter logs 交叉比对），再独立读取完整区块头/回执重算 receiptsRoot，要求两次回执集合的有序摘要及数量完全相同。任一差异返回错误，不向 journal 提供可入库 observation。cmd/indexer 的实际 RPC 装配已切换此 wrapper，保留现有链身份、入库事务、checkpoint 与末尾区块复查。

正常 legacy/typed/Nitro/空块经过 wrapper 的测试通过；专门模拟第一次回执 status=0、第二次 root-valid 回执 status=1，确认返回集合差异错误，而不是仅验证第二份数据后放行第一份。真实测试网的只读 live 测试同时执行 wrapper 并比较摘要，通过 block=0x6d41038（2 笔回执）。

本项约束新索引及实际重观察的块，不对既有 receipts_verified 历史标记追认 root 验证，也未增加数据库 root-proof 持久化字段或历史自动补验队列。journal RPC 接口仍可由测试替身实现，不能把现有合成 PostgreSQL 夹具当作真实回执根证明。独立共识/transaction trie、历史全量补验及生产吞吐验收仍未完成。双次读取增加 RPC 成本，沿用索引单步 60 秒超时，失败不推进 checkpoint。

验证：chainrpc 全包 race 2.470 秒；live wrapper race 10.899 秒；相关 vet、全部 CLI 构建和 git diff --check 通过。未改变迁移或发布资格。

补充回归：隔离 PostgreSQL 的 TestPostgresMigrationAndReadiness race 通过（43.754 秒），覆盖现有迁移、journal 与业务集成；其合成 RPC 夹具不替代上述真实链 wrapper 验证。


### 2026-09-07 回执根证据持久化与历史补验

新增迁移 00067_receipt_root_evidence（迁移总数 67）：chain_blocks 保存 receipts_root 与 root_receipt_set_hash，要求两者同时存在或同时为空，且证据摘要必须等于该块 receipt_set_hash。旧记录保持 NULL，不按 receipts_verified 自动追认；新增 canonical 缺证据块的部分索引。迁移包含回退 SQL。

RootVerifiedClient 将通过密码学回执根验证并与 observation 比对后的 RootProof 附在 observation 上。journal 入库验证 proof 的 blockHash、root 格式、回执数量及集合摘要，并与区块/回执在同一事务保存；没有 proof 时保存空证据。cmd/indexer 显式开启 RequireReceiptRoot，缺 proof 拒绝推进，缺证据历史块按区块号逐块优先补验。补验沿用原历史日志比对、已有摘要比对和 canonical 复查，失败不覆盖既有记录或移动检查点。低层 journal RPC 接口及默认配置保留合成测试用途，不把自报 proof 当成密码学验证器。

新增 PostgreSQL 测试覆盖无证据、错摘要拒绝，四块历史依次补验且 tip 不动，最终 idle，以及数据库拒绝保留 root 证据时修改回执摘要。测试使用明确标注的合成 proof 验证持久化/调度；真实编码仍由 chainrpc 测试与上一轮真实 RPC wrapper 验证覆盖。chainrpc wrapper 测试另检查返回的附带 proof 完整一致。首次全迁移运行因旧升级数量断言 9 失败，已更新为 10（从版本 57 升级至 67）；生产校验未放宽。

此项完成补验机制及证据存储，不表示已对某个真实部署数据库完成全历史补验。下游 Treasury/候选的全范围证据门槛尚需接入，独立共识、transaction trie 和生产吞吐仍未验收；publicationEligible 保持 false。没有对生产数据库执行迁移、部署或广播。

验证通过：chainrpc 全包 race（3.917 秒），附带 proof 专项 race（1.574 秒），67 项迁移及 PostgreSQL 集成 race（52.024 秒），相关 vet、全部 CLI 构建和 git diff --check。


### 2026-09-07 Treasury 历史回执根覆盖与产物消费门槛

LoadJournalInput 在既有完整区块/receipt-row/Transfer 回放中读取 receipts_root、root_receipt_set_hash 和 receipt_count，逐块重算所有简化回执的有序摘要，核对数量及摘要；空块亦使用空集合摘要校验。有证据却与实际行不一致时直接失败；缺少证据的块允许生成未验证候选，但整个创建块至 source 区间全部覆盖后才设置 JournalEvidence.ReceiptRootVerified=true。

新增 ReceiptSetAccumulator 与 ReceiptSetCommitment 共享编码规则，流式处理当前块，不保留全历史回执；保留每块 16,384 笔/32 MiB 集合预算及 Treasury 既有整体扫描预算。SaveCandidate/ReadCandidate 允许 root-covered 证据，并通过现有同事务历史重读验证，不能靠产物内自报 true 获得通过。历史补验使证据由 false 变为 true 后，原不可变产物须重新生成保存；读取时不会静默修改内容寻址产物。

candidate-inspect --verify-assets-rpc 对已发布 epoch 的 Treasury 产物新增 ReceiptRootVerified 必需条件；缺少全区间 root 覆盖不能通过产物检查。其范围是各 Treasury 产物的创建至 source 历史，不是整个协议的请求/发布/领取历史全覆盖，也不认证独立共识或 transaction trie；fullFinancialReconciliation/publicationEligible 保持 false。

测试覆盖六组 Treasury golden 缺历史 root 标记拒绝，数据库部分覆盖 false、完整覆盖 true、保存读取 root-covered 产物，以及空块额外插入无日志失败回执时拒绝加载/读取，恢复后再次通过。首次 PostgreSQL 用例因先前缺铸币测试只恢复数据库、未恢复内存 receipt.Logs 导致预期摘要错误，已修正夹具；未放宽生产逻辑。数据库 root 值是合成测试证据，不宣称其为真实 trie 证明。

验证通过：chainrpc 全包 race（3.500 秒）、Treasury 全包 race（2.026 秒）、candidate-inspect 全包 race（7.107 秒）、修正夹具后 PostgreSQL 集成 race（39.573 秒）、相关 vet、全部 CLI 构建及 git diff --check。本轮无新增迁移、生产配置或广播。


### 2026-09-07 候选完整回放区间的回执根覆盖

ObservationStore.verifyCandidateHistory 在原有连续区块、完整回执摘要及双向日志比对的同一 RepeatableRead 事务内，检查每块 receipts_root/root_receipt_set_hash 与 receipt_set_hash 一致。只有配置 StartBlock 至候选块全部具备证据、且实际数据库回执摘要重算通过，才返回完整覆盖。缺证据允许导出未验证候选，证据矛盾或任何历史不完整仍失败。

CandidateSet 新增 historyReceiptRootsVerified 与 historyStartBlock，明确覆盖起点。candidate-inspect --verify-assets-rpc 在资产 RPC 读取前强制检查该标记与区间；不能以当前候选块单独 receiptsRoot 成功替代历史覆盖。该范围包含原回放中的 RootRequested/RootPublished/RootFinalized/TreasuryClaimed 及服务费事件。静态 RPC 模式与普通候选导出不提升此标记。

三块 epoch PostgreSQL 夹具新增未覆盖、仅候选块覆盖、完整覆盖、单独移除请求/发布块证据的测试，确认只有完整覆盖返回 true，且 publicationEligible 仍 false。测试 root 是合成值，用于验证数据库消费与区间逻辑；真实 trie 编码验证在 chainrpc 路径完成。CLI 另覆盖缺标记、反向区间和非规范块号拒绝。

此项验证已配置区间的持久化证据与实际回执/日志一致，不证明配置起点涵盖所有部署历史、独立共识或交易 hash 元数据，也不替代完整财务对账和实际部署联合验收。没有迁移、部署或广播。

验证通过：readmodel 全包 race（含隔离 PostgreSQL，66.105 秒）、candidate-inspect 全包 race（5.667 秒）、对应 vet、全部 CLI 构建与 git diff --check。


### 2026-09-07 候选历史起点前的 manifest runtime 检查

CandidateSet 从同一数据库快照导出 historyStartHash。candidate-inspect --verify-assets-rpc 在原历史回执根覆盖门槛后读取该起点的 RPC 区块，并要求哈希一致；起点大于零时，读取前一块，核对父子关系，按前一块 hash 对全部 manifest 合约地址执行 CodeAt，要求运行代码为空。结束时复查起点及前一块身份；历史状态不可用、非空代码、读错区块或重组均失败。起点为 genesis 时要求与 manifest genesis 一致，不做减一操作。成功输出 historyOriginChecked；静态模式不执行此检查。

测试覆盖两地址全量查询、第二地址已有代码、历史状态裁剪/错误、父块/起点差异、重组、缺历史根覆盖和 genesis 边界。此检查能拒绝截在仍有合约代码之后的历史起点，但不能排除较早已销毁后重部署的实例，也不是部署交易/initcode 或独立共识证明。manifest 仍是操作者输入；完整部署身份和生产财务联合验收继续未完成，publicationEligible 保持 false。

同步更正后端 README 与本清单中先前简写错误的 CLI 参数：实际支持的资产检查参数为 --verify-assets-rpc。没有新增迁移、广播或部署。

验证通过：candidate-inspect 全包 race（5.125 秒）、readmodel 全包 race（含隔离 PostgreSQL，97.084 秒）、相关 vet、全部 CLI 构建与 git diff --check。


### 2026-09-07 B17 历史回执根补验监控

operations.Load 在同一只读 snapshot 中统计当前链 canonical 已存区块缺失 receipts_root 的数量，导出 nullable receiptRootMissing。无 journal tip 时保持未知，非零产生 receipt_root_backfill_pending；未知/非法分别产生 coverage_unknown/coverage_invalid 告警。现有 pipeline attention 规则消费这些状态，不需新增并行告警配置。

Prometheus 新增 tickergarden_pipeline_receipt_root_missing_blocks；未知时省略而非输出零，负数拒绝编码。指标只统计已存区块，不能证明未入库历史不存在、receipt-root 独立共识真实性或生产就绪。使用迁移 67 的已有字段/部分索引，无新增迁移。

新增单测覆盖未知、零、正数和负数的告警/指标；现有 PostgreSQL journal 用例增加初始一个缺项与四块补验结束后的零缺项查询，验证孤块不计入 canonical 统计。未安装生产采集器或部署服务。

验证：operations race 通过（1.748 秒），PostgreSQL 集成 race 通过（42.763 秒）。指标测试首次因缺少必需四阶段夹具失败，补齐后通过；生产编码约束未放宽。


### 2026-09-07 回执根验证的有界并发读取

VerifyReceiptRoot 在先检查交易清单格式/重复后，最多八路并发读取回执，按原交易索引保存结果，随后继续按区块顺序检查身份、累计 gas、bloom 和 trie。保留 16,384 笔及 64 MiB 累计 JSON 预算，预算在保留响应前检查，任一 RPC 错误或上下文取消使整批失败，不返回部分集合。原索引双次读取、deadline 和 canonical 复查不变。

新增 24 请求屏障测试，要求实际达到八路并发且不超限，并验证最终回执顺序；另测试 RPC 错误和取消时没有部分结果。首次取消测试因测试服务端未消费请求体并等待连接取消而卡在 httptest.Close，已取得堆栈并停止该测试进程；为夹具增加显式退出通道后重跑通过，生产取消逻辑未放宽。

chainrpc 全包 race（4.412 秒）、candidate-inspect 全包 race（6.193 秒）、相关 vet、全部 CLI 构建通过。此为消除逐笔网络串行等待，不宣称已达到生产稠密区块吞吐指标；最坏区块仍须负载验收。无迁移或部署。

真实 RPC 只读 wrapper 检查通过（4.965 秒）：block=0x6d46234，hash=0x443fb67a280f614fb960a43d1643661ab9df4134d1b56e807163061ae404cf31，receiptsRoot=0x19994140725dec23509b576c9196e0abd4cdc3e406d517fb91b94acac3580f3e，2 笔回执。此单块结果不替代密集区块负载验收。


### 2026-09-07 密集混合回执的完整观察验证

新增 TestReceiptRootDenseObservation：256 笔回执混合 legacy、Ethereum 1–4 与 Nitro 0x64/65/66/68/69/6a 共 11 种编码，每笔带非空日志，跨越 trie 交易索引 0x7f/0x80 边界。预期 trie 使用手工 RLP 字段与类型前缀生成；通过真实 chainrpc HTTP 客户端和 RootVerifiedClient 的完整双次观察路径，核对回执/日志顺序、根及完整 512 次回执请求。服务端按索引模拟不同延迟。

另覆盖第 128 笔回执缺失、累计 gas 改动造成根不一致、请求超时；均不得返回部分 observation 或 RootProof。根不一致用例明确要求已完成全部双次读取，不能因前置夹具错误而假通过。取消夹具保留显式退出通道，防止测试服务器关闭等待。

首次专项 race 通过（3.809 秒）；有效路径观测耗时 521.516541 ms，数据规模 256 回执/256 日志/512 次回执请求。这是本机合成区块与 0–7 ms 延迟的结果，不是生产网络、最大区块、长时间运行或真实部署联合验收，也不能据此设定生产 SLA。无运行时代码、依赖、迁移或部署变化。

最终新增完整请求计数断言后，chainrpc 全包 race 通过（3.848 秒），对应 vet 与 git diff --check 通过。


### 2026-09-07 后端全包及隔离本地链联合回归

在近期索引回执根、历史补验、Treasury/候选消费与运维变化后，执行 go test ./...、go test -race ./...、go vet ./...，均通过；按当前源码重建全部 bin CLI。默认 Go 测试中需要专用环境的用例仍按其条件跳过，不能将默认结果宣称为所有可选验收完成。

八项生成物检查通过：Gauge/Settlement storage、events、models，以及 API/projection/Treasury/settlement golden。最初 shell PATH 缺 forge，改用已安装的 /Users/dear/.foundry/bin/forge；工具编译提示的既有 Solidity lint 警告不构成已完成安全审计。

完整 scripts/smoke_local.py（TG_SMOKE_CHAIN=1，显式本机 FORGE/ANVIL 路径）最终通过：隔离 PostgreSQL 集成、67 项迁移 CLI 首次/重启幂等、内容服务重启与 pg_dump/pg_restore 后 URI/字节一致性、本地 Anvil 索引/发布/哈希固定运行时代码检查、转换及维护单次提交/回执/持久化重试、API 无数据库 readiness=503/有数据库=200、SIGTERM 正常退出。

首轮在提交后立即读取本地转换回执的断言失败；第二轮该位置通过，随后因未设置 FORGE 在合约检查前失败。为避免提交确认先于本地出块时的时序脆弱性，smoke_conversion_state.py 改为最多 5 秒轮询同一交易哈希，仍拒绝缺失或回退回执，绝不重发交易；显式提供工具路径后第三轮完整通过。临时诊断交易输出已移除。Python 语法和 git diff --check 通过。

仅向脚本创建的 loopback Anvil 发送测试交易，临时数据库/节点由脚本清理。测试包含合成 getter 图，不能升级为实际完整协议部署、独立 RPC 共识或生产负载验收；仍无外部链部署/广播，publicationEligible 与完整财务结论不提升。


### 2026-09-07 Treasury 审核与发布计划的回执根门槛

RecordReview 的 approved 分支现在要求候选 Journal.ReceiptRootVerified，并在独立 journal 的重新加载后要求 evidence.ReceiptRootVerified；审核记录据实际重验结果设置 ReceiptRootVerified=true。独立数据库审核身份、独立数据集、历史完整性声明、请求 RPC 新鲜度及观察复查继续必需。拒绝审核不增加这些批准前置要求。

PreparePublication 与 PrepareFinalization 同时要求候选和当前已批准审核的 ReceiptRootVerified。旧已批准记录缺标记，即使摘要和其他字段有效，也不能授权生成发布/确认计划；旧操作重试保留不可变审核记录，须使用新审核操作取得满足条件的记录。

隔离 PostgreSQL 的 Treasury 夹具为创建至 source 加入明确标注的合成 root 证据，以验证完整审核/计划流程；不把这些合成 root 当作密码学证明。新增摘要有效的旧 rootless approval，分别断言发布和确认在授权门槛处被拒绝。此项不撤销独立审核要求，也不代表已执行实际发布、签名或生产财务验收。无新增迁移。

验证通过：Treasury 全包 race（2.274 秒）、首次批准流程 PostgreSQL 回归（133.974 秒）、新增旧 rootless 审核拒绝断言后的 PostgreSQL 集成 race（41.584 秒），相关 vet、全部 CLI 构建及 git diff --check。


### 2026-09-07 Treasury 请求状态观察区块的回执根证据

新增 journal.VerifyStoredReceiptRoot，在调用者 snapshot 内验证指定 canonical/receipts_verified 区块的 root、绑定摘要、数量，以及全部实际回执的数据库索引/状态与 payload 身份，再流式重算集合摘要。最多读取 16,385 行用于检测超限，实际允许 16,384 笔，集合继续受 32 MiB 预算限制；空区块也检查空集合摘要。

对 Journal.ReceiptRootVerified=true 的 Treasury 候选，SaveCandidate/ReadCandidate 的 checkCandidateSource 现在额外要求 Request.BlockHash 对应的请求状态观察块通过上述检查。该块可能晚于最初 RootRequested 事件，不把观察状态区块证明宣称为原请求事件发出区块证明。未验证候选仍可保存为未验证产物，但不能通过已加强的审核/发布门槛。

PostgreSQL 夹具为请求观察块加入明确标注的合成证据，并在合成发现测试改变回执集合时更新其预期证据。新增缺失观察块 root 时保存/读取拒绝、额外插入无日志回执时读取拒绝及恢复成功的用例。此项为本地证据消费，不升级独立共识、transaction trie 或完整财务结论。无新增迁移或实际发布。

验证通过：Treasury 全包 race（2.610 秒）、请求观察块校验首轮 PostgreSQL 集成（75.781 秒），新增缺失/变更/恢复断言后的 PostgreSQL 集成亦通过；相关 vet、全部 CLI 构建和 git diff --check 通过。


### 2026-09-07 B06 按钱包和资产查询 Vault 本金

新增 GET /v1/users/{address}/accounts（OpenAPI 2.23.1，第 18 个公开 GET 路由）及 UserAccountReadModel/AccountPage、生成 SDK listUserAccounts。返回 user/assetUid/vault/deposited/allocated/free/source，按资产稳定分页，cursor 绑定钱包/endpoint/revision。数据来自已发布快照的可选 accounts 字段，不从市场仓位拼凑；缺少该字段的旧快照或非 synced 快照返回 503 accounts_unavailable，已知空列表与未知严格区分。公共查询不要求登录。

Go 快照校验要求账户唯一、Vault 与 asset config 一致、uint256 规范金额、deposited=allocated+free、来源链/高度/安全索引有效，且所有市场仓位均有账户、free 一致、各市场 allocated 合计等于账户 allocated。保留没有市场仓位且 allocated=0 的本金账户。发布路径将账户 source 一并加入既有 journal 事件来源检查。旧快照省略 accounts 保持兼容；传入账户覆盖后不允许省略已有仓位账户。

测试覆盖金额/分配合计/Vault/来源/重复/缺失账户拒绝、分页/跨钱包 cursor/未知参数、旧快照不可用及空列表。数据库用例新增无仓位账户发布至 HTTP、未知来源发布拒绝和同步陈旧 503。HTTP 单测部分使用受控 Reader，实际快照不变量由 readmodel 与数据库用例验证。

OpenAPI 源生成器、JSON/lock、Go DTO/嵌入契约、TS SDK 导出与前端生成客户端同步更新。SDK 测试 40 项及前端 typecheck/check:client 通过。仍待账户自动快照生产、B16 accounts 刷新失效联动、真实钱包页面联调；不把这一接口实现等同于 B06 全部上线验收完成。无迁移、交易发送或部署。

验证通过：readmodel/httpapi race（20.768/6.306 秒）、SDK 40 项测试、前端类型/客户端同步、Go DTO 同步、相关 vet 与全部 CLI 构建。首次 PostgreSQL 全回归发现既有活动补验夹具 emptyRPC.codeReads++ 的竞争，改为 atomic.Int64 后完整 race 回归通过（47.196 秒）；账户数据库用例包含来源拒绝、无市场仓位本金及陈旧 503。git diff --check 通过。

### 2026-09-07 B16 账户本金快照刷新契约

`GET /v1/updates` 的 invalidated 新增 accounts。初次读取、历史 revision 过期或重组导致的 reset 一并失效 markets/configs/positions/accounts；新 revision 只改变账户时仅返回 accounts。缺失账户覆盖与显式空数组不同，任一方向变化均触发账户失效。相同 revision 保持 unchanged。

OpenAPI 升级至 2.24.0，生成 JSON/lock、Go 嵌入契约与 TS 客户端同步。前端验证器拒绝缺少 accounts 的 reset；离线恢复、停止后启动等恢复路径合成四类完整 reset。现有页面仍通过已暂存的 foundation 提交后刷新；这一改动不代表账户页面或账户自动快照生产已实现。上线时须配套更新客户端与服务端，旧三类 reset 客户端不兼容新增枚举。

验证：SDK 40 项、前端刷新 11 项、typecheck/client 同步、Go readmodel race（23.618 秒）、修正旧 reset 断言后的 HTTP race（5.874 秒）、DTO 同步与相关 vet 通过；启用 TG_TEST_WEB_INTEGRATION 的 PostgreSQL 集成 race（52.052 秒）覆盖真实 HTTP/TS 刷新验证。首次并发回归另有交易容量夹具返回 503，完整 HTTP 复验未重现，原因未确认，不据此宣称生产容量验收通过。无迁移、部署或交易发送。

### 2026-09-07 B06 受信快照的账户自动补入入口

新增 ObservationStore.EnrichAccounts，从现有完整候选重放结果生成公开 accounts；要求候选历史回执根、事件库存与 emitter 地址绑定标志，以及输入快照的链、区块、配置和仓位完全一致。保留无市场仓位账户；已有账户与候选冲突时拒绝，不静默替换。输出再次通过快照校验，保持生产者的 sync/markets/positions 不变。

publish-snapshot 新增 TG_PUBLISH_ACCOUNTS=true 开关，读取部署 manifest 和 canonical TG_PROJECTION_START_BLOCK，使用现有发布数据库连接读取候选，再执行原有身份补入及发布检查。该入口面向已受信的生产者快照，不把候选升级为独立可发布产物；完整自动调度、财务验证与真实钱包页面仍未完成。没有修改数据库权限、迁移、部署或实际发布。

验证：新增 11 个子用例覆盖生成/幂等、区块/链/配置/仓位不匹配、证据标志缺失、已有账户冲突和缺失仓位账户；readmodel 全包 race 23.948 秒通过，相关 vet 与发布 CLI 构建通过。本轮未运行新入口的 PostgreSQL 端到端发布验收，该项仍待补齐。

### 2026-09-07 B06 账户补入的 JSON 往返修复与数据库拒绝验证

新增使用 BuildCandidateSet 实际输出、经过 JSON 序列化及 Parse 后的补入测试，发现配置 Values 中 Go 数字类型变化导致 reflect.DeepEqual 误拒绝相同配置。配置比较改为 JSON 编码字节比较；不转换为 float64，不改变数值精度，继续拒绝字符串/数值类型变化、不同金额和非法 JSON number。覆盖超过 2^53 的精确整数，避免舍入后错误匹配。

真实 PostgreSQL replay 夹具加入 EnrichAccounts 检查：输入快照先通过 Parse，再读取具备完整合成回执根覆盖但缺少 emitter manifest 的数据库候选，必须以覆盖不完整拒绝且不返回部分输出。此测试证明数据库拒绝路径，不冒充 manifest 完备情况下的成功发布。JSON 往返成功用例显式使用合成证据标志，仅验证组装层。

验证：账户补入 race 2.861 秒、精确数字比较 race 1.463 秒、启用 TG_TEST_CREATOR_CANDIDATE 的 readmodel PostgreSQL 全包 race 56.622 秒、相关 vet 与 diff check 通过。完整成功发布端到端、自动调度及钱包页面仍待开发。

### 2026-09-07 B06 manifest 支持的账户补入与发布成功回归

为现有 PostgreSQL 真实 ABI 事件重放夹具分配不同的 Registry/Factory 合成地址，避免多个 module 共用地址而无法校验绑定。新增与该地址清单一致的部署 manifest 和 checkpoint scope，实际调用 LoadCandidateSet 验证事件清单、地址绑定与历史 root 覆盖，再通过 EnrichAccounts 生成账户、Store.Publish 发布并按 revision 用 Store.Load 读回本金，逐项比较账户结果。测试结束恢复 checkpoint/root 并移除隔离数据库中的测试快照。

root 与 runtime codehash 为明确标注的合成证据，测试覆盖数据库消费及发布成功路径，不证明真实 RPC 身份、完整财务验算或生产可上线。候选 PublicationEligible 继续为 false；HTTP 与命令行配置路径未由本次用例覆盖。启用 TG_TEST_CREATOR_CANDIDATE 的 readmodel 全包 PostgreSQL race 56.129 秒、相关 vet 和 diff check 通过。无生产发布或交易发送。

### 2026-09-07 B06 Rewards 页面跨资产 Vault 本金读取

新增前端 loadWalletAccounts，固定钱包与 finalized revision，最多读取 100 页（每页最多 100 条），验证资产顺序/唯一、Vault 配置绑定、uint256 本金恒等式、来源区块及索引。重复游标、空续页、超限、取消或后续分页失败均不提交部分余额；不将未知返回当作零余额。

Rewards 页面新增跨资产 Vault 余额区域，通过生成 SDK 按 revision 获取 accounts，分别显示 deposited/allocated/free，保持不同资产独立。请求设 15 秒期限，钱包切换及快照失效清空旧数据；提交时再次检查 AbortSignal、wallet、foundation 与当前请求身份。B16 触发页面刷新后会重新读取账户。展示数据不参与现有链上交易预检或金额授权。

验证：账户读取 3 项（含多种拒绝子场景）及刷新 11 项全部通过，typecheck 与生产构建通过，diff check 通过。构建仍有大 chunk 提示。真实钱包、浏览器交互和账户 HTTP 端到端展示验收尚未完成，不把静态构建等同于产品上线验收。

### 2026-09-07 B06 Go HTTP 与前端账户加载器联调

PostgreSQL 快照用例通过本地真实 HTTP server 调用生成 SDK 与 loadWalletAccounts，核对持仓钱包的大整数本金、无市场仓位账户以及空钱包完整结果。同步陈旧时，固定 revision 请求必须拒绝为 400 invalid_request 且 sync unavailable；未固定 revision 的既有查询继续验证 503。测试不把两类查询的错误契约混为一谈，也不允许失效后返回部分本金。

当前工作区新增第 68 个 event projection 迁移，原 PostgreSQL 测试的固定数量断言仍为 67，已同步为 57 个基础迁移加 11 个升级迁移。本轮未修改第 68 个迁移内容。前端全量 npm test 127 项通过；HTTP 验证仍使用隔离数据库，不覆盖真实钱包或浏览器渲染。

联调期间发现当前活动补验已改用 750000000+chain 的独立锁，旧夹具仍锁住 730000000+chain，导致 busy 断言失败；同时夹具在失败时未回滚所持事务，连接池关闭永久等待。通过本轮测试进程的 goroutine 栈确认等待位于 pool.Close 后，终止诊断进程并删除其唯一隔离数据库，补充活动补验与市场身份锁夹具的 defer Rollback，再对齐活动补验锁。未更改生产锁策略。

最终启用 TG_TEST_WEB_INTEGRATION 的 PostgreSQL 全回归 race 46.314 秒通过，包含新增账户真实 HTTP/SDK/前端加载器用例和修正后的活动补验 busy 断言；integration vet 与 diff check 通过。

### 2026-09-07 B06 浏览器空态核对与页面离开取消

在本地 Vite 5189 的内置浏览器中读取实际 Rewards 页面可访问性树：账户标题及未连接钱包提示存在，API 未配置时保持 Runtime locked，交易按钮禁用。此证据只覆盖实际空态及元素可访问性，不是已连接钱包数据、像素布局或控制台零错误验收。

检查页面生命周期时补齐账户请求的 pagehide 与 visibilitychange(hidden) 取消、余额清空，并禁止页面隐藏时启动账户加载。返回可见页面仍沿用既有 B16 重连刷新。修改后 typecheck、账户与快照刷新 14 项测试通过；这些单测覆盖加载器取消和快照恢复，不单独证明浏览器事件交互。真实钱包与浏览器有数据场景仍待完成。

### 2026-09-07 B03 发布命令预检与取消

publish-snapshot 改为接收父 context 的可测试入口，main 绑定 SIGINT/SIGTERM，数据库及补入操作继承一分钟截止时间。启动时拒绝过期/未来的生产者验证时间，以及非 true/false 的 accounts/identities 开关；在建立数据库连接前完整解析快照。Store.Publish 仍在实际发布时再次校验时间和链来源，不用启动时通过替代最终检查。

新增 CLI 入口测试覆盖参数、时间戳格式、过期/未来、两个错误开关、缺失文件、无效快照、有效输入进入数据库配置检查及预取消；错误均不输出成功消息。测试使用故意无效的数据库配置，不访问生产数据库。race 1.886 秒、vet、CLI 构建及 diff check 通过。尚未验证实际 SIGTERM 中断数据库调用的进程级行为，未实现自动财务验算或持续发布调度。

### 2026-09-07 B03 发布命令 SIGTERM 真实进程验收

新增可选 PostgreSQL 测试：创建独立数据库，测试连接持有发布 advisory lock，构建并启动真实 publish-snapshot 子进程；从 pg_stat_activity 确认其正在等待对应数据库的 advisory lock 后发送 SIGTERM。断言五秒内以退出码 1 返回、stdout 无成功消息、stderr 为不能取得发布锁，并确认 tickergarden-backend 连接数归零。测试不会释放锁让其进入写入阶段，不需要迁移或发布数据；任何失败均终止子进程并清理唯一隔离数据库。

开启 TG_TEST_DATABASE_URL 的发布命令全包 race 10.262 秒通过，vet 与 diff check 通过。覆盖数据库锁等待阶段的 SIGTERM；不证明提交瞬间取消必定未提交，仍须按 revision 查询结果。持续自动调度和完整生产者验算仍待完成。

### 2026-09-07 B03 受信生产者文件的持续发布调度

新增 publish-snapshot --watch ENVELOPE_JSON，每五秒读取包含 verifiedAt/snapshot 的原子文件，调用与单次 CLI 相同的 publish 函数（配置、时间、快照、账户/身份补入及 Store.Publish 校验全部保留）。拒绝重复/未知 envelope 字段、额外 JSON、非普通文件和超限输入；使用非阻塞打开避免 FIFO 阻塞。成功时记录摘要，跳过未变内容；失败输出 retry_pending 后重试。绝不重写验证时间；重启重复提交仍依赖持久层不可变 revision 校验。

测试覆盖不完整/重复 JSON、重试保持生产者时间与内容、成功后去重及原子替换。真实 PostgreSQL 写入锁等待测试扩展为单次和持续模式均发 SIGTERM，验证及时退出、无成功输出以及连接归零。连接关闭在 PostgreSQL 状态视图有短暂传播延迟，测试以两秒上限轮询归零，仍拒绝持续泄漏。启用 TG_TEST_DATABASE_URL 的发布命令全包 race 6.560 秒、vet 与 diff check 通过。

仍依赖受信生产者提供经过完整验证的快照；此项完成调度入口，不代表完整自动财务验算或无人值守生产链路已经完成。本轮没有启动持续发布服务、生产写入或链上交易。文件与目录必须仅由受信生产者写入。

### 2026-09-07 B03 持续发布 PostgreSQL 成功与冲突恢复

新增独立数据库用例，应用当前全部迁移并写入合成 finalized journal/来源日志，使用真实 publish 函数运行 watch。首次 envelope 成功发布后，原子替换为同 revision、不同但格式有效的快照，必须输出一次 retry_pending；随后推进 journal 并提交新 revision，恢复成功。最终数据库仅有两条已发布快照，旧 revision 的本金相关市场字段未被冲突文件覆盖，测试数据库自动删除。

该测试覆盖持续调度与真实 PostgreSQL 发布/不可变冲突恢复，不是单纯模拟 publisher 回调；账户和身份补入开关关闭，仍保留其独立已有验收边界。发布命令全包 race（包含单次/持续 SIGTERM）13.178 秒、vet 与 diff check 通过。首次检查误把 bytea payload 当 JSON 操作，按实际存储类型解码后复验通过。未进行生产发布或链上交易。

### 2026-09-07 B03 本金验算复用完整回执历史证据

将候选读取器的完整回执历史校验提取为 journal.VerifyStoredReceiptHistory，候选保留薄包装调用，本金 reconciliation.Inspect 在同一 repeatable-read 事务中复用。检查配置范围连续性、创世边界、回执计数/摘要、逐笔回执与数据库元数据以及完整日志一一对应，沿用百万区块、十万回执/日志及 64 MiB 读取上限。RangeCoverage 新增 completeReceiptsVerified 与 receiptRootsVerified；缺 root 可保持后者 false，已声明 root 的绑定冲突或集合不完整拒绝整个检查。不证明部署起点或独立共识，也不将部分本金报告提升为完整财务结论。

候选 PostgreSQL race 61.215 秒通过，相关 vet 与全部 CLI 构建通过。完整 TG_SMOKE_CHAIN=1 本地 Anvil/PostgreSQL 链路通过，smoke_vault 对实际验算命令新增两个覆盖标志断言；其 report 仍明确 historyComplete/publicationEligible 为 false。包含索引、发布、转换、maintenance、备份恢复及 API 退出检查，临时服务和数据库由脚本清理。

首次 smoke 被当前新增第 69 个迁移造成的固定计数断言拦截。改为遍历嵌入迁移文件检查连续编号、至少包含当前 69 项，再校验从 57 升级到全部文件的实际数量及重启幂等性；未改迁移内容。重跑完整 smoke 通过。部署和完整财务验算仍未完成。

### 2026-09-07 B03 验算回执覆盖降级、拒绝与恢复

smoke_vault 增加实际 reconciliation-inspect 断言：在隔离数据库暂时移除当前块 receipts_root/root_receipt_set_hash 时，completeReceiptsVerified 仍为 true、receiptRootsVerified 降为 false，publicationEligible 仍为 false；保持根绑定但增加 receipt_count 时命令必须失败且不输出报告；恢复原始根/计数后两个覆盖标志恢复为 true。每个修改均使用 finally 恢复原值。

验收范围纠正：上一节仅启用 TG_SMOKE_CHAIN=1 的成功运行没有执行 smoke_vault，因为该场景还受 TG_SMOKE_VAULT=1 控制。因此上一节对实际 Vault 验算标志断言已被该次运行覆盖的描述不成立。本轮显式启用 TG_SMOKE_CHAIN=1 与 TG_SMOKE_VAULT=1 后完整链路通过，实际执行上述场景并显示 Vault pipeline 通过；首次基础运行仅作为基础回归。不能以脚本中存在断言推定运行覆盖。

Python 语法检查、diff check 通过，临时 Anvil/PostgreSQL 由脚本清理。该验收仍使用本地合成合约/历史，不代表独立共识或完整财务发布资格。

### 2026-09-07 B03 费用已领取累计候选输出

CandidateSet 新增 feeClaims，从同一数据库快照内重放生成的 feeClaimTotals 导出，按市场/资产/角色/受益人/epoch 稳定排序，返回累计 claimedAmount、claimCount、首次事件 key 及末次来源。校验市场与资产绑定、角色/epoch、非零受益人、规范十进制金额、计数和来源高度/链。累计领取金额允许超过单次 uint256，但不能超过 claimCount 乘 uint256 上限；不使用浮点。

此项导出配置起点以来 FeeClaimed 的支付事实，不包含奖励转换、不能替代完整费用流入/转出账本或生命周期总收益，也不提高 publicationEligible。来源可信程度仍由候选现有的 receipt history、manifest/emitter 标志界定。

真实 FeeClaimed ABI 日志连续两次重放测试验证累计金额、次数及末次来源，包含未知市场、错误链、未来来源、非法计数/金额和错误分组 key 拒绝。启用 TG_TEST_CREATOR_CANDIDATE 的 readmodel 全包 PostgreSQL race 53.823 秒、vet 与 candidate-inspect 构建通过，diff check 通过。数据库既有回归验证兼容性，本轮没有新增带 FeeClaimed 的数据库验收夹具。

### 2026-09-07 B03 费用领取候选 PostgreSQL 重放验收

在现有隔离 PostgreSQL 候选夹具中临时追加两条 FeeClaimed ABI 日志，同步完整回执 payload/集合摘要、projection_inputs 与 input_count；实际 LoadCandidateSet 输出累计金额 3、次数 2、正确钱包/资产和末次日志来源。删除末次投影输入后，候选读取必须拒绝，避免把缺失历史当成少算的累计记录。结束后恢复原始回执/摘要/输入数量并删除临时日志，继续原有完整候选回归。

此夹具仅验证支付历史的持久读取与导出，未修改既有财务 getter；不把合成领取记录与 getter 之间未建模的收支关系宣称为已验算。PublicationEligible 保持 false。开启 TG_TEST_CREATOR_CANDIDATE 的 readmodel 全包 PostgreSQL race 56.586 秒、vet、diff check 通过，未进行生产写入或链上交易。

### 2026-09-07 B03 FeeVault 事件负债账本内核

新增 internal/feeledger，根据 ProtocolFeeVaultLiabilities、ProtocolFeeVaultV4Accounting 与 ProtocolFeeVaultRewardSettlement 的事件语义重建配置市场的 Creator/Staker/Platform/Holder/Forfeiture 五类负债。FeeBucketsCredited/CurveFeesSwept 使用已扣 Holder 分成的 Creator 金额，HolderFeesAccrued 单独入账；FeeClaimed 扣减对应桶；ForfeitureReserved/Converted 在桶间转移且核对准备金余额/全额转换；RewardConverted 与 HolderRewardsConverted 按净 spent/received 跨资产变化，忽略 RewardBatchConverted 汇总以免重复计数。Holder 注资使用已配置 Distributor，Treasury 外部用户注资不误扣 FeeVault。

配置及事件入口校验地址和模块，所有更改先在临时数值副本计算，桶或全资产 uint256 越界、扣减不足、错误准备金/兑换资产时拒绝整个事件。金额使用 big.Int；快照稳定排序。调用方仍须保证完整、唯一、按链顺序且 canonical 的日志，并验证配置和代码身份；该内核本身不证明这些条件。

测试覆盖真实 FeeBucketsCredited ABI 解码、费用与 Holder 分账、领取、没收/准备金转换、Staker/Holder 净兑换、外部 Treasury 注资排除、汇总事件不重复记账、错误时无部分更新及跨市场同资产总量溢出。feeledger race 与 vet 通过。尚未接入候选数据库重放或区块末 getter 对账，不提升任何发布资格；这仍是完整费用收支验算的开发中内核。

### 2026-09-07 B03 费用交易原子重放与 getter 比较内核

feeledger 新增 ApplyTransaction：检查同一块/交易身份、严格递增日志索引、removed 状态及数量/字节上限，在独立账本副本重放后统一校验五类桶与每资产总负债的 uint256 范围，成功才替换账本。兑换合约先扣款再调用 router，而净兑换事件最后发出；因此 router 费用事件可能先出现，逐事件检查上界会误报。单事件 Apply 保持原有严格检查，完整回执重放应使用交易入口。交易入口仍依赖调用者认证 canonical 回执、模块身份与完整事件清单。

Reconcile 从配置市场和重放余额生成预期项，与 feeLiability 的五类桶/合计、feeSolvency 的总负债/已知市场合计逐项比较；实际余额允许大于负债。报告明确 missing/mismatch/matched、覆盖计数和未知 key，重复或身份错误的观察不算完成。所有金额使用规范十进制大整数，观察顺序不影响报告。匹配仅表示已知负债数值一致，HistoryComplete 与 PublicationEligible 均保留 false。

新增测试覆盖超过 2^53 的精确金额、余额盈余/不足、缺失/重复/额外/错误身份/非法金额观察；真实 catalog ABI 编码的同交易先入账后净兑换、最终桶和跨桶总量溢出、扣减不足、跨块/跨交易混入、重复/倒序/removed/错误 ABI/超限输入，以及失败时桶和总量均无部分更新。feeledger、events、deployment 三包 race 和 vet、diff check 通过。vet 首次发现现有 ReadStats.Errors 的 JSON tag 混入 import 文本，已仅修正该 tag 后复验通过。

此轮完成比较与重放内核，尚未把它接入数据库完整历史及同块 RPC 观察的受信发布链路；没有生产写入、部署或链上交易，不能据此将 B03 或第一版整体标为完成。

### 2026-09-07 B03 候选数据库读取接入费用诊断

LoadCandidateSet 在既有 repeatable-read 事务和 64 MiB/十万输入限制内保留费用相关日志，经完整回执/投影清单检查后，从 manifest 取得唯一 ProtocolFeeVault 地址，结合候选市场与 Holder 模式构建费用账本。按数据库区块/日志顺序分组调用 ApplyTransaction，拒绝范围之外、倒序或同块交易索引不递增的输入；比较同批次且与候选链/区块匹配的 feeLiability/feeSolvency 观察。

数据库候选新增 feeReconciliation，带链、起点、末块身份和 matched/mismatch/unavailable 状态。缺回执根历史、清单或 emitter 绑定时返回 history_evidence_missing；配置缺失、重放失败等分别提供稳定原因，且不输出部分账本报告。历史或数值不完整仍可保留候选其他诊断，不会因此变成可发布快照。直接 BuildCandidateSet 未执行历史重放，故该字段缺省；数据库读取路径显式赋值。

测试采用真实 FeeBucketsCredited catalog ABI 夹具，覆盖匹配/差异、两类 Holder 模式、错误模式、链/区块/高度混入、历史标志缺失、重复日志与交易倒序。PostgreSQL 现有真实候选读取夹具新增证据缺失不得生成费用通过报告的断言。readmodel 全包 PostgreSQL race 60.921 秒通过；随后修正 continuous-24h 模式映射并增加两类 Holder 分支验证，针对费用诊断 race 7.609 秒通过。相关 vet、candidate-inspect 构建及 diff check 通过。

尚未增加完整费用流入/领取/转换与 getter 配平的 PostgreSQL 成功夹具；已有合成费用领取夹具不具备这一收支关系。独立 RPC 验证、历史部署起点认证及发布资格整合仍未完成。没有生产写入或链上交易。

### 2026-09-07 B03 费用收支 PostgreSQL 匹配、差异与恢复验收

新增隔离数据库费用夹具，沿用真实候选读取路径及完整回执/投影清单，绑定单独的 ProtocolFeeVault manifest 地址。以真实 catalog ABI 编码 Quote/Meme 费用入账、Staker 领取和 Creator 净兑换，更新完整回执 payload/摘要、投影输入及配置摘要；费用账本最终与既有大整数 Creator 负债和 Staker 余额配平，实际 LoadCandidateSet 返回 matched、18 项覆盖且发布资格仍为 false。

随后增加 Platform 观察余额 1，同时调整观察中的桶合计、资产总负债及余额，使 getter 之间保持自洽；实际候选必须返回 mismatch，证明事件账本能识别仅凭 getter 互相比较无法发现的差异。恢复观察后重新 matched。删除兑换投影输入后必须拒绝；再调低 input_count 与剩余输入一致仍拒绝，验证反向回执日志清单检查。结束后恢复原始观察、配置摘要、回执和输入，继续既有回归。

初次夹具把两种资产的 feeId 都设为零，被既有投影费用身份校验拒绝；修正为不同 feeId，并增加夹具全事件重放预检后通过。最终 readmodel 全包 PostgreSQL race 62.805 秒、vet 和 diff check 通过。回执 root 使用明确标注的合成绑定，未验证 RPC trie 或独立链共识。此项证明本地聚合费用账本收支匹配，不证明每个 Creator epoch 的全部事件来源、全部 Holder 收支或完整财务发布资格。下一步仍需将事件预期值与独立 RPC 同块读值比较。

### 2026-09-07 B03 事件费用预期值接入同块 RPC 验证

candidate-inspect --once --verify-assets-rpc 的费用环节现在要求数据库候选具备匹配的 feeReconciliation 和历史回执根/事件清单/emitter 绑定证据，核对候选链、历史起点、末块身份。通过既有 hash-pinned RPC 读取逐项比较事件账本的五类负债、市场资产合计、全资产负债和余额下界；必须消费全部预期项，缺项、额外项、重复项、错误比较方式、非法金额和伪造 matched 标志均拒绝。原有 Staker claimable 下界、跨市场资产求和、原生币/代币余额检查保留。

新增 eventDerivedFeeLiabilitiesAtCandidateVerified 输出标志，仅在 verify-assets-rpc 全链路成功且存在市场时为 true；fullFinancialReconciliation、PublicationEligible 和独立 emitter 认证结论不提升。普通 --once 仍可返回 mismatch/unavailable 诊断；资产 RPC 验证模式不能再凭仅有 getter 自洽报告通过。

测试覆盖超过 2^53 的金额、盈余、原生币匹配/不足、报告缺失/差异/错误绑定与覆盖、错误比较和 RPC 读取失败，并使用实际 JSON-RPC HTTP 客户端验证代币路径的 14 次 hash-pinned 调用。关键反例保持总负债不变但 Creator 加 1、Staker 减 1：旧 getter 覆盖检查通过，新增事件预期检查拒绝。candidate-inspect 全包 race 4.143 秒、vet、CLI 构建、diff check 通过。

本轮验证 RPC 比较函数及 HTTP 传输，不是数据库到真实部署 RPC 的完整联合验收，尚未验证全部 Creator epoch/Holder 权益来源或完整财务发布；没有生产写入和链上交易。

### 2026-09-07 B03 数据库费用账本到 HTTP RPC 联合验收

将费用 RPC 实现从 candidate-inspect 提取为 readmodel.VerifyFeeLedgerRPC 与 VerifyFeeCoverageRPC，CLI 保留薄包装调用，原有验证条件和 getter 调用数量保留。共享函数明确要求调用者承担候选来源、manifest/代码身份及比较前后 canonical 链身份认证；函数本身不据此授予发布资格。

在上一节隔离 PostgreSQL 完整费用收支夹具内，重新实际 LoadCandidateSet，并调用共享生产校验函数和真实 chainrpc HTTP 客户端。HTTP 端使用种子 getter 数据构造响应，不从 report.Expected 生成远端值，严格检查每次请求的块哈希与 requireCanonical。匹配和恢复各完成 14 次读值；在 RPC Creator 加 1、Staker 减 1 后，getter 自洽控制检查通过，事件账本检查失败；历史状态 RPC error 必须失败，恢复后重新通过。候选与费用报告的 publicationEligible 均不提升。

启用 TG_TEST_CREATOR_CANDIDATE 的 readmodel 全包 PostgreSQL race 63.285 秒，candidate-inspect 全包 race 4.508 秒通过。相关 vet、全后端 go build ./...、CLI 构建与 diff check 通过。此项为真实数据库到受控 HTTP RPC 的联合验收，不是外部部署节点、receipt trie 或完整 --verify-assets-rpc 所有分支的端到端验收；完整奖励权益与财务发布仍有后续任务。

### 2026-09-07 B03 Creator epoch 事件负债账本内核

新增 feeledger.CreatorLedger，按配置的 market/creatorEpoch/asset 分别从零重放未支付负债。FeeBucketsCredited 与 CurveFeesSwept 使用净 Creator 入账；FeeClaimed 仅处理 Creator 角色并按 beneficiaryEpoch 扣减；RewardConverted 的非零 creatorEpoch 按净 spent/received 跨资产更新。HolderFeesAccrued 和 Staker 兑换不重复影响 Creator 桶。配置校验非零规范 uint32 epoch、市场/资产绑定和重复项，金额全程使用 big.Int。

与聚合账本共用交易元数据/顺序/数量/字节上限检查，在独立副本内更新并在交易末校验各 epoch 余额范围，失败不留下部分状态。某个 epoch 不足时不能使用其他 epoch 余额；该账本不验证受益人身份、退出时间或所有市场/epoch 的发现完整性，还需与聚合账本和认证配置共同使用。

测试覆盖两个 epoch 分别入账/领取/兑换、Curve 精确大整数入账、Holder/Staker 排除、跨 epoch 扣减不足、错误资产/epoch/emitter、重复日志、溢出时回滚和兑换期间先入账后净扣减。feeledger/readmodel/candidate-inspect race 分别 2.497/27.230/4.665 秒通过；本轮未启用可选 PostgreSQL 测试。feeledger vet、全后端构建、diff check 通过。

此项为按 epoch 验算内核，尚未接入数据库候选对账报告及 RPC Creator getter 比较；不得将聚合负债匹配等同于 epoch 权益匹配。完整财务发布仍未完成。

### 2026-09-07 B03 Creator epoch 候选对账与 RPC 证据门槛

feeReconciliation 新增独立 creatorEpochs 诊断，复用聚合账本已经核验的链/块、完整历史清单及交易顺序，将 CreatorLedger 的每个 epoch/asset 预期值与 CreatorEpochCandidate 比较。未配置 epoch、配置不一致或重放失败返回 unavailable 且没有部分预期项；匹配与差异分别输出稳定的逐项金额。父级 status 仍描述聚合费用，不能代替 creatorEpochs.status。

新增 VerifyCreatorEpochEvidence，检查证据与候选链、起点、末块、历史标志绑定及逐项唯一/完整匹配。verify-assets-rpc 在既有 Creator RPC 受益人、注册表、退出时间和逐 epoch 金额核验之前执行该门槛；成功且存在市场时输出 eventDerivedCreatorEpochLiabilitiesAtCandidateVerified。完整财务与发布资格不提升。

PostgreSQL 配平夹具改为两个 epoch 分别入账，Creator 净兑换仍仅影响 epoch 1，最终四项 epoch/asset 对账匹配。保留 Creator 聚合总额而将 epoch 1 加 1、epoch 2 减 1，实际候选父级仍 matched，但 Creator 诊断必须 mismatch 且证据门槛拒绝；恢复后重新匹配。单测覆盖报告缺失、错误绑定/历史标志、缺项/多项/重复、预期/观察金额变化与未知 epoch 时无部分报告。

启用 TG_TEST_CREATOR_CANDIDATE 的 readmodel 全包 PostgreSQL race 72.232 秒、candidate-inspect race 8.480 秒、相关 vet、全后端构建和 diff check 通过。已有 Creator RPC 单项测试沿用；本轮没有新增数据库到 Creator RPC 全分支或真实节点联合验收。Holder epoch 收支及独立历史认证仍属后续工作。

### 2026-09-07 B03 Holder epoch FeeVault 收支账本内核

新增 feeledger.HolderLedger，重放 HolderFeesAccrued 的原始 epoch 入账、HolderRewardsConverted 净 Meme/Quote 兑换，以及原始 epoch 转入配置分发器时的 FeeVault 扣减。QuoteTreasuryFunded 仅当 funder 为配置 FeeVault 时扣减，外部用户注资不影响 FeeVault；连续模式 HolderStreamFunded 归于固定 epoch 1。TreasuryClaimed/HolderStreamClaimed 是分发器后续支付，不再次扣减 FeeVault。配置校验每个市场固定分发器/模块、连续模式仅 epoch 1 及数量上限。

Creator 与 Holder 共用私有 epoch 金额存储/配置校验/快照排序和交易边界验证，保留 Creator 公共类型兼容别名。Holder 更新在副本中按整笔交易完成，最终各 epoch/资产负债必须为合法 uint256；任何不一致不提交部分状态。此内核只跟踪 FeeVault 尚欠金额，不替代分发器自己的 funded/paid/outstanding 历史和用户权益验证。

测试覆盖两 epoch 隔离、计提/兑换/转出闭环、超过 2^53 金额、外部注资排除、最终领取不重复扣款、连续 epoch 1、错误分发器/模块/资产/epoch、扣减不足与溢出时回滚，以及兑换先入账后净扣减的临时越界。feeledger/readmodel/candidate-inspect 三包 race 通过；补配置数量预检后再次执行 feeledger race 通过。相关 vet、全后端构建、diff check 通过；本轮未启用 PostgreSQL 可选用例。

尚未把 HolderLedger 接入候选按 epoch 对账和 RPC 对比，完整 Holder 收支及财务发布仍待完成；没有生产写入或链上交易。

### 2026-09-07 B03 Holder epoch 账本接入候选诊断

feeReconciliation 新增独立 holderEpochs 报告，复用父级已验证的历史清单、顺序和同块绑定。epoch 模式从 HolderEpochDetail 的 holderQuoteLiability/holderMemeLiability 取得观察值；continuous-24h 模式按照合约固定 epoch 1，从 FeeVault Holder 桶取得尚欠金额，不使用分发器 funded/paid/outstanding 替代。账本期望值来自 Holder 事件重放，逐 epoch/资产输出 matched/mismatch；配置、观察、epoch 或事件不完整时 unavailable 且不返回部分预期项。

仅当无 Holder 配置、无相关义务事件且未配置市场的 Holder 观察余额全为零时返回 not_applicable；未解释的非零负债不得被当作无须核算。父级 status 仍只表示聚合费用，不隐含该子报告通过。

真实 ABI 编码测试覆盖两个 epoch 的匹配、总额相同但 epoch 间移位、缺失 epoch、错误分发器、连续模式固定 epoch 1、零义务、未知义务事件与未解释余额；同时验证候选装配保留子报告，聚合匹配不掩盖 Holder epoch 差异。readmodel 全包 PostgreSQL race 77.366 秒和 candidate-inspect race 4.618 秒通过；补齐零义务边界测试后专项 race 4.727 秒通过。相关 vet、全后端构建、diff check 通过。

PostgreSQL 运行属于现有候选回归，本轮尚未新增带完整 Holder 收支和 manifest 的数据库匹配夹具；Holder RPC 证据门槛及联合验收仍待接入，不能据此宣称完整 Holder 财务链路已完成。

### 2026-09-07 B03 Holder epoch 事件负债 RPC 门槛

新增 readmodel.VerifyHolderEpochRPC：要求 feeReconciliation 的 Holder 子报告匹配并绑定同一候选链/起点/末块及历史标志，从候选 Holder 配置规划全部 epoch/资产目标。epoch 模式还核对子报告与候选 epoch 观察金额；连续模式固定 epoch 1。按稳定顺序直接调用 FeeVault holderLiability(bytes32,uint32,address)，使用 EIP-1898 canonical blockHash，并将每项返回值与事件预期金额比较。缺项、多项、重复、非法金额/epoch、配置或证据不一致均拒绝。

verify-assets-rpc 在既有 Holder 配置/根状态观察匹配后增加此门槛，成功且存在 Holder 市场时输出 eventDerivedHolderEpochLiabilitiesAtCandidateVerified。原有分发器 funded/paid/outstanding、服务费信用及最终链身份复查保留。共享函数仍要求调用方负责候选来源、manifest/运行代码和比较前后链身份认证。

从 Holder ABI 事件重放产生候选子报告，通过真实 HTTP chainrpc 客户端检查两 epoch 四项读值，以及连续模式 epoch 1 两项读值。远端响应由独立固定金额构造，覆盖匹配、总額保持不变的 epoch 间移位、短 ABI、历史状态 RPC error、恢复与取消。错误证据在 RPC 前拒绝。readmodel 全包 PostgreSQL race 76.548 秒、candidate-inspect race 4.948 秒、相关 vet、全后端与 CLI 构建、diff check 通过。

HTTP 用例连接事件重放与 RPC，但尚未连接完整 Holder PostgreSQL 收支夹具；本轮 PostgreSQL 属于现有全包回归。外部部署节点及完整 Holder 数据库→RPC 联合验收仍未完成，也未提升完整财务发布资格。

### 2026-09-07 B03 连续 Holder 数据库收支到 RPC 联合验收

扩展隔离 PostgreSQL 费用配平夹具，绑定独立 HolderRewardsDistributorV1 manifest 地址，更新市场创建观察及 discovery 的 Holder 开关，并加入分发器注册与完整回执/投影输入。Holder 计提 6 Quote、9 Meme，兑换 2 Meme 得到 2 Quote，转出 3 Quote 至连续分发器；最终 FeeVault 尚欠 5 Quote/7 Meme，分发器 funded=3、paid=0、outstanding=3。实际 LoadCandidateSet 同时通过聚合费用、两个 Creator epoch 和连续 Holder epoch 1 对账。

将这份数据库候选送入真实 chainrpc HTTP 客户端，执行既有 Holder RPC 匹配、epoch 金额差异、短 ABI、历史状态错误、取消、恢复与错误证据预拒绝场景。另将数据库 Holder Quote 观察改为 6，同步调整观察合计/资产余额以保持 getter 自洽，实际候选必须报告 Holder mismatch，并在 RPC 前拒绝；恢复后重新匹配。删除 HolderStreamFunded 投影输入后拒绝，调低 input_count 使数量自洽也仍拒绝。结束后恢复原始市场观察、discovery、manifest 摘要、回执、投影与费用观察。

readmodel 全包 PostgreSQL race 77.113 秒、candidate-inspect race 5.879 秒、readmodel vet、diff check 通过。此为连续分发模式的真实数据库→受控 HTTP RPC 验收；epoch Treasury 模式的对应联合收支夹具、真实节点/receipt trie 及完整财务发布仍待完成。合成数据没有模拟 24 小时流结束后的用户领取，也不宣称该场景已经验收。

### 2026-09-07 B03 Treasury epoch 数据库收支到 RPC 联合验收

费用 PostgreSQL 夹具拆为 continuous/epoch 两个独立子场景，各自恢复市场创建观察、discovery、manifest、输入、回执和 getter 批次。两者先计提 epoch 1 的 1 Quote/2 Meme，兑换得到合计 3 Quote，再完整转出该 epoch 的 Quote 负债；后续再计提 5 Quote/7 Meme。连续模式后续计提仍在 epoch 1，Treasury 模式留在 epoch 2。相较上一轮夹具，本轮将后续计提移至转出之后，准确模拟 fundHolderRewards 清空当时 Quote 负债的语义。

Treasury 模式使用 QuoteTreasuryFunded，epoch 1 funded/outstanding=3、FeeVault epoch 1 余额为零；epoch 2 尚欠 5 Quote/7 Meme且未转入 Treasury。两个 epoch 均为未请求根状态，服务费负债为零。实际数据库候选验证聚合费用、Creator epoch、Holder epoch 和 Treasury 余额，再通过受控 HTTP RPC 逐项核对，并覆盖跨 epoch 移位、RPC 错误/恢复、错误证据预拒绝以及缺失转出输入（包括同步减少 input_count）的拒绝。

启用 PostgreSQL 的 TestCreatorCandidatePostgres（包含两种费用模式及既有候选流程）race 72.180 秒通过；另运行 readmodel/candidate-inspect 全包非 PostgreSQL race，分别 38.354/6.396 秒通过。readmodel vet 和 diff check 通过。本轮仅扩展测试夹具，没有修改生产校验逻辑。

该验收使用合成事件/回执根绑定与受控 RPC，未执行真实合约。证明 FeeVault→Treasury 的资金与 epoch 归属衔接，不覆盖根请求/批准/发布/最终领取的完整联合生命周期，也不证明外部节点或完整财务发布资格。后续仍须核对 Treasury 自身的累计入账、结转与支付历史。

### 2026-09-07 B03 Treasury 入账/支付/结转事件账本内核

新增 feeledger.TreasuryLedger，按配置 distributor/market/epoch 重放 QuoteTreasuryFunded、TreasuryClaimed 和 EpochRemainderRolledOver。计入 FeeVault 与外部用户的 Quote 注资；领取增加 claimed，outstanding 为当前 funded 减 claimed。结转要求目标 epoch 更晚且金额精确等于源 epoch 未领取余额，将源 funded 清零并保留 claimed，目标 funded 增加结转金额；rolled-over 源 outstanding 固定为零，禁止重复结转或继续入账/领取。

Funded 对应当前 epochQuoteAmount getter，而不是生命周期累计注资；不能在结转后用 funded=0 减旧 claimed 得出负余额。所有更改在交易副本内完成，核对单 epoch uint256 和每个 distributor/资产的总未支付负债范围后提交。根权限、Merkle claim 证明、重复 leaf/account、时间窗口和服务费信用仍由其他校验负责。

测试覆盖 FeeVault+外部注资、领取、带部分已领取的结转、目标继续支付、零余款结转、错误/倒序结转、未知 epoch、错误币种/emitter、聚合溢出和异常时无部分更新。示例总注资 17、累计支付 7，结转后仅剩 10 的未支付负债，不重复计入旧 epoch。feeledger/readmodel/candidate-inspect race 分别 4.743/35.822/5.654 秒通过；本轮未启用可选 PostgreSQL。feeledger vet、全后端构建、diff check 通过。

此内核尚未接入候选 funded/claimed/outstanding 比较与 Treasury RPC 验证，完整财务发布仍未完成。
