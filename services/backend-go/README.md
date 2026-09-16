# TickerGarden Go 后端

> 2026-09-10：当前前端服务开发方向已切换为 [TypeScript + Node.js + Hono Serverless](../../docs/v1/V1_TYPESCRIPT_SERVERLESS_DEVELOPMENT_TASKS.md)。本模块继续保留作为改写参考与切换前运行来源；下文 Go-only 描述的是本模块现状，不再限制新服务选型，也不要求移植全部后台命令。新 TypeScript 服务尚未实现。

> 新源码领取路径已切换为用户选择兑换/原币，Holder 双资产分别释放，取消该路径额外 7 天等待。minimumQuote 继续为 0，保留有效期。新版本不支持 operator 集体兑换；以下旧阶段的批量兑换/等待期开关说明仅适用于旧部署。完整行为见 `docs/v1/V1_REWARD_CONVERSION.md`。本次未部署。


> 2026-09-10 兑换策略更新：项目奖励兑换不设置价格保护，minimumQuote=0，池子模拟仅提供预计到账；20 分钟参考窗口、价格偏离和参考输出折扣不再作为成交门槛。Go 独立参考签名只验证来源和请求身份，不作价格否决。下文历史阶段中关于非零最低到账、滑点下限或参考价价格否决的描述已由本说明取代。未部署，旧合约行为不变。


独立 Go module `tickergarden/backend`，前后端分离。使用 Go 1.27.1、Chi、pgx、Goose、`log/slog` 和 JSON Schema 校验库。API 与索引器运行不需要 Node.js；开发时的 TypeScript 兼容性检查需要 Node.js 22.13+。

当前已实现原始链日志索引、finalized 市场发现、已对账快照的发布与持久化、五类 V1 GET 接口。已实现业务事实投影及市场、Gauge、Vault、FeeVault、Holder/Treasury 的部分区块补读；**完整独立对账与自动财务快照发布仍未完成**。快照发布者是受信任的生产者；空的 `reconciliationAlerts` 仅是其声明，不能独立证明余额正确。前端通过统一 Read API 契约对接本模块；旧 TypeScript 服务已移除。生产运行不依赖 Node，OpenAPI 和测试参考算法由本模块维护。

## Go-only 服务边界（2026-09-07）

所有生产后端入口位于 `cmd/`；`openapi/v1.json` 和 `openapi/v1.lock.json` 是 Read API 契约，`scripts/generate-openapi.mjs` 生成浏览器 SDK，前端从 `openapi/generated/v1-client.ts` 同步。Node 只用于开发工具和独立回归测试。

下文包含按阶段累计的实现记录；早期“尚未实现”描述应结合后续对应模块章节和当前代码阅读，不代表本轮完成了全部上线验收。`/create` 的内容上传需单独运行 `content-worker`，并配置其数据库、公开 origin 和允许的前端 origin；只启动 `api` 不会启用上传。

## 本地启动

```sh
cd services/backend-go
cp .env.example .env
make run
```

本机 Go 已升级为 Homebrew 的原生 Apple Silicon Go 1.27.1。其他环境按 `.go-version` / `go.mod` 安装对应版本。Makefile 会加载 `.env`；直接启动二进制只读取已导出的环境变量。

默认绑定 `127.0.0.1:8790`：

| 接口 | 行为 |
| --- | --- |
| `GET /livez` | 200，进程存活 |
| `GET /health` | V1 HealthResponse，包含完整 sync 与 revision |
| `GET /readyz` | 数据库可连接、最新发布与索引器均新鲜、快照仍属于已确认主链时为 200；否则 503 |
| `GET /v1/markets` | 市场列表，支持 assetUid 过滤 |
| `GET /v1/markets/{marketId}` | 市场详情，缺失返回 404 |
| `GET /v1/config/{asset\|quote\|baseline\|template}` | 配置列表 |
| `GET /v1/users/{address}/positions` | 用户仓位与 Quote/Meme 可领取额 |

无数据库、无发布或存储异常时，列表返回空数组及 `sync.status=unavailable`，不会虚构市场。已发布但过期的快照仍可供展示，sync 会标记 unavailable；`/readyz` 不再为 200。存储异常记录脱敏日志。`readApiImplemented` / `productRuntimeImplemented` 按现有 V1 HealthResponse 契约表示读 API 运行时存在，不表示所有后端业务或自动投影已完成。

协议接口拒绝写方法（405）。请求 ID、JSON 访问日志、panic 恢复和精确 Origin CORS 已接入；日志省略查询参数、数据库/RPC 凭据与 panic 内容。CORS 不替代认证。

## PostgreSQL 与迁移

本地开发可使用 Compose（需 Docker Engine 与 Compose 插件）：

```sh
docker compose up -d postgres
```

在 `.env` 配置本地开发连接：

```dotenv
TG_DATABASE_URL=postgres://tickergarden:tickergarden_dev@127.0.0.1:54329/tickergarden?sslmode=disable
TG_MIGRATION_DATABASE_URL=postgres://tickergarden:tickergarden_dev@127.0.0.1:54329/tickergarden?sslmode=disable
TG_INDEXER_DATABASE_URL=postgres://tickergarden:tickergarden_dev@127.0.0.1:54329/tickergarden?sslmode=disable
TG_PUBLISHER_DATABASE_URL=postgres://tickergarden:tickergarden_dev@127.0.0.1:54329/tickergarden?sslmode=disable
```

```sh
make migrate-up
make migrate-status
```

迁移共 33 个：依次创建命名空间、原始链数据表和 `read_snapshots`，增加 Arbitrum Sepolia（421614）支持、交易回执覆盖，以及持久化市场发现表和 `canonical_discovered_markets` 视图，随后加入持久业务投影输入/状态/检查点，以及独立的区块末观察批次和结果，随后扩展 Gauge、Vault、FeeVault/Creator epoch 及 Holder/Treasury 观察类型。API 启动不执行迁移。Goose 使用 advisory lock，版本表固定为 `public.tickergarden_goose_version`，避免 schema 与登录用户名相同引起搜索路径变化。`status` 可能初始化 Goose 版本表。

以上共享凭据仅用于开发。实际运行需分别配置：API 对读模型表的 SELECT 权限；索引器对 journal/blocks/logs/receipts 的写权限；发布者读取链表并对 snapshots 执行 SELECT/INSERT；发现 worker 使用独立的 `TG_DISCOVERY_DATABASE_URL`，对 discovery checkpoints/batches/markets 执行写入并读取 finalized journal；迁移进程拥有 DDL 权限。代码不自动创建生产账户。各进程只使用自身 DSN，不持有签名私钥。

## 原始链日志索引器

```dotenv
TG_CHAIN_ID=46630
TG_RPC_URL=http://127.0.0.1:8545
TG_INDEXER_START_BLOCK=0
```

```sh
make index-once
make index-run
```

起始高度必填；本地 Anvil 使用 0，真实环境应来自核验过的部署清单。首次运行固定 chainId、创世块哈希和起始高度，后续不一致会拒绝。首次创世块仍来自配置 RPC 的信任起点，尚不是独立网络身份认证。

