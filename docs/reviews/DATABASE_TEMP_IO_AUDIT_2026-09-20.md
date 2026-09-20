# 生产数据库临时文件排查（2026-09-20）

检查生产 VPS / PostgreSQL，所有线上操作均为只读；没有修改参数、重启服务、重置统计、迁移或删除数据。另在本地独立临时表复现旧查询，连接结束即删除。

## 结论

约 1.20 TB 是 `pg_stat_database.temp_bytes` 累计值，不是当前占用。证据强烈指向此前共享报价的全历史排序是主要来源：表中积累约 44.8 万行，各消费者为获取每种资产最新报价却反复排序历史；生产只有一个项目不限制全平台 194 个 Stock 的报价数量及采集次数。历史未启用逐 SQL 临时文件统计，不能精确宣称全部 1.20 TB 或某个百分比均来自该查询。

## 实测

| 指标 | 结果 |
| --- | --- |
| VPS 根盘 | 77G，总使用 16G，可用 62G |
| 生产数据库 | 795 MB |
| 当前临时目录 | 0 文件、0 字节 |
| 累计临时文件 | 27,212 个；1,201,679,540,224 字节 |
| 当前市场 | 1 个 |
| 当前报价 | 196 条：194 Robinhood Stock、1 ETH、1固定美元 |
| 当前报价表含索引 | 504 kB |
| 配置投影表含索引 | 767 MB，约 40.3 万行估计活跃记录 |
| 排序内存 | work_mem=4MB，hash_mem_multiplier=2 |
| 已部署迁移 | 到 0029_price_batches，尚无 0030–0033 |

UTC 13:24:00、13:25:29、13:27:14、13:29:02 四次独立连接采样（约 5 分钟），temp_files/temp_bytes 完全相同。该短窗口没有新增已计入统计的临时文件，不能据此保证所有未来工作负载均不落盘。

## 旧报价查询证据

旧 SQL：

```sql
SELECT DISTINCT ON (asset,source) asset,payload
FROM price_references
WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3
ORDER BY asset,source,
  (status='available' AND expires_at>$4) DESC,as_of DESC;
```

- 先按资产、来源、可用性及时间排序，再去重。可用性包含随请求变化的 `$4`，旧索引不能直接提供完整排序。
- 之前的数据库审查证据记录报价表 447,844 行、643,022,848 字节（含索引），累计顺序扫描 27,252 次。不能把顺序扫描次数直接等同于落盘排序次数，但重复扫描量与此问题吻合。
- PostgreSQL 容器日志从 9 月 18 日至 20 日，出现此 SQL 的 STATEMENT 报错记录 1,801 次；按同 PID 错误关联，1,786 次明确为 statement timeout，另 15 条无法从现有 ERROR 关联确定。最后一条为 UTC 2026-09-20 11:42:48（北京时间 19:42:48）。成功执行通常不记录，真实执行次数大于报错次数。
- 本地使用 447,844 条合成数据、平均 payload 462 字节、work_mem=4MB、相同旧索引和查询复现：external merge 排序，临时文件 235,784 kB（约 230 MiB），Temp Written Blocks=75,049（约 586 MiB 临时块写入，包含多轮处理）。这两个计量不可混为一谈。
- 减到 196 条后，本地同查询改为内存排序。生产当前同查询 `EXPLAIN ANALYZE` 为 139 kB 内存 quicksort，执行约 1.290 ms，没有临时块写入。

这能解释“一个项目却出现 TB 级累计临时写入”：后台反复排序的是全平台资产报价历史，不是该项目的成交量。数百 MB 的临时文件经数千次执行便可以累计到 TB 级；这只是量级解释，不是历史查询次数的反推确认。

## 当前状态与剩余事项

1. `0028` 和 `0029` 已在生产：报价只保存当前值，源码查询也已不再对历史做 DISTINCT ON，详情、Explore、Stats 共用报价批次。这一类问题的主要结构原因已消除。
2. 配置历史仍大。对现网配置读取做不执行的 EXPLAIN，计划会顺序扫描约 402,905 条 configs，再关联当前发布指针；这条计划没有排序节点，因此不能把它直接认定为 1.20 TB 的主要来源，但会浪费 I/O。前一任务已准备的 `0030` 内容去重需按迁移窗口上线。
3. Stats 初始化的历史 allocation `DISTINCT ON` 也是潜在排序点，但现网数据规模和现有日志不能支持其为本次主要来源。应继续观察初始化频次，而不是仅凭源码推断占比。
4. 观测欠缺：未安装 pg_stat_statements，log_temp_files=-1、log_min_duration_statement=-1、track_io_timing=off。建议后续开启大临时文件日志及慢 SQL 采样，并以 pg_stat_statements 的 temp_blks_read/written 按 SQL 归因。启用 shared_preload_libraries 需要计划重启，未在此次检查中执行。
5. 不通过重置计数隐藏历史值，也不全局盲目提高 work_mem；本机仅 4GB 内存，多连接和多个排序节点会叠加内存。

证据：`DATABASE_TEMP_IO_EVIDENCE_2026-09-20.json`。历史基线引用 `DATABASE_REDUNDANCY_EVIDENCE_2026-09-20.json`。官方统计定义：[PostgreSQL cumulative statistics](https://www.postgresql.org/docs/current/monitoring-stats.html#MONITORING-PG-STAT-DATABASE-VIEW)。
