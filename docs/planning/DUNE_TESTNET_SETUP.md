# Dune 测试网接入与代币详情页数据配置

证据核对日期：2026-09-08（Asia/Shanghai）

本文是代币详情页正式接入后端的 Dune 配置参考。它补充并服从
[`DUNE_ANALYTICS_BOUNDARY.md`](./DUNE_ANALYTICS_BOUNDARY.md)：Dune 只承担公开、历史、可重算的分析数据；交易报价、余额授权、交易状态、奖励结算、退出和偿付能力仍由 TickerGarden Read API、RPC 与数据库投影负责。

## 当前采用方案

用户已确认：测试网使用现有后端索引。`TG_TOKEN_DETAIL_SOURCE=indexer`（也是默认值），不启动 Dune 轮询，不依赖 Query ID，不上传测试网数据。保存的 Dune Key 可供未来已验证网络使用；只有显式设置 `TG_TOKEN_DETAIL_SOURCE=dune-first` 并提供完整查询配置时才启用 Dune。缺少已确认的索引覆盖时仍显示 `Unavailable`。

## 结论

官方 Dune 已宣布 **Robinhood Chain is now live on Dune**，并有公开的 Robinhood Chain 查询和 `robinhood.logs` 数据引用；Dune 的 Robinhood Chain 页面也已可访问。因此不能再依据旧版目录缺少条目就称 RH 主网未被支持。Dune 数据目录当前也明确列出 **BNB**，并提供 raw、decoded、DEX、token transfers、prices、labels、bridges、gas 等数据层；但该目录没有把 BNB Testnet 单独列为已支持链。目录把 Sepolia、Monad Testnet 等测试网单独列出，因此不能因为 BNB 主网存在就推断 BNB Testnet（chain ID 97）已被 Dune 原生索引。

本项目当前配置的测试链是 **Robinhood Chain Testnet，chain ID 46630**；生产链是 Robinhood Chain，chain ID 4663。Robinhood 官方网络配置确认这两个 chain ID。Dune 的公开公告和页面证明 Robinhood Chain 数据已上线，但公开材料没有明确写出 RH Testnet chain ID 46630 的覆盖范围；必须在 Dune workspace 中用 `robinhood.logs` 等实际表查询并检查 block range，不能把主网公告自动外推为测试网支持。若测试网查询无数据，则使用项目自有采集结果上传表，并可同时向 Dune 申请/确认测试网覆盖。

“上传表”可以让 Dune 查询项目提供的结果，但它不等于 Dune 已经从节点索引该链，也不应成为交易和结算的权威来源。

## 已核实的 Dune 能力

