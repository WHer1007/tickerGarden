# 数据库查询统计与容器日志留存

仓库已包含配置；仅修改仓库不会改变现有生产容器。发布前先在测试环境验收，再安排生产数据库短暂重启。用户管理的连接配置仍只来自现有 `.env.master.local`，不要新增独立环境文件。

## 已编码的策略

- Compose 的所有 11 个服务统一使用 json-file，`max-size=20m`、`max-file=5`，每容器约 100 MB 上限；轮转会淘汰最旧的容器日志。
- PostgreSQL 预加载 `pg_stat_statements`，保留最多 5,000 个规范化语句条目，记录执行次数、总/平均/最大耗时及临时块 I/O。
- 超过 1,000 ms 的语句进入数据库日志，记录时间、数据库、角色、应用名。
- 不输出绑定参数；SQL 正文本身仍可能含字面量，管理员执行含敏感字面量的维护语句时应在该维护会话关闭语句日志，不应向外部告警直接转发原始 SQL。
- `query-statistics.sql` 仅导出 queryid 和数值统计，不输出 SQL 正文或参数，不重置累计计数。
- 新数据库初始化自动在业务和 queue 数据库创建扩展；存量数据库重启后需由管理员执行 `enable-query-statistics.sql`。
- 不向 read-api/content/pipeline/queue 授予 `pg_read_all_stats`。统计由管理员通过已有 SSH 通道读取。

## 发布顺序与验收

1. 确认 test、master 对应已验收代码；不要从 codex/* 直接部署。生产需单独授权。
2. 检查正在运行容器的 Compose 文件和覆盖项。当前使用 `/opt/tickergarden/compose.yml`、`/opt/tickergarden/production-init.override.json`，以及对应环境的 `/opt/tickergarden/test-release.override.json` 或 `/opt/tickergarden/production-release.override.json`。Queue/Relay 的镜像和必要环境项来自最后一个覆盖文件，重建时不可遗漏；单独定义在覆盖文件中的服务也须显式设置日志轮转。保留证书、网络、HBA、卷和连接预算。不要用仓库文件直接覆盖整套现场配置。
3. 先重建测试 PostgreSQL 镜像/容器；从 test 分支合并日志配置。日志限制只有容器重建后生效，不能仅靠 restart。
4. 分别对 `tickergarden`、`tickergarden_queue` 执行 `enable-query-statistics.sql`。检查 `SHOW shared_preload_libraries`、`SHOW log_min_duration_statement`、`SELECT count(*) FROM pg_stat_statements`，确认没有 pending_restart。
5. 在测试数据库执行 `SELECT pg_sleep(1.05)`，检查慢语句日志及 queryid/calls/max_exec_time；不对生产制造慢查询。
6. 检查 `docker inspect --format '{{json .HostConfig.LogConfig}}' <container>`。所有常驻服务必须显示 20m/5。
7. 生产窗口内停止相关 Worker/定时器消费，确认无长事务，按现有 Compose 项目逐项重建 PostgreSQL 和其他日志配置发生变化的服务。保留所有数据库卷，禁止 `down -v`。无需重启整个 Docker daemon。
8. 生产扩展启用后恢复服务，核验 TLS、业务角色连接预算、任务恢复、价格批次、页面/API，以及数据库统计是否随真实业务增加。数据库容器重建期间现有数据库连接会短暂断开。
9. 若需回退镜像/CMD，保留数据库卷和扩展；恢复原有服务镜像及参数后重建，不删除业务数据。扩展不预加载时其视图不可查询，但不应成为业务请求依赖。

现有 journald 设置不在此次变更中；自动备份也不在本次范围。

## 资料

- [PostgreSQL 17 pg_stat_statements](https://www.postgresql.org/docs/17/pgstatstatements.html)：扩展预加载需要重启；本项目脚本兼容 14 和 17 的 I/O 列名。
- `enable-query-statistics.sql`：存量数据库扩展安装与读取验证。
- `query-statistics.sql`：管理员只读统计快照，用两次采样差值判断新增耗时、临时 I/O 和调用量。
