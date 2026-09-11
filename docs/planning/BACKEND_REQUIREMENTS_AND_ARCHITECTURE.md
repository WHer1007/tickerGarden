# TickerGarden 后端功能与架构梳理

> 新源码领取路径已切换为用户选择兑换/原币，Holder 双资产分别释放，取消该路径额外 7 天等待。minimumQuote 继续为 0，保留有效期。新版本不支持 operator 集体兑换；以下旧阶段的批量兑换/等待期开关说明仅适用于旧部署。完整行为见 `docs/v1/V1_REWARD_CONVERSION.md`。本次未部署。


> 2026-09-10 当前开发范围已改为 [TypeScript + Node.js + Hono 前端服务任务](../v1/V1_TYPESCRIPT_SERVERLESS_DEVELOPMENT_TASKS.md)。本文保留为 Go 历史功能盘点与改写参考，不再定义本轮技术选型或 B01–B19 全后端排期；本轮仅实现正式前端所需功能及必要数据生产。新服务尚未实施，现有 Go 代码继续保留。

> 2026-09-10 兑换策略更新：项目奖励兑换不设置价格保护，minimumQuote=0，池子模拟仅提供预计到账；20 分钟参考窗口、价格偏离和参考输出折扣不再作为成交门槛。Go 独立参考签名只验证来源和请求身份，不作价格否决。下文历史阶段中关于非零最低到账、滑点下限或参考价价格否决的描述已由本说明取代。未部署，旧合约行为不变。


> 2026-09-07 架构决策更新：生产后端统一为 `services/backend-go`，旧 TypeScript 服务已删除。本文下面的源码盘点与验证记录是迁移前的历史基线，不应据此启动旧服务或判断当前 Go 模块缺失功能。当前入口见 [Services](../../services/README.md)，契约位于 `services/backend-go/openapi/`，纯测试参考算法位于 `testsupport/`。V1 按前端页面需求验收，后续功能判断以当前 Go 实现和实测为准。

第一版范围更新（2026-09-06）：用户明确 B11、B12、B13、B14、B16 为必要功能，必须完成后上线。详见 [第一版范围](BACKEND_V1_RELEASE_SCOPE.md)。原 P1 标签仅表示开发顺序，不表示这些项可从第一版删除。

日期：2026-09-05。状态：**方案建议，尚未实施，不替代 V1 canonical spec、合约权限或发布批准。**

本次按当前工作区代码、正式前端和产品文档梳理。仓库 HEAD 为 `0ca4eca8fae9c719098c112d0031e0345b37c3a4`，但存在大量未提交变更，且盘点期间奖励转换相关实现继续更新，因此该 commit 不能单独复现本次输入。关键来源哈希见同目录 `BACKEND_SOURCE_SNAPSHOT.json`；这是阅读来源记录，不是部署证据。落地前必须冻结完整的源码、ABI、事件目录和部署清单哈希。本文不修改既有代码，也不宣称已部署或生产就绪。

## 1. 建议与范围

建议前端独立构建和发布，后端优先使用 **Go + PostgreSQL + 对象存储**。按职责划分模块，按权限拆开进程；第一阶段不引入大量微服务，不同时维护 Go/Rust 两套业务实现。

后端不仅是 HTTP API，还包括链数据采集、索引投影、链上对账、统计计算、元数据存储、Treasury proof、维护任务、奖励转换和运维审计。资金与权益的最终裁决仍在合约；用户操作仍由用户钱包签名。

梳理采用以下证据层级：

1. `docs/v1/README.md` 指定的 canonical spec/ABI/权限定义；与合约源码交叉验证，冲突列为缺口，不能择一静默覆盖。
2. `apps/web/` 当前正式接入需求及其实际合约调用。
3. `services/` 的现有能力，区分可运行服务、纯计算核心、注入适配器和未完成链路。
4. `apps/web-v2/`、`apps/web-v3/` 的设计功能作为候选用户体验；它们明确使用演示数据，不是新协议版本，也不是已实现的生产接口。
5. 上一轮讨论的空投只预留历史数据与分析扩展。本轮不冻结平台币、积分换币比例、空投资格或分配额度。

## 2. 已有实现与实际缺口

