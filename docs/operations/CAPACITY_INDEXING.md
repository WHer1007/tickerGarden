# 日常规模索引与发布运行要求

本轮本地基准人口为 **20,000 未毕业 + 1,500 已毕业市场**。功能与容量证据见 `docs/reviews/CAPACITY_OPTIMIZATION_REPORT_2026-09-14.md`。这不是 RH/Vercel 实际部署验收。

## 执行顺序

1. 事件：WSS 提醒 + HTTP 完整范围补偿。Relay 的 `last_block` 只在完整 HTTP 扫描后推进；单条 WSS 日志不会宣称整块完成。同块断线也回扫，原始日志与 removed 消息分别幂等入队。
2. 索引：市场按事件标识挑选重读对象；无 display 或有非零 staking 的市场保守重读，治理配置变更全量重读。每次最多观察 128 个市场、并发 8 个，双 RPC 在相同区块核对。暂存结果不是可读 publication。
3. 发布：完整候选经过区块最终性、完整 covered range、generation、payload/digest 和单调指针检查。市场按有效区间保存版本，仅新增/变更市场增加版本；旧 revision 可读。查询兼容视图为 `projection_read_records`，不要继续只查旧的 `projection_records` 获取最新市场。
4. 统计：交易明细及按区块哈希、时间、市场、手续费资产的汇总在同一数据库事务维护。修改/删除明细相应调整汇总；读取只接受 canonical/finalized 的区块。Holder 余额仍从 Transfer 回放并核对供应量，不能用统计估值替代资金核对。
5. Holder：只观察本次奖励事件涉及的市场，连续空区间不逐市场读 RPC。`projection-continuation` 通过可靠任务队列续跑最早未完成候选，完成的 scope 不重复处理。续跑也检查重组；失效 generation 的候选不可发布。

**周期快照发布仍禁用。** 手动准备、签名、发送与回执对账的授权边界不变。本次没有创建定时签名任务。

## Relay 参数

- `CHAIN_RELAY_PUBLISH_CONCURRENCY`：默认 8，允许 1–32。提高前需检查队列/RPC 配额，不能直接按 CPU 数扩张。
- `CHAIN_RELAY_RECOVERY_OVERLAP_BLOCKS`：默认 12，重连及周期对账覆盖同块缺口。HTTP 补偿与下游双 RPC 最终性校验职责不同。
- 订阅按地址与 pool ID 分片，每片最多 500；本地日常规模约 90 个订阅。真实提供商的订阅数量、日志查询和吞吐配额需另验。
- 保留 `CHAIN_RELAY_MAX_BACKFILL_BLOCKS` 补偿范围保护。超出范围时需受控补历史，不能静默跳过。
- `/healthz` 暴露 pending、dead、oldestPendingSeconds、publishConcurrency。dead 非零或最老积压超过 300 秒不健康。WSS 连接正常不等于发布健康。

浏览器依然使用 `/v1/updates` 的 HTTP 版本轮询（常态 5 秒及退避）；没有新增浏览器 WebSocket/SSE。API 对同时进行的相同公共统计/版本请求做有界合并，完成立即移除，不缓存旧最终性结果。每个 Read API 实例对全局 Holder、协议、overview、series 和未指定市场的全量统计使用 1 个执行槽与最多 8 个不同候选排队；同 key 共享进行中的工作，超限返回 503。指定市场的统计使用独立的 8 槽 / 128 待处理队列。它不是跨实例限流，排队时间计入 HTTP 延迟；发布最终性在实际执行时读取。图表按需刷新与旧响应隔离保持；翻页进行中固定原 revision，后台版本变化不能取消已发起的翻页。

## 数据库迁移与上线边界

`services/backend-ts/packages/db/migrations/0005_capacity.sql` 必须在新运行时代码之前成功应用。新代码依赖视图、市场版本表、暂存表和交易汇总表。