| 能力 | 官方证据 | 对本项目的含义 |
| --- | --- | --- |
| BNB 主网数据目录 | [BNB Chain Overview](https://docs.dune.com/data-catalog/evm/bnb/overview)、[Data Catalog coverage](https://docs.dune.com/data-catalog/overview) | 可尝试用 `bnb.*` 原生表；仍需在实际查询中确认目标合约、表和时间范围有数据。 |
| BNB Testnet | [Data Catalog coverage](https://docs.dune.com/data-catalog/overview) | 目录未单独列出 BNB Testnet；保持“未核实/不可宣称支持”，不要猜测 schema 或表名。 |
| Robinhood Chain 主网 | [Dune announcement](https://dune.com/blog/robinhood-chain-is-now-live-on-dune)、[Robinhood Chain on Dune](https://dune.com/blockchains/robinhood)、[公开查询 8240452](https://dune.com/queries/8240452) | 已确认 Dune 有 Robinhood Chain 数据；公开示例引用 `robinhood.logs`。仍需按表/区块范围验证具体字段。 |
| Robinhood Chain Testnet (46630) | [Robinhood network config](https://docs.robinhood.com/chain/connecting/)、上述 Dune 主网公告与页面 | Dune 公告没有明确给出 46630 覆盖承诺；在 workspace 中实际查询并核对测试网 block range 前，保持“待验证”。 |
| 自有数据上传 | [Bring Your Own Data](https://docs.dune.com/data-catalog/bring-your-own-data)、[Upload Data](https://docs.dune.com/web-app/upload-data) | 可通过 UI/API 建立可查询表；默认公开，Enterprise 才可私有上传。 |
| 增量写入 | [Insert Data](https://docs.dune.com/api-reference/tables/endpoint/uploads-insert) | 已建表可追加 CSV 或 NDJSON；单次请求最大 1.2GB，数据必须匹配 schema。 |
| 表生命周期 API | [Upload API overview](https://docs.dune.com/api-reference/tables/endpoint/overview) | 使用 `/v1/uploads*` 新路径；旧 `/v1/table*` 已弃用。创建、追加、清空、删除都由后端作业控制。 |
| 查询执行/结果 | [Data API overview](https://docs.dune.com/api-reference/api-overview)、[Execution object](https://docs.dune.com/api-reference/executions/execution-object) | 后端用 API key 执行已保存查询并读取结果，浏览器不得持有 key。 |
| 计划查询 | [Query scheduler](https://docs.dune.com/web-app/query-editor/query-scheduler) | 将历史统计按固定周期刷新；后端仍需监控结果新鲜度和 schema。 |
| ABI 解码 | [Contract decoding](https://docs.dune.com/web-app/decoding/decoding-contracts) | 原生支持链上可提交并验证 ABI；未被 Dune 索引的链，提交 ABI 不会单独创建链索引。 |
| 新链申请 | [Bring Your Own Data — Adding new blockchains](https://docs.dune.com/data-catalog/bring-your-own-data) | 以 blockchain representative 身份向 Dune 提交 RH/BSC 测试网支持请求；不要把申请当作已接入。 |

官方目录页面中的覆盖矩阵明确区分 raw、decoded、DEX、transfers、balances、prices 等层。即使某链有 raw 数据，也不能假设有 DEX、balances 或 USD prices；每一项都必须逐项验证。

## 接入方案

### A. 原生链数据（优先用于主网）

适用于 Dune 已明确支持的 BNB 主网及 Robinhood Chain 网络；仍应先核对具体表和合约覆盖：

1. 在 Dune 中确认 chain slug、raw 表、decoded 表和所需 curated 表实际可查询。
2. 提交并验证 Factory、Curve、Hook、Pool、Fee、奖励转换等 ABI；把合约地址加入版本化配置。
3. 用原始事件定义交易量、价格和手续费，禁止用 ERC-20 `Transfer` 总量替代交易量。
4. 为 holders 使用最新正余额快照；应用 TickerGarden 的协议地址排除策略。
5. USD 数据按 `blockchain + contract_address` 精确关联，缺少新鲜价格时返回 `Unavailable`。
6. 将查询保存、调度，并由 TickerGarden 后端缓存最近一次成功且已校验的结果。

### B. RH Testnet / 未确认链：自有索引 + 上传表

在 Dune 确认 RH Testnet 原生覆盖前，使用项目现有链上采集器、PostgreSQL 和 Read API 作为索引权威，生成只读分析快照，再上传到 Dune：

1. 后端按已确认 finality 读取区块和协议事件，生成带 `chain_id`、`block_number`、`block_hash`、`observed_at`、`schema_version` 的事实行。
2. 建议按用途分表：`market_inventory`、`external_trades`、`trade_candles`、`holder_balances`、`quote_prices`。原始整数值和 decimals 必须同时保存。
3. 用 `POST /api/v1/uploads` 创建显式 schema 的表；使用 `POST /api/v1/uploads/{namespace}/{table}/insert` 追加 NDJSON/CSV。生产同步任务需要幂等键，例如 `(chain_id, tx_hash, log_index)`，并在数据侧防止重复。
4. 查询统一读取自有表；若要和 Dune 公共表 join，必须明确链和地址语义，不能假设 RH testnet 可以 join 到 BNB 或 Ethereum 的表。
5. 上传数据默认公开；若包含不应公开的内部数据，不能使用普通上传表，需 Enterprise 私有表或留在 TickerGarden 数据库。
6. Dune 结果仅用于统计展示、历史图表和研究；详情页的实时价格、交易报价、持仓和交易状态继续来自 TickerGarden 后端/RPC。

CSV 上传适合小型一次性快照：官方 UI/API 限制为 200MB，且 UI 更新本质是替换同名文件；持续增量同步应使用显式 schema 的 programmatic table API。官方 Insert API 单次请求最大 1.2GB，并按写入量消耗 credits。

### C. Dune 新链申请

向 Dune 确认或申请 RH Testnet 原生支持时，准备：网络名称、chain ID、RPC/节点访问方式、浏览器、区块时间与 finality、原生币、Genesis/起始区块、测试网和主网区分、协议合约地址、ABI、部署区块、事件定义和预期查询样例。申请成功前仍按 B 方案运行；申请成功后再逐项核对 raw/decoded/curated 覆盖和历史起点。

## 用户/运营方需要完成的配置

### Dune 账户与凭据

- 创建 Dune 账户和团队 workspace，确认计划能否使用 scheduled queries、API 执行和 uploads。
- 创建最小权限 API key；key 只放在后端 secret manager 或运行环境，不写入前端、仓库、日志、查询参数或截图。
- 为上传表和查询确定 namespace、表名、负责人、保留期和公开/私有策略。
- 设置 API 超时、速率限制、失败重试、结果大小限制和 last-known-good 缓存。

### 查询、ABI 和地址

- 保存查询 ID、查询版本、SQL 版本和结果 schema；不要只依赖查询名称。
- 配置 Factory、Curve、Pool/Hook、FeeVault、奖励分配和所有 Stock Token 合约地址，注明 chain ID、部署区块、代码 hash、ABI 版本。
- 配置市场目录：`market_id`、Stock Token、Meme Token、Quote Token、decimals、总供应/流通供应定义和排除地址列表。
- 记录 Dune 表名和来源类型：`native_dune`、`uploaded_snapshot` 或 `ticker_garden_read_api`。

### 调度与新鲜度

- 为详情页建立一个 scheduled query，返回多个 market/period 行；每行以 `payload` JSON 承载 statistics、chart、trades、holders、fees，避免为六个 period 或各 section 分散 query ID。
- 为每个查询配置调度频率、覆盖的最大 block/time、最后成功时间和可接受陈旧阈值。
- 后端每次读取结果都校验列名、类型、chain ID、地址、区块范围、finality 和版本；失败或过期时返回 `Unavailable`/`stale`，绝不能显示合成的 `$0`。
- 建立 Dune credits、HTTP 429/5xx、查询失败、表写入失败、结果行数异常和 ABI 未解码的告警。

## 代币详情页字段的来源约定

| 页面字段 | 首选来源 | Dune 不能满足时 |
| --- | --- | --- |
| Symbol / token name / decimals / 地址 | 已审核市场目录与链上 metadata | Read API/RPC；Dune 只做校验 |
| Market overview Price / 图表 | Dune 历史成交价格，经后端校验 | finalized analytics；这是展示价格，不是可执行报价 |
| Buy / Sell quote / slippage | Read API、Quoter/RPC | 不使用 Dune 延迟结果做交易报价 |
| 24h volume / historical volume | Dune scheduled query 或自有上传表 | Read API finalized event projection；无覆盖则 Unavailable |
| Market cap | 展示价格 × 按明确排除策略计算的流通量；Dune 优先提供经校验的历史输入 | finalized analytics；不是总供应量 FDV |
| Holders | Dune balances 或自有 holder snapshot，应用排除策略 | Read API projection；说明是 positive addresses，不是人数 |
| Circulating supply | 版本化发行/排除规则的 Read API 结果 | 自有索引计算；不从 symbol 或价格表推断 |
| Fee allocation | 协议配置/链上事件与 FeeVault 账本 | Read API；Dune 只能做公开历史核对 |
| Recent trades | finalized protocol event projection | Dune 延迟结果可用于历史列表，不用于交易提交状态 |
| Charts | finalized candles，记录区块范围和 basis | Unavailable/partial，不用插值伪造 |

## 最小实施顺序

1. 先用当前 Read API 固化详情页响应字段和 `Unavailable/stale` 状态。
2. 先为 RH Testnet 建自有快照上传管线；同时向 Dune 提交新链申请。
3. 在 Dune 上创建一个详情 scheduled query，保存 query ID/schema version，并验证每行 payload 和 latest completed 结果满足 [TOKEN_DETAIL_DATA_CONTRACT.md](./TOKEN_DETAIL_DATA_CONTRACT.md)。
4. 后端增加 Dune provider adapter：读取已调度结果、严格校验、缓存 last-known-good，并保留 Read API fallback。
5. 以相同 finalized block/time range 对比 Dune 与 PostgreSQL；整数事件、交易身份、holder 余额必须一致，USD 仅在价格时间戳和容差规则通过后启用。
6. 生产前演练 ABI 缺失、重复事件、reorg、陈旧价格、Dune 429/超时、上传部分失败和 schema 改动；任何异常都进入 stale/unavailable。

## 不确定性与禁止假设

- Dune 官方已明确宣布 Robinhood Chain 上线并提供主网页面/公开查询；本文仍未找到 Dune 官方材料明确承诺 RH Chain Testnet（46630）覆盖，需在 workspace 中实际查询验证或向 Dune 团队确认。
- 没有在仓库中发现现成的 Dune API key、query ID、result cache 或 Dune adapter；不得从环境变量名称推断它们已经配置。
- BNB 主网“已列出”不代表所有 token 都有 balances、DEX 或 USD price；长尾 Stock Token 仍可能没有价格覆盖。
- Dune 上传表是分析副本，不是链上事实证明，也不构成对测试网完整性、finality 或交易可执行性的保证。

## 与当前仓库的对应关系

当前链配置和测试原型见 [`docs/test-prototype/TEST_TECHNICAL_ARCHITECTURE.md`](../test-prototype/TEST_TECHNICAL_ARCHITECTURE.md)；Go API 的默认 `TG_CHAIN_ID=46630` 和运行配置见 [`services/backend-go/README.md`](../../services/backend-go/README.md)。现有 Dune 数据边界、指标定义和 fallback 规则见 [`DUNE_ANALYTICS_BOUNDARY.md`](./DUNE_ANALYTICS_BOUNDARY.md)。

## 本次交付的可执行工具

- [测试网区块/交易覆盖探针](../dune/testnet_coverage_probe.sql)
- [上传表查询 SQL](../dune/detail_uploaded.sql)
- [导出、建表、追加上传步骤](../dune/README.md)
- [字段和响应契约](./TOKEN_DETAIL_DATA_CONTRACT.md)
- [已批准页面基线](./TOKEN_DETAIL_FRONTEND_BASELINE.md)

当前尚未配置真实 Dune Query ID/API Key，也未执行上传或付费查询。测试网原生覆盖核对和账号内查询验收仍需实际 Dune workspace；项目本地 Read API 当前返回 sync unavailable，需恢复索引/投影/发布进程后，才能完成真实链数据的端到端验收。

## 2026-09-08 API 实测补充

已使用用户提供的凭据成功调用 Dune MCP `listBlockchains`，筛选 `canonical`，一次返回 129 条链目录记录，`hasMore=false`。完整无凭据结果保存在 [目录证据](../dune/chain-catalog-2026-09-08.json)。

- 存在 `robinhood`、`bnb`、`opbnb`、`sepolia`、`monad_testnet`。
- 未见单独的 Robinhood Testnet、BNB Testnet、Arbitrum Sepolia 目录项。
- 此接口不提供 chain ID，因此目录缺席仍不能严格证明某个别名下绝无测试网数据；但目前没有可供本项目直接依赖的 46630/97 原生覆盖证据。应按测试网自有索引运行，原生 Dune 接入以确切区块哈希匹配或 Dune 官方确认为准。
- 网页入口为 [Data Catalog 的 Blockchain Coverage](https://docs.dune.com/data-catalog/overview#blockchain-coverage)。Robinhood 的官方表名说明在 [Robinhood Overview](https://docs.dune.com/data-catalog/evm/robinhood/overview)，没有测试网切换说明。

本地凭据已保存在后端被 Git 忽略的 `.env.dune.local`，权限 0600；未写入前端或文档。由于尚无已验证的 Query ID，此文件尚未自动载入 API 进程，避免仅设置 Key 导致成对配置校验失败。目录接口成功仅证明该次认证/目录访问可用，不代表查询执行、上传或付费数据权限已验证。本次没有执行 SQL、创建查询或上传数据。