| 模块 | 当前代码证据 | 当前能力 | 尚需补齐 |
| --- | --- | --- | --- |
| Read API | `services/backend-api/src/index.ts:33`；`src/file-repository.ts` | 市场、配置、仓位、健康；revision 固定读取；内存及 JSON 文件快照 | PostgreSQL repository、实时可信发布流水线、搜索/统计/历史/收益等 API |
| 元数据 | `services/backend-api/src/launch-metadata.ts:106` | 独立 `/launch-metadata` POST 与内容寻址 GET；本地文件存储、格式和大小检查 | 持久对象存储、资源配额、滥用控制、图片完整解码与像素限制、备份和取回策略 |
| Indexer | `services/indexer/src/replay.ts`、`projector.ts`、`observation-plan.ts` | 已解码事件投影、回放、重组恢复、区块 observations、对账核心；最新补入转换事件和原币退出投影 | RPC ingest、动态地址发现、历史状态读取、生产 SQL 存储、完整业务读模型与发布任务 |
| Maintenance | `services/maintenance-runner/src/index.ts:1` | 固定 permissionless 动作、模拟优先、注入 transport、重复提交防护逻辑 | 持久任务表、链上 nonce/receipt 恢复、生产提交 transport、调度与告警 |
| 奖励转换 | `services/maintenance-runner/src/reward-settlement.ts` | 批次计划、报价摘要与限额验证、注入 transport | 有权限的 settlement worker、实际链报价、完整事件投影、权益对账、运行配置 |
| Treasury Root | `services/treasury-root-generator/src/index.ts` | 7 天 TWAB、Merkle 树、确定性取整、零资格显式分支 | 完整 Transfer 数据供给、RootRequested 调度、proof HTTP 服务、对象存储、独立发布/审查操作 |
| 前端交易 | `apps/web/src/v1/transaction.ts`、`src/app.ts` | 钱包授权/模拟/签名/回执及本地未知交易恢复 | 生产部署证据及实链 E2E；毕业池 swap 目前仍受发布门限制 |

Read API 的 GET-only 是协议查询命名空间边界；当前可选 metadata POST 已存在。不能据此说整个后端没有 HTTP 写入，也不能说后端完全没有链上操作：维护、奖励转换、Root 发布属于不同权限的后台操作。

当前快照适配器不等于生产索引数据库。Indexer CLI 也不等于已运行的链日志采集服务。Generator 能生成 Root 不等于用户可以通过 HTTP 获取有效 proof。

## 3. 前端、后端、钱包和合约的边界

| 工作 | 前端 | 后端 | 钱包/合约 |
| --- | --- | --- | --- |
| 页面、交互、草稿 | 渲染、表单、临时草稿、金额输入、自选 | 可选的跨设备偏好存储 | 无 |
| 市场、资产、历史和统计 | 当前接入市场/配置/仓位；历史和完整统计待 P1 API；展示数据时间与状态 | 索引、聚合、查询、参考价及来源 | Registry/Factory/链事件是事实来源 |
| 身份与地址 | 校验链、账户、合约绑定；拒绝未知地址 | 提供部署信息、地址图和绑定证据 | 链上不可变关联及实际 runtime 最终确认 |
| 创建、交易、质押、退出、领取 | 组装已知 ABI 调用、fresh checks、模拟、回执验证 | 提供可验证读数据和 metadata；不托管用户操作 | 用户钱包签名，合约执行 |
| 报价 | 当前 Curve 直接链上调用；保存期限和最低到手 | 可选 canonical Quoter 代理，不能用行情 K 线代替执行报价 | 当前链状态、实际模拟及 min-out/deadline 约束 |
| Treasury | 获取 proof 并本地验证，再读链上 epoch/root | TWAB、数据集、proof 查询；受控发布流水线 | 用户领取；独立 publisher/reviewer 角色；合约检查 |
| 运维交易 | 普通页面不暴露平台密钥或管理 selector | 分权限 worker，固定动作、预算、模拟与持久记录 | 独立运行账户或受控签名设施 |
| 本金紧急退出 | 保留直接链上核验和钱包操作 | API 故障不得阻断这一入口 | Factory→Registry→Vault 证明身份并返回本金 |

“前后端分离”不意味着浏览器完全不能访问 RPC。把所有交易核验强制依赖后端，会破坏当前 API 不可用时的本金退出能力。公共 API 不提供任意 calldata 代签/广播接口。

## 4. 功能清单与验收口径

优先级：P0 为基础运行必需；P0-G 为启用对应业务前必需；P1 为完整发现/分析体验；P2 为可选扩展。未启用功能的 UI 必须明确不可用，不以演示结果替代。