- 迁移角色须能安装 `pg_trgm`（或由管理员预先装在 public schema）。运行时 Read API 不需要扩展管理权限，也不获得暂存观察表权限。
- 汇总历史回填和 trigger 安装间持有 `market_trades` 的 SHARE ROW EXCLUSIVE 锁，阻止并发写穿透回填窗口；允许普通读取。安排受控迁移窗口并确认现有历史量、锁等待和备份。
- 迁移保持事务原子性。失败回滚，不能手工标记已完成或只创建部分表。生产历史回填时长尚未验证。
- Runtime SQL 保持 5 秒 statement timeout。事务的总墙钟时间可以超过 5 秒，报告中的投影耗时与单条 SQL 超时不是同一指标。
- 核对市场总数/阶段数、完整分页、latest revision/generation、供应量、原始交易与汇总、孤块失效、断线补漏后才切换流量。

未在本轮执行远程迁移或部署。若后续授权 Vercel 部署，仍必须显式 `--regions sin1`，通过实际函数 region 检查后才能 alias/promotion。

## 仍需监控的成本

市场 publication 仍计算完整 manifest 并全量比较一次持久化证据；JSON 处理/初始市场发现依然随市场总量增长。首次 21,500 市场观察需要 168 个批次，不能按单请求完成估算。活跃 staking 或全局治理变更会增加重读量。统计汇总按市场/区块/时间保留精确边界，在本轮稀疏交易分布中行数可能等于原交易数，不宣称压缩率。50,000/100,000 市场、更长历史、24/72 小时持续运行以及真实提供商限流仍需专项验收。

空闲 PostgreSQL 连接出错时记录脱敏错误码，由连接池移除失效连接；下一次请求重新获取连接。事务失败不自动重发，ROLLBACK 失败时销毁连接并保留原始错误，避免自动重复资金相关写入。

## 第二阶段派生索引与增量发布

新增数据库迁移 0006–0011，先迁移再升级读 API / Pipeline。迁移需在备份副本上预演源表回填，评估锁持有时间；回填不是后台定时发布。升级市场观察算法后会执行一次完整观察，后续使用持久工作列表恢复。完整发布检查点之间最多保留 256 个增量；发布摘要绑定父修订/摘要、变动条目及覆盖证据。原始日志和不可变版本保留。

本地全量核对命令（使用现有本地 DB 配置，不输出凭证）：

```sh
TG_DATABASE_SCHEMA=<local_schema> node --experimental-strip-types services/backend-ts/scripts/audit-market-publication.ts '<block>:<hash>'
```

统计缓存是可删除的展示派生数据；Read API 只对 `statistics_result_cache` 增加 DML 权限。缓存源版本在源写入事务内推进，generation 或 canonical/finalized 不匹配时返回 unavailable。缓存过期不是结算或签名依据。新缓存不用于领取、余额授权或快照签名。

Holder 资产映射和余额引用计数使用每部署一把事务锁，避免首次发布时产生随市场数量增长的 advisory locks。源交易更新对其区块加共享锁，即使区块尚未最终确认，也会与并发最终化串行，防止回填漏计。链重组时已计入时间桶的原始 rollup 会反向扣除。

Relay 原始事件继续逐条持久化；每批最多 256 条同块/removed/head 的记录共用一次队列唤醒，已封装批次重启后保留原幂等键。下游仍通过独立 RPC 完整读取并核对区块范围，不以代表事件替代事件账本。停用/回滚时必须先排空批次并确认 raw inbox 状态，不能直接删除 `chain_relay_batches`。

新一轮容量脚本使用 `TG_CAPACITY_EVIDENCE_DIR` 隔离输出，不能覆盖历史失败证据。多实例短时持续负载脚本为 `tools/full-local-integration/daily-multi-instance.mjs`；默认 120 秒，`TG_LOCAL_SOAK_MS` 可显式延长至 24 小时。它是两个本地 HTTP API 的读负载，不模拟跨主机网络、真实 RPC 配额或链上签名。

冷库执行计划验收：`phase2-cold-statistics.mjs` 在本地夹具创建无 ANALYZE 的汇总表副本，复现默认计划超时并检验全局统计事务的 `enable_nestloop=off` 设置；不修改连接池或其他业务 SQL 的计划设置，也不提高 5 秒语句时限。
