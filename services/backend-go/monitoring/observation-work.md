# 分组观察任务监控

这是 D05 的队列监控子任务。只读查看 migration 00069 的 observation_work，独立于金融投影锁；不代替 backend-status、链上新鲜度、财务发布门槛或事件/活动通道监控。

## 运行

在 services/backend-go 下构建：

```sh
go build -trimpath -o bin/observation-work-status ./cmd/observation-work-status
# 在本地环境设置 TG_STATUS_DATABASE_URL，使用只读监控账号。
bin/observation-work-status --once
bin/observation-work-status --once --prometheus
```

`TG_OBSERVATION_STATUS_MAX_PENDING_AGE` 默认为 `120s`，允许大于零且不超过 `24h`。使用独立 1 连接池，读取超时 5 秒，命令总时限 7 秒；不需要 RPC、部署清单或签名器。退出码 0 表示本次未发现队列告警，2 表示有告警，1 表示无法可靠采集。0 **不表示**服务已运行、财务对账完成或可以上线；空队列同样可返回 0。

输出覆盖这个数据库里**所有链、所有 release 的保留缓存任务**；不是按链统计，也不是累计成功率。complete 只是核验任务执行完成，不证明其中财务检查均通过。缓存清理会让计数下降，所以全部使用 gauge。

pending_age 是最早 pending 行距离最近更新的时间，**不是入队等待总时长**。重复失败按 pending 且 attempts >= 5 识别，避免每次重试更新 updated_at 掩盖失败。运行任务租约到期、缺租约、负尝试次数和未来 updated_at 分别报告。正常运行中的租约不触发过期告警。

## 权限

由管理员为已有监控角色授予以下权限；把 observation_monitor 替换成实际角色。工具自身不执行 GRANT：

```sql
GRANT USAGE ON SCHEMA tickergarden TO observation_monitor;
GRANT SELECT (state, attempts, generation, updated_at, retry_after, lease_until)
ON tickergarden.observation_work TO observation_monitor;
```

已用 PostgreSQL 角色测试验证：仅上述列可读即可采集；该角色不能读取 request，也不能 DELETE。没有访问请求、结果、钱包或 RPC 凭据，不将任意地址/错误文本写入指标标签。

## 采集与告警

CLI 不启动 HTTP 服务。若部署已使用 node_exporter textfile collector，可每 30 秒由现有进程管理器执行一次：

```sh
monitoring/observation-work-export.sh /absolute/textfile-directory/observation.prom
```

目录需预先存在且仅允许运维写入。可用 `TG_OBSERVATION_STATUS_BINARY` 指定绝对二进制路径。导出器先写临时文件，再原子替换 `.prom`；退出码 2 的告警报告也会发布，采集失败则保留上一份报告，由 stale 告警发现。不要用 `command > live.prom` 直接截断在线文件。调度器需把退出码 2 识别为成功采集但存在告警。

Prometheus 把该采集目标的 job 名配置为 `tickergarden-observation`，加载 `observation-work-alerts.yml`。如同一 node_exporter 还有其他指标，可在其 scrape job 下同步修改规则的 job 过滤器。不要部署多个相同数据库的 collector 后将这些 gauge 相加。

五类告警：采集目标不可达、必需指标缺失、报告超过 120 秒未更新、数据库时间超前超过 30 秒、队列异常。均要求持续 2 分钟；队列异常仅在报告新鲜时触发，过期报告由 stale 告警负责。生产 Alertmanager 路由和通知接收人需另行配置，本次未部署常驻采集或发送通知。

```sh
promtool check rules monitoring/observation-work-alerts.yml
# rule_files 按工作目录解析：
cd monitoring
promtool test rules observation-work-alerts.test.yml
```

## 剩余 D05 范围

尚未完成 event/activity 通道统一监控、每个任务的实际 RPC 次数与延迟、生产告警通知联调。这些不包含在本次领取的队列监控子任务中。数据库规模很大时聚合计数可能超时，命令会失败并停止更新指标，不伪造为零；需以实际规模另做聚合/索引优化。