| ID | 功能 | 优先级 | 输入与输出 | 最低验收 |
| --- | --- | --- | --- | --- |
| B01 | 网络与部署配置 | P0 | chainId、真实部署地址、ABI/version/codehash、Factory 绑定、能力状态 | 主网/测试网隔离；不把部署计划当真实部署；远端布尔值不能自行开启交易 |
| B02 | RPC 采集与合约发现 | P0 | 区块头、receipt/log、Factory/Registry、canonical pool | 从部署块补全历史；断线补采；不漏创建同一交易内的新合约日志 |
| B03 | 投影、重组与对账 | P0 | 原始事件＋指定区块状态读取→读模型 | 全量重建与增量结果一致；重组回滚关联数据；缺探针不算对账通过 |
| B04 | 市场与资产目录 | P0 | 市场事实、STOCK/Quote/Pons/template 配置、metadata | 一市场一 STOCK Base；Base 可用不等于 Quote 已 ACTIVE；分页固定 revision |
| B05 | 创建配套服务 | P0 | 图片/名称/描述/链接→不可变 metadataURI；可选配置列表 | 元数据可持久读取；校验与前端一致；expectedEconomics 最终以 Factory 为准 |
| B06 | 用户本金与仓位 | P0 | 后端提供 Vault 总本金/free、市场 allocation、pending/active/时间；钱包余额仍由前端 RPC 读取 | 本金与收益分离；Vault free 按账户/资产返回一次，不能跨市场重复汇总 |
| B07 | Staker/Creator 收益 | P0 | 实际 fee 资产、角色、creator epoch、未领/已领/待转换 | Quote/Meme 保留原始数量；新 beneficiary 不获得旧 epoch 权益 |
| B08 | 原币退出与奖励转换 | P0-G | rawRewardExitAt、转换批次、Meme spent/Quote received | 权限、32 项上限、报价/期限、原币退出状态、部分成交退款及实际权益归属一致 |
| B09 | Treasury 状态与 proof | P0-G | market/epoch/root/request/claim/service credit、Transfer 历史 | 从发行起完整历史；proof 域一致；空资格与服务失败区分；链上领取检查 |
| B10 | 常规维护 | P0 | sweep/checkpoint/flush/settle-rage-quit/treasury-activate | 执行前 fresh simulate；未知提交不重复签名；完成以回执和后置状态为准 |
| B11 | 搜索、筛选和排序 | P1 | 名称、symbol、地址、marketId、STOCK、阶段、时间 | 对整个目录查询；不能仅对浏览器已加载前 100 条进行全站排名 |
| B12 | 成交、K 线与活动流 | P1 | Curve/Pool trades、amounts、方向、时间、账户身份可信度 | 价格单位与手续费口径清晰；无成交区间不伪造成交；内部奖励转换单独分类 |
| B13 | 首页和全局统计 | P1 | 市场数量、按资产成交量/费、持有人、STOCK 配置等 | 区分存量/流量；按资产记账；不把 Curve reserve 称为成交量 |
| B14 | 参考价格 | P1 | 允许的数据提供方、价格/乘数/时间/可信度→展示估值 | 缺价返回 null/陈旧状态；不得控制链上结算；REST multiplier 只乘一次 |
| B15 | 用户活动与交易状态 | P1 | 链上交易/receipt、用户历史、确认和重组状态 | unknown/pending/confirmed/finalized/reorged 区分；状态查询不代替用户签名 |
| B16 | 实时更新 | P1 | 已发布 revision、市场/仓位变更→轮询或 SSE | 重连后从 revision 补读；缓存失效有界；head 提示不冒充 finalized |
| B17 | 服务运维与审计 | P0 | 同步、对账、RPC、worker、存储、角色操作记录 | readiness 与进程存活分离；积压/失败/身份变化告警；备份恢复演练 |
| B18 | 账户偏好与运营内容 | P2 | 钱包验证、自选、通知设置、精选说明 | 公共链数据读无需登录；链下编辑验证所有权；精选不改变链上市场事实 |
| B19 | 空投贡献分析预留 | P2 | 已 finalized 行为、版本化规则、关联与申诉记录 | 不从页面点击认定资金行为；与本金/费用/Treasury 完全独立；本轮不实现发币 |

P1 中的图表、搜索和统计一旦列入首发 UI，就必须提升为该版本的验收项；不能用“后续完善”交付一个依赖这些数据的完整页面。

### 4.1 市场与发现数据

市场基础响应补充 metadataURI、名称/符号/图片、creator/beneficiary epoch、创建时间、creatorTaxBps、各配置 ID、最小配置额及可核验来源。metadata 中的 tax 仅用于展示，合约的创建快照才是权威。

链上生命周期只有 `NotGraduated -> PoolCreated`。页面风险标记、运营隐藏、服务可用性均独立命名，不得制造链上“暂停市场”“正在恢复”“毕业重试”状态。Asset/Quote 等 Registry 配置状态也不能当作已部署市场的生命周期。

热门、涨幅、成交量排行必须明确窗口、单位、排除规则及缺价处理。初期可用 PostgreSQL 索引/文本搜索，不预先引入独立搜索集群。

### 4.2 本金、收益与最新奖励转换

本金账户按 `(chainId, assetUid, user)` 记录；市场 allocation 按 `(chainId, marketId, user)` 记录。`allocated` 是总占用，`pending/active` 是其组成，不能全部相加；rageQuit tombstone 表示异步奖励清理，不是仍托管的本金。

收益按 `(chainId, marketId, beneficiary, role, creatorEpoch, feeAsset)` 保留账本。API 必须区分 Meme 原始未领金额、可转换金额、Quote 可领金额、原币退出等待时间及当前 claim 是否满足锁定条件。所谓自动转换不能被描述为固定汇率、保证完成或即时可领。

