# RH 数据库健康与空闲队列优化 — 2026-11-04

状态：经用户明确授权，已于 2026-11-04 15:32:49 UTC 发布 RH resident Worker，初步健康检查通过。下方保留诊断和本地验收证据，生产观察结果附后。

原生产 RH Worker 的源目录为 `/opt/tickergarden-releases/082eb22923-ops`，标称基线 `082eb229236882bde0acc2a1dc8f783ab070f88a`。应用计时器、遥测和 RPC 租约存储源码哈希已与实际运行文件核对。后续全文件发布校验发现部分旧发布组装差异，处理方式见下方“窄范围发布”。本次工作区为 `TickerGarden-rh-database-health`，不包含主工作区其他未发布变更。

## 慢查询证据

采样起点为 2026-11-04 15:03:26 UTC，应用日志窗口为此前 6 小时。RH resident 共有 74 次慢 SQL 告警、2 次慢连接告警，没有 SQL/连接超时告警；RH Display Worker 没有数据库慢查询告警。

| SQL 类型 | 次数 | 最长耗时 |
| --- | ---: | ---: |
| COMMIT | 69 | 3,442 ms |
| BEGIN | 3 | 1,888 ms |
| RPC 租约 DELETE | 2 | 1,002 ms |

COMMIT 告警样本的 P50 为 774 ms、P95 为 1,901 ms；这些是**超过告警阈值的子集**，不能作为全部事务的延迟分布。慢连接最长 246 ms，没有证据表明需要扩大连接池。

共享生产 PostgreSQL 容器的另一段 6 小时日志记录了 39 次超过 1 秒的 COMMIT（最长 3,541 ms），证实数据库端也存在提交停顿。该容器同时服务 RH/BSC，这个数字不是 RH 专属计数。一次活动会话采样观察到 `IO/WalSync`。主机短窗口 CPU steal 约 8–20%，磁盘利用率大多为 1–7%；宿主机调度及间歇性刷盘延迟可能共同影响尾延迟，不能仅凭这些样本认定单一基础设施根因。

