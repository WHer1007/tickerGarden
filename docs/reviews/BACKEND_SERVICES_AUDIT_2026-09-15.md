# 后端服务与部署架构审查 · 2026-09-15

本次为只读检查。审查当前 test 工作树、三个 Vercel 测试服务、DigitalOcean VPS 容器和 PostgreSQL 运行数据。没有重启服务、修改数据库、切换 Worker、重投死信或部署。前一轮前端改动保持不变。

## 当前实际部署

- VPS：通过项目专用 SSH 身份和 tickergarden 用户读取；实例元数据为 sgp1。
- VPS 运行 PostgreSQL、queue relay、chain event relay、MinIO、Caddy 五个测试容器；生产容器没有运行。
- resident worker inactive，8082 未监听；数据库 chain/content execution_mode 均为 qstash。链 generation=1、content generation=0。
- Vercel Read API / Pipeline / Content 的实际部署检查均通过，每个检查到的两项函数均在 sin1；不是仅依据 vercel.json 推断。
- Read API /health 返回 synced/finalized、46630；协议汇总当前市场数为 0。测试响应正常不能证明真实业务容量。
- VPS CPU load 约 0.23，内存可用约 2969 MiB / 总 3915 MiB，磁盘 3.9 GB / 77 GB。单次采样不能代表峰值，没有直接升配依据。
- PostgreSQL max_connections=100；样本看到 Read API 6 条空闲连接、Queue 2 条。业务角色 CONNECTION LIMIT 均为 -1；尚未形成数据库端总连接硬边界。
- 应用 jobs：chain 1128 succeeded，content 1 succeeded，无 pending/retry/dead；outbox 均 sent。外层 queue relay 留存 25 条历史 dead（HTTP 503）和 1210 delivered。不能把外层历史死信直接解释为当前丢失业务，需按 operationId 对账。
- Relay /healthz：17 sources、0 pools、1 subscription、0 reconnects/pending/dead。

## 优先级 1：执行链路和增长边界

### 回调超时与任务预算不一致

`infra/vps/queue-relay/src/server.ts:84-90` 等待 20 秒；`packages/jobs/src/index.ts:412` 的 QStash 发布也声明 20 秒。Pipeline maxDuration=300，任务 lease=290 秒，并在完整 processSignedJob 完成后返回 HTTP。

数据库 job_attempts 是“领取”和“结果”两种独立事件行。结果行 started_at=finished_at，直接相减会错误得到零。按 job_id/fencing/attempt 连接领取行与结果行后：1325 次尝试中 445 次超过 20 秒；整体均值 35.11 秒、p95 150.64 秒、最大 163.17 秒。近期 6 小时的 112 次均未超过 20 秒，均值 7.55 秒、p95 10.84 秒；历史慢任务不等于现在持续积压。

建议优先在 test 验收已经存在的 resident 模式，让 VPS worker 从同一持久 jobs 表执行链任务，保留租约/fencing/finality/reorg。这样避免把长计算置于短 HTTP 回调预算之内。若暂时保留回调模式，必须统一 relay 等待、外层租约、平台上限和任务切片预算；不能只提高某一个 timeout，也不能在未建立独立执行保证时提前 ACK。

### Principal 投影全量重放及 10,000 上限

`packages/principal-projector/src/index.ts:41-81` 在运行本金投影时读取截至目标块的全部 Vault 事件，重放全部账户/分配；随后对全部账户、分配做双 RPC getter 对账。每个账户至少三类 getter × 两个 provider，分配还需额外 getter。存在 1,000,000 日志、10,000 accounts / allocations 的硬限制。

20,000 个市场并不等于 20,000 个账户，但账户/分配总条目越过此限制会拒绝发布，不能称为已支持完整增长目标。

建议 checkpoint + 增量账本，按被事件影响的账户/分配更新；时间驱动的解锁、奖励变更需单独处理，不能只跟踪本金事件。双 RPC 在同一 finalized block 对相关对象批量核验，定期独立全量审计；全量恢复使用分页、分片和续作。不能通过删限额或删资金一致性校验解决。

### 生产单机故障域与恢复能力

测试与未来生产虽然容器、库和凭据隔离，仍计划共享同一台 VPS。主机故障会同时影响数据库、队列、上传存储和链订阅。

实测 archive_mode=off、复制连接=0，未在可见 timer 列表找到项目数据库备份任务；无法由此排除云厂商外部备份。尚缺已验证的异机备份、恢复演练及 RPO/RTO 证据。

建议生产使用独立资源；数据库优先考虑同区域托管 PostgreSQL，或先落实异机备份/WAL 归档与恢复演练。容器重启和单盘 MinIO 不是高可用。当前不需要为了低负载立即购置更大的 VPS。

## 优先级 2：资源、缓存与运维简化