当前合约源码 `ProtocolFeeVaultRewardSettlement.sol` 已实现：

- `settleRewards` 仅 `settlementOperator`；该角色由固定 platform treasury 设置。权限矩阵也列明 `SETTLEMENT_OPERATOR`，不是 permissionless runner。
- `ConversionItem.creatorEpoch == 0` 表示 Staker；非零按历史 Creator epoch 识别受益人。
- 原币退出等待 7 天；等待期中转换仍可能进行，到期后 worker 必须排除相应用户；这与 STOCK 本金即时 rageQuit 是两个功能。
- 批次最多 32 项、非零 minimumQuote、deadline 不超过未来 5 分钟；部分成交按合约分配并退回未消耗奖励。
- 新增 `RewardConverted`、`RewardBatchConverted`、`RawRewardExitRequested/Cancelled`、`SettlementOperatorUpdated` 需要完整索引和对账。

这些是当前源码能力，不是已部署结论。最新 `docs/v1/V1_REWARD_CONVERSION.md` 已描述 Quote 默认领取、待转换和原币退出边界；迁移必须同时覆盖该文档、合约及权限矩阵，不能仅照搬较早的服务 README。

转换 worker 每批 fresh 读取当前 operator 身份、用户可处理额度与原币退出状态；需轮转市场/受益人，限制单批金额和总 Gas 预算。链上 minimumQuote > 0 并不足以保证合理价格，报价源、独立价格参考、流动性阈值及异常暂停需要生产实现。Hook 的约 100 bps sqrtPrice 变化限制约对应 2% spot 价格变化，不能宣传为 1% 成交滑点保证。`referenceId` 也不是价格正确性证明。

Creator tax 是 0–500 bps 的额外税，全部归 Creator；基础费的 40/30/30 或 70/0/30 只应用于基础费。需要分别展示基础费、creator tax、适用的 Curve anti-snipe 及 Gas，不能把总费用恒定写成 1%。报价采用合约真实买卖路径，不用统一百分比猜算。

### 4.3 Treasury 完整工作流

链上 `RootRequested` → 获取其固定 source block/hash、时间窗、金额及策略 → 完整 Transfer 历史回放 → Root/叶子/公开数据集 → 独立复算审阅 → 授权 publisher 发布 → 独立 review 角色可取消 → 延迟后 permissionless finalize → 用户获取 proof 并自行 claim。

服务还需覆盖注册/激活、资金存入、Meme burn、request 过期、epoch 结转、claim 状态、service credit/退款。`treasuryEnabled` 元数据偏好本身不会注册、激活或注资，也不自动把 platform fee 转入 Treasury。

Root 算法和线上流水线分别验收；proof 被链上 Merkle root 接受不等于平台分配数据天然无须信任。缺失历史、RPC 失败、空返回都不能生成零资格 Root。

## 5. API 清单

### 5.1 保留现有兼容面

| Method/path | 用途 |
| --- | --- |
| `GET /health` | 当前客户端依赖的协议及 sync 状态 |
| `GET /v1/markets` | 市场目录；保留 assetUid、limit、cursor、revision |
| `GET /v1/markets/{marketId}` | 市场详情与 canonical route |
| `GET /v1/config/{kind}` | asset/quote/pons/template 配置 |
| `GET /v1/users/{address}/positions` | 当前仓位兼容接口 |
| `POST /launch-metadata` | 现有创建元数据接口，独立的链下写入边界 |
| `GET /launch-metadata/{hash}.{extension}` | 现有内容寻址资源 URL |

现有 metadata 接口不在 GET-only 客户端的五个接口内。迁移应另建其 OpenAPI 描述，不能扩展成“公共协议 API 可以任意链上写入”。旧 metadata URI 要长期可取，不能迁移后失效。

### 5.2 新增建议，尚未实现