明确可优化的应用开销：每次空队列轮询都执行 `recoverExpiredLeases` 和 `claimJobs`。两者在无实际任务时仍通过 `FOR SHARE` 锁住 `queue_generations`，各提交一次事务。15:03:26–15:13:12 UTC 的增量样本中，该代际行锁 SQL 执行 1,186 次；恢复租约查询执行 572 次。行锁可以产生磁盘写入，不能将“没有改业务记录”视为“没有写入”。参见 [PostgreSQL 行锁说明](https://www.postgresql.org/docs/17/explicit-locking.html#LOCKING-ROWS)。

## 本次修改

`services/backend-ts/packages/chain-worker/src/resident.ts` 在每次轮询先以一条只读 SQL 检查当前模式/代际、已到期任务及过期租约。空闲时直接等待现有轮询间隔；有真实工作才调用原有写入路径，只有发现过期租约才执行恢复。

- 默认轮询仍为 1 秒；在快照之后到达的任务下一轮会被发现。
- 快照仅作工作提示。实际 claim/recovery 的代际锁、模式复核、租约 fencing、`SKIP LOCKED`、任务日志和独占 advisory lock 均保留。
- 检查完成后再次检查终止信号和控制连接状态。
- 不修改 RPC 调度、扫描范围、金融 Worker、数据库持久性配置、告警阈值、表结构或索引。
- 没有前端或样式变更，无数据库迁移，也不需要重启 PostgreSQL。

生产 PostgreSQL 17 上对新 SQL 进行了只读 `EXPLAIN (ANALYZE, BUFFERS, WAL)`：命中 `queue_generations_pkey`、`jobs_due_generation`、`jobs_expired_lease`；执行时间 0.284 ms，规划时间 6.210 ms，共命中 7 个共享缓冲块，WAL/临时块/读盘均为 0。这是单次计划检查，不是生产负载下的延迟保证。

## 验证结果

- `npm test`：生成物、Vercel 打包、OpenAPI/合约覆盖门禁通过，接口测试 14 项、单元测试 258 项通过，TypeScript 检查通过。
- `npm run build`：通过。
- 数据库集成套件：67 项通过，默认跳过 100,001 Holder 容量用例；随后显式启用 `TG_HOLDER_CAPACITY_TEST=1` 单独执行该用例，通过。因此 68 项集成用例均取得通过证据。测试数据库为本机 PostgreSQL 14.20，生产 PostgreSQL 17.11 仅执行上文的只读计划检查，没有在生产运行测试迁移。
- 新增 5 项真实数据库测试，覆盖：只读连接可持续空闲轮询并感知模式切换；快照之后的新任务只消费一次；过期租约恢复及旧所有者 fencing；提示之后的模式切换不能越权领取；代际变化和取消使 Worker 停止。原有测试还覆盖排他 Worker、耗尽重试、长任务、关停和重复消息。

在本机暂停其他本轮负载测试后，以相同 10 ms 间隔各跑 200 次空闲轮询：

| 指标 | 原循环 | 新循环 |
| --- | ---: | ---: |
| SQL 调用数，不含独立控制连接 | 2,000 | 200 |
| BEGIN / COMMIT | 各 400 | 0 |
| 代际行锁 | 400 | 0 |
| WAL 插入位置增量 | 38,496 bytes | 0 |
| P95 每轮数据库往返耗时，不含主动 sleep | 10.90 ms | 2.54 ms |

SQL 调用减少 90%，空闲提交和行锁消除。WAL 位置为集群级计数，仅作该本地实验佐证；延迟会受机器调度影响，不能外推为生产降幅。生产实际告警改善需要发布后再观察。没有通过提高阈值隐藏告警。

## 数据库当前健康

| 项目 | 实测情况 | 判断 |
| --- | --- | --- |
| PostgreSQL | 生产/测试均 17.11，容器 healthy | 服务可用 |
| 连接 | 生产约 14–16 个客户端，上限 100 | 无连接耗尽证据 |
| 锁 | 无阻塞会话、无 idle-in-transaction | 当前无锁堆积 |
| RH 数据库 | 约 129 MiB | 规模较小 |
| BSC 数据库 | 约 275 MiB，共用生产 PG 实例 | 需一起计入宿主机资源 |
| VPS 存储 | 约 55 GiB 可用，使用约 29% | 余量充足 |
| VPS 内存 | 约 1.7 GiB available；未发现 OOM | 当前无明显内存压力 |
| 事务 ID 年龄 | 约 2,096 万；自动冻结阈值 2 亿 | 未接近冻结阈值 |
| 维护 | autovacuum 开启；检查到近期自动维护；未发现失效索引 | 不需要盲目 VACUUM FULL / REINDEX |
| 持久性 | fsync、full_page_writes、synchronous_commit 均开启 | 保留可靠性设置 |
| RH 队列 | 13,948 个 chain 成功任务，6 个 content 成功任务；无 pending/retry/dead/leased | 本次快照无积压 |

585 秒的增量窗口：RH 缓存命中率 **99.833%**，新增临时文件字节 **0**、新增死锁 **0**、回滚 **0**。BSC 同期缓存命中率 96.912%，新增临时字节和死锁也为 0。早期累计统计中的约 1.1 TiB 临时文件和两次死锁并非本次新增，不据此宣称当前排序溢出或死锁故障。未清空统计信息。

`track_wal_io_timing` 当前关闭，因此 `wal_sync_time=0` 不能解释为刷盘没有延迟；累计统计也必须按时间差分使用。参见 [PostgreSQL 累计统计说明](https://www.postgresql.org/docs/17/monitoring-stats.html)。

## 尚需处理的事项

1. **生产持续观测**：已完成 RH resident Worker 窄范围发布，仍需对比同等 6 小时窗口。短窗口正常不能证明间歇性提交停顿彻底消失。
2. **备份与恢复**：服务器已启用的应用数据库备份 timer 仅查到 BSC，每日任务最近成功于 11 月 3 日 20:54 UTC，文件保存在同一台机器。未找到 RH 已启用的自动备份 timer；所查 RH dump 为旧维护备份。仓库已有 off-host restic 备份及恢复演练脚本，但现有运维说明记录异机自动备份曾被暂缓。当前 `archive_mode=off`、无复制槽；没有足够证据确认 RH 的异机备份或 PITR 已落实。需要确认独立备份目标、保留期、RPO/RTO 并做恢复演练。
3. **投影覆盖行锁写放大**：同一增量窗口，覆盖证明的 `covered_ranges ... FOR SHARE` 14 次执行产生约 13.7 MB WAL。它属于发布资格的安全检查，不能直接删除锁。若继续优化，应单独设计覆盖证明压缩及并发/reorg 验证，本次不与空闲轮询修改混合。
4. **测试 relay**：RH test relay `/healthz` 返回 503，错误为 provider connection/RPC failure，订阅数为 0、待处理/死信均为 0。这是测试上游订阅故障，不是生产数据库故障。本次未改测试 RPC 配置或重启该服务。
5. **宿主机资源**：若发布后仍出现慢 COMMIT，继续按短时间窗口采集 steal、WAL 等待与磁盘尾延迟，必要时评估独享 CPU/存储。当前证据不足以建议扩大连接池、增大 work_mem 或关闭同步刷盘。

原始诊断存于本工作区 `.codex_tmp/rh-db-health/evidence/`，不进入 Git；包含内部 SQL 结构及运维细节。可共享的验证汇总另见同目录下本报告对应的 JSON 文件。

## 窄范围发布

- 开发提交 `32e1191e40e79ecee5d9d35f0215020869f6ea4b` 已通过 `test → master`，生产来源提交为 `2bd4cb02274922b542dc0283af4cf118e6e09a77`。两个分支的 source-only 门禁均通过，backend 产品树与本地验收版本相同。
- 完整对照时发现：旧服务器运行包的 `pool.ts` 仍使用固定 10 秒回收；`retention.ts` 保留旧筛选；迁移注册止于 0034，未包含 0035。此外部分测试/验证脚本与标称 commit 不同。首次候选在校验处停止，未激活。
- 为遵守“仅发布此项 RH Worker 优化”，最终候选封存并复制**实际在线运行版本**，仅叠加 master 上的 `resident.ts`。实际运行依赖/迁移/配置全部保留；另外按这三项实际源码差异重建本地兼容副本，重新执行 7 项 resident 数据库测试，全部通过。
- 最终 release：`/opt/tickergarden-releases/2bd4cb0227-rh-resident-only`。329 个 backend 文件逐一校验，除 `packages/chain-worker/src/resident.ts` 外无差异；该文件 SHA-256 为 `d1b71222f0cdbd600deb62f3f51fa78df23a92c011a0bf88a24acdd0ee0fa8d9`。release 元数据明确记录这是“实际运行基线 + master 单模块”的组装产物，不能将它冒充完整 master 快照。
- 只为 `tickergarden-resident-worker-production.service` 添加 `40-rh-idle-source.conf`，将 WorkingDirectory 固定到新 release。原实例 idle 后执行一次受控重启，PID 从 531687 变为 3464672；ready 为 true。
- RH Display/BSC Display PID 与启动时间、PostgreSQL 容器启动时间、共享源码软链接、原环境文件 SHA-256 均保持不变。没有 Vercel 部署、前端发布、数据库迁移或数据库重启。
- 回滚仅需删除上述独占 drop-in，`systemctl daemon-reload` 后重启该 resident service，即回到原 WorkingDirectory。原 release、共享软链接和环境文件均保留。

后续全量后端发布必须继续按实际运行文件核对，不能只凭旧包目录名或 commit 标签判断来源一致。

## 发布后在线观察

2026-11-04 15:33:25–15:35:01 UTC（约 95.74 秒）：

- 新 Worker 成功处理 1 个实际入队任务，重试 0、死信 0，`ready=true`；数据库 chain 成功任务从 13,952 增至 13,953，无待处理/失败积压。
- 新工作提示 SQL 执行 90 次，合计数据库执行时间约 24.62 ms，WAL 字节增量 **0**。实际任务仍正常使用受保护的写事务。
- 发布以来的日志没有慢 SQL、慢连接或任务失败事件，日志中的 release commit 为 `2bd4cb02274922b542dc0283af4cf118e6e09a77`。
- 活跃日志出现业务处理所需 RPC；空闲阶段没有此类日志。此次代码未修改业务 RPC 行为。

这些是发布后的短窗口结果，不是全天 SLA 或“慢查询已永久消失”的结论。保留原告警阈值，后续按同等 6 小时窗口比较 COMMIT 告警频率、任务耗时和宿主机 steal。
