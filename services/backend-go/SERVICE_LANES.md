# 独立服务通道与运维（2026-09-07）

此改动针对服务端处理隔离；没有修改合约、资金分配或主前端的发布配置。RH 4663 仍为最终生产目标，当前链上验证只在 Arbitrum Sepolia 421614。

## 运行划分

| 通道 | 命令 | 数据/权限边界 |
| --- | --- | --- |
| 统一原始采集 | `bin/indexer --run` | 记录区块、日志和回执；负责规范链、最终确认及完整性 |
| 实例发现 | `bin/discovery-worker --run` | 认证 Factory/Registry 创建的市场实例 |
| 快速事件 | `bin/event-worker --run` | 独立 `event_projection_*` 表、检查点、版本与 advisory lock；无资金核验输出 |
| 快速只读接口 | `bin/event-api` | 独立进程、2 个 DB 连接、4 个 HTTP 并发；`GET /events?limit=50` |
| 用户活动 | `bin/activity-worker --run` | 独立通道锁，写入已有活动批次与记录；不等待重型投影进度 |
| 重型状态与资金核验 | `bin/projection-worker --run` | 保留原本金、负债、偿付能力和连续奖励状态核验 |
| 用户交易回执 | 主 API `/v1/transactions/{txHash}` | 原本独立于重型投影；新增独立 2 个 HTTP 槽、2 个 DB 连接和可选 RPC |
| 统计/历史查询 | 现有 analytics 接口 | 不再占用交易回执的 HTTP 与 DB 槽 |

同一条链共用可信的原始日志，不为每个业务重复扫链。快、慢检查点绝不互相替代。快速事件表不会被 `publish-snapshot`、奖励读取或签名器视为金融核验依据。

快速事件只处理已最终确认且发现流程覆盖的区块；不是 sequencer/head 的即时事件流。交易回执接口独立负责较早的执行反馈，保留原状态确认语义。

## 启动与资源隔离

先构建 `go build -trimpath -o bin/ ./cmd/...`，使用迁移账户执行 `bin/migrate up`（`TG_MIGRATION_DATABASE_URL`），新增迁移 00068。生产应先备份并按发布流程执行迁移；本次仅迁移隔离测试数据库。

所有端点和凭据使用本地环境配置，禁止写入公开文件。

- 快速事件：`TG_EVENT_DATABASE_URL`、`TG_EVENT_START_BLOCK`、`TG_DEPLOYMENT_MANIFEST`；RPC 优先 `TG_EVENT_RPC_URL`，缺省沿用 `TG_RPC_URL`。
- 用户活动：`TG_ACTIVITY_DATABASE_URL`、`TG_ACTIVITY_START_BLOCK`、`TG_DEPLOYMENT_MANIFEST`；RPC 优先 `TG_ACTIVITY_RPC_URL`，缺省沿用 `TG_RPC_URL`。
- 重型投影：现有 `TG_PROJECTION_DATABASE_URL`、`TG_PROJECTION_START_BLOCK`；RPC 优先 `TG_PROJECTION_RPC_URL`；`TG_PROJECTION_PAUSE_MS=0..60000` 可在持续回放每步后让出资源，默认 0。
- 交易回执：保留 `TG_TRANSACTION_STATUS_MANIFEST`；可独立配置 `TG_TRANSACTION_DATABASE_URL` 和 `TG_TRANSACTION_RPC_URL`。未配置时沿用主库/RPC，但仍使用独立数据库连接池。
- 事件接口：`TG_EVENT_DATABASE_URL`、`TG_DEPLOYMENT_MANIFEST`、可选 `TG_EVENT_HTTP_ADDR`，默认仅监听 `127.0.0.1:18562`。
- 起始区块需与实例发现配置一致。`--once` 用于有界检查，`--run` 用于受进程管理器监管的常驻服务；不要同时运行多个历史 activity backfill 入口。

**多个 URL 使用同一供应商账户时仍可能共用配额。** 真正的资源隔离需要独立 RPC 配额/端点、进程 CPU/内存配额和数据库资源预算；代码不会自动购买或提高供应商配额。给实时通道预留容量，历史投影设置限速。所有签名任务仍需统一的 nonce 协调，不因服务拆分新建重复签名队列。

数据库角色：事件 worker 仅应获得 raw/discovery SELECT 和 event_projection_* 写权限；event-api 仅 SELECT。活动 worker 写 user_activity_*。各通道不应使用生产数据库超级用户。本次临时数据库的测试账号不代表生产权限验证通过。

## 接口语义

`GET http://127.0.0.1:18562/events?limit=100` 返回最新的至多 100 条事件事实，不是完整分页历史，也不是资金余额接口。固定字段：

- `displayOnly=true`、`financiallyVerified=false`；只有对应金融通道核验后的数据才能支持资金操作。
- `indexedThrough`、`blockHash`、`finalizedThrough`、`lagBlocks` 明确标示该通道覆盖进度。
- `sourceObservedAt`、`stale` 标示原始采集是否超过 120 秒未更新；不会刷新一个本来已过期的时间来假装实时。