| Method/path | 内容 | 优先级 |
| --- | --- | --- |
| `GET /v1/runtime` | 网络、部署清单版本、服务能力与缺失原因；不替代客户端固定信任根 | P0 |
| `GET /v1/users/{address}/vaults` | 按 STOCK 返回总本金、free、占用，避免市场行重复求和 | P0 |
| `GET /v1/users/{address}/rewards` | Staker/Creator 分资产、epoch、转换/原币退出状态 | P0 |
| `GET /v1/markets/{marketId}/creator-epochs` | 当前与历史 beneficiary/epoch | P0 |
| `GET /v1/treasury/markets/{marketId}/epochs` | epoch 列表 | P0-G |
| `GET /v1/treasury/markets/{marketId}/epochs/{epochId}` | 链上 epoch/root/request/claim 时间与额度 | P0-G |
| `GET /v1/treasury/markets/{marketId}/epochs/{epochId}/claims/{account}` | **正式前端已经调用此路径，但当前 Read API 未实现**；返回现有 proof schema | P0-G |
| `GET /v1/users/{address}/treasury-credits` | service credit/退款，按资产分别返回 | P0-G |
| `GET /v1/markets/{marketId}/trades` | 成交历史、经济类别、用户身份来源 | P1 |
| `GET /v1/markets/{marketId}/candles` | interval/from/to、OHLCV 与价格单位 | P1 |
| `GET /v1/markets/{marketId}/holders` | 来自完整 Transfer 的持有人快照，排除地址策略公开 | P1 |
| `GET /v1/stats/overview`、`GET /v1/stats/series` | 全局摘要与时间序列；原资产及估值分开 | P1 |
| `GET /v1/prices/references` | 参考价、来源、asOf、过期与 unavailable 状态 | P1 |
| `GET /v1/users/{address}/activity` | 已验证用户链上活动与分页 | P1 |
| `GET /v1/transactions/{txHash}` | 指定网络 receipt/确认/重组状态 | P1 |
| `GET /v1/stream` | SSE 变更通知；可先使用固定 revision 轮询 | P1 |
| `GET /livez`、`GET /readyz` | 进程存活、依赖与数据就绪；保留 /health 兼容性 | P0 |

搜索、阶段、排序可扩展现有 `/v1/markets` 查询参数，无需另建平行市场事实接口。错误码、限流和 revision 过期行为写入版本化 OpenAPI，统一生成 TypeScript SDK；Go handler/model 也从同一个语言中立的接口契约生成或校验。

可选未来接口：只读的报价代理、需要钱包身份验证的跨设备自选/草稿/通知。第一阶段不创建后端托管订单、撮合引擎或用户资金账本。

### 5.3 响应与一致性约束

- 所有 raw amount、uint256、累计计数和可能超 JS 安全整数的字段使用十进制字符串；原始精度与 decimals 同时明确。
- 当前兼容响应保留 `sync`、`source`、`revision`。新聚合结果补充 `asOfBlockNumber/Hash/Timestamp`、`computedAt`、`formulaVersion`、覆盖范围和完整性；不可伪造单一源交易。
- 事件 provenance 与读取状态的 observation block 分开。事件交易不是该区块末余额的完整来源；同块多次状态变化不能反复套用末状态。
- `synced` 意味着需要的数据范围已完整采集并通过必需对账，不能仅指 HTTP 200、文件刚更新或数据库非空。
- 确认链支持的 finalized/safe 语义；不支持时不得将“等待若干块”直接标为 `finalized` 来迎合现有前端。策略变化需要显式协议/API 对齐。
- 业务查询绑定一个网络；初期每条链独立部署实例/数据库或严格 schema 隔离，现有 URL 无 chain 参数时由实例固定。所有内部键、缓存键和任务键仍含 chainId。
- revision 在分页间一致，过期/重组后明确要求重读；并行请求不能混合新旧状态。平台币/积分预期不混入现有链上权益字段。
- stale 的浏览数据可以带状态展示；资金操作继续遵守前端 fail-closed 规则，本金 direct escape 保留独立路径。

## 6. 链数据工程

采集流程：验证 chainId/部署起点 → 拉区块头和 receipts/logs → 验证父哈希与 canonicality → ABI 解码与 emitter 身份过滤 → 获取必需 historical observations → 原子写入事件、投影、对账结果与 checkpoint → 发布 read revision → 通知缓存/API。

必须处理以下情况：

1. WebSocket 只用作新区块提示；HTTP 补采与 checkpoint 决定完整性。空块仍推进区块头及时间状态，不以最后一条业务事件代替链 tip。
2. 动态发现 Factory 创建的 Meme/Curve/Gauge/Hook 等合约。创建、初始 mint、开发者首买甚至毕业可能在同一交易中，新增地址后必须回读完整 receipt，不能只等下一区块。
3. 允许的 emitter 必须在对应链、区块和合约角色下成立；ERC20 Transfer 签名相同不等于资产身份相同。
4. block-tagged view 要求 archive/historical state 能力。优先绑定 blockHash；只能按 blockNumber 读取时前后校验区块哈希，发生漂移重试整个 observation 集合。
5. 不把区块末 view 应用到同块每条日志当成逐事件状态。需要中间态时使用足够的日志/trace 或已验证重放；观察粒度和字段来源必须明确。
6. 日志重复、RPC 限流、分段限制、节点分歧、孤块、断电均可恢复。重组范围超出保留 checkpoint 时停止发布并从可信点重建。
7. pending 激活/解锁具有时间语义，即使用户没有新交易也需要定时或新块刷新相关 view；浏览器倒计时不是已激活/可领取的最终证明。
8. 普通 Swap 与 Hook fee 在同交易/同池正确关联；同交易多个 Swap、路由合约代发、内部奖励转换分别覆盖。不能直接把 `Swap.sender` 当最终用户，也不能将奖励转换算作新增获客行为。
9. 对账检查覆盖计划本身持久化；零条 probe 得到零告警不意味着完整对账。记录应完成/实际完成的 probe 数、资产/市场覆盖和 hash。
10. FeeVault 按市场/资产/角色/epoch 对账，Vault 覆盖实际本金与资产偿付，Gauge 覆盖 pending/active/奖励。根与 proof 还需独立 Treasury 金额守恒和输入历史完整性验证。

