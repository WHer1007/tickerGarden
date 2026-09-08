# 按需事件读取

`TG_EVENT_READ_MODE=on-demand` 在 Read API 注册 `GET /v1/events?limit=50`。
默认 scope 取部署清单的项目合约（排除共享 PoolManager）。`TG_EVENT_START_BLOCK`
必须是该独立版本的业务起点。此模式只读取本地部署清单，不重新核查部署。

## 请求与缓存

- 启动不请求 RPC。没有页面请求，不刷新区块头或日志；已入库任务可以继续处理。
- 页面先返回本地记录。缓存超过 20 秒后，合并同一 scope 的并发请求，异步补读。
- 每次补读最多执行 30 秒，获取一次 finalized 目标，按 512 区块范围调用
  `eth_getLogs`，强制合约地址、事件 topic 和起止高度。不会逐块读取头、回执或运行时代码。
- 空范围持久化到 `demand_event_ranges`，与 `read_through` 在一个事务内提交。
  重启从检查点后续读，已提交范围不重读。RPC 成功但数据库提交失败时可能安全重试。
- 全部链请求经过部署环境配置的共享 CU 网关。当前独立联调使用 localhost:18570，
  总预算 10,000 CU/s；该预算是上限，不是目标流量。

## 队列

日志先写入持久化 `demand_event_jobs`，读取器不等待事件处理。
4 个本地 worker 用独立锁处理不同 scope，同 scope 按区块、交易、log 顺序处理。
失败头任务最多重试 5 次，随后保留 failed 状态；后续任务不能越过它。
短事务原子提交事件结果和处理检查点；RPC 调用不占用事件处理事务。

协议共享模块用同一 scope 保证依赖顺序。Factory MarketCreated 创建本地市场 scope，
只加入该市场 token 和 curve，从创建区块开始；直到该市场页面通过
`?scope=<协议scope>:<marketId>` 请求时才查询。共享 gauge 保留协议 scope。
网关将可信 Factory 产生的子合约范围持久化，重启不重新查询创建历史。

`observedThrough` 是日志读取进度，`indexedThrough` 是处理进度。
`processing` 和 `stale` 保留未完成/过期状态，空结果不代表链上已完成验证。
此接口始终 `displayOnly=true`、`financiallyVerified=false`，不产生结算快照，
不改变交易授权、报价或财务证明的信任条件。

## 时效边界

已最终确认的历史与 30 秒内交易展示是不同要求。若节点 finalized 时间落后，
本接口保留 stale=true，不能据此宣称成交列表满足 30 秒墙钟延迟。
低延迟交易应使用单笔回执或明确标记可回滚的 latest 观察，不能把 finalized 改名为实时。
当前实现尚未替换前端成交列表/持仓统计的原 Read API 数据源。
Dune 详情统计改为页面触发、异步刷新，10 分钟缓存，仍执行原有 20 分钟源数据过期条件。

## 本地验证

普通检查：`go test ./...`。
队列并发、重启、失败顺序的真实 PostgreSQL 检查：设置 `TG_TEST_DATABASE_URL`
后运行 `go test -race ./internal/demandevents`。测试仅创建和清理自身唯一命名数据库。

## 独立联调 head 模式（2026-09-08）

`TG_EVENT_START_POLICY=latest-on-first-request` 创建独立 `:head` scope。首次页面请求只查询当时最新的一个区块；启动本身不发 RPC。后续范围从持久化检查点增量读取，head 缓存为 10 秒。返回 `finality=head`、明确 `historyFrom`，不填写 `finalizedThrough`。必要时检查最近观察锚点处理重组，重置展示窗口，不进入金融快照路径。

前端已通过静态部署配置和 direct-chain 交互与历史快照解耦。当前启动及验证记录见 `outputs/reviews/frontend-independent-2026-09-08/DIRECT_INTEGRATION_RESULT.md`。上文“尚未接入”描述仅适用于此前 finalized 展示接口。