此接口独立于现有 OpenAPI 主快照接口，暂仅内网/本地访问；前端若接入应通过网关并保留显示层与交易执行数据的类型隔离。本次没有把主前端自动切换到该接口。

## 批处理与安全

每次最多推进 256 个无相关候选合约日志的连续区块。候选包含核心合约、区间内已认证发现的实例及历史股票 Vault 注册地址；候选仅决定是否进入严格核验，不授权事件。碰到候选日志立即停止批次，按原身份核验与事件顺序处理。

始终检查源区块规范性、回执验证、连续父哈希、发现范围与 finalized 上界；提交前直接读取 RPC 检查 chainId、最终目标区块哈希和时间。不能跳过有业务日志的区块，也不在快速通道推导无事件时的奖励释放或质押状态。

资金核验与用户活动仍保留历史读取成本。后续应单独评估按市场/账户调度重型观察、持久化恢复快照与高密度事件吞吐；本次没有把这些尚未验证的变更混入金融数据发布。

## 本次证据与剩余验收

`outputs/reviews/continuous-service-2026-09-07/event-lane-sample.json`：真实历史从 306128280 之后推进到 306129128，处理 12 个协议事件，包含创建及原子购买；原始采集/发现此前已完成，此测试不衡量端到端采集耗时。

`event-lane-isolation.json`：金融投影仍为 306128259，4 个观察批次和本金检查点未改写；事件接口独立返回事件，旧源数据明确 `stale=true`。

测试覆盖独立 HTTP 并发、批次事件边界、不相关日志过滤、缺块、重组、finalized 上界、金融权限标记以及 PostgreSQL 迁移。生产高负载、RPC 限流、多服务资源压测、实时前端接入与完整资金联测仍需独立验收，不能据此宣布生产就绪。

## Fee / Holder 分组核验（00069）

新增 `TG_SCOPED_OBSERVATIONS=1`，接入现有 `projection-worker`。默认关闭；当前隔离测试环境启动脚本默认开启，可显式设为 `0` 回退。先执行迁移 00069。回退只关闭开关，不需要删除队列表；已完成的正常金融检查点继续有效。

这一步是重型进程内的有界并行任务池，不是新增独立守护进程。每个资产依赖组分别执行 Fee、Holder 观察，最多两个任务并行，使用独立的 2 连接队列池。`TG_OBSERVATION_RPC_URL` 可配置独立的 archive RPC 配额，未设置时沿用投影 RPC。每个任务内部沿用已有批量读取与哈希固定机制；两个任务的 RPC 并发可能叠加，仍需预留供应商配额。

- 共享 quote / meme 资产的市场形成连通组；共享股票 asset UID 也保守合并。不能为提速拆散同一种资产的负债求和。
- 历史服务资产没有市场归属信息时，全部合并，保留旧退款核验边界。
- 当前仅拆 Fee / Holder 阶段。账户本金、Gauge、Vault、配置和最终金融发布仍走完整流程；未实现账户级独立发布或历史 creator epoch 分页。
- 队列键绑定算法版本、部署清单、链、区块哈希/时间、市场和历史资产输入。每个任务成功后独立落库；主金融事务失败不回滚已保存的任务结果。
- 单任务上限 45 秒，租约 60 秒。失败按尝试次数退避 1–30 秒；退出或超时遗留的租约可以接管，generation 防止旧执行者覆盖新结果。每轮处理其他任务后返回 `waiting_for_observations`，不产生部分金融快照。
- 所有预期任务成功后才合并，拒绝不同区块/清单、冲突重复记录、损坏结果。最终提交仍执行主 RPC 的 chainId / 区块哈希 / 时间检查。金额和原检查标志原样保留。
- 缓存不是审计账本或资金数据源。每轮最多清除 100 条超过 24 小时且无有效租约的缓存记录；删除后必要时重新计算。主历史观察与审计记录不受影响。应监控表大小；清理吞吐不是无限的。

生产数据库角色需为重型投影增加该表 SELECT / INSERT / UPDATE / DELETE 权限；不要向 HTTP 或签名角色开放写权限。队列中的摘要用于绑定和损坏检测，不能防御拥有数据库写权限的攻击者。

已有 `rpcReads` 统计只覆盖主读取会话，不包含任务池自己的读取会话；`feeHolderWork` 是该阶段墙钟耗时。运维应同时监控供应商用量、队列 state / attempts / retry_after / lease_until。持续超时需进一步拆分读取或调整资源，不能忽略未完成任务发布财务数据。

验收证据见 `outputs/reviews/scoped-observations-2026-09-07/REPORT.md`。公开链只读复验：在项目根目录运行 `python3 tools/service-integration/test-scoped-observations.py`，需要当前隔离数据库、可创建临时数据库的测试权限及本地 archive RPC 配置；测试只在临时库中创建和删除队列表，不签名、不广播。