## 7. 存储建议

PostgreSQL 是持久查询/任务状态库，对象存储保存元数据、图片、Root 数据集与大体量审计输出。Redis 初期可不部署；使用时只作可重建缓存和通知辅助，不存唯一账本或唯一任务状态。

| 数据组 | 建议表/实体 | 关键约束 |
| --- | --- | --- |
| 网络与原始事实 | chains、deployments、blocks、raw_logs、contract_bindings、chain_observations | 原始日志按 chain/blockHash/txHash/logIndex 唯一；canonical view 单独限制；保留孤块审计 |
| 同步与发布 | checkpoints、reconciliation_runs、reconciliation_probes、published_revisions | 投影、检查完成度和 revision 原子发布；来源块可复算 |
| 业务目录 | assets、quote_configs、pons_baselines、launch_templates、markets、pool_bindings | 配置版本和状态；canonical ID；每市场固定 Base/Quote |
| 本金和收益 | vault_accounts、allocations、gauge_positions、fee_credits、fee_claims、creator_epochs | 账户/资产级本金与市场级配置分开；历史 epoch 权益不改归属 |
| 交易和统计 | trades、token_transfers、token_balances、candles、market_daily_stats、price_references | 逐事件去重；聚合可回滚/重建；内部交易单独分类；原资产单位保留 |
| 奖励转换 | raw_reward_exits、reward_conversion_batches、reward_conversion_items | operator/nonce/digest/金额/输出/退款及 source revision 可追踪 |
| Treasury | treasury_markets、treasury_epochs、root_requests、root_datasets、claim_leaves、treasury_claims、service_credits | chain/distributor/market/epoch/root 绑定；不可覆盖已发布数据集 |
| 链下内容 | metadata_objects、media_objects、content_annotations | 哈希与 MIME、尺寸、所有权/配额；运营注释独立于不可变元数据 |
| 任务与运维 | jobs、job_attempts、tx_submissions、audit_events | lease/幂等键/nonce/txHash/receipt 状态持久化；多实例不重复执行业务 |

金额可采用 `NUMERIC(78,0)` 存 uint256，但必须额外检查 `0 <= x <= 2^256-1`；有符号 Swap delta 单独定义范围。TWAB 与累计中间运算需要足够宽的整数，不依赖数据库或语言默认整数溢出行为。公开 API 保持字符串。

对于 replay event key，现有 TS 使用 chain/txHash/logIndex。SQL 原始日志额外保留 blockHash 以区分重组分支；向兼容投影输出时仍可保留原事件键，不得让孤块与 canonical 分支同时生效。

## 8. 进程与权限部署

建议一个 Go module、共享领域包，按可执行入口拆分。目录名为建议，不在本轮创建：

```text
services/backend-go/
  cmd/api/                 公共查询与 proof，无链上签名密钥
  cmd/indexer/             RPC 采集、投影、对账
  cmd/content-worker/      metadata/media 处理
  cmd/maintenance-worker/  permissionless 固定动作
  cmd/settlement-worker/   SETTLEMENT_OPERATOR 奖励转换
  cmd/treasury-worker/     Root 计算、数据集/proof；不持 publisher 权限
  internal/{chain,indexer,market,position,reward,treasury,content,jobs,store,httpapi}/
  migrations/              SQL 迁移文件，发布时独立执行
```

前端通过 HTTPS 调用 API；用户钱包通过 RPC 与合约交互。Indexer 把链数据写入 PostgreSQL，worker 从持久任务表消费；API 读已发布的 revision。静态前端、API、worker 可独立构建、发布和回滚。

各进程用不同数据库用户和角色。公共 API 没有修改链上权益或调用平台签名器的权限。维护账户只承担 Gas 与固定动作；settlement signer 与 Treasury publisher 分离；Root reviewer 与 publisher 独立。发布平台 Root 的工具/审批通道单独建设，不复用公众 HTTP 路由。

维护任务的“恰好一次”不靠宣称：持久化业务幂等键、发送者 nonce、签名前意图、已签名交易 hash/字节、广播状态和 receipt；网络超时后先查已有提交与 nonce。允许恢复查询或重发同一 signed transaction，但不能因为超时生成第二笔同业务新交易。普通用户钱包交易仍以其钱包流程为准。

对象写入与 SQL 无分布式事务时使用内容哈希、暂存状态和清理任务。已经提交到合约的 metadataURI 必须保持可取；不能直接清除所有“未登记对象”。缓存 key 包含链、revision、查询参数及算法版本，重组后立即失效。