RPC 参照 [Ethereum JSON-RPC 文档](https://ethereum.org/en/developers/docs/apis/json-rpc/)，采集调用 `eth_chainId`、`eth_getBlockByNumber`、`eth_getBlockByHash`、`eth_getTransactionReceipt`、带 blockHash 的 `eth_getLogs`。节点必须支持 finalized，不支持时停止。请求超时 15 秒、响应上限 16 MiB，单步事务最长 60 秒。

每步原子提交一个区块、经过回执交叉核对的日志、交易回执身份/状态和游标。跨进程按链加锁。未确认分叉最多查找 128 块共同祖先；越过起始边界、超限、节点落后、finalized 回退或已确认哈希变化均停止。错误不推进游标，排查或恢复连接后重启。持续运行追赶至 head 后每 3 秒检查，支持 SIGTERM。

孤块和日志保留，消费者必须关联 `chain_blocks` 并筛选 `canonical=true`。当前采集起始高度后的全链原始日志，尚未按协议地址过滤或解码 ABI。日志完整性依赖 RPC 节点，尚无 receipt root 或独立节点证明。

## 持久化 finalized 市场发现

发现 worker 从已完成回执核对的 finalized journal 区块中发现市场身份，并把游标、批次和市场记录原子写入数据库。它与财务投影/对账分开；Vault、Locker、Hook 及更广泛的协议状态发现仍未完成。

运行前必须配置独立的 `TG_DISCOVERY_DATABASE_URL`（不要复用 API DSN）、`TG_DEPLOYMENT_MANIFEST`（部署清单路径）、`TG_DISCOVERY_START_BLOCK`（十进制非负整数，且不小于 journal 起始高度），以及共享的 `TG_RPC_URL` 和 `TG_CHAIN_ID`。清单必须包含已部署的核心身份；worker 会固定清单哈希（合约顺序不影响哈希）和起始高度，首次初始化后变更必须显式重建。清单的 chain/genesis 必须与 journal 一致；起始区块必须已能读取整套核心合约。

```sh
make build
./bin/discovery-worker --describe
./bin/discovery-worker --once
./bin/discovery-worker --run
```

`--once` 处理一个可用区块后退出，`--run` 持续运行；每步超时 60 秒，追上 finalized 高度、journal 尚未就绪或跨进程按链锁繁忙时每 3 秒重试。worker 只处理 journal 已 finalized 且 `canonical=true`、`receipts_verified=true` 的区块，并在提交前将发现来源与已保存日志交叉核对。批次、市场记录和 checkpoint 在同一事务中提交。消费者必须使用 `tickergarden.canonical_discovered_markets` 视图；该视图排除孤立、非 canonical、未验证回执或未 finalized 的记录。

如果 finalized journal 锚点、RPC 区块哈希或已保存 checkpoint 失效，worker 会硬停止并保留游标，不自动回滚或重放；需调查后执行明确的恢复/重建流程。该 worker 不执行财务投影、余额补读或对账，也不代表生产或远端 CI 已通过。

## 发布已对账读模型

`internal/projection` 提供 Go 业务事件投影内核，移植现有 TypeScript projector 的配置、市场、仓位事件、收益退出、费用记录与 Swap/Hook 配对规则。输入先按冻结 ABI 解码，所有 uint256 保持十进制字符串；迟到的观察校验失败也不会提交部分事件或状态。精确重复事件幂等，修改来源或观察数据的重复事件、乱序和混链输入会被拒绝。`Replay` 从调用者选定的主链事件序列重建状态；该内核要求调用者先认证 emitter 并串行调用。

这些投影保存业务事实和可信补读结果，不能把最后一次 Deposit 的 amount 当余额。内核已连接下述持久投影 worker；余额自动补读/对账和快照发布仍待接入。`generate_projection_golden.mjs` 仅在开发/CI 中运行 TypeScript 参考实现，生成逐事件中间状态；Go 运行时不依赖 Node。

持久业务事实 worker 先等待 discovery-worker 完成对应 finalized 区块，然后核验清单核心身份和当前区块动态 emitter 的代码哈希，解码已绑定日志，提交业务事实。配置独立写连接 `TG_PROJECTION_DATABASE_URL`、`TG_PROJECTION_START_BLOCK`（必须等于 discovery 起始高度），以及相同的 `TG_DEPLOYMENT_MANIFEST`、`TG_CHAIN_ID`、`TG_RPC_URL`：

```sh
make migrate-up
make project-once
make project-run
# 或已导出环境变量后运行 ./bin/projection-worker --once / --run
```

第 7 个迁移保存 `projection_inputs`、`projection_rows` 与 `projection_checkpoints`。同一链锁保护整个区块事务；失败不提交输入、行更新或游标，并丢弃内存缓存。重启时按主链顺序回放已提交输入，检查摘要、输入数量和原始日志来源；持续进程复用内存状态并只写变化的行。清单、起点、投影版本均固定，失效 finalized 游标硬停止。消费者使用 `canonical_projection_rows` 视图，排除非主链/未核对回执/未 finalized 的记录和失效投影游标。

worker 当前只处理清单及已发现市场实例的已知事件；未绑定地址或未列入 catalog 的事件不进入业务投影。市场身份补读来自持久发现记录，Vault/Locker/Hook 自动发现、账户余额补读、完整财务对账仍缺失，因此不会自动调用 publish-snapshot。历史输入回放目前需要完整事件状态驻留内存；大规模恢复/吞吐验收尚未完成。此进程需读取 journal/discovery 表，读写自身三张投影表，无签名私钥。

发布输入兼容 TypeScript 的 `VerifiedReadModelSnapshot`，来自受信任的外部投影/对账程序。只有独立 CLI 可写入，没有 HTTP 上传或发布接口：

```sh
make build
# 直接运行二进制前 export TG_PUBLISHER_DATABASE_URL 和 TG_CHAIN_ID。
# 第二个参数必须是生产者实际完成本次对账的 RFC3339 时间，不应自动改写为导入时间。
./bin/publish-snapshot /absolute/path/verified-snapshot.json "$PRODUCER_VERIFIED_AT"
```

发布流程：

1. 验证冻结 OpenAPI 的必填项、类型、枚举及未知字段，拒绝重复 JSON 键、尾随 JSON、超出 64 层或 16 MiB 的输入。
2. 保留原始十进制金额字符串，并检查 uint256 范围、allocated=pending+active、领取币种、市场路由/Pool 生命周期、最低 allocation 和实体身份唯一性。
3. 要求 finalized、synced、规范 revision；检查 tip/head、lag 和来源高度的一致性。
4. 使用与索引器相同的链锁，检查快照块、head 和所有实体来源块在主链中，快照不晚于已确认游标，来源交易/日志索引与原始日志一致。
5. 原子插入快照内容、SHA-256 摘要与生产者验证时间。新发布必须推进高度；相同 revision 内容变化会拒绝，重复发布同一内容不会续期。

这些检查保障结构、内部一致性与来源绑定，**不替代合约地址/代码身份核验、链上余额补读或业务对账**。快照中的金额与路由仍由受信任生产者负责。

生产者验证时间与原始索引器更新时间最大允许 120 秒，未来时间容差 5 秒。历史快照保留作审计，API 仅开放最近 32 个 revision。历史版本仅在最新发布与索引器仍可用时允许固定查询。当前实现每次读取最多 16 MiB 的完整快照并在内存分页，尚未做大规模分页 SQL 或快照存储清理。

分页默认 50、最大 100。游标绑定 scope、filter、revision；应先读取 health 的 revision，再把同一个 revision 带入后续页面。版本过期或游标跨查询使用返回 400，应重新开始查询。非法或重复查询参数会被拒绝。

## 构建与验证

```sh
make verify          # gofmt、vet、race 测试、全部入口构建
make contract-check  # Python 3 + Node 22.13+；生成类型、冻结契约及 TS 响应对比
make smoke           # Python 3 + 本地 PostgreSQL 14+ 工具
PATH="$HOME/.foundry/bin:$PATH" make smoke-chain
```

`make smoke` 使用 `/tmp` 中的隔离 PostgreSQL 集群，测试迁移幂等、索引回滚/重组、快照发布/过期/保留、HTTP 与退出。需 PATH 中的 `initdb`、`pg_ctl`、`createdb`。也可向具备 CREATEDB 权限的本地测试服务运行：

```sh
TG_TEST_DATABASE_URL='postgres://user@127.0.0.1:5432/postgres?sslmode=disable' make integration
```

集成测试只迁移并删除自己创建的唯一数据库，不迁移传入 URL 指定的数据库。

`smoke-chain` 额外需要 Anvil、Forge 与 psql（Foundry 二进制目录需在 PATH 中，或同时配置 ANVIL 和 FORGE），启动临时 loopback 链，向该链发送 LOG0 与合成 Factory 市场创建测试交易，推进本地 finality，再验证 CLI 发布、持久发现及 API 返回。业务金额使用明确标记的测试 fixture；这不是自动业务投影测试。脚本退出时清理自己的进程与数据库，不连接公开链。

更新 OpenAPI 后，先运行 `python3 scripts/generate_models.py` 生成 Go 类型与嵌入契约；`node --experimental-strip-types scripts/generate_api_golden.mjs` 从现有 TS 服务生成响应样本。独立 CI 会检查二者是否过期，并比较 Go HTTP 返回与 TS 响应，包括分页游标字节。

本地验证（2026-09-06）：Go 1.27.1 race/vet/build、真实 PostgreSQL 14.20 + Anvil 1.8.1、生成契约检查与 TS 响应对比通过。Linux amd64 静态交叉编译通过。本机 Docker Engine/Compose 不可用，容器构建与远端 CI 未执行；CI 已配置 PostgreSQL 16 与容器构建。

`api`、`indexer`、`migrate`、`publish-snapshot`、`verify-deployment`、`discovery-worker`、`projection-worker` 可执行；`treasury-worker --input` 可计算本地候选数据集，`treasury-jobs` 支持人工入队后的持久处理、重试和恢复，RootRequested 可从 finalized journal 自动发现并按已配置策略入队；其余三个 worker 仍仅支持 `--describe`，不能执行维护、内容或结算作业。后续模块是完整财务投影、余额补读、独立对账，以及更广泛的 Vault/Locker/Hook 发现。计划见 [后端架构方案](../../docs/planning/BACKEND_REQUIREMENTS_AND_ARCHITECTURE.md)。当前不是完整 M1 或生产上线验收，未连接真实网络部署。

## 事件解码与部署 runtime 核验（2026-09-06）

`internal/events` 从编译接口生成 77 个事件定义，覆盖 20 个模块；记录 131 个来源指纹（编译接口使用规范化 ABI 哈希，避免构建元数据影响结果）。类型支持当前 catalog 的静态 ABI，严格检查 topic/data 长度、地址填充、bool、整数范围和有符号扩展；整数仍输出十进制字符串。签名相同但字段或 indexed 布局冲突会使生成失败。

`internal/chainrpc` 新增按 blockHash + requireCanonical 固定的 `eth_getCode` / `eth_call`。历史状态不可用时失败，不改读 latest。`internal/deployment` 校验 chainId、genesis、指定区块与每个地址实际 runtime 的 Ethereum Keccak-256；验证结果绑定链和区块，只允许对应 emitter 的模块事件解码。

```sh
# 先 export TG_RPC_URL 与 TG_CHAIN_ID；清单使用实际部署 runtime hash。
./bin/verify-deployment /absolute/path/runtime-identities.json
```

清单字段：executionSpecId、chainId、genesisHash、contracts；每个 contract 包含 module、address、runtimeCodeHash。模块名来自冻结 catalog，地址/hash 为规范小写 hex。禁止用编译 runtime template hash 代替部署后的代码哈希。CLI 在 finalized 区块验证并输出该块哈希。默认只验证代码身份，`coreBindingsVerified=false`。

增加 `--core-bindings` 可验证核心部署关系：

```sh
./bin/verify-deployment --core-bindings /absolute/path/runtime-identities.json
```

清单必须分别包含且只包含一个核心模块身份：TickerGardenFactoryV1、OfficialStockRegistryV1、ApprovedQuoteRegistry、TickerGardenBaselineRegistry、LaunchTemplateRegistry、MarketRegistryV1、ProtocolFeeVault、AllocationManager、LaunchAndBuyRouter；允许附带其他模块，附带模块也会验证代码哈希。校验 Factory 的八项 runtimeBindings、MarketRegistry 的 Factory/四项配置根，以及 ApprovedQuoteRegistry 的 officialStockRegistry，共 14 项关系。所有调用固定同一 canonical blockHash，核验后再次检查区块；缺失、歧义、错配、异常 ABI、RPC 失败或重组均拒绝。成功返回 `status=core_runtime_bindings_verified`、`coreBindingsVerified=true`。

两种模式均保留 `protocolBindingsVerified=false`：**核心关系尚不涵盖动态市场实例、路由依赖、实现模板、权限和经济参数**。校验不提交交易，也不自动发布余额。`smoke-chain` 包含合成 EVM getter 图的 CLI 正例与根地址互换拒绝测试；这不是实际协议部署验收。

指定已经 finalized 的历史区块，可读取其中由已核验 Factory 创建的市场：

```sh
./bin/verify-deployment --discover-block 0x123 /absolute/path/runtime-identities.json
```

此模式自动执行核心绑定核验，通过逐交易回执与日志交叉检查发现 `MarketCreated`，再按同一 blockHash 补读 Registry 的 `market` 与 `marketIdByToken`。输出包含创建事件来源、区块末状态以及 Token/Curve/可选 Gauge 的实际代码哈希；任意市场核验失败或最终区块检查发生变化时，整个批次失败。保留 uint256 十进制字符串、无质押的零 assetUid/Gauge，以及创建区块内已毕业的状态。

发现地址的可信关系来自清单中已核验 Factory/Registry，实例代码哈希是观察记录，不能把它当成独立的源码匹配审计。这一只读单块诊断入口不写游标；持续处理使用前述 discovery-worker，两者均不自动发布财务快照；路由、经济参数完整对账及 Vault/Locker/Hook 动态发现仍待实现。`--discover-block` 不接受未 finalized 的高度。

本地 `smoke-chain` 已增加临时合约部署，验证 EIP-1898 runtime 读取与 CLI 成功路径，并验证错误 codehash 必须失败。全部事件模块的解码与 uint256/signed padding 等异常输入由 Go 测试覆盖。

生成命令为 `python3 scripts/generate_events.py`，依赖 `contracts/out-v1` 的已编译接口；先 `FOUNDRY_PROFILE=v1 forge build`。`contract-check` 与独立 CI 会检查事件/来源漂移；CI 新增固定 Foundry v1.8.1 与依赖恢复。全部后端任务与剩余验收见 [实施记录](../../docs/planning/BACKEND_IMPLEMENTATION_STATUS.md)。


## 交易回执覆盖（2026-09-06）

第 5 个迁移新增 `chain_receipts`，并将旧区块的 `receipts_verified` 默认设为 false。更新后先执行迁移，再启动索引器；它优先逐块补核对旧主链回执（action 为 `receipts_verified`），不改变已有 tip。历史日志与新读取结果不同会报错停止，需调查 RPC/历史数据并按恢复流程处理，不自动删改已发布事实。

区块中的每笔交易必须有匹配的回执，包括 status=0 且无日志的失败交易。并发最多 8 个请求，单块最多 16384 笔交易，累计回执日志最多 16 MiB；超限明确报错，保留原游标。按交易/日志索引核对顺序、hash、block、status 与 filter 全集，截断、缺失、多余或不一致均不提交。数据库保存标准化的回执身份、状态和日志，未保存所有供应商扩展字段。

新发布和查询可用状态均检查快照覆盖的主链区间是否完成回执核对。API readiness 仍需同时满足快照与索引新鲜度等检查。旧快照可展示为 unavailable，不能跳过补核对直接视为 synced。

这是一家 RPC 提供的 block/receipt/filter 的完整性与一致性核对；不是从 receipt root 验证的密码学证明，也不替代独立业务对账。孤块回执保留，后续交易状态查询必须关联 canonical 标记。

### 区块末市场与曲线状态

`projection-worker` 的 `market-curve-v1` 补读范围覆盖已认证事件触及的市场，以及发出事件的 Curve。每块每个对象只读一次，固定 EIP-1898 blockHash，并复核末次 canonical hash。市场的 17 个不可变配置字段与发现记录逐项对照；曲线读取价格储备、实际 Quote 储备、可售/预留 Token、费用、Creator tax、sweep nonce 和毕业就绪状态，金额保留十进制字符串。价格储备含 phantom Quote，不等于实际资金余额。

第 8 个迁移将补读批次（范围、应读/实读数量、原始摘要）和结果独立保存于 `projection_observation_batches` / `projection_block_observations`。通过 `canonical_block_observations` 读取带区块身份的结果；不会将区块末 view 反复注入逐事件重放，也不附会某一源交易。任一补读失败均回滚整个区块的事件、观察和游标。空块保存明确的零请求批次。

市场／曲线基础阶段的投影版本为 `V1-EXEC-11:business-facts-v2-market-curve`（最新 FeeVault 扩展版本见下文）。旧版本游标不会被静默接续；已有旧投影数据库需在独立数据库从原部署起点重建并验证后切换，迁移本身不删除历史数据。这一观察范围尚不涵盖 Vault/Gauge、FeeVault、完整 PoolKey/配置和独立财务对账，不能据此发布 synced 快照。

### Gauge 区块末状态

Gauge 阶段观察范围为 `market-curve-gauge-v1`，投影版本为 `V1-EXEC-11:business-facts-v3-market-curve-gauge`。已认证事件触及启用质押的市场时，核验发现记录中的 Gauge runtime hash、七项 clone identity（市场、资产、Quote 配置、AllocationManager、FeeVault、Quote 和 Meme），读取存储 active 总量、有效 active 总量、pending 总量、双资产奖励累积器和待冲销罚没。存在 `user` 的市场事件还按用户去重读取 `positionOf`；pending 仓位补读对应 activationSnapshot，同代快照仅请求一次。关闭质押的市场跳过 Gauge。

第 9 项迁移保留旧观察范围并增加 `gauge` / `gaugePosition` 类型。结果沿用区块末观察事务和主链视图，失败不留部分结果。`positionOf.activeAmount` 是存储值，claimable 是合约预览（可能受 rage-quit cutoff 冻结）；存储 active、有效 active 和 pending 分别保留，不能自行加总作为可领取本金。Gauge 是奖励权重账本，Vault 才是本金权威。

仍缺跨空块/时间自动刷新已知用户、Vault 本金/偿付及身份读取、FeeVault 独立负债对账。此范围不是全部补读完成，仍不自动发布 synced。升级旧投影时继续使用独立数据库从原起点重建验证后切换。

验证命令 `ANVIL=/Users/dear/.foundry/bin/anvil make smoke-gauge` 使用独立 PostgreSQL/Anvil 运行启用质押的合成 Getter fixture；`smoke-chain` 保留无质押分支。两个场景都包含发现、持久投影、失败回滚、重启与 API 回归。合成 Gauge 观察不替代真实协议部署验收；用户仓位/激活快照由 Go RPC fixture 测试覆盖。

### Vault 本金与偿付观察

Vault 阶段观察范围为 `market-curve-gauge-vault-v1`，投影版本为 `V1-EXEC-11:business-facts-v4-vault`。通过历史官方注册事件、已持久化的资产配置和市场资产 ID 解析 Registry 的 AssetView；尚无市场的已注册资产也会保留在范围中。新增资产在解码同块 Vault 日志前解析，AssetRegistered 的 token/Vault/decimals 与区块末注册记录对照；只有 Registry 认证的 Vault 才能成为事件 emitter。

身份核验包括资产与 Vault 的 Registry identity-current 判定、四字段 vaultIdentity、v6 schema 正反向映射、Registry 固定的 Vault runtime hash 和 Token fingerprint runtime hash。Token/beacon/implementation 模型由已认证的 OfficialStockRegistry 历史判定覆盖；没有把模板 hash 冒充部署代码证据。ACTIVE、PAUSED、RETIRED 均可读取，身份漂移会使本区块失败，不修改合约的直接本金退出路径。

第 10 项迁移增加 asset、vaultSolvency、vaultPosition、vaultMarket、vaultAllocation 观察类型。每块（含空块）刷新已知资产总存入、总分配、真实 token balance 及已知市场的分配/有效奖励权重/cohort epoch；用户事件触发 deposited/allocated/free、市场 allocation 和 rage-quit 截止点补读。全部 raw amount 使用十进制字符串和大整数检查。

`checks` 保存余额覆盖存入、分配不超过存入、free = deposited - allocated 等明确范围的结果。检查失败仍作为风险证据持久保存；RPC/ABI/身份失败则回滚整个投影区块。`fullReconciliation` 保持 false，这些结果不能单独用于发布 synced；仍需全用户/市场总和、FeeVault、Treasury 独立对账与发布门槛。

`make smoke-vault` 在隔离 PostgreSQL/Anvil 验证无市场资产的同块注册/存款、原子投影和新进程空块刷新；与 smoke-chain、smoke-gauge 一起纳入 CI。当前逐块刷新规模随资产/市场数增长，生产吞吐和超时预算需要 M5 负载验收；旧投影仍需独立重建验证后切换。

### FeeVault 负债与 Creator epoch

FeeVault 阶段观察范围为 `market-curve-gauge-vault-fees-v1`，投影版本为 `V1-EXEC-11:business-facts-v5-fees`。第 11 项迁移增加 `feeLiability`、`feeSolvency`、`creatorEpoch` 类型，与事件事实及游标同事务提交。旧投影需在独立数据库从原起点重建并验证后切换。

每块（含空块）读取全部已知市场的 Creator、Staker、Platform、Holder 四类负债及罚没准备金。准备金已从 Staker bucket 移出，计算市场负债时只加一次；不能在 totalLiability 之上再次累加。按资产汇总已知市场负债，与全局 totalLiability 比较，并检查余额覆盖负债。ERC20 使用 balanceOf，原生币使用 eth_getBalance；均固定 EIP-1898 blockHash，不回退到 latest，金额保留完整 uint256 十进制字符串。

核验 FeeVault/CreatorRevenueRegistry 的核心绑定、费用策略及 Creator Registry runtime，读取每个市场从 1 到当前 Creator epoch 的历史受益人与 Quote/Meme 负债，并比较 epoch 总和与 Creator bucket。单块跨全部市场的 Creator epoch 总读取预算为 1024，超限整块失败；更大历史需要后续分页任务，不能返回部分求和。该预算不代表已完成生产吞吐验收。

失败的财务检查作为风险证据保存；RPC、ABI、身份或区块一致性失败则回滚整个区块。Holder epoch 历史账本、完整市场范围和独立财务对账尚未完成，holderEpochCoverageComplete 与 fullReconciliation 保持 false；本阶段不自动发布 synced 财务快照。

FeeVault 阶段验证通过：Go 全量 race/vet/build、Linux amd64 无 CGO 构建、生成文件对照、11 项迁移，以及 smoke-chain/smoke-gauge/smoke-vault 三条隔离 PostgreSQL/Anvil 链路。测试覆盖罚没准备金计数、Creator 历史负债、偿付不足、非法余额、固定区块读取、失败回滚与重启恢复。烟测使用合成 Getter fixture，远端 CI、Docker 和真实协议部署验收未运行。

### Holder 与 Treasury 历史 epoch

当前投影版本为 `V1-EXEC-11:business-facts-v6-holder`，范围为 `market-curve-gauge-vault-fees-holder-v1`。第 12 项迁移增加 holderMarket、holderEpoch、treasurySolvency，与已有区块事实同事务提交。旧版本游标继续要求独立重建和验证后切换。

当前覆盖 Factory 在创建时启用 creatorFeesToHolders 的已知市场，每块包括空块读取 Treasury 当前 epoch 与全部历史 epoch。核验 Factory 的 Treasury 地址、可选清单地址、Registry 反向绑定、发现时 Meme runtime hash、Token 的 Treasury 地址、市场双资产/激活状态与 feeSharingVault。Treasury runtime hash 是观察证据，不能替代独立源码/权限审计。

保存合约实际返回的 EPOCH_DURATION、TWAB_SCHEMA，以及 epoch 窗口、请求/审查/领取期限、源区块、root/dataset/TWAB、入账与已领取金额，以及 FeeVault 的双资产 Holder epoch 负债。Holder 历史总和与 Holder bucket 比较。Treasury 剩余 Quote 按 epochQuoteAmount - claimedAmount 计算；ROLLED_OVER 旧 epoch 计零并检查原资金字段已清空，避免把滚存资金重复算入负债。Quote 与 service 总负债相加后检查真实余额；当前服务费资产及仍保存在 epoch 中的历史服务费资产纳入读取。

单块跨市场最多读取 2048 个 Holder epoch，超限整块失败；后续需分页、增量刷新和负载验收。独立注册的普通 Treasury 市场、已重置 epoch 涉及的历史服务费资产、全部 service-credit 受益人、领取 bitmap/账户记录和 Transfer/TWAB/Merkle 数据集尚未完整覆盖。fullReconciliation 保持 false，不自动生成 proof、提交 root 或发布 synced 财务快照。

`make smoke-holder` 在隔离 PostgreSQL/Anvil 中验证开启 Holder 分成的市场发现、epoch/余额观察、原子持久化、回放与重启；CI 增加该轨道，远端 CI 和真实合约部署验收仍需另行执行。

### Treasury 候选数据集计算

`treasury-worker` 已提供 Go 原生的本地计算入口，不依赖 Node 运行时：

```sh
make build
./bin/treasury-worker --describe
./bin/treasury-worker --input input.json > candidate.json
```

输入格式见 `internal/treasury/testdata/golden.json` 中各案例的 input 对象，命令读取的是单个 input 对象。chainId、金额、区块号与时间用规范十进制字符串；epochId、transactionIndex 和 logIndex 使用 JSON 整数。最多 16 MiB，拒绝未知字段、重复键、尾随 JSON 和非法数值。Transfer 与 exclusion 数组必须显式提供。错误时不输出部分数据集。

计算采用当前 7 天 TWAB schema；依据规范链顺序重建窗前余额与窗内时间加权余额，以最大余数法分配全部 Quote，余数并列时按地址排序，过滤零分配并重新编号。树采用排序节点哈希，奇数末节点直接提升；叶子包含完整链/市场/epoch/资产/策略/窗口/源区块域，并按合约规则双重哈希。输出 dataset hash 与 TypeScript 的规范 JSON 字节一致。空资格只在显式 emptyEpochPolicy=reviewed-rollover 时返回空 epoch root。

输出包装层标记 status=candidate_unverified_history、historyVerified=false、transactionSubmission=false，dataset 包含 root、datasetHash、分配与 proofs。负余额、重复日志、非单调时间、越过 source、余额/TWAB 溢出或策略错配均失败；这些局部检查仍不能证明 Transfer 历史完整，尤其不能把缺失初始发行误认为真实空资格。此入口不能替代 journal 完整性、链上 RootRequested/策略核验、独立审查及发布授权。

测试参考算法位于 `testsupport/`；从项目根目录执行 `npm --prefix apps/web ci` 安装已锁定的编码依赖，`make contract-check` 会复算六组交叉语言夹具。`make treasury-solidity-check` 使用 Foundry 在临时目录编译实际 TreasuryClaimLeafV1 并执行每个叶子的域校验。完整 Transfer 数据供给、请求任务调度、不可变数据集存储、proof HTTP 与 root 发布/复核工作流仍待实现。

### 链上时间与旧日志补核验

第 13 项迁移新增 chain_blocks.block_timestamp，使用链上 Unix 秒，限制在数据库支持的非负 signed 64 位范围。旧行保留 NULL，不使用入库时间或当前时间填充。RPC Header 必须有合法 quantity 时间；按 hash 取得的 receipt block 与最初 Header 的时间必须一致。

索引器优先补读 receipts 未核验或 timestamp 缺失的主链块，重新比对完整回执/日志，原子保存时间且不推进 tip；沿用 receipts_verified action。已保存的同 hash 时间不可静默覆盖，时间倒退或补读期间身份变化会失败。发现与投影 worker 仅处理时间已补齐的块；新 Header 从数据库载入时间，投影提交前再次核验。时间核验是 RPC 数据一致性检查，不是 header hash 的独立密码学验证。

此字段为 Treasury canonical Transfer 数据集与成交时间提供必要输入；完整历史供给和自动 root 任务尚未因此完成。旧部署先执行迁移，再让 indexer 补齐历史时间。

### 从日志库计算 Treasury 候选

设置只读账户的 TG_TREASURY_DATABASE_URL 后，可执行：

```sh
./bin/treasury-worker --journal --input request.json > candidate.json
```

request.json 使用上述 Input 格式，transfers 必须是显式空数组；调用方仍需提供 epoch/window/source/Quote/exclusions。读取器在 repeatable-read 事务和链共享 advisory lock 内核对 source 的 finalized 主链位置、发现检查点覆盖及唯一市场身份、创建事件与回执、创建块至 source 的连续区块/时间/回执标记。Meme/Quote/Curve 来自已持久化的发现记录，Transfer 由回执与过滤日志双向比对，不接受调用方拼接的 Transfer。

要求同一创建交易中有且仅有一次向 Curve 的正数初始 mint，且在 MarketCreated 之前；后续额外 mint 会拒绝。缺块、缺时间、主链/资产/source 错配、缺失发行记录或日志/回执不一致均返回错误，不输出部分数据集。源读取最多 100 万区块、10 万条 Transfer、64 MiB 回执/日志输入，命令读取阶段限时 60 秒；超限需后续分页/增量数据集作业。

输出新增 journalEvidence，包括 discovery manifest hash、范围、Transfer 数量及初始发行量，journalRangeChecked=true。整个输出仍为 candidate_unverified_history：数据库 journal 的回执完整性标记属于受信任索引器证据，尚无独立 receipt-root 验证；尚未核验调用方输入与链上 RootRequested、受益排除策略或发布权限。不可仅凭该候选发 root。日志库记录与完整数据集的持续完整性审计、不可变产物保存、请求调度和 proof HTTP 仍待接通。

### 候选与链上 RootRequested 状态核验

```sh
./bin/treasury-worker --journal --input request.json --request-manifest deployment.json > candidate.json
```

该模式使用 TG_RPC_URL，在 finalized 区块固定读取请求状态；manifest 必须明确包含 TreasuryDistributorV1 runtime 身份。核验 Factory/Registry/Treasury 绑定、Registry 与 Treasury 的市场资产一致性、REQUESTED 状态、未领取且非零的资金、publishBy 窗口、epoch 入账与承诺金额、实际 EPOCH_DURATION/TWAB_SCHEMA，以及请求保存的 canonical source hash/time。

随后逐项比较候选的链、Distributor、market、epoch、Meme/Quote、排除策略 hash、窗口、source number/hash/time 与 Quote 金额。当前 Go 计算仅接受 7 天 schema，旧 30 天域会拒绝。成功输出 requestEvidence（含观察 blockHash/状态）并令 journalEvidence.rootRequestVerified=true；任一错配不输出数据集。

这是 finalized 观察时刻的状态核验，不是发布时的许可或模拟。候选总标记仍为 candidate_unverified_history，transactionSubmission=false；完整历史的独立证明、审查与发布前 fresh simulation 仍未完成；不可变存储、人工入队的持久队列与 proof HTTP 见后续章节。

### 不可变 Treasury 候选存储

```sh
./bin/treasury-worker --journal --input request.json --request-manifest deployment.json --store > candidate.json
```

该模式还需 TG_TREASURY_STORE_DATABASE_URL，使用独立的候选写入账户：读取主链来源表，并对 treasury_candidates 拥有 SELECT/INSERT；不授予普通服务账户 UPDATE/DELETE。第 14 项迁移保存完整计算输入、dataset/proofs、journalEvidence 和 requestEvidence，以及检索索引。内容摘要是 candidateId，重复内容幂等，应用不覆盖旧版本；不同请求观察可形成不同候选 ID。

写入前复算 Generate 并核对 request/journal 证据，链锁内检查 source 与 request 的主链 finalized 身份。读取器复核内容摘要、索引和计算结果，并检查来源仍在主链；来源失效时不返回为当前候选，原记录保留供审计。单个产物限制 128 MiB。这是候选存储，不是 published-root 表；空资格、历史完整性、服务费用、根审查与发布资格不能从存储成功推导。proof HTTP 和人工入队的持久任务见后续章节；自动请求发现见后续章节。


### Treasury 领取凭证 HTTP

可选启用现有 API 的 Treasury 查询（前端无需修改接口路径）：

```sh
TG_TREASURY_PROOF_MANIFEST=/absolute/path/deployment.json \
TG_RPC_URL=https://your-rpc.example \
TG_DATABASE_URL=postgres://readonly@127.0.0.1/tickergarden \
TG_CHAIN_ID=46630 ./bin/api
```

清单采用 `verify-deployment` 的 Go manifest 格式，必须与 TG_CHAIN_ID 一致，显式 pin TreasuryDistributorV1 及完整 core runtime；它不是部署工具的任意 JSON 输出。API 数据库账户需要现有 read-model 读取权限，以及 treasury_candidates、chain_journal、chain_blocks 的 SELECT 权限；不需要写权限。未配置该 manifest 时其余 API 正常工作，此接口返回 503。

`GET /v1/treasury/markets/{marketId}/epochs/{epochId}/claims/{account}`

返回前端已有的 `TICKERGARDEN_V1_TREASURY_CLAIM_PROOF_V1` / `V1-TREASURY-EXEC-1` 格式：chainId 和 epochId 是 JSON number，leafIndex/twab/amount 是十进制字符串，proof 始终是数组（单叶为 []）。另返回 observedBlockHash 与十六进制 observedBlockNumber。

查询固定 latest 的 canonical block hash，核验部署代码/核心绑定、市场资产、CLAIMING 状态、领取窗口、请求 source 和 7 天 policy；按链上 datasetHash 精确检索候选，重新核验产物摘要/索引/计算及 journal 来源，再比较 root、leafCount、totalTwab 和完整 claim domain。返回前验证本地 proof，读取 isClaimed 与 accountClaimed 两道重放保护，检查剩余额度并再次确认区块未重组。领取截止时间等于区块时间仍有效，与合约一致。

HTTP 语义：400 参数无效；404 无匹配产物或该账户无叶子（不等同于历史资格审计结论）；409 epoch 尚未进入 CLAIMING/已 rollover，或已领取；410 CLAIMING 窗口已过期；503 未配置、RPC/数据库失败、数据不一致或并发预算耗尽。所有响应 no-store，错误不回显数据库/RPC 内部信息。

每查询 10 秒预算、最多 2 个并行产物校验；latest 时间落后超过 120 秒或超前超过 15 秒则拒绝。节点时间只用于新鲜度保护，领取窗口以链上块时间判断。结果是查询区块时刻的快照，latest 不是 finalized，也不能保证稍后的 claim 交易成功；资产转账/偿付能力及链上后续变更仍由合约执行检查。本接口不签名、审核或发布 root，不补造缺失的历史证明。现有 /readyz 仍检查 snapshot read API 的数据库和同步状态，不代表该可选 Treasury 服务已具备领取凭证。


### Treasury 持久任务队列

第 15 项迁移增加 treasury_jobs。先执行迁移，再设置 TG_TREASURY_JOBS_DATABASE_URL；队列处理账户对 treasury_jobs 需要 SELECT/INSERT/UPDATE，对 treasury_candidates 需要 SELECT/INSERT，并可读取来源 chain_journal/chain_blocks。TG_TREASURY_DATABASE_URL 继续作为历史加载的独立只读连接。公共 HTTP API 不使用队列写入账户。

```sh
./bin/treasury-jobs --enqueue request.json --manifest deployment.json
./bin/treasury-jobs --status 0xJOB_ID
./bin/treasury-jobs --once --manifest deployment.json
./bin/treasury-jobs --run --manifest deployment.json
```

入队 request.json 使用现有 Input 格式，但 transfers 必须是 []；exclusions、7 天窗口、source 和 Quote 金额必须明确，金额须为正。manifest 是完整 core/Treasury pin 的 Go 清单。输入、排除列表和清单排序规范化后生成 job ID；相同内容幂等入队，不重置 running/succeeded/dead 状态。status 返回状态、尝试次数、candidateId 和固定错误代码，不输出令牌或原始输入。

worker 只领取与其启动清单的 chain/manifest hash 完全匹配的任务。数据库时钟控制 120 秒租约，FOR UPDATE SKIP LOCKED 允许多个进程竞争；每次领取都有新随机令牌，完成/失败更新要求令牌匹配且租约仍有效。单次处理限时 60 秒，先核验 finalized REQUESTED 状态与冻结输入，再加载 journal、计算、保存候选并关联任务。失败最多尝试 5 次，前四次退避 30/60/120/240 秒；第 5 次失败或第 5 次租约过期转为 dead。损坏的 payload 直接隔离为 dead，不生成空 root。进程重启可领取过期租约，旧工作者不能覆盖新领取结果。

候选保存与任务完成分为两次提交：在中间退出可能留下未关联的不可变候选，重试允许重新计算和复用/另存候选，不提交链上交易。--once 空闲时输出 idle 并成功退出；--run 在空闲/失败时每 5 秒继续检查，收到 SIGINT/SIGTERM 停止，处理中取消会尝试记录重试，未完成记录则由租约恢复。DB/RPC 异常不会把任务标为 succeeded。

succeeded 仅表示计算候选已持久化，不表示 root 已审核、可发布或已发布，historyVerified 仍无独立完整性证明。也可使用下节的 RootRequested 发现入口；尝试审计和 dead 恢复见后续章节；分段历史作业以及独立 reviewer/publisher 尚未完成。dead 不会通过重复入队复活。


### 自动发现 RootRequested

第 16 项迁移增加 treasury_request_discovery。发现器读取 journal 已 finalized、canonical、receipts_verified 的 Treasury RootRequested 日志，核验事件在成功回执中唯一出现，固定 journal finalized hash 核验完整部署和当前请求。事件的 requester、窗口、source、资金、服务费与 publishBy 必须与同一次链上请求相符。历史请求已失效、过期或被后续请求替代时记录 inactive；同次请求字段矛盾时整个批次失败。

合约只保存 eligibilityPolicyHash；操作员需提供 exclusions 清单，不能从哈希还原或默认所有账户都符合资格。策略文件是最多 1 MiB/1000 项的 JSON 数组：

```json
[
  {
    "chainId": 46630,
    "marketId": "0x<64 hex digits>",
    "policyHash": "0x<64 hex digits>",
    "excludedAccounts": ["0x<40 hex digits>"]
  }
]
```

值需替换为真实市场和经复核的排除地址，policyHash 必须等于 Go/TS 计算的同一 chain/market/exclusions 承诺；不接受重复字段、重复策略或缺失数组。显式 [] 表示空策略清单，不会据此生成空资格 root。命令如下：

```sh
./bin/treasury-jobs --discover --manifest deployment.json --policies policies.json
./bin/treasury-jobs --once --manifest deployment.json --policies policies.json
./bin/treasury-jobs --run --manifest deployment.json --policies policies.json
```

--discover 仅发现/入队；--once 和 --run 带 --policies 时先发现再处理。--run 每轮重新读取策略文件；缺少匹配策略记录 awaiting_policy，规范化策略文件内容改变后重试，未改变时跳过该项继续扫描后续请求。--run 发现失败不影响既有队列任务继续处理；--once 发现失败以非零状态退出，保留已有任务。

每批最多 10 条事件，60 秒预算，在 repeatable-read 事务和链共享锁内读取 RPC、原子提交任务与发现记录；不同发现器按 manifest 独占，索引写入者在此期间不能改 journal。该设计偏重一致性，慢 RPC 会占用链锁直到事务结束，后续需按目标规模调整批量/分页并进行负载验收。晚期 canonical hash/time 改变时整批回滚，包括刚入队的任务；进程重启和事件重放不会重复创建任务。策略错误或未知不会输出零 root。

队列数据库账户还需 SELECT chain_logs/chain_receipts，以及 SELECT/INSERT/UPDATE treasury_request_discovery。发现器本身无签名、发布、取消或 finalize 权限。自动入队的空资格处理保持默认拒绝，reviewed-rollover 仍需独立审查流程。独立 receipt-root/全历史证明、生产部署验收、publisher/reviewer 尚未完成；dead 运维恢复见下一节。


### 任务审计与 dead 恢复

第 17 项迁移为队列增加 recoveryCount、treasury_job_audit 和 treasury_job_recoveries。状态变化由数据库触发器在同一事务中记入审计表，覆盖 enqueued/claimed/reclaimed/failed/exhausted/quarantined/succeeded/reopened，其他可见变更记 modified。重复入队的无变化更新不会产生重复审计；迁移前已有任务只记录 imported 当前状态，不补造过去尝试。审计包含数据库 session_user、时间、状态、每轮尝试次数、恢复代数及 candidateId，不保存租约令牌。

```sh
./bin/treasury-jobs --history 0xJOB_ID --after 0
./bin/treasury-jobs --retry 0xJOB_ID --operation-id 0xSTABLE_OPERATION_ID \
  --expected-recovery 0 --reason '已修复历史 RPC 服务，重新核验后恢复'
```

--history 使用 TG_TREASURY_JOBS_DATABASE_URL（需 SELECT 审计表），最多返回 100 条及 nextAfter；下一页将 nextAfter 传入 --after。--status 现在也返回 recoveryCount。--retry 必须使用独立的 TG_TREASURY_OPERATOR_DATABASE_URL 和 TG_RPC_URL，不回退到 worker DSN；不接受调用方提供的 actor 名称。

恢复仅允许当前 dead、输入摘要/索引仍有效且 recoveryCount 等于预期版本的任务。固定 finalized 区块重新核验完整部署、有效 RootRequested 和冻结输入。新恢复记录与 dead→ready 更新原子提交；recoveryCount 加一、当前轮 attempts 归零，旧审计永久保留。操作 ID 必须是小写 bytes32，并在同一次逻辑恢复及不确定响应重试中保持一致；重复相同请求返回原恢复结果，不再次复活。相同 ID 换任务/原因/预期版本被拒绝。原因必填、最多 512 个 Unicode 字符且不能含控制字符。损坏输入、过期/已发布请求、状态或版本变化都不能通过该入口重试。

生产权限应使用独立数据库登录账户：worker 不应拥有 treasury_job_recoveries 的 INSERT 或 jobs.recovery_count 的 UPDATE；operator 只获恢复所需 SELECT 和 jobs 的 state/attempts/recovery_count/error_code/available_at/updated_at 列更新权限，以及 recoveries 中 operation_id/job_id/expected_recovery/recovery_count/reason/observed_hash 列的 INSERT。不授予 actor/occurred_at 的显式写权限；migration owner 持有审计触发器。API 没有任何恢复入口或对应写权限。触发器要求 dead→ready 存在当前数据库 actor 的恢复记录，不允许跳过恢复版本；审计/恢复表普通 UPDATE/DELETE 被拒绝。数据库 owner/superuser 仍是信任边界，可修改触发器或授权，生产角色分配与外部备份/审计必须另外验收。

此恢复只重启候选计算，不授权 root 发布、签名、转账或空资格 rollover；每轮处理仍重新验证请求与完整输入链路。操作记录的 RPC 观察不是独立 receipt-root 证明，真实网络发布/领取及独立 reviewer/publisher 流程仍未完成。


### 独立审核与未签名发布准备

第 18 项迁移记录新候选创建者的数据库 session_user，并新增只追加 treasury_reviews。旧候选 created_by 保持 NULL，不把迁移人冒充原创建者；这类候选不能直接批准，应重新采集/存储具有真实作者记录的当前候选。reviewer 必须使用不同于候选创建者的独立数据库登录，应用校验和数据库触发器均执行该隔离。

```sh
./bin/treasury-review --export-input 0xCANDIDATE_ID > input.json
./bin/treasury-review --report-template 0xCANDIDATE_ID > history-report.json
# 用独立实现复算 input.json，得到 reference.json；检查来源并填写报告后：
./bin/treasury-review --candidate 0xCANDIDATE_ID --decision approved \
  --operation-id 0xSTABLE_REVIEW_OPERATION_ID --reason '独立复算及来源审查一致' \
  --reference reference.json --history-report history-report.json --manifest deployment.json
./bin/treasury-review --show 0xCANDIDATE_ID
```

以上入口使用 TG_TREASURY_REVIEW_DATABASE_URL；批准另需 TG_TREASURY_REVIEW_JOURNAL_URL 和 TG_TREASURY_REVIEW_RPC_URL。review 账户读取候选/journal/审核表，只对 treasury_reviews 拥有必要列 INSERT 和 sequence USAGE，不授予候选 UPDATE 或 reviewer 字段显式写权限。历史库可使用独立只读副本/来源；配置不同 DSN 本身不证明数据源独立。生产运维应安排实际独立的人/系统及来源审查。

reference.json 是独立复算输出的原始 ROOT_V1 dataset（本仓库纯参考算法见 `testsupport/treasury-reference.ts`，不提供生产服务），不是 CLI candidate envelope。程序逐字段比较完整 context、source timestamp、root、datasetHash、TWAB、分配、leaf/proof；它无法辨别文件是否由人工复制，所以“独立复算”的来源仍需审核流程保证。history-report 模板绑定 candidateId 和 Go 规范输入摘要，必须填写 method/evidence，并由审核人对 historyComplete 显式作出声明；空 epoch 还必须声明 emptyEpochReviewed。默认模板均为 false，不能直接用于批准。

批准时还需重新读取新鲜 latest 区块的 REQUESTED 状态与完整部署域，并从审核日志库重放历史和 Go 计算，结果与存储候选一致。记录区分 referenceMatched/journalReplayed 与人作出的 historyReport 声明，receiptRootVerified 始终 false；这符合 attested root 的信任模型，不宣传为无需信任的链上历史证明。拒绝可在无需 RPC/完整复算的情况下记录，但仍需绑定候选及原因/证据。

每项审核决定使用稳定的 operation-id。相同 ID 和相同提案重试返回已有审核记录；观察区块改变也不会将旧批准重新插入到后来的拒绝之后。改变原因、证据、数据集、清单或决定须使用新的明确操作 ID；旧 ID 不能改用。最新有效决定按数据库 sequence 读取，记录的普通 UPDATE/DELETE 被拒绝。

```sh
./bin/treasury-review --prepare-publication 0xCANDIDATE_ID \
  --publisher 0xPUBLISHER_ADDRESS --manifest deployment.json > unsigned-publication.json
```

此模式使用 TG_TREASURY_PUBLISH_DATABASE_URL 和 TG_TREASURY_PUBLISH_RPC_URL。发布准备数据库身份不能与最新 reviewer 相同；只读权限足够。要求最新记录为 approved 且与候选、清单、复算和历史声明一致，再核验最新请求并用指定 from 地址执行固定 blockHash、requireCanonical=true、value=0 的 eth_call。访问控制/请求过期/分配等导致模拟 revert 时拒绝输出；模拟后重查区块和最新审核，防止期间变化。publishRoot 的 7 个参数通过实际 Solidity ABI/viem 的 6 组向量比对，包含空 epoch 与 uint256 最大 Quote。

输出状态为 simulated_unsigned，包含 chain/from/to/data/value、candidateId/reviewId 和观察块，transactionSubmission=false。它没有签名、nonce、Gas 预算或广播，不是可长期缓存的发布许可。后续 broadcaster 必须在实际发送前再次验证最新审核和链状态，并处理提交不确定性；DB 身份隔离也不等于 Safe 成员及链上 publisher/cancel role 的部署隔离已验收。真实发布、pending-root cancellation、延迟 finalize 监控、角色部署检查及生产全流程仍未完成。

### Pending root 检查、取消与 finalize 准备

`treasury-lifecycle` 使用 `TG_TREASURY_LIFECYCLE_RPC_URL`，核对 manifest runtime/core bindings、epoch 资金与来源块，并在同一 canonical block hash 上读取状态。观察必须在 120 秒内。当前入口针对 `ROOT_PENDING`；其他状态返回错误，不自动发起动作。

```sh
# 查看等待状态、finalizeReady，以及 claiming / rolled_over 的预计结果。
go run ./cmd/treasury-lifecycle --action inspect --manifest /path/to/manifest.json \
  --market "$MARKET_ID" --epoch 1

# 对最新仍获批准的候选准备 finalize；需要只读数据库账户。
# TG_TREASURY_LIFECYCLE_DATABASE_URL 指向 candidates/reviews/journal 所在库。
go run ./cmd/treasury-lifecycle --action finalize --manifest /path/to/manifest.json \
  --candidate "$CANDIDATE_ID" --sender "$FINALIZER_ADDRESS"

# 取消未知或错误根也必须可行，因此取消不依赖本地候选或批准。
# 操作人显式提供当前链上两个 commitment，以及取消理由的非零 bytes32 hash。
go run ./cmd/treasury-lifecycle --action cancel --manifest /path/to/manifest.json \
  --market "$MARKET_ID" --epoch 1 --sender "$CANCELER_ADDRESS" \
  --expected-root "$ROOT" --expected-dataset "$DATASET_HASH" --reason-hash "$REASON_HASH"
```

finalize 在 `block.timestamp >= finalizeAfter` 才可准备，且要求最新独立审核批准、候选与链上 root/dataset/TWAB/leaf count 完全一致；模拟完成后再确认审核没有变化。空分配根的最终行为是 rollover，能否执行仍以 sender-specific `eth_call` 为准。取消没有 finalizeAfter 截止限制，但要求目标 commitments 与观察一致，并通过取消者身份模拟权限。此入口不会签名、广播，也不提供持续轮询或持久化告警。输出仅为 `simulated_unsigned`；后续执行器必须重新核验状态及审核，不能将旧计划视为执行授权。

### 创建市场元数据服务

`go run ./cmd/content-worker --run` 启动独立上传服务，默认监听 `127.0.0.1:8791`。先运行迁移，再配置 `TG_CONTENT_DATABASE_URL`、`TG_CONTENT_PUBLIC_ORIGIN` 和 `TG_CONTENT_WEB_ORIGIN`；监听地址可用 `TG_CONTENT_HTTP_ADDR` 修改。公共 origin 必须 HTTPS（本机开发可 HTTP），部署后应保持域名和 URL 可持续访问。前端 `/launch-metadata` 请求应由反向代理转到此服务，不要将写入凭据给只读 API。

- `POST /launch-metadata`：沿用名称、symbol、描述、可选图片/social/website 和 launch 偏好字段，返回 `{metadataURI}`。要求精确 Origin 和 JSON；请求最多 3 MiB，图片最多 2 MiB，宽高各不超过 4096。PNG/JPEG/WebP 必须完整解码成功，最多同时处理两次上传。未知、重复字段及类型错误被拒绝。
- `GET /launch-metadata/{sha256}.{json|png|jpg|webp}`：重新核验 SHA-256 后提供 immutable 缓存响应。图片与 JSON 原子存储在 PostgreSQL，重试去重；无单独文件丢失或半完成资源。JSON 保持字段语义，URL 正规化或 JSON 编码差异可能产生不同于旧 TS 服务的哈希，不应重新计算并替换已上链 URI。
- 数据库 `content_quota` 默认容量 1 GiB、每小时 2000 个新对象（含图片和 JSON）；多实例共享配额，重复对象不消耗额度。管理员按部署容量调整限额，应用账号只需 objects 的 SELECT/INSERT、quota 的 SELECT，不应有修改配额、UPDATE/DELETE、TRUNCATE 或 owner 权限。容量和小时额度耗尽时返回 429，已存对象读取不受影响。Origin 校验不是用户身份验证；钱包所有权、细分用户配额及外围限流仍待完善。
- `/livez` 与 `/readyz` 提供进程和内容表可用性探针；与读 API 的快照 readiness 独立。生产应对整个数据库执行备份和恢复演练，保留所有已经返回的 URI，不按“暂未上链”删除对象。本轮提供 PostgreSQL 持久存储；S3/CDN 适配、备份恢复验收和存量 TS 文件迁移尚未完成。

图片解码使用 Go 标准 PNG/JPEG 解码器及 [golang.org/x/image/webp](https://pkg.go.dev/golang.org/x/image/webp)，锁定 `x/image v0.45.0`。元数据中的税率偏好不能替代 Factory 的最终参数检查。

### 存量元数据导入与恢复演练

`content-import` 面向旧 TS 服务导出的平面目录。先复制为稳定、只含 `{sha256}.{json|png|jpg|webp}` 的导出目录；不会读取任意远端 URL、递归子目录或跟随文件符号链接。每次最多 1000 个文件、128 MiB，单文件最多 2 MiB。JSON 必须符合现有元数据语义；图片需完整解码，JSON 的本地图片引用必须存在于同批目录且使用指定原 origin。残留 `.tmp`、缺图、损坏图片等会拒绝该批，保留旧服务并先调查，不能为通过导入而重写已上链资源。

```sh
# 只读预览；无数据库凭据也能运行。输出摘要和逐文件清单。
go run ./cmd/content-import --directory /path/to/legacy-export --origin https://metadata.example.com

# 核对清单后，用该摘要执行；命令会重新读取并校验全部文件。
# TG_CONTENT_IMPORT_DATABASE_URL 使用独立导入角色。
go run ./cmd/content-import --directory /path/to/legacy-export --origin https://metadata.example.com \
  --apply-digest "$INVENTORY_DIGEST"
```

导入保留原字节（含字段顺序、空白与转义）及 SHA-256 文件名；同批对象和 `content_imports` 审计记录原子提交。摘要绑定 origin、文件哈希、字节数和图片尺寸；目录改变后旧摘要失效。重复执行同摘要不会新增对象或审计记录，提交结果不确定时用原摘要重试。共享容量/小时配额同样适用，不自动扩容。导入角色需 objects 的 SELECT/INSERT、imports 的 SELECT/INSERT；应用上传角色不需要 imports 写权限。数据库 owner 仍属于信任边界。

`make smoke` 现包含实际 `pg_dump`/`pg_restore` 演练：在临时数据库中上传图片和 JSON、通过独立 CLI 导入旧格式 JSON、重启内容进程，然后备份整个数据库并恢复到另一新数据库，重新启动服务核验相同 URI 的 JSON 和图片字节。需要本地 PostgreSQL 的 pg_dump/pg_restore 命令。此测试证明本地恢复路径；生产备份保留策略、异地副本、恢复耗时/RPO/RTO、DNS/代理切换与真实历史库存迁移验收仍需按部署环境执行。已上链 origin 不应随迁移改变。

### 完整市场目录筛选（OpenAPI 2.5.0）

`GET /v1/markets` 在可信快照的整个市场目录上筛选，然后分页，不受浏览器已加载前 100 条限制。可组合 `assetUid`（STOCK bytes32）、`marketId`（bytes32）、`memeToken`（地址）和 `launchPhase=0|1`，组合条件为 AND。地址输入会归一化为小写；默认 `sort=marketId_asc`，也支持 `marketId_desc`。该顺序只表示标识符顺序，不表示创建时间、涨幅、成交量或热度。

分页沿用 `limit=1..100`、`cursor` 和 `revision`。先取得 snapshot revision，后续页持续传同一 revision；cursor 同时绑定归一化筛选条件和排序，不能跨条件或快照复用。改变 limit 可继续使用同一游标。未知参数、重复参数、非法阶段或排序返回 400；同步不可用时仍返回空目录与明确 sync 状态。

名称、symbol 与创建时间查询现已接入可选 identity 字段，使用方式见下文；统计排序仍属 B11 待完成项。Go/TS 共用版本化 OpenAPI，生成的后端 SDK 与前端客户端均已同步。

### 链上市场名称与创建时间观察

```sh
TG_CHAIN_ID=46630 TG_RPC_URL="$RPC_URL" go run ./cmd/verify-deployment \
  --market-identity "$MARKET_ID" /path/to/manifest.json
```

命令在 finalized 区块上核对核心部署、Registry 市场与 token 反向映射、token 的 `marketId()`/`factory()`，读取 `name()`、`symbol()`、`metadataURI()` 和 `deployedAt()`，并输出观察区块与 token runtime code hash。该 runtime hash 是观测证据，实例身份来自已验证的 Factory/Registry 关系。名称和 symbol 各最多 4096 字节，URI 最多 16384 字节；严格动态字符串 ABI 校验拒绝错误 offset/length、非零填充、尾随数据和非法 UTF-8，不将 bytes32 返回值猜测为字符串。

所有调用固定同一 canonical hash，最后复查区块；时间不能晚于观察块。结果是链上显示信息观察，不是完整财务投影，也不授权读取 URI 的远端内容。此入口不会修改原始日志、发布快照或广播交易。持久化和读模型接线见下文。

### 市场显示信息持久同步

运行 `go run ./cmd/market-identity-worker --once` 或 `--run`，配置 `TG_MARKET_IDENTITY_DATABASE_URL`、`TG_DEPLOYMENT_MANIFEST`、`TG_CHAIN_ID` 和 `TG_RPC_URL`。先运行迁移与 discovery-worker；manifest 必须与 discovery checkpoint 完全一致。`--describe` 显示能力边界。

每轮最多同步一个缺失市场，在原创建区块读取名称、symbol、URI 和 deployedAt；要求链上 token 地址/runtime hash 与发现记录一致，部署时间等于创建块时间。需要该区块的 archive state，不能退回 latest。写入不可变 `market_identities`（迁移 21）及 SHA-256 完整性摘要，成功后重复运行返回 idle。事务使用同链 advisory lock 与 journal/discovery 协调，单轮最多 45 秒；RPC/数据错误时退出，服务管理器应记录失败并按退避策略重启。

内部 `marketidentity.LoadAt` 要求给定快照区块哈希，只返回该 canonical finalized 快照之前的创建记录，并核验 payload 摘要与索引字段。消费者使用 `canonical_market_identities`，不能直接将历史表视为当前事实；创建块或发现 checkpoint 失效时记录会被隐藏。该来源已接到可选市场 DTO 和 HTTP 名称搜索参数，但 worker 不自动发布财务快照。

### 身份快照发布与名称/时间查询

OpenAPI 2.5.0 的 MarketReadModel 增加可选 `identity`：name、symbol、metadataURI、deployedAt（Unix 秒十进制字符串）、创建 blockNumber/blockHash 和 token runtimeCodeHash。旧快照可省略；提供时必须完整且与 canonical 持久观察一致。发布命令设置 `TG_PUBLISH_IDENTITIES=true` 可为输入快照补全所有市场；任何缺失或既有字段错配均拒绝发布。默认 false 保持旧生产者兼容。发布会再次核验，读取时来源失效使当前快照 unavailable，固定 revision 读取失败。

`GET /v1/markets?search=TREE&createdFrom=100&createdTo=200&sort=createdAt_desc&limit=20`

- search 在名称、symbol、marketId、memeToken、assetUid 中做字面子串匹配，1–128 UTF-8 字节；ASCII 字母忽略大小写，其余 Unicode 精确匹配，不使用正则。
- createdFrom/createdTo 为含端点的 Unix 秒范围，规范十进制，最大 9223372036854775807；createdAt_asc/createdAt_desc 按时间排序，同时间始终按 marketId 升序。
- 条件与既有筛选取 AND，先查完整目录再分页；游标绑定规范化查询、排序及 revision。
- 任一市场缺 identity 时，名称/时间相关查询返回 503 identity_unavailable，避免返回不完整结果；旧 ID 查询仍可用。

当前查询扫描已发布快照，身份读取逐市场核验来源；数据库搜索索引、大目录性能、统计排序及自动财务快照生产仍待实现。此阶段未切换前端搜索 UI 或线上服务。


### Quote / Baseline / Template 完整配置补读

projection-worker 的 `V1-EXEC-11:business-facts-v7-config` 范围为 `market-curve-gauge-vault-fees-holder-config-v1`。每块从已认证配置事件的投影行选取全部已知 quote、baseline、template（包括当前块新增记录），按 ID 去重排序后固定同一 blockHash 读取完整静态 ABI。第 22 项迁移扩展持久观察类型；配置结果和事件行、观察批次、游标同事务提交，不把区块末配置重复套到每笔事件。

Quote 额外保存 stockQuoteBinding、runtimeCodeHash 和 Registry 返回的 identityCurrent。Template 按 Registry v2 ABI 域重算 templateHash，并逐一读取五个组件的 runtime，保存 componentCodeIdentityCurrent。identityCurrent=false 保留为待对账的观察结果；不自动宣告配置可用于创建。状态仅接受 active/paused/retired，ABI、哈希、RPC 或末次来源检查失败则整块回滚。Baseline 的 reference 字段来自 Registry 历史配置，没有提升为独立的第三方源码审计。

同步预算最多 1024 个配置、45 秒；超限失败而非截断目录。旧 v6 checkpoint 拒绝混用，必须在独立数据库重建并验证后切换；迁移不删除既有历史。配置观察仍不是完整独立财务对账，也尚未自动生成 API 配置快照。


### PoolKey 与 canonical route 观察

`verify-deployment --market-route MARKET_ID MANIFEST.json` 在 finalized 块提供独立只读检查。`projection-worker` v8-route 将同一检查接到每块全部已发现市场（最多 1024），新 scope 为 `market-curve-gauge-vault-fees-holder-config-route-v1`，迁移 23 扩展五类观察：poolKey、canonicalRoute、routeRuntime、poolBinding、lockedPosition。按市场排序、与事件/配置/游标同事务保存；读取失败整块回滚。旧 v7 checkpoint 需要独立重建验证。

检查 PoolKey 严格 ABI、币种排序、零基础池费、tickSpacing 范围和 Hook 身份；复算 keccak256(abi.encode(PoolKey)) 并对照 canonicalPoolId/route。曲线阶段使用预测池 ID，MarketRuntime.poolId 仍允许为零；路由两种交易开关及 activeFeeSource 与市场阶段/sourceVersion 一致。Router/Quoter 与 Registry 根配置一致且 runtime 存在。

毕业后另查 Hook 的 Registry/市场/keyHash/sourceVersion/ACTIVE 绑定，以及 Locker 的 marketId、非零 NFT tokenId 和锁定 poolId。代码 hash 是当前观察证据，不提升为独立模板审计或完整权限核验。当前未验证 NFT 底层头寸流动性、PoolManager 状态、Router/Quoter 全部依赖、Locker 全部提款权限或可执行报价；这些仍属后续完整对账/部署验收。观察不进行交易签名或广播。


### 已发现 Vault 账户的持续刷新与合计检查

投影版本 `V1-EXEC-11:business-facts-v9-vault-accounts` 从已认证的 stockPositions/allocations 行恢复账户集合，包含本块新增行；每块（含空块）刷新 deposited/allocated/freeBalanceOf 和已知 allocation/cutoff。账户及市场身份严格校验、重复目标去重，历史输入最多 10000 条，超限拒绝而非截断。迁移 24 扩展 `market-curve-gauge-vault-fees-holder-config-route-accounts-v1` 范围；旧 checkpoint 须独立重建验证。

vaultSolvency 保存 knownUserDepositedSum、knownUserAllocatedSum、knownMarketAllocatedSum 及账户/市场数量，并与链上总额分别比较；vaultMarket 保存已知用户 allocation 之和。使用大整数，差额检查 false 时仍保存证据。`fullReconciliation` 始终 false：已发现集合不等于已证明完整的历史，合计相等也不能单独证明历史完整或授权快照发布。


### Gauge 历史账户与空块刷新

v10-gauge-accounts、迁移 25 将每个启用质押的市场纳入每块 Market/Gauge 观察，账户从已认证 gaugePositions 行恢复（最多 10000 条），并与当前事件用户去重。空块及重启后继续读取 positionOf、双资产奖励预览和 pending generation 的 activationSnapshot。无质押市场不创建 Gauge 账户。

knownStoredActiveSum = 已知用户 activeAmount + processed activationSnapshot 对应的尚未物化 pendingAmount；knownPendingSum 仅包含未处理批次的 pending。分别与 storedTotalActiveStock、totalPendingStock 比较；不把 stored 与 effective 总量混用，不把 Gauge 权重当成 Vault 本金。knownUserCount 和失败检查作为证据保存，fullReconciliation=false；完整历史覆盖及独立财务对账仍待验证。新 scope 为 `market-curve-gauge-vault-fees-holder-config-route-accounts-gauge-v1`，旧版本需要独立重建验证后切换。


### Vault 事件本金账本重算

v11-principal / 迁移 26 增加 principalAccount、principalAllocation 观察。初版每块按 canonical 原始来源顺序重新读取持久投影输入，核验 payload 摘要、原始日志及输入覆盖，再独立应用 StockDeposited、StockWithdrawn、AllocationLocked、AllocationReleased。AllocationRageQuit 是释放/提款后的通知，不重复扣减。allocation 事件的 userMarketAllocation/userTotalAllocated 作为检查点，余额负数、超额提款/锁定、uint256 溢出或检查点冲突使整块失败。

重算账户的 deposited/allocated/free、每市场 allocation 与同块 getter 对比，缺 view 或不一致保存 false 检查。getter 不影响事件重算结果。v11 的历史输入预算每轮最多 100000 条/64 MiB；v12 已改为下述当前块增量处理。historyComplete 始终 false：校验已有输入不是证明部署起始范围完整；尚未接通完整 reconciliation plan/run/probes 和自动快照发布。scope 为 `market-curve-gauge-vault-fees-holder-config-route-accounts-gauge-principal-v1`，旧 checkpoint 需独立重建验证。


### 本金账本增量检查点

v12-principal-checkpoint / 迁移 27 新增不可更新、不可删除的 `principal_checkpoints`。每块恢复 canonical 父块的本金账本，仅读取当前块输入；检查点、事件输入、观察结果和投影游标在同一事务提交。恢复核对 SHA-256 摘要、链与区块、清单指纹、投影版本、起始高度和累计输入数量；缺失或不匹配即停止，不从 getter 补余额。

账本恢复要求规范 JSON、唯一账户和 allocation、uint256 金额、本金守恒以及每账户 allocation 合计一致。单块输入预算仍为 100000 条/64 MiB，账本快照上限 64 MiB。旧版本数据库需在独立数据库按原清单和起点重建、验证后切换；迁移不会自动把旧检查点升级成可信本金账本。

增量范围仅为本金事件处理：每块仍序列化完整本金账本，通用 `projection.State` 在冷启动时仍回放历史。大规模吞吐、检查点存储增长和恢复耗时仍需验收。`historyComplete=false` 保持不变；检查点有效不证明历史范围完整，也不启用自动财务快照发布。


### 本金对账计划与结果

v13-principal-reconciliation / 迁移 28 在每块投影事务内保存 `reconciliation_runs` 与 `reconciliation_probes`。计划直接来自事件本金账本：每账户 deposited、allocated、freeBalanceOf 三项，每 allocation 一项；不能根据实际返回的 getter 缩减计划。逐项保存 expected/actual/status，并统计 expected/completed/failed/missing。缺失、重复或非法 uint256 getter 不计完成；金额差异保存 mismatch，不改写账本。

报告 payload 包含完整有序计划和结果，并保存 SHA-256 摘要；数据库限制计数关系、结果语义与不可更新/删除。检查点、对账、观察批次、输入与游标同事务提交。查询使用 `canonical_reconciliation_runs` 和 `canonical_reconciliation_probes`，失效主链或投影 tip 的结果不会出现在视图中。旧投影版本仍需独立重建验证后切换。

该 scope 仅覆盖已知 Vault 账户本金。零项计划显式保留，`historyComplete=false`、`publicationEligible=false` 始终成立；全部 probe 相等也不授权 synced 发布。部署历史起点证明、全资产/Gauge/FeeVault/Treasury 对账及发布门槛整合仍待完成。


### 资产级本金与偿付对账

v14-principal-solvency / 迁移 29 将对账范围升级为 `vault-principal-v2`。在原逐账户/逐 allocation 计划之外，每个事件账本已知资产新增 totalDeposited、totalAllocated 两项相等检查，以及 tokenBalance 对事件总存入的 atLeast 检查。数据库逐项保存 comparison，并按数值验证 matched/mismatch 语义；多余 Token 余额允许存在，余额不足保留差异。

合计以资产分组，每账户只计算一次，不将市场 allocation 再加进存款。使用任意精度整数，跨账户超过 uint256 的异常合计不会截断或回绕；链上 getter 仍要求合法 uint256。资产没有任何已采集本金事件时不凭空加入此事件账本计划，因此全资产覆盖与历史完整性仍待证明，historyComplete/publicationEligible 继续为 false。旧 v1 报告保留，旧投影版本仍需独立重建验证。


### 只读核验本金对账报告

运行 `go run ./cmd/reconciliation-inspect CHAIN_ID BLOCK_HASH`，设置独立的 `TG_RECONCILIATION_DATABASE_URL`。`--describe` 不连接数据库。入口限定支持的链与规范区块哈希，30 秒超时，使用 repeatable-read 只读事务与链共享锁；锁忙、记录缺失或证据不一致时失败且不输出部分报告。

读取账户需 schema USAGE，以及 canonical_reconciliation_runs、principal_checkpoints、projection_observation_batches、projection_checkpoints、reconciliation_probes、chain_blocks、projection_inputs、chain_logs 的 SELECT 权限。命令不执行迁移、写入、签名或发布。

检查包括报告与本金检查点 SHA-256、观察批次摘要、链/区块/清单/版本/起点绑定；恢复事件账本并从保存的 getter 批次重新计算报告，逐字节核对报告 payload、数据库计数，以及探针序号/身份/预期/实际/状态/比较规则。仅支持当前 projector 版本与 vault-principal-v3，旧版本需使用其对应验证器或独立重建，不静默套用新规则。

返回 `evidenceVerified=true` 表示保存证据自洽，报告内 `historyComplete` 和 `publicationEligible` 仍为 false。该命令不重新访问 RPC、不证明历史输入完整，也不能抵御拥有数据库管理权限者对所有来源一致篡改；运维需保留来源与备份权限隔离。


对账检查入口进一步验证配置起点至目标区块的连续存储范围。`coverage` 返回 startBlock/endBlock/blockCount、journalContinuous、principalCheckpointsContinuous；逐高检查 canonical 区块、receipts_verified、非空且不倒退的时间戳、区块父哈希及本金检查点父哈希。首个本金检查点必须没有父检查点，最后哈希必须等于请求目标。中间缺块或失效也会拒绝，即使当前 tip 仍有效。

范围最多 1000000 个区块，仍受命令 30 秒超时约束；超预算失败，不返回截断结果。这里只证明“已配置范围连续”，`deploymentStartVerified=false` 保持不变：配置起点可能晚于部署，范围连续不证明起点之前没有存款或所有历史日志均由 RPC 提供。输出不得提升为完整财务历史证明。


检查入口还会独立重放配置范围内的本金事件：逐项核对投影输入摘要、原始 chain_logs 内容、链/区块/日志索引和 removed 标记，按区块/日志顺序重新应用事件；输入条数须等于目标本金检查点的累计 inputs，重放快照须逐字节等于该检查点 ledger。`coverage.eventReplayVerified` 与 `replayedInputs` 明确报告该结果。

独立重放最多 100000 输入、输入与原始日志合计 64 MiB，超预算失败。这是只读检查命令的验收预算，不改变持续 projector 的每块增量处理。它证明存储输入与本金检查点相符，仍不证明部署起点或 RPC 历史日志采集完整，原有历史和发布限制保持不变。


### 市场 allocation 合计对账

v15-principal-markets / 迁移 30 将本金计划升级为 vault-principal-v3。在逐账户、逐 allocation、逐资产检查之外，每个事件账本已知的 assetUid/marketId 新增 marketAllocated 检查，以所有用户该市场 allocation 之和对照 Vault getter。资产与市场组合为独立键；完全释放后保留零合计目标，避免悄悄丢失应查项。市场合计不再加入存款或 free，避免重复计算本金。

市场 probe 同样保存预期/实际/差异，接入 reconciliation-inspect 的事件重放和证据核验。旧范围报告保留，新版本需独立重建验证；完整历史和自动 publication 的限制不变。


### 后端流水线运行状态

`go run ./cmd/backend-status --once` 通过独立 `TG_STATUS_DATABASE_URL` 只读检查配置的 TG_CHAIN_ID（默认 46630）；`--describe` 无数据库依赖。设置 TG_STATUS_MAX_LAG_BLOCKS（默认 100，可为 0）及 TG_STATUS_MAX_PROGRESS_AGE（默认 15m）。命令使用 10 秒超时、repeatable-read 只读事务和链共享锁。

输出采集/发现/投影/发布高度与 lag、本地 finalized 锚点、journal 最近推进时间、最新本金报告失败/缺失数及稳定 alert 代码。journal 可领先 finalized；discovery 以 finalized 为参照，projection 以 discovery 为参照，publication 以 projection 为参照。默认不查询实时 RPC head；未配置下述 RPC 检查时，不能直接测出链头至采集器的积压；journal_progress_stale 表示长期未保存进展，也可能是链本身暂停，不能单凭它断言进程已死。

退出码：0 = 已检查信号在阈值内；2 = 完整报告中存在 attention 信号；1 = 配置、锁或数据库等检查失败（无部分报告）。可由现有监控调度采集 JSON 和退出码，本实现不自行发送通知。标记 productionReadinessVerified 始终 false；它不取代 /readyz、独立对账检查器、真实 RPC 验证或上线验收。

读取角色需要 schema USAGE，以及 chain_journal、chain_blocks、discovery_checkpoints、projection_checkpoints、read_snapshots、canonical_reconciliation_runs 的 SELECT。当前覆盖核心进度、manifest 不一致、非主链、陈旧进展与本金报告信号；更完整的 RPC 指标、worker 错误计数、权限审计与生产告警接收端仍需接入。


设置可选 `TG_STATUS_RPC_URL` 后，backend-status 会在数据库只读事务结束后读取 RPC chainId、genesis、latest、finalized，并按具体高度复查 latest/finalized 哈希；身份必须与已初始化 journal 一致。`rpc` 对象记录独立 observedAt/durationMs、链头和 finalized 高度/哈希、journalLagBlocks、finalizedLagBlocks 及已存 finalized 哈希的匹配结果。数据库 observedAt 与 RPC observedAt 不合并为同一原子时刻。

实时积压沿用 TG_STATUS_MAX_LAG_BLOCKS；新增 rpc_journal_backlog、rpc_finalized_backlog、rpc_head_behind_journal、rpc_finality_regression、rpc_finalized_anchor_changed 信号。已配置 RPC 后，连接、链身份或读取一致性失败返回退出码 1 且不输出部分报告，不静默降级为 DB-only。未配置时保留原行为。总命令超时仍为 10 秒，URL 不进入输出；命令只观察，不推进游标或提交交易。该检查依赖单个 RPC，不等于独立共识验证或生产就绪。


### 按受益人与 Creator epoch 隔离的累计已领

v16-fee-claim-totals / 迁移 31 新增 `feeClaimTotals` 投影行，与逐笔 `feeClaims` 分开。键为 marketId/feeAsset/beneficiaryType/beneficiary/beneficiaryEpoch；保存 claimedAmount、claimCount、firstClaimEventKey，并以最新领取事件作为最后更新来源。Creator 更换受益人或 epoch 不会把旧已领金额转给新受益人；不同角色、市场和币种不混加。

只有已认证的 FeeClaimed 增加累计已领，转换、费入账和未领 getter 不计入。金额与次数使用任意精度整数；重复日志由投影幂等机制排除。Go 与 TypeScript 参考投影及重放快照格式同步，重启/空块不重复累计。historyComplete=false 说明它仅覆盖配置采集范围，尚未成为完整生命周期财务证明；未领/转换对账与自动 API 财务快照仍待后续接入。


### 2026-09-06 B07/B08 Creator 原币退出状态

v17-creator-exit 在 creatorEpoch 观测中加入 rawRewardExitAt、rawRewardExitReady 与 observedAtTimestamp。按市场/受益人读取 pinned block getter，同一受益人跨 epoch 共享该退出请求，但各 epoch 的 liability 仍分别保留。仅非零时间且观测区块时间达到延迟时标记 ready；不依赖服务器当前时间，uint256 时间不截断为 uint64。缺失 getter 或非法区块时间使整个观测失败，不把缺失值当作零。

ready 仅表示原币退出延迟满足，不证明余额、偿付能力或交易可执行；Quote 不受该 Meme 退出延迟限制。当前未增加公共收益 API，Staker 的退出状态、完整收益对账和财务发布仍需继续开发。无新迁移，投影版本改变后旧数据需在独立数据库重建验证。


### 2026-09-06 B07/B08 Staker 原币退出状态

v18-staker-exit 在 gaugePosition 中加入 rawRewardExitAt、rawRewardExitReady 与 observedAtTimestamp。通过已认证 Gauge identity 中绑定的 ProtocolFeeVault，按市场/用户在同一个 block hash 读取退出 getter，与 positionOf 的 Quote/Meme 预览收益共同持久化；历史用户在空块仍刷新，取消请求后不保留过期 ready。缺失/畸形 getter 或非法观测时间使整批失败，不返回部分收益。

rawRewardExitReady 仅表示 Meme 原币退出延迟已满足，不代替余额、偿付能力、完整历史与交易执行检查。未领取余额不因等待到期而被删除，也不提前计入累计已领。公共收益 API、完整对账与发布仍未完成。无新迁移；旧投影需按 v18 在独立数据库重建验证。


### 2026-09-06 B07 区块末统一收益记录

迁移 32 / v19-reward-positions 新增 rewardPosition：以 market/feeAsset/role/beneficiary/epoch 为键，将 Creator liability 或 Gauge positionOf 预览的 unpaidAmount、事件累计 observedClaimedAmount/observedClaimCount、首笔领取来源和原币退出状态汇总。Quote/Meme、Creator epoch 与 Staker epoch 0 分开；不将已领与未领相加，不把 Meme 未领直接等同于待转换或立即可领。未发现领取事件时观测累计为 0，historyComplete/publicationEligible 始终 false。

当前块事件更新、收益记录、观测批次及游标处于同一事务。每次从最多 100000 条 feeClaimTotals 读取累计，校验存储键；不能匹配观测的 Creator/Staker 领取、重复身份、资产冲突、区块时间混用或错误 ready 都使整批失败。已领取累计使用任意精度，单项未领遵守 uint256。旧版需独立重建；公共收益 API、独立完整收益对账与待转换状态仍待完成。


### 2026-09-06 B07 用户收益观测查询 API

Go API 新增 `GET /v1/users/{address}/rewards?limit=50&cursor=...&revision=...`，OpenAPI 2.6.0 与 Backend/Web 生成客户端提供 `listUserRewards`。返回按完整收益身份排序的 items、nextCursor 和 source（chainId/blockNumber/blockHash/revision/finality），每页最多 100。游标绑定用户和当前投影 revision；投影前进后旧游标返回 400，客户端重新从第一页读取。

API 通过 TG_DATABASE_URL 只读 repeatable-read 事务和共享链锁，读取当前已确认投影观测批次；检查当前投影版本/范围、主链和回执状态、finalized 高度、journal 120 秒新鲜度、批次摘要和计数，再从保存的 Creator/Gauge 观测重算收益记录并逐项比对。数据缺失、过期、损坏或数据库不可用返回 503，不能用空数组伪装不可用；仅在有效观测中无该用户记录时返回空数组。单次请求 5 秒超时，不进行 RPC 或交易。

这是观测数据接口，未完成独立领取事件历史证明或完整收益对账；historyComplete/publicationEligible 始终 false，不代表生产可领取/可转换金额。未修改已有快照发布门槛。Go API 数据库只读角色需增加 projection_checkpoints、chain_blocks、chain_journal、projection_observation_batches 的 SELECT；现有 TypeScript 快照服务不实现该 Go 数据库查询路径。无新迁移或投影版本变化，仍为 32 项迁移/v19。


### 2026-09-06 B07/B08 转换候选状态

v20-reward-conversion / OpenAPI 2.7.0 在统一收益记录及 GET rewards 中增加 conversionStatus 与 conversionCandidateAmount。Quote 为 not_applicable；Meme 依次区分 no_rewards、not_graduated、rage_quit_pending、raw_exit_ready、candidate。仅 candidate 保留原始 Meme 未领金额作为候选额，其他状态为 0；不会把候选金额加到 unpaidAmount，也不估算 Quote 收入。

使用每块已认证 canonicalRoute.launchPhase；Gauge 同区块补读 AllocationManager.rageQuitSettlementPending(market,user) 及 principal。getter 缺失/畸形拒绝整个观测。原币退出等待期间仍允许形成转换候选，到期后禁止；Staker rage quit 未结算阻止候选。缺少 route 或结算状态时不推断默认可转换。

candidate 仅通过本阶段观测资格检查，不是已排队或可广播交易；操作者权限、资产偿付能力、报价/流动性、32 项批次上限、期限与 minimumQuote 仍属于实际执行验证。historyComplete/publicationEligible=false。前端生成客户端同步；无新迁移，仍 32 项，旧投影须按 v20 独立重建。


### 2026-09-06 B08 转换事件批次守恒

迁移 33 / v21-conversion-batches 在当前块内按交易/FeeVault/市场配对 RewardConverted 与 RewardBatchConverted。检查逐项用户/epoch 唯一、最多 32 项、批次非零 nonce、同块 nonce 不重复、资产匹配 canonicalRoute，以及逐项 MemeSpent/QuoteReceived 大整数精确合计。孤立项、空批次、跨交易配对或不守恒使整个区块事务回滚。rewardConversionBatch 保留逐人事件键、原始数量与 epoch、交易/发出方、批次 nonce，空块不重复生成。

校验范围为已认证事件内部守恒及市场资产归属，不证明完整转换执行资格、历史 nonce 连续性或实际转账。原始 maximumMeme 和 refund 未包含在这些事件中，因此不凭空推断退款或请求额；holder 转换另属独立流程。事件转换不计入 FeeClaimed 累计。historyComplete/publicationEligible=false；当前未添加批次查询公共端点。旧投影需独立重建。

本阶段 Go 全量 race/vet/build、生成契约、smoke-gauge 与 smoke-vault 通过，含 33 项迁移、备份恢复和真实合成 EVM 同交易两条日志落库；批次 7 Meme/11 Quote、用户 epoch1 归属、重启/空块稳定及累计已领不变均验证。复核并修正测试触发路径，覆盖 32 项成功/33 项失败、相同用户跨 epoch 成功、重复 user/epoch、重复 nonce、孤立/空批次、跨交易及金额/资产不一致。无生产执行。


### 2026-09-06 B07 查询时独立重放已领历史

GET rewards 不再从汇总记录反推领取输入作为最终验证。只读事务内从投影 start_block 到当前 tip 重放 projection_inputs，与 chain_logs 逐条比对原始日志、摘要、链/区块/日志位置，检查主链已验证区块覆盖计数及 checkpoint.input_count；仅 FeeClaimed 进入累计，RewardConverted 等不进入。重算的角色/受益人/epoch/资产累计再与 rewardPosition 全量比对，汇总自洽但不符合已存事件也拒绝。

OpenAPI 2.8.0 / SDK 的 source 增加 observedClaimHistoryVerified=true 和 replayedInputCount（十进制字符串）。该标记仅表示已保存输入与汇总相符，不证明 RPC 采集完整性、部署起点或所有收入负债守恒；historyComplete/publicationEligible 仍 false。验证预算 100000 输入、64 MiB、1000000 区块及原 API 5 秒超时，超限返回 503；大规模历史仍需经验证的增量缓存/检查点以支持生产性能。

API 只读数据库角色还需 projection_inputs、chain_logs 的 SELECT 权限。无迁移或投影版本变化，仍 33 项迁移/v21。


### 2026-09-06 B07 领取历史区块连续性

领取历史重放从单纯区块计数升级为逐高度验证：范围内 canonical 区块高度连续、回执已验证、父哈希连接前一区块、时间戳非空且不倒退，并以当前投影 tip 哈希结束。Creator/Gauge 观测的 observedAtTimestamp 还必须等于所绑定区块的实际时间；即使重算批次摘要也不能改变退出/转换判断的时钟来源。

此校验仍只覆盖配置的已保存范围，首块父节点在范围外，不构成部署起点证明。API、OpenAPI 2.8.0、33 项迁移与 v21 投影版本不变；完整历史/生产发布标记不变。保持现有 1000000 区块与请求时间预算。


### 2026-09-06 B07 同一可见快照复用验证结果

收益 Store 增加单项、最多 16 MiB 的进程内验证缓存。键包含 pg_current_snapshot（xid8 可见范围）、服务器启动时间/地址/端口、恢复状态、数据库 OID、用户以及链/投影版本/scope/revision/批次摘要。仅在只读 repeatable-read 事务中使用；缓存命中仍先执行当前 metadata、canonical/finality、新鲜度、批次摘要和 revision 检查。

设计依据为 PostgreSQL 的事务可见快照定义（https://www.postgresql.org/docs/14/functions-info.html）。此实现以精确快照相等作为保守复用条件；任何已提交写入导致可见快照变化时重新验证，即使投影 revision 未变。服务器/数据库身份变化也不复用。失败结果不缓存，返回值从序列化副本解码，调用者不能修改缓存中的已验证金额。无需迁移、公共 API 或权限变更。

这减少同一稳定数据库状态下分页/重复查询的历史重放，不解决首次读取或持续写入下的大历史重放成本；缓存不等于持久增量检查点，也不改变 historyComplete/publicationEligible 标记。生产吞吐与长期历史扩容仍待验证。


### 2026-09-06 B07 领取历史流式累计

首次读取及缓存未命中时，领取历史改为按数据库行验证后立即累计，不再保留整个范围的 decoded projection.Input 列表。每条输入仍校验原始日志、摘要、位置和 ABI；非领取事件验证后释放，仅保存领取事件去重键及按市场/资产/角色/受益人/epoch 的累计。金额维持任意精度，首条领取来源不变；异常输入不产生部分成功响应。

保留 100000 输入、64 MiB 累计读取字节、1000000 区块与 5 秒请求预算。此改动减少对完整解码历史的持有，但内存仍随领取事件去重键和收益身份数量增长，不声称常数内存或已达到生产吞吐。API、OpenAPI 2.8.0、33 项迁移、v21 投影版本及 historyComplete/publicationEligible=false 不变。


### 2026-09-06 B07/B08 领取锁定条件

v22-claim-conditions / OpenAPI 2.9.1 为收益 API 增加 claimStatus、claimCandidateAmount、positionUnlockAt 和 positionLockSatisfied。Staker 使用同一区块 positionOf 的 activeAmount、pendingAmount、unlockAt：有本金时必须有非零 unlockAt，时间达到（含相等）才满足锁定条件；无本金时不受残留锁定时间限制。rage quit 待结算阻止两种资产领取。Creator 不使用 Gauge 仓位锁。

Meme 原币领取必须先请求退出并等到 rawRewardExitAt；Quote 不受该等待期影响。状态优先级为 no_rewards、rage_quit_pending、position_locked、raw_exit_required、raw_exit_waiting、candidate。仅 candidate 返回原始未领金额作为 claimCandidateAmount；候选不证明偿付能力、实际调用模拟或转账成功。转换仍按独立资格计算，不因仓位尚未解锁而被排除。

缺失或畸形 Staker 锁字段、存在本金但 unlockAt 为 0 时拒绝整批。旧投影需按 v22 独立重建；无数据库迁移（仍 33 项）。完整历史与生产发布标记仍为 false；生成 Backend/Web 客户端同步，未改动钱包交易流程。


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


### 2026-09-06 B10 维护请求与模拟记录持久化

迁移 34 新增 maintenance_jobs / maintenance_simulations。--preview --record 在运行时绑定验证与模拟成功后，使用 TG_MAINTENANCE_DATABASE_URL 原子保存固定调用身份及完整模拟记录。相同结果摘要重试返回同一 sequence；同一触发在新区块模拟时追加记录。行锁与唯一约束支持多进程去重；同一链/Genesis/发送者/操作/市场/用户/trigger 改指另一个目标时拒绝，避免把目标变化当作同一任务继续执行。

--history JOB_KEY [--after SEQUENCE] 以只读 repeatable-read 事务读取最多 100 条升序记录，供进程重启后审查；未知任务、链不符、摘要或固定调用身份不一致返回错误。记录校验包含 selector/参数、zero value、状态标记及返回值 ABI 类型；历史区块无需仍在实时新鲜度窗口内。记录只证明保存的模拟结果及其身份一致，不替代历史链状态独立重放或后续 fresh simulate。

持久化成功仍是 simulated，不是 queued/submitted/completed。尚未加入执行租约、nonce 预留、签名/广播、未知提交恢复或回执/后置状态确认。维护写入角色需两表 SELECT/INSERT、maintenance_jobs 行锁所需 UPDATE 权限及 identity sequence 使用权限；历史读取角色仅需 SELECT。应用不更新已有模拟，但数据库管理角色仍能修改表；摘要检查不抵御拥有完整数据库写权限的主动伪造。

```sh
# 在原 --preview 命令上加 --record；DSN 指向已执行迁移 34 的维护数据库
./bin/maintenance-worker --history "$JOB_KEY"
./bin/maintenance-worker --history "$JOB_KEY" --after "$LAST_SEQUENCE"
```


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

### Maintenance RPC submission transport

`internal/chainrpc.SendRawTransaction` is a low-level, single-attempt transport for already validated, durably recorded signed bytes (1–16 KiB). It computes the expected transaction hash locally and accepts an RPC acknowledgement only if that hash matches. RPC errors, lost responses, and mismatched hashes return `ErrSubmissionUnknown` together with the local hash. They do not authorize allocating another nonce or changing the signed bytes. The transport does not validate intent, coordinate persistence, or implement retries.

`TransactionReceipt` distinguishes an explicit `null` (no receipt observed) from malformed/error responses and verifies receipt/log identity, status and provenance. It does not establish canonicality, finality, or operation postconditions. A missing receipt does not prove non-submission. Semantics follow the [Ethereum JSON-RPC API](https://ethereum.org/developers/docs/apis/json-rpc/).

The maintenance CLI now connects this transport through the durable single-attempt submission flow described below. Receipt observations and RPC-reported finality checks are available below; explicit same-transaction rebroadcast is also available below; business postconditions are still pending. No production broadcast was performed. An opt-in test starts and cleans up its own loopback Anvil process; it does not accept an existing RPC endpoint:

```sh
ANVIL=/absolute/path/to/anvil go test -race ./internal/chainrpc -run TestIsolatedAnvilSubmission -count=1
```

### 2026-09-06 B10 持久化单次提交

迁移 39 增加 `maintenance_submissions`。`--submit` 是独立执行模式，不能与 `--preview` 混用；必须提供固定交易哈希及原租约 owner/token/generation。先依据 manifest 重新验证部署并生成新鲜预览，再逐项检查保存的签名/意图、链与 genesis、pending nonce、完整 gas/fee 调用模拟、观察块和租约有效性。预览允许收益金额随链状态变化，但目标和 calldata 必须保持固定。

数据库先提交 `submission_unknown`，随后才发送相同原始字节。并发或重复调用只返回已有记录，不再次发送；仅返回匹配交易哈希的节点确认才更新为 `acknowledged`。网络错误或确认记录写入失败保留 unknown；CLI 尽可能输出 job/hash/status 并以非零状态退出。进程在持久化后、发送前崩溃也会留下 unknown，因此该状态既不证明已经发送，也不证明未发送。不得据此释放或另行分配 nonce。

```sh
./bin/maintenance-worker --submit --manifest /absolute/manifest.json \
  --operation settle-rage-quit --market "$MARKET_ID" --trigger "$TRIGGER_ID" \
  --from "$SENDER" --user "$USER_ADDRESS" --transaction-hash "$TX_HASH" \
  --owner "$OWNER" --token "$LEASE_TOKEN" --generation "$GENERATION"
./bin/maintenance-worker --submission "$JOB_KEY"
```

`--submission` 不要求活跃租约或 RPC，可跨进程重新验证签名与持久记录。`--submit` 的重复调用仍先做 CLI 部署预览，已执行操作若不再可模拟，应直接使用 `--submission` 检查。已存在的提交不会因原租约到期或 pending nonce 增长被重新广播。

新表需要维护写入角色的 SELECT/INSERT/UPDATE 权限。`acknowledged` 只代表节点确认接收，所有输出仍 `executionComplete=false`。下一阶段提供回执持久化与 RPC 最终性观察；未知结果再广播、替换/取消和业务后置验证仍未实现，自动签名器未接入。当前实现没有生产广播。

### 2026-09-06 B10 回执恢复与历史

迁移 40 新增追加写入的 `maintenance_receipt_observations`。新命令查询已保存交易哈希，不要求原准备租约仍有效，也不会重新签名、广播或释放 nonce：

```sh
./bin/maintenance-worker --observe-receipt "$JOB_KEY"
./bin/maintenance-worker --receipt-history "$JOB_KEY" --after 0
```

观察前重新核对保存的 reservation/intent/signature/submission、RPC chain/genesis；查询 head/finalized 和回执。存在回执时，核对规范块头、整块回执与日志的一致性，再复查回执块及 head/finalized 锚点。链头距数据库当前时间不得超过 120 秒（未来最多 5 秒），请求最多 45 秒，单条证据最多 64 KiB。RPC 失败、链身份不符、回执来源不一致或检查期间重组均不保存半成品。

状态为 `not_observed`、`mined_success`、`mined_reverted`、`finalized_success` 或 `finalized_reverted`。最终性来自配置 RPC 的 finalized 声明及规范块一致性检查，不是独立共识或 receipt-root 证明。`not_observed` 不证明未发送；重组后它可以出现在先前入块观察之后。记录保存 head/finalized、回执、身份和 JSON 摘要；历史按 sequence 升序分页（最多 100），读取时重新验证摘要与身份。历史输出 `historical=true`，不代表当前链状态。

每次成功观察追加记录，保留重组前证据，不覆盖原 submission 的节点接收状态。新表需要 SELECT/INSERT 权限。`executionComplete=false`、`postconditionsVerified=false` 保持明确：即使交易 finalized_success，也尚未核实维护操作的业务后置条件。未知交易再广播、替换/取消、自动调度和生产签名器仍待实现。

### 2026-09-06 B10 原交易重发恢复

迁移 41 增加 `maintenance_rebroadcasts`。维护操作角色可使用新的、非零 bytes32 `attempt-id` 请求一次重发；ID 在 job 内唯一。同 ID 并发或重试只读原记录，即使第一次结果未知也不自动重发。要发起新的网络尝试，必须显式提供新的 ID。

```sh
./bin/maintenance-worker --rebroadcast --manifest /absolute/manifest.json \
  --operation settle-rage-quit --market "$MARKET_ID" --trigger "$TRIGGER_ID" \
  --from "$SENDER" --user "$USER_ADDRESS" --transaction-hash "$TX_HASH" \
  --attempt-id "$RECOVERY_ID"
./bin/maintenance-worker --rebroadcast-attempt "$JOB_KEY" --attempt-id "$RECOVERY_ID"
```

恢复不依赖已过期的准备租约，也不能修改目标、calldata、gas/fee、nonce 或签名。CLI 重新认证部署与模拟；Store 再次验证完整持久链路，检查回执缺失、固定观察块上的确认 nonce 尚未超过预留 nonce、精确 gas/fee 模拟、链身份及块时效。`NonceAtHash` 使用 EIP-1898 `{blockHash,requireCanonical:true}`；当前 pending nonce 增长不等于确认消耗，因而不会单独阻止同字节重发。若已看到回执或 nonce 已被确认消耗，停止并通过回执观察核对。

恢复记录先以 `submission_unknown` 提交，之后才发送保存的原始字节；匹配哈希的确认将本次 attempt 更新为 `acknowledged`。其他结果保留未知，CLI 尽可能输出 attempt/hash 并非零退出。多个不同恢复 ID 可以发出多次相同字节请求，它们仍是同一笔交易；不会创建替换交易或第二个 nonce。原 submission/回执历史保持原有证据，不因重发而改写。

新表需维护角色 SELECT/INSERT/UPDATE 权限。此阶段提供显式人工/上层调度恢复入口，不自动循环重发。费用替换、取消、业务后置验证、自动调度和生产签名器仍未完成，`executionComplete=false`。仅在独立本地 Anvil 分支验证，未生产广播。

### 2026-09-06 B10 后置状态与单任务完成判定

迁移 42 增加 `maintenance_poststates`，将后置证据绑定到同一 job 的 receipt observation（组合外键），保存原始状态 JSON、摘要和回执证据摘要。新表需维护角色 SELECT/INSERT 权限。

```sh
./bin/maintenance-worker --verify-poststate "$JOB_KEY" --manifest /absolute/manifest.json
```

先重新观察回执；仅 `finalized_success` 才进入后置验证。重新认证目标 runtime 和 market 关系，按回执所在的规范区块读取状态，最后再检查区块及 finalized 锚点。具体条件：

| 操作 | 区块末尾要求 |
| --- | --- |
| sweep | accruedCurveFees 为 0 |
| flush-forfeiture | deferredForfeiture 的 quote/meme 都为 0；成功回执本身不足以证明 flush 成功 |
| settle-rage-quit | rageQuitSettlementPending 为 false 且 principal 为 0 |
| treasury-activate | activatedAt 非零且不晚于区块时间，meme/quote token 与规范市场一致 |
| checkpoint | 读取全部 32 个 activationSlot；没有 generation 已到期的非空项，空/非空槽字段一致；未来激活项允许保留 |

未满足条件仍保存 `satisfied=false` 证据；RPC/ABI/身份或区块错误不保存后置结果。该命令只有在最终确认成功且上述条件满足时返回 `postconditionsVerified=true`、`executionComplete=true`，仅指这个任务在观察时通过验证，不代表整体后端完成或未来链状态不变。状态取自区块末尾：同块后续交易若重新产生待处理项，会保守地报告未满足，不证明某个状态变化由该交易独占造成。

其他 preview/submission/receipt/recovery 输出仍不自行宣布完成。自动调度、生产签名器与完整生产运行验收仍未完成。本地端到端使用合成 Anvil getter runtime，未替代真实合约全流程验收，也未生产广播。

### 2026-09-06 B10 已提交任务自动巡检

迁移 43 新增 `maintenance_reconciliation_queue`。`maintenance-reconciler` 自动发现同链已提交任务（每次最多登记 100 条），每步认领一个到期任务，观察回执并在 finalized_success 后调用后置验证。它只依赖查询 RPC 接口，不持有签名器或广播能力。

```sh
export TG_MAINTENANCE_DATABASE_URL='postgres://...'
export TG_DEPLOYMENT_MANIFEST='/absolute/manifest-with-market-runtimes.json'
export TG_RPC_URL='http://...'
export TG_MAINTENANCE_POLL_INTERVAL='5s'
./bin/maintenance-reconciler --once
./bin/maintenance-reconciler --run
```

`--describe` 可无环境依赖查看能力。poll interval 为 1 秒至 1 分钟，默认 5 秒；单步超时 60 秒，SIGINT/SIGTERM 取消当前步骤后退出。`--once` 返回一个任务结果或 idle；任务查询失败会保存 unavailable 和重试时间，并非零退出。`--run` 对失败继续运行，输出通用错误状态，不打印 RPC/数据库连接材料。

队列使用 SKIP LOCKED、120 秒认领租约和递增 generation。进程失联后租约自动到期，另一个进程可以接手；旧 generation 不能更新新任务结果。等待回执/最终性或后置未满足默认 30 秒后复查；unavailable 从 60 秒指数退避到最多 1 小时；verified_complete 和 finalized_reverted 每小时复查。成功检查清除失败计数。队列状态是带检查时间的运行信号，不代替完整回执和后置证据。

新表需 SELECT/INSERT/UPDATE 权限；巡检还需现有签名/意图/提交读取权限、回执与后置证据写权限，以及相关锁定操作所需权限。manifest 必须包含任务目标 runtime；缺失或 RPC 故障会记录失败并退避，不妨碍其他任务。当前只巡检已提交任务，不自动发现新的 sweep/flush 等业务任务，也不自动签名、提交或重发。

### 2026-09-06 B10 显式市场工作发现

先应用迁移 44。该入口按链上状态检查一个指定范围，仅在需要维护时模拟并持久化任务：

```sh
export TG_MAINTENANCE_DATABASE_URL='postgres://...'
export TG_CHAIN_ID='421614'
export TG_RPC_URL='http://...'
./bin/maintenance-worker --discover-work \
  --manifest /absolute/manifest-with-market-runtimes.json \
  --from 0x1111111111111111111111111111111111111111 \
  --market 0x2222222222222222222222222222222222222222222222222222222222222222 \
  --operation sweep
```

支持 sweep、checkpoint、flush-forfeiture、settle-rage-quit、treasury-activate；settle-rage-quit 还需 `--user`。sender 使用非零小写地址，链配置必须匹配 manifest。不要混入 `--trigger`、租约或交易执行参数。manifest 必须包含相应市场目标 runtime。单次超时 60 秒。

返回 `discovery.status`：

- `not_needed`：当前链上条件已满足，无需新建任务；不证明已有任务执行完成。
- `prepared`：固定调用模拟通过，scope 与任务原子保存，可从 `jobKey` 继续准备流程。
- `awaiting_existing`：同范围旧任务尚未验证完成或证据暂不可用，继续复用旧任务。

范围由 chain/genesis/sender/operation/market/user 决定。数据库锁和稳定 generation trigger 防止并发重复建任务；已有任务须通过最终回执及后置状态验证，才能在出现新工作时进入下一代。当前不自动清理、取消或替换卡住的旧任务。

需要新表 SELECT/INSERT/UPDATE 权限，以及现有任务、模拟和验证证据相关权限。此入口不预留 nonce、签名或发送交易，输出 `transactionSubmission=false`、`executionComplete=false`。它尚未自动遍历市场/账户；当前集成验证使用本地合成 runtime，下一代任务的正向端到端验收仍待补齐。

### 2026-09-06 B10 全市场维护扫描

迁移 45 新增持久化扫描队列。先运行 indexer 与 discovery-worker，使数据库存在有效的 finalized discovery checkpoint；manifest 可在原清单上补充市场 runtime，具体任务仍须重新通过链上身份认证。

```sh
export TG_MAINTENANCE_DATABASE_URL='postgres://...'
export TG_DEPLOYMENT_MANIFEST='/absolute/manifest-with-market-runtimes.json'
export TG_MAINTENANCE_FROM='0x1111111111111111111111111111111111111111'
export TG_RPC_URL='http://...'
export TG_MAINTENANCE_POLL_INTERVAL='5s'
./bin/maintenance-scanner --once
./bin/maintenance-scanner --run
```

TG_CHAIN_ID 应与部署清单一致。每步最多登记 100 个尚未登记的市场/操作组合，再认领一个到期组合；四类操作为 sweep、checkpoint、flush-forfeiture、treasury-activate。候选来自 canonical_discovered_markets，检查 journal genesis 和 discovery checkpoint 的规范性。市场发现仅提供候选，不能绕过 DiscoverWork 的当前链上认证和模拟。未配置目标 runtime 或不支持某个操作时，该组合返回 unavailable 并退避，其他组合继续推进。

队列按 chain/genesis/sender/market/operation 隔离，120 秒租约、SKIP LOCKED 和 generation 防止并发重复认领及过期覆盖。正常结果 60 秒后重查，失败从 60 秒指数退避至 1 小时；进程失联可在租约到期后接手。单步超时 60 秒，支持 SIGINT/SIGTERM。--once 对 unavailable 输出状态并非零退出；--run 继续处理。新市场由后续步骤自动加入，无需重新提供市场列表。

数据库角色需要读取 journal/discovery/canonical 市场数据、扫描队列 SELECT/INSERT/UPDATE，以及 DiscoverWork 的任务/证据权限。扫描器只做状态查询、模拟和记录，不预留 nonce 或签名广播。尚未枚举用户账户，因此 settle-rage-quit 仍使用显式 --discover-work --user；自动准备租约/交易意图及 signer 编排也尚未接入。

### 2026-09-06 B10 账户级维护扫描

迁移 46 将扫描队列扩展为 chain/genesis/sender/market/operation/user 组合；已有市场队列保留空 user，不改变原任务身份。maintenance-scanner 的启动方式不变，`--describe` 现在报告 accountDiscovery=true。

每步除最多登记 100 个市场操作外，还从 canonical_projection_rows 的 gaugePositions 中登记最多 100 个新账户组合，操作固定为 settle-rage-quit。账户键必须为规范小写非零地址与市场 ID；所属市场也必须存在于规范市场发现中。projection-worker 未追平时只能覆盖已投影账户，不代表链上全体账户；缺少规范账户来源时，市场级扫描仍能继续。

扫描全部已知 Gauge 账户，不以投影中的 pending 标记过滤。每次仍通过最新区块的合约身份和 pending/principal 读取决定是否创建模拟任务；历史/滞后投影不能直接授权结算。认领、续期代次检查和完成调度都绑定 user，避免同市场不同账户互相覆盖。账户规范来源消失后，保留队列记录但停止认领，来源恢复后可继续。该版本仍只准备模拟任务，不自动预留 nonce、签名或发送。

### 2026-09-06 B10 原子交易准备

新增 `maintenance-worker --prepare-atomic`，将模拟记录、准备租约、nonce 预留和精确 EIP-1559 交易意图放入同一数据库事务。任一步骤失败都会回滚本次新增数据和 nonce 计数；无需新增迁移。原分步命令仍可使用。

```sh
./bin/maintenance-worker --prepare-atomic \
  --manifest /absolute/manifest-with-market-runtimes.json \
  --from "$SENDER" --market "$MARKET" --trigger "$TRIGGER" \
  --operation settle-rage-quit --user "$USER_ADDRESS" \
  --owner preparation-worker --token "$ACQUISITION_TOKEN" --ttl 300 \
  --gas-limit 200000 --max-fee-per-gas 100000000000 --priority-fee-per-gas 1000000000
```

使用现有 TG_MAINTENANCE_DATABASE_URL、TG_CHAIN_ID、TG_RPC_URL；gas/fee 值为显式十进制上限，上例仅为格式示例。先做已认证的最新区块固定调用模拟，再在事务中按实际预留 nonce 和完整 gas/fee 参数模拟。输出 preparation.lease 与 preparation.record，可交给后续签名校验流程。保留 token：同 token 在租约有效期间重复调用返回相同 intent，修改已固定的 fee/gas 参数会拒绝。

若首次提交结果未知，先检查 `--intent JOB_KEY`；不要生成新任务或新 token 来代替原任务。已提交事务的准备租约过期后，本入口不会绕过原有 nonce 恢复限制。事务回滚只撤销本次更改，不删除此前通过分步接口持久化的 reservation。当前没有自动调度该入口、选择费用或配置 signer，也不会签名/广播；transactionSubmission 与 executionComplete 均为 false。

### 2026-09-06 B10 后台交易准备

迁移 47 新增 maintenance_preparation_queue。maintenance-preparer 从 maintenance_work_scopes 的当前任务自动登记工作，每步最多登记 100 个、处理一个到期任务。它会实际预留数据库 nonce 并保存未签名意图，需要使用专用维护 sender 及统一 nonce 协调数据库。

```sh
export TG_MAINTENANCE_DATABASE_URL='postgres://...'
export TG_DEPLOYMENT_MANIFEST='/absolute/manifest-with-market-runtimes.json'
export TG_MAINTENANCE_FROM='0x1111111111111111111111111111111111111111'
export TG_RPC_URL='http://...'
export TG_MAINTENANCE_GAS_LIMIT='200000'
export TG_MAINTENANCE_MAX_FEE_PER_GAS='100000000000'
export TG_MAINTENANCE_PRIORITY_FEE_PER_GAS='1000000000'
./bin/maintenance-preparer --once
./bin/maintenance-preparer --run
```

TG_CHAIN_ID 应与清单一致；示例费用需按运行环境明确配置，worker 不自动估价。TG_MAINTENANCE_POLL_INTERVAL 为 1s..1m、默认 5s，单步超时 60 秒。认领租约 120 秒、原子准备租约 300 秒；支持 SIGINT/SIGTERM。数据库角色需新队列 SELECT/INSERT/UPDATE 和现有 scope、job、模拟、lease、nonce、intent 权限。

对没有 intent 的任务，先读取已校验身份，再在最新区块认证目标与后置条件；已无工作返回 not_needed，60 秒后重查。需要工作时 fresh simulate 后原子准备，返回 intent_prepared 与 intentDigest。失败返回 unavailable，60 秒起指数退避至 1 小时；旧认领 generation 不能覆盖接手后的结果。--once 对 unavailable 非零退出，--run 继续。

若意图事务已提交而队列更新前进程退出，重启只校验和读取既有 intent，不重新预留 nonce；即使原准备租约过期，也只报告已保存的意图，不延长签名授权。intent_prepared 队列项停止准备调度。修改费用配置不会重写既有 intent。已有分步 reservation、过期签名授权、费用替换等情况仍按现有恢复规则处理。

当前不配置 signer、不签名/广播，也不将 intent_prepared 当作链上执行成功。后续自动签名必须继续验证 lease 和固定意图；该服务与只读状态扫描器分别运行。

### 2026-09-06 B10 外部签名器适配

迁移 48 新增 maintenance_sign_requests。签名入口只处理已保存的固定交易意图，并要求现有准备租约：

```sh
./bin/maintenance-worker --sign-with /absolute/path/to/operator-signer \
  --job "$JOB_KEY" --intent-digest "$INTENT_DIGEST" \
  --owner "$LEASE_OWNER" --token "$LEASE_TOKEN" --generation "$LEASE_GENERATION"
```

配置 TG_MAINTENANCE_DATABASE_URL、TG_CHAIN_ID；本命令没有 RPC 发送步骤。新表需 SELECT/INSERT/UPDATE，另需读取 lease/nonce/intent 及保存 signed transaction 的权限。签名器程序由运维显式配置和管理凭据，必须只签名、不广播。API 服务不应获得这个程序或对应数据库权限。

可执行程序协议：无命令行参数、无 shell 拼接；stdin 是 JSON `{version:"maintenance-sign-v1",requestId:INTENT_DIGEST,intent:IntentRecord}`，stdout 仅返回 `0x` 开头的原始 EIP-1559 签名交易十六进制。程序可以自行接入受控密钥设施；worker 不向程序传递私钥。调用超时 30 秒，stdout 限制 32772 字节，stderr 不回传。返回内容必须通过完整签名和固定字段匹配检查，程序声明的 sender 不具权威性。

调用前持久提交 signing_unknown 记录。同一任务只发起一次签名器调用；并发/重启/超时重试均不能再次签名。返回状态：

- signed_stored：已校验并登记在 signed transactions，可按原提交流程继续；不是链上执行成功。
- signing_unknown：没有可验证返回结果，须按 requestId 从签名设施找回原结果；重跑同命令只查询，不重新调用程序。可在有效授权下使用原 attach-signed 流程导入找回的字节。
- signed_available：签名期间租约过期，字节保存在 sign_requests 供恢复，但未登记为可提交交易，也未恢复签名授权。

后两种状态输出结果并非零退出。已有 signed_stored 可在原租约过期后读取；该读取不续租。签名器自动调度、过期授权恢复和具体生产 KMS/HSM 配置仍待接入。本地验收使用测试程序和公开测试密钥，未使用生产签名设施。

### 2026-09-06 B10 固定意图授权恢复

迁移 49 新增 maintenance_authorization_recoveries，提供显式恢复入口：

```sh
./bin/maintenance-worker --recover-authorization --recovery-id "$RECOVERY_ID" \
  --manifest /absolute/manifest-with-market-runtimes.json \
  --from "$SENDER" --market "$MARKET" --operation "$OPERATION" --trigger "$TRIGGER" \
  --intent-digest "$INTENT_DIGEST" --owner "$LEASE_OWNER" --token "$LEASE_TOKEN" \
  --generation "$LEASE_GENERATION"
```

settle-rage-quit 还需 --user。使用 TG_MAINTENANCE_DATABASE_URL、TG_CHAIN_ID、TG_RPC_URL；RECOVERY_ID 为调用方保存的非零 bytes32。数据库角色需要恢复审计表 SELECT/INSERT，以及现有模拟、租约事件、lease UPDATE 和 nonce/intent/sign-request/submission 读取权限。

仅处理有固定 intent、已过期且未主动释放的原租约。先重新认证部署并 fresh preview，再验证原意图完整 gas/fee 调用、规范区块、chain/genesis、nonce 可用性和时效。已存在 submission 时拒绝，应进入回执/原交易恢复流程。签名请求仍未知且没有已验证签名字节时也拒绝；不会用重新签名来消除未知状态。

成功后在一个事务中保存新模拟、恢复记录和 renewed 事件，按原 TTL 恢复同一 owner/token/generation。原 intent、nonce、费用与签名请求均不改写；恢复原 fence 是对该固定意图的显式授权，不创建新的任务授权。若已有 signed_available 字节，随后重跑原 --sign-with 只登记原字节，不再次调用签名器；若从未请求签名，可继续首次签名。

同一恢复 ID 重试只返回第一次记录，不能不断延长有效期。返回的是该次恢复证据及 expiresAt，不证明当前授权仍有效；后续过期、释放仍由实际 lease 校验。授权恢复本身不签名或广播。未知签名的外部结果导入、签名自动调度和生产设施验收仍待补齐。

### 2026-09-06 B10 未知签名结果导入

迁移 50 新增 maintenance_signature_imports，保存首次导入的 intent digest、交易 hash、数据库 session_user 与时间。使用从签名设施找回的结果文件：

```sh
./bin/maintenance-worker --import-signature /absolute/recovered-transaction.hex \
  --job "$JOB_KEY" --intent-digest "$INTENT_DIGEST" --transaction-hash "$EXPECTED_TX_HASH" \
  --owner "$ORIGINAL_OWNER" --token "$ORIGINAL_TOKEN" --generation "$ORIGINAL_GENERATION"
```

文件仅含 0x 开头的原始签名交易 hex，最大 32772 字节。使用 TG_MAINTENANCE_DATABASE_URL、TG_CHAIN_ID；数据库角色需要新审计表 SELECT/INSERT、sign_requests SELECT/UPDATE 及既有固定意图/租约读取权限。原 signing request 必须已经存在，不能利用导入绕过签名前的意图记录。

校验原 fence、意图、签名恢复地址和全部固定字段，并要求实际 hash 等于显式 EXPECTED_TX_HASH。签名结果和导入审计原子保存；同字节重试幂等，不能覆盖另一份已保存结果。校验只能证明签名与固定意图匹配；运维应从原签名请求的结果记录取回文件，不应请求重新签名。

即使原租约已过期或释放，仍可保存这份结果证据；导入本身不续租、不登记新的 signed transaction、不调用 signer、不分配 nonce、不广播。新保存结果返回 signed_available；若同字节此前已经登记，返回 signed_stored。过期但未释放的授权可随后通过 --recover-authorization 恢复，再用原 --sign-with 将已保存字节登记，整个过程不会再次调用签名器。已释放的授权仍不可恢复。

### 2026-09-06 B10 自动签名调度

迁移 51 新增 maintenance_signing_queue。完成迁移及构建后，以独立进程运行：

```sh
export TG_MAINTENANCE_DATABASE_URL='postgresql://...'
export TG_CHAIN_ID=46630
export TG_DEPLOYMENT_MANIFEST=/absolute/manifest.json
export TG_MAINTENANCE_FROM=0x...
export TG_MAINTENANCE_SIGNER=/absolute/sign-only-program
export TG_MAINTENANCE_POLL_INTERVAL=5s
./bin/maintenance-signer --once
# 持续调度
./bin/maintenance-signer --run
```

签名程序沿用 maintenance-sign-v1 stdin JSON / stdout 原始交易 hex 协议，必须只签名、不广播；凭据由独立签名设施管理。启动前检查绝对路径、普通文件和执行权限。仓库默认 scratch 镜像没有 shell/Python 等解释器；生产适配程序须为可在该镜像运行的原生可执行文件，或在独立运行镜像中提供明确依赖。该进程不读取 RPC，也不创建 intent 或分配 nonce。数据库角色需要签名队列表 SELECT/INSERT/UPDATE、签名请求及 signed transactions 写入权限，以及现有 work scope、准备队列、固定意图、模拟和租约读取权限。

每步最多登记 100 个当前 active scope 且 preparation 状态为 intent_prepared 的任务，按 chain/genesis/sender 隔离；每次只领取一项，以 SKIP LOCKED、120 秒认领和 generation 防止过期进程覆盖结果。仅使用 maintenance-preparer 的原授权签署已保存的固定意图，不自动续租或改变费用。

signed_stored 停止调度；authorization_required 需显式恢复授权；signing_unknown 需从原签名设施导入结果；signed_available 保留已返回字节供授权恢复。后三种状态每 60 秒复查，复查不会重新请求未知签名；一般错误按失败次数退避，最长 1 小时。--once 对需要处理的状态返回非零并输出 JSON，--run 持续处理其他到期任务。恢复工具完成后，调度器可登记原签名字节。签名保存后进程崩溃，重启读取同一签名，即使原租约已过期也不会重签。

本阶段不提交交易。自动提交编排、生产签名设施与真实协议完整运行验收仍未完成。

### 2026-09-06 B10 自动提交调度

迁移 52 新增 maintenance_submission_queue。在 scanner → preparer → signer 后独立运行 maintenance-submitter：

```sh
# 使用显式配置的 TG_CHAIN_ID、TG_DEPLOYMENT_MANIFEST、TG_MAINTENANCE_FROM、
# TG_MAINTENANCE_DATABASE_URL、TG_RPC_URL 与 TG_MAINTENANCE_POLL_INTERVAL。
./bin/maintenance-submitter --describe
./bin/maintenance-submitter --once
./bin/maintenance-submitter --run
```

--once/--run 会向配置的 RPC 提交真实签名交易，--describe 只描述能力。部署运行时应使用该环境的专用维护发送地址和显式费用配置。数据库角色需提交队列 SELECT/INSERT/UPDATE、maintenance_submissions SELECT/INSERT/UPDATE、模拟记录写入及既有意图/签名/租约/scope/签名队列读取权限。所有费用仍取自已签署的固定意图，调度器不改变 gas、费用或 nonce，不签名、不续租。

仅登记当前 active scope 且自动签名队列已完成的任务，按 chain/genesis/sender 隔离，100 条登记上限、120 秒领取和 generation 防止旧进程覆盖。首次发送先核验原授权和已签名字节，再 fresh 部署认证/preview，调用 Submit 做完整 gas/fee 参数模拟和链身份/nonce/规范块检查；持久化 submission_unknown 后才向 RPC 发送一次。

acknowledged 与 submission_unknown 都停止自动提交，交由 maintenance-reconciler 查询最终回执/后置状态。未知结果不自动重发，使用现有显式原交易恢复流程处理。数据库已有提交记录时，不依赖 RPC 可用性或原租约仍有效，直接恢复该结果；网络响应丢失、进程重启不会变成新发送。其他错误持久退避最多 1 小时，authorization_required 每 60 秒检查显式授权恢复结果。--once 仅 idle/acknowledged 返回成功，其余状态输出 JSON 后非零退出；--run 继续处理其他到期任务。

节点接受交易不代表执行完成。该阶段未实现费用替换/取消、全局预算策略或生产运行验收，原 nonce 缺口仍需按已有明确恢复流程处理。验证使用本地合成 Anvil，不代表真实协议完整端到端验收。

### 2026-09-06 B10 累计 Gas 提交预算

迁移 53 新增 gas_budgets、gas_budget_changes 与 gas_budget_charges。迁移后，所有首次 Submit（包括显式 maintenance-worker 和后台 submitter）都必须有对应 chain/genesis/sender 预算；缺失返回 budget_required，超额返回 budget_exceeded。没有默认支出额度。后台每 60 秒检查这两种状态。

```sh
export TG_MAINTENANCE_OPERATOR_DATABASE_URL='postgresql://operator/...'
./bin/maintenance-budget --set --manifest /absolute/manifest.json --from "$SENDER" \
  --max-transaction "$MAX_TRANSACTION_WEI" --maximum-total "$MAXIMUM_TOTAL_WEI" \
  --request-id "$CONFIGURATION_ID"
./bin/maintenance-budget --inspect --manifest /absolute/manifest.json --from "$SENDER"
```

金额是原生资产最小单位的 uint256 十进制整数；没有浮点数、价格换算或自动估算。单笔占用为签名意图的 gasLimit × maxFeePerGas。maximum-total 是此发送地址在本数据库中新预算机制登记的**累计最高 Gas 承诺**上限，不是实际已花 Gas、每日预算或余额证明。它不按时间自动清零、不因交易失败/结果未知/执行成功自动退款；保守保留每笔承诺。实际费用通常低于占用；未来如引入结算释放，需要独立最终回执证据与对账，不能由 HTTP 数据或未知结果推算。

首次提交在同一事务中锁定发送地址预算、检查单笔和累计上限、增加 allocated、记录每 job 唯一的 charge（绑定配置 revision）及 submission outbox；任一失败全部回滚，不发送。相同 job 重试只读既有 submission，不再次占用。原交易显式重发使用相同签名字节和 nonce，不新增预算扣记；费用替换尚未支持。

配置 request-id 必须为非零 bytes32；同 ID 同参数重试返回首次配置审计快照，不能重置 allocated；同 ID 改参数拒绝。新 ID 可调整未来额度，但 maximum-total 不能低于已占用额度。--inspect 返回当前预算；旧配置响应不是当前状态。审计 actor 由 session_user 生成。配置工具不签名或广播。

权限：提交进程只需 gas_budgets SELECT/UPDATE(allocated)、gas_budget_changes SELECT、gas_budget_charges SELECT/INSERT，不能修改额度或插入配置审计。独立 operator 需要预算 SELECT/INSERT/UPDATE(revision,max_transaction,maximum_total)，以及 changes SELECT 和业务列 INSERT（不授予 changed_by/changed_at 覆盖权限），无需提交、签名权限。列级权限应在正式数据库角色配置中落实，不能把测试数据库的超级用户凭据用于生产。

迁移前已有 submission 的读取/恢复仍保持原行为，不补造历史 charge。上线前需盘点旧提交并设置未来可用额度；allocated 不代表完整历史开销。测试仅在隔离本地数据库/合成 Anvil 上配置额度与发送。

### 2026-09-06 B10 最终回执执行 Gas 费用

迁移 54 新增 maintenance_gas_observations；独立命令读取配置 RPC，保存费用观察：

```sh
./bin/maintenance-gas --observe "$JOB_KEY"
./bin/maintenance-gas --history "$JOB_KEY"
./bin/maintenance-gas --history "$JOB_KEY" --after "$SEQUENCE"
```

使用 TG_MAINTENANCE_DATABASE_URL、TG_CHAIN_ID；observe 还需 TG_RPC_URL。观察角色需要现有提交/签名/意图/模拟读取、receipt_observations SELECT/INSERT、gas_observations SELECT/INSERT；历史查询可使用只读角色。该服务没有发送或预算写入能力。

先执行现有 receipt 观察的 chain/genesis、规范区块、全块回执/日志一致性及 RPC finalized 核验。只有 finalized_success/finalized_reverted 继续读取 receipt 的 gasUsed/effectiveGasPrice；缺字段拒绝，不当作零。新增费用响应的基础回执必须与已验证回执一致，并再次固定规范块、head/finalized anchors 和时效。数量以整数解析，gasUsed 不超过签名 gasLimit、effectiveGasPrice 不超过签名 maxFeePerGas，乘积不超过固定意图最高 Gas 成本。

输出 executionGasCost = gasUsed × effectiveGasPrice，并保留 maximumGasCost、来源 receipt sequence/digest、intent digest 和成功/回退状态。记录摘要、来源回执与固定意图在历史读取时重新核对，最多 100 条/页。重复 observe 是新的观察证据，不能把多次观察相加为累计费用。

这仅为配置 RPC 提供的**执行 Gas 费用**，不是 receipt-root/共识证明，也不证明网络额外费用已被完整统计；totalNativeFeeKnown 保持 false。没有自动退款、预算释放、预算对账结清或操作完成声明。链重组后 fresh observe 会拒绝缺失/未最终回执，旧记录仍明确作为 historical 证据保留，不能把历史查询当作当前规范性证明。原有 journal receipt 编码保持不变。

### 2026-09-06 B10 后台执行 Gas 费用观察

迁移 55 将费用观察接入既有 maintenance-reconciler --once/--run，不需新增守护进程。最终成功和最终回退的交易都会读取费用字段，使用本次已认证的同一份 receipt，费用记录与队列 receipt_sequence 通过复合外键绑定。

返回及队列新增 gasStatus、gasSequence 和独立 gas_failures：not_checked 表示回执观察未完成，not_finalized 表示尚无最终回执，recorded 表示本次费用记录已保存，unavailable 表示费用读取或校验失败。业务 status 与费用状态独立；例如 finalized_reverted 仍可有已保存 Gas 费用，verified_complete 也可能同时 gasStatus=unavailable。--once 对任一 unavailable 返回非零；--run 保留状态并继续调度。

费用读取最多占用 15 秒子上下文。费用失败独立退避，首次 60 秒、最多 1 小时；与业务巡检使用较早的下次检查时间。恢复后清零费用失败计数。仍使用原 120 秒领取和 generation fence，过期进程不能覆盖费用状态。回执后来缺失/未最终，当前 gasSequence 会清空，旧费用证据仍可在 historical 查询中看到。

更新运行角色权限：reconciliation_queue 新列需 SELECT/UPDATE，gas_observations 需 SELECT/INSERT。没有预算、nonce、签名或发送权限变化。该功能不增加费用汇总、不释放预算；每次记录是观察，不能把重复巡检记录相加为累计支出。完整网络费用与独立最终费用对账仍未完成。

### 2026-09-06 B08 奖励转换候选规划

settlement-worker 已实现纯 Go 候选规划，执行服务仍未实现：

```sh
./bin/settlement-worker --describe
./bin/settlement-worker --request /absolute/candidate-input.json
# 报价方按 requestDigest 返回绑定此批次的报价后，将 quote 加回输入文件：
./bin/settlement-worker --plan /absolute/quoted-input.json
make smoke-settlement
```

输入对象包含 chainId、marketId、now、pendingParticipants、rawExitAt、perBatchCap、totalMeme、deadline、slippageBps 和可选 max32/quote。金额及退出时间为十进制字符串；now/deadline/quotedAt 为整数秒。pendingParticipants 必须为数组、rawExitAt 必须为对象；每项为 `{user,creatorEpoch,maximumMeme}`。creatorEpoch=0 是 Staker，非零是历史 Creator epoch；同一用户不同 epoch 可以并列，相同用户+epoch 重复拒绝。

--request 先排除零金额及 rawExitAt 非零且不晚于 now 的所有角色，保留剩余顺序，检查人数最多 32、单批/总 Meme 上限，再按现有 TS JSON 协议生成 SHA-256 摘要。摘要绑定 chain、market、用户顺序、epoch 和金额。--plan 对非空批次要求 quote：expectedOutput、quotedAt、requestDigest、referenceId、marketId、chainId；报价最多 30 秒前、不得未来时间，deadline 在 now..now+300，slippageBps 在 0..100。minimumQuote 整数向下取整且必须正数；一个报价只生成一批，超限拒绝而不拆分复用总报价。空批次不需要报价。

Go 额外严格拒绝零地址、非规范或超 uint256 金额、累计溢出、缺失输入集合以及超过 1 MiB 的 JSON。--request 不验证 quote，因为它的输出用于请求新报价；--plan 校验绑定和时效。两者均返回 candidateOnly=true、onchainVerified=false、priceReferenceVerified=false、transactionSubmission=false。输入 now 只是此次候选计算的评估时刻，不是当前链时效证明。

运行 Go 二进制无需 Node；Node 仅用于生成/核对现有 TS 对照向量。contract-check 已加入结算 golden 检查，smoke-settlement 使用真实子进程对照 7 种计划。生产执行仍需 fresh 链上 operator、市场状态、用户可转换额度、历史受益人和 raw exit 校验，以及独立价格/流动性/异常暂停、Gas 预算、签名和持久提交。referenceId 不是价格真实性证明，--run/--submit 均拒绝。本阶段不支持 Holder 转换计划或实际交易。

### 2026-09-06 B08 奖励转换链上状态观察

```sh
TG_RPC_URL="$RPC_URL" ./bin/settlement-worker --observe-state /absolute/participants.json --manifest /absolute/deployment.json
```

participants.json 只接受 operator、marketId、participants；每项为 `{user,creatorEpoch}`，例如：

```json
{"operator":"0x0000000000000000000000000000000000000001","marketId":"0x1111111111111111111111111111111111111111111111111111111111111111","participants":[{"user":"0x0000000000000000000000000000000000000002","creatorEpoch":0}]}
```

部署清单是现有 V1-EXEC-11 manifest 格式，必须包含九个 core 模块、CreatorRevenueRegistry、目标 TickerMemeTokenV1，以及启用 staking 时的 MemeStockGauge，均为明确地址及 runtimeCodeHash。可包含多个市场实例；chainId/genesis 以清单为身份锚，RPC 必须匹配。输入和清单均限制 1 MiB。

命令读取 latest 后将所有代码及 getter 读取固定到同一区块哈希，接受最多 120 秒前/5 秒后的区块，完成时复查规范块和时效。验证 core graph、FeeVault/Creator registry 关系、settlementOperator、已毕业市场与 token 反向绑定、fee policy、token Factory/marketId，以及启用时的 gauge identity。1..32 个非重复 user+epoch；Creator 使用历史 beneficiary 和 creatorLiability，Staker 使用 positionOf 的预览 Meme 奖励及 rage quit pending。

每项返回 availableMeme、rawExitAt、eligible 和排除原因：staking_disabled、rage_quit_pending、raw_exit_matured、no_rewards。已成熟退出按地址影响全部角色；即使 availableMeme 大于零，也必须尊重 eligible=false。无效受益人/绑定、RPC 失败、ABI 异常或重组使整次观察失败，不输出部分结果。

输出 stateObserved=true，仅表示配置 RPC 的当前区块状态观察。priceReferenceVerified/solvencyVerified/executionImplemented/transactionSubmission 均为 false。观察不会自动转为候选计划，也不替代提交前重新校验；仍需价格、流动性、偿付能力、模拟及持久执行流程。无数据库迁移、签名或交易发送。

### 2026-09-06 B08 将实时状态绑定候选批次

```sh
TG_RPC_URL="$RPC_URL" ./bin/settlement-worker --observed-request /absolute/selection.json --manifest /absolute/deployment.json
# 取得绑定 requestDigest 的 quote 后写回 selection.json：
TG_RPC_URL="$RPC_URL" ./bin/settlement-worker --observed-plan /absolute/selection.json --manifest /absolute/deployment.json
```

selection.json 包含 operator、marketId、participants（每项 user/creatorEpoch/maximumMeme）、perBatchCap、totalMeme、deadline、slippageBps 和可选 quote。maximumMeme 是操作者选择上限，不是余额声明；chainId、now、rawExitAt、availableMeme、state 均由实时读取提供，不接受这些输入字段。部署身份继续来自显式 manifest。

两条命令分别进行完整 fresh observation；不会导入先前保存的观察文件作为证明。每项实际候选金额为 min(maximumMeme, availableMeme)，eligible=false 时归零排除。按同一次观察保持用户/epoch/顺序对应，检查相同地址各角色退出时间一致。用当前墙钟与区块时间的较大值评估期限和退出，排除读取后已成熟的退出。聚合金额超上限仍整批拒绝，不截断或自动拆批。

输出 candidate.evaluatedAt（评估秒数）、candidate.state 和 candidate.request；observed-plan 还包含 candidate.plan。报价绑定重新读取后生成的批次摘要，金额或角色变化使旧报价失效。stateObserved=true 与 candidateOnly=true 同时存在；价格/偿付能力未验证，executionImplemented/transactionSubmission=false。报价摘要不是区块证明，后续执行仍须独立重新校验并绑定模拟/签名意图。未实现自动行情获取、独立价格校验或交易提交。

### 2026-09-06 B08 固定调用模拟与假设退款分配

```sh
TG_RPC_URL="$RPC_URL" ./bin/settlement-worker --preview /absolute/selection-with-quote.json --manifest /absolute/deployment.json
```

使用 observed-plan 相同输入，先重新观察并绑定报价，再将唯一非空批次编码为 `settleRewards(bytes32,(address,uint32,uint256)[],uint256,uint256)`。目标仅为已认证的 FeeVault，from 为已认证 operator，value=0；调用者不能指定目标或任意 calldata。eth_call 固定观察区块哈希并要求 canonical，按该块时间再次检查合约 5 分钟期限。

严格解码 spent/received 两个 uint256，要求 0<spent<=候选总量、received>=minimumQuote。随后按合约的累计 floor 规则计算每个用户的 Meme 消耗、退款、Quote 分配；合计必须一致，正消耗但零到账拒绝。结束再次复查区块、观察/报价时效和 deadline。

返回 status=simulated_unsigned、preview 内固定调用及候选证据、hypotheticalAllocations=true。分配仅是假设模拟结果，不证明实际退款/权益到账；executionComplete=false、transactionSubmission=false。模拟包含合约自身的检查，但不等于独立价格、流动性、偿付能力或 hook 路径认证；priceReferenceVerified/solvencyVerified 保持 false。空候选不生成模拟。没有签名、持久执行任务、广播或数据库变更。

### 2026-09-06 B08 奖励转换路径身份认证

--preview 现在要求 selection JSON 中的 poolManager：`{"address":"0x...","runtimeCodeHash":"0x..."}`；部署 manifest 还必须明确列出该市场的 TickerGardenMemeHook 地址及代码哈希。PoolManager 是外部依赖，不伪装为协议模块。普通 observed-request/observed-plan 不要求此配置，也不宣称路径已认证。

模拟前在同一块认证 FeeVault → Hook → PoolManager 直接转换路径：MarketRegistry 的 PoolKey/PoolId/市场 runtime 必须一致，币种排序正确、fee=0、tickSpacing 有效；hook 代码身份来自 manifest，PoolManager 代码匹配额外 pin。核对 hook 的 Registry/FeeVault/PoolManager 与 FeeVault 的 PoolManager 一致，hook 权限位/声明为 0x2044，poolBinding 为 active 且 market/keyHash/sourceVersion 正确，activeFeeSource 与当前 hook/version 对应。完成后再检查规范块和时效。

输出 preview.route 包含 PoolKey、PoolId、hook、PoolManager pin，routeIdentityVerified=true。任一缺失或矛盾拒绝，不能省略路径认证降级到旧模拟。此范围不包括经 swapRouter/quoter 的交易路径；奖励转换直接调用上述 hook。地址和代码 pin 由操作者信任配置提供，不证明价格、池内流动性、额外协议依赖或共识。priceReferenceVerified/solvencyVerified 继续为 false。

### 2026-09-06 B08 同块 PoolManager 状态读取

--preview 路由认证增加 `preview.route.poolState`：stateSlot、sqrtPriceX96、tick、protocolFee、lpFee、activeLiquidity。通过已认证 PoolManager 的 `extsload(bytes32)`，按仓库固定 v4 StateLibrary 布局读取 `keccak256(poolId || uint256(6))` 和该 slot+3；两次读取仍固定同一 canonical blockHash。

严格检查两个 32-byte 返回及保留位、uint128 liquidity、带符号 int24 tick 和 TickMath 价格范围。价格未初始化/越界、tick 越界、protocolFee 或 lpFee 非零时拒绝；零 fee 是当前 TickerGardenRewardConversion.unlockCallback 的要求。总转换 Meme 上限同时限制为 int128 最大值，与 hook 的实际输入边界一致。

activeLiquidity 是当前 tick 范围中的活跃流动性，不是完整池深度；零值不单独拒绝，因为后续跨 tick 可能获得流动性。此处不计算跨 tick 滑点，不把池瞬时价格当作独立市场报价，也不验证 tick 与价格的数学对应。配置 PoolManager 必须使用所锁定的 v4 存储布局。所有数值保持原生整数，不做 token decimals 或法币换算；独立价格、可成交深度、偿付能力与实际执行仍待接入。

`FORGE=/absolute/forge make conversion-solidity-check` 在临时目录直接执行仓库固定的 StateLibrary，验证 slot0 位布局、负 tick 和 liquidity slot+3；不会改动合约构建目录。Go 单测覆盖价格/位宽/手续费边界；烟测使用 Anvil 实际 SLOAD 存储，确认 slot 地址和代码不变时的 fee 更新拒绝。

### 2026-09-06 B08 FeeVault 同块资产覆盖检查

--preview 现在必须具备 hash-pinned 原生余额读取能力，并在模拟前分别读取 Meme/Quote 的 FeeVault 余额和 `totalLiability(asset)`。ERC20 使用 token.balanceOf(vault)，原生 Quote 使用 eth_getBalance(vault, blockHash)，所有数据固定候选观察块。重新认证 core/市场/反向映射/FeeVault Registry 和明确 Meme runtime；完成后复核规范块及时效。

任一资产余额低于该资产**全市场总负债**即拒绝，不只比较本批金额；余额恰好相等允许。Meme totalLiability 还必须不低于本次候选总 Meme。严格 uint256、ABI 与原生余额规范十进制检查；错误或重组不返回部分覆盖结果。

输出 `preview.assetCoverage` 按 Meme、Quote 顺序列出 asset/balance/totalLiability/surplus，`vaultCoverageObserved=true`。只核对已认证合约自身暴露的负债与余额；不是完整负债历史复算、外部状态根证明、未来资金保障或全协议偿付审计，因此 `solvencyVerified=false` 保留。独立价格、完整对账和持久执行仍待完成，无签名或广播。

### 2026-09-06 B08 签名参考价格策略核验

```sh
TG_RPC_URL="$RPC_URL" TG_SETTLEMENT_REFERENCE_POLICY=/absolute/reference-policy.json ./bin/settlement-worker --reference-check /absolute/selection-with-references.json --manifest /absolute/deployment.json
```

它重新完成现有 preview，再核验 selection.references。策略来自独立环境配置文件，不接受候选 JSON 内嵌策略。策略字段：chainId/genesisHash/marketId/memeToken/quoteAsset（全部必须匹配），sources（每项 id/publicKey）、maxAgeSeconds（1..60）、maxDeviationBps（0..100）、minimumActiveLiquidity（该市场原生 uint128 流动性单位阈值，十进制字符串）。要求 2..8 个不同 ID/不同 Ed25519 公钥，且所有来源都返回有效数据，不允许降级到单来源。publicKey 是标准 Base64 的 32-byte 原始公钥，ID 仅允许字母、数字、点、下划线和连字符。

每条 references 为 `{price,signature}`，签名为 Base64 Ed25519。price 按以下固定顺序 JSON 编码，无空白：version、sourceId、chainId、genesisHash、marketId、memeToken、quoteAsset、requestDigest、observedAt、expiresAt、quoteUnits、memeUnits。version 固定 `tickergarden-conversion-reference-v1`；最后两项是正 uint256 十进制字符串，表示该资产对**最小单位**价格 quoteUnits/memeUnits，不乘 decimals 或 REST multiplier。`ReferenceSigningMessage` 是 Go 编码规范，测试脚本验证 Node 标准签名与 Go 互通。

响应需绑定当前 chain/genesis/市场/资产对/请求摘要；observedAt 不得未来或超龄，expiresAt 未过期且有效窗口不超过策略上限。以完整整数交叉乘法核对 received/spent 与每个来源的偏差，minimumQuote 也须保护本次模拟的 spent；检查活跃 liquidity 阈值，不改变 calldata 或生成新 minimumQuote。支持模拟部分成交，但只证明该次模拟的比例，不能推断全额成交或未来打包的价格保障；实际执行必须重新获取、核验与模拟。

成功输出 referenceSignaturesVerified=true、simulationPriceWithinPolicy=true、providerIndependenceVerified=false，以及来源 ID、检查时刻、模拟最低到账和使用的策略/完整签名参考数据快照。公钥证明签名来源，不证明两家供应商独立或价格真实；运营必须审核数据来源及独立性，当前没有配置真实提供方或自动抓取适配器。旧 --preview 仍是未核验参考价的诊断模拟，不能作为生产执行授权。此策略属于 B08 的转换准入检查，不连接 B14 展示估值 API，也不修改合约结算规则。无签名交易、广播或数据库变更。

### 2026-09-06 B08 自动获取签名参考价

```sh
TG_RPC_URL="$RPC_URL" TG_SETTLEMENT_REFERENCE_POLICY=/absolute/reference-policy.json ./bin/settlement-worker --fetch-reference-check /absolute/selection.json --manifest /absolute/deployment.json
```

每个策略 source 新增 endpoint；所有来源端点必须明确且互不重复。默认只接受 HTTPS，禁止 URL 用户名/密码、query、fragment；端点不是候选输入的一部分。测试可在策略中显式设置 allowLoopbackHttp=true，仅允许 IP 字面量 loopback HTTP，不接受 localhost 的 DNS 解析作为豁免。未配置真实端点时不会使用默认价格源。

先完成实时 preview，再向每个来源 POST JSON：version=`tickergarden-conversion-reference-request-v1`、chainId、genesisHash、marketId、memeToken、quoteAsset、requestDigest。没有传输用户列表、签名交易或私钥。提供方返回既有 `{price,signature}`，sourceId 必须对应被请求的策略条目；响应签名、域、时间及价格仍走同一检查。

最多 8 个并发请求；每个来源仅一次，无自动重试、重定向或替代来源。单请求 15 秒、整体 20 秒，并受 CLI 总上下文限制。只接受 HTTP 200/application-json、单一严格 JSON、最多 64 KiB；任一来源失败取消剩余请求，等待结束后整次拒绝，无部分结果。完成后 CLI 再次核对模拟区块 canonicality、原报价 30 秒期限及 deadline。结果带 referencesFetched=true。

fetch 模式拒绝与候选内已有 references 混用；手动 --reference-check 保留输入方式。配置端点与公钥仍需实际供应方接入和运营审查；当前完成的是通用签名协议客户端，不声称已有真实独立行情。未支持供应商特定鉴权、自动报价获取或生产密钥配置，providerIndependenceVerified=false，无交易发送。

### 2026-09-06 B08 核验证据本地留档

在 `--reference-check` 或 `--fetch-reference-check` 命令末尾添加 `--evidence-dir /absolute/evidence`。目录须由操作者预先创建（建议权限 0700），位于可信本地文件系统；末级目录不能是符号链接。未指定此选项时保持原有输出行为。

完整实时核验成功后，将 `{version,manifest,result}` 保存为 `<sha256>.json`：version 为 `tickergarden-conversion-evidence-v1`，manifest 是本次解析使用的部署清单，result 包含完整 preview、策略、公钥、参考签名及各项范围标记。摘要覆盖实际文件全部字节（含末尾换行）。标准输出新增 evidence.path 和 evidence.sha256；文件内部 result 不包含这一自引用字段。

使用同目录 0600 临时文件、文件 fsync、原子不覆盖发布和目录 fsync。完全相同字节重复写入复用文件；已有目标内容不符或为符号链接时拒绝。核验失败不创建文件，持久化失败不输出成功 JSON。发布后 fsync 或标准输出失败可能仍留下文件，可按摘要核对，不能将进程报错解释为文件必定不存在。临时文件通常自动清理，进程被强制终止时可能残留 `.conversion-evidence-*`，它们不是正式证据。

这是本地审计快照，未提供防管理员篡改的存储或本机签名；摘要证明内容一致性，不证明可信生成者、提供方独立性或结果仍然新鲜。文件包含账户及策略信息，应限制目录访问。后续执行必须重新观察和核验，不可将旧文件作为交易授权；数据库执行队列、签名、发送和回执对账仍未完成。

### 2026-09-06 B08 数据库核验记录与历史查询

执行第 56 项迁移后，为 settlement 进程单独配置 `TG_SETTLEMENT_DATABASE_URL`。在两种 reference-check 命令末尾增加 `--record`，即可在本次实时核验通过后持久化记录；可与 `--evidence-dir` 同时使用。输出 record.sequence、record.digest、record.status=`checked_unsigned`。没有设置 --record 时不连接数据库。

`VerifyConversion` 收拢模拟、签名/价格检查和最终区块/报价期限复查，返回不可由包外构造有效内容的核验值；Result() 返回副本。数据库写入仅接收该值，不提供 JSON 导入入口。记录包含规范化部署 manifest 和完整核验结果，摘要覆盖 envelope 字节及末尾换行，最多 1 MiB。相同内容并发重复写入返回同一序号；冲突后逐字段及字节复查，不接受已损坏记录。

历史查询：`./bin/settlement-worker --check-history /absolute/scope.json`，scope 内容为 `{"chainId":46630,"genesisHash":"0x…","marketId":"0x…","after":0}`（省略的 hash 必须换成完整 32 字节值）。按 chain/genesis/market 隔离，每页最多 100 条，升序返回；使用响应 nextAfter 继续读取。读取核对摘要、状态及嵌入结果中的链/创世块/市场/请求/区块；异常整页拒绝。历史查询无需 RPC，仅作审计，不能重新授权旧观察。

数据库使用单独的 settlement_checks 表，不复用 maintenance 执行任务。应用只有插入/查询操作；不承诺抵抗有直接修改权限的数据库管理员。落库状态仅为 checked_unsigned，不包含签名、nonce、提交或回执。数据库和本地文件并非跨存储原子事务：数据库提交后文件/标准输出失败可能保留已提交记录。数据库规范化 manifest 的摘要也不保证与保留原始 manifest 的本地文件相同，尤其后者可能还包含 record 元数据。

### 2026-09-06 B08 链上路径自动报价

`--quote INPUT.json --manifest DEPLOYMENT.json` 观察实际 FeeVault 奖励转换输出；输入使用既有 participants/限额/operator/PoolManager pin/deadline/slippageBps，必须省略 quote 和 references。先读取实时权益，再按同一固定区块认证直接路径、池状态和余额覆盖，以正数 minimumQuote=1 进行只读 eth_call。返回 quoteObservation（实际输出、实际 Meme 消耗、候选总量、区块、from/to/PoolId、请求摘要和报价时间），candidateOnly=true。探测结果可能部分成交，不把其输出当作全额成交价；没有独立参考价验证或交易发送。

`--auto-reference-check INPUT.json --manifest DEPLOYMENT.json [--record] [--evidence-dir DIRECTORY]` 将自动报价接入完整核验：探测后重新读取权益，按原始 slippageBps 生成最低到账并再模拟，随后获取和核验所有策略来源签名。独立策略仍来自 TG_SETTLEMENT_REFERENCE_POLICY。不能混入调用方 quote/references，不能降级使用探测结果；候选摘要变化、最终模拟低于最低到账、参考源错误或超时均整次拒绝。整个流程受 60 秒上下文、30 秒报价时效和原 deadline 限制。

最终输出 quoteAutomaticallyObserved=true、quoteObservation 和原有 preview/referenceCheck，允许进入既有审计留档。探测的 minimumQuote=1 从不作为最终执行参数；最终最低到账由探测输出及操作者滑点计算，还必须通过独立签名参考价下界核验。两个模拟可以处于不同区块，报价区块只记录当时来源，最终模拟和参考价仍须重新核验；不宣称旧报价区块永久 canonical。整个流程仍为 unsigned，不包含后台调度、签名、提交或实际成交证明。实际独立参考提供方仍需配置及审核。

### 2026-09-06 B08 持久核验任务与后台调度

第 57 项迁移新增 settlement_work，保存不可由同一 runId 改写的 selection、部署 manifest 和独立参考策略快照。使用 settlement 独立数据库凭据，不经过公共 API，也不连接 maintenance 签名设施。

`--enqueue WORK.json --manifest DEPLOYMENT.json` 从 TG_SETTLEMENT_REFERENCE_POLICY 读取策略。WORK 为 `{ "runId": "cycle-001", "deadlineSeconds": 120, "selection": { ... } }`；selection 使用现有自动报价输入，省略 quote/references/deadline（deadline 必须为零），保留操作者、参与者/epoch/额度限制、市场、PoolManager pin 和滑点。deadlineSeconds 为 30..120，worker 在领取后按当前时间生成 deadline；不会重用排队时的报价。入队校验配置和数据格式，链上权限/额度/价格仍在执行核验任务时检查。

SCOPE 为 `{ "chainId": 46630, "genesisHash": "0x…", "operator": "0x…" }`（替换完整真实 hash/address）。`--work-once SCOPE.json` 最多领取一个任务；`--work-run SCOPE.json` 每 5 秒运行一次，支持 SIGINT/SIGTERM。两者读取 TG_RPC_URL/TG_SETTLEMENT_DATABASE_URL；参考策略及 manifest 来自入队快照，修改环境中的策略文件不会悄悄改变已有任务。

队列按到期时间和入队序号选择，链/创世块/操作者严格隔离；每个市场同时最多一个 queued/checking/retry 任务。相同 runId 和内容重复入队复用任务，改变其内容拒绝；已完成/失败的同一 runId 不会重新启动，新周期须显式使用新 runId。SKIP LOCKED 支持并发 worker，120 秒租约和递增 generation 防止重复领取及过期持有者写回。

核验每次重新读取状态、报价、模拟和获取签名参考。成功时在同一事务中保存 settlement_checks 和 checked_unsigned/checkSequence；它仍是审计结果，不是签名或提交许可。失败按 5/10/20/40 秒退避，最多五次尝试后 failed。崩溃也计入尝试，租约过期可接管；第五次中断在下次调度时收尾为 failed。取消时保留租约等待过期，避免在关闭阶段继续写入。数据库故障/损坏任务导致进程报错退出，由进程管理器处理重启和告警。

当前调度单位是操作者明确给出的参与者集合；尚无自动全市场/受益人发现轮转。空收益或暂不可转换也作为核验失败进入有界重试，不标为已执行。状态输出始终 executionComplete=false/transactionSubmission=false；后续签名、nonce、提交恢复及回执/退款验证仍待实现。


### 2026-09-06 B08 固定转换交易意图

第 58 项迁移增加 settlement_nonce_accounts/settlement_intents 和共享 transaction_account_roles。已有维护 nonce 账户回填 maintenance 角色；新的维护和转换 nonce 分配必须先领取对应角色。两个进程可以使用不同数据库用户，但 TG_SETTLEMENT_DATABASE_URL 与 TG_MAINTENANCE_DATABASE_URL 必须指向同一协调数据库，角色互斥才能生效；跨物理数据库或外部钱包操作不受此表约束。生产数据库细粒度授权仍需配置。

配置 TG_SETTLEMENT_EXECUTION_POLICY 指向 JSON 文件，字段为 gasLimit、maxFeePerGas、maxPriorityFeePerGas、maximumGasCost，全部使用规范十进制字符串。Gas>=21000 且不超过 int63，maxFee>0，priority<=maxFee；gas*maxFee 不得超过 uint256 或明确的 maximumGasCost。费用策略不能从任务 selection 中提供。

`--prepare-intent SCOPE_AND_JOB.json` 的输入为 chainId/genesisHash/operator/jobKey。只接受已完成核验的任务，但会重新执行自动报价、模拟和全部参考价检查，旧 checkSequence 不作为新鲜依据。之后锁定角色和账户，nonce=max(数据库 next_nonce,链 pending nonce)，检查当前原生余额覆盖本账户全部已准备意图的最大 Gas 成本，再对固定 from/to/data/value=0、nonce、Gas/maxFee/priority 完整 eth_call。spent/received 必须与刚才核验完全一致；结束重查 pending nonce、规范块、报价时效、参考签名/价格及 deadline。

新鲜证据、nonce 递增和 intent 在同一事务提交，任一步失败一起回滚。意图包括 chain/genesis、固定 EIP-1559 调用、费用策略/最大成本、证据序号/摘要、区块和期限，以摘要标识，状态 intent_prepared。相同任务和费用重试返回原意图并标记 reused=true/auditOnly=true，不刷新期限、不重新消耗 nonce；不同费用拒绝。`--intent SCOPE_AND_JOB.json` 可离线于 RPC 读取与校验已保存意图。

当前仍没有交易签名或发送。已保存意图不是当前有效的签名许可：后续 signer/submitter 必须复核新鲜状态及固定调用，过期意图不得直接使用。现阶段最大 Gas 成本保守计入全部已准备意图；实际回执费用核销、nonce 取消/替换/恢复和成本释放尚未实现，不会自动回收已占 nonce。合成测试使用独立的 settlement 与 maintenance 发送账户，避免掩盖角色或 nonce 冲突。


### 2026-09-06 B08 一次性签名与结果恢复

第 59 项迁移新增 `settlement_sign_requests`。在 `--prepare-intent` 后，配置绝对可执行路径 `TG_SETTLEMENT_SIGNER_COMMAND`，使用相同的 `TG_SETTLEMENT_EXECUTION_POLICY` 和协调数据库：

```sh
./bin/settlement-worker --sign /absolute/scope-and-job.json
./bin/settlement-worker --signed /absolute/scope-and-job.json
./bin/settlement-worker --import-signed /absolute/scope-job-and-raw.json
```

三个输入都包含 `chainId/genesisHash/operator/jobKey`；恢复输入另含 `rawTransaction`（`0x` 编码原始签名交易）。首次签名前，重新核验权益、固定调用、参考签名、池状态、资产覆盖、Gas 余额、pending nonce 和规范块；最低到账保持原意图值，重新模拟不能修改原 calldata。pending nonce 必须等于已保留 nonce。授权有效期取交易 deadline、检查开始后 30 秒、来源失效/最大年龄及块新鲜度的最早值。

签名器通过 stdin 接收 `settlement-sign-v1` JSON：`requestId` 等于意图摘要，`intent` 为完整 IntentRecord，`checkSequence/checkDigest/evidenceJson` 指向本次新鲜证据，`notAfter` 是 Unix 秒。`evidenceJson` 为包含原始换行的字符串，摘要基于其原始 UTF-8 字节；不能重新序列化后计算。外部签名器必须独立校验角色、请求内容与期限，只签名、不广播，并以 requestId 持久化结果以供恢复。stdout 只能输出 `0x` 原始交易；stderr 不进入后端结果。适配器无 shell 参数展开，输入最多 1 MiB、stdout 有界，运行不超过授权期限或 30 秒。私钥由外部签名设施管理。

后端先提交授权及 `signing_unknown`，再调用签名器一次。并发或重试只读取已有请求，不重新调用；超时、异常输出或进程中断不能推断未签名。`--signed` 无需 RPC，读取 `signing_unknown` 或 `signed_stored`；`--import-signed` 只能恢复已有请求，逐项验证 EIP-1559 发送者、chainId、nonce、to、value、calldata、Gas 和费用，拒绝 access list/legacy/不同交易字节。授权过期后仍可恢复历史结果，但不会刷新授权。

这些命令不广播，输出 `transactionSubmission=false`、`executionComplete=false`、`auditOnly=true`；保存签名不代表当前可发送或已执行。提交前新鲜检查、持久提交恢复、回执/实际退款对账、取消及成本释放仍待后续实现。


### 2026-09-06 B08 持久化单次提交

第 60 项迁移新增 `settlement_submissions`。`--submit /absolute/submission.json` 输入为 `chainId/genesisHash/operator/jobKey/expectedTransactionHash`，哈希必须精确匹配已保存的签名交易。需要 `TG_SETTLEMENT_DATABASE_URL` 和 `TG_RPC_URL`，不调用签名器。该命令会发送交易，应只指向已批准的网络和发送账户。

首次提交使用 `settlement-submit-v1` 独立授权域，重新核验当前链上权益、固定交易模拟、参考价、Gas 余额、pending nonce 与规范块；不会直接使用历史签名授权。新鲜证据和 `submission_unknown` 在数据库事务内提交后，才进行一次有截止时间的 `eth_sendRawTransaction`。原始字节固定不变，RPC 返回匹配哈希才保存 `acknowledged`。超时、错误/丢失回应、异哈希或保存回应失败均保留未知结果；崩溃可能发生在记录后、实际发送前，未知状态不证明已经发送或尚未发送。

重复 `--submit` 只读已存提交，既不重新检查也不重新发送。`--submission /absolute/scope-and-job.json` 无需 RPC，核对作用域、原签名字节、新鲜授权及证据摘要后返回审计记录。`acknowledged` 仅表示 RPC 确认接收，不代表收录、最终性或执行成功，输出 `executionComplete=false`。签名与提交的历史授权读取均不续期。

下一步仍需交易回执/规范链最终性与实际退款对账、明确授权的原交易重发、替换/取消和费用释放。当前没有自动重发机制；未知结果需按原交易哈希核查。完整目标仍包含所有 B01–B19 验收项。


### 2026-09-06 B08 结算回执观察与历史

第 61 项迁移新增 `settlement_receipt_observations`。使用 `--observe-receipt /absolute/scope-and-job.json`，输入 `chainId/genesisHash/operator/jobKey`，配置 `TG_SETTLEMENT_DATABASE_URL` 与 `TG_RPC_URL`。仅允许已有持久提交记录的固定签名交易；`submission_unknown` 也可按原哈希核查，不会重发或覆盖提交状态。

观察核对 chainId/创世块、当前 head/`finalized`、交易回执身份、同块全部回执与日志一致性，再次钉住回执块及 head/finalized 对应规范块，并限制 head 时效。输出状态为 `not_observed`、`mined_success`、`mined_reverted`、`finalized_success` 或 `finalized_reverted`。明确 null 才视为未观察到；RPC 错误和证据不一致拒绝，不追加成功记录。未观察到不能证明未发送，RPC 的 finalized 也不等于独立共识或 receipt-root 密码学证明。

每次成功观察追加带 SHA-256 摘要的历史，不释放 nonce/费用预算。`--receipt-history /absolute/scope-job-cursor.json` 无需 RPC，输入同上并可带非负 `after`，每页最多 100 条，按 `nextAfter` 继续。历史读取重新核对作用域、固定签名/提交、摘要和状态结构，标明 `historical=true`；保留旧观察，不把旧最终状态重解释为当前规范性。

两种命令均不发送交易，`executionComplete=false`、`refundsVerified=false`。即使回执状态成功，仍需解析协议结算/分配事件并验证实际退款与权益，不能据此认定业务完成。


### 2026-09-06 B08 将回执事件绑定固定结算批次

`--receipt-events /absolute/receipt-selection.json` 使用 `TG_SETTLEMENT_DATABASE_URL`，输入 `chainId/genesisHash/operator/jobKey/receiptSequence`。只接受数据库中已核验的 `finalized_success` 回执，并重新核对签名/提交材料、回执摘要及原始意图证据；不接受外部导入的回执 JSON。

核对 FeeVault 发出的 RewardConverted 与 RewardBatchConverted：逐项顺序、用户/creator epoch、支出不超过签名 maximumMeme、零支出/到账关系、批次唯一且在各项之后、资产身份、非零批次 nonce、uint256 总和守恒以及总到账不低于固定 minimumQuote。缺事件、额外/错配事件或其他地址发出的同名事件均拒绝。

输出绑定 receipt sequence/digest 与 intent digest，包含实际事件金额和签名上限。`intentEventsMatched=true` 仅表示历史回执事件与请求相符；`historical=true`、`refundsVerified=false`、`executionComplete=false`。不刷新规范性、不证明转账或实际退款。maximumMeme 是上限，合约实际拉取量可能更少，因此禁止使用 maximumMeme−memeSpent 冒充退款。没有新增迁移、签名或发送操作。


### 2026-09-06 B08 交易执行跟踪与根调用匹配

`--receipt-trace /absolute/scope-and-job.json` 使用同一 `TG_SETTLEMENT_DATABASE_URL` / `TG_RPC_URL`，输入 `chainId/genesisHash/operator/jobKey`。先新鲜观察并保存回执，要求 finalized_success 及全部批次事件匹配，再对原哈希调用 `debug_traceTransaction` 的 callTracer。RPC 必须支持该方法及所需历史状态；不支持时拒绝，不降级为“退款已验证”。

跟踪请求不重试，客户端最多 20 秒，节点 timeout=15s；启用完整 calls、禁用日志。限制 trace JSON 1 MiB、深度 64、4096 帧、单项 input/output 64 KiB，并校验地址、调用类型和字节格式。Geth 对无返回值调用可省略 output，该行为按依赖源代码处理；实际结算根输出必须严格为 spent/received 两个 uint256。无法解析或超出支持范围的跟踪拒绝。

根调用必须精确匹配已签名 from/to/calldata/value，且无根错误；返回 spent/received 必须匹配最终回执事件。跟踪后重新读取回执、规范回执块和原 head/finalized，并复核时效。输出 traceRootMatched=true，但 refundsVerified/executionComplete=false：内部 calls 仍需针对 Gauge 消耗/退款调用和 Creator 权益做进一步对账，RPC 跟踪不构成共识证明。

跟踪树目前随结果返回，没有独立持久化；先前成功观察的回执即使后续跟踪失败也保留为回执证据。命令不签名、不发送、不释放预算，不改变任务完成状态。


### 2026-09-06 B08 Gauge 实际调用金额与分配公式核对

新增 `--receipt-accounting /absolute/scope-and-job.json`，沿用 receipt-trace 的链/数据库配置和新鲜最终回执流程。在根调用匹配后核对 FeeVault 直接发出的 consumeForConversion、Hook convertRewards、creditConversion 调用，必须成功、value=0、正确目标并保持消耗→转换→入账顺序；逐项用户/签名上限/返回值及 Quote 与回执事件匹配，拒绝缺失或重复调用。

新观察的 RewardConversionState 保存已通过 market/gaugeIdentity 验证的 Gauge 地址。旧证据中若缺失此地址，不能通过 Staker 调用金额核对，不能从 trace 任意地址补造身份。无需迁移，也不会改写旧证据。

GaugeItems 中 pulledMeme 来自 consumeForConversion 返回；memeRefund 来自 creditConversion 参数，必须满足 pulledMeme=memeSpent+memeRefund，且实际拉取为正、不超过签名上限。Hook 请求量与可观测拉取总量交叉核对。全 Staker 批次还复算合约两级累计向下取整：先分配 MemeSpent，再按累计 MemeSpent 分配 Quote，逐项必须一致。

混合或纯 Creator 批次返回 unresolvedCreators，allInputsObserved/allocationFormulaMatched=false；只检查 Hook 总量处于已知 Staker 拉取量加 Creator spent/max 范围，不把剩余总量当逐个 Creator 退款。callAccountingMatched 仅表示调用参数关系符合规则，refundsVerified/executionComplete 仍 false：仍需执行前 Creator 状态、内部权益写入及真实协议执行验收。没有签名、发送或预算释放。

调用金额核对还拒绝嵌套层级中额外的 FeeVault 消耗/转换/入账 CALL，避免只观察直接调用而遗漏另一笔有效操作；Gauge clone 对实现合约的 DELEGATECALL 帧不重复计数。

### 2026-09-06 B08 交易前状态与存储差异基础层

新增内部 RPC 方法 `TransactionState`，对同一交易分别请求 prestateTracer 的完整访问前状态和 diffMode 状态差异。总超时 40 秒、每次节点超时 15 秒，不重试；每份结果最多 2 MiB、4096 个账户及 8192 个存储槽，校验账户、字节格式及代码哈希，拒绝 null 账户和不完整差异。差异中的执行前存储必须与完整访问前状态一致。

`StorageTransition` 要求明确观察到执行前槽位，缺失不视为零；结合差异解释不变、零值写入和清零，拒绝账户创建/删除、代码变化和前值冲突。RPC 观察不是状态根证明，两次跟踪的一致性检查也不替代规范交易绑定。

本地隔离 Anvil 测试部署简单 SSTORE 合约并验证真实的零→非零→零变化；异常数据与遗漏场景由单元测试覆盖。该层尚未接入 settlement CLI，未绑定 FeeVault 编译布局、部署代码身份或 Creator 负债槽位，不能据此声称 Creator 退款/权益已验证。迁移保持 61 项，没有生产签名或发送。

### 2026-09-06 B08 Creator 内部负债与实际分配核对

新增 `--receipt-creator-storage /absolute/scope-and-job.json`，沿用 `TG_SETTLEMENT_DATABASE_URL`、`TG_RPC_URL` 及 chainId/genesisHash/operator/jobKey 输入。先完成新鲜最终回执、固定签名批次和调用金额匹配，再读取原交易 prestateTracer；核验后重新固定回执及 head/finalized 区块，并检查时效。

新观察的 RewardConversionState 保存已核验的 FeeVault 完整 runtimeCodeHash。执行前代码必须与该哈希一致，并匹配本地编译器输出的运行时代码模板（仅编译器列出的 immutable 字节在模板比较时归零；完整哈希仍覆盖它们）。`feevault_storage.json` 同时从该编译产物读取 Creator mapping 布局。旧证据缺失 runtimeCodeHash 或部署字节不属于此编译版本时明确拒绝，不能推测槽位或覆盖旧证据。

`make contract-check` 现在需要 Forge，并执行 `scripts/generate_settlement_storage.py --check`。Forge 不在 PATH 时设置 `FORGE=/absolute/path/to/forge`。合约变更后用同一脚本（不带 --check）重新生成，审查布局与运行时代码变化；模板只证明布局对应关系，不是部署授权。

逐 Creator epoch 从执行前 MEME 负债与签名上限的较小值重建实际拉取量，验证 MEME 后值=前值−实际支出、QUOTE 后值=前值+分配到账；退款=实际拉取−实际支出。零到账允许 Quote 槽未被访问，但拒绝差异中出现不应有的变化，不虚构该槽余额。结合 Gauge 拉取返回值核对 Hook 总量，并复算纯 Creator/混合批次的两级累计向下取整。

输出 creatorStorage.items 的前后值、拉取/支出/退款/到账及匹配标志；原始状态证据随结果返回，尚未独立持久化。`refundsVerified=false`、`executionComplete=false`：仍缺 Gauge 内部权益、聚合负债/资产余额变化和真实协议完整执行验收。单元测试覆盖纯 Creator/混合、部分成交、上限截断、零份额、错误代码/哈希/槽位/金额/分配及跟踪后重组；不能将这些夹具测试称为真实 FeeVault 结算验收。无迁移、生产签名、发送或预算释放。

### 2026-09-06 B08 FeeVault 聚合负债变化核对

新增 `--receipt-liabilities /absolute/scope-and-job.json`，沿用上述数据库/RPC 配置与输入，先完成 receipt-creator-storage 全部检查，再使用同一份交易状态核验 FeeVault 的四类市场负债桶和两种资产的跨市场总负债，最后再次核对回执规范性及新鲜度。编译产物新增 bucketSlot/totalSlot，生成器验证嵌套 mapping 键和 uint256[4] 非打包布局。

Creator/Staker 的 MEME 桶应分别减少该角色逐项实际支出之和，QUOTE 桶应增加该角色到账之和；Platform/Holder 桶应不变。跨市场 MEME/QUOTE 总负债应分别减少/增加批次实际支出/到账。总额守恒但角色桶错配仍拒绝。这里核验交易净变化，不要求全协议总负债等于本市场桶之和，也不声称证明全部市场偿付能力。

非零变化必须明确观察到执行前槽位；零变化且未访问的槽位仅检查差异中没有修改，返回 valuesObserved=false，不伪造余额。输出 liabilities.changes 包含资产、角色、槽位、净变化和已观察的前后值。仍保持 refundsVerified/executionComplete=false：Gauge 激活/累计奖励/内部权益、资产余额变化、独立证据持久化及真实完整协议验收尚待完成。

### 2026-09-06 B08 Gauge 仓位计算层与 Solidity 对照

内部 `replayGaugePosition` 重放双资产奖励累计、已处理/本次到期激活快照、待激活仓位转为 active、快照引用减少/清除，以及消耗和退款/Quote 入账。共用 userRemainder 处理旧 active 和新激活权重的两段奖励，保持 unlockAt，按 1e27 精度计算；允许 512 位中间乘积，拒绝 uint256 存储结果溢出、累计器回退、非法余量、缺少到期桶和无效快照引用。

`FORGE=/absolute/path/to/forge make gauge-solidity-check` 在临时目录编译真实 MemeStockGaugeSettlements 继承层，用同一组 JSON 向量检查仓位、快照和实际拉取结果。8 组向量覆盖 active、未到期 pending、已有/新激活快照、最后一个引用、小数进位、大整数乘积和零 active 权重。验证器直接调用真实 `_settlePosition`；消耗/入账由测试夹具复现，不涉及生产 Gauge 克隆授权或真实 FeeVault 调用，也不连接 RPC。

该计算层尚未接入 receipt-liabilities，不能将 JSON 输入当作已核验链上状态。后续须绑定编译布局、Gauge clone/implementation 身份、执行前用户/快照/激活桶和累计器，并检查实际存储结果；其他激活桶、全局孤立余量/cohort 变化仍需独立核对。整体退款/执行完成标志保持 false。

### 2026-09-06 B08 Gauge 参与者存储核验接线

新增 `--receipt-gauge-storage /absolute/scope-and-job.json`，沿用数据库/RPC 配置与作用域输入。它先完成 receipt-liabilities 全部检查，再对同份交易状态重放 Gauge 参与者权益。使用回执块时间判断激活，计算后重新核对该块完整头信息、回执规范性和时效。

新奖励状态观察保存已认证的 Gauge 完整 runtimeCodeHash。跟踪中的克隆必须匹配该哈希、269 字节 OpenZeppelin immutable-args 格式及市场/FeeVault/资产字段；其中 implementation 地址对应的执行前代码必须精确匹配本地编译产物，拒绝克隆/实现代码变化。旧证据缺失 Gauge 哈希时拒绝，不从跟踪补造部署身份。

`scripts/generate_gauge_storage.py` 从同一 Forge 产物固定实现运行时代码、position/snapshot/wheel/reward 根槽，并验证所用 struct/array 的成员、offset、类型和长度。`make contract-check` 包含其 --check；合约布局变更需重新生成并审查。

逐参与者读取明确出现的九个仓位槽位，重放双资产 paid/pending/remainder、激活与锁时间，再与实际后值和 consume 返回量匹配。只读取两个必要的全局累计器，不强求未访问的 indexRemainder。共享激活快照按调用顺序减少引用，全部参与者完成后核验快照终值；本次用于激活的桶必须清空。缺槽、错误代码、错误退款/余量/锁/快照或桶残留均拒绝。

输出 gauge.positionsMatched / participantSnapshotsMatched 及逐人前后仓位；无 Staker 时返回空项和 false 标志。refundsVerified/executionComplete 仍为 false：其他激活桶汇总、全局 cohort/孤立余量、资产余额、证据独立持久化和真实完整协议执行仍需验收。当前存储装配测试使用合成跟踪与经过 Solidity 对照的向量，不替代生产 Gauge 克隆/FeeVault 联合执行验收。

### 2026-09-06 B08 Gauge 全局激活表与总量核验

`--receipt-gauge-storage` 现在同时返回 activation 结果，检查全部 32 个激活槽。每个 generation 必须有明确执行前值；空槽/未来槽不得出现修改，到期槽必须清空并计入激活总量。跨所有到期桶汇总的数量必须等于 storedTotalActiveStock 增加量和 totalPendingStock 减少量，拒绝缺失非零变化的前值或总量冲突。

每个新激活 generation 的旧快照必须为空；新快照使用当时两个累计器，引用数减去本批次实际 materialized 的参与者数量。无参与者的到期桶也要完整核验快照；引用全部消费时要求快照清除，支持同交易内临时创建后删除、最终 diff 无记录的情况。空/未来槽的未访问字段与无激活时未访问的总量不虚构余额，仅确认 diff 没有变化。

Gauge 布局生成器新增并验证两个 uint256 汇总槽。gauge-solidity-check 新增真实 `_settlePosition` 的全表场景：两个到期桶（其中一个无本批次参与者）和一个未来桶，检查 active/pending 总量、桶清除与快照引用；连同原向量共 9 项通过。仍未核对 cohort/孤立余量、资产余额和真实完整协议联合执行，refundsVerified/executionComplete 保持 false。

### 2026-09-06 B08 Gauge 批次与全局余量核验

`--receipt-gauge-storage` 新增 remainders 结果。在每次 consume 的调用树中核对 Gauge 对克隆绑定 AllocationManager 的 rewardCohortEpoch / rewardEligibleActiveStock 只读调用及返回值。批次变化时不得出现被短路的 eligible 查询；批次不变时必须查询有效权重，并仅在权重为零时回收余量。调用市场、类型、目标、顺序、数量及最终 observed epoch 不符均拒绝。

按 1e27 精度将双资产 indexRemainder 与 forfeiturePrecisionRemainder 合并，核对 index 清零、保留小数余量和 deferredForfeiture 增量。连续多次回收不会重复增加递延余额；未回收时，所有相关槽位及累计器必须无变化，未访问的值不伪造为零。拒绝额外的非只读 Gauge 操作，避免未重放的 settlement/credit/flush 改变这些结论。

编译布局生成器固定并检查 cohort、precision 数组、双资产 deferred 槽。测试覆盖无回收、批次切换、后续才切换、重复空批次、分支/目标错误、缺槽、错误进位/递延金额与溢出。gauge-solidity-check 新增调用真实 `_collectForfeitedReward` 的进位及二次回收测试，共 10 项通过。Manager 调用树仍属 RPC 观察，算术验证不替代完整生产协议执行；资产余额、独立持久化及真实联合验收尚待完成，refundsVerified/executionComplete 保持 false。

### 2026-09-06 B08 资产余额与负债覆盖核验

`--receipt-gauge-storage` 新增 balances 结果。ERC-20 使用固定 FeeVault 在 Hook 转换前后的直接 balanceOf(address(this)) 调用，验证 STATICCALL、目标/所有者、返回值及读取次数：转换前每种资产两次，转换后一次余额比较加每次实际非零退款/到账的覆盖检查。各阶段读数必须一致，缺失、重复或不稳定结果拒绝；零退款/零到账不会增加相应次数。

MEME 余额应减少批次实际支出，QUOTE 应增加实际到账；前后余额都必须覆盖同资产的跨市场总负债。原生 QUOTE 使用 prestate/diff 的 FeeVault 原生余额，省略 post balance 表示不变，显式 0x0 才表示零；缺失前值、前值冲突、账户删除或代码变化拒绝。此规则与 storage diff 的零值省略规则不同。

新增 chainrpc.ContractBalanceTransition，并在独立 Anvil 合约写入测试中验证真实原生币从 0→7→14 的余额变化。资产测试覆盖 ERC-20/native、负债不足、错误读数/次数、零退款/到账和 native 缺失/冲突。ERC-20 证据说明合约实际读取的余额，不是任意外部代币内部存储或线下资产支持的证明。完整核验证据独立持久化与真实 Gauge/FeeVault 联合执行仍待完成，refundsVerified/executionComplete 保持 false。

### 结算执行证据持久化与历史重放

第 62 项迁移新增 `settlement_execution_evidence`，保存完整回执、调用/状态跟踪、回执块头与逐层核算结果，并绑定 job、receipt sequence 和原始 intent digest。单条 payload 上限 8 MiB，记录内容以 SHA-256 校验；同一 job/receipt 不重复写入。

- `--record-execution-evidence /absolute/scope-and-job.json`：输入 `chainId/genesisHash/operator/jobKey`，配置 `TG_SETTLEMENT_DATABASE_URL` 和 `TG_RPC_URL`。重新采集并重放所有核验，写入前复查规范回执、完整块头和时效。不接受导入的跟踪 JSON。
- `--execution-evidence /absolute/input.json`：相同作用域加正整数 `sequence`，读取指定记录。
- `--execution-evidence-history /absolute/input.json`：相同作用域加非负 `after`（默认 0），每页最多 5 条摘要，返回 `nextAfter`。

历史查询仅需数据库，以只读、可重复读事务验证原始签名材料、检查快照摘要、回执绑定和完整证据，并重新计算事件、调用分配、Creator/Gauge 状态、负债和资产余额结果。历史记录不代表当前链上规范性；当前版本无法重放的旧记录会明确失败。摘要校验用于检测损坏，不是抵御数据库管理员重写全部材料的签名证明。

验证包含 Creator-only 合成完整重放及篡改拒绝、真实 PostgreSQL 字节/类型往返和约束验证、CLI 输入拒绝，以及既有隔离 Anvil 回归。尚未完成真实协议交易经 RPC 采集、存储再查询的端到端验收，因此 `refundsVerified` / `executionComplete` 仍为 false；不改变任务完成状态、nonce 或预算，不发送交易。

### 真实 FeeVault 字节码执行证据组件验收

`FORGE=/absolute/forge ANVIL=/absolute/anvil make smoke-execution-evidence` 会启动并销毁本机隔离链，部署当前编译产物中的原始 ProtocolFeeVault 创建字节码，分别执行 ERC-20 Quote 和原生币 Quote 的 Creator 部分成交。测试不接受外部 RPC。测试注册表、代币与兑换 Hook 位于 `scripts/fixtures/ExecutionEvidence.sol`；通过本地存储设置准备历史负债，结算过程执行未修改的 FeeVault。

两条路径都验证上限 5、实际提取 3、花费 1、退款 2、到账 100（均为原始整数单位）。Go 使用真实 RPC 回执、callTracer、prestateTracer 全量及差异结果，验证编译模板及部署 runtime hash、事件、Creator 槽位、分类/总负债和资产余额，然后执行完整 JSON 往返重放。篡改余额、调用返回、Creator 后值及 runtime 均被拒绝。原生币路径使用交易前后账户余额，ERC-20 路径使用真实余额调用。

该命令已加入 backend-go CI。它证明 FeeVault 组件与跟踪解析兼容；尚未覆盖真实 Gauge/AllocationManager、生产兑换 Hook/PoolManager、正式签名材料及数据库 Store 记录/查询全链路。完整协议联合验收继续保持未完成。

### FeeVault + 真实 Gauge 克隆验收矩阵

`make smoke-execution-evidence` 现执行六个场景：Creator、Staker 未来激活、Staker 到期激活，分别使用 ERC-20 和原生币 Quote。Staker 场景部署当前原始 MemeStockGauge 实现及标准 45 字节代理加七个身份参数的克隆，实际执行 consumeForConversion / creditConversion，核对克隆与实现代码身份、权益变化、全激活表、快照、总量和余量检查。

预置状态含 active=1、pending=1、相应激活桶和既有奖励；当前累计收益使实际提取达到 3。未到期时保留 pending，到期时 active 增至 2、pending 清零、单引用激活快照结算后删除；两者保持 unlockAt，结算后 MEME pending=2、Quote pending=110。修改真实 Gauge MEME 奖励后值同样被拒绝。

这扩大了组件验收范围，但 AllocationManager 仍为固定响应测试替身，兑换 Hook/注册表也未替换为完整协议部署，历史负债和仓位仍经隔离链预置。完整签名/持久存储与生产兑换路由验收继续待完成。

历史证据查询修复：公开 ExecutionEvidence/ExecutionEvidenceHistory 使用只读可重复读事务；加载任务材料时现使用普通 SELECT，避免 PostgreSQL 拒绝 FOR UPDATE。记录执行证据及原有写入路径继续加行锁。隔离数据库测试现在调用公开历史查询接口，实际加载既有原始任务、检查快照、意图、签名及提交授权；验证空历史可读、错误操作人和缺失记录被拒绝。非空真实交易证据通过 Store 写入再查询的完整验收仍待补齐。

### 带签名材料的非空证据数据库验收

隔离 PostgreSQL 烟测新增 `TestIsolatedSettlementReceiptExecutionHistory`。测试生成独立 EIP-1559 测试签名、两份带签名参考价格和对应意图/签名授权/提交授权，通过正式材料校验器后读取七条合成执行证据。覆盖指定 sequence 完整往返、5+2 分页和结束游标；将核算结果修改并重算 payload 摘要后，单条查询和整页查询仍拒绝。

同一测试使用受控 RPC 返回合成回执与跟踪，调用正式 `RecordExecutionEvidence` 后再经公开查询完整读回；检查后续历史页、任务状态和 nonce，确认缺失状态跟踪不会写入执行证据。失败采集仍可能保留已观察的回执记录，二者分别记录。

此测试直接准备历史材料，使用测试签名和 RPC 替身，不声称准备/签名/提交生产流水线或真实 RPC 端到端已通过。此前真实 FeeVault/Gauge 六场景与这项数据库测试分别验证组件；把两者在同一真实交易上串联仍是后续联合验收工作。

### 真实交易与 PostgreSQL 证据记录联合验收

`smoke-gauge` 现在增加独立 Anvil 的到期 Staker 交易，`smoke-vault` 增加原生币 Quote Creator 交易。测试读取实际 EIP-1559 签名字节，以其 sender/nonce/gas/fee/calldata 构造可经正式签名校验的历史材料；通过真实 chainrpc 调用 RecordExecutionEvidence，随后使用公开单条/分页接口从 PostgreSQL 重放、比较完整结果。缺失状态跟踪的负例保持其余 RPC 读取不变，验证拒绝新增执行证据。

需要 Forge 和 Anvil（可通过 FORGE/ANVIL 指定路径）；所有链和数据库均来自隔离烟测，不接触生产。独立 smoke-execution-evidence 六场景仍保留。

历史任务/参考价格/授权材料在测试中重建，未执行真实执行前的任务入队、参考源抓取、模拟授权、外部签名器及提交流程。注册表、AllocationManager 和兑换 Hook/PoolManager 仍为测试依赖，不能把这项“真实交易→RPC→证据数据库”的验收称为完整协议执行流水线上线验收。

### B14 展示参考价

设置 `TG_DISPLAY_PRICES_CONFIG=/absolute/display-prices.json` 可启用固定 Robinhood REST 来源的后台刷新；文件为 1–64 个 `{ "chainId": 4663, "token": "<lowercase address>", "assetUid": "<bytes32 uid>", "symbol": "AAPL" }` 对象组成的数组。chainId 必须等于 API 的 TG_CHAIN_ID；Token、UID、symbol 不可重复。不配置时接口返回 `not_configured` 和空数组。这里只配置经运营确认的展示资产，不代表链上 Quote 白名单激活。

`GET /v1/prices/references` 返回 `displayOnly=true`、`confidence=provider_reported`、chainId 和 references。每条包含固定 source、USD_PER_WHOLE_TOKEN、bidUsd/askUsd、multiplier、asOf、expiresAt、retrievedAt、status/reason。available 才有有效价格；价格满 60 秒返回 stale 和 null bid/ask，提供方错误或不完整/不匹配数据返回 unavailable 和 null。查询不接受用户指定上游 URL 或 symbol，不在请求路径中访问提供方。

后台启动即刷新、每 30 秒刷新一轮，最多四个资产并发，每轮 25 秒超时；单请求 5 秒、2 MiB 限制，不跟随重定向、无自动重试。目标地址同时匹配 assets 和 prices 的 chain deployment；资产需 ACTIVE，无 pendingMultiplier、停牌或目标资产未完成公司行动。十进制字符串用 big.Int 精确相乘，只将 REST 底层股票 bid/ask 乘一次 shares-per-token multiplier，不使用浮点或底层股票成交量冒充链上交易量。

数据契约来源：[Robinhood Stock Token APIs](https://docs.robinhood.com/chain/stock-token-apis/)（2026-09-06 核对，corporate-actions 响应字段为 corpActions）。这是提供方报告的展示值，尚无链上 uid/指纹/Oracle/Sequencer 交叉核验，不能用于市场创建授权、Quote 配置生成、结算或任何链上参数决策。B14 仍待 OpenAPI/TS SDK、前端呈现、生产提供方联调及运行验收；新接口尚不属于已生成的 TS 客户端契约。

B14 契约已升级至 OpenAPI 2.10.0，新增 DisplayPriceReference/Response/Error 及 SDK `listDisplayPriceReferences()`，并同步到 Go 内嵌契约和 apps/web 生成客户端。契约约束 available 必须有价格/乘数/来源时间，stale/unavailable 的 bid/ask 必须为 null。Go HTTP 测试验证真实序列化结果与契约一致；SDK 测试保持十进制字符串、null 和错误封装。页面呈现与生产提供方验收仍待完成；旧 TypeScript 服务没有实现此 Go 专属路由。

### 展示价格部署检查

运行 `go run ./cmd/display-price-check --config /absolute/display-prices.json --chain-id 4663`，或构建后运行同名二进制。命令不需要数据库、签名器或钱包，复用后台刷新并发和 25 秒总预算，只读访问固定 Robinhood 来源，输出一次 JSON 检查结果。

退出码：0 表示本次所有目标取得有效展示价格；1 表示至少一项不可用/过期或检查被取消；2 表示参数、配置或输出失败。使用 `go run` 时 Go 工具会包装程序退出状态，自动化需要精确退出码时请使用构建后的二进制。结果包含 `checkedAt`、`displayOnly`、`allAvailable` 和逐资产 `references`，不代表协议可部署或交易可执行。

2026-09-06 的真实抽样记录位于 `outputs/reviews/backend-display-price/`：从发布目录与官方部署地址精确交集选取 16 项，8 项有效，5 项上游不可用，2 项公司行动未完成，1 项时间戳无效。该记录是历史抽样，不是生产配置。发布目录有 53 项与官方主网股票资产精确匹配，当前每份配置最多 16 项，仍需解决完整覆盖和公共数据请求复用；ETH 等非股票资产尚无本适配器来源。测试网同名资产不得套用主网价格。

每轮刷新现在共享一次 `/assets` 和一次 `/corporate-actions` 观察（仅在有效目标需要时请求），价格继续逐 symbol 查询。共享失败同样只请求一次，下一轮重新抓取；不会以旧一轮公共数据或价格回退。所有目标使用同轮公共观察，但上游三个接口并非原子快照，仍只用于展示。

目录容量已于后续更新扩展为 64 项，OpenAPI 2.11.0 与前端校验同步；此前 16 项记录保留为历史抽样。全量 53 项实时检查结果保存在 `outputs/reviews/backend-display-price/full-catalog-result.json`：28 项有效、17 项上游不可用、8 项公司行动未完成。四并发与 25 秒总预算仍保留，慢请求或预算耗尽可能导致缺价；容量测试不代表所有上游响应均可靠，尚需后续稳定性验收。

刷新错误现按阶段分类：`assets_*`、`corporate_actions_*`、`prices_*` 或排队阶段 `refresh_*`，后缀包括 `rate_limited`、`not_found`、`access_denied`、`server_error`、`http_error`、`timeout`、`budget_exhausted`、`cancelled`、`transport_error`、`response_too_large` 和 `invalid_json`。不会返回上游响应正文或网络错误原文。失败观察时间在失败返回时记录。价格请求在每轮内按 100 毫秒间隔预约，四并发/25 秒总预算继续生效；单独 Fetch 不共享跨调用限速。多进程部署也尚未实现共享配额。

真实诊断先观察到 40 项有效、8 项公司行动、5 项价格接口限流；加入节奏控制后的单次检查为 37 项有效、8 项公司行动、8 项限流。证据分别为 `diagnosed-result.json` 和 `paced-result.json`。这两次检查未出现预算耗尽，且不能证明节奏控制消除了上游限流；生产配额及持续运行仍需验收。

### 全目录批量价格刷新（当前实现）

配置多于一个目标时，每轮改用共享 `/prices` 批量响应，与 `/assets`、`/corporate-actions` 合计最多三次请求；仅配置一个目标时继续使用 `/prices/{symbol}`。这一规则替代前述多资产逐 symbol 请求。批量响应受 2 MiB 和 1024 报价条目限制；按目标 symbol 选择恰好一条，再验证链/地址、币种、停牌、价格、时间及 multiplier。缺失或重复目标报价仅使对应目标不可用；公共请求失败由整轮共享，不自动回退至大量单资产请求。

来源：[Robinhood Stock Token APIs](https://docs.robinhood.com/chain/stock-token-apis/)。本次实测公共价格入口返回 194 条、74737 字节。两次全目录检查分别是资产目录超时导致 53 项不可用，以及 45 项有效/8 项公司行动暂停；后一轮无限流。这仅证明一次真实批量路径成功，未证明持续稳定性。`allAvailable` 对包含公司行动暂停的目录仍为 false，不放宽状态规则。

### B16 已发布快照更新查询

`GET /v1/updates?since=<revision>` 为 Go 专属只读轮询入口，OpenAPI 2.12.0 / SDK `getSnapshotUpdates({since})`。省略 since 返回 reset；与当前相同返回 unchanged；保留期内旧版本与当前比较后返回 changed，invalidated 列出 markets/configs/positions 中需要重读的接口组（增、删、改均覆盖）。旧版本已过期或不可复用时返回 reset 和全部三组，不返回部分历史补丁。当前实现保留最近 32 个快照。

响应 `pollAfterMs=5000`，`Cache-Control: no-store`；只有当前 synced/finalized 快照可以成功响应。503 或网络失败不得推进客户端 revision，客户端应清除当前数据可交易的有效性并重试。重连时使用最后一次完整应用的 revision；收到失效范围后清除对应分页 cursor，按响应 sync.revision 补读，补读成功后统一切换 revision。补读期间若 revision 已过期，从当前版本完整重启。价格、奖励和 Treasury 各有独立新鲜度契约，不属于本接口三组缓存。前端自动轮询/统一应用流程仍待接入。

B16 前端接线已启用：前台每 5 秒查询更新，重连后从最后应用 revision 恢复；Foundation 按目标 revision 重读后统一替换并重置旧分页。当前选择完整 Foundation 重读（即使仅一个组失效），减少跨版本混用风险；页面详情异步重载并作废旧请求代次。API 故障清除依赖快照的交易资格，直接链上逃生入口仍独立。浏览器已用本地模拟空目录验证新版本自动刷新和 503 后相同 revision 恢复，真实多页/钱包/交易页联合验收仍待完成。

### Candle analytics (B12, integration in progress)

Set `TG_ANALYTICS_MANIFEST` to the same deployment manifest used by the projection worker, alongside `TG_DATABASE_URL`. The API validates the manifest chain and required FeeVault/PoolManager identities on startup; queries also compare the manifest commitment with persisted checkpoints.

`GET /v1/markets/{marketId}/candles?interval=1m&from=60&to=120` accepts aligned Unix seconds in a half-open interval. Supported intervals: `1m`, `5m`, `15m`, `1h`, `4h`, `1d`; maximum 2000 buckets and 10000 executions per request. Coverage checks the complete projected height range inside PostgreSQL and remains subject to the request timeout; no fixed 100000-height cutoff is applied. Missing configuration, incomplete history, unknown/unavailable market or failed verification returns 503. Invalid parameters return 400. Responses use `no-store`, declare display-only use, preserve rational prices and integer raw volumes, and break out internal conversion volume. They are not execution quotes.

HTTP/database integration and OpenAPI 2.13.0 / generated getMarketCandles SDK are available; frontend chart integration and full production acceptance remain pending. Do not interpret the presence of this endpoint as B12 completion.

`GET /v1/markets/{marketId}/trades?from=60&to=120&limit=50` uses the same analytics manifest. The half-open interval is returned newest first, with 1–100 items per page (default 50). Send `nextCursor` back with the same market, interval and limit. A changed complete result/checkpoint returns HTTP 409 `trade_page_changed`; restart without the cursor. Each page currently revalidates the bounded complete interval (maximum 10000 executions), so this is not yet the final large-history pagination implementation. OpenAPI 2.14.0 and the generated listMarketTrades SDK include this route and its 409 restart-required response.


Asset execution statistics: `GET /v1/assets/{assetUid}/statistics?from=60&to=120` uses `TG_ANALYTICS_MANIFEST` and the same verified PostgreSQL reader as candles/trades. The range is `[from,to)` in Unix seconds. Returns display-only STOCK identity, coverage and separate Quote groups with execution counts, core volumes, internal conversion volumes, and fees grouped by their actual asset. Missing fees remain explicit via `unknownFeeTradeCount`; these flows are not reserve balances or holder statistics. Unknown/incomplete assets and exceeded limits return 503; invalid or duplicate query fields return 400. Maximum 1000 bound markets, 10000 executions per market and 100000 total, with a 10-second request deadline. The generated SDK exposes `getAssetStatistics`.


Migration 64 adds nullable per-block `receipt_count` and `receipt_set_hash` commitments. The journal re-observes legacy blocks with missing commitments, compares existing filter logs, and writes the receipt set and commitment atomically without advancing the tip during backfill. An existing commitment is immutable: an RPC re-observation mismatch fails rather than overwriting it. Holder history consumers must reject missing or mismatched commitments. This SHA-256 commitment protects against subsequent local row omission/mutation; it is not an Ethereum receipts-root proof and does not add an independent RPC source.


Migration 65 adds `(chain_id, block_hash)` lookup support for projection rows. This also avoids a full projection-table scan for each `chain_blocks` foreign-key check during history cleanup. Analytics coverage validates lowercase 32-byte hash formatting with exact length/prefix/character checks; its full-range integrity checks and 10-second query budget remain in force.


`GET /v1/markets/{marketId}/holders?limit=50&cursor=...` returns finalized Meme Token balances sorted by address, with explicit protocol exclusions, whole-snapshot address counts, supply, source block and revision. Default limit 50, maximum 100. A 409 `holder_page_changed` requires discarding prior pages and restarting without a cursor. The reader currently reconstructs bounded complete history for each page; oversized/incomplete history returns 503. `TG_ANALYTICS_MANIFEST` must also pin Factory and TreasuryDistributorV1. Balances use raw integer strings and 18 Meme decimals; address counts are not user counts or reward eligibility. SDK: `listMarketHolders`.


`GET /v1/stats/overview?from=60&to=120` returns market/registration counts at `coverage.projectionNumber` and execution flows in `[from,to)`, all from one read snapshot. `registeredStockCount` includes retired registrations. Groups retain both STOCK and Quote identity; `binding=unbound` with the zero asset UID explicitly denotes markets without a STOCK binding. Amounts of different Quote assets are never summed into one value. Limits: 1000 markets, 1000 STOCK configurations, 10000 executions per market and 100000 total; incomplete/oversized data returns 503. This endpoint provides no inferred reserve, USD valuation or cross-market holder count. SDK: `getGlobalStatistics`.


`GET /v1/stats/series?interval=1h&from=3600&to=7200` exposes global execution flows by STOCK/Quote and time bucket. Intervals: `1m`, `5m`, `15m`, `1h`, `4h`, `1d`; require aligned `[from,to)` and at most 2000 buckets. Complete-history budgets still apply, plus at most 100000 market-bucket cells. Zero-flow buckets do not invent executions or prices; no historical market counts or balances are inferred. Invalid query parameters return 400; unavailable/incomplete/oversized observations return 503. SDK: `getGlobalFlowSeries`.


`GET /v1/stats/holders` returns finalized global and per-STOCK distinct holder address counts from one repeatable-read snapshot. No query parameters are accepted. Market-address pairs and distinct addresses are separate; adjusted counts exclude the union of known protocol addresses across markets (`UNION_OF_KNOWN_PROTOCOL_ADDRESSES_V1`). The response includes source block/hash and the exclusion list. Counts are display-only, not people or reward eligibility. Complete-history limits and a 10-second request deadline apply; unavailable/incomplete history returns 503. SDK: `getGlobalHolderCounts`. Production-scale reconstruction performance remains unverified.


### Frontend analytics contract integration

With Node 22+ on PATH and an isolated PostgreSQL test server, run:

```sh
TG_TEST_WEB_INTEGRATION=1 TG_TEST_DATABASE_URL='postgres://USER@localhost:5432/postgres?sslmode=disable' go test -race ./integration -run TestPostgresMigrationAndReadiness -count=1 -v
```

Run from `services/backend-go`. The existing suite creates and drops a dedicated test database. The optional web checks start loopback Go HTTP servers backed by those PostgreSQL fixtures and invoke the generated frontend SDK plus runtime validators using real fetch. They verify global overview amounts, global/per-market holders at the same source block, and a 503 when receipt history is incomplete. Node failures fail the integration run. Without `TG_TEST_WEB_INTEGRATION=1`, these additional checks do not run. This is a transport/contract test, not full browser, live RPC, or production load acceptance.

The optional frontend analytics checks also validate a complete 24-hour series with two Quote groups, exact fees and internal conversion amounts, and 23 zero-flow buckets. A missing right-boundary coverage block must produce a 503 through the SDK. These are controlled database timestamps, not live-chain timing or throughput evidence.


### Analytics admission limit

The seven history analytics routes (trades, candles, market holders, asset statistics, global overview, global holders, global series) share four active request slots per API instance. Excess GET requests immediately return `503 analytics_unavailable` with `Retry-After: 5` and `Cache-Control: no-store`; no application queue is created. Completion, cancellation and panic release the slot. Probes and non-analytics routes do not use this gate. Existing reader deadlines and history size budgets still apply. This is a fixed per-instance resource guard, not a global rate limit or evidence of production throughput; multiple replicas multiply the admitted load.


### Holder aggregation microbenchmark

Run `go test ./internal/analytics -run '^$' -bench BenchmarkGlobalHolderAggregation -benchmem -benchtime=1x` from this directory. The benchmark covers 10/100/1000 markets and shared versus disjoint holder addresses, reaching the 1,000,000 market-address budget. Fixture creation is excluded from timed allocation measurements. Results measure the in-memory aggregator only, not receipt reconstruction, SQL, HTTP, retained input memory or peak process RSS. Use repeated production-host runs before capacity planning.

Global holder database reads also propagate the request context into the in-memory address aggregation. Cancellation is checked at market boundaries, every 256 records during balance/address processing, and before/after output sorting. Cancelled work returns no partial counts. Sorting itself is still bounded synchronous work, so this is cooperative cancellation rather than a hard wall-clock execution limit.


Market directory sorting additionally supports `sort=name_asc` and `sort=launchPhase_asc`. Name order folds ASCII uppercase only and compares UTF-8 bytes, requiring complete identity coverage; missing identity returns 503. Phase order compares launchPhase, not trading availability. Both use ascending marketId for ties and bind the sort to the pagination cursor. This extends the full snapshot query; clients must use these server queries for directory-wide ordering.


For a bounded browser-only directory fixture, set `TG_TEST_BROWSER_URL_FILE` to an absolute temporary file path and run `go test ./internal/httpapi -run TestMarketDirectoryBrowserFixture -count=1 -v`. The file contains a loopback URL; configure the Vite process with that URL as `VITE_V1_READ_API_URL` and port 4393. The fixture serves synthetic 130-market data through the real router and permits that local origin. It stops on `GET /__fixture/stop` or fails after 120 seconds, removes its URL file, and is skipped unless explicitly enabled. It does not validate a deployed protocol or database publication.

The bounded market browser fixture also exposes `/__fixture/unavailable` and `/__fixture/recover` to toggle its synthetic read-model availability atomically. These test-only loopback routes allow the complete page to exercise update failure and recovery with an unchanged finalized revision.


`go test ./internal/httpapi -run '^$' -bench BenchmarkMarketSortedPage -benchmem -benchtime=1x` measures in-memory directory query/pagination for 1k/10k/50k synthetic records. Sorting computes identity once per item, sorts references, and uses binary search for cursor positioning. Unfiltered directory ordering avoids a full-record copy. Benchmark input creation, snapshot decoding, database loading and HTTP are excluded; this does not raise the configured snapshot limits or establish production throughput.


The transaction status reader in `internal/transactions` binds receipt history to a fresh, continuous journal snapshot and configured genesis hash. Returned confirmations use the indexed tip; `pendingLookup=not_performed` makes the missing RPC mempool check explicit. It verifies complete receipt sets for observed transaction blocks against durable local commitments, not Ethereum receipts roots. The targeted database regression requires the shared journal setup: `go test -race ./integration -run 'TestPostgresMigrationAndReadiness/(journal|transactions)$' -count=1` with `TG_TEST_DATABASE_URL` configured. The public transaction endpoint uses the coordinating service described below.


### Transaction status API

`GET /v1/transactions/{txHash}` accepts a canonical lowercase transaction hash and no query parameters. Enable it with `TG_TRANSACTION_STATUS_MANIFEST`, `TG_DATABASE_URL`, and `TG_RPC_URL`. The deployment manifest pins chainId/genesis; a chain mismatch, invalid manifest or missing required dependency prevents configured service startup. Without a transaction manifest the route returns 503.

SDK: `getTransactionStatus({txHash})`. The response distinguishes unknown/pending/confirmed/finalized/reorged, and receipt execution succeeded/reverted separately. Live head/finalized metadata, journal tip/time, RPC observation time and orphan receipt history remain explicit. It is read-only/display-only, with no signing/submission and no implicit conclusion of non-submission from unknown. Conflicts and unavailable sources return `503 transaction_unavailable`; invalid requests return 400. This route joins the seven analytics routes in the shared four-request admission gate; overload uses `503 analytics_unavailable` and `Retry-After: 5`. OpenAPI 2.21.0 contains all 16 GET routes.

The `journal|transactions` PostgreSQL target now includes a real HTTP JSON-RPC fixture feeding the coordinating transaction service and a real HTTP API client. With `TG_TEST_WEB_INTEGRATION=1`, the generated frontend SDK also checks the confirmed/reverted re-inclusion response and a 503 for a changing RPC head. RPC data is controlled test evidence, not external-chain acceptance.


用户活动索引：迁移 66 为后续历史 API 保存区块批次和地址角色记录。projection-worker 在原有事务中写入已认证事件的活动索引；运行前须升级数据库。已有历史不会自动补齐；可选的用户活动分页接口要求配置范围内的每个 finalized 区块已有完整批次。索引中的事件角色不代表交易签名人，也不可直接用作成交量或空投资格。


用户活动 API：设置 `TG_DATABASE_URL`、`TG_USER_ACTIVITY_MANIFEST`（与投影器相同的部署清单）和 `TG_USER_ACTIVITY_START_BLOCK`（与投影起点相同的十进制高度），启用 `GET /v1/users/{address}/activity?limit=50`。`limit` 为 1–100，下一页传回 `nextCursor`；409 表示历史 revision 已变化，需移除 cursor 重新读取。未启用、历史批次缺失、版本/身份/回执或活动摘要不一致均返回 503。该读取不额外访问 RPC。

读取在一个 repeatable-read 事务内核对整个配置范围，当前上限为 100 万区块、10 万回执、10 万日志、10 万活动记录，回执和活动原始数据合计 64 MiB；超限拒绝，不返回截断历史。区块元数据和 Go 对象内存不包含在原始字节预算中。生产负载优化与真实部署历史验收仍待完成。


活动历史补齐使用与正常投影相同的 `TG_PROJECTION_DATABASE_URL`、`TG_PROJECTION_START_BLOCK`、`TG_DEPLOYMENT_MANIFEST`、`TG_CHAIN_ID` 和支持历史 blockHash 读取的 `TG_RPC_URL`：

```sh
make activity-backfill-once # 一次最多补一个区块
make activity-backfill-run  # 连续补齐，当前 discovery 范围无待补批次时退出
```

也可运行 `./bin/projection-worker --backfill-activity-once` 或 `--backfill-activity-run`。任务与索引器/投影器共用链事务锁，先检查连续、已验证回执的 discovery 区间，再选最早缺失或 manifest/extractor/receipt 摘要过时的活动批次。逐块重新验证历史代码和核心绑定、完整回执，原子替换该块活动；失败整块回滚，重启继续扫描。业务 projection checkpoint、业务事实和观察批次不被重放或改写。历史资产候选仅来自目标高度及以前的注册事件，并在目标 blockHash 通过 Registry 核验。

`busy` 表示链锁占用；`waiting_for_discovery` 表示前置来源未就绪；`activity_backfilled` 表示当前区块已提交；`idle` 仅表示 discovery 当前范围无缺失/过时批次，不等于 API 完整历史验证或生产验收通过。不会自动修复元数据仍匹配的记录内容篡改，API 仍会拒绝摘要/内容不一致。每步扫描最多 100 万区块，资产候选最多 1 万项；长期历史吞吐仍待优化和验收。运行该命令不会签名或发送链上交易。


展示价格浏览器夹具（仅本地合成数据）：设置 `TG_TEST_PRICE_BROWSER_URL_FILE=/tmp/tickergarden-price-browser-url` 后执行 `go test -race ./internal/httpapi -run '^TestDisplayPriceBrowserFixture$' -count=1 -v`，读取该文件中的临时 Go origin。前端以 `npm run dev -- --host 127.0.0.1 --port 4394 --strictPort` 启动，打开 `/tests/browser/display-prices.html?api=GO_ORIGIN`。Go origin 的 POST `/__fixture/stale`、`/__fixture/failure`、`/__fixture/available` 控制状态，页面 Reload reference 重读；结束时 POST `/__fixture/stop`。夹具 180 秒自动超时，不会查询外部价格源或改变交易权限。


同一价格夹具可添加 `TG_TEST_PRICE_FULL_PAGE=1`，提供匹配 release catalog 的合成 AAPL Quote 配置供正式 `create.html` 联调。前端设置 `VITE_V1_READ_API_URL` 为临时 Go origin、`VITE_V1_CHAIN_ID=4663`，并将六项 V1 合约地址环境变量置空以保持只读；选择 AAPL。POST `/__fixture/snapshot-failure` 只令快照不可用，价格接口保持正常，可验证页面在 Quote 身份失效时清价；POST `/__fixture/available` 恢复。该夹具不修改 release 文件或真实注册表。


`TG_TEST_PRICE_FULL_PAGE=trade` 在同一夹具提供一个合成市场，可打开正式 `trade.html?marketId=0x0000000000000000000000000000000000000000000000000000000000000064`。前端现有 RPC 路径读取目录中 NVDA/AAPL 的 name/symbol/decimals，故该模式需要公共 RPC 可用；它不代表 NVDA 是项目发行的 Meme，也不提供真实部署/交易证据。整页模式（1/trade）运行上限为 10 分钟，组件模式仍为 180 秒，完成后须 POST stop。


市场身份读取现使用 LoadManyAt 批量核对，身份补齐、发布和快照读取均避免逐市场 SQL。批量路径保留 canonical discovery、manifest、回执、创建区块及内容摘要检查，缺少任一请求成员即拒绝，最多 5 万成员/64 MiB 原始数据/5 秒；快照本身仍受 16 MiB 限制。Store.Load 在只读 repeatable-read 事务内同时核对快照与身份。integration 的 market identity fixture 包含 1,000 项新旧读取逐项对照、查询次数与耗时日志；它不等同于大目录完整 HTTP 负载验收。


完整市场目录 HTTP 容量检查（独立创建/删除测试数据库）：

```sh
TG_TEST_DIRECTORY_HTTP=1 TG_TEST_DATABASE_URL='postgres://user@127.0.0.1:5432/postgres?sslmode=disable' go test -race ./integration -run '^TestDirectoryHTTPCapacity$' -count=1 -v
```

覆盖 1,000 市场实际 Enrich/Publish/Store/HTTP 路径、名称分页、全目录搜索、八路并发筛选、来源失效及同版本恢复，并打印快照字节、发布时间、分页中位与最大延迟。测试数据为合成来源，不联系公共链，不是生产部署证明。快照校验缓存仅保留最多 32 个 chain+SHA256 校验记录；每次读取仍校验字节摘要和实时数据库身份/主链状态，返回独立解码对象。

完整快照路由（目录/配置/仓位、`/health`、`/readyz`、`/v1/updates`）每个 API 实例共享 8 个并发名额，覆盖解码到响应序列化；超额请求立即返回 `503 snapshot_unavailable`、`Retry-After: 5`、`Cache-Control: no-store`，客户端应清除依赖快照的可用状态并退避重读。`/livez` 不占名额。该限制独立于 analytics 的 4 路准入；不是全服务内存限制或生产吞吐承诺，多实例部署需要独立配置基础设施资源限制。

`v23-directory-observations` 投影版本改用 `ObserveDirectoryBlock`：每个被处理 finalized 区块读取全部已发现市场及 Curve 状态，包括无业务日志的市场；单批最多 1,000 市场，超限在 RPC 前拒绝。原事件触发观察函数仍供独立调用。所有读数保持同一 block hash、身份/代码/反向索引和末次 canonical 核验，缺失 getter 不返回部分批次。RPC 成本随市场数增长，需生产容量验收；这尚未完成快照组装、独立对账或自动发布。旧版本 projection checkpoint 会被版本校验拒绝，需按受控重建流程重建派生投影；不得只改 checkpoint 的版本字符串冒充已重建。此变更不自动删除或重建数据库。

`v24-route-executor` 为同块路由观察补齐 Registry 的 `graduationExecutor()` 地址及 `routeRuntime.graduationExecutor` 代码哈希；零地址、异常 ABI、读取失败或空代码拒绝整批。地址权威来自该区块已核验的 Registry，观察到的代码哈希不是编译产物匹配或完整部署授权证明。投影版本升级仍要求旧派生检查点显式重建；不会自动修改数据库。此字段为后续快照组装提供输入，自动 publication 仍未接通。

`readmodel.BuildMarketCandidate` 提供观察→市场 DTO 的纯组装函数，复用冻结 Schema/跨字段校验，保留金额字符串并拒绝缺失、溢出和身份矛盾。只返回候选市场，尚未接入生产 publication；调用者必须独立核验数据库批次/回执、canonical/finality、完整集合和对账结果。其 Source 表示来源事件，观察值仍为区块末状态。

`readmodel.BuildConfigCandidate` 将 quote/baseline/template 区块观察映射为配置候选 DTO，显式展平 Quote binding，小整数检查位宽后转 JSON number，uint256 保留十进制字符串；保留停用状态和身份检查失败标志。拒绝缺失字段、错误类型、非规范数值、来源不匹配与重复观察。asset/Vault 配置尚未接入；函数不认证数据库批次、不对账、不发布快照。

`v25-asset-minimum` 在 DiscoverAssets 中按同一 block hash 补读 `minimumAllocation(bytes32)`，缺失或低于 414 拒绝整个资产集合；值随 asset 状态持久化。BuildConfigCandidate 现支持 asset：展平身份/指纹/Vault 哈希，要求 6–18 位 Token 精度、不同非零 Token/Vault 地址、完整 uint256 最小 allocation，保留停用状态。该配置映射不宣称本金或偿付对账完成。旧投影检查点需要显式重建，不自动修改已有数据库。

`readmodel.BuildPositionCandidate` 将同块 Vault/Gauge 观察组装成普通仓位候选，交叉核对账户余额与市场本金，并按 activationSnapshot.processed 将未 materialize 的有效本金归入 active。领取额保留 positionOf 预览，不保证领取成功。Free 是账户级，Allocated 是市场级；未完成 rage quit settlement 拒绝普通映射，不能以此替代退出状态 API。仍需上游持久来源验证、完整集合与独立对账，尚未接入自动 publication。

`readmodel.ObservationStore.LoadCandidateBatch` 以只读 repeatable-read 读取当前投影批次，绑定部署范围、主链/finality、新鲜度和摘要，并逐行核对观察镜像。读取预算为 10 秒、16 MiB payload、最多 10 万观察及 16 MiB 行值；不代表完整历史回执验证或财务对账。隔离测试：

```sh
TG_TEST_OBSERVATION_STORE=1 TG_TEST_DATABASE_URL='postgres://user@127.0.0.1:5432/postgres?sslmode=disable' go test -race ./integration -run '^TestObservationCandidateStore$' -count=1
```

测试需创建/删除临时数据库权限，不迁移传入的数据库。

`readmodel.BuildCandidateSet` 连接单项候选组装器，要求精确来源 inventory，并检查市场/配置引用及 Vault/Gauge 账户覆盖。来源键为 `market:<id>`、`config:<kind>:<id>`、`position:<user>:<market>`。结果按键排序且 `publicationEligible=false`，不含发布所需 SyncStatus。未覆盖的纯空闲本金账户会拒绝整批，尚需独立账户 API；传入 inventory 的历史完整性仍由上游证明。当前数量有上限，批量性能尚待验证。

账户候选已加入 `CandidateSet.accounts`，来源键增加 `account:<assetUid>:<user>`。`BuildAccountCandidate` 保留资产级存款、总分配及空闲本金，批量组装再核对该账户所有市场仓位分配总和。仅有空闲本金的账户可正常进入候选集合；历史上的“纯空闲账户拒绝”限制已由此内部模型替代。公共账户 API 尚未上线，候选仍 `publicationEligible=false`。

`ObservationStore.LoadCandidateSet` 在一次只读 repeatable-read 事务内读取批次并回放持久投影输入，从事件 provenance 自动生成来源清单，核对原始日志和输入摘要/数量并拒绝遗漏已知对象。预算为 30 秒、10 万输入、64 MiB 输入与日志；输出仍是不可发布候选。它尚不证明完整回执历史、每个 emitter 的独立重新认证或财务对账。`TestObservationCandidateStore` 已包含真实数据库中的资产注册 ABI 回放与非空候选生成。

`LoadCandidateSet` 现验证配置区间连续性及完整本地回执集合，重新计算每块 ReceiptSetCommitment，并将全部回执日志与 journal 日志逐项对照。范围最多 100 万块、10 万回执/日志及累计 64 MiB；缺口、父哈希/时间错误、回执遗漏或篡改拒绝候选。此前“尚未验证完整回执历史”的限制已缩小为尚未证明 Ethereum receipts root、提供方独立真实性及配置范围之前的历史。独立 emitter 认证与财务对账仍未完成，不启用自动发布。

候选集合现执行市场分配→账户→资产的本金金额核对，要求完整 vaultSolvency 观察、账户存款/分配合计等于 Vault 总额且 Token 余额覆盖存款。重新计算金额，不把观察 checks 标志当证明；重复 Token 的资产配置拒绝。该检查不涵盖收益/手续费负债，也不代替独立事件/RPC 认证，仍不能自动发布。

候选回放允许真实 projector 所需的 `MarketCreated` 附带市场观察，但仅接受与规范发现记录和原始创建日志一致的一份 market 状态，并对照事件关键字段。其他附带观察仍拒绝。所有已发现市场必须被事件回放覆盖；不再一律拒绝合法创建观察。该检查属于本地发现/事件一致性，独立 RPC 部署认证尚待接入。

### 只读候选流水线检查

`candidate-inspect --once` 执行当前观察批次、回执区间、投影输入回放、来源清单和本金汇总检查，输出完整候选 JSON。使用独立 SELECT 凭据，不使用 API/投影写入凭据作为自动回退；无 RPC、签名、数据库迁移或发布行为。`--describe` 无需配置，可查看当前版本与能力边界。

```sh
export TG_CANDIDATE_DATABASE_URL='postgres://reader@127.0.0.1:5432/tickergarden?sslmode=disable'
export TG_DEPLOYMENT_MANIFEST='/absolute/path/deployment.json'
export TG_PROJECTION_START_BLOCK='1'
make candidate-inspect
```

命令从 manifest 获取链和 genesis，按投影 worker 的地址排序规则计算 manifest 指纹，并绑定当前 projector version/scope。30 秒超时，SIGINT/SIGTERM 取消；失败只写 stderr 并非零退出，不输出部分候选。输出保留 `publicationEligible=false`、`independentEmitterAuthentication=false`、`fullFinancialReconciliation=false`；该命令不是上线或发布门禁已通过的证明。

真实进程联合测试：在上述隔离观察测试命令中增加 `TG_TEST_CANDIDATE_CLI=1`，验证非空候选及日志篡改后的无输出失败。

候选检查命令会验证部署清单 scope，并将回放日志的地址/模块绑定到静态清单、Factory 创建事件与 Registry 资产注册事件。成功时 `candidate.emitterAddressBindingsVerified=true`；这只是本地来源绑定，尚不包含历史 RPC 代码认证。`independentEmitterAuthentication=false` 和 `candidate.publicationEligible=false` 仍然保留。

`candidate-inspect --publish` 是新增的受控发布门禁。它要求 `TG_CANDIDATE_RPC_URL` 与不同配置的 `TG_CANDIDATE_INDEPENDENT_RPC_URL`，对同一候选分别执行完整历史、资产、静态部署、回执根和 Treasury 检查；连续 Holder 市场还要求精确的 `TG_HOLDER_SCOPE_FILE` inventory，并由 Holder `AuditHistory` 在主、独立两个 RPC 上对同一块逐账户 `Reconcile`。验证后会重新加载候选并复查两 RPC 的候选块，防止验证期间候选或 canonical block 变化。通过后由 `AssemblePublication` 生成冻结 Snapshot 与 evidence，最后由 `Store.PublishVerified` 在同一 PostgreSQL 事务中保存；migration 00073 保存不可变 evidence。该路径不接受 `CandidateSet.PublicationEligible` 自报，也不要求人工填写 `verifiedAt`，服务端生成当前验证时间；绝不提交链上交易。

当前尚未完成真实双提供商/真实链验收、全流程受控 RPC + PostgreSQL E2E、容量与长期运行验收。后续可将该逻辑拆为独立 producer binary。既有 `publish-snapshot` 的受信生产者文件路径仍存在，不能把它等同于上述双 RPC 自动门禁。

本轮还收紧了 D01 evidence：连续 Holder publication evidence 保存并校验 `startBlockNumber`，且必须绑定候选市场的 source block；scope、audit 和 account inventory 使用严格的 SHA-256 格式与内容校验。`Store.PublishVerified` 的 PostgreSQL 回归覆盖 head 区块缺少 `receipts_verified` 时拒绝、补齐后才允许发布，证明该门禁不会把未完成回执核验的 head 当作可发布状态。该回归仍是本地数据库证据，不是生产链验收。

D03 的 `settlement-executor` 已将生产 runtime 构造拆到最小 `executionRuntime` seam，CLI progression test 用 fake runtime 覆盖 progress、重复运行和 cleanup。完整本地 `smoke-chain` 另行通过隔离 PostgreSQL 历史重放与 disposable Anvil 上的真实 FeeVault 交易。它仍只执行显式选定的 job；现有测试尚未覆盖 CLI 调用外部 signer 的生产闭环、远程 RPC/数据库或生产广播，未知签名/提交结果也不会自动重试。

候选检查还会从完整本地收据对应的日志反查投影输入覆盖，防止删除输入并同步降低计数后漏报事件。成功时 `candidate.protocolEventInventoryVerified=true`，范围限定为已绑定地址上的冻结 ABI 事件；这不替代独立 RPC 认证与完整财务对账。

可选静态链上核验：在候选检查环境基础上设置 `TG_CANDIDATE_RPC_URL`，运行 `go run ./cmd/candidate-inspect --once --verify-static-rpc`。命令在候选区块哈希处核对部署清单中所有静态合约的 runtime code hash，并检查链 ID、创世块、最终确认高度及核验前后区块一致性。成功输出 `staticRuntimeAtCandidateVerified=true`；未启用则为 false。任何核验失败均不输出候选。此项不覆盖动态实例或所有历史区块，`independentEmitterAuthentication` 和 `publicationEligible` 仍为 false。

`--once --verify-assets-rpc` 使用同一 `TG_CANDIDATE_RPC_URL`，在静态核验基础上验证候选中所有资产的 Registry/Vault 关系、代币指纹与代码身份，并逐项核对资产配置。需要完整核心部署清单。成功增加 `assetIdentitiesAtCandidateVerified=true`；不包含市场动态实例、历史区块或完整资金对账，也不授权发布。

资产 RPC 模式同时重读每个候选账户的 deposited/allocated/freeBalanceOf，并将账户总和与链上 totalDeposited/totalAllocated 核对，要求 Vault 的 token balance 覆盖存款。成功输出 `vaultPrincipalAtCandidateVerified=true`；不代表 Gauge 奖励、手续费或 Treasury 的完整财务对账通过。

资产核验模式还会调用现有市场路由观察器，比较候选市场的路由端点、代币/Curve/Gauge 地址、阶段、版本和毕业 PoolKey。成功增加 `marketRoutesAtCandidateVerified=true`；该项不证明所有市场实例代码或历史事件身份，也不证明池流动性和执行报价。

资产核验模式也会分批重读 quote/baseline/template 配置，与候选的规范化字段和状态逐项比较，成功增加 `configValuesAtCandidateVerified=true`。该标记表示数值一致，不表示所有配置已启用或 identityCurrent=true；失效状态仍保留。

资产核验模式在 Registry 路由核验后，检查每个 Curve 有代码、quoteAsset 一致，并重读五项 CurveProgress 字段。成功增加 `curveProgressAtCandidateVerified=true`。代码存在性并不等同于 Curve 模板代码完整认证，发布门槛仍关闭。

资产核验模式进一步检查候选 Gauge 仓位的身份绑定、positionOf、激活快照和 rageQuit 结算状态，并比较有效 Active/Pending、解锁时间及 claimable。成功增加 `gaugePositionsAtCandidateVerified=true`。它不证明 Gauge 奖励总负债或已发现实例的历史代码哈希；完整财务与发布标记仍为 false。

Gauge 核验同时汇总经激活快照解释的 Active/Pending，对照 storedTotalActiveStock/totalPendingStock。没有候选仓位的非零 Gauge 也必须完成身份和零总额检查，防止遗漏全部用户后跳过核验。

资产核验模式还会在候选区块 hash 上核验已知市场 FeeVault 的 Creator/Staker/Platform/Holder 四类桶和 forfeitureReserve，按资产合计必须等于 totalLiability，ERC-20 或原生余额必须覆盖该负债。成功增加 `knownMarketFeeCoverageAtCandidateVerified=true`。范围仅为候选市场涉及的资产；空市场集合不作余额读取。这不证明市场目录完整、各 epoch/用户权益正确或 Treasury 对账完成，`fullFinancialReconciliation` 和 publication 仍保持 false。

资产核验模式新增 `creatorEpochLiabilitiesAtCandidateVerified`：从 FeeVault 读取 Creator Registry，核对 Factory/Market Registry 绑定与非空代码，再读取候选各市场 1..currentCreatorEpoch 的非零受益人及双资产未领取负债；两类 epoch 合计分别必须等于 Creator 桶。单次所有市场合计最多 1024 个 epoch，超限失败而不截断。允许多个 epoch 使用同一受益人。此标记不证明历史受益人变更合法性、已领取流水、候选市场完整性或完整财务对账。

资产核验模式新增 `knownHolderCoverageAtCandidateVerified`：从当前 Registry 重新读取候选市场并核对 token 反向索引，使用部署清单选择 epoch Treasury 或连续 24 小时 Holder 观察器。要求观察器的余额覆盖、市场负债合计及 epoch 资金检查全部通过；观察成功但存在 false 检查不能通过。当前 token runtime 仅按本次区块读取绑定，不是历史创建代码认证。此标记不证明完整市场目录、用户领取历史或 Merkle/TWAB 分配正确性；无 Holder 市场时不读取其余额。

候选集合现在包含 `creatorEpochs`（当前未领取权益），记录 marketId、epoch、beneficiary、Quote/Meme 资产及负债，按市场和数字 epoch 排序。构建时拒绝孤立市场、重复轮次、无效受益人、非规范金额和资产错配。资产 RPC 模式要求候选轮次完整，并逐项匹配链上受益人、资产与双资产金额；不再仅依赖链上 epoch 合计检查。该数据位于候选 blockHash 范围内，不是历史领取流水或公开奖励 API。

`creatorEpochs` 还包含 `rawRewardExitAt`、`rawRewardExitReady`、`observedAtTimestamp`。构建时校验规范时间和就绪状态，RPC 模式重读候选区块 Header 与 FeeVault 的 market/beneficiary 退出时间，逐项匹配。就绪条件为退出时间非零且不晚于该区块时间，不使用本机时间；此字段不代表一笔领取交易必然成功。

Creator 候选本地构建还要求逐市场 epoch 连续、双资产 feeLiability 的 creatorEpochCount 与轮数一致、Creator 桶与逐轮负债之和一致；同批次观察时间和同市场受益人的退出截止点不得冲突。该检查只约束已存输入之间的一致性，不能替代独立 RPC 的完整范围校验。

Creator 候选持久化验收：`TG_TEST_CREATOR_CANDIDATE=1 TG_TEST_DATABASE_URL='postgres://…' go test -race ./internal/readmodel -run '^TestCreatorCandidatePostgres$' -count=1`。测试创建、迁移并删除独立数据库，覆盖观察批次存取→候选构建、明细篡改、重算摘要后缺失 epoch，以及数据恢复。它使用测试来源信息，不替代 LoadCandidateSet 的全事件重放和 RPC/CLI 联合验收。

候选集合新增 `holderMarkets`，明确区分 `continuous-24h` 与 `epoch`：前者保存累计注资、已支付、剩余负债、流周期及最近注资时间；后者保存当前 epoch、周期、激活时间、资格策略 hash 和 TWAB schema。开启 Holder 分享的市场必须有相应记录，关闭的市场不得混入；类型、资产和数值不符时构建失败。该集合是市场级候选状态，尚未逐字段绑定 RPC，也不提供用户领取证明。

Holder 资产 RPC 检查现已将通过偿付核验的观察值和 Registry 市场记录组装为临时 `known-holder-coverage-v1` 批次，使用同一候选构建器规范化，再逐项比较 `holderMarkets`。因此缺失/额外记录、模式、分配器、周期/时间，以及 funded/paid 改变但 outstanding 不变的候选均不能通过。该临时批次不写入数据库；失败不返回部分证据。

epoch 模式的 `holderMarkets[].epoch.entries` 现在保留固定字段集合的逐轮明细，覆盖状态、资金/领取金额、根和数据集哈希、源区块及时间窗口。构建必须完整覆盖 1..currentEpoch，重新检查资金关系，RPC 比较同时涵盖这些明细。该输出仍为候选证据，不证明 Merkle/TWAB 分配正确或用户可以成功领取。

`TG_TEST_CREATOR_CANDIDATE=1` 的隔离数据库套件现也覆盖 Holder epoch/continuous 模式：从观察器导出夹具适配市场身份，装入完整候选批次，经 PostgreSQL 存取后逐字段比较；验证明细篡改、重算摘要后的缺失 epoch/超额 paid，以及恢复。此测试不覆盖该夹具的历史事件重放或 RPC→CLI 全链路。

API 运维指标：`GET /metrics` 提供 Prometheus 0.0.4 文本格式（不依赖快照或数据库可用性）。包括 `tickergarden_http_requests_total`、`tickergarden_http_request_duration_seconds` histogram 和 `tickergarden_http_in_flight`。请求标签仅为 chi 路由模板、有限 HTTP 方法集合及状态码类别；不含 URL 参数、钱包、交易 hash 或错误文本。未匹配路径统一为 unmatched，抓取自身不计数，进程重启后计数重置。

部署时由运维网络/反向代理控制抓取入口。指标用于观察请求服务情况，不能替代 `/readyz` 的数据库与已发布快照就绪检查。后台任务、索引落后量和生产告警规则仍需单独接入。

就绪指标：`tickergarden_api_ready` 表示已完成探测中发起顺序最新的 GET /readyz：1=就绪、0=未就绪、-1=尚未观察。`tickergarden_api_readiness_observed_timestamp_seconds` 为该探测完成时间，初始为 0。采集器必须独立调用 `/readyz` 并检查观察时间的新鲜度；仅抓取 `/metrics` 不会探测数据库或刷新就绪值。容量拒绝及 panic 的非 200 结果会记为未就绪，历史的 ready=1 不能单独作为当前可用性的判断。

并发 `/readyz` 以发起序号保护就绪状态：较早请求迟到时不会覆盖已经完成的较新探测，观察时间也保持对应。每次探测仍计入请求量及延迟统计。

监控配置、告警阈值和处理说明见 [monitoring/README.md](monitoring/README.md)。使用 `make monitoring-check PROMTOOL=/absolute/path/to/promtool` 校验 Prometheus 配置及告警时序测试；当前仅提供本机进程示例，未配置生产目标或通知接收端。

管线指标可用 `go run ./cmd/backend-status --once --prometheus` 输出。沿用独立 `TG_STATUS_DATABASE_URL`、链 ID、滞后/时间阈值及可选 `TG_STATUS_RPC_URL`。输出 journal/discovery/projection/publication 的存在性、规范链状态、高度和相对上游滞后，以及数据库观察时间、journal 进度时间、本金对账计数和可选 RPC 观察。缺失高度/计数不会补零；标签只有链 ID 和固定阶段名，不输出 hash、数据库地址或任意告警字符串。

退出码仍为 0=阈值内、2=需要关注但有完整有效报告、1=读取/编码失败。采集适配器必须接受 0/2 的有效输出，并检查 observed_timestamp_seconds 的年龄；不得因退出码 2 丢弃告警数据，也不得把旧指标当成当前状态。该命令不运行常驻 exporter，不改变 API /metrics，也不表示生产就绪。

textfile collector 可使用 `go run ./cmd/backend-status --once --metrics-file /absolute/collector/pipeline.prom`。目录须提前创建并允许运行用户写入，路径必须为绝对路径且以 `.prom` 结尾。此模式明确写入本地文件，stdout 留空；数据库与 RPC 仍只读。完整报告（退出码 0 或 2）写入同目录临时文件，刷盘、关闭后原子替换，文件权限为 0644；采集器不会看到半份报告。读取、编码或替换前的写入失败返回 1，保留原指标，临时文件清理。它保证替换的原子可见性，不承诺机器断电后的目录项持久性。

每个目标文件仅安排一个写入进程，避免并发旧报告覆盖新报告。调度器须保留退出码 2 的指标，并单独报告退出码 1；采集端必须检查 `tickergarden_pipeline_observed_timestamp_seconds` 是否缺失、过期或在未来。首次失败没有指标文件，后续失败保留旧文件，两者都不能解释为健康。当前未安装 node_exporter、定时任务或生产采集目标。

完整统计页本地验收：设置 `TG_TEST_STATS_BROWSER_URL_FILE=/tmp/tg-stats-browser-url`，运行 `go test -race ./internal/httpapi -run '^TestStatisticsBrowserFixture$' -count=1 -v`。读取文件中的 Go origin，前端设置 `VITE_V1_READ_API_URL` 为该地址、`VITE_V1_CHAIN_ID=4663`，六项 V1 合约地址环境变量置空，使用 Vite 的 `--host 127.0.0.1 --port 4395 --strictPort`，打开 `/stats.html`。夹具只允许该 origin，最多运行 300 秒，使用合成 130 市场与统计 Reader，所有 HTTP 路由和前端 SDK/校验/渲染均为正式实现；不覆盖 PostgreSQL、实际 RPC 或真实 publication。

验收步骤：确认 130 市场、65/65 阶段分布、3 个 holder 地址/排除后 2 个、成交量 3/内部转换 1、24 个小时桶（首桶两笔成交，其余无成交）。POST Go origin 的 `/__fixture/unavailable` 后等待更新轮询，应清空顶部汇总、阶段/储备、成交详情、持有人和小时表；POST `/__fixture/recover`，无需刷新页面或改变 revision，应恢复所有数据。POST `/__fixture/stop` 结束并清理 URL 文件。首次浏览器实测发现顶部统计未随故障清理，现已统一清理并使未完成渲染失效，修复后同 revision 恢复通过。

同一统计夹具亦用于 `/index.html` 的首页恢复验收：初始显示 10 个市场链接与全局统计；POST unavailable 后等待轮询，链接全部移除并显示等待已验证数据，统计清空；POST recover 后保持同一 revision 自动恢复 10 个链接和统计。市场名字可在缺少可选元数据时显示链上市场 ID。首页清理同时使旧渲染失效，避免迟到的元数据将卡片重新插入。该场景仍为受控 Go Reader，不代表真实 RPC/部署验收。

更新接口的快照身份校验：`/v1/updates` 要求当前及成功读取的历史快照均为相同链的 synced/finalized 状态，区块号与哈希非空且逐字组成 revision。当前身份不一致立即返回 503，不继续读取历史；历史快照返回成功但身份错误也返回 503。只有明确的 `ErrRevision`（历史 revision 不再可用）才退回完整 reset，避免将损坏快照当作普通缓存过期。前端更新校验器要求 mode 和 invalidated 成员为字符串，拒绝 JSON 数组隐式转换成字符串的伪合法值。

快照更新的 PostgreSQL→HTTP→前端 SDK 联合验收可运行：

```sh
TG_TEST_WEB_INTEGRATION=1 \
TG_TEST_DATABASE_URL='postgres://USER@localhost:5432/postgres?sslmode=disable' \
go test -race ./integration -run '^TestPostgresMigrationAndReadiness$' -count=1
```

从 backend-go 目录运行，需本地 PostgreSQL CREATEDB 权限及 Node 22+。测试创建独立数据库并清理，快照通过正式 Store.Publish 写入；生成 SDK 使用真实 loopback HTTP，请求经过正式更新路由和前端更新校验器。覆盖首次 reset、unchanged、changed、回执覆盖/时间失效、32 版本窗口过期，以及受控 journal 分支变更后恢复发布。孤块 publication 必须先返回 503；单独替换 canonical 区块不能恢复服务；发布更高的 finalized revision 后，旧孤块 since 返回 reset、新 since 返回 unchanged，旧版本仍不可 pin，35 条 publication 审计记录保留。此测试直接安排 journal 分支，不声称覆盖真实 RPC 的重组发现或自动业务对账/发布。

目录容量测试可指定市场规模（默认 1,000，接受 200–8,000 的规范十进制整数）：

```sh
TG_TEST_DIRECTORY_HTTP=1 TG_TEST_DIRECTORY_MARKETS=5000 \
TG_TEST_DATABASE_URL='postgres://USER@localhost:5432/postgres?sslmode=disable' \
go test -race ./integration -run '^TestDirectoryHTTPCapacity$' -count=1 -v
```

测试会创建并清理独立数据库，经真实身份补齐和快照发布后以每页 100 个市场完整遍历目录，检查名称排序、无重复/遗漏、目录末项搜索、八路并发阶段筛选以及 manifest 失效和同 revision 恢复。日志报告快照字节数、身份补齐/发布时间、分页中位数/p95/最大时间。测试保留原 10 秒 HTTP 超时、身份查询预算、16 MiB 快照限制和数据新鲜度保护；运行失败不能解释为该规模已支持。此容量只覆盖目录发布/读取，不提高后台补读和候选核验现有的 1,000 市场预算，也不是生产 SLA。

容量与 race 检查应分开解释。需要分析目录读路径时，可对同一容量测试单独采样：

```sh
TG_TEST_DIRECTORY_HTTP=1 TG_TEST_DIRECTORY_MARKETS=5000 \
TG_TEST_DATABASE_URL='postgres://USER@localhost:5432/postgres?sslmode=disable' \
go test ./integration -run '^TestDirectoryHTTPCapacity$' -count=1 -v \
  -cpuprofile=/tmp/tg-directory.cpu -o /tmp/tg-directory-profile.test
go tool pprof -top /tmp/tg-directory-profile.test /tmp/tg-directory.cpu
```

2026-09-07 本机非 race、启用 CPU profile 的 5,000 市场运行通过：50 页中位 387.8 ms、p95 488.0 ms、最大 672.3 ms，身份补齐/发布 1.730 秒，测试总计 57.469 秒（包含临时建库、迁移和清理）。对应先前 race 数值不能用作正常进程 SLA。CPU profile 包含整套测试而非仅分页，且不包含 PostgreSQL 进程 CPU；需要另行做 SQL 执行计划与持续并发分析，不能从 Go profile 推定数据库瓶颈或直接降低验证强度。

在目录容量命令中增加 `TG_TEST_DIRECTORY_TRACE=1` 可观察 snapshot/identities 两类实际读取：记录次数、驱动查询错误数、平均/最大耗时；结束时对相同参数执行只读 `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` 并打印执行时间、返回行数和缓冲区统计。仅测试连接启用 tracer，连接池配置沿用正式构造器，生产连接不变；不打印 SQL、参数、DSN 或返回内容。驱动错误计数不包含查询成功后业务校验拒绝的情况。Trace 耗时包含传输及客户端消费行，EXPLAIN 是热缓存下数据库执行时间，二者不能混为纯 SQL 延迟。

批量身份读取将同批共用的 discovery checkpoint、journal finalized 和 anchor 条件放入 materialized CTE，在同一 SQL statement 快照中计算一次；逐市场仍检查 canonical、receipt coverage、创建时间范围、manifest、token 和 payload digest，缺少任何成员仍整批拒绝。2026-09-07 相同 5,000 市场本机非 race trace 对比：身份查询平均 300.73→269.14 ms，EXPLAIN shared hits 55,568→15,465，分页中位 414.04→396.83 ms。单次对比受运行环境影响，不是生产 SLA；未改数据库迁移、查询预算或新鲜度策略。

可用 `TG_TEST_DIRECTORY_ROUNDS=10` 扩展目录容量测试的并发阶段（默认 1，允许 1–10）：八个客户端同时启动，每个顺序执行指定次数，总计 `8 × rounds` 个固定 revision 的阶段筛选请求。每个响应要求 synced、同 revision、完整 100 项且 ID 严格等于预期降序集合，保留身份信息；随后继续执行失效/恢复验证。打印并发阶段墙钟时间、完成吞吐量、median/p95/max。此模型是八客户端闭环重复读取，不是固定到达率的开放负载、长时间 soak 或生产 SLA；较大规模/轮数若超过现有新鲜度或请求预算，应报告失败，不刷新时间戳掩盖问题。

`TG_TEST_WEB_INTEGRATION=1` 的 PostgreSQL 集成套件还覆盖交易页数据依赖：正式 CandleStore、HTTP 路由和生成 SDK 分别读取 Curve 与 Pool 成交/K 线，再调用实际 validateTradePage/validateCandles。验证 Curve 净 Quote 金额、手续费/税、Pool 内部奖励兑换及 caller 非已认证钱包口径；24 小时中首桶含一笔成交，其余 23 桶 OHLC=null/零成交量；用另一市场身份校验相同响应必须失败。将回执覆盖置为不足后，两种市场的两类接口均要求 503，恢复后同样数据重新通过。时间窗口与回执变化仅在隔离数据库测试夹具内安排；不是正式 trade.html、浏览器迟到请求或外部 RPC 联合验收。

交易页在渲染前对成交方向/分类使用严格字符串枚举校验，拒绝 `side: ["buy"]` 或数组形式的 classification；不再通过 String() 隐式转换接受错误 JSON 类型。回归覆盖两个方向与三类分类，真实 Curve/Pool HTTP 响应继续按原协议验证。


候选收益覆盖补充：`candidate-inspect --verify-assets-rpc` 在 Gauge 仓位核对后，将候选中每个市场的 Quote/Meme 可领取金额分别求和，要求不超过同块 FeeVault Staker 负债桶。允许精度尾差等余量；不允许跨市场或借用其他角色负债抵补。该检查拒绝重复或错配仓位与非规范/溢出金额，不增加 RPC 调用；仍不证明全部收益历史或授权自动发布。


持久候选费用检查：`ObservationStore.LoadCandidateSet` 现在要求每个市场 Quote/Meme 的 `feeLiability` 与各资产 `feeSolvency` 完整，重新计算桶与预留合计、跨市场总负债和余额覆盖，并核对候选 Staker 收益上界。摘要与镜像一致但财务不一致的观察同样失败；历史缺少这些字段须补齐观察后重试，不能仅修改 checks 标记。此本地一致性门槛不替代 RPC 身份/状态核验与独立历史证明。


`TG_TEST_CREATOR_CANDIDATE=1 TG_TEST_DATABASE_URL=... go test -race ./internal/readmodel -run '^TestCreatorCandidatePostgres$' -count=1` 现同时覆盖含市场、账户、Gauge 仓位与 Creator epoch 的 `LoadCandidateSet` 完整数据库读取。夹具持久化 ABI 日志、回执承诺、发现和投影输入，验证来源及费用故障恢复；使用隔离临时数据库并自动清理，不代表真实链上的完整收益历史验证。


Holder 候选另需 `treasurySolvency`：连续分红/epoch 未付收益按 distributor+Quote 汇总，与已知市场合计一致且不超过总 Quote 负债；余额须覆盖 Quote 和 Service 两类总负债。缺失、重复、错配或金额错误使 `LoadCandidateSet` 失败。允许其他 Treasury 市场的额外负债，但不把局部覆盖提升为完整历史对账。两种模式的 golden 和 PostgreSQL 余额故障恢复纳入 readmodel 专项。


Holder 候选时间同时受当前 canonical 区块约束：lastFundingAt、activatedAt、requestedAt 不能来自未来；epoch 的 sourceBlockNumber 不能超过候选高度。未来领取/发布/确认截止时间仍合法。本地 Creator PostgreSQL 专项已包含两种 Holder 模式的完整 `LoadCandidateSet` 回放、余额/库存/时间故障及恢复；不等同于 RPC 或完整链上历史认证。


Holder epoch 来源块现在通过单次批量 SQL 绑定到同事务的 canonical/finalized/receipts_verified 历史；缺失、孤块或高度/哈希冲突使候选不可读取。重置后的 NONE epoch 必须清空来源，已请求的 epoch 保留非零来源哈希。历史起点早于当前本地库存时需要补齐已核验历史，不可仅改字段绕过检查。该门槛不提供外部状态根证明。


Holder epoch 候选还按激活时间与观察周期重新计算当前编号、每个窗口；已请求状态不能早于窗口结束。周期编号/窗口错配、提前请求和算术溢出使读取失败，未请求的当前周期合法。该检查复现时间表算术，不替代部署周期/延迟参数的 RPC 身份核验。


Holder epoch 候选状态还与 Treasury 生命周期约束交叉检查：请求、pending、claiming、两种 rollover 和 reset 的 root/领取/时间字段必须相容。空资格 root 必须使用合约规定的哈希。自然到期但尚未执行 expire/finalize/rollover 的状态仍保留，不由后端自行推进链上状态。


Treasury 服务费可使用非 Quote 资产：候选要求历史非零服务费涉及的资产具备偿付记录，并按 REQUESTED/ROOT_PENDING 合计检查服务费负债下界。已结算并提现的历史费用可对应零负债。观察器返回的当前额外服务费资产也会校验，不能因尚无 epoch 而误拒；当前费用配置本身的库存完整性仍待单独绑定。


Epoch Holder 负债与 FeeVault Holder 桶现在按市场及 Quote/Meme 精确核对：全部 epoch 的 holderQuoteLiability/holderMemeLiability 合计必须分别等于对应 Holder 桶。该等式不适用于 Staker 的取整 claimable，也不用于连续分红模式；仍需独立历史证明才能授权自动财务发布。


当前 Treasury 费用策略现由同块观察保留到 EpochHolderCandidate（currentServiceFeeAsset/currentServiceFeeAmount），并参与 RPC 比较。金额为非零 uint128；同分发合约策略必须一致，当前资产与历史资产偿付记录均需齐全。缺少这两个字段的旧观察需重新补读后才能读取候选；不新增迁移或前端 OpenAPI 字段。


Holder epoch 的 claimedAmount 现在需与回放 TreasuryClaimed 历史按分发合约/市场/epoch 的合计相等。缺失领取输入、重复叶子/账户、错误分发合约或未知 epoch 都使候选读取失败。该门槛依赖已有回执库存和部署身份检查，不能代替独立全历史认证或授权自动发布。


连续 Holder 候选的 funded、paid、lastFundingAt 现在需要匹配 HolderStreamFunded/HolderStreamClaimed 回执输入历史。领取不能超过已回放注资，资产和分发合约必须一致；支持同账户多次领取。该历史一致性检查沿用已存回执及输入库存的信任边界，不自动授权财务发布。


连续 Holder 历史还必须包含 HolderStreamMarketRegistered，绑定候选 Meme/Quote；未注册先注资/领取、重复注册或身份错配均失败。注册后零资金合法。此检查依赖已存回执与既有 emitter 认证范围，不替代部署身份/RPC 完整核验。


Holder 历史边界补充：连续注资的 end-24h 必须匹配其实际 canonical 回执区块时间；epoch 领取 leafIndex 必须小于候选 leafCount。这些检查绑定事件与区块/root 元数据，不替代 Merkle proof 或完整历史认证。


epoch 历史领取时间需落在 finalizeAfter 至 claimUntil 的闭区间内，使用领取事件实际 canonical 区块时间；向分发合约自身领取也会拒绝。确认下界不等同于实际 RootFinalized 时间，完整 root 事件顺序仍需进一步核验。


Holder epoch 领取前还必须回放到 RootFinalized；候选 root/claimUntil 与实际确认事件绑定，确认时间不早于 finalizeAfter。仅有允许确认的时间门槛不能替代实际确认。请求、发布、取消全链路和 Merkle proof 仍需进一步验证。


Holder epoch 候选现在要求 RootPublished → RootFinalized → TreasuryClaimed 顺序。发布元数据与候选逐项匹配，确认不得早于审核截止；PendingRootCancelled 使待确认发布失效，并允许后续重新发布。空资格 root/截止使用合约约束。请求、过期、退款及重新申请的完整历史、部署审核参数和 Merkle proof 尚未验证，publicationEligible 保持 false。


Holder epoch 发布前必须回放 RootRequested，候选请求字段绑定实际事件和申请区块时间。RootRequestExpired 仅允许未发布且严格过期的同一申请者；取消/过期后必须重新申请才能发布。服务费历史资产也受请求事件约束。退款 credit/提款、部署 finality 参数与申请时 source clock、Merkle proof 尚待核验，不能据此自动发布。


服务费历史另按分发合约/资产核对负债下界：申请增加负债，确认/取消/过期只转为可提款额度，ServiceCreditWithdrawn 才减少负债。拒绝尚未释放、超额或重复提款及低报负债。此项尚不认证各 beneficiary 的 serviceCredit 或真实资金转账；相关历史资产观察缺失时仍失败，不提升自动发布资格。


Epoch Holder 观察新增必需 rootServiceTreasury（同哈希 RPC 读取）；旧观察缺失时须重采集。服务费历史提款按 beneficiary 核对：确认收入归属金库，取消/过期退款归属申请人；提款须等于该收款人完整已记 credit。尚未逐项读取实时 serviceCredit 存储或证明资金转账，自动发布资格保持关闭。


候选额外导出本地历史生成的 serviceCredits（含已提款零余额）及 serviceCreditHistoryVerified。资产 RPC 核验在 Holder 身份比对后按同一 blockHash 读取每项 serviceCredit 并要求精确相等；4,096 项上限、缺历史标记或任何读取/余额失败均拒绝。标记仅表示本地配置范围内回放，不代表全链库存或发布许可；历史资产发现与完整对账仍待补齐。


projection-worker 从 canonical/receipts_verified 的 RootRequested 投影事实保留历史服务费资产（去重，最多 4,096 项），Holder observer 为其补读当前负债与余额。候选偿付能力库存须有请求历史依据；RPC 复核也从 serviceCredits 补齐旧资产。该覆盖仍限于已投影历史，未证明未知 Treasury 或完整链上库存，不提升 publication 资格。


Epoch Holder 观察必须包含五项 Treasury immutable 时序参数。候选回放按实际参数校验申请等待、发布窗口、审核期及领取窗口，包含已取消/过期的历史尝试；参数参与同哈希 RPC 复核。finalityDelayBlocks 的实际请求/source 区块差值仍待绑定，不提升发布资格；旧观察缺参数须重新采集。


每次 RootRequested 的 canonical receipt 区块号必须满足 sourceBlockNumber=requestBlock-finalityDelayBlocks，且 requestBlock 大于该延迟；来源 hash 在候选同事务中核对 canonical/finalized/receipts_verified 历史。取消/过期不会删除历史来源核验。此项仍是本地历史一致性，不是完整 EVM 或 receipt trie 证明。


candidate-inspect --verify-assets-rpc 现在要求已发布 epoch Holder root 对应 treasury_candidates 产物，并核对完整 claim-domain/数据集以及回放领取的叶子和 Merkle 证明；缺产物或差异即失败，检查后再核验 finality。候选导出 treasuryClaims/treasuryClaimHistoryVerified，RPC 验证成功输出 treasuryDatasetsAtCandidateVerified。此项不证明 Transfer 历史完整或生产可发布，相关 full reconciliation/publication 标记保持 false。


Treasury Candidate 保存及读取现会在同一数据库事务内重读并比较完整既有 journal Transfer 输入/证据，而非仅检查摘要、重算结果与来源块。历史缺失或差异会阻止保存/读取；ProofService 和候选 CLI 的现有读取路径同步受保护。此项仍是本地历史一致性，不能替代独立 receipt-root 证明或生产大历史负载验收。


`candidate-inspect --verify-assets-rpc` 新增候选块 RPC 回执根校验：重算完整区块头 hash、全部回执 trie，并在结束时复查 canonical hash。成功标记 `candidateReceiptRootVerified` 仅覆盖当前候选块的 RPC 数据，不认证独立共识、transaction trie 或数据库/历史 journal 完整性；历史 `ReceiptRootVerified` 和发布资格保持原状态。预算为 16,384 笔、累计回执 JSON 64 MiB 及既有 CLI deadline，超限失败。可设置 `TG_TEST_RECEIPT_ROOT_RPC` 运行只读 `TestReceiptRootLive`；默认跳过联网测试。


索引器入口已使用 `chainrpc.RootVerifiedClient`：现有 observation 的有序回执摘要必须与完整 header/receiptsRoot 验证所得集合一致，才能进入原 journal 入库事务。RPC 前后返回不同数据会失败且不推进 checkpoint。此约束适用于新索引及实际重观察的块；旧 `receipts_verified` 记录仍不等同于已补做回执根验证。双次读取受现有 60 秒单步 deadline 限制，历史补验及吞吐验证尚待完成。


迁移 `00067_receipt_root_evidence` 持久化 `receipts_root/root_receipt_set_hash`，旧记录默认无证据。`cmd/indexer` 开启 `RequireReceiptRoot`，自动优先逐块补验 canonical 历史缺项，保留日志/摘要冲突时失败的规则；补验不移动链尖检查点。运行新索引器前须应用新迁移。下游全历史 root 覆盖门槛仍待接入，不能仅凭字段存在宣称完整财务验证通过。


Treasury 历史加载现在逐块重算实际回执集合，与持久化 root 证据及数量匹配，包含空块。仅整个创建至 source 范围覆盖时设置 `journalEvidence.receiptRootVerified=true`；部分覆盖仍为 false，证据与数据矛盾则失败。`candidate-inspect --verify-assets-rpc` 拒绝缺此标记的已发布 epoch 产物。旧不可变产物在补验后需重新生成保存；此检查不扩大为请求/领取全历史或独立共识验证。


候选导出包含 `historyStartBlock` 和 `historyReceiptRootsVerified`：后者仅在配置起点至候选块的全部持久化回执根证据及实际回执/日志比对通过后为 true。`--verify-assets-rpc` 现在强制要求完整区间覆盖；只有当前区块回执根通过仍会拒绝。普通导出保留未验证状态，发布资格与独立共识标记不提升。


`candidate-inspect --once --verify-assets-rpc` 另检查历史起点：数据库导出 `historyStartHash`，RPC 核对起点及父块，并要求 manifest 全部地址在父块的运行代码为空。历史状态不可读或已有代码则失败；genesis 起点核对 genesis 身份。成功输出 `historyOriginChecked`，此项不排除更早销毁/重部署，不能替代完整部署历史认证。


回执根验证最多八路并发获取回执，保持区块交易顺序，累计 JSON 上限 64 MiB；任何读取失败、超限或取消均拒绝整个结果。该改动减少串行网络等待，仍沿用既有 deadline，不表示生产吞吐已经验收。


Treasury 批准审核要求候选和独立 journal 重读均具备完整历史回执根覆盖，审核记录据此设置 `receiptRootVerified`。发布/确认计划同时要求候选与当前审核通过此项；旧审核缺标记须重新审核，不能凭旧批准继续。独立审核身份、数据集与历史完整性声明仍是必需条件。


具备历史回执根覆盖的 Treasury 候选，在保存/读取时还会检查 `Request.BlockHash` 对应请求状态观察块的完整回执集合与 root 证据。缺失或数据差异会失败；该观察块不一定是最初 `RootRequested` 事件发出块，不能混同两种证明范围。


`GET /v1/users/{address}/accounts` 返回每个资产一次的 Vault 本金（deposited/allocated/free），包含无市场仓位账户，支持 revision/limit/cursor。已发布快照须显式提供经过一致性和来源检查的 `accounts`；旧快照缺字段或同步不可用时返回 503。OpenAPI 2.24.0 与生成客户端提供 `listUserAccounts`。`/v1/updates` 已包含 accounts 失效类别，reset 和客户端恢复将四类快照数据全部失效；自动账户快照生产及钱包页面尚待接入。服务端与客户端须配套升级，旧三类 reset 验证器不兼容 accounts。

账户自动补入：受信生产者调用 `publish-snapshot` 时可设置 `TG_PUBLISH_ACCOUNTS=true`，并提供 `TG_DEPLOYMENT_MANIFEST`、`TG_PROJECTION_START_BLOCK`。发布数据库连接需具备候选 observation/projection/journal 的读取权限。该步骤从当前候选批次生成账户数据，要求完整历史回执根覆盖、事件清单和 emitter 地址绑定，并与输入快照链/区块/配置/仓位逐项匹配。已有 accounts 不一致会拒绝，不能覆盖；随后仍执行身份补入（如启用）及原有发布检查。缺失配置或不同候选 revision 不会退回旧账户。

这只接通受信快照的账户生成入口，不将 `CandidateSet.PublicationEligible=false` 升级为可发布，不代替受信生产者的完整财务验算、独立链上验证或部署验收。生产环境不要仅凭本地候选校验设置生产者验证时间。

### Independent processing lanes

See [SERVICE_LANES.md](SERVICE_LANES.md) for the event worker/API, activity worker,
transaction resource isolation, migration 00068, environment variables and the
boundary between display facts and financially reconciled snapshots. Fast-lane
progress does not authorize settlement or replace the financial checkpoint.

发布命令在数据库连接前校验生产者验证时间、补入开关与快照格式，并响应 SIGINT/SIGTERM；数据库操作继承一分钟期限。取消或失败不会输出成功状态，但取消恰逢数据库提交时仍应查询已发布 revision 判断结果，不能把退出码当作一定未提交的证明。

持续发布入口：`publish-snapshot --watch /absolute/path/producer.json`。文件必须且只能包含两个字段：`verifiedAt`（生产者实际完成验证的 RFC3339 时间）与 `snapshot`（完整快照 JSON 对象）。生产者在同一目录写好临时文件后原子 rename 替换目标，不能分别更新时间与数据。目录及文件写权限只能授予受信生产者；此文件不是公开上传接口。

调度器每五秒读取一次，成功后记住该文件内容的 SHA-256，未变化不重复调用发布；失败记录 retry_pending 并重试，不刷新 verifiedAt。过期数据必须由生产者重新验证后提供新文件。进程重启可能重新提交同一文件，持久层仍通过不可变 revision/内容冲突校验保证幂等。SIGTERM 会取消当前数据库操作。该模式只调度受信生产者输出，不自动生成财务验证结论；没有新文件时不能维持虚假的健康快照。

`reconciliation-inspect` 的 coverage 现在包含 `completeReceiptsVerified` 与 `receiptRootsVerified`。前者表示配置范围内的回执集合、摘要和日志已完整交叉核对；后者还要求全范围存储的回执根绑定完整。两者均不能替代部署起点验证、独立 RPC/共识认证或全部费用与奖励财务验算。

费用验算内核 `internal/feeledger` 提供 `ApplyTransaction` 与 `Reconcile`。完整回执重放使用交易入口：兑换净扣减事件可能晚于 router 的新费用事件，金额边界须在交易末核验；输入须来自已认证且完整的 canonical 回执。`Reconcile` 只比较调用者提供的 feeLiability/feeSolvency 观察与事件账本，报告缺失、差异和未知条目，不验证 RPC 来源或区块绑定，也不授予发布资格。目前尚未接入数据库历史读取或发布命令。

数据库 `candidate-inspect` 候选现在包含 `feeReconciliation`：从同一数据库快照的已检查历史重放费用交易，并与同批次费用观察比较，输出 `matched`、`mismatch` 或 `unavailable`。缺少完整回执根历史、事件清单或 emitter 绑定时不会生成通过报告；重放失败不返回部分预期金额。该字段同时记录链、历史起点与末块身份。`matched` 仅表示本地已知负债与持久化观察相符，仍不验证独立 RPC 或授予发布资格；直接调用 `BuildCandidateSet` 不执行历史费用诊断。

`candidate-inspect --once --verify-assets-rpc` 现在对有市场的候选强制核验事件费用账本：要求本地 `feeReconciliation.status=matched` 及历史覆盖证据，并把其逐桶/合计预期值与新读取的同块 RPC 值比较。缺失或差异报告会使该模式失败；普通 `--once` 仍提供诊断。全链路成功且有市场时输出 `eventDerivedFeeLiabilitiesAtCandidateVerified=true`，这不代表全部奖励权益或完整财务发布资格已验证。

费用 RPC 校验可复用 `readmodel.VerifyFeeLedgerRPC`；CLI 使用相同接口。调用者必须另外认证候选来源、manifest/代码身份及比较前后 canonical 链身份。已验证 PostgreSQL 重放候选到受控 HTTP RPC 的匹配、同总额桶间差异、历史状态错误和恢复；该测试不代表外部部署节点已验收。

`feeReconciliation.creatorEpochs` 单独报告 Creator 按 epoch/资产的事件负债比较；父级 `status=matched` 仅说明聚合费用匹配，不能替代该子报告。`--verify-assets-rpc` 现在要求 Creator 事件证据与候选逐项匹配后，再核对链上 epoch 金额、受益人和退出状态。成功且有市场时输出 `eventDerivedCreatorEpochLiabilitiesAtCandidateVerified=true`；完整财务发布资格仍不提升。

`feeReconciliation.holderEpochs` 提供 FeeVault 尚欠 Holder 金额的独立事件对账。epoch 模式按原始 epoch/资产比较；continuous-24h 使用固定 epoch 1 与 FeeVault Holder 桶，分发器待领取余额另行核算。状态可为 matched/mismatch/unavailable/not_applicable；父级聚合 matched 不能替代子报告。Holder RPC 验证门槛尚待接入。

`--verify-assets-rpc` 现已强制执行 `readmodel.VerifyHolderEpochRPC`，按所有已配置 Holder epoch/资产直接读取同块 FeeVault `holderLiability`，连续模式也读取固定 epoch 1。缺失/差异子报告或 RPC 金额不一致会拒绝。全链路成功且有 Holder 市场时输出 `eventDerivedHolderEpochLiabilitiesAtCandidateVerified=true`；仍不代表完整财务发布资格。

连续 Holder 模式已通过 PostgreSQL 收支重放到受控 HTTP RPC 的联合验收，覆盖计提、Meme/Quote 兑换、转入分发器、剩余 FeeVault 负债、差异及恢复。该夹具保留分发器未支付资金，未模拟完整流释放后的用户领取；epoch Treasury 模式的数据库联合收支验收仍待完成。

Treasury epoch 模式也已通过 FeeVault 计提/兑换/完整转出到 PostgreSQL 候选及受控 HTTP RPC 的联合验收：历史 epoch 的 Treasury 资金与后续 epoch 的 FeeVault 负债分别保留。该场景停留在未请求根状态，根审核/发布/领取的完整联合生命周期和真实节点验证仍待完成。

### Trace RPC diagnostics

`go run ./cmd/trace-inspect --once CHAIN_ID TRANSACTION_HASH` probes one trace using `TG_HOLDER_RPC_URL` (fallback `TG_RPC_URL`). It checks network identity and reports only safe error categories/root type; it does not authenticate transaction history or authorize publication. See [operations guide](../../docs/operations/TRACE_RPC_DIAGNOSTICS.md).

### Holder replay worker

`holder-seed --initialize REQUEST.json` authenticates an explicitly selected finalized deployment block before creating a checkpoint. It requires the token to be absent on the parent block, binds token/Distributor/Factory runtime hashes, verifies the complete transaction and receipt roots, requires one constructor mint followed by the matching Holder registration in the same successful transaction, rebuilds all block-local balances, and reconciles every account plus the zero reward state against hash-pinned calls. Same-block funding, burn, missing accounts, inconsistent exclusions, or a canonical fence change fail closed. The seed evidence remains `historyVerified=false` and `publicationEligible=false`. See [seed guide](../../docs/operations/HOLDER_SEED_AUTHENTICATION.md).

`holder-replay-worker --once SCOPE.json` validates the persisted head and advances at most one finalized child block. `--run` repeats the bounded step. `--audit` streams the complete persisted revision chain from its authenticated seed inside a repeatable-read transaction, replays the retained raw transaction/receipt-root/seed-read/trace evidence offline, then reconciles the head against RootVerified hash-pinned state. Migration 00072 stores one immutable evidence package per revision (up to 384 MiB) alongside the 5 MiB checkpoint payload; there is no automatic retention or deletion. It uses `TG_HOLDER_REPLAY_DATABASE_URL`, `TG_HOLDER_REPLAY_RPC_URL` (or `TG_RPC_URL`), and optional `TG_HOLDER_REPLAY_PAUSE_MS=0..60000`. It never initializes a seed, skips a block, signs, broadcasts, publishes a snapshot, or changes either eligibility flag. Retained raw evidence improves audit replay but does not provide independent consensus or complete-history proof; both eligibility flags remain false. See [operations guide](../../docs/operations/HOLDER_REPLAY_WORKER.md).

### Explore USD rankings

`GET /v1/markets` accepts `sort=volume24hUsd_desc` and `sort=marketCapUsd_desc`. The Go API anchors the 24-hour window to the requested finalized snapshot, aggregates external executions only, and converts every market through the fresh `TG_DISPLAY_PRICES_CONFIG` reference whose token address exactly matches that market's Quote Token. Market cap uses the baseline total supply and the latest finalized execution price inside that same 24-hour window. The complete enriched directory is cached by snapshot revision so cursor pagination keeps stable ranking keys.

Missing, stale, duplicate, or address-mismatched USD references produce nullable metrics and sort last. A USD sort returns `503 market_metrics_unavailable` when no comparable value exists. These figures are display and directory-ranking data; they never enter transaction quoting or settlement.

### Token detail data adapter

`GET /v1/markets/{marketId}/detail?period=1D` returns the frozen frontend statistics, chart, trades, holders and cumulative fee credits. It reads fresh scheduled Dune results first, then fills missing sections from verified finalized analytics; unavailable sections remain null. Testnet defaults to `TG_TOKEN_DETAIL_SOURCE=indexer`, which never initializes Dune even if credentials are present. Explicitly set `TG_TOKEN_DETAIL_SOURCE=dune-first` and configure `TG_DUNE_DETAIL_QUERY_ID` and `TG_DUNE_API_KEY` together on the server to enable the five-minute cache refresh. Requests never execute Dune SQL. The API also requires a published synchronized read model and the existing analytics manifest/history coverage.

See [data contract](../../docs/planning/TOKEN_DETAIL_DATA_CONTRACT.md), [testnet configuration](../../docs/planning/DUNE_TESTNET_SETUP.md), and [SQL/upload workflow](../../docs/dune/README.md). Dune credentials, upload jobs and a saved deployment-specific native query are operational configuration, not supplied by local tests.

Reward conversion update (OpenAPI 2.29.0): a future raw exit request produces `raw_exit_requested` with conversion candidate amount zero immediately; raw token claims still wait until the exit time. Mature exits remain `raw_exit_ready` in reward records and `raw_exit_matured` in conversion observations. This conservative worker policy also skips requested exits on older FeeVault releases.