1. **连接预算落实到运行环境**：当前 pg 已模块级复用并 attachDatabasePool，无需重复实现。补齐 Vercel 扩容及发布重叠的总预算、非 superuser 角色连接上限、连接等待指标。有实际连接波峰后再引入 PgBouncer；resident advisory-lock 控制连接必须直连/session pooling。
2. **Read API 重复读合并**：普通 read admission 和 updates 去重已有实现，但 trades/candles/holders/detail 等入口未统一进入相同机制。对相同部署、revision、market、分页/时间参数合并在途请求；用户范围必须进入 key。部分接口已有 CDN 缓存，不能说所有接口“无缓存”。最先优化 includeRecent/no-store 和热门交易详情的源站工作。
3. **全局 Holder 与详细统计**：共享 DB 缓存已有 15 秒 TTL，但 cache miss 会持有事务和连接计算。大规模完整排除地址响应可达 MB 级；将显示计数与审计明细分开、按需分页，保留完整性标记。Stats 主卡已使用 20 分钟 protocol snapshot，不应重新回退到访问时全量计算。
4. **Analytics 安静市场仍有全量检查**：`analytics-projector:126-136` 会锁定和检查全体 Holder snapshot，虽然无变化行已不重复写入。下一步按变化市场/策略版本筛选；策略变更和 reorg 仍应触发必要重算。
5. **持久任务保留策略**：当前应用和 relay 的完成记录、dedup IDs、尝试日志持续积累。projection_records 已约 61 MB，是最大表。建立热数据窗口与冷归档，先标明重组、审计、幂等去重需要保留的范围；不要直接删除历史事件或死信。
6. **调度收敛**：测试 VPS dispatch 每分钟、chain/price refresh 每五分钟；生产 Vercel cron 是另一运行入口。配置需要有明确环境唯一调度者，resident 模式要验证旧回调退出领取。空闲 worker/relay 轮询可考虑 PostgreSQL NOTIFY 唤醒加低频补扫；NOTIFY 只负责唤醒，持久 jobs 仍为事实来源。
7. **版本一致性**：VPS queue relay 源文件 SHA 与仓库一致；chain event relay 不同，且线上队列库没有新代码中的 chain_relay_batches 表。说明批处理实现尚不能视作线上能力；不能仅凭哈希判定新旧正确性。给 /healthz 加 commit/image digest/schema version，发布同时核对源码、镜像和迁移。
8. **可观测性**：未安装 pg_stat_statements；缺长期 p95/p99、连接等待、RPC 次数、队列最老年龄、死信对账与恢复演练指标。job_attempts 当前结构可重建耗时，但易误读，建议直接记录 duration_ms 或提供统一视图。live/ready 200 不等于数据库、RPC 和业务数据都健康。
9. **镜像与域名**：MinIO/mc 使用 latest，其他镜像使用宽泛 tag；生产应锁 digest 并演练升级回退。测试 sslip.io 可继续使用，生产需稳定自有域名和明确访问策略。

## 方案比较

| 方案 | 适合程度 | 权衡 |
| --- | --- | --- |
| Vercel Read/Content + VPS resident chain worker + PostgreSQL | 当前最值得优先验收 | 复用既有实现，减少链任务 HTTP 往返；数据库单机恢复能力仍需补齐 |
| 上述方案 + 同区域托管 PostgreSQL + 托管对象存储 | 更适合生产稳定运营 | 增加固定成本，减少备份/磁盘/数据库故障运维；需验证扩展、锁、连接模式和对象版本语义 |
| Read API、Content 全移 VPS | 有条件可选 | 靠近数据库、调度简单；同时失去当前弹性，必须补副本、限流、滚动发布和故障切换。当前没有成本数据证明更便宜 |
| 全部保留 Vercel + 托管任务队列 | 可行 | 仍要把工作切片到执行/回调预算内；托管队列本身不会消除全量重放或多次 RPC |
| Kafka/Redpanda、Kubernetes、重写 Go | 暂不推荐 | 当前低负载且没有多节点分区吞吐需求，不能解决 Principal 算法与单机备份问题 |

## 对象存储替代的兼容性陷阱

R2 有 S3 兼容 API，可作为低运维候选，但并非当前 MinIO 的直接替换：当前 getS3Object 强制读取 x-amz-version-id，MinIO 初始化也启用了 bucket versioning。Cloudflare 官方兼容表仍将 GetBucketVersioning / PutBucketVersioning 列为未实现。替换需先设计不可变内容寻址对象键、摘要校验和重试一致性；或选择经验证提供所需版本语义的 S3 存储。不要简单更换 endpoint 后发布。

参考：
- https://vercel.com/kb/guide/connection-pooling-with-functions
- https://developers.cloudflare.com/r2/api/s3/api/
- https://developers.cloudflare.com/r2/how-r2-works/

## 建议顺序

1. resident 模式测试验收、统一 timeout/lease 预算、relay 版本核对。
2. Principal 增量/续作与硬上限改造，再做含活跃账户/分配、事件和真实 RPC 延迟的容量验证。
3. 落实生产数据库恢复能力与连接总预算。
4. 热点读请求合并、Holder 明细分页、历史归档与监控。
5. 根据真实账单和并发曲线决定托管数据库/存储，以及是否迁出 Read API。

当前没有读取 Vercel 账单、云备份控制面或长期监控，因此不承诺节省百分比、生产容量或已经具备高可用。此次没有改动后端运行状态。