## 9. Go 与 Rust 的选择

| 维度 | Go | Rust |
| --- | --- | --- |
| 本项目主要工作 | HTTP、RPC 调度、SQL、任务、日志与监控适合统一实现 | 同样可实现，但需要更多 async/类型组织与依赖整合决策 |
| EVM 接入 | go-ethereum 提供 RPC client、ABI 与类型化 bindings | Alloy 提供 provider、ABI/类型化合约 bindings |
| 金额与内存 | `math/big.Int` 可用，但需限制可变别名共享、补足 uint256/取整约束 | U256/大整数可用；仍要明确 checked 运算与 Solidity 取整规则 |
| 性能决策 | 先验证 RPC/数据库、历史补采与大数据集内存瓶颈 | 已有 Rust 团队或测得 CPU/内存热点时更有理由选择 |
| 运维与团队 | 建议作为当前默认方案，减少双语言迁移成本 | 团队明确更熟悉 Rust 时可全栈后端统一选择 |

推荐 Go 是工程判断，不是已有性能基准结果。当前问题是可信数据流水线和业务覆盖，不是已证明 Go 无法满足的 CPU 瓶颈。

建议 Go 技术组合：标准库 HTTP、go-ethereum、pgx/sqlc、PostgreSQL、兼容对象存储协议的客户端、结构化日志与 OpenTelemetry。具体依赖版本、代码生成器对 OpenAPI 3.1 的支持和维护状态在实施阶段验证后锁定；本文不引用“最新版本”作固定要求。Rust 备选为 Axum/Tokio + Alloy + SQLx + PostgreSQL，选用前做同样的 ABI/OpenAPI/数据库兼容验证。

官方资料（2026-09-05 查询）：[Geth developer tools](https://geth.ethereum.org/docs/developers)、[Alloy architecture](https://alloy.rs/introduction/architecture/)、[sqlc](https://docs.sqlc.dev/)。以上支持工具能力描述，不构成对本项目吞吐的测量。

## 10. 迁移与开发顺序

| 阶段 | 工作包 | 完成标准 |
| --- | --- | --- |
| M0：冻结协议与接口 | 整理源码/ABI/事件/权限的版本覆盖；确定网络与真实部署输入；记录 OpenAPI 兼容面；整理当前 TS 测试向量 | 每个新旧业务状态有明确来源、权限和字段；不得留下未识别奖励事件或未知部署地址 |
| M1：Go 数据底座 | module、SQL schema、chain client、历史 ingest、动态发现、revision、重组/对账；保留五个 GET 兼容接口 | 固定区块集空库重建；断线/重复/重组/进程重启一致；前端能读真实验证快照 |
| M2：用户流程闭环 | metadata、目录、Vault/positions、Staker/Creator、raw exit；迁移客户端契约 | 正式前端每条启用流程从链读取到钱包回执闭环；不删减原有验证 |
| M3：后台与 Treasury | permissionless worker、独立 settlement、Root worker、proof API、publisher/reviewer 流程 | 提交不确定恢复、角色隔离、转换与 TWAB/proof 对账；对应发布门单独通过 |
| M4：发现与分析 | 全局搜索、trades/candles、holders、统计、参考价、实时刷新 | 服务端完整目录查询；统计可复算；无演示金额、隐含跨资产加总或重复本金 |
| M5：切换与运行验收 | Go/TS 对照、备份恢复、负载和故障演练、正式前端 E2E、独立发布 | read API 同 snapshot 等价；所有启用业务与生产门禁闭合后切换 |

M1–M3 的 P0/P0-G 决定可启用的首发业务。若首发采用 V3 的图表/搜索/排行，则 M4 相应工作也属于上线范围。不要把仅兼容五个 GET 的服务称为“后端全部完成”。

迁移期间 TS 用作参考实现与可用对照，不作为 Go API 的隐藏运行时依赖。统一 OpenAPI/schema 和 ABI 向量生成前端 SDK，前端不再依赖后端源码路径/Node 服务。Go 与 TS 在同一 finalized 数据集上对比整数值、来源、分页、Root hash/proof；响应对象 key 顺序可规范化，但哈希输入的字节顺序不能任意改变。

读服务可以并行 shadow；有写权限的 worker 同一时刻只启用一套。切换前迁移/验证 job 与 tx journal，确认旧 worker 已停止且新 worker 取得 lease，防止双重执行。数据库迁移和实际切换属于后续实施动作，本轮没有执行。

## 11. 验证与运行指标

必须验收：Go/TS/Solidity 的整数及哈希向量；同块创建并首买/毕业；重复日志、receipt 缺失、分叉、深重组；所有必需 view/probe 覆盖；跨市场 free 重复显示；Creator epoch 切换；creator tax/anti-snipe 分账；奖励转换部分成交与 raw exit 到期；Treasury root/proof/空资格/退款；未知广播与重启恢复；API 不可用时本金 direct escape。

API 契约检查包括全部必填字段、错误与陈旧状态、固定 revision 分页、多链隔离、非法/极端整数、默认分页限制。认证只用于私有偏好/运营操作；metadata 限制不能把 CORS 当认证。外部 metadata 拉取需限制协议、重定向、内网地址、超时与响应大小，图片须限制解码资源。

监控至少包括：head/finalized/indexed height 与 lag、RPC 错误/限流/历史状态可用性、对账覆盖和失败、reorg 深度、job age/attempt、tx unknown/nonce 冲突、Root request 截止时间、proof 可用性、转换积压、签名角色变更、存储失败、API p95 与错误率。

性能目标必须先绑定数据规模、RPC 限额和机器规格再确定。初始建议以“常用分页读取 p95 不高于 300ms（不含客户端网络）”作为待压测目标；不是现有能力声明。索引追赶、转换周期、Root 完成时间按实际链速/数据量及链上截止窗口制定，不盲目承诺秒级 finality。

本轮为源码与功能盘点，不运行全仓生产验收，不生成部署证据，不修改已批准的权限或经济规则。

## 12. 关键证据索引与待对齐事项

| 证据 | 用途 |
| --- | --- |
| `apps/README.md`；`apps/web/README.md:7` | 正式页面和用户流程 |
| `apps/web-v2/README.md:29`；`apps/web-v3/README.md:29` | 演示设计版本边界与候选需求 |
| `apps/web/src/app.ts:847` | 当前 Stats 为目录/储备聚合，部分字段 Not exposed，非完整成交统计 |
| `apps/web/src/runtime/model.ts:79` | finalized/revision 校验，不能伪造终局状态 |
| `apps/web/src/v1/features/treasury.ts:157` | 已有 proof HTTP 调用与响应 schema |
| `apps/web/src/app.ts:2770` | 新原币退出等待与钱包调用 |
| `services/backend-api/src/index.ts:33` | 真实路由面与 GET-only 协议边界 |
| `services/backend-api/src/generated/v1-client.ts:9` | 当前 Market/Position 数据模型覆盖有限 |
| `services/indexer/src/schema.ts:62`；`src/projector.ts:395` | 当前表与投影覆盖，通用事件记录不等于业务投影 |
| `services/indexer/src/observation-plan.ts:3`；`src/reconciliation.ts:30` | 补充状态与对账核心，仍需完整生产输入适配器 |
| `services/maintenance-runner/src/index.ts:1`；`src/reward-settlement.ts` | permissionless 维护与新增转换计划需要不同权限部署 |
| `contracts/src/v1/shared/ProtocolFeeVaultRewardSettlement.sol:20`；`spec/v1_permissions_matrix.json:28` | 当前奖励转换及原币退出边界 |
| `docs/v1/V1_REWARD_CONVERSION.md` | 最新默认 Quote 领取、价格执行、原币退出、独立运维 transport 边界 |
| `contracts/src/v1/shared/TickerGardenRewardConversion.sol:29` | 转换在 canonical pool 内执行，不能当普通新用户交易 |
| `docs/v1/V1_CREATOR_TAX.md:7` | 额外 creator tax 与基础费分离 |
| `docs/v1/V1_TREASURY_ARCHITECTURE.md:20` | Treasury 不自动从手续费分配中注资 |
| `docs/v1/V1_STOCK_QUOTE_PRICE_REFERENCE.md:24` | 外部参考价与 multiplier 边界 |

最后复核：新 FeeVault 奖励转换事件已进入生成目录；projector 已有 Staker conversion 和 `rewardExits` 投影，observation plan 已有转换后双资产负债和 Staker 状态读取。不能再把这些能力列为“完全缺失”。但 Creator 转换主要仍作为原始事件保存，batch 事件没有独立业务表；公开 API 尚未暴露完整 raw exit、转换批次、Creator epoch 和 Treasury 业务响应，生产状态读取/调度/签名 transport 仍需接入。

已执行并通过 `npm --prefix services/backend-api run check:openapi` 与 `npm --prefix services/indexer run check:events`。这仅证明当前接口/事件生成物与相应生成输入一致，不是从 Solidity 源码重新编译后的全仓检查，更不是完整业务闭环或部署验证。部分历史 README 的 readiness/领取描述不能覆盖最新工作区；M0 需按哈希冻结统一版本。

当前未确定但不妨碍功能梳理的产品输入：首发采用正式 V1 UI 还是将 V3 设计接入；首发是否开启 Treasury/奖励转换；正式网络及 RPC 的历史读取/finality 能力；目标规模、运行预算及团队 Go/Rust 熟悉程度。这些在对应实施阶段确定，本文默认 Go、正式 V1 能力为基线，并完整列出 V3 候选数据需求。
